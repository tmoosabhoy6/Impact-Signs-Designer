// Text-heavy plaques (donor walls): the vector production file must match the layout, the
// layout must fit the plaque (or say plainly that it cannot), and the customer's words must
// come through character for character. Offline; the picture comparison needs Poppler.
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { computeLayout } from '../server/layout/engine';
import { layoutProblems, lineBox, textArea } from '../server/layout/check';
import { parseSpec } from '../server/parse/spec';
import { parseWording } from '../server/parse/wording';
import { preflight } from '../server/pdf/preflight';
import { buildProductionPdf } from '../server/pdf/production';
import type { LayoutPresetId, PlaqueSpec, Rect, Wording, WordingBlock } from '../shared/types';

const FIRST = ['Margaret', 'Thomas', 'Priya', 'Jean-Luc', 'Aoife', 'Mehmet', 'Dr. Ann', 'Ngozi', 'José', 'Wei'];
const LAST = ['Whitfield', 'Okonkwo', 'Raghunathan', 'Beaumont-Laurent', "O'Sullivan", 'Yılmaz', 'Nakamura', 'Fitzgerald-Hughes', 'García', 'Lindqvist'];
const SHORT = (i: number) => `${FIRST[i % 10]} ${LAST[(i * 3 + 1) % 10]}`;
const LONG = (i: number) => `${FIRST[i % 10]} & ${FIRST[(i + 4) % 10]} ${LAST[(i * 3 + 1) % 10]}-${LAST[(i + 7) % 10]}`;
const names = (n: number, make = SHORT) => Array.from({ length: n }, (_, i) => `${make(i)}${i >= 10 ? ` ${i}` : ''}`);

function plaque(size: string, font = 'Times New Roman', extra = ''): PlaqueSpec {
  return parseSpec(`Qty 1 ${size} cast bronze plaque. Natural satin brushed finish. Dark oxide background. Single line border. ${font}. Blind studs. ${extra}`).spec;
}
const wordingOf = (lines: string[]): Wording => parseWording(lines.join('\n'));
const texts = (w: Wording) => w.blocks.flatMap((b) => b.text.split('\n'));
/** Every character of the customer's wording, once, whatever the line breaks: nothing lost, added or changed. */
const letters = (lines: string[]) => lines.join('').replace(/\s/g, '').split('').sort().join('');

const hasPoppler = spawnSync('pdftocairo', ['-v']).error == null;

// ---------- layout: donor lists ----------

