// Golden tests against the real Impact Signs files in references/.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';
import { parseSpec, parseSize } from '../server/parse/spec';
import { docxToText, parseWording } from '../server/parse/wording';
import { computeLayout } from '../server/layout/engine';
import { buildProof } from '../server/pdf/proofs/index';
import { descriptionPlaqueRect } from '../server/pdf/proofs/description';
import { standardPlaqueRect } from '../server/pdf/proofs/standard';
import { etchedPlaqueRect } from '../server/pdf/proofs/etched';
import { dimLabel } from '../server/pdf/proofs/common';
import { autoDescription } from '../server/pdf/proofs/description-text';
import { buildProductionPdf } from '../server/pdf/production';
import { preflight } from '../server/pdf/preflight';
import { compareWording } from '../server/ai/spellcheck';
import { canvasSize } from '../server/ai/images';
import { getCatalog } from '../server/catalog';
import { findAsset } from '../server/assets';
import type { PlaqueSpec, Wording } from '../shared/types';

const REF = 'references';
const spec = (dir: string) => parseSpec(fs.readFileSync(path.join(REF, dir, 'spec.txt'), 'utf8'));
const wordingJson = (dir: string): Wording => ({
  blocks: JSON.parse(fs.readFileSync(path.join(REF, dir, 'wording.json'), 'utf8')).map((b: object, i: number) => ({ id: `w${i}`, ...b })),
  notes: [],
});

async function heritage() {
  const s = spec('32241-edwin-feulner').spec;
  const wording = parseWording(await docxToText(fs.readFileSync(`${REF}/32241-edwin-feulner/Edwin-J.docx`)));
  const layout = computeLayout({ spec: s, wording, photos: [{ aspect: 402 / 450 }] }, 'classic');
  return { spec: s, wording, layout };
}

const png = (w = 60, h = 90) => sharp({ create: { width: w, height: h, channels: 3, background: '#C49A6C' } }).png().toBuffer();

describe('spec parser: every reference order', () => {
  it('reads the Heritage order (Liquid Mercury)', () => {
    const r = spec('32241-edwin-feulner');
    expect(r.spec).toMatchObject({
      material: 'bronze', widthIn: 12, heightIn: 18, finish: 'natural-satin-brushed-bronze', backgroundColor: 'dark-oxide',
      backgroundTexture: 'leatherette', border: 'single-line', font: 'times-new-roman', imageOption: 'photo-relief',
      mounting: 'blind-studs', process: 'cast',
    });
    expect(r.assumed.sort()).toEqual(['border', 'font', 'imageOption']);
    expect(r.unrecognizedLines).toEqual([]);
  });

  const cases: [string, Partial<PlaqueSpec>][] = [
    ['32582-awe', { widthIn: 6, heightIn: 4, font: 'times-new-roman', mounting: 'garden-stake', stakeLengthIn: 24, imageOption: 'none' }],
    ['32885-raccoon-river', { widthIn: 18, heightIn: 24, thicknessIn: 0.25, imageOption: 'full-color-uv', mounting: 'blind-studs' }],
    ['32240-sax-zim-bog', { widthIn: 8, heightIn: 5, font: 'custom', customFontName: 'Clarendon Fortune Bold', mounting: 'screws-through-face' }],
    ['32408-hadar-family-hall', { border: 'double-line', backgroundColor: 'custom', mounting: 'blind-studs' }],
    ['32054-arroyo-grande', { widthIn: 6, heightIn: 2, font: 'garamond', imageOption: 'none' }],
    ['31547-kane-county', { widthIn: 36, heightIn: 24, font: 'myriad' }],
    ['32782-audubon', { widthIn: 8, heightIn: 6, backgroundColor: 'brown', mounting: 'garden-stake', font: 'myriad' }],
    ['32717-camp-southern-ground', { widthIn: 12, heightIn: 16, border: 'double-line', imageOption: 'photo-relief', font: 'garamond' }],
    ['31882-honeywell', { material: 'aluminum', finish: 'brushed-aluminum', backgroundColor: 'black', mounting: 'garden-stake', imageOption: 'full-color-uv' }],
    ['32249-structure-of-merit', { widthIn: 7, heightIn: 5, process: 'reverse-etched', border: 'double-line', backgroundColor: 'black', backgroundTexture: 'smooth', imageOption: 'none' }],
  ];
  for (const [dir, expected] of cases) {
    it(`reads ${dir}`, () => {
      const r = spec(dir);
      expect(r.spec).toMatchObject(expected);
      expect(r.unrecognizedLines).toEqual([]);
    });
  }

  it('reads the custom paint name from "Background painted Dark Blue 2050 with …"', () => {
    expect(spec('32408-hadar-family-hall').spec.customPaint?.name).toBe('Dark Blue 2050');
  });

  it('reads sizes in many written forms, width first', () => {
    expect(parseSize('24" w × 12" h')).toMatchObject({ widthIn: 24, heightIn: 12 });
    expect(parseSize('12-1/2"H x 30"W')).toMatchObject({ widthIn: 30, heightIn: 12.5 });
    expect(parseSize('36 inches wide by 24 inches tall')).toMatchObject({ widthIn: 36, heightIn: 24 });
    expect(parseSize('8½" x 10"')).toMatchObject({ widthIn: 8.5, heightIn: 10 });
  });
});

