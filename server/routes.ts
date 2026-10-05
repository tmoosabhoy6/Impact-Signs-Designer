import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import express, { type Request, type Response } from 'express';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import sharp from 'sharp';
import { config } from './config.js';
import { getCatalog, mustOption } from './catalog.js';
import { assetLibraryStatus } from './assets.js';
import { authMode, checkLogin, clearSession, issueSession, owns, requireAuth, sessionUser, userOf } from './auth.js';
import {
  blankProject, deleteProject, getConcept, getOutput, getProject, listConcepts, listOutputs, listProjects,
  newId, now, projectDir, saveConcept, saveOutput, saveProject, spentToday, db,
} from './db.js';
import { parseSpec } from './parse/spec.js';
import { docxToText, parseWording } from './parse/wording.js';
import { addUpload, checkCanAdd, fileHash, prepareUpload, removeUpload, reorderUploads, uploadPath, photoPpi } from './uploads.js';
import { isMultiKind, type UploadKind } from '../shared/uploads.js';
import { PRESETS } from './layout/engine.js';
import { createExampleJob, listExamples } from './examples.js';
import { upscaleRouter } from './upscale-routes.js';
import { vectorRouter } from './vector-routes.js';
import { mergeRouter } from './merge-routes.js';
import { checkLimits, conceptFile, contentSnapshot, layoutDrawing, layoutFiles, layoutFor, matchesSnapshot, newConceptRecord, projectForConcept, runConcept, type ConceptEvents } from './ai/pipeline.js';
import { applyPlan, changesOrder, planInstruction } from './ai/instruct.js';
import { canvasSize, friendlyError, openai, testImage } from './ai/images.js';
import { PROMPT_FILES, promptVersion, readPrompt } from './ai/prompts.js';
import { buildProof, mergeProofs } from './pdf/proofs/index.js';
import { MAX_PROOF_PAGES } from '../shared/proof.js';
import { autoDescription } from './pdf/proofs/description-text.js';
import { buildProductionPdf, type ProductionLogo } from './pdf/production.js';
import { preflight } from './pdf/preflight.js';
import { resolveFont } from './text/fonts.js';
import type { ConceptRecord, InstructionPlan, LayoutPresetId, OutputRecord, PlaqueLayout, Project, TextStyle, WordingBlock, WordingRole } from '../shared/types.js';

export const api = express.Router();
const UPLOAD_LIMIT_MB = 60;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: UPLOAD_LIMIT_MB * 1024 * 1024 } });
const UPLOAD_KINDS: UploadKind[] = ['photo', 'logo', 'sketch', 'font'];
const ROLES: WordingRole[] = ['headline', 'subhead', 'body', 'footer'];
const genLimiter = rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many generations in a minute. Please wait a moment.' } });

const ah =
  (fn: (req: Request, res: Response) => Promise<unknown> | unknown) =>
  (req: Request, res: Response) =>
    // .then() also catches errors thrown synchronously by the handler.
    Promise.resolve().then(() => fn(req, res)).catch((e: Error) => {
      console.error(e);
      if (!res.headersSent) res.status(400).json({ error: e.message || 'Something went wrong.' });
    });

