import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { capHeightRatio, computeAllLayouts, computeLayout } from '../server/layout/engine';
import { parseSpec } from '../server/parse/spec';
import { loadFontFile, measure } from '../server/text/fonts';
import type { Wording } from '../shared/types';

const spec = parseSpec(fs.readFileSync('references/32241-edwin-feulner/spec.txt', 'utf8')).spec;
const wording: Wording = { notes: [], blocks: [
  { id: 'h', role: 'headline', text: 'IN HONOR OF' },
  { id: 's', role: 'subhead', text: 'JANE SMITH' },
  { id: 'b', role: 'body', text: 'Her dedication and kindness inspire our community every day.' },
  { id: 'f', role: 'footer', text: 'With gratitude, 2026' },
] };
const left = (l: ReturnType<typeof computeLayout>['lines'][number]) => l.x ?? l.cx - measure(loadFontFile(l.face!), l.text, l.size, l.style?.smallCaps) / 2;

describe('requested concept arrangements', () => {
  for (const [w, h] of [[12, 18], [18, 12]]) {
    for (const aspect of [0.7, 1.5]) {
      it(`third variation splits the top and puts the body below: ${w}x${h}, photo ${aspect}`, () => {
        const layouts = computeAllLayouts({ spec: { ...spec, widthIn: w, heightIn: h }, wording, photos: [{ aspect }], imageAfterBlock: 2 });
        const l = layouts[2];
        expect(l.preset).toBe('statement');
        const f = l.imageFrames[0].outer;
        const top = l.lines.filter((x) => x.role === 'headline' || x.role === 'subhead');
        expect(top.length).toBeGreaterThanOrEqual(2);
        expect(top.length).toBeLessThanOrEqual(3);
        top.forEach((x) => {
          expect(left(x)).toBeGreaterThan(f.x + f.w);
          expect(x.baseline).toBeLessThan(f.y + f.h);
        });
        // Mirrored column centers, independent of the photo shape or fitting scale.
        expect((f.x + f.w / 2 + top[0].cx) / 2).toBeCloseTo(w / 2, 6);
        top.forEach((x) => expect(x.cx).toBeCloseTo(top[0].cx, 6));
        const first = top[0];
        const last = top[top.length - 1];
        const textTop = first.baseline - capHeightRatio(loadFontFile(first.face!)) * first.size;
        expect(Math.abs((textTop + last.baseline) / 2 - (f.y + f.h / 2))).toBeLessThan(0.1);
        l.lines.filter((x) => x.role === 'body' || x.role === 'footer').forEach((x) => expect(x.baseline - x.size).toBeGreaterThan(f.y + f.h));
        expect(l.lines.map((x) => x.text).join(' ').replace(/\s+/g, ' ')).toBe(wording.blocks.map((x) => x.text).join(' '));
        expect(l.minLetterIn).toBeGreaterThanOrEqual(0.249);
        expect(l.warnings.join(' ')).not.toContain('wording does not fit');
      });
    }
  }
  for (const preset of ['classic', 'portrait'] as const) {
    it(`${preset} landscape puts all text to the right of a portrait photo`, () => {
      const l = computeLayout({ spec: { ...spec, widthIn: 18, heightIn: 12 }, wording, photos: [{ aspect: 0.7 }] }, preset);
      const f = l.imageFrames[0].outer;
      l.lines.forEach((x) => expect(left(x)).toBeGreaterThan(f.x + f.w));
    });
  }
  it('text-only jobs do not acquire a photo', () => {
    expect(computeLayout({ spec: { ...spec, imageOption: 'none' }, wording }, 'statement').imageFrames).toEqual([]);
  });
});
