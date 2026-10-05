import fs from 'node:fs';
import type { Server } from 'node:http';
import express from 'express';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const create = vi.fn();
vi.mock('../server/ai/images', async (orig) => {
  const real = await orig<typeof import('../server/ai/images')>();
  return { ...real, openai: () => ({ responses: { create } }) };
});

const { api } = await import('../server/routes');
const { config } = await import('../server/config');
const { createExampleJob } = await import('../server/examples');
const { getProject, listConcepts, newId, saveConcept } = await import('../server/db');
const { layoutFor, newConceptRecord } = await import('../server/ai/pipeline');
const { applyPlan, fallbackInstruction, planInstruction, validateInstructionPlan } = await import('../server/ai/instruct');
const { computeLayout } = await import('../server/layout/engine');
const { parseSpec } = await import('../server/parse/spec');
const { docxToText, parseWording } = await import('../server/parse/wording');
import type { ConceptRecord, Project } from '../shared/types';

async function heritage() {
  return {
    spec: parseSpec(fs.readFileSync('references/32241-edwin-feulner/spec.txt', 'utf8')).spec,
    wording: parseWording(await docxToText(fs.readFileSync('references/32241-edwin-feulner/Edwin-J.docx'))),
    uploads: {},
    imageAfterBlock: null,
    logoSlot: 'auto',
  } as unknown as Project;
}

describe('layout adjustments', () => {
  const input = async () => { const p = await heritage(); return { spec: p.spec!, wording: p.wording, photoAspect: 402 / 450 }; };

  it('changes nothing when there are no adjustments', async () => {
    const i = await input();
    expect(computeLayout({ ...i, adjust: {} }, 'classic')).toEqual(computeLayout(i, 'classic'));
    expect(computeLayout({ ...i, adjust: { textScale: 1, spacing: 1, verticalOffset: 0 } }, 'classic')).toEqual(computeLayout(i, 'classic'));
  });

  it('moves, resizes and spaces content in the shared layout', async () => {
    const i = await input();
    const base = computeLayout(i, 'classic');
    const up = computeLayout({ ...i, adjust: { verticalOffset: -1 } }, 'classic');
    expect(up.imageFrame!.outer.y).toBeLessThan(base.imageFrame!.outer.y);
    const small = computeLayout({ ...i, adjust: { textScale: 0.8 } }, 'classic');
    expect(small.lines[0].size).toBeLessThan(base.lines[0].size);
    const photo = computeLayout({ ...i, adjust: { imageScale: 1.2 } }, 'classic');
    expect(photo.imageFrame!.outer.w).toBeGreaterThan(base.imageFrame!.outer.w);
    const spaced = computeLayout({ ...i, adjust: { spacing: 1.3, textScale: 0.8 } }, 'classic');
    const span = (l: typeof base) => l.lines.at(-1)!.baseline - l.lines[0].baseline;
    expect(span(spaced)).toBeGreaterThan(span(small));
    // Everything stays on the plaque.
    for (const l of [up, small, photo, spaced]) for (const line of l.lines) expect(line.baseline).toBeLessThan(l.heightIn);
  });
});

