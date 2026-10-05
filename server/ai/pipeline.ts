// Orchestrates one concept: layout drawing -> reference images -> image model ->
// crop to plaque -> spelling check -> saved as a new, never-overwritten version.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { config } from '../config.js';
import { mustOption, paintHex, paintLabel } from '../catalog.js';
import { findAsset } from '../assets.js';
import { computeLayout } from '../layout/engine.js';
import { logoForDrawing, preparePhoto, renderFlatPng } from '../render/flat.js';
import { getConcept, newId, now, projectDir, saveConcept, addSpend, spentToday, listConcepts } from '../db.js';
import { uploadPath } from '../uploads.js';
import { buildConceptPrompt, buildFixPrompt, buildRelayoutPrompt, placeNames, promptVersion, type RefImage } from './prompts.js';
import { changesOrder } from './instruct.js';
import { canvasSize, costUsd, friendlyError, imageAdapter } from './images.js';
import { fitToPlaque, smallPreview } from './postprocess.js';
import { spellcheckImage } from './spellcheck.js';
import type { ConceptRecord, ContentSnapshot, LayoutPresetId, PlaqueLayout, Project } from '../../shared/types.js';

export interface ConceptEvents {
  onUpdate(c: ConceptRecord): void;
  onPartial(conceptId: string, jpeg: Buffer): void;
}

export function layoutFor(project: Project, preset: LayoutPresetId): PlaqueLayout {
  if (!project.spec) throw new Error('Confirm the plaque specification first.');
  const aspect = (f: { id: string; width: number; height: number }) => ({ id: f.id, aspect: f.height ? f.width / f.height : 1 });
  return computeLayout(
    {
      spec: project.spec,
      wording: project.wording,
      photos: project.uploads.photos.map(aspect),
      logos: project.uploads.logos.map(aspect),
      logoSlot: project.logoSlot,
      imageAfterBlock: project.imageAfterBlock,
      customFontFile: uploadPath(project, 'font'),
      adjust: project.layoutAdjust?.[preset] ?? null,
    },
    preset,
  );
}

export function conceptFile(c: ConceptRecord, name: 'image.png' | 'raw.png' | 'layout.png' | 'preview.jpg'): string {
  return path.join(projectDir(c.projectId, 'concepts', c.id), name);
}

async function asPng(file: string, maxEdge = 1536): Promise<Buffer> {
  return sharp(file).rotate().resize({ width: maxEdge, height: maxEdge, fit: 'inside', withoutEnlargement: true }).flatten({ background: '#ffffff' }).png().toBuffer();
}

async function solidSwatch(hex: string): Promise<Buffer> {
  return sharp({ create: { width: 256, height: 256, channels: 3, background: hex } }).png().toBuffer();
}

/** The stored file of each photo frame / logo box in a layout (null for a placeholder or a missing file). */
export function layoutFiles(project: Project, layout: PlaqueLayout): { photos: (string | null)[]; logos: (string | null)[] } {
  const file = (kind: 'photo' | 'logo', id?: string) => {
    const f = id ? uploadPath(project, kind, id) : null;
    return f && fs.existsSync(f) ? f : null;
  };
  return { photos: layout.imageFrames.map((f) => file('photo', f.photoId)), logos: layout.logos.map((l) => file('logo', l.logoId)) };
}

/** Flat layout drawing at the output canvas size (Reference 1). */
export async function layoutDrawing(project: Project, layout: PlaqueLayout, w: number, h: number): Promise<Buffer> {
  const spec = project.spec!;
  const finish = mustOption('finishes', spec.finish);
  const files = layoutFiles(project, layout);
  const photoPngs = await Promise.all(files.photos.map((f) => (f ? preparePhoto(fs.readFileSync(f), spec.imageOption, finish.hex ?? '#C49A6C') : null)));
  const logoPngs = await Promise.all(files.logos.map((f) => (f ? logoForDrawing(fs.readFileSync(f)) : null)));
  return renderFlatPng(layout, spec, { pxPerIn: w / layout.widthIn, widthPx: w, heightPx: h, photoPngs, logoPngs });
}

/** The image model takes at most this many reference pictures per request. */
export const MAX_REFERENCES = 16;

/**
 * Several pictures on one white sheet, in reading order (left to right, then down), with a
 * thin rule between cells. Used only when separate references would exceed MAX_REFERENCES.
 */
