import fs from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import { fromRoot } from '../server/config';
import { getCatalog } from '../server/catalog';
import { createExampleJob } from '../server/examples';
import { buildReferences, layoutDrawing, layoutFor, newConceptRecord, runConcept } from '../server/ai/pipeline';
import { designContext, designLibrary, designReferences, readDesignLibrary, selectDesignExamples } from '../server/ai/design-library';
import { buildConceptPrompt, buildFixPrompt, buildRelayoutPrompt, promptVersion } from '../server/ai/prompts';
import { imageAdapter } from '../server/ai/images';

const fixture = () => createExampleJob('32241-edwin-feulner', 'Design library');
const sourceNames = fs.readdirSync(fromRoot('references/general-purpose-examples')).filter((f) => f.endsWith('.png')).sort();

describe('reviewed Impact Signs library', () => {
  it('verifies all 25 compact, shipped image files without needing original screenshots', async () => {
    const library = designLibrary();
    expect(library.examples).toHaveLength(25);
    let bytes = 0;
    for (const e of library.examples) {
      const file = library.images.get(e.id)!;
      const metadata = await sharp(file).metadata();
      expect(metadata.format).toBe('webp');
      expect(Math.max(metadata.width!, metadata.height!)).toBeLessThanOrEqual(768);
      bytes += file.length;
    }
    expect(bytes).toBeLessThan(4 * 1024 * 1024);
    expect(designLibrary()).toBe(library); // one bounded cache per process
  });

  it.skipIf(!sourceNames.length)('indexes every locally supplied original and checks source provenance', () => {
    const library = designLibrary();
    expect(library.examples.map((e) => e.source).sort()).toEqual(sourceNames);
    for (const e of library.examples) {
      const original = fs.readFileSync(fromRoot('references/general-purpose-examples', e.source));
      expect(crypto.createHash('sha256').update(original).digest('hex')).toBe(e.sourceSha256);
    }
  });

  it.each(['missing-index', 'missing-image', 'changed-image', 'bad-catalog-id', 'duplicate-id', 'unsafe-path'])('reports a %s library before a render can proceed', (damage) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'impact-library-'));
    try {
      const example = structuredClone(designLibrary().examples[0]);
      const images = [example];
      fs.writeFileSync(path.join(dir, example.asset), designLibrary().images.get(example.id)!);
      if (damage === 'missing-image') fs.unlinkSync(path.join(dir, example.asset));
      if (damage === 'changed-image') fs.writeFileSync(path.join(dir, example.asset), 'damaged image');
      if (damage === 'bad-catalog-id') example.imageOptions = ['halftone-uv-invented'];
      if (damage === 'duplicate-id') images.push(example);
      if (damage === 'unsafe-path') example.asset = '../outside.webp';
      if (damage !== 'missing-index') fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify({ version: 1, examples: images }));
      expect(() => readDesignLibrary(dir)).toThrow('design examples are missing or damaged');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  it.each(getCatalog().imageOptions.map((o) => o.id))('matches %s without incompatible photo treatments or duplicate views', async (treatment) => {
    const p = await fixture();
    p.spec = { ...p.spec!, imageOption: treatment };
    const layout = layoutFor(p, 'classic');
    const examples = selectDesignExamples(p.spec, layout);
    expect(examples).toHaveLength(3);
    expect(new Set(examples.map((e) => e.family)).size).toBe(examples.length);
    const target = layout.imageFrames.length ? treatment : 'none';
    for (const e of examples) expect(e.imageOptions.includes(target) || e.imageOptions.includes('none')).toBe(true);
    if (designLibrary().examples.some((e) => e.imageOptions.includes(target))) expect(examples[0].imageOptions).toContain(target);
    expect(selectDesignExamples(p.spec, layout)).toEqual(examples);
  });

  it('prioritizes the actual color photo and keeps ambiguous tonal/mixed processes out of treatment guidance', async () => {
    const p = await fixture();
    p.spec = { ...p.spec!, imageOption: 'full-color-uv', widthIn: 18, heightIn: 12 };
    const selected = selectDesignExamples(p.spec, layoutFor(p, 'statement'));
    expect(selected[0].id).toBe('schwartz');
    expect(selected.slice(1).every((e) => e.imageOptions.includes('none'))).toBe(true);
    const uncertain = designLibrary().examples.filter((e) => !e.imageOptions.length);
    expect(uncertain.map((e) => e.id)).toEqual(['bee-murphy', 'faa', 'september-memorial']);
  });

  it.each([-1, 0, 1, 2, 3, 12])('respects %s available slots and never exceeds three references', async (room) => {
    const p = await fixture();
    expect(designReferences(p.spec!, layoutFor(p, 'classic'), room)).toHaveLength(Math.min(3, Math.max(0, room)));
  });

  it('keeps layout/customer/catalog references intact and appends labeled style evidence', async () => {
    const p = await fixture();
    const layout = layoutFor(p, 'statement');
    const drawing = await layoutDrawing(p, layout, 400, 600);
    const baseline = await buildReferences(p, layout, drawing, false);
    const refs = await buildReferences(p, layout, drawing);
    expect(refs.slice(0, baseline.length)).toEqual(baseline);
    expect(refs[0].file).toBe(drawing);
    expect(refs.slice(baseline.length).every((r) => r.designExample && r.role.includes('never copy its wording'))).toBe(true);
    const prompt = buildConceptPrompt(p.spec!, layout, refs, { logoCount: 0 });
    expect(prompt).toContain('IMPACT SIGNS DESIGN JUDGMENT');
    expect(prompt).toContain('customer artwork, swatches and Reference 1 override');
    refs.forEach((r, i) => expect(prompt).toContain(`Reference ${i + 1}: ${r.role}`));
    expect(prompt).toContain(layout.lines[0].text);
    expect(designContext(refs).examples).toHaveLength(3);
    expect(promptVersion()).toMatch(/^[a-f0-9]{8}$/);
    // Focused edits never acquire a conflicting redesign instruction.
    expect(buildFixPrompt('slightly darker')).not.toContain('DESIGN JUDGMENT');
    expect(buildRelayoutPrompt('more spacing', undefined, layout)).not.toContain('DESIGN JUDGMENT');
  });

  it('saves evidence and honest skipped review on new versions, without extra renders or wording changes', async () => {
    const p = await fixture();
    const before = structuredClone(p);
    const c = newConceptRecord(p, { preset: 'classic', kind: 'concept', batchId: 'design-test' });
    const run = vi.spyOn(imageAdapter(), 'run');
    try {
      await runConcept(p, c, { onUpdate() {}, onPartial() {} });
      expect(run).toHaveBeenCalledTimes(1);
      expect(c.status).toBe('done');
      expect(c.designContext?.examples).toHaveLength(3);
      expect(c.designReview).toMatchObject({ ok: false, checked: false, checks: [] });
      expect(c.designReview?.message).toContain('demo mode');
      expect(p).toEqual(before);
    } finally { run.mockRestore(); }
  });
});
