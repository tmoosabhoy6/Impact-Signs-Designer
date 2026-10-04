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
import { checkPassword, clearSession, issueSession, requireAuth, sessionUser } from './auth.js';
import {
  deleteProject, getConcept, getOutput, getProject, listConcepts, listOutputs, listProjects,
  newId, now, projectDir, saveOutput, saveProject, spentToday,
} from './db.js';
import { parseSpec } from './parse/spec.js';
import { docxToText, parseWording } from './parse/wording.js';
import { storeUpload, uploadPath, photoPpi, type UploadKind } from './uploads.js';
import { PRESETS } from './layout/engine.js';
import { createExampleJob, listExamples } from './examples.js';
import { conceptFile, layoutDrawing, layoutFor, newConceptRecord, runConcept, type ConceptEvents } from './ai/pipeline.js';
import { canvasSize, friendlyError, openai, testImage } from './ai/images.js';
import { PROMPT_FILES, promptVersion, readPrompt } from './ai/prompts.js';
import { buildProofPdf } from './pdf/proof.js';
import { buildProductionPdf } from './pdf/production.js';
import { preflight } from './pdf/preflight.js';
import { resolveFont } from './text/fonts.js';
import type { ConceptRecord, LayoutPresetId, OutputRecord, Project } from '../shared/types.js';

export const api = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 60 * 1024 * 1024 } });
const genLimiter = rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many generations in a minute. Please wait a moment.' } });