describe('wording', () => {
  it('keeps the customer text exactly, removing only the trailing space', async () => {
    const { wording } = await heritage();
    expect(wording.blocks.map((b) => b.role)).toEqual(['headline', 'subhead', 'body']);
    expect(wording.blocks[0].text).toBe('Edwin J. Feulner Jr., Founder');
    expect(wording.blocks[2].text).toContain("'Onward'.");
    expect(wording.notes.join(' ')).toMatch(/Removed extra spaces/);
  });
});

describe('layout matches production_32241.ai (within 2 pt)', () => {
  it('places the image frame and every baseline', async () => {
    const { layout } = await heritage();
    const pt = (v: number) => v * 72;
    const f = layout.imageFrames[0].outer;
    expect(Math.abs(pt(f.x) - 197.6)).toBeLessThan(2);
    expect(Math.abs(pt(f.y) - 101.4)).toBeLessThan(2);
    expect(Math.abs(pt(f.w) - 468.2)).toBeLessThan(2);
    expect(Math.abs(pt(f.h) - 522)).toBeLessThan(3);
    const ref = [741.4, 803.8, 929.5, 994.1, 1059.1, 1123.8, 1188.0];
    expect(layout.lines.map((l) => l.text)).toEqual([
      'Edwin J. Feulner Jr., Founder',
      'The Heritage Foundation',
      "To honor Ed's boundless optimism and",
      'fearless pursuit of a transformative',
      'future, we embrace his legacy with',
      'resolute passion, forging ahead towards',
      "new horizons, 'Onward'.",
    ]);
    layout.lines.forEach((l, i) => expect(Math.abs(pt(l.baseline) - ref[i])).toBeLessThan(2));
  });

  it('draws the double-line border like the Structure of Merit outline art (7x5, within 1 pt)', () => {
    const s = spec('32249-structure-of-merit').spec;
    const layout = computeLayout({ spec: s, wording: wordingJson('32249-structure-of-merit') }, 'classic');
    const t = layout.border.innerLineIn!;
    const il = layout.border.innerLine!;
    // Real file: outer band 10.8 pt, inner line from 14.4 to 21.6 pt.
    expect(layout.border.widthIn * 72).toBeCloseTo(10.8, 0);
    expect((il.x - t / 2) * 72).toBeCloseTo(14.4, 0);
    expect((il.x + t / 2) * 72).toBeCloseTo(21.6, 0);
  });

  it('scales the double-line border like Camp Southern Ground (12x16)', () => {
    const s = spec('32717-camp-southern-ground').spec;
    const layout = computeLayout({ spec: s, wording: wordingJson('32717-camp-southern-ground'), photos: [{ aspect: 1.1 }] }, 'classic');
    expect(layout.border.widthIn).toBeCloseTo(0.276, 2);
    expect(layout.border.innerLineIn).toBeCloseTo(0.128, 2);
  });

  it('sets donor lists in columns with ruled section headings (Kane County)', () => {
    const s = spec('31547-kane-county').spec;
    const layout = computeLayout({ spec: s, wording: wordingJson('31547-kane-county') }, 'classic');
    expect(layout.rules.length).toBe(3);
    const champions = layout.lines.filter((l) => /^\d+\. /.test(l.text) && l.style?.columns === 3);
    expect(new Set(champions.map((l) => l.x?.toFixed(2))).size).toBe(3);
  });

  it('puts the image between text blocks when asked (Raccoon River)', () => {
    const s = spec('32885-raccoon-river').spec;
    const layout = computeLayout({ spec: s, wording: wordingJson('32885-raccoon-river'), photos: [{ aspect: 0.69 }], imageAfterBlock: 3 }, 'classic');
    const frame = layout.imageFrames[0].outer;
    const names = layout.lines.find((l) => l.text.startsWith('Dallas'))!;
    const founders = layout.lines.find((l) => l.text.startsWith('FOUNDERS'))!;
    expect(frame.y).toBeGreaterThan(names.baseline);
    expect(frame.y + frame.h).toBeLessThan(founders.baseline);
  });

  it('places four face screws for a screw mount (Sax-Zim Bog)', () => {
    const s = spec('32240-sax-zim-bog').spec;
    const layout = computeLayout({ spec: s, wording: wordingJson('32240-sax-zim-bog') }, 'classic');
    expect(layout.screws.length).toBe(4);
  });
});