export async function contactSheet(files: string[], cell = 512): Promise<Buffer> {
  const cols = Math.ceil(Math.sqrt(files.length));
  const rows = Math.ceil(files.length / cols);
  const gap = 12;
  const tiles = await Promise.all(
    files.map(async (f, i) => ({
      input: await sharp(f).rotate().resize({ width: cell - 2 * gap, height: cell - 2 * gap, fit: 'inside' }).flatten({ background: '#ffffff' }).png().toBuffer(),
      left: (i % cols) * cell + gap,
      top: Math.floor(i / cols) * cell + gap,
    })),
  );
  const rules = Array.from({ length: cols - 1 }, (_, c) => `<rect x="${(c + 1) * cell - 1}" y="0" width="2" height="${rows * cell}" fill="#bbbbbb"/>`)
    .concat(Array.from({ length: rows - 1 }, (_, r) => `<rect x="0" y="${(r + 1) * cell - 1}" width="${cols * cell}" height="2" fill="#bbbbbb"/>`));
  const grid = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${cols * cell}" height="${rows * cell}">${rules.join('')}</svg>`);
  return sharp({ create: { width: cols * cell, height: rows * cell, channels: 3, background: '#ffffff' } })
    .composite([{ input: grid, left: 0, top: 0 }, ...tiles])
    .png()
    .toBuffer();
}

/** A customer group (photos, logos, sketches): one reference each, or one sheet. */
interface CustomerGroup {
  files: string[];
  /** Role of each picture when sent separately. */
  one: (i: number) => string;
  /** Role of the sheet, when the group has to share one reference. */
  sheet: string;
  name: string;
  sheeted?: boolean;
}

async function groupRefs(g: CustomerGroup): Promise<RefImage[]> {
  if (!g.files.length) return [];
  if (g.sheeted) return [{ role: g.sheet, file: await contactSheet(g.files), name: `${g.name}-sheet.png`, mime: 'image/png' }];
  return Promise.all(g.files.map(async (f, i) => ({ role: g.one(i), file: await asPng(f), name: g.files.length > 1 ? `${g.name}-${i + 1}.png` : `${g.name}.png`, mime: 'image/png' })));
}