const ah =
  (fn: (req: Request, res: Response) => Promise<unknown> | unknown) =>
  (req: Request, res: Response) =>
    Promise.resolve(fn(req, res)).catch((e: Error) => {
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

function loadProject(req: Request): Project {
  const p = getProject(String(req.params.id));
  if (!p) throw new Error('Job not found.');
  return p;
}

const userName = (req: Request) => (req as Request & { user?: { name: string } }).user?.name ?? 'Designer';

// ---------- Session ----------
api.post('/login', express.json(), (req, res) => {
  const { password = '', name = '' } = req.body ?? {};
  if (!checkPassword(String(password))) return res.status(401).json({ error: 'That password is not right.' });
  issueSession(res, String(name).trim().slice(0, 60) || 'Designer');
  res.json({ ok: true });
});
api.post('/logout', (_req, res) => {
  clearSession(res);
  res.json({ ok: true });
});
api.get('/me', (req, res) => {
  const user = sessionUser(req);
  res.json({ user, passwordRequired: !!config.appPassword, mock: config.mockAI });
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

// ---------- Projects ----------
api.get('/projects', (_req, res) => {
  res.json({
    projects: listProjects().map((p) => ({
      id: p.id, jobNumber: p.jobNumber, name: p.name, updatedAt: p.updatedAt, createdBy: p.createdBy,
      size: p.spec ? `${p.spec.widthIn}" x ${p.spec.heightIn}"` : '',
      thumb: p.selectedConceptId,
    })),
  });
});

api.get('/examples', (_req, res) => {
  res.json({ examples: listExamples().map(({ id, jobNumber, name, description, proofStyle }) => ({ id, jobNumber, name, description, proofStyle })) });
});

api.post('/examples/:id', ah(async (req, res) => {
  const project = await createExampleJob(String(req.params.id), userName(req));
  res.json({ project });
}));

api.post('/projects', express.json(), (req, res) => {
  const t = now();
  const p: Project = {
    id: newId('p'),
    jobNumber: String(req.body?.jobNumber ?? '').trim().slice(0, 40),
    name: String(req.body?.name ?? '').trim().slice(0, 120) || 'Untitled plaque',
    specText: '', parse: null, spec: null, wordingText: '', wording: null, uploads: {},
    selectedConceptId: null, logoSlot: 'auto', proofStyle: 'standard', proofDescription: null, createdBy: userName(req), createdAt: t, updatedAt: t,
  };
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
        return { ...l, photoPpi: l.imageFrame ? photoPpi(p, l.imageFrame.inner.w) : null };
      });
    } catch (e) {
      layouts = null;
      console.error(e);
    }
  }
  return { project: p, concepts, outputs, layouts };
}

api.get('/projects/:id', ah((req, res) => res.json(projectPayload(loadProject(req)))));

api.delete('/projects/:id', ah((req, res) => {
  const p = loadProject(req);
  deleteProject(p.id);
  res.json({ ok: true });
}));

api.patch('/projects/:id', express.json(), ah((req, res) => {
  const p = loadProject(req);
  const b = req.body ?? {};
  if (typeof b.jobNumber === 'string') p.jobNumber = b.jobNumber.trim().slice(0, 40);
  if (typeof b.name === 'string') p.name = b.name.trim().slice(0, 120);
  if (b.spec) {
    const s = { ...(p.spec ?? b.spec), ...b.spec };
    for (const [k, g] of [['finish', 'finishes'], ['backgroundColor', 'backgroundColors'], ['backgroundTexture', 'backgroundTextures'], ['border', 'borders'], ['font', 'fonts'], ['imageOption', 'imageOptions'], ['mounting', 'mountings'], ['process', 'processes']] as const) {
      mustOption(g, s[k]);
    }
    const { minIn, maxIn } = getCatalog().sizeLimits;
    for (const d of ['widthIn', 'heightIn'] as const) {
      s[d] = Number(s[d]);
      if (!(s[d] >= minIn && s[d] <= maxIn)) throw new Error(`Sizes must be between ${minIn}" and ${maxIn}".`);
    }
    // A field the designer set by hand is no longer an assumption.
    if (p.parse) p.parse.assumed = p.parse.assumed.filter((f) => !(f in b.spec));
    p.spec = s;
  }
  if (b.wording?.blocks) p.wording = { blocks: b.wording.blocks, notes: p.wording?.notes ?? [] };
  if (['auto', 'top', 'middle', 'bottom'].includes(b.logoSlot)) p.logoSlot = b.logoSlot;
  if (['standard', 'description', 'etched'].includes(b.proofStyle)) p.proofStyle = b.proofStyle;
  if (b.proofDescription === null || typeof b.proofDescription === 'string') p.proofDescription = b.proofDescription ? String(b.proofDescription).slice(0, 2000) : null;
  saveProject(p);
  res.json(projectPayload(p));
}));

api.post('/projects/:id/spec', express.json(), ah((req, res) => {
  const p = loadProject(req);
  p.specText = String(req.body?.specText ?? '');
  p.parse = parseSpec(p.specText, { hasPhoto: !!p.uploads.photo });
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

api.post('/projects/:id/upload/:kind', upload.single('file'), ah(async (req, res) => {
  let p = loadProject(req);
  const kind = String(req.params.kind) as UploadKind;
  if (!['photo', 'logo', 'sketch'].includes(kind)) throw new Error('Unknown upload type.');
  if (!req.file) throw new Error('No file received.');
  if (/\.(pdf|ai|eps)$/i.test(req.file.originalname) && !hasPoppler) throw new Error('PDF/.ai files cannot be read on this computer. Upload a PNG, JPG or SVG.');
  p = await storeUpload(p, kind, req.file.originalname, req.file.buffer);
  // A photo makes "no image" unlikely: re-read the spec with that hint.
  if (kind === 'photo' && p.specText && p.parse?.assumed.includes('imageOption')) {
    const fresh = parseSpec(p.specText, { hasPhoto: true });
    p.parse = fresh;
    p.spec = { ...(p.spec ?? fresh.spec), imageOption: fresh.spec.imageOption };
  }
  saveProject(p);
  res.json(projectPayload(p));
}));

api.delete('/projects/:id/upload/:kind', ah((req, res) => {
  const p = loadProject(req);
  delete p.uploads[String(req.params.kind) as UploadKind];
  saveProject(p);
  res.json(projectPayload(p));
}));

api.get('/projects/:id/files/:kind', ah((req, res) => {
  const p = loadProject(req);
  const f = uploadPath(p, String(req.params.kind) as UploadKind);
  if (!f || !fs.existsSync(f)) return res.status(404).end();
  res.sendFile(f);
}));

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

async function runStreamed(res: Response, project: Project, records: ConceptRecord[], quality?: string) {
  const s = sse(res);
  s.send({ type: 'start', concepts: records });
  await Promise.all(records.map((r) => runConcept(project, r, events(s.send), { quality })));
  s.send({ type: 'end' });
  s.end();
}

const QUALITIES = ['low', 'medium', 'high', 'xhigh', 'max'];
const pickQuality = (q: unknown) => (typeof q === 'string' && QUALITIES.includes(q) ? q : undefined);

api.post('/projects/:id/generate', genLimiter, express.json(), ah(async (req, res) => {
  const p = loadProject(req);
  if (!p.spec) throw new Error('Confirm the plaque specification first.');
  if (!p.wording?.blocks.length) throw new Error('Add the customer wording first.');
  if (p.spec.imageOption !== 'none' && !p.uploads.photo) throw new Error(`The spec calls for ${mustOption('imageOptions', p.spec.imageOption).label}, but no photo is uploaded.`);
  const batchId = newId('b');
  const presets: LayoutPresetId[] = Array.isArray(req.body?.presets) && req.body.presets.length ? req.body.presets : PRESETS.map((x) => x.id);
  const records = presets.map((preset) => newConceptRecord(p, { preset, kind: 'concept', batchId }));
  await runStreamed(res, p, records, pickQuality(req.body?.quality));
}));

api.post('/concepts/:id/regenerate', genLimiter, express.json(), ah(async (req, res) => {
  const c = getConcept(String(req.params.id));
  if (!c) throw new Error('Concept not found.');
  const p = getProject(c.projectId)!;
  const rec = newConceptRecord(p, { preset: c.preset, kind: 'regenerate', batchId: c.batchId, parentId: c.id });
  await runStreamed(res, p, [rec], pickQuality(req.body?.quality));
}));

api.post('/concepts/:id/fix', genLimiter, express.json(), ah(async (req, res) => {
  const c = getConcept(String(req.params.id));
  if (!c) throw new Error('Concept not found.');
  const instruction = String(req.body?.instruction ?? '').trim();
  if (instruction.length < 3) throw new Error('Describe the change, for example "make the border thinner".');
  const p = getProject(c.projectId)!;
  const rec = newConceptRecord(p, { preset: c.preset, kind: 'fix', batchId: c.batchId, parentId: c.id, note: instruction.slice(0, 500) });
  await runStreamed(res, p, [rec], pickQuality(req.body?.quality));
}));

api.get('/concepts/:id/:file', ah((req, res) => {
  const c = getConcept(String(req.params.id));
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
  p.selectedConceptId = c.id;
  saveProject(p);
  res.json(projectPayload(p));
}));

// ---------- Outputs ----------
function outputFile(o: OutputRecord) {
  return path.join(projectDir(o.projectId, 'outputs'), `${o.id}.pdf`);
}

function pdfPreview(pdf: string, dpi: number): Buffer | null {
  if (!hasPoppler) return null;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pps-'));
  try {
    execFileSync('pdftocairo', ['-png', '-singlefile', '-r', String(dpi), pdf, path.join(tmp, 'p')], { timeout: 60_000 });
    return fs.readFileSync(path.join(tmp, 'p.png'));
  } catch {
    return null;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

api.post('/projects/:id/proof', express.json(), ah(async (req, res) => {
  const p = loadProject(req);
  const c = getConcept(String(req.body?.conceptId ?? p.selectedConceptId ?? ''));
  if (!c || c.projectId !== p.id || !c.hasImage) throw new Error('Select one of the generated images first.');
  if (c.spellcheck && !c.spellcheck.ok && !req.body?.acknowledged) {
    return res.status(409).json({ error: 'The spelling check found wording differences in this image.', differences: c.spellcheck.differences });
  }
  p.selectedConceptId = c.id;
  saveProject(p);
  const pdf = await buildProofPdf({ jobNumber: p.jobNumber || 'draft', spec: p.spec!, plaqueImage: fs.readFileSync(conceptFile(c, 'image.png')) });
  const o: OutputRecord = { id: newId('o'), projectId: p.id, kind: 'proof', conceptId: c.id, fileName: `Proof - ${p.jobNumber || 'draft'}.pdf`, preflight: null, createdAt: now() };
  fs.writeFileSync(outputFile(o), pdf);
  saveOutput(o);
  res.json({ output: o, ...projectPayload(p) });
}));

api.post('/projects/:id/production', express.json(), ah(async (req, res) => {
  const p = loadProject(req);
  const c = getConcept(String(req.body?.conceptId ?? p.selectedConceptId ?? ''));
  const preset = (c?.preset ?? req.body?.preset ?? 'classic') as LayoutPresetId;
  const layout = layoutFor(p, preset);
  const logoFile = uploadPath(p, 'logo');
  const logoPng = layout.logo && logoFile ? fs.readFileSync(logoFile) : null;
  const result = await buildProductionPdf({
    jobNumber: p.jobNumber || 'draft', name: p.name, spec: p.spec!, layout, logoPng, logoFromVector: p.uploads.logo?.vectorSource,
  });
  const checks = await preflight(result.pdf, layout, { logoTraced: !!logoPng, fontLicensed: resolveFont(p.spec!.font).licensed });
  const o: OutputRecord = { id: newId('o'), projectId: p.id, kind: 'production', conceptId: c?.id ?? null, fileName: result.fileName, preflight: checks, createdAt: now() };
  fs.writeFileSync(outputFile(o), result.pdf);
  saveOutput(o);
  res.json({ output: o, notes: result.notes, ...projectPayload(p) });
}));

api.get('/outputs/:id/download', ah((req, res) => {
  const o = getOutput(String(req.params.id));
  if (!o) return res.status(404).end();
  if (req.query.inline) {
    res.type('application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${o.fileName.replace(/"/g, '')}"`);
    return res.sendFile(outputFile(o));
  }
  res.download(outputFile(o), o.fileName);
}));

api.get('/outputs/:id/preview.png', ah(async (req, res) => {
  const o = getOutput(String(req.params.id));
  if (!o) return res.status(404).end();
  const cache = outputFile(o).replace(/\.pdf$/, '.png');
  if (!fs.existsSync(cache)) {
    const png = pdfPreview(outputFile(o), o.kind === 'proof' ? 110 : 40);
    if (!png) return res.status(404).json({ error: 'Preview not available on this computer.' });
    fs.writeFileSync(cache, await sharp(png).png().toBuffer());
  }
  res.sendFile(cache);
}));