describe('proof styles', () => {
  it('standard: plaque box matches the real proofs', () => {
    const lm = standardPlaqueRect(12, 18); // Liquid Mercury
    expect([lm.x, lm.y, lm.w, lm.h].map((v) => +v.toFixed(1))).toEqual([219, 92.8, 288, 432]);
    const sizes: [number, number, number, number][] = [
      [12, 16, 325, 433], // Camp Southern Ground
      [6, 2, 433, 145], // Arroyo Grande
      [36, 24, 504, 336], // Kane County
      [8, 12, 288, 432], // Honeywell
    ];
    for (const [w, h, rw, rh] of sizes) {
      const r = standardPlaqueRect(w, h);
      expect(Math.abs(r.w - rw)).toBeLessThan(2);
      expect(Math.abs(r.h - rh)).toBeLessThan(2);
    }
    expect(dimLabel(12)).toBe('12’’');
    expect(dimLabel(12.5)).toBe('12½’’');
  });

  it('order/version: the 7x5 plaque is drawn at true size', () => {
    const r = etchedPlaqueRect(7, 5);
    expect(r.w).toBeCloseTo(504, 0);
    expect(r.h).toBeCloseTo(360, 0);
  });

  it('description: writes the order description like the designers do (Awe)', () => {
    const r = spec('32582-awe');
    const d = autoDescription(r.spec, wordingJson('32582-awe'), { fontStated: true });
    expect(d).toContain('DESCRIPTION: Qty. 1 set 6”x4” Cast Bronze Plaque. Satin brushed finish. Single line border.');
    expect(d).toContain('Background painted Dark Oxide with Leatherette texture.');
    expect(d).toContain('Font: Times New Roman.');
    expect(d).toContain('24” Garden Stake mount.');
  });

  for (const [style, dir, pages] of [
    ['standard', '32241-edwin-feulner', 1],
    ['description', '32582-awe', 1],
    ['description', '32408-hadar-family-hall', 1],
    ['etched', '32249-structure-of-merit', 2],
  ] as const) {
    it(`${style} proof builds for ${dir} (${pages} page${pages > 1 ? 's' : ''})`, async () => {
      const s = spec(dir).spec;
      const wording = dir === '32241-edwin-feulner' ? (await heritage()).wording : wordingJson(dir);
      const layout = computeLayout({ spec: s, wording, photos: [{ aspect: 0.9 }] }, 'classic');
      const prod = await buildProductionPdf({ jobNumber: 'x', name: 'x', spec: s, layout });
      const pdf = await buildProof(style, {
        jobNumber: '12345', version: 2, spec: s, wording, layout, plaqueImage: await png(), productionPdf: prod.pdf,
      });
      const doc = await PDFDocument.load(pdf);
      expect(doc.getPageCount()).toBe(pages);
      expect(doc.getPage(0).getSize()).toEqual({ width: 792, height: 612 });
      expect(doc.getTitle()).toMatch(/12345/);
    });
  }

  it('description sheet keeps a gap above the width label and above the navy rule, for any plaque size', () => {
    // The plaque fills the left column from the page top to the navy footer rule (572.2 pt). The width line sits
    // 14 pt above the plaque and its 22 pt label (centered on the line) rises ~8.5 pt above it; the height line
    // ends at the plaque's bottom edge.
    for (const [w, h] of [[12, 16], [18, 24], [6, 4], [2, 8], [40, 10], [3, 40], [42, 36]]) {
      const r = descriptionPlaqueRect(w, h);
      expect(r.y - 14 - 8.5, `${w}x${h} label top`).toBeGreaterThanOrEqual(15);
      expect(572.2 - (r.y + r.h), `${w}x${h} gap to navy rule`).toBeGreaterThanOrEqual(15);
      expect(r.x - 17.5 - 9, `${w}x${h} left label`).toBeGreaterThan(4);
    }
    // A tall plaque uses the whole height.
    const tall = descriptionPlaqueRect(12, 24);
    expect(tall.h).toBeCloseTo(516, 3);
  });

  it('still builds when an icon is missing from the asset library', async () => {
    const { spec: s, layout, wording } = await heritage();
    const finish = getCatalog().finishes.find((f) => f.id === s.finish)!;
    const saved = finish.asset;
    finish.asset = 'assets/finishes/does-not-exist.png';
    try {
      expect(findAsset(finish.asset)).toBeNull();
      const pdf = await buildProof('standard', { jobNumber: 'x', version: 1, spec: s, wording, layout, plaqueImage: await png() });
      expect(pdf.length).toBeGreaterThan(1000);
    } finally {
      finish.asset = saved;
    }
  });
});

