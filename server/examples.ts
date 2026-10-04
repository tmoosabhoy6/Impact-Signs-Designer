// Example jobs built from references/<job>/example.json, so the app can be demoed
// instantly ("Start from an example") and a fresh deployment is never empty.
import fs from 'node:fs';
import path from 'node:path';
import { fromRoot } from './config.js';
import { listProjects, newId, now, saveProject } from './db.js';
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
  photo?: string;
  logo?: string;
  sketch?: string;
  proofStyle?: Project['proofStyle'];
  /** Optional per-line overrides (role / style) applied after parsing the wording. */
  lines?: Partial<Pick<WordingBlock, 'role' | 'style'>>[];
  logoSlot?: Project['logoSlot'];
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

export async function createExampleJob(exampleId: string, createdBy: string): Promise<Project> {
  const ex = listExamples().find((e) => e.id === exampleId);
  if (!ex) throw new Error('Unknown example.');
  const t = now();
  let p: Project = {
    id: newId('p'),
    jobNumber: ex.jobNumber,
    name: ex.name,
    specText: fs.readFileSync(path.join(ex.dir, ex.spec), 'utf8'),
    parse: null,
    spec: null,
    wordingText: '',
    wording: null,
    uploads: {},
    selectedConceptId: null,
    logoSlot: ex.logoSlot ?? 'auto',
    proofStyle: ex.proofStyle ?? 'standard',
    proofDescription: null,
    createdBy,
    createdAt: t,
    updatedAt: t,
  };
  for (const kind of ['photo', 'logo', 'sketch'] as const) {
    const f = ex[kind];
    if (f) p = await storeUpload(p, kind, f, fs.readFileSync(path.join(ex.dir, f)));
  }
  const wf = path.join(ex.dir, ex.wording);
  p.wordingText = /\.docx$/i.test(wf) ? await docxToText(fs.readFileSync(wf)) : fs.readFileSync(wf, 'utf8');
  p.wording = parseWording(p.wordingText);
  ex.lines?.forEach((o, i) => {
    const b = p.wording!.blocks[i];
    if (b) Object.assign(b, o);
  });
  p.parse = parseSpec(p.specText, { hasPhoto: !!p.uploads.photo });
  p.spec = p.parse.spec;
  saveProject(p);
  return p;
}

/** On a brand-new installation, add the Heritage Foundation example so there is something to demo. */
export async function seedIfEmpty() {
  if (listProjects().length) return;
  const first = listExamples().find((e) => e.id === '32241-edwin-feulner') ?? listExamples()[0];
  if (!first) return;
  try {
    await createExampleJob(first.id, 'Example');
    console.log(`Seeded example job ${first.jobNumber} (${first.name}).`);
  } catch (e) {
    console.warn('Could not seed example job:', (e as Error).message);
  }
}
