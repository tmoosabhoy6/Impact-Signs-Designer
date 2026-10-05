import fs from 'node:fs';
import path from 'node:path';
import type { Server } from 'node:http';
import express from 'express';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { api } from '../server/routes';
import { config } from '../server/config';
import { createExampleJob } from '../server/examples';
import { getConcept, getProject, listConcepts, listOutputs, newId, saveConcept, saveProject, spentToday } from '../server/db';
import { conceptFile, contentSnapshot, newConceptRecord } from '../server/ai/pipeline';
import { imageAdapter } from '../server/ai/images';
import { storeUpload } from '../server/uploads';
import { PDFDocument } from 'pdf-lib';
import type { ConceptRecord, LayoutPresetId, OutputRecord, Project } from '../shared/types';

let server: Server;
let base: string;
let cookie: string;
/** The signed-in test user's id: fixture jobs belong to them, as real jobs do. */
let ownerId: string;
beforeAll(async () => {
  const app = express();
  app.use('/api', api);
  server = await new Promise<Server>((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test address');
  base = `http://127.0.0.1:${address.port}/api`;
  const login = await fetch(`${base}/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Test', password: config.appPassword }) });
  cookie = login.headers.get('set-cookie')!.split(';')[0];
  ownerId = (await (await fetch(`${base}/me`, { headers: { Cookie: cookie } })).json()).user.id;
});
afterAll(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); });

async function post(url: string, body = {}) {
  return fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify(body) });
}
async function fixture() {
  const p = await createExampleJob('32241-edwin-feulner', 'Test', ownerId);
  const c = newConceptRecord(p, { preset: 'classic', kind: 'concept', batchId: newId('b'), status: 'done', hasImage: true });
  // A finished concept has its picture on disk (an image-only edit starts from it).
  fs.mkdirSync(path.dirname(conceptFile(c, 'image.png')), { recursive: true });
  await sharp({ create: { width: 400, height: 600, channels: 3, background: '#8a6a43' } }).png().toFile(conceptFile(c, 'image.png'));
  saveConcept(c);
  return { p, c };
}
function streamEvents(text: string) {
  return text.split('\n\n').filter((s) => s.startsWith('data: ')).map((s) => JSON.parse(s.slice(6)));
}

describe('instruction routes in demo mode', () => {
  it.each(['generate', 'regenerate', 'fix'])('routes Max quality through %s to the image adapter and saved version', async (action) => {
    const { p, c } = await fixture();
    if (action === 'fix') { c.quality = 'max'; saveConcept(c); }
    const run = vi.spyOn(imageAdapter(), 'run');
    try {
      const url = action === 'generate' ? `/projects/${p.id}/generate` : `/concepts/${c.id}/${action}`;
      const response = await post(url, { quality: 'max', instruction: 'make the metal look warmer' });
      expect(response.status).toBe(200);
      await response.text();
      expect(run).toHaveBeenCalledTimes(action === 'generate' ? 3 : 1);
      run.mock.calls.forEach(([request]) => expect(request).toMatchObject({ quality: 'max', size: '2352x3520', preserveSize: true }));
      const versions = listConcepts(p.id).filter((version) => version.id !== c.id);
      expect(versions).toHaveLength(action === 'generate' ? 3 : 1);
      for (const version of versions) {
        expect(version).toMatchObject({ status: 'done', quality: 'max', size: '2352x3520' });
        const metadata = await sharp(conceptFile(version, 'image.png')).metadata();
        expect(metadata.height).toBe(3520);
      }
    } finally { run.mockRestore(); }
  });
  it.each([['medium', '848x1280', 1280], ['high', '1280x1920', 1920], ['xhigh', '1712x2560', 2560]])('routes %s resolution tiers into the request and downloaded PNG', async (quality, size, edge) => {
    const { p, c } = await fixture();
    const run = vi.spyOn(imageAdapter(), 'run');
    try {
      await (await post(`/concepts/${c.id}/regenerate`, { quality })).text();
      expect(run.mock.calls[0][0]).toMatchObject({ quality, size });
      const version = listConcepts(p.id).at(-1)!;
      expect(version).toMatchObject({ status: 'done', quality, size });
      const metadata = await sharp(conceptFile(version, 'image.png')).metadata();
      expect(metadata.height).toBe(edge);
    } finally { run.mockRestore(); }
  });
  it.each(['make the etching deeper', 'make the border double line'])('inherits the source model and Max quality for %s, ignoring dropdown and server changes', async (instruction) => {
    const { p, c } = await fixture();
    c.model = 'gpt-image-2.5-sunburst-2026-09-08';
    c.quality = 'max';
    saveConcept(c);
    const run = vi.spyOn(imageAdapter(), 'run');
    try {
      await (await post(`/concepts/${c.id}/fix`, { instruction, quality: 'medium' })).text();
      const request = run.mock.calls[0][0];
      expect(request).toMatchObject({ model: c.model, quality: 'max', preserveQuality: true });
      expect(request.images[0].name).toBe('current.png');
      expect(request.prompt).toContain(instruction);
      expect(listConcepts(p.id).at(-1)).toMatchObject({ kind: 'fix', model: c.model, quality: 'max', instruction, parentId: c.id });
      expect(getConcept(c.id)).toMatchObject({ model: c.model, quality: 'max' });
    } finally { run.mockRestore(); }
  });
  it('does not mark a smaller Max image as a completed 4K result', async () => {
    const { p, c } = await fixture();
    c.quality = 'max';
    saveConcept(c);
    const png = await sharp({ create: { width: 32, height: 48, channels: 3, background: '#fff' } }).png().toBuffer();
    const run = vi.spyOn(imageAdapter(), 'run').mockResolvedValue({ png, usage: null });
    try {
      await (await post(`/concepts/${c.id}/fix`, { instruction: 'make the etching deeper' })).text();
      const version = listConcepts(p.id).at(-1)!;
      expect(version).toMatchObject({ status: 'error', hasImage: false });
      expect(version.error).toContain('different image size');
    } finally { run.mockRestore(); }
  });
  it('makes any request an image edit instead of refusing, without changing the order', async () => {
    const { p, c } = await fixture();
    const response = await post(`/concepts/${c.id}/fix`, { instruction: 'use a purple anodized finish' });
    expect(response.status).toBe(200);
    const events = streamEvents(await response.text());
    expect(events[0]).toMatchObject({ type: 'plan', plan: { kind: 'visual', restated: 'use a purple anodized finish' } });
    const version = listConcepts(p.id).at(-1)!;
    expect(version).toMatchObject({ kind: 'fix', status: 'done', parentId: c.id, plan: { kind: 'visual' } });
    expect(version.prompt).toContain('use a purple anodized finish');
    expect(getProject(p.id)).toEqual(p);
  });
  it('sends open edits with the current picture, layout and informed preservation rules', async () => {
    const { p, c } = await fixture();
    const run = vi.spyOn(imageAdapter(), 'run');
    try {
      const words = 'Throw the plaque away and redo the whole thing as a rusty iron sign with a pink background, "Hello" in the middle';
      await (await post(`/concepts/${c.id}/fix`, { instruction: words })).text();
      expect(run).toHaveBeenCalledTimes(1);
      const request = run.mock.calls[0][0];
      expect(request.images.map((i) => i.name)).toEqual(['current.png', 'layout.png']);
      expect(request.prompt).toContain(words);
      expect(request.prompt).toContain('ZERO TOLERANCE');
      expect(request.prompt).toContain('overrides any conflicting default rule');
      expect(request.prompt).toContain('Image 2 shows the planned layout');
      expect(getProject(p.id)).toEqual(p);
    } finally { run.mockRestore(); }
  });
  it('includes original logo artwork when repairing missing details', async () => {
    const { p, c } = await fixture();
    const png = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><rect x="30" y="30" width="240" height="120" fill="#145"/><text x="150" y="250" text-anchor="middle" font-size="48" fill="white">CAMP</text></svg>')).png().toBuffer();
    const withLogo = await storeUpload(p, 'logo', 'camp.png', png);
    saveProject(withLogo);
    c.snapshot = contentSnapshot(withLogo);
    saveConcept(c);
    const run = vi.spyOn(imageAdapter(), 'run');
    try {
      await (await post(`/concepts/${c.id}/fix`, { instruction: 'restore the missing white line and logo lettering' })).text();
      const request = run.mock.calls[0][0];
      expect(request.images.map((i) => i.name)).toEqual(['current.png', 'layout.png', 'customer-logo.png']);
      expect(request.prompt).toContain('original customer logos');
      expect(request.prompt).toContain('white lettering');
      // The reference is backed in gray so white artwork on transparency stays visible.
      const reference = request.images[2].file;
      const { data, info } = await sharp(reference).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      expect(data[0]).toBe(128);
      let whites = 0;
      for (let y = Math.floor(info.height * 0.6); y < info.height; y++) for (let x = 0; x < info.width; x++) if (data[(y * info.width + x) * 3] > 240) whites++;
      expect(whites).toBeGreaterThan(100);
    } finally { run.mockRestore(); }
  });
  it('still draws an order change to the updated layout, with the layout drawing and house rules', async () => {
    const { c } = await fixture();
    const run = vi.spyOn(imageAdapter(), 'run');
    try {
      await (await post(`/concepts/${c.id}/fix`, { instruction: 'move the text up' })).text();
      const request = run.mock.calls[0][0];
      expect(request.images.map((i) => i.name)).toEqual(['current.png', 'layout.png']);
      expect(request.prompt).toContain('NEW LAYOUT');
      expect(request.prompt).toContain('ZERO TOLERANCE');
    } finally { run.mockRestore(); }
  });
  it('edits an older version from its own content when the order has moved on', async () => {
    const { p, c } = await fixture();
    // The order changes after the concept was made (a double line border).
    await (await post(`/concepts/${c.id}/fix`, { instruction: 'make the border double line' })).text();
    expect(getProject(p.id)?.spec?.border).toBe('double-line');
    const response = await post(`/concepts/${c.id}/fix`, { instruction: 'make the etching deeper' });
    expect(response.status).toBe(200);
    await response.text();
    const version = listConcepts(p.id).at(-1)!;
    expect(version).toMatchObject({ kind: 'fix', status: 'done', parentId: c.id, snapshot: { spec: { border: 'single-line' } } });
    expect(getProject(p.id)?.spec?.border).toBe('double-line');
  });
  it('a structural edit of an older image keeps its wording and can undo to the newer order', async () => {
    const { p, c } = await fixture();
    const original = c.snapshot!.wording!.blocks[0].text;
    p.wording!.blocks[0].text = 'A different newer heading';
    saveProject(p);
    const response = await post(`/concepts/${c.id}/fix`, { instruction: 'make the border double line' });
    await response.text();
    const version = listConcepts(p.id).at(-1)!;
    expect(version.status).toBe('done');
    expect(version.snapshot!.wording!.blocks[0].text).toBe(original);
    expect(getProject(p.id)!.wording!.blocks[0].text).toBe(original);
    expect((await post(`/concepts/${version.id}/undo`)).status).toBe(200);
    expect(getProject(p.id)!.wording!.blocks[0].text).toBe('A different newer heading');
  });
  it('streams the plan first, edits the current image for changed spec, and undoes without removing versions', async () => {
    const { p, c } = await fixture();
    const response = await post(`/concepts/${c.id}/fix`, { instruction: 'make the border double line' });
    expect(response.status).toBe(200);
    const events = streamEvents(await response.text());
    expect(events[0]).toMatchObject({ type: 'plan', plan: { kind: 'spec' } });
    expect(events[1].type).toBe('start');
    expect(events.at(-1).type).toBe('end');
    const version = listConcepts(p.id).at(-1)!;
    expect(version).toMatchObject({ kind: 'fix', status: 'done', parentId: c.id, quality: 'high', previous: { spec: { border: 'single-line' } }, snapshot: { spec: { border: 'double-line' } } });
    expect(version.prompt).toContain('make the border double line');
    expect(version.spellcheck).not.toBeNull();
    expect(getProject(p.id)?.spec?.border).toBe('double-line');
    expect((await post(`/concepts/${version.id}/undo`)).status).toBe(200);
    expect(getProject(p.id)?.spec).toEqual(p.spec);
    expect(listConcepts(p.id)).toHaveLength(2);
    expect(getConcept(c.id)).toEqual(c);
    // Selecting the changed version restores its content after Undo.
    expect((await post(`/projects/${p.id}/select`, { conceptId: version.id })).status).toBe(200);
    expect(getProject(p.id)?.spec?.border).toBe('double-line');
  });
  it('updates exact wording and restores both wording text and blocks on undo', async () => {
    const { p, c } = await fixture();
    const response = await post(`/concepts/${c.id}/fix`, { instruction: 'change Founder to Chairman' });
    await response.text();
    const version = listConcepts(p.id).at(-1)!;
    expect(version.plan?.kind).toBe('wording');
    expect(getProject(p.id)?.wording?.blocks[0].text).toBe('Edwin J. Feulner Jr., Chairman');
    await post(`/concepts/${version.id}/undo`);
    expect(getProject(p.id)?.wording).toEqual(p.wording);
    expect(getProject(p.id)?.wordingText).toEqual(p.wordingText);
  });
  it('refuses undo that would overwrite a subsequent order change', async () => {
    const { p, c } = await fixture();
    await (await post(`/concepts/${c.id}/fix`, { instruction: 'make the border double line' })).text();
    const first = listConcepts(p.id).at(-1)!;
    await (await post(`/concepts/${first.id}/fix`, { instruction: 'black paint' })).text();
    expect((await post(`/concepts/${first.id}/undo`)).status).toBe(409);
    expect(getProject(p.id)?.spec?.backgroundColor).toBe('black');
  });
  it('preserves the image anchor when inserting a wording block and restores it on undo', async () => {
    const { p, c } = await fixture();
    p.imageAfterBlock = 0;
    saveProject(p);
    // The source image carries this anchor, rather than editing a newer order's anchor.
    c.snapshot = contentSnapshot(p);
    saveConcept(c);
    await (await post(`/concepts/${c.id}/fix`, { instruction: 'add a line "Recognition" at the top' })).text();
    expect(getProject(p.id)?.imageAfterBlock).toBe(1);
    const version = listConcepts(p.id).at(-1)!;
    await post(`/concepts/${version.id}/undo`);
    expect(getProject(p.id)?.imageAfterBlock).toBe(0);
  });
  it('does not silently approve an unchecked live proof', async () => {
    const { p, c } = await fixture();
    const mock = config.mockAI;
    config.mockAI = false;
    try {
      const response = await post(`/projects/${p.id}/proof`, { conceptId: c.id });
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ error: expect.stringContaining('not completed a spelling check') });
    } finally { config.mockAI = mock; }
  });
});

describe('a proof and a vector file from each concept', () => {
  /** One finished, spell-checked concept per layout, each with an image on disk. */
  async function threeConcepts() {
    const p = await createExampleJob('32241-edwin-feulner', 'Test', ownerId);
    const batchId = newId('b');
    const concepts: Record<LayoutPresetId, ConceptRecord> = {} as never;
    for (const preset of ['classic', 'portrait', 'statement'] as LayoutPresetId[]) {
      const c = newConceptRecord(p, { preset, kind: 'concept', batchId, status: 'done', hasImage: true, spellcheck: { ok: true, checked: true, differences: [], message: 'Wording matches.' } });
      fs.mkdirSync(path.dirname(conceptFile(c, 'image.png')), { recursive: true });
      await sharp({ create: { width: 400, height: 600, channels: 3, background: '#8a6a43' } }).png().toFile(conceptFile(c, 'image.png'));
      saveConcept(c);
      concepts[preset] = c;
    }
    return { p, concepts };
  }
  const made = async (r: Response) => {
    expect(r.status).toBe(200);
    return ((await r.json()) as { output: OutputRecord }).output;
  };

  it('proofs every layout without selecting it or changing the order', async () => {
    const { p, concepts } = await threeConcepts();
    const proofs = [];
    for (const c of Object.values(concepts)) proofs.push(await made(await post(`/projects/${p.id}/proof`, { conceptId: c.id })));
    expect(proofs.map((o) => [o.conceptId, o.preset])).toEqual(Object.values(concepts).map((c) => [c.id, c.preset]));
    // Three options of one job, each its own first version, named by layout.
    expect(proofs.map((o) => o.fileName)).toEqual(['Proof - 32241 - Classic.pdf', 'Proof - 32241 - Feature Image.pdf', 'Proof - 32241 - Statement.pdf']);
    expect(getProject(p.id)).toEqual(p);
    // A second Classic proof is Classic v2, whatever the other layouts did.
    expect((await made(await post(`/projects/${p.id}/proof`, { conceptId: concepts.classic.id }))).fileName).toBe('Proof - 32241 - Classic v2.pdf');
  });

  it('builds a vector file from each layout, named by layout', async () => {
    const { p, concepts } = await threeConcepts();
    const files = [];
    for (const c of Object.values(concepts)) files.push(await made(await post(`/projects/${p.id}/production`, { conceptId: c.id })));
    expect(files.map((o) => o.preset)).toEqual(['classic', 'portrait', 'statement']);
    expect(files.map((o) => o.fileName)).toEqual([
      '32241_Heritage_Foundation_12x18_Classic_production.pdf',
      '32241_Heritage_Foundation_12x18_Feature_Image_production.pdf',
      '32241_Heritage_Foundation_12x18_Statement_production.pdf',
    ]);
    for (const o of files) expect(o.preflight?.filter((i) => !i.ok && !i.warnOnly)).toEqual([]);
    expect(getProject(p.id)).toEqual(p);
    expect(listOutputs(p.id)).toHaveLength(3);
  });

  it('uses each concept’s own content, not the order as edited since', async () => {
    const { p, concepts } = await threeConcepts();
    // The order moves on after the concepts were made.
    const edited: Project = { ...structuredClone(p), spec: { ...p.spec!, widthIn: 24, heightIn: 36 } };
    saveProject(edited);
    const o = await made(await post(`/projects/${p.id}/production`, { conceptId: concepts.statement.id }));
    expect(o.fileName).toContain('_12x18_');
    expect(o.preflight?.find((i) => i.label === 'Page size')).toMatchObject({ ok: true, detail: expect.stringContaining('plaque 12" x 18"') });
    await made(await post(`/projects/${p.id}/proof`, { conceptId: concepts.statement.id }));
    // Proofing an older concept leaves the edited order alone.
    expect(getProject(p.id)?.spec).toMatchObject({ widthIn: 24, heightIn: 36 });
  });

  it('refuses a vector file for a concept that is not in the job', async () => {
    const { p } = await threeConcepts();
    const other = await threeConcepts();
    for (const conceptId of ['c_missing', other.concepts.classic.id]) {
      const r = await post(`/projects/${p.id}/production`, { conceptId });
      expect(r.status).toBe(400);
      expect(await r.json()).toMatchObject({ error: 'That concept was not found in this job.' });
    }
    expect(listOutputs(p.id)).toEqual([]);
  });

  describe('one proof of several images', () => {
    const pageCount = async (o: OutputRecord) => (await PDFDocument.load(fs.readFileSync(path.join(config.dataDir, 'projects', o.projectId, 'outputs', `${o.id}.pdf`)))).getPageCount();
    const setOf = async (p: Project, conceptId: string, on = true) => post(`/projects/${p.id}/proof-set`, { conceptId, on });

    it('collects up to three images, in the order they were added, and refuses a fourth', async () => {
      const { p, concepts } = await threeConcepts();
      const extra = newConceptRecord(p, { preset: 'classic', kind: 'concept', batchId: newId('b'), status: 'done', hasImage: true });
      saveConcept(extra);
      expect(getProject(p.id)?.proofConceptIds).toEqual([]);
      for (const c of [concepts.statement, concepts.classic, concepts.portrait]) expect((await setOf(p, c.id)).status).toBe(200);
      expect(getProject(p.id)?.proofConceptIds).toEqual([concepts.statement.id, concepts.classic.id, concepts.portrait.id]);
      const full = await setOf(p, extra.id);
      expect(full.status).toBe(400);
      expect(await full.json()).toMatchObject({ error: expect.stringContaining('up to 3 pages') });
      // Adding one that is already there changes nothing; taking one off frees a page.
      await setOf(p, concepts.classic.id);
      expect(getProject(p.id)?.proofConceptIds).toHaveLength(3);
      await setOf(p, concepts.classic.id, false);
      expect(getProject(p.id)?.proofConceptIds).toEqual([concepts.statement.id, concepts.portrait.id]);
    });

    it('reorders the pages, and only accepts the same images', async () => {
      const { p, concepts } = await threeConcepts();
      await setOf(p, concepts.classic.id);
      await setOf(p, concepts.portrait.id);
      const ok = await post(`/projects/${p.id}/proof-set`, { order: [concepts.portrait.id, concepts.classic.id] });
      expect(ok.status).toBe(200);
      expect(getProject(p.id)?.proofConceptIds).toEqual([concepts.portrait.id, concepts.classic.id]);
      expect((await post(`/projects/${p.id}/proof-set`, { order: [concepts.portrait.id, concepts.statement.id] })).status).toBe(400);
      expect(getProject(p.id)?.proofConceptIds).toEqual([concepts.portrait.id, concepts.classic.id]);
    });

    it('makes one PDF with a page per image, first image first', async () => {
      const { p, concepts } = await threeConcepts();
      const o = await made(await post(`/projects/${p.id}/proof`, { conceptIds: [concepts.portrait.id, concepts.classic.id, concepts.statement.id] }));
      expect(o.conceptIds).toEqual([concepts.portrait.id, concepts.classic.id, concepts.statement.id]);
      expect(o.presets).toEqual(['portrait', 'classic', 'statement']);
      expect(o.fileName).toBe('Proof - 32241 - Feature Image + Classic + Statement.pdf');
      expect(await pageCount(o)).toBe(3);
      // Page previews render each page separately.
      for (const page of [1, 2, 3]) {
        const r = await fetch(`${base}/outputs/${o.id}/preview.png?page=${page}`, { headers: { Cookie: cookie } });
        expect(r.status).toBe(200);
        expect((await r.arrayBuffer()).byteLength).toBeGreaterThan(1000);
      }
      expect(getProject(p.id)).toEqual(p);
    });

    it('uses the images set for the proof when none are named, and counts versions per layout', async () => {
      const { p, concepts } = await threeConcepts();
      await setOf(p, concepts.classic.id);
      await setOf(p, concepts.statement.id);
      const first = await made(await post(`/projects/${p.id}/proof`));
      expect(first.presets).toEqual(['classic', 'statement']);
      expect(await pageCount(first)).toBe(2);
      // The same pair again is v2 of both layouts; a single image is a plain one-page file.
      expect((await made(await post(`/projects/${p.id}/proof`))).fileName).toBe('Proof - 32241 - Classic + Statement v2.pdf');
      const single = await made(await post(`/projects/${p.id}/proof`, { conceptId: concepts.portrait.id }));
      expect(single.conceptIds).toBeUndefined();
      expect(await pageCount(single)).toBe(1);
    });

    it('checks every image’s wording before making any page', async () => {
      const { p, concepts } = await threeConcepts();
      saveConcept({ ...concepts.statement, spellcheck: { ok: false, checked: true, differences: [{ expected: 'Heritage', seen: 'Heritege' }], message: 'Differences.' } });
      const r = await post(`/projects/${p.id}/proof`, { conceptIds: [concepts.classic.id, concepts.statement.id] });
      expect(r.status).toBe(409);
      expect(await r.json()).toMatchObject({ error: expect.stringContaining('Page 2 (Statement)'), differences: [{ expected: 'Heritage', seen: 'Heritege', where: 'Page 2 (Statement)' }] });
      expect(listOutputs(p.id)).toEqual([]);
      const confirmed = await post(`/projects/${p.id}/proof`, { conceptIds: [concepts.classic.id, concepts.statement.id], acknowledged: true });
      expect(confirmed.status).toBe(200);
    });

    it('refuses more than three pages, or an image from another job', async () => {
      const { p, concepts } = await threeConcepts();
      const other = await threeConcepts();
      const four = [concepts.classic.id, concepts.portrait.id, concepts.statement.id, concepts.classic.id + 'x'];
      expect((await post(`/projects/${p.id}/proof`, { conceptIds: four })).status).toBe(400);
      expect((await post(`/projects/${p.id}/proof`, { conceptIds: [concepts.classic.id, other.concepts.classic.id] })).status).toBe(400);
      expect(listOutputs(p.id)).toEqual([]);
    });
  });
});
