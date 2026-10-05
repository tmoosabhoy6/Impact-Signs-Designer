// Example jobs built from references/<job>/example.json. Not shown in the app; used by
// the tests, `npm run samples` and the verification scripts (POST /api/examples/:id).
import fs from 'node:fs';
import path from 'node:path';
import { fromRoot } from './config.js';
import { blankProject, saveProject } from './db.js';
import { parseSpec } from './parse/spec.js';
import { docxToText, parseWording } from './parse/wording.js';
import { storeUpload } from './uploads.js';
import type { Project, WordingBlock } from '../shared/types.js';

export interface ExampleManifest {
  id: string;
  jobNumber: string;
  name: string;
  description: string;
  spec: string;
  wording: string;
  /** One file, or several in plaque order. */
  photo?: string | string[];
  logo?: string | string[];
  sketch?: string | string[];
  proofStyle?: Project['proofStyle'];
  /** Optional per-line overrides (role / style) applied after parsing the wording. */
  lines?: Partial<Pick<WordingBlock, 'role' | 'style'>>[];
  logoSlot?: Project['logoSlot'];
  visualScale?: Project['visualScale'];
  imageAfterBlock?: number;
  proofNote?: string;
  disclaimer?: Project['disclaimer'];
  sitePhoto?: string;
  siteMountHeightIn?: number;
  specOverrides?: { widthIn?: number; heightIn?: number; customPaintHex?: string };
}

export function listExamples(): (ExampleManifest & { dir: string })[] {
  const root = fromRoot('references');
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root)
    .map((d) => path.join(root, d, 'example.json'))
    .filter((f) => fs.existsSync(f))
    .map((f) => ({ ...(JSON.parse(fs.readFileSync(f, 'utf8')) as ExampleManifest), dir: path.dirname(f) }))
    .sort((a, b) => a.jobNumber.localeCompare(b.jobNumber));
}

export async function createExampleJob(exampleId: string, createdBy: string, ownerId?: string): Promise<Project> {
  const ex = listExamples().find((e) => e.id === exampleId);
  if (!ex) throw new Error('Unknown example.');
  let p: Project = blankProject({ jobNumber: ex.jobNumber, name: ex.name, createdBy, ownerId });
  p.specText = fs.readFileSync(path.join(ex.dir, ex.spec), 'utf8');
  p.logoSlot = ex.logoSlot ?? 'auto';
  p.proofStyle = ex.proofStyle ?? 'standard';
  p.visualScale = ex.visualScale ?? 'person';
  p.imageAfterBlock = ex.imageAfterBlock ?? null;
  p.proofNote = ex.proofNote ?? null;
  p.disclaimer = ex.disclaimer ?? 'standard';
  p.siteMountHeightIn = ex.siteMountHeightIn ?? null;
  if (ex.sitePhoto) p = await storeUpload(p, 'site', ex.sitePhoto, fs.readFileSync(path.join(ex.dir, ex.sitePhoto)));
  for (const kind of ['photo', 'logo', 'sketch'] as const) {
    for (const f of [ex[kind] ?? []].flat()) p = await storeUpload(p, kind, f, fs.readFileSync(path.join(ex.dir, f)));
  }
  const wf = path.join(ex.dir, ex.wording);
  if (/\.json$/i.test(wf)) {
    // Exact wording with roles and styles, as it appears on the real plaque.
    const blocks = JSON.parse(fs.readFileSync(wf, 'utf8')) as Omit<WordingBlock, 'id'>[];
    p.wordingText = blocks.map((b) => b.text).join('\n');
    p.wording = { blocks: blocks.map((b, i) => ({ id: `w${Date.now().toString(36)}${i}`, ...b })), notes: [] };
  } else {
    p.wordingText = /\.docx$/i.test(wf) ? await docxToText(fs.readFileSync(wf)) : fs.readFileSync(wf, 'utf8');
    p.wording = parseWording(p.wordingText);
  }
  ex.lines?.forEach((o, i) => {
    const b = p.wording!.blocks[i];
    if (b) Object.assign(b, o);
  });
  p.parse = parseSpec(p.specText, { hasPhoto: p.uploads.photos.length > 0 });
  p.spec = { ...p.parse.spec };
  const o = ex.specOverrides ?? {};
  if (o.widthIn) p.spec.widthIn = o.widthIn;
  if (o.heightIn) p.spec.heightIn = o.heightIn;
  if (o.customPaintHex && p.spec.customPaint) p.spec.customPaint.hex = o.customPaintHex;
  saveProject(p);
  return p;
}
