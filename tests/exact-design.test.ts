import fs from 'node:fs';
import path from 'node:path';
import type { Server } from 'node:http';
import sharp from 'sharp';
import { PDFDocument, rgb } from 'pdf-lib';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../server/app';
import { config } from '../server/config';
import { blankProject, getProject, newId, projectDir, saveProject } from '../server/db';
import { parseSpec } from '../server/parse/spec';
import { addUpload, prepareUpload, removeUpload, storeUpload, uploadPath } from '../server/uploads';
import { buildReferences, conceptFile, contentSnapshot, layoutDrawing, layoutFor, matchesSnapshot, newConceptRecord, projectForConcept, runConcept } from '../server/ai/pipeline';
import { buildConceptPrompt } from '../server/ai/prompts';
import { fallbackInstruction, planInstruction } from '../server/ai/instruct';
import { imageAdapter, openai } from '../server/ai/images';
import { fitToPlaque } from '../server/ai/postprocess';
import { spellcheckImage } from '../server/ai/spellcheck';
import { DESIGN_CRITERIA } from '../shared/types';
import { normalizeUploads } from '../shared/uploads';
import { autoDescription } from '../server/pdf/proofs/description-text';
import { buildProductionPdf } from '../server/pdf/production';

const artwork = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="600" height="400" fill="white"/><path d="M20 35 Q50 120 120 55 T240 65 M50 350 Q170 270 295 335 T570 320" stroke="#231f20" stroke-width="5" fill="none"/><circle cx="540" cy="45" r="15" fill="#ed1c24"/></svg>');
const project = () => {
  const p = blankProject({ jobNumber: 'EXACT', name: 'Exact artwork', createdBy: 'Test' });
  p.spec = parseSpec('12"w x 8"h bronze plaque, satin finish, dark oxide, blind mounting, no image').spec;
  return p;
};
const withDesign = () => storeUpload(project(), 'exact-design', 'original.svg', artwork);
const checks = () => DESIGN_CRITERIA.map((criterion) => ({ criterion, ok: true, detail: `Checked ${criterion}.` }));