const hasPoppler = (() => {
  try {
    execFileSync('pdftocairo', ['-v'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

/** The job, if the signed-in person owns it (someone else's job reads as missing). */
function loadProject(req: Request, id = String(req.params.id)): Project {
  const p = getProject(id);
  if (!p || !owns(userOf(req), p.ownerId)) throw new Error('Job not found.');
  return p;
}

/** A concept and its job, if the signed-in person owns the job. */
function loadConcept(req: Request, id = String(req.params.id)): { c: ConceptRecord; p: Project } | null {
  const c = getConcept(id);
  const p = c ? getProject(c.projectId) : null;
  return c && p && owns(userOf(req), p.ownerId) ? { c, p } : null;
}

function loadOutput(req: Request): OutputRecord | null {
  const o = getOutput(String(req.params.id));
  const p = o ? getProject(o.projectId) : null;
  return o && p && owns(userOf(req), p.ownerId) ? o : null;
}

const userName = (req: Request) => userOf(req).name;

// ---------- Session ----------
const loginLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 20, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many sign-in attempts. Wait 15 minutes and try again.' } });
api.post('/login', loginLimiter, express.json(), ah(async (req, res) => {
  const { password = '', name = '', username = '' } = req.body ?? {};
  const user = await checkLogin(String(username || name), String(password));
  if (!user) return res.status(401).json({ error: authMode() === 'supabase' ? 'That username or password is not right.' : 'That password is not right.' });
  issueSession(res, user);
  res.json({ ok: true, user });
}));
api.post('/logout', (_req, res) => {
  clearSession(res);
  res.json({ ok: true });
});
api.get('/me', (req, res) => {
  const user = sessionUser(req);
  const mode = authMode();
  res.json({ user, authMode: mode, passwordRequired: mode === 'supabase' || mode === 'password', mock: config.mockAI });
});

// Basic health check is public (used by Render); the detailed one requires sign-in.
api.get('/health', (_req, res) => res.json({ ok: true }));

api.use(requireAuth);

api.get('/health/details', ah(async (req, res) => {
  const out: Record<string, unknown> = {
    server: 'OK',
    mode: config.mockAI ? 'Demo mode: images are simulated, no OpenAI calls, no cost.' : 'Live: using OpenAI.',
    openaiKey: config.openaiKey ? 'Present' : 'Missing (set OPENAI_API_KEY)',
    imageModel: config.imageModel,
    visionModel: config.visionModel,
    quality: config.imageQuality,
    promptVersion: promptVersion(),
    spentTodayUsd: +spentToday().toFixed(2),
    dailyBudgetUsd: config.dailyBudgetUsd,
    pdfTools: hasPoppler ? 'Installed (PDF/.ai uploads and proof previews work)' : 'Not installed (PDF/.ai uploads are not accepted here)',
  };
  if (req.query.live === '1' && config.openaiKey) {
    try {
      const m = await openai().models.retrieve(config.imageModel);
      out.modelCheck = `Model available: ${m.id}`;
    } catch (e) {
      out.modelCheck = friendlyError(e);
    }
  }
  res.json(out);
}));

api.post('/health/test-image', genLimiter, ah(async (_req, res) => {
  try {
    const r = await testImage();
    res.json({ ok: true, ms: r.ms, costUsd: r.costUsd, model: r.model, image: `data:image/png;base64,${r.png.toString('base64')}` });
  } catch (e) {
    res.json({ ok: false, error: friendlyError(e) });
  }
}));

// ---------- Catalog & admin ----------
api.get('/catalog', (_req, res) => res.json({ catalog: getCatalog(), presets: PRESETS.map(({ id, label, description }) => ({ id, label, description })) }));
api.get('/admin/assets', (_req, res) => res.json({ assets: assetLibraryStatus() }));
api.get('/admin/prompts', (_req, res) => res.json({ version: promptVersion(), files: PROMPT_FILES.map((f) => ({ name: f, text: readPrompt(f) })) }));

// ---------- AI Upscaler, Vectorizer and Proof Merger (separate from jobs) ----------
api.use('/upscales', upscaleRouter);
api.use('/vectors', vectorRouter);
api.use('/merge', mergeRouter);

// ---------- Projects ----------
api.get('/projects', (req, res) => {
  const user = userOf(req);
  res.json({
    projects: listProjects().filter((p) => owns(user, p.ownerId)).map((p) => ({
      id: p.id, jobNumber: p.jobNumber, name: p.name, updatedAt: p.updatedAt, createdBy: p.createdBy,
      size: p.spec ? `${p.spec.widthIn}" x ${p.spec.heightIn}"` : '',
      thumb: p.selectedConceptId ?? p.proofConceptIds[0] ?? null,
    })),
  });
});

api.get('/examples', (_req, res) => {
  res.json({ examples: listExamples().map(({ id, jobNumber, name, description, proofStyle }) => ({ id, jobNumber, name, description, proofStyle })) });
});

api.post('/examples/:id', ah(async (req, res) => {
  const project = await createExampleJob(String(req.params.id), userName(req), userOf(req).id);
  res.json({ project });
}));

api.post('/projects', express.json(), (req, res) => {
  const p = blankProject({
    jobNumber: String(req.body?.jobNumber ?? '').trim().slice(0, 40),
    name: String(req.body?.name ?? '').trim().slice(0, 120) || 'Untitled plaque',
    createdBy: userName(req),
    ownerId: userOf(req).id,
  });
  saveProject(p);
  res.json({ project: p });
});

function projectPayload(p: Project) {
  const concepts = listConcepts(p.id);
  const outputs = listOutputs(p.id);
  let layouts = null;
  if (p.spec) {
    try {
      layouts = PRESETS.map((pr) => {
        const l = layoutFor(p, pr.id);
        // Resolution of each photo at its printed size in this layout, by photo id.
        const ppi: Record<string, number> = {};
        for (const f of l.imageFrames) {
          const v = f.photoId ? photoPpi(p.uploads.photos.find((x) => x.id === f.photoId), f.inner.w) : null;
          if (f.photoId && v != null) ppi[f.photoId] = v;
        }
        return { ...l, photoPpi: ppi };
      });
    } catch (e) {
      layouts = null;
      console.error(e);
    }
  }
  const photoCount = p.spec?.imageOption === 'none' ? 0 : Math.max(1, p.uploads.photos.length);
  return { project: p, concepts, outputs, layouts, autoDescription: p.spec ? autoDescription(p.spec, p.wording, { fontStated: !(p.parse?.assumed ?? []).includes('font'), photoCount, logoCount: p.uploads.logos.length }) : null };
}

api.get('/projects/:id', ah((req, res) => res.json(projectPayload(loadProject(req)))));

api.delete('/projects/:id', ah((req, res) => {
  const p = loadProject(req);
  deleteProject(p.id);
  res.json({ ok: true });
}));

/**
 * Line edits from the wording panel: keep only the fields the layout understands, with the
 * text exactly as sent. A line without text or with an unknown role is a bug, not an order.
 */
export function cleanBlocks(input: unknown): WordingBlock[] {
  if (!Array.isArray(input) || !input.length) throw new Error('The wording needs at least one line.');
  return input.map((raw, i) => {
    const b = (raw ?? {}) as Partial<WordingBlock> & { style?: Partial<TextStyle> };
    if (typeof b.text !== 'string' || !b.text.trim()) throw new Error(`Line ${i + 1} has no text. Delete it or type the customer's words.`);
    if (!ROLES.includes(b.role as WordingRole)) throw new Error(`Line ${i + 1} needs a role (headline, subhead, body or footer).`);
    const block: WordingBlock = { id: typeof b.id === 'string' && b.id ? b.id.slice(0, 40) : `w${i}`, role: b.role as WordingRole, text: b.text };
    const st = b.style && typeof b.style === 'object' ? b.style : null;
    if (st) {
      const style: TextStyle = {};
      for (const k of ['italic', 'bold', 'smallCaps', 'ruleBelow'] as const) if (st[k] === true) style[k] = true;
      if (typeof st.font === 'string' && st.font && st.font !== 'custom') style.font = mustOption('fonts', st.font).id;
      if (Number.isInteger(st.columns) && (st.columns as number) >= 2 && (st.columns as number) <= 4) style.columns = st.columns;
      if (st.align === 'left' || st.align === 'center') style.align = st.align;
      if (typeof st.size === 'number' && st.size >= 0.5 && st.size <= 2.5 && st.size !== 1) style.size = +st.size.toFixed(2);
      if (Object.keys(style).length) block.style = style;
    }
    return block;
  });
}

api.patch('/projects/:id', express.json(), ah((req, res) => {
  const p = loadProject(req);
  const b = req.body ?? {};
  if (typeof b.jobNumber === 'string') p.jobNumber = b.jobNumber.trim().slice(0, 40);
  if (typeof b.name === 'string') p.name = b.name.trim().slice(0, 120);
  if (b.spec) {
    const s = { ...(p.spec ?? b.spec), ...b.spec };
    for (const [k, g] of [['material', 'materials'], ['finish', 'finishes'], ['backgroundColor', 'backgroundColors'], ['backgroundTexture', 'backgroundTextures'], ['border', 'borders'], ['font', 'fonts'], ['imageOption', 'imageOptions'], ['mounting', 'mountings'], ['process', 'processes'], ['logoTreatment', 'logoTreatments']] as const) {
      mustOption(g, s[k]);
    }
    if (s.backgroundColor === 'custom') {
      const cp = s.customPaint ?? { name: 'Custom color', hex: '#1D2B5E' };
      s.customPaint = { name: String(cp.name).slice(0, 60), hex: /^#[0-9a-f]{6}$/i.test(cp.hex) ? cp.hex : '#1D2B5E' };
    }
    if (s.font === 'custom') s.customFontName = String(s.customFontName ?? 'Custom font').slice(0, 80);
    for (const k of ['thicknessIn', 'stakeLengthIn'] as const) s[k] = s[k] == null || s[k] === '' ? null : Number(s[k]) || null;
    const { minIn, maxIn } = getCatalog().sizeLimits;
    for (const d of ['widthIn', 'heightIn'] as const) {
      s[d] = Number(s[d]);
      if (!(s[d] >= minIn && s[d] <= maxIn)) throw new Error(`Sizes must be between ${minIn}" and ${maxIn}".`);
    }
    // A field the designer set by hand is no longer an assumption.
    if (p.parse) p.parse.assumed = p.parse.assumed.filter((f) => !(f in b.spec));
    p.spec = s;
  }
  if (b.wording?.blocks) p.wording = { blocks: cleanBlocks(b.wording.blocks), notes: p.wording?.notes ?? [] };
  if (['auto', 'top', 'middle', 'bottom'].includes(b.logoSlot)) p.logoSlot = b.logoSlot;
  if (b.proofNote === null || typeof b.proofNote === 'string') p.proofNote = b.proofNote ? String(b.proofNote).slice(0, 400) : null;
  if (b.imageAfterBlock === null || Number.isInteger(b.imageAfterBlock)) p.imageAfterBlock = b.imageAfterBlock;
  if (b.proofDescription === null || typeof b.proofDescription === 'string') p.proofDescription = b.proofDescription ? String(b.proofDescription).slice(0, 2000) : null;
  saveProject(p);
  res.json(projectPayload(p));
}));

api.post('/projects/:id/spec', express.json(), ah((req, res) => {
  const p = loadProject(req);
  p.specText = String(req.body?.specText ?? '');
  p.parse = parseSpec(p.specText, { hasPhoto: p.uploads.photos.length > 0 });
  p.spec = p.parse.spec;
  saveProject(p);
  res.json(projectPayload(p));
}));

api.post('/projects/:id/wording', upload.single('file'), ah(async (req, res) => {
  const p = loadProject(req);
  let text = String(req.body?.text ?? '');
  if (req.file) {
    if (!/\.docx$/i.test(req.file.originalname)) throw new Error('Wording files must be Word .docx files. For anything else, paste the text.');
    text = await docxToText(req.file.buffer);
  }
  p.wordingText = text;
  p.wording = parseWording(text);
  saveProject(p);
  res.json(projectPayload(p));
}));

const uploadKind = (req: Request): UploadKind => {
  const kind = String(req.params.kind) as UploadKind;
  if (!UPLOAD_KINDS.includes(kind)) throw new Error('Unknown upload type.');
  return kind;
};

// One file per request (the browser sends several one after another): each upload is held
// in memory once, and every file gets its own answer.
api.post('/projects/:id/upload/:kind', upload.single('file'), ah(async (req, res) => {
  const kind = uploadKind(req);
  if (!req.file) throw new Error('No file received.');
  const name = req.file.originalname;
  if (/\.(pdf|ai|eps)$/i.test(name) && !hasPoppler) throw new Error(`${name}: PDF/.ai files cannot be read on this computer. Upload a PNG, JPG or SVG.`);
  // Refuse a full list or a repeated file before the slow part.
  checkCanAdd(loadProject(req), kind, name, fileHash(req.file.buffer));
  const prepared = await prepareUpload(String(req.params.id), kind, name, req.file.buffer);
  // Reading a big file takes a while; add it to the job as it is now, so files uploaded at
  // the same time (or a change made meanwhile in another panel) are all kept.
  let p = addUpload(loadProject(req), prepared);
  // A photo makes "no image" unlikely: re-read the spec with that hint.
  if (kind === 'photo' && p.specText && p.parse?.assumed.includes('imageOption')) {
    const fresh = parseSpec(p.specText, { hasPhoto: true });
    p = { ...p, parse: fresh, spec: { ...(p.spec ?? fresh.spec), imageOption: fresh.spec.imageOption } };
  }
  saveProject(p);
  res.json(projectPayload(p));
}));

// Placement belongs to the uploaded logo and is frozen with each concept's uploads.
api.patch('/projects/:id/upload/logo/:fileId/placement', express.json(), ah((req, res) => {
  const p = loadProject(req);
  const position = mustOption('logoPositions', req.body?.position).id as import('../shared/types.js').LogoPosition;
  const logo = p.uploads.logos.find((l) => l.id === req.params.fileId);
  if (!logo) return res.status(404).json({ error: 'That logo was not found in this job.' });
  p.uploads.logos = p.uploads.logos.map((l) => l.id === logo.id ? { ...l, position } : l);
  saveProject(p);
  res.json(projectPayload(p));
}));

// Removing a file takes it off the job; the stored file stays for older versions that used it.
const removeHandler = ah((req, res) => {
  const p = removeUpload(loadProject(req), uploadKind(req), req.params.fileId ? String(req.params.fileId) : undefined);
  saveProject(p);
  res.json(projectPayload(p));
});
api.delete('/projects/:id/upload/:kind', removeHandler);
api.delete('/projects/:id/upload/:kind/:fileId', removeHandler);

/** New left-to-right order of the photos, logos or sketches: { ids: [...] }. */
api.put('/projects/:id/upload/:kind/order', express.json(), ah((req, res) => {
  const kind = uploadKind(req);
  if (!isMultiKind(kind)) throw new Error('Only photos, logos and sketches have an order.');
  const p = reorderUploads(loadProject(req), kind, req.body?.ids);
  saveProject(p);
  res.json(projectPayload(p));
}));

const fileHandler = ah((req, res) => {
  const p = loadProject(req);
  const f = uploadPath(p, uploadKind(req), req.params.fileId ? String(req.params.fileId) : undefined);
  if (!f || !fs.existsSync(f)) return res.status(404).end();
  // Stored files never change (a new upload gets a new id), so the browser may keep them.
  res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
  res.sendFile(f);
});
api.get('/projects/:id/files/:kind', fileHandler);
api.get('/projects/:id/files/:kind/:fileId', fileHandler);

api.get('/projects/:id/layout/:preset', ah(async (req, res) => {
  const p = loadProject(req);
  const layout = layoutFor(p, String(req.params.preset) as LayoutPresetId);
  const { w, h } = canvasSize(p.spec!.widthIn, p.spec!.heightIn, 900);
  const png = await layoutDrawing(p, layout, w, h);
  res.type('png').send(png);
}));

// ---------- Generation (streamed as Server-Sent Events) ----------
function sse(res: Response) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  const send = (obj: unknown) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
  const ping = setInterval(() => res.write(': keep-alive\n\n'), 15_000);
  return { send, end: () => { clearInterval(ping); res.end(); } };
}

function events(send: (o: unknown) => void): ConceptEvents {
  return {
    onUpdate: (c) => send({ type: 'concept', concept: c }),
    onPartial: (id, jpg) => send({ type: 'partial', conceptId: id, image: `data:image/jpeg;base64,${jpg.toString('base64')}` }),
  };
}

async function runStreamed(res: Response, project: Project, records: ConceptRecord[], plan?: InstructionPlan) {
  const s = sse(res);
  if (plan) s.send({ type: 'plan', plan });
  s.send({ type: 'start', concepts: records });
  await Promise.all(records.map((r) => runConcept(project, r, events(s.send))));
  s.send({ type: 'end' });
  s.end();
}

api.post('/projects/:id/generate', genLimiter, express.json(), ah(async (req, res) => {
  const p = loadProject(req);
  if (!p.spec) throw new Error('Confirm the plaque specification first.');
  if (!p.wording?.blocks.length) throw new Error('Add the customer wording first.');
  if (p.spec.imageOption !== 'none' && !p.uploads.photos.length) throw new Error(`The spec calls for ${mustOption('imageOptions', p.spec.imageOption).label}, but no photo is uploaded.`);
  const batchId = newId('b');
  const presets: LayoutPresetId[] = Array.isArray(req.body?.presets) && req.body.presets.length ? req.body.presets : PRESETS.map((x) => x.id);
  const records = presets.map((preset) => newConceptRecord(p, { preset, kind: 'concept', batchId }));
  await runStreamed(res, p, records);
}));

api.post('/concepts/:id/regenerate', genLimiter, express.json(), ah(async (req, res) => {
  const found = loadConcept(req);
  if (!found) throw new Error('Concept not found.');
  const { c, p } = found;
  const rec = newConceptRecord(p, { preset: c.preset, kind: 'regenerate', batchId: c.batchId, parentId: c.id });
  await runStreamed(res, p, [rec]);
}));

api.post('/concepts/:id/fix', genLimiter, express.json(), ah(async (req, res) => {
  const found = loadConcept(req);
  if (!found) throw new Error('Concept not found.');
  const { c, p } = found;
  const instruction = String(req.body?.instruction ?? '').trim();
  if (instruction.length < 3) throw new Error('Describe the change, for example "make the border thinner".');
  if (instruction.length > 1000) throw new Error('Keep the change to 1000 characters or fewer.');
  const source = projectForConcept(p, c);
  const plan = await planInstruction(source, c, instruction);
  if (plan.kind === 'refuse') return res.status(422).json({ error: plan.reason, nearestOptions: plan.nearestOptions });
  // Planning can take time: do not overwrite an order changed in another tab.
  if (getProject(p.id)?.updatedAt !== p.updatedAt) return res.status(409).json({ error: 'The order changed while this instruction was being read. Reload and try again.' });
  if (listConcepts(p.id).some((v) => v.status === 'queued' || v.status === 'running')) return res.status(409).json({ error: 'Wait for this job’s images to finish before editing it.' });
  if (!c.hasImage) throw new Error('Wait for a finished image before editing it.');
  checkLimits(p.id);
  // Order changes (catalog, wording, layout) go through the layout so the proof and vector
  // file follow. Catalog changes regenerate with the new swatches; wording and layout changes
  // edit the current picture to the new layout drawing; image-only changes edit it in place.
  const structural = changesOrder(plan);
  const previous = structural ? contentSnapshot(p) : undefined;
  // Plan and draw from the selected version, including when its order is older.
  // Image-only edits leave the live order alone; structural edits publish this snapshot.
  const base = source;
  applyPlan(base, plan, c.preset);
  if (!base.wording?.blocks.length) throw new Error('Add the customer wording first.');
  if (base.spec?.imageOption !== 'none' && !base.uploads.photos.length) throw new Error('Upload the photo before requesting this image treatment.');
  // Validate the changed layout before saving any order change.
  layoutFor(base, c.preset);
  if (previous) base.selectedConceptId = null;
  // Every Fix edits the selected photograph, including catalog changes. New concepts
  // alone use the current model/defaults; edits inherit the source version's settings.
  const rec = newConceptRecord(base, { preset: c.preset, kind: 'fix', batchId: c.batchId, parentId: c.id, note: plan.restated, instruction, model: c.model === 'mock' ? (config.mockAI ? 'mock' : config.imageModel) : c.model || config.imageModel, quality: 'max', plan, previous });
  db.transaction(() => { if (previous) saveProject(base); saveConcept(rec); })();
  await runStreamed(res, base, [rec], plan);
}));

api.post('/concepts/:id/undo', express.json(), ah((req, res) => {
  const found = loadConcept(req);
  if (!found) throw new Error('Concept not found.');
  const { c, p } = found;
  if (!c.previous || !c.plan || !changesOrder(c.plan)) return res.status(422).json({ error: 'This version has no order change to undo.' });
  if (listConcepts(p.id).some((v) => v.status === 'queued' || v.status === 'running')) return res.status(409).json({ error: 'Wait for this job’s images to finish before undoing.' });
  if (c.snapshot && !matchesSnapshot(p, c.snapshot)) {
    return res.status(409).json({ error: 'The order has changed since this version. Use this version first, then undo its change.' });
  }
  Object.assign(p, structuredClone(c.previous));
  const parent = c.parentId ? getConcept(c.parentId) : null;
  p.selectedConceptId = parent?.hasImage ? parent.id : null;
  saveProject(p);
  res.json(projectPayload(p));
}));

api.get('/concepts/:id/:file', ah((req, res) => {
  const c = loadConcept(req)?.c;
  const name = String(req.params.file);
  if (!c || !['image.png', 'raw.png', 'layout.png', 'preview.jpg'].includes(name)) return res.status(404).end();
  const f = conceptFile(c, name as 'image.png');
  if (!fs.existsSync(f)) return res.status(404).end();
  res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
  if (req.query.download) res.attachment(`${c.id}-${name}`);
  res.sendFile(f);
}));

api.post('/projects/:id/select', express.json(), ah((req, res) => {
  const p = loadProject(req);
  const c = getConcept(String(req.body?.conceptId ?? ''));
  if (!c || c.projectId !== p.id || !c.hasImage) throw new Error('Pick a finished image.');
  if (listConcepts(p.id).some((v) => v.status === 'queued' || v.status === 'running')) throw new Error('Wait for this job’s images to finish before selecting a version.');
  if (c.snapshot) Object.assign(p, structuredClone(c.snapshot));
  p.selectedConceptId = c.id;
  p.proofConceptIds = [c.id];
  saveProject(p);
  res.json(projectPayload(p));
}));

/**
 * Which images go on the customer proof. `{ conceptId, on }` adds or removes one image and
 * `{ order }` puts the current ones in a new page order. Adding the first image brings the order
 * to that image (like "Use this version"); adding more leaves the order alone.
 */
api.post('/projects/:id/proof-set', express.json(), ah((req, res) => {
  const p = loadProject(req);
  const ids = p.proofConceptIds.filter((id) => getConcept(id)?.projectId === p.id);
  if (Array.isArray(req.body?.order)) {
    const order = (req.body.order as unknown[]).map(String);
    if (order.length !== ids.length || !ids.every((id) => order.includes(id))) throw new Error('That page order does not match the images on the proof.');
    p.proofConceptIds = order;
    saveProject(p);
    return res.json(projectPayload(p));
  }
  const c = getConcept(String(req.body?.conceptId ?? ''));
  if (!c || c.projectId !== p.id) throw new Error('That image is not in this job.');
  if (req.body?.on === false) {
    p.proofConceptIds = ids.filter((id) => id !== c.id);
    if (p.selectedConceptId === c.id) p.selectedConceptId = p.proofConceptIds[0] ?? null;
  } else if (!ids.includes(c.id)) {
    if (!c.hasImage) throw new Error('Pick a finished image.');
    if (ids.length >= MAX_PROOF_PAGES) throw new Error(`A proof holds up to ${MAX_PROOF_PAGES} pages. Take one off first.`);
    if (!ids.length) {
      if (listConcepts(p.id).some((v) => v.status === 'queued' || v.status === 'running')) throw new Error('Wait for this job’s images to finish before selecting a version.');
      if (c.snapshot) Object.assign(p, structuredClone(c.snapshot));
      p.selectedConceptId = c.id;
    }
    p.proofConceptIds = [...ids, c.id];
  }
  saveProject(p);
  res.json(projectPayload(p));
}));

// ---------- Outputs ----------
/** Each logo box's file, name and source type, for tracing into the production file. */
function productionLogos(p: Project, layout: PlaqueLayout): ProductionLogo[] {
  const files = layoutFiles(p, layout).logos;
  return layout.logos.map((box, i) => {
    const u = p.uploads.logos.find((l) => l.id === box.logoId);
    return { png: files[i] ? fs.readFileSync(files[i]!) : null, name: u?.name ?? '', fromVector: !!u?.vectorSource };
  });
}

const presetLabel = (id: LayoutPresetId) => PRESETS.find((x) => x.id === id)?.label ?? id;

/** The layout an output was made from (older records only name the concept). */
function outputPreset(o: OutputRecord): LayoutPresetId | null {
  return o.preset ?? (o.conceptId ? getConcept(o.conceptId)?.preset ?? null : null);
}

/** The layout of each page of a proof (one for a single-image file). */
function outputPresets(o: OutputRecord): LayoutPresetId[] {
  if (o.presets?.length) return o.presets;
  const one = outputPreset(o);
  return one ? [one] : [];
}

function outputFile(o: OutputRecord) {
  return path.join(projectDir(o.projectId, 'outputs'), `${o.id}.pdf`);
}

function pdfPreview(pdf: string, dpi: number, page = 1): Buffer | null {
  if (!hasPoppler) return null;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pps-'));
  try {
    execFileSync('pdftocairo', ['-png', '-singlefile', '-f', String(page), '-l', String(page), '-r', String(dpi), pdf, path.join(tmp, 'p')], { timeout: 60_000 });
    return fs.readFileSync(path.join(tmp, 'p.png'));
  } catch {
    return null;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

api.post('/projects/:id/proof', express.json(), ah(async (req, res) => {
  const base = loadProject(req);
  // One page per image, in the order given: the request, else the images set for the proof.
  const asked: unknown[] = Array.isArray(req.body?.conceptIds) ? req.body.conceptIds
    : req.body?.conceptId ? [req.body.conceptId]
    : base.proofConceptIds.length ? base.proofConceptIds : [base.selectedConceptId];
  const ids = [...new Set(asked.map((id) => String(id ?? '')))];
  if (!ids.length || ids.length > MAX_PROOF_PAGES) throw new Error(`A proof holds 1 to ${MAX_PROOF_PAGES} images.`);
  const concepts = ids.map((id) => getConcept(id));
  if (concepts.some((c) => !c || c.projectId !== base.id || !c.hasImage)) throw new Error('Select one of the generated images first.');
  const pages = concepts as ConceptRecord[];

  // Every image is checked before anything is made; the designer confirms them all at once.
  const unchecked = pages.map((c, i) => ({ c, page: i + 1 })).filter(({ c }) => !c.spellcheck?.ok || (!config.mockAI && !c.spellcheck.checked));
  if (unchecked.length && req.body?.acknowledged !== true) {
    const many = pages.length > 1;
    const where = (c: ConceptRecord, page: number) => (many ? `Page ${page} (${presetLabel(c.preset)}): ` : '');
    return res.status(409).json({
      error: unchecked.length > 1 ? `${unchecked.length} of the images have wording that was not confirmed by the spelling check.`
        : unchecked[0]!.c.spellcheck?.checked ? `${many ? `Page ${unchecked[0]!.page} (${presetLabel(unchecked[0]!.c.preset)}): the` : 'The'} spelling check found wording differences in this image.`
        : `${many ? `Page ${unchecked[0]!.page} (${presetLabel(unchecked[0]!.c.preset)}): this` : 'This'} image has not completed a spelling check. Proofread it before confirming.`,
      differences: unchecked.flatMap(({ c, page }) => (c.spellcheck?.differences ?? []).map((d) => ({ ...d, where: many ? where(c, page).slice(0, -2) : undefined }))),
    });
  }

  // Each page is built from its own image's frozen content. The order and the selection are
  // left as they are, so any image can be proofed without choosing it first.
  const earlier = listOutputs(base.id).filter((x) => x.kind === 'proof');
  const used = new Map<LayoutPresetId, number>();
  const buffers: Buffer[] = [];
  for (const c of pages) {
    const p = projectForConcept(base, c);
    const layout = layoutFor(p, c.preset);
    // Versions count per layout: three proofs of three layouts are three options, not v1-v3.
    const version = earlier.filter((x) => outputPresets(x).includes(c.preset)).length + (used.get(c.preset) ?? 0) + 1;
    used.set(c.preset, (used.get(c.preset) ?? 0) + 1);
    buffers.push(await buildProof('description', {
      jobNumber: p.jobNumber || 'draft',
      version,
      spec: p.spec!,
      wording: p.wording,
      layout,
      plaqueImage: fs.readFileSync(conceptFile(c, 'image.png')),
      proofNote: p.proofNote,
      description: p.proofDescription,
      fontStated: !(p.parse?.assumed ?? []).includes('font'),
    }));
  }
  const pdf = await mergeProofs(buffers);
  const labels = pages.map((c) => presetLabel(c.preset));
  const version = Math.max(...pages.map((c) => earlier.filter((x) => outputPresets(x).includes(c.preset)).length + 1));
  const fileName = `Proof - ${base.jobNumber || 'draft'} - ${labels.join(' + ')}${version > 1 ? ` v${version}` : ''}.pdf`;
  const o: OutputRecord = {
    id: newId('o'), projectId: base.id, kind: 'proof', conceptId: pages[0]!.id, preset: pages[0]!.preset,
    ...(pages.length > 1 ? { conceptIds: pages.map((c) => c.id), presets: pages.map((c) => c.preset) } : {}),
    fileName, preflight: null, createdAt: now(),
  };
  fs.writeFileSync(outputFile(o), pdf);
  saveOutput(o);
  res.json({ output: o, ...projectPayload(base) });
}));

api.post('/projects/:id/production', express.json(), ah(async (req, res) => {
  let p = loadProject(req);
  const asked = req.body?.conceptId;
  const c = getConcept(String(asked ?? p.selectedConceptId ?? ''));
  // A concept that was asked for by name must exist: never fall back to another layout.
  if ((asked && !c) || (c && c.projectId !== p.id)) throw new Error('That concept was not found in this job.');
  if (c) p = projectForConcept(p, c);
  if (!p.spec || !p.wording?.blocks.length) throw new Error('Read the specification and add the customer wording first.');
  const preset = c?.preset ?? (PRESETS.some((x) => x.id === req.body?.preset) ? req.body.preset as LayoutPresetId : 'classic');
  const layout = layoutFor(p, preset);
  const logos = productionLogos(p, layout);
  const result = await buildProductionPdf({
    jobNumber: p.jobNumber || 'draft', name: p.name, spec: p.spec!, layout, logos,
    customFontFile: uploadPath(p, 'font'),
  });
  const checks = await preflight(result.pdf, layout, { logosTraced: logos.filter((l) => l.png).length, fontLicensed: resolveFont(p.spec!.font, {}, uploadPath(p, 'font')).licensed, logoTreatment: p.spec!.logoTreatment });
  // The layout name keeps the vector files of the three concepts apart once downloaded.
  const fileName = result.fileName.replace(/_production\.pdf$/, `_${presetLabel(preset).replace(/\s+/g, '_')}_production.pdf`);
  const o: OutputRecord = { id: newId('o'), projectId: p.id, kind: 'production', conceptId: c?.id ?? null, preset, fileName, preflight: checks, createdAt: now() };
  fs.writeFileSync(outputFile(o), result.pdf);
  saveOutput(o);
  res.json({ output: o, notes: result.notes, ...projectPayload(p) });
}));

api.get('/outputs/:id/download', ah((req, res) => {
  const o = loadOutput(req);
  if (!o) return res.status(404).end();
  if (req.query.inline) {
    res.type('application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${o.fileName.replace(/"/g, '')}"`);
    return res.sendFile(outputFile(o));
  }
  res.download(outputFile(o), o.fileName);
}));

api.get('/outputs/:id/preview.png', ah(async (req, res) => {
  const o = loadOutput(req);
  if (!o) return res.status(404).end();
  // Page 1 keeps the old file name, so previews already made stay valid.
  const pageCount = o.conceptIds?.length ?? 1;
  const page = Math.min(pageCount, Math.max(1, Math.floor(Number(req.query.page)) || 1));
  const cache = outputFile(o).replace(/\.pdf$/, page > 1 ? `-p${page}.png` : '.png');
  if (!fs.existsSync(cache)) {
    const png = pdfPreview(outputFile(o), o.kind === 'proof' ? 110 : 40, page);
    if (!png) return res.status(404).json({ error: 'Preview not available on this computer.' });
    fs.writeFileSync(cache, await sharp(png).png().toBuffer());
  }
  res.sendFile(cache);
}));

// ---------- Errors from middleware (file uploads, JSON bodies) ----------
// Multer and express.json() reject before a handler runs; without this the browser would get
// Express's HTML error page and the app would only say "Request failed".
api.use((err: Error & { code?: string; type?: string; status?: number }, _req: Request, res: Response, next: express.NextFunction) => {
  if (res.headersSent) return next(err);
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: `That file is larger than ${UPLOAD_LIMIT_MB} MB. Export a smaller copy and try again.` });
  if (err instanceof multer.MulterError) return res.status(400).json({ error: 'The upload did not arrive. Try again.' });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'The request was not valid JSON.' });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'That request is too large.' });
  console.error(err);
  res.status(err.status && err.status >= 400 && err.status < 600 ? err.status : 500).json({ error: 'Something went wrong on the server. Try again, and tell the developer if it keeps happening.' });
});
