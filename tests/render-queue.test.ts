import { describe, expect, it, vi } from 'vitest';
import { config } from '../server/config';
import { createExampleJob } from '../server/examples';
import { listConcepts, newId } from '../server/db';
import { newConceptRecord, runConcept } from '../server/ai/pipeline';
import { imageAdapter } from '../server/ai/images';

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
});