describe('exact design files and shared geometry', () => {
  it('reads older jobs unchanged and retains design dimensions in normalized snapshots', async () => {
    expect(normalizeUploads(null)).toEqual({ photos: [], logos: [], sketches: [] });
    const p = await withDesign();
    expect(normalizeUploads(p.uploads)).toEqual(p.uploads);
    expect(p.uploads.exactDesigns![0]).toMatchObject({ width: 3000, height: 2000 });
    const snap = contentSnapshot(p);
    const removed = removeUpload(p, 'exact-design', p.uploads.exactDesigns![0].id);
    expect(matchesSnapshot(removed, snap)).toBe(false);
    expect(projectForConcept(removed, newConceptRecord(p, { preset: 'classic', kind: 'concept', batchId: newId('b') })).uploads).toEqual(p.uploads);
    expect(fs.existsSync(uploadPath(p, 'exact-design')!)).toBe(true);
  });

  it('rejects duplicates, a second design, invalid files and simultaneous prepared uploads', async () => {
    const p = await withDesign();
    await expect(storeUpload(p, 'exact-design', 'again.svg', artwork)).rejects.toThrow('up to 1');
    await expect(prepareUpload(p.id, 'exact-design', 'broken.png', Buffer.from('not an image'))).rejects.toThrow('could not be read');
    await expect(prepareUpload(p.id, 'exact-design', 'custom-font.svg', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><text font-family="Private Font">Exact</text></svg>'))).rejects.toThrow('Convert the text to outlines');
    const prepared = await prepareUpload(p.id, 'exact-design', 'second.svg', artwork);
    expect(() => addUpload(p, prepared)).toThrow('up to 1');
    expect(p.uploads.exactDesigns).toHaveLength(1);
  });

  it('fits the complete design identically in both presets and ignores competing wording/pictures', async () => {
    const p = await withDesign();
    p.wording = { blocks: [{ id: 'w1', role: 'headline', text: 'Do not add this text' }], notes: [] };
    p.uploads.photos = [{ id: 'photo1', file: 'missing.png', name: 'photo.png', width: 500, height: 500 }];
    p.uploads.logos = [{ id: 'logo1', file: 'missing.png', name: 'logo.png', width: 200, height: 200, vectorSource: false }];
    p.uploads.sketches = [{ id: 'sketch1', file: 'missing.png', name: 'sketch.png' }];
    const classic = layoutFor(p, 'classic');
    const statement = layoutFor(p, 'statement');
    expect(statement.exactDesign).toEqual(classic.exactDesign);
    expect(classic.lines).toEqual([]);
    expect(classic.imageFrames).toEqual([]);
    expect(classic.logos).toEqual([]);
    await expect(buildProductionPdf({ jobNumber: p.jobNumber, name: p.name, spec: p.spec!, layout: classic })).rejects.toThrow('original exact design artwork');
    const box = classic.exactDesign!;
    expect(box.w / box.h).toBeCloseTo(1.5);
    expect(box.x).toBeGreaterThanOrEqual(classic.field.x);
    expect(box.x + box.w).toBeLessThanOrEqual(classic.field.x + classic.field.w);
    const drawing = await layoutDrawing(p, classic, 900, 600);
    const refs = await buildReferences(p, classic, drawing);
    expect(refs.map((r) => r.name)).toEqual(['customer-exact-design.png', 'layout.png', 'finish-swatch.png', 'paint-swatch.png']);
    expect(refs[0].file.equals(fs.readFileSync(uploadPath(p, 'exact-design')!))).toBe(true);
    expect(refs.some((r) => r.designExample)).toBe(false);
    const prompt = buildConceptPrompt(p.spec!, classic, refs, { logoCount: 0 });
    expect(prompt).toContain('EXACT DESIGN TRANSFER');
    expect(prompt).toContain('Never retype');
    expect(prompt).not.toContain('Do not add this text');
    expect(prompt).not.toContain('{{');
    const description = autoDescription(p.spec!, p.wording, { exactDesign: true, fontStated: true });
    expect(description).toContain('customer exact design file');
    expect(description).not.toContain('Font:');
    expect(description).not.toContain('Do not add this text');
    const result = await imageAdapter().run({ model: 'mock', prompt, images: refs, size: '900x600', quality: 'max' });
    expect((await sharp(result.png).metadata()).width).toBe(900);
    fs.writeFileSync('/tmp/exact-design-drawing.png', drawing);
  });

  it('stops before a paid request if the source file is missing', async () => {
    const p = await withDesign();
    p.uploads.exactDesigns![0].file = 'missing.png';
    await expect(layoutDrawing(p, layoutFor(p, 'classic'), 900, 600)).rejects.toThrow('file is missing');
  });

  it.each(['change only the red circle to blue', 'move the handwritten title down and left and make the doodles larger', 'make the text spacing just slightly wider'])('passes embedded artwork edits literally without a synthetic relayout: %s', async (instruction) => {
    const p = await withDesign();
    const c = newConceptRecord(p, { preset: 'classic', kind: 'concept', batchId: newId('b') });
    expect(fallbackInstruction(p, instruction)).toEqual({ kind: 'visual', restated: instruction });
    expect(await planInstruction(p, c, instruction)).toEqual({ kind: 'visual', restated: instruction });
    expect(fallbackInstruction(p, 'change the material to aluminum')).toMatchObject({ kind: 'spec', specPatch: { material: 'aluminum' } });
    expect(fallbackInstruction(p, 'use aluminum and move the doodle to the left')).toMatchObject({ kind: 'edit', specPatch: { material: 'aluminum' }, imageEdit: 'move the doodle to the left' });
  });

  it('never trims the canvas for exact designs or edits', async () => {
    const png = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="600" height="400" fill="white"/><rect x="20" y="20" width="560" height="360" fill="#231f20"/></svg>')).png().toBuffer();
    expect((await fitToPlaque(png, 12, 8, 600)).trimmed).toBe(true);
    const retained = await fitToPlaque(png, 12, 8, 600, false);
    expect(retained.trimmed).toBe(false);
    expect(await sharp(retained.png).removeAlpha().raw().toBuffer()).toEqual(await sharp(png).removeAlpha().raw().toBuffer());
  });
});

describe('offline SDK boundary for precise design transfer and edits', () => {
  it('sends the original artwork first for generation and the selected PNG first for every edit', async () => {
    const p = await withDesign();
    const original = { mockAI: config.mockAI, openaiKey: config.openaiKey };
    Object.assign(config, { mockAI: false, openaiKey: 'offline-placeholder' });
    const output = await sharp({ create: { width: 1536, height: 1024, channels: 3, background: '#c49a6c' } }).png().toBuffer();
    const edit = vi.spyOn(openai().images, 'edit').mockImplementation(() => Promise.resolve((async function* () {
      yield { type: 'image_edit.completed', b64_json: output.toString('base64'), quality: 'max', size: '1536x1024', usage: null };
    })()) as never);
    const generate = vi.spyOn(openai().images, 'generate').mockRejectedValue(new Error('Fresh generation is forbidden here'));
    const review = vi.spyOn(openai().responses, 'create').mockResolvedValue({ output_text: JSON.stringify({ lines: [], sourceLines: [], designChecks: checks() }) } as never);
    try {
      const parent = await runConcept(p, newConceptRecord(p, { preset: 'classic', kind: 'concept', batchId: newId('b') }), { onPartial() {}, onUpdate() {} });
      expect(parent.status).toBe('done');
      const first = edit.mock.calls[0][0] as unknown as { image: File[]; prompt: string };
      expect(Buffer.from(await first.image[0].arrayBuffer())).toEqual(fs.readFileSync(uploadPath(p, 'exact-design')!));
      expect(first.prompt).toContain('EXACT DESIGN TRANSFER');
      for (const instruction of ['Change only the red circle to blue.', 'Move the flower down and left and put the title on the right.']) {
        const c = newConceptRecord(p, { preset: 'classic', kind: 'fix', batchId: parent.batchId, parentId: parent.id, instruction, model: parent.model, plan: { kind: 'visual', restated: instruction } });
        const done = await runConcept(p, c, { onPartial() {}, onUpdate() {} });
        expect(done.status).toBe('done');
        expect(done.parentId).toBe(parent.id);
        const req = edit.mock.lastCall![0] as unknown as { image: File[]; prompt: string; model: string; quality: string; size: string; stream: boolean };
        expect(req.image).toHaveLength(1);
        expect(Buffer.from(await req.image[0].arrayBuffer())).toEqual(fs.readFileSync(conceptFile(parent, 'image.png')));
        expect(req.prompt).toContain(instruction);
        expect(req.prompt).not.toContain('NEW LAYOUT');
        expect(req).toMatchObject({ model: parent.model, quality: 'max', size: '1536x1024', stream: true });
        const reviewText = JSON.stringify(review.mock.lastCall![0]);
        expect(reviewText).toContain('original selected image BEFORE the edit');
        expect(reviewText).toContain('collateral changes');
      }
      expect(generate).not.toHaveBeenCalled();
      expect(fs.readFileSync(conceptFile(parent, 'image.png'))).toEqual(output);
    } finally { edit.mockRestore(); generate.mockRestore(); review.mockRestore(); Object.assign(config, original); }
  });

  it('checks OCR against source art and treats a missing source transcription as unchecked', async () => {
    const p = await withDesign();
    const png = fs.readFileSync(uploadPath(p, 'exact-design')!);
    const old = { mockAI: config.mockAI, openaiKey: config.openaiKey };
    Object.assign(config, { mockAI: false, openaiKey: 'offline-placeholder' });
    const response = vi.spyOn(openai().responses, 'create');
    const review = { spec: p.spec!, layoutPng: png, styleRefs: [], sourceImage: png, exactDesign: true };
    try {
      response.mockResolvedValue({ output_text: JSON.stringify({ lines: ['Willow'], sourceLines: ['WilloW'], designChecks: checks() }) } as never);
      expect(await spellcheckImage(png, [], [], review)).toMatchObject({ ok: false, checked: true, differences: [{ expected: 'WilloW', seen: 'Willow' }] });
      response.mockResolvedValue({ output_text: JSON.stringify({ lines: ['Willow'], designChecks: checks() }) } as never);
      expect(await spellcheckImage(png, [], [], review)).toMatchObject({ checked: false, designReview: { checked: false } });
      response.mockResolvedValue({ output_text: JSON.stringify({ lines: ['New wording'], designChecks: checks() }) } as never);
      expect(await spellcheckImage(png, [], [], { ...review, instruction: 'Change Willow to New wording' })).toMatchObject({ checked: false, differences: [], designReview: { checked: true } });
    } finally { response.mockRestore(); Object.assign(config, old); }
  });
});

describe('exact design API lifecycle', () => {
  let server: Server;
  let base: string;
  let cookie: string;
  let ownerId: string;
  const oldPassword = config.appPassword;
  beforeAll(async () => {
    config.appPassword = 'exact-design-offline-check';
    server = await new Promise<Server>((resolve) => { const s = createApp().listen(0, '127.0.0.1', () => resolve(s)); });
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
    const login = await fetch(`${base}/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Test', password: config.appPassword }) });
    cookie = login.headers.get('set-cookie')?.split(';')[0] ?? '';
    ownerId = (await (await fetch(`${base}/me`, { headers: { Cookie: cookie } })).json()).user.id;
  });
  afterAll(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); config.appPassword = oldPassword; });
  const post = (url: string, data: unknown) => fetch(`${base}${url}`, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(data) });

  it('uploads PNG, JPEG, SVG and first-page PDF while preserving original bytes', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([432, 288]).drawRectangle({ x: 50, y: 50, width: 100, height: 100, color: rgb(0, 0, 0) });
    doc.addPage([432, 288]);
    const formats: [string, Buffer][] = [['art.png', await sharp(artwork).png().toBuffer()], ['art.jpg', await sharp(artwork).jpeg().toBuffer()], ['art.svg', artwork], ['art.pdf', Buffer.from(await doc.save())]];
    for (const [name, bytes] of formats) {
      const p = project(); p.ownerId = ownerId; saveProject(p);
      const fd = new FormData(); fd.append('file', new Blob([new Uint8Array(bytes)]), name);
      const res = await fetch(`${base}/projects/${p.id}/upload/exact-design`, { method: 'POST', headers: { Cookie: cookie }, body: fd });
      expect(res.status, name).toBe(200);
      const saved = getProject(p.id)!;
      const f = saved.uploads.exactDesigns![0];
      expect(fs.readFileSync(path.join(projectDir(p.id, 'uploads'), `${f.id}-original${path.extname(name)}`))).toEqual(bytes);
      expect((await fetch(`${base}/projects/${p.id}/files/exact-design/${f.id}`, { headers: { Cookie: cookie } })).status).toBe(200);
      const original = await fetch(`${base}/projects/${p.id}/files/exact-design/${f.id}/original`, { headers: { Cookie: cookie } });
      expect(original.status).toBe(200);
      expect(Buffer.from(await original.arrayBuffer())).toEqual(bytes);
      saved.ownerId = 'another-account'; saveProject(saved);
      const denied = await fetch(`${base}/projects/${p.id}/files/exact-design/${f.id}`, { headers: { Cookie: cookie } });
      expect(denied.status).toBe(400);
      expect((await denied.json()).error).toBe('Job not found.');
      expect((await fetch(`${base}/projects/${p.id}/files/exact-design/${f.id}/original`, { headers: { Cookie: cookie } })).status).toBe(400);
    }
  });

  it('generates without separate wording/photos, makes a proof, edits and restores frozen design uploads', async () => {
    const p = await withDesign(); p.ownerId = ownerId; saveProject(p);
    const res = await post(`/projects/${p.id}/generate`, {});
    expect(res.status).toBe(200); await res.text();
    const payload = await (await fetch(`${base}/projects/${p.id}`, { headers: { Cookie: cookie } })).json();
    expect(payload.concepts).toHaveLength(2);
    expect(payload.concepts.every((c: { status: string }) => c.status === 'done')).toBe(true);
    const parent = payload.concepts[0];
    const proof = await post(`/projects/${p.id}/proof`, { conceptId: parent.id });
    expect(proof.status).toBe(200);
    const o = (await proof.json()).output;
    expect((await fetch(`${base}/outputs/${o.id}/preview.png`, { headers: { Cookie: cookie } })).status).toBe(200);
    const production = await post(`/projects/${p.id}/production`, { conceptId: parent.id });
    expect(production.status).toBe(400);
    expect((await production.json()).error).toContain('original exact design artwork');
    const fixed = await post(`/concepts/${parent.id}/fix`, { instruction: 'Move only the doodle to the right' });
    expect(fixed.status).toBe(200); await fixed.text();
    const removed = removeUpload(getProject(p.id)!, 'exact-design', p.uploads.exactDesigns![0].id); saveProject(removed);
    expect(getProject(p.id)!.uploads.exactDesigns).toBeUndefined();
    expect((await post(`/projects/${p.id}/select`, { conceptId: parent.id })).status).toBe(200);
    expect(getProject(p.id)!.uploads.exactDesigns![0].id).toBe(p.uploads.exactDesigns![0].id);
  });
});
