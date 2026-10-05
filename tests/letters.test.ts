// Letters are never cast smaller than 1/4": the layout engine raises such lines, so the
// image, the proof and the vector production file all show the same (larger) letters.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { computeLayout, letterRatio, MIN_LETTER_IN } from '../server/layout/engine';
import { parseSpec } from '../server/parse/spec';
import { resolveFont } from '../server/text/fonts';
import { preflight } from '../server/pdf/preflight';
import { buildProductionPdf } from '../server/pdf/production';
import type { Wording } from '../shared/types';

const REF = path.resolve('references');
const spec = (dir: string) => parseSpec(fs.readFileSync(path.join(REF, dir, 'spec.txt'), 'utf8')).spec;
const wording = (dir: string): Wording => ({ blocks: (JSON.parse(fs.readFileSync(path.join(REF, dir, 'wording.json'), 'utf8')) as Omit<Wording['blocks'][number], 'id'>[]).map((b, i) => ({ ...b, id: `w${i}` })), notes: [] });

describe('minimum letter height', () => {
  it('Raccoon River: the small body lines are raised to 1/4" and the layout says so', () => {
    const l = computeLayout({ spec: spec('32885-raccoon-river'), wording: wording('32885-raccoon-river'), photos: [{ aspect: 0.8 }] }, 'classic');
    expect(l.minLetterIn).toBeGreaterThanOrEqual(MIN_LETTER_IN - 1e-3);
    expect(l.warnings.find((w) => /enlarged to the ¼" minimum/.test(w))).toMatch(/line(s were| was) enlarged/);
    expect(l.warnings.some((w) => /casting minimum/.test(w))).toBe(false);
    // Every line that has letters is at least 1/4"; the floor is per line, not a global scale.
    for (const line of l.lines) {
      const ratio = letterRatio(resolveFont(spec('32885-raccoon-river').font).font, line.text, line.style);
      if (ratio) expect(ratio * line.size, line.text).toBeGreaterThanOrEqual(MIN_LETTER_IN - 1e-3);
    }
  });

  it('digits count as capitals; punctuation alone has no minimum', () => {
    const s = spec('32885-raccoon-river');
    const face = resolveFont(s.font).font;
    expect(letterRatio(face, '2025', undefined)).toBe(letterRatio(face, 'ABC', undefined));
    expect(letterRatio(face, '— · —', undefined)).toBeNull();
    expect(letterRatio(face, 'ABC', undefined)).toBeGreaterThan(letterRatio(face, 'abc', undefined)!);
    const many: Wording = { blocks: [{ id: 'h', role: 'headline', text: 'Donors' }, ...Array.from({ length: 30 }, (_, i) => ({ id: `b${i}`, role: 'body' as const, text: '· · ·' }))], notes: [] };
    const l = computeLayout({ spec: { ...s, widthIn: 6, heightIn: 4 }, wording: many }, 'classic');
    // The dot lines shrink to fit; only "Donors" is held at the minimum.
    const dots = l.lines.filter((x) => /^[· ]+$/.test(x.text));
    expect(dots.length).toBe(30);
    expect(Math.max(...dots.map((x) => x.size))).toBeLessThan(l.lines.find((x) => x.text === 'Donors')!.size);
  });

  it('lines held at the minimum never run into each other (Audubon 8x6)', () => {
    const s = spec('32782-audubon');
    const l = computeLayout({ spec: s, wording: wording('32782-audubon') }, 'classic');
    const lines = [...l.lines].sort((a, b) => a.baseline - b.baseline);
    for (let i = 1; i < lines.length; i++) {
      const prev = lines[i - 1];
      const cur = lines[i];
      // The next baseline sits below the previous line's descent plus its own cap height.
      expect(cur.baseline - prev.baseline, `${prev.text} → ${cur.text}`).toBeGreaterThanOrEqual(0.28 * prev.size + 0.66 * cur.size - 1e-6);
    }
    expect(l.minLetterIn).toBeGreaterThanOrEqual(MIN_LETTER_IN - 1e-3);
  });

  it('says plainly when the wording cannot fit at the minimum', () => {
    const s = spec('32885-raccoon-river');
    const long: Wording = { blocks: Array.from({ length: 40 }, (_, i) => ({ id: `b${i}`, role: 'body' as const, text: `Line ${i + 1} of a very long dedication that will not fit on a small plaque` })), notes: [] };
    const l = computeLayout({ spec: { ...s, widthIn: 6, heightIn: 4 }, wording: long }, 'classic');
    expect(l.warnings.join(' ')).toMatch(/At the ¼" minimum letter height the wording does not fit/);
    expect(l.minLetterIn).toBeGreaterThanOrEqual(MIN_LETTER_IN - 1e-3);
  });

  it('the production file reports the letters as at least 1/4"', async () => {
    const s = spec('32885-raccoon-river');
    const layout = computeLayout({ spec: s, wording: wording('32885-raccoon-river'), photos: [{ aspect: 0.8 }] }, 'classic');
    const r = await buildProductionPdf({ jobNumber: '32885', name: 'Raccoon', spec: s, layout });
    const check = (await preflight(r.pdf, layout, { fontLicensed: true })).find((c) => c.label === 'Letter heights')!;
    expect(check.ok).toBe(true);
    expect(check.detail).toMatch(/at least ¼" tall/);
    expect(check.detail).toMatch(/enlarged/);
  });
});
