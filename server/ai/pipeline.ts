// Orchestrates one concept: layout drawing -> reference images -> image model ->
// crop to plaque -> spelling check -> saved as a new, never-overwritten version.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { config } from '../config.js';
import { mustOption, paintHex, paintLabel } from '../catalog.js';
import { findAsset } from '../assets.js';
import { computeLayout } from '../layout/engine.js';
import { preparePhoto, renderFlatPng } from '../render/flat.js';
import { getConcept, newId, now, projectDir, saveConcept, addSpend, spentToday, listConcepts } from '../db.js';
import { uploadPath } from '../uploads.js';
import { buildConceptPrompt, buildFixPrompt, buildRelayoutPrompt, promptVersion, type RefImage } from './prompts.js';
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
  const photo = project.uploads.photo;
  const logo = project.uploads.logo;
  return computeLayout(
    {
      spec: project.spec,
      wording: project.wording,
      photoAspect: photo ? photo.width / photo.height : null,
      logoAspect: logo ? logo.width / logo.height : null,
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

/** Flat layout drawing at the output canvas size (Reference 1). */
export async function layoutDrawing(project: Project, layout: PlaqueLayout, w: number, h: number): Promise<Buffer> {
  const spec = project.spec!;
  const photoFile = uploadPath(project, 'photo');
  const logoFile = uploadPath(project, 'logo');
  const finish = mustOption('finishes', spec.finish);
  const photoPng = photoFile && layout.imageFrame ? await preparePhoto(fs.readFileSync(photoFile), spec.imageOption, finish.hex ?? '#C49A6C') : null;
  const logoPng = logoFile && layout.logo ? fs.readFileSync(logoFile) : null;
  return renderFlatPng(layout, spec, { pxPerIn: w / layout.widthIn, widthPx: w, heightPx: h, photoPng, logoPng });
}

export async function buildReferences(project: Project, layout: PlaqueLayout, layoutPng: Buffer): Promise<RefImage[]> {
  const spec = project.spec!;
  const refs: RefImage[] = [
    { role: 'the exact flat layout drawing of this plaque (positions, sizes and text to follow exactly)', file: layoutPng, name: 'layout.png', mime: 'image/png' },
  ];
  const add = async (role: string, file: string | null, name: string) => {
    if (file) refs.push({ role, file: await asPng(file), name, mime: 'image/png' });
  };
  const photo = uploadPath(project, 'photo');
  if (layout.imageFrame && photo) await add('the customer photo to reproduce (likeness, pose and crop)', photo, 'customer-photo.png');
  if (layout.imageFrame) {
    const opt = mustOption('imageOptions', spec.imageOption);
    await add(`an example of the ${opt.label} treatment (style only, not the subject)`, findAsset(opt.asset), 'image-type-example.png');
  }
  const finish = mustOption('finishes', spec.finish);
  await add(`the ${finish.label} finish swatch (color and sheen of all raised metal)`, findAsset(finish.asset), 'finish-swatch.png');
  const paint = mustOption('backgroundColors', spec.backgroundColor);
  const paintAsset = spec.backgroundColor === 'custom' ? null : findAsset(paint.asset);
  refs.push({
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
  const logo = uploadPath(project, 'logo');
  if (layout.logo && logo) await add('the customer logo (reproduce exactly as raised metal)', logo, 'customer-logo.png');
  const sketch = uploadPath(project, 'sketch');
  if (sketch) await add("the customer's hand-drawn sketch (intent only; Reference 1 decides positions)", sketch, 'customer-sketch.png');
  return refs.slice(0, 16);
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
      prompt = buildConceptPrompt(project.spec!, layout, images, { hasLogo: !!(layout.logo && project.uploads.logo), direction: designerChange(rec) });
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