export async function buildReferences(project: Project, layout: PlaqueLayout, layoutPng: Buffer): Promise<RefImage[]> {
  const spec = project.spec!;
  const files = layoutFiles(project, layout);
  // Customer files: one reference each when they fit within the model's limit; otherwise the
  // sketches, then the logos, then the photos share one numbered sheet per group.
  const photoFiles = files.photos.filter((f): f is string => !!f);
  const logoFiles = files.logos.filter((f): f is string => !!f);
  const photoPlaces = placeNames(layout.imageFrames.filter((_, i) => files.photos[i]).map((f) => f.outer));
  const logoPlaces = placeNames(layout.logos.filter((_, i) => files.logos[i]));
  const sketchFiles = project.uploads.sketches.map((s) => uploadPath(project, 'sketch', s.id)).filter((f): f is string => !!f && fs.existsSync(f));
  const photos: CustomerGroup = {
    files: photoFiles, name: 'customer-photo',
    one: (i) => (photoFiles.length === 1
      ? 'the customer photo to reproduce (likeness, pose and crop)'
      : `customer photo ${i + 1} of ${photoFiles.length}, for the ${photoPlaces[i]} image frame in Reference 1 only (reproduce its likeness, pose and crop)`),
    sheet: `all ${photoFiles.length} customer photos on one sheet, in this order: ${photoPlaces.map((p, i) => `${i + 1} = the ${p} image frame`).join(', ')} (reading the sheet left to right, then down; reproduce each likeness, pose and crop in its own frame)`,
  };
  const logos: CustomerGroup = {
    files: logoFiles, name: 'customer-logo',
    one: (i) => (logoFiles.length === 1
      ? 'the customer logo (reproduce exactly as raised metal)'
      : `customer logo ${i + 1} of ${logoFiles.length}, for the ${logoPlaces[i]} logo position in Reference 1 only (reproduce exactly as raised metal)`),
    sheet: `all ${logoFiles.length} customer logos on one sheet, in this order: ${logoPlaces.map((p, i) => `${i + 1} = the ${p} logo`).join(', ')} (reading the sheet left to right, then down; reproduce each exactly as raised metal in its own position)`,
  };
  const sketches: CustomerGroup = {
    files: sketchFiles, name: 'customer-sketch',
    one: (i) => (sketchFiles.length === 1
      ? "the customer's hand-drawn sketch (intent only; Reference 1 decides positions)"
      : `customer sketch ${i + 1} of ${sketchFiles.length} (intent only; Reference 1 decides positions)`),
    sheet: `the customer's ${sketchFiles.length} hand-drawn sketches on one sheet (intent only; Reference 1 decides positions)`,
  };

  const fixed: RefImage[] = [];
  const add = async (role: string, file: string | null, name: string) => {
    if (file) fixed.push({ role, file: await asPng(file), name, mime: 'image/png' });
  };
  if (layout.imageFrames.length) {
    const opt = mustOption('imageOptions', spec.imageOption);
    await add(`an example of the ${opt.label} treatment (style only, not the subject)`, findAsset(opt.asset), 'image-type-example.png');
  }
  const finish = mustOption('finishes', spec.finish);
  await add(`the ${finish.label} finish swatch (color and sheen of all raised metal)`, findAsset(finish.asset), 'finish-swatch.png');
  const paint = mustOption('backgroundColors', spec.backgroundColor);
  const paintAsset = spec.backgroundColor === 'custom' ? null : findAsset(paint.asset);
  fixed.push({
    role: `the ${paintLabel(spec)} paint color of the recessed background`,
    file: paintAsset ? await asPng(paintAsset) : await solidSwatch(paintHex(spec)),
    name: 'paint-swatch.png',
    mime: 'image/png',
  });
  const texture = mustOption('backgroundTextures', spec.backgroundTexture);
  await add(`the ${texture.label} background texture`, findAsset(texture.asset), 'texture-swatch.png');
  const border = mustOption('borders', spec.border);
  await add(`an example of the ${border.label}`, findAsset(border.asset), 'border-example.png');
  const mounting = mustOption('mountings', spec.mounting);
  if (layout.screws.length && mounting.diagram) await add(`how the ${mounting.label} look`, findAsset(mounting.diagram as string), 'mounting-example.png');

  const room = MAX_REFERENCES - 1 - fixed.length; // 1 = the layout drawing
  const count = () => [photos, logos, sketches].reduce((n, g) => n + (g.sheeted ? Math.min(1, g.files.length) : g.files.length), 0);
  for (const g of [sketches, logos, photos]) if (count() > room && g.files.length > 1) g.sheeted = true;
  const refs: RefImage[] = [
    { role: 'the exact flat layout drawing of this plaque (positions, sizes and text to follow exactly)', file: layoutPng, name: 'layout.png', mime: 'image/png' },
    ...(await groupRefs(photos)),
    ...fixed,
    ...(await groupRefs(logos)),
    ...(await groupRefs(sketches)),
  ];
  // The upload limits keep this within range; never send the model more than it accepts.
  if (refs.length > MAX_REFERENCES) throw new Error(`Too many reference pictures (${refs.length}). Remove a sketch or a logo and try again.`);
  return refs;
}

export function checkLimits(projectId: string, excludeId?: string) {
  const used = listConcepts(projectId).filter((c) => c.id !== excludeId && c.status !== 'error').length;
  if (used >= config.maxImageCallsPerProject) {
    throw new Error(`This job has reached its limit of ${config.maxImageCallsPerProject} images (MAX_IMAGE_CALLS_PER_PROJECT).`);
  }
  if (!config.mockAI && spentToday() >= config.dailyBudgetUsd) {
    throw new Error(`Today's image budget of $${config.dailyBudgetUsd} is used up (DAILY_BUDGET_USD). It resets at midnight UTC.`);
  }
}

export function contentSnapshot(project: Project): ContentSnapshot {
  return structuredClone({ spec: project.spec, wording: project.wording, wordingText: project.wordingText, parse: project.parse, logoSlot: project.logoSlot, imageAfterBlock: project.imageAfterBlock, uploads: project.uploads, layoutAdjust: project.layoutAdjust ?? {} });
}

/** Old records lack newer snapshot fields; only compare the fields they stored. */
export function matchesSnapshot(project: Project, snapshot: ContentSnapshot): boolean {
  // "No layout adjustments" may be stored as {} (JSON drops undefined).
  const value = (o: Project | ContentSnapshot, key: keyof ContentSnapshot) => (key === 'layoutAdjust' ? o.layoutAdjust ?? {} : o[key]);
  return (['spec', 'wording', 'logoSlot', 'imageAfterBlock', 'uploads', 'layoutAdjust'] as const)
    .every((key) => !(key in snapshot) || JSON.stringify(value(project, key)) === JSON.stringify(value(snapshot, key)));
}