describe('offline planner for larger edits', () => {
  it.each([
    ['move the text up', { layoutPatch: { verticalOffset: -0.5 } }],
    ['make the text bigger', { layoutPatch: { textScale: 1.18 } }],
    ['spread everything out more', { layoutPatch: { spacing: 1.25 } }],
    ['make the photo a lot larger', { layoutPatch: { imageScale: 1.4 } }],
    ['move the photo below the name', { placement: { imageAfterBlock: 0 } }],
  ])('plans "%s" as a layout change', async (instruction, parts) => {
    expect(fallbackInstruction(await heritage(), instruction)).toMatchObject({ kind: 'edit', ...parts });
  });

  it('turns other appearance requests into an image edit instead of refusing', async () => {
    expect(fallbackInstruction(await heritage(), 'make the etching deeper and more detailed')).toMatchObject({ kind: 'visual' });
    expect(fallbackInstruction(await heritage(), 'make the background color a little darker')).toMatchObject({ kind: 'visual' });
  });

  it('combines several requests into one plan', async () => {
    const p = await heritage();
    const plan = fallbackInstruction(p, 'make the text bigger and move the photo up, then make the etching deeper');
    expect(plan).toMatchObject({ kind: 'edit', layoutPatch: { textScale: 1.18 }, imageEdit: 'make the etching deeper' });
    const mixed = fallbackInstruction(p, 'use double line and change Founder to Chairman');
    expect(mixed).toMatchObject({ kind: 'edit', specPatch: { border: 'double-line' }, wordingEdits: [{ op: 'replace_text', from: 'Founder', to: 'Chairman' }] });
  });

  it('still refuses catalog limits inside a combined request', async () => {
    expect(fallbackInstruction(await heritage(), 'move the text up and use a purple anodized finish').kind).toBe('refuse');
  });

  it('applies relative layout changes to one column only, within limits', async () => {
    const p = await heritage();
    applyPlan(p, { kind: 'edit', restated: 'bigger', layoutPatch: { textScale: 1.2 } }, 'classic');
    applyPlan(p, { kind: 'edit', restated: 'bigger', layoutPatch: { textScale: 1.2, verticalOffset: -0.5 } }, 'classic');
    expect(p.layoutAdjust).toEqual({ classic: { textScale: 1.44, verticalOffset: -0.5 } });
    for (let i = 0; i < 5; i++) applyPlan(p, { kind: 'edit', restated: 'bigger', layoutPatch: { textScale: 1.4 } }, 'classic');
    expect(p.layoutAdjust!.classic!.textScale).toBe(1.6);
    expect(p.layoutAdjust!.portrait).toBeUndefined();
  });
});

describe('validating model plans', () => {
  it('accepts layout, styling and image parts together', async () => {
    const p = await heritage();
    const dates = p.wording!.blocks.at(-1)!;
    const raw = {
      kind: 'edit', restated: 'Move text up, smaller last line, deeper etching',
      layoutPatch: { verticalOffset: -0.6 }, imageEdit: 'Make the etched portrait deeper with more detail.',
      wordingEdits: [{ op: 'set_style', blockId: dates.id, style: { size: 0.85 } }],
    };
    expect(validateInstructionPlan(raw, p, 'move the text up, make the last line smaller and the etching deeper')).toMatchObject({ kind: 'edit' });
  });

  it('rejects image-only versions of catalog or wording changes and unrequested options', async () => {
    const p = await heritage();
    expect(() => validateInstructionPlan({ kind: 'edit', restated: 'verde', imageEdit: 'make the finish verde patina' }, p, 'use verde patina')).toThrow();
    expect(() => validateInstructionPlan({ kind: 'edit', restated: 'rename', imageEdit: 'change the name to John Smith' }, p, 'change the name to John Smith')).toThrow();
    expect(() => validateInstructionPlan({ kind: 'edit', restated: 'up', layoutPatch: { verticalOffset: -1 }, specPatch: { font: 'garamond' } }, p, 'move the text up')).toThrow();
    expect(() => validateInstructionPlan({ kind: 'edit', restated: 'paint', imageEdit: 'make the paint blue' }, p, 'use a blue paint')).toThrow();
  });

  it('allows a whole-line replacement when the request names the line and the new text', async () => {
    const p = await heritage();
    const name = p.wording!.blocks[0];
    const raw = { kind: 'edit', restated: 'rename', wordingEdits: [{ op: 'replace_text', blockId: name.id, from: name.text, to: 'John Smith' }] };
    expect(validateInstructionPlan(raw, p, 'change the name to John Smith')).toMatchObject({ kind: 'edit' });
  });
});

