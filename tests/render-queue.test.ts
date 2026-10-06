import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';

/** A spelling check that can be held open, to see what happens while one is slow. */
const spelling = vi.hoisted(() => ({ hold: null as Promise<void> | null }));
vi.mock('../server/ai/spellcheck', async (orig) => {
  const real = await orig<typeof import('../server/ai/spellcheck')>();
  return { ...real, spellcheckImage: async (...args: Parameters<typeof real.spellcheckImage>) => {
    if (spelling.hold) await spelling.hold;
    return real.spellcheckImage(...args);
  } };
});

const { config } = await import('../server/config');
const { createExampleJob } = await import('../server/examples');
const { getConcept, listConcepts, newId, saveConcept, spentToday } = await import('../server/db');
const { checkLimits, newConceptRecord, runConcept } = await import('../server/ai/pipeline');
const { imageAdapter } = await import('../server/ai/images');

/** Renders from every designer share one small server: only a few may run at once. */
describe('render queue', () => {
  async function renderThree(limit: number) {
    const before = config.maxParallelImages;
    config.maxParallelImages = limit;
    const adapter = imageAdapter();
    const real = adapter.run.bind(adapter);
    let active = 0;
    let peak = 0;
    const spy = vi.spyOn(adapter, 'run').mockImplementation(async (req) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 40));
      try { return await real(req); } finally { active--; }
    });
    try {
      const p = await createExampleJob('32241-edwin-feulner', 'Test', 'tester');
      const batchId = newId('b');
      const records = (['classic', 'classic', 'classic'] as const).map((preset) => newConceptRecord(p, { preset, kind: 'concept', batchId }));
      await Promise.all(records.map((r) => runConcept(p, r, { onUpdate: () => {}, onPartial: () => {} })));
      return { peak, statuses: listConcepts(p.id).map((c) => c.status) };
    } finally {
      spy.mockRestore();
      config.maxParallelImages = before;
    }
  }

  it('runs one at a time when the limit is 1, and every render still finishes', async () => {
    const { peak, statuses } = await renderThree(1);
    expect(peak).toBe(1);
    expect(statuses).toEqual(['done', 'done', 'done']);
  });

  it('runs two at a time when the limit is 2', async () => {
    const { peak, statuses } = await renderThree(2);
    expect(peak).toBe(2);
    expect(statuses).toEqual(['done', 'done', 'done']);
  });

  it('frees the slot once the image is saved, so a slow spelling check does not block the next render', async () => {
    const before = config.maxParallelImages;
    config.maxParallelImages = 1;
    let open!: () => void;
    spelling.hold = new Promise<void>((r) => { open = r; });
    try {
      const p = await createExampleJob('32241-edwin-feulner', 'Test', 'tester');
      const batchId = newId('b');
      const [a, b] = (['classic', 'classic'] as const).map((preset) => newConceptRecord(p, { preset, kind: 'concept', batchId }));
      const ev = { onUpdate: () => {}, onPartial: () => {} };
      const runs = [runConcept(p, a!, ev), runConcept(p, b!, ev)];
      // Both images are drawn while both spelling checks are still held.
      await vi.waitFor(() => expect([a, b].map((r) => getConcept(r!.id)?.hasImage)).toEqual([true, true]), { timeout: 10_000 });
      open();
      await Promise.all(runs);
      expect([a, b].map((r) => getConcept(r!.id)?.status)).toEqual(['done', 'done']);
    } finally {
      spelling.hold = null;
      open?.();
      config.maxParallelImages = before;
    }
  });

  it('counts a paid image against the budget even when its size is rejected', async () => {
    const adapter = imageAdapter();
    const wrong = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#C49A6C' } }).png().toBuffer();
    const spy = vi.spyOn(adapter, 'run').mockResolvedValue({ png: wrong, usage: { input_tokens: 0, output_tokens: 100_000 }, quality: 'max' });
    try {
      const p = await createExampleJob('32241-edwin-feulner', 'Test', 'tester');
      const spent = spentToday();
      const rec = newConceptRecord(p, { preset: 'classic', kind: 'concept', batchId: newId('b') });
      await runConcept(p, rec, { onUpdate: () => {}, onPartial: () => {} });
      expect(getConcept(rec.id)).toMatchObject({ status: 'error', hasImage: false });
      expect(getConcept(rec.id)!.error).toMatch(/different image size/);
      expect(getConcept(rec.id)!.costUsd).toBeGreaterThan(0);
      expect(spentToday() - spent).toBeCloseTo(getConcept(rec.id)!.costUsd, 6);
    } finally {
      spy.mockRestore();
    }
  });

  it('refuses a whole batch that would pass the job limit, before anything is rendered', async () => {
    const before = config.maxImageCallsPerProject;
    try {
      const p = await createExampleJob('32241-edwin-feulner', 'Test', 'tester');
      saveConcept({ ...newConceptRecord(p, { preset: 'classic', kind: 'concept', batchId: newId('b') }), status: 'done' });
      config.maxImageCallsPerProject = 2;
      expect(() => checkLimits(p.id)).not.toThrow();
      expect(() => checkLimits(p.id, undefined, 2)).toThrow(/room for 1 more image/);
      config.maxImageCallsPerProject = 1;
      expect(() => checkLimits(p.id, undefined, 2)).toThrow(/reached its limit of 1/);
    } finally {
      config.maxImageCallsPerProject = before;
    }
  });
});