export function projectForConcept(project: Project, concept: ConceptRecord): Project {
  return concept.snapshot ? { ...project, ...structuredClone(concept.snapshot) } : project;
}

export function newConceptRecord(project: Project, init: Partial<ConceptRecord> & Pick<ConceptRecord, 'preset' | 'kind' | 'batchId'>): ConceptRecord {
  return {
    id: newId('c'),
    projectId: project.id,
    parentId: null,
    status: 'queued',
    note: '',
    prompt: '',
    promptVersion: promptVersion(),
    model: config.mockAI ? 'mock' : config.imageModel,
    quality: config.imageQuality,
    size: '',
    costUsd: 0,
    usage: null,
    spellcheck: null,
    error: null,
    hasImage: false,
    createdAt: now(),
    snapshot: contentSnapshot(project),
    ...init,
  };
}

/** The free-form part of a designer's Fix instruction, for the image model. */
function designerChange(rec: ConceptRecord): string | undefined {
  return rec.plan?.kind === 'edit' ? rec.plan.imageEdit?.trim() || undefined : undefined;
}

/** Runs one generation (new concept, regenerate, or fix of an existing image). */
export async function runConcept(project: Project, rec: ConceptRecord, ev: ConceptEvents, opts: { quality?: string } = {}): Promise<ConceptRecord> {
  project = projectForConcept(project, rec);
  const started = Date.now();
  const update = (patch: Partial<ConceptRecord>) => {
    Object.assign(rec, patch);
    saveConcept(rec);
    ev.onUpdate({ ...rec });
  };
  try {
    checkLimits(project.id, rec.id);
    const layout = layoutFor(project, rec.preset);
    const { w, h, size } = canvasSize(project.spec!.widthIn, project.spec!.heightIn);
    const quality = opts.quality || config.imageQuality;
    update({ status: 'running', size, quality });
    const layoutPng = await layoutDrawing(project, layout, w, h);
    fs.writeFileSync(conceptFile(rec, 'layout.png'), layoutPng);

    let prompt: string;
    let images: RefImage[];
    if (rec.kind === 'fix' && rec.parentId) {
      const parent = getConcept(rec.parentId);
      if (!parent?.hasImage) throw new Error('The image to fix is missing.');
      const parentPng = await sharp(conceptFile(parent, 'image.png')).resize(w, h, { fit: 'fill' }).png().toBuffer();
      images = [
        { role: 'current plaque image', file: parentPng, name: 'current.png', mime: 'image/png' },
        { role: 'layout drawing', file: layoutPng, name: 'layout.png', mime: 'image/png' },
      ];
      prompt = rec.plan && changesOrder(rec.plan)
        ? buildRelayoutPrompt(rec.note, designerChange(rec), layout)
        : buildFixPrompt(designerChange(rec) ?? rec.note, layout, true);
    } else {
      images = await buildReferences(project, layout, layoutPng);
      prompt = buildConceptPrompt(project.spec!, layout, images, { logoCount: layoutFiles(project, layout).logos.filter(Boolean).length, direction: designerChange(rec) });
    }
    update({ prompt });

    const result = await imageAdapter().run({
      prompt,
      images,
      size,
      quality,
      onPartial: (png) => {
        smallPreview(png).then((jpg) => ev.onPartial(rec.id, jpg)).catch(() => {});
      },
    });
    fs.writeFileSync(conceptFile(rec, 'raw.png'), result.png);
    const fitted = await fitToPlaque(result.png, project.spec!.widthIn, project.spec!.heightIn);
    fs.writeFileSync(conceptFile(rec, 'image.png'), fitted.png);
    fs.writeFileSync(conceptFile(rec, 'preview.jpg'), await smallPreview(fitted.png, 720));
    const cost = costUsd(result.usage);
    if (cost) addSpend(cost);
    update({ hasImage: true, usage: result.usage, costUsd: cost, status: 'running', size: result.size ?? size, quality: result.quality ?? quality });

    const spellcheck = await spellcheckImage(fitted.png, layout.lines.map((l) => l.text), layout.lines.map((l) => !!l.style?.smallCaps));
    update({ spellcheck, status: 'done', durationMs: Date.now() - started });
  } catch (e) {
    update({ status: 'error', error: friendlyError(e), durationMs: Date.now() - started });
  }
  return rec;
}