describe('live planner (stubbed OpenAI)', () => {
  afterEach(() => { config.mockAI = true; create.mockReset(); });

  it('uses the planner model first and feeds a rejected plan back once', async () => {
    config.mockAI = false;
    const key = config.openaiKey;
    config.openaiKey = 'test';
    try {
      create
        .mockResolvedValueOnce({ output_text: JSON.stringify({ kind: 'edit', restated: 'x', imageEdit: 'make the finish verde patina' }) })
        .mockResolvedValueOnce({ output_text: JSON.stringify({ kind: 'edit', restated: 'Use Verde Patina; move text up', specPatch: { finish: 'verde-patina' }, layoutPatch: { verticalOffset: -0.5 } }) });
      const plan = await planInstruction(await heritage(), { preset: 'classic' } as ConceptRecord, 'use verde patina and move the text up');
      expect(plan).toMatchObject({ kind: 'edit', specPatch: { finish: 'verde-patina' }, layoutPatch: { verticalOffset: -0.5 } });
      expect(create.mock.calls[0][0].model).toBe(config.plannerModel);
      expect(JSON.parse(create.mock.calls[1][0].input).previousPlanRejected).toBeTruthy();
    } finally { config.openaiKey = key; }
  });

  it('falls back to the vision model, then to the offline planner', async () => {
    config.mockAI = false;
    const key = config.openaiKey;
    config.openaiKey = 'test';
    try {
      create.mockRejectedValue(Object.assign(new Error('model not found'), { status: 404 }));
      const plan = await planInstruction(await heritage(), { preset: 'classic' } as ConceptRecord, 'move the text up');
      expect(create.mock.calls.map((c) => c[0].model)).toEqual([config.plannerModel, config.visionModel]);
      expect(plan).toMatchObject({ kind: 'edit', layoutPatch: { verticalOffset: -0.5 } });
    } finally { config.openaiKey = key; }
  });
});

describe('fix route with larger edits (demo mode)', () => {
  let server: Server;
  let base: string;
  let cookie: string;
  beforeAll(async () => {
    const app = express();
    app.use('/api', api);
    server = await new Promise<Server>((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing test address');
    base = `http://127.0.0.1:${address.port}/api`;
    const login = await fetch(`${base}/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Test', password: config.appPassword }) });
    cookie = login.headers.get('set-cookie')!.split(';')[0];
  });
  afterAll(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); });
  const post = (url: string, body = {}) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify(body) });
  async function fixture() {
    const p = await createExampleJob('32241-edwin-feulner', 'Test');
    const c = newConceptRecord(p, { preset: 'classic', kind: 'concept', batchId: newId('b'), status: 'done', hasImage: true });
    saveConcept(c);
    const dir = (await import('../server/ai/pipeline')).conceptFile(c, 'image.png');
    const { default: sharp } = await import('sharp');
    fs.writeFileSync(dir, await sharp({ create: { width: 400, height: 600, channels: 3, background: '#c49a6c' } }).png().toBuffer());
    return { p, c };
  }

  it('moves and spaces the layout for this column, re-renders from the new drawing, and undoes', async () => {
    const { p, c } = await fixture();
    const before = layoutFor(p, 'classic');
    const res = await post(`/concepts/${c.id}/fix`, { instruction: 'move the text up and spread it out a bit more' });
    expect(res.status).toBe(200);
    await res.text();
    const version = listConcepts(p.id).at(-1)!;
    expect(version).toMatchObject({ kind: 'fix', status: 'done', plan: { kind: 'edit' } });
    expect(version.prompt).toContain('NEW LAYOUT');
    const changed = getProject(p.id)!;
    expect(changed.layoutAdjust?.classic).toMatchObject({ verticalOffset: -0.5, spacing: 1.12 });
    expect(changed.layoutAdjust?.portrait).toBeUndefined();
    expect(layoutFor(changed, 'classic').imageFrame!.outer.y).toBeLessThan(before.imageFrame!.outer.y);
    expect(layoutFor(changed, 'portrait')).toEqual(layoutFor(p, 'portrait'));
    expect((await post(`/concepts/${version.id}/undo`)).status).toBe(200);
    expect(getProject(p.id)!.layoutAdjust?.classic).toBeUndefined();
  });

  it('makes an image-only change without touching the order', async () => {
    const { p, c } = await fixture();
    const res = await post(`/concepts/${c.id}/fix`, { instruction: 'make the etching deeper and more detailed' });
    expect(res.status).toBe(200);
    await res.text();
    const version = listConcepts(p.id).at(-1)!;
    expect(version).toMatchObject({ kind: 'fix', status: 'done', plan: { kind: 'visual' } });
    expect(version.prompt).toContain('make the etching deeper and more detailed');
    expect(getProject(p.id)!.layoutAdjust).toBeUndefined();
    expect(getProject(p.id)!.spec).toEqual(p.spec);
  });
});