describe('vector production PDF', () => {
  it('all catalog fonts, borders and processes produce one-ink outlines in both current layouts', async () => {
    const base = spec('32582-awe').spec;
    const catalog = getCatalog();
    for (const font of catalog.fonts) for (const border of catalog.borders) for (const process of catalog.processes) for (const preset of ['classic', 'statement'] as const) {
      const s = { ...base, font: font.id, border: border.id, process: process.id };
      const wording: Wording = { blocks: [
        { id: 'title', role: 'headline', text: 'In Honor of José & Zoë' },
        { id: 'body', role: 'body', text: '“Always remembered” — 2026', style: { italic: true } },
        { id: 'footer', role: 'footer', text: 'Our Family', style: { bold: true, smallCaps: true } },
      ], notes: [] };
      const layout = computeLayout({ spec: s, wording }, preset);
      const result = await buildProductionPdf({ jobNumber: 'audit', name: 'Catalog matrix', spec: s, layout });
      const checks = await preflight(result.pdf, layout, { fontLicensed: false, fontId: font.id });
      expect(checks.filter((c) => !c.warnOnly && !c.ok), `${font.id}/${border.id}/${process.id}/${preset}`).toEqual([]);
    }
  });

  it('Heritage: 864 x 1296 pt, one ink, no fonts, no images', async () => {
    const { spec: s, layout } = await heritage();
    const r = await buildProductionPdf({ jobNumber: '32241', name: 'Heritage Foundation', spec: s, layout });
    expect(r.fileName).toBe('32241_Heritage_Foundation_12x18_production.pdf');
    const checks = await preflight(r.pdf, layout, { fontLicensed: true });
    for (const c of checks.filter((c) => !c.warnOnly)) expect(c, c.label).toMatchObject({ ok: true });
  });

  it('every reference job passes preflight, including italic, bold, small caps, columns and screws', async () => {
    for (const dir of ['32582-awe', '32885-raccoon-river', '32240-sax-zim-bog', '31547-kane-county', '32249-structure-of-merit', '31882-honeywell']) {
      const s = spec(dir).spec;
      const layout = computeLayout({ spec: s, wording: wordingJson(dir), photos: [{ aspect: 0.8 }] }, 'classic');
      const r = await buildProductionPdf({ jobNumber: '1', name: dir, spec: s, layout });
      const checks = await preflight(r.pdf, layout, { fontLicensed: true });
      for (const c of checks.filter((c) => !c.warnOnly)) expect(c, `${dir}: ${c.label} ${c.detail}`).toMatchObject({ ok: true });
    }
  });

  it('traces a raster logo into vector paths', async () => {
    const { spec: s, wording } = await heritage();
    const layout = computeLayout({ spec: s, wording, photos: [{ aspect: 0.9 }], logos: [{ aspect: 2 }], logoSlot: 'bottom' }, 'classic');
    const logoPng = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><rect width="400" height="200" fill="#fff"/><circle cx="100" cy="100" r="80" fill="#1a3"/><circle cx="100" cy="100" r="40" fill="#fff"/></svg>')).png().toBuffer();
    const r = await buildProductionPdf({ jobNumber: '1', name: 'logo', spec: s, layout, logos: [{ png: logoPng, name: 'logo.png', fromVector: false }] });
    const checks = await preflight(r.pdf, layout, { fontLicensed: true, logosTraced: 1 });
    for (const c of checks.filter((c) => !c.warnOnly)) expect(c, c.label).toMatchObject({ ok: true });
  });
});

describe('image helpers', () => {
  it('sizes the canvas to the plaque proportions in multiples of 16', () => {
    expect(canvasSize(12, 18, 1536)).toMatchObject({ w: 1024, h: 1536 });
    expect(canvasSize(24, 12, 1536)).toMatchObject({ w: 1536, h: 768 });
    expect(canvasSize(84, 6, 1536).w / canvasSize(84, 6, 1536).h).toBeCloseTo(3, 1);
  });

  it('finds wording differences word by word', () => {
    expect(compareWording(['Edwin J. Feulner Jr., Founder'], ['Edwin J. Feulner Jr., Founder'])).toEqual([]);
    expect(compareWording(['Edwin J. Feulner Jr., Founder'], ['Edwin J. Fuelner Jr., Founder'])).toEqual([{ expected: 'Feulner', seen: 'Fuelner' }]);
    expect(compareWording(["new horizons, 'Onward'."], ['new horizons, ‘Onward’.'])).toEqual([]);
  });
});