describe('donor lists: the layout fits the plaque or says it cannot', () => {
  const sizes = ['8" x 12"', '12" x 18"', '18" x 24"', '24" x 36"', '36" x 48"', '48" x 24"'];
  const counts = [10, 24, 48, 90];
  const presets: LayoutPresetId[] = ['classic', 'portrait', 'statement'];

  for (const size of sizes) {
    for (const n of counts) {
      for (const make of [SHORT, LONG]) {
        it(`${size}, ${n} ${make === SHORT ? 'short' : 'long'} names, text only`, () => {
          const spec = plaque(size);
          const wording = wordingOf(['OUR DONORS', 'With gratitude', ...names(n, make), 'Dedicated 2025']);
          const layout = computeLayout({ spec, wording }, 'classic');
          // Every line sits on the plaque, whatever the list: the vector file is always usable.
          expect(layoutProblems(layout, spec.font), layout.warnings.join(' | ')).toEqual([]);
          // Below the ¼" minimum only when it cannot be helped, and then it says so.
          if ((layout.minLetterIn ?? 1) < 0.249) expect(layout.warnings.join(' ')).toMatch(/letters were made smaller to fit/);
          expect(letters(layout.lines.map((l) => l.text))).toBe(letters(texts(wording)));
        });
      }
    }
  }

  for (const preset of presets) {
    it(`${preset}: 40 names with a photo and a logo fit inside a 24" x 36" plaque`, () => {
      const spec = { ...plaque('24" x 36"'), imageOption: 'photo-relief' } as PlaqueSpec;
      const wording = wordingOf(['THE FOUNDERS CIRCLE', 'Thank you', ...names(40), 'Established 1998']);
      const layout = computeLayout({ spec, wording, photos: [{ id: 'p1', aspect: 0.8 }], logos: [{ id: 'l1', aspect: 2.4 }] }, preset);
      expect(layout.warnings.filter((w) => /run past|overlap|does not fit/.test(w)), layout.warnings.join(' | ')).toEqual([]);
      expect(layoutProblems(layout, spec.font)).toEqual([]);
      expect(layout.minLetterIn!).toBeGreaterThanOrEqual(0.25 - 1e-3);
    });
  }

  it('a long single-column list becomes columns, at a larger type than one column allows', () => {
    const spec = plaque('24" x 36"');
    const wording = wordingOf(['OUR DONORS', ...names(48)]);
    const layout = computeLayout({ spec, wording }, 'classic');
    const xs = new Set(layout.lines.filter((l) => /\d$/.test(l.text) || l.role === 'body').map((l) => Math.round(l.cx)));
    expect(xs.size).toBeGreaterThan(1);
    expect(layout.warnings.some((w) => /does not fit|run past/.test(w))).toBe(false);
  });

  it('keeps names that fit comfortably in one column as pasted (fewer than 8 stay as they are)', () => {
    const spec = plaque('12" x 18"');
    const layout = computeLayout({ spec, wording: wordingOf(['OUR DONORS', ...names(6)]) }, 'classic');
    expect(new Set(layout.lines.map((l) => Math.round(l.cx * 100))).size).toBe(1);
  });

  it('does not turn sentences into a list', () => {
    const spec = plaque('24" x 36"');
    const paragraphs = Array.from({ length: 9 }, (_, i) => `This paragraph number ${i} is a whole sentence about the donor program and it ends here.`);
    const layout = computeLayout({ spec, wording: wordingOf(['TITLE', ...paragraphs]) }, 'classic');
    expect(new Set(layout.lines.map((l) => Math.round(l.cx * 100))).size).toBe(1);
  });

  it('leaves columns the designer already chose alone', () => {
    const spec = plaque('24" x 36"');
    const blocks: WordingBlock[] = [
      { id: 'h', role: 'headline', text: 'DONORS' },
      { id: 'b', role: 'body', text: names(12).join('\n'), style: { columns: 3 } },
    ];
    const layout = computeLayout({ spec, wording: { blocks, notes: [] } }, 'classic');
    const body = layout.lines.filter((l) => l.role === 'body');
    expect(new Set(body.map((l) => Math.round(l.cx * 100))).size).toBe(3);
  });

  it('tiers (a heading over each group of names) are each set in columns and all fit', () => {
    const spec = plaque('36" x 48"');
    const wording = wordingOf(['OUR SUPPORTERS', 'PLATINUM', ...names(10), 'GOLD', ...names(20, LONG), 'SILVER', ...names(24)]);
    const layout = computeLayout({ spec, wording }, 'classic');
    expect(layoutProblems(layout, spec.font), layout.warnings.join(' | ')).toEqual([]);
    expect(letters(layout.lines.map((l) => l.text))).toBe(letters(texts(wording)));
    // Each tier heading stands alone on the centerline; the names under it are set in columns.
    for (const tier of ['PLATINUM', 'GOLD', 'SILVER']) {
      expect(layout.lines.find((l) => l.text === tier)!.cx, tier).toBeCloseTo(layout.widthIn / 2, 1);
    }
    const under = layout.lines.filter((l) => l.role === 'body' && !/^[A-Z]+$/.test(l.text));
    expect(new Set(under.map((l) => Math.round(l.cx))).size).toBeGreaterThan(1);
  });

  it('a list written entirely in capitals is still one list, not a pile of headings', () => {
    const spec = plaque('24" x 36"');
    const wording = wordingOf(['DONORS', ...names(40).map((n) => n.toUpperCase())]);
    const layout = computeLayout({ spec, wording }, 'classic');
    expect(new Set(layout.lines.filter((l) => l.role === 'body').map((l) => Math.round(l.cx))).size).toBeGreaterThan(1);
    expect(layoutProblems(layout, spec.font)).toEqual([]);
  });

  it('designer wording with odd punctuation and accents is kept as written', () => {
    const spec = plaque('24" x 36"');
    const odd = ['José & María García-López', "Dr. O'Sullivan, Jr.", 'Ünal Yılmaz', 'The “Smith” Family', 'A.B. & C.D. Lee', 'Estate of J. Nakamura', 'Wei Lindqvist', 'Ngozi O. Okonkwo', 'M. Fitzgerald-Hughes'];
    const wording = wordingOf(['DONORS', ...odd]);
    const layout = computeLayout({ spec, wording }, 'classic');
    expect(layout.lines.map((l) => l.text).sort()).toEqual([...texts(wording)].sort());
  });

  it('a list that cannot be cast at 1/4" is set smaller to fit, says so, and still makes a usable vector file', async () => {
    const spec = plaque('12" x 18"');
    const layout = computeLayout({ spec, wording: wordingOf(['OUR DONORS', ...names(80, LONG)]) }, 'classic');
    expect(layout.warnings.join(' ')).toMatch(/does not fit this 12" x 18" plaque, so the letters were made smaller to fit/);
    expect(layout.minLetterIn).toBeLessThan(0.25);
    expect(layoutProblems(layout, spec.font)).toEqual([]);
    const r = await buildProductionPdf({ jobNumber: '1', name: 'x', spec, layout });
    const checks = await preflight(r.pdf, layout, { fontLicensed: true });
    expect(checks.filter((c) => !c.ok && !c.warnOnly)).toEqual([]);
    const letterCheck = checks.find((c) => c.label === 'Letter heights')!;
    expect(letterCheck.ok).toBe(false);
    expect(letterCheck.warnOnly).toBe(true);
    expect(letterCheck.detail).toMatch(/below the ¼" casting minimum/);
  });

  // Job 6 (Varnermiller Pavilion), whose vector file ran off the plate before.
  const VARNERMILLER = ['VARNERMILLER PAVILION', 'Gifted by the Leadership Dorchester Class of 2026', 'Made possible, in part, through the generous contributions of:',
    '$15,000+', 'Richard & Lori Miller', '$7,500-$14,999', 'The Bastion Group', 'Frampton Construction', 'Lutes Electrical', 'REV Federal Credit Union', 'SLS Siteworks', 'Thomas & Hutton',
    '$2,500-$7,499', 'Blue Cross Blue Shield of SC', 'Modern Woodmen of America', 'Pratt Family Foundation',
    '$1,000-$2,499', 'Appraisal Services of SC', 'Dorchester Seniors', 'HCA Healthcare', 'Home Telecom', 'Leadership Dorchester c/o 2025', 'United Community',
    '$500-$999', 'Anthony Pope', 'Lowcountry Conference Center', 'Player’s Place Billiards', 'Summerville Country Club', 'The Village at Summerville', 'Winfield Entertainment',
    '$100-$499', 'Anna McSwain', 'Ashley Greene', 'Beth Hicks', 'Billy Lee', 'Break Point Cola', 'Brittany VanAllen', 'The Cookie Chick', 'Donna Gamble', 'Dustin Fuller', 'Jason Chambles', 'Matt Mullin', 'Tonja Willey'];

  for (const preset of ['classic', 'statement'] as const) {
    it(`${preset}: a tiered donor wall on 18" x 12" fits, keeps every word, and keeps each gift level with its names`, async () => {
      const spec = plaque('18" x 12"');
      const wording = wordingOf(VARNERMILLER);
      const layout = computeLayout({ spec, wording }, preset);
      expect(layoutProblems(layout, spec.font)).toEqual([]);
      expect(letters(layout.lines.map((l) => l.text))).toBe(letters(VARNERMILLER));
      const at = (t: string) => layout.lines.find((l) => l.text === t)!;
      // Three columns, broken between gift levels as Impact Signs sets them.
      const left = at('$15,000+').cx;
      expect(at('$1,000-$2,499').cx).toBeGreaterThan(left + 3);
      expect(at('$100-$499').cx).toBeGreaterThan(at('$1,000-$2,499').cx + 3);
      for (const [heading, first] of [['$7,500-$14,999', 'The Bastion Group'], ['$2,500-$7,499', 'Blue Cross Blue Shield of SC'], ['$500-$999', 'Anthony Pope'], ['$1,000-$2,499', 'Appraisal Services of SC'], ['$100-$499', 'Anna McSwain']]) {
        // A heading is never alone at the foot of a column: its first name is right below it.
        expect(at(first!).cx, heading).toBeCloseTo(at(heading!).cx, 6);
        expect(at(first!).baseline, heading).toBeGreaterThan(at(heading!).baseline);
      }
      // Each column's top is a gift level.
      for (const heading of ['$15,000+', '$1,000-$2,499', '$100-$499']) {
        // The middle column shares its center with the title: look at the list only.
        const col = layout.lines.filter((l) => VARNERMILLER.indexOf(l.text) >= 3 && Math.abs(l.cx - at(heading).cx) < 1e-6);
        expect(Math.min(...col.map((l) => l.baseline))).toBeCloseTo(at(heading).baseline, 6);
      }
      const r = await buildProductionPdf({ jobNumber: '6', name: 'Varnermiller', spec, layout });
      const checks = await preflight(r.pdf, layout, { fontLicensed: true });
      expect(checks.filter((c) => !c.ok && !c.warnOnly)).toEqual([]);
    });
  }

  it('a donor plaque that fits passes every preflight check', async () => {
    const spec = plaque('24" x 36"');
    const layout = computeLayout({ spec, wording: wordingOf(['OUR DONORS', ...names(48)]) }, 'classic');
    const r = await buildProductionPdf({ jobNumber: '1', name: 'x', spec, layout });
    const checks = await preflight(r.pdf, layout, { fontLicensed: true });
    expect(checks.filter((c) => !c.ok && !c.warnOnly)).toEqual([]);
    expect(checks.find((c) => c.label === 'Everything fits on the plaque')!.ok).toBe(true);
  });
});

describe('layout check', () => {
  it('flags text outside the plaque, overlapping lines, and text on a photo', () => {
    const spec = plaque('12" x 18"');
    const base = computeLayout({ spec, wording: wordingOf(['TITLE', 'one line of text']) }, 'classic');
    expect(layoutProblems(base, spec.font)).toEqual([]);
    const off = { ...base, lines: base.lines.map((l, i) => (i ? { ...l, baseline: base.heightIn + 3 } : l)) };
    expect(layoutProblems(off, spec.font).join(' ')).toMatch(/run past the edge/);
    const stacked = { ...base, lines: base.lines.map((l) => ({ ...l, baseline: base.lines[0].baseline })) };
    expect(layoutProblems(stacked, spec.font).join(' ')).toMatch(/overlap/);
    const box = lineBox(base.lines[0], spec.font);
    const onPhoto = { ...base, imageFrames: [{ outer: box, inner: box, orientation: 'square' as const }] };
    expect(layoutProblems(onPhoto, spec.font).join(' ')).toMatch(/photo or logo/);
  });
});

// ---------- the vector file shows the layout ----------

/** Dark pixels of the page at 40 pixels per inch, as a grid. */
async function inkMap(pdf: Buffer, widthIn: number, heightIn: number) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'donor-'));
  try {
    fs.writeFileSync(path.join(dir, 'p.pdf'), pdf);
    execFileSync('pdftocairo', ['-png', '-singlefile', '-r', '40', path.join(dir, 'p.pdf'), path.join(dir, 'p')]);
    const { data, info } = await sharp(path.join(dir, 'p.png')).flatten({ background: '#ffffff' }).greyscale().raw().toBuffer({ resolveWithObject: true });
    expect(Math.abs(info.width - widthIn * 40)).toBeLessThanOrEqual(1);
    expect(Math.abs(info.height - heightIn * 40)).toBeLessThanOrEqual(1);
    return { data, w: info.width, h: info.height };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe.skipIf(!hasPoppler)('donor plaques: the production PDF is the layout, drawn', () => {
  const cases: { name: string; size: string; lines: string[]; preset: LayoutPresetId; font?: string; photo?: boolean }[] = [
    { name: '24x36, 48 names', size: '24" x 36"', lines: ['OUR DONORS', 'Thank you', ...names(48), 'Dedicated 2025'], preset: 'classic' },
    { name: '18x24, 30 long names', size: '18" x 24"', lines: ['FRIENDS OF THE LIBRARY', ...names(30, LONG)], preset: 'classic', font: 'Garamond' },
    { name: '36x48, three tiers', size: '36" x 48"', lines: ['SUPPORTERS', 'PLATINUM', ...names(12), 'GOLD', ...names(30), 'SILVER', ...names(40)], preset: 'classic', font: 'Myriad' },
    { name: '24x36, 40 names beside a photo (Feature Image)', size: '24" x 36"', lines: ['FOUNDERS', 'Thank you', ...names(40)], preset: 'portrait', photo: true },
    { name: '36x24 landscape, 36 names beside a photo', size: '36" x 24"', lines: ['FOUNDERS', 'Thank you', ...names(36)], preset: 'classic', photo: true },
    { name: '24x36, 36 names under a photo (Statement)', size: '24" x 36"', lines: ['FOUNDERS', 'Thank you', ...names(36)], preset: 'statement', photo: true },
  ];

  for (const c of cases) {
    it(c.name, async () => {
      const base = plaque(c.size, c.font);
      const spec = (c.photo ? { ...base, imageOption: 'photo-relief' } : base) as PlaqueSpec;
      const wording = wordingOf(c.lines);
      const layout = computeLayout({ spec, wording, photos: c.photo ? [{ id: 'p', aspect: 0.8 }] : undefined }, c.preset);
      const r = await buildProductionPdf({ jobNumber: '1', name: c.name, spec, layout });
      const checks = await preflight(r.pdf, layout, { fontLicensed: true });
      expect(checks.filter((k) => !k.ok && !k.warnOnly), JSON.stringify(checks.filter((k) => !k.ok))).toEqual([]);

      const { data, w, h } = await inkMap(r.pdf, layout.widthIn, layout.heightIn);
      const ppi = 40;
      const dark = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && data[y * w + x] < 128;
      const countIn = (rect: Rect, pad = 0) => {
        let n = 0;
        for (let y = Math.floor((rect.y - pad) * ppi); y <= Math.ceil((rect.y + rect.h + pad) * ppi); y++)
          for (let x = Math.floor((rect.x - pad) * ppi); x <= Math.ceil((rect.x + rect.w + pad) * ppi); x++) if (dark(x, y)) n++;
        return n;
      };

      // 1. Every line of the layout is on the page where the layout puts it.
      for (const line of layout.lines) {
        const box = lineBox(line, spec.font);
        expect(countIn(box), `"${line.text}" is missing from the PDF`).toBeGreaterThan(0);
      }

      // 2. Nothing else is on the page inside the border: no stray or displaced lettering.
      const area = textArea(layout);
      const allowed: Rect[] = [
        ...layout.lines.map((l) => lineBox(l, spec.font)),
        ...layout.imageFrames.map((f) => f.outer),
        ...layout.logos,
        ...layout.rules,
      ];
      const pad = 0.06;
      let stray = 0;
      for (let y = Math.ceil(area.y * ppi) + 1; y < Math.floor((area.y + area.h) * ppi) - 1; y++) {
        for (let x = Math.ceil(area.x * ppi) + 1; x < Math.floor((area.x + area.w) * ppi) - 1; x++) {
          if (!dark(x, y)) continue;
          const px = x / ppi;
          const py = y / ppi;
          if (!allowed.some((a) => px >= a.x - pad && px <= a.x + a.w + pad && py >= a.y - pad && py <= a.y + a.h + pad)) stray++;
        }
      }
      expect(stray, 'ink in the PDF that is not in the layout').toBe(0);

      // 3. The border band is solid metal all the way round.
      const band = layout.border.widthIn;
      for (const [x, y] of [[w / 2, band * ppi * 0.5], [w / 2, h - band * ppi * 0.5], [band * ppi * 0.5, h / 2], [w - band * ppi * 0.5, h / 2]]) expect(dark(Math.round(x), Math.round(y))).toBe(true);
    });
  }
});
