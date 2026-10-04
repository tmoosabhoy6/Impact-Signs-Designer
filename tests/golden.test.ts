// Golden tests: the Heritage Foundation job (32241) must reproduce the real proof
// (Liquid Mercury.pdf) and the real production file (production_32241.ai).
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';
import { parseSpec, parseSize } from '../server/parse/spec';
import { docxToText, parseWording } from '../server/parse/wording';
import { computeLayout } from '../server/layout/engine';
import { buildProofPdf, plaqueRect, dimLabel } from '../server/pdf/proof';
import { buildProductionPdf } from '../server/pdf/production';
import { preflight } from '../server/pdf/preflight';
import { compareWording } from '../server/ai/spellcheck';
import { canvasSize } from '../server/ai/images';
import { getCatalog } from '../server/catalog';
import { findAsset } from '../server/assets';

const REF = 'references/32241-edwin-feulner';
const specText = fs.readFileSync(`${REF}/spec.txt`, 'utf8');

async function heritage() {
  const spec = parseSpec(specText).spec;
  const wording = parseWording(await docxToText(fs.readFileSync(`${REF}/Edwin-J.docx`)));
  const layout = computeLayout({ spec, wording, photoAspect: 402 / 450 }, 'classic');
  return { spec, wording, layout };
}

describe('spec parser', () => {
  it('reads the Heritage order', () => {
    const r = parseSpec(specText);
    expect(r.spec).toEqual({
      material: 'bronze', widthIn: 12, heightIn: 18, finish: 'natural-satin-brushed-bronze', backgroundColor: 'dark-oxide',
      backgroundTexture: 'leatherette', border: 'single-line', font: 'times-new-roman', imageOption: 'photo-relief',
      mounting: 'blind-studs', lettering: 'raised',
    });
    expect(r.assumed.sort()).toEqual(['border', 'font', 'imageOption']);
    expect(r.unrecognizedLines).toEqual([]);
  });

  it('reads sizes in many written forms, width first', () => {
    expect(parseSize('24" w × 12" h')).toMatchObject({ widthIn: 24, heightIn: 12 });
    expect(parseSize('12-1/2"H x 30"W')).toMatchObject({ widthIn: 30, heightIn: 12.5 });
    expect(parseSize('36 inches wide by 24 inches tall')).toMatchObject({ widthIn: 36, heightIn: 24 });
    expect(parseSize('8½" x 10"')).toMatchObject({ widthIn: 8.5, heightIn: 10 });
  });

  it('flags aluminum as handled elsewhere', () => {
    const r = parseSpec('Aluminum Plaque\n24" w x 12" h\nBlack Leatherette');
    expect(r.notes.some((n) => n.kind === 'unavailable' && /Aluminum/.test(n.message))).toBe(true);
    expect(r.spec.backgroundColor).toBe('black');
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
    const f = layout.imageFrame!.outer;
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
});

describe('proof PDF matches Liquid Mercury.pdf', () => {
  it('uses the measured plaque box and labels', () => {
    const r = plaqueRect(12, 18);
    expect(r.x).toBeCloseTo(218.96, 1);
    expect(r.y).toBeCloseTo(92.84, 1);
    expect(r.w).toBeCloseTo(288, 1);
    expect(r.h).toBeCloseTo(432, 1);
    expect(dimLabel(12)).toBe('12’’');
    expect(dimLabel(12.5)).toBe('12½’’');
  });

  it('builds a Letter landscape proof titled "Proof - <job>"', async () => {
    const { spec } = await heritage();
    const img = await sharp({ create: { width: 600, height: 900, channels: 3, background: '#C49A6C' } }).png().toBuffer();
    const pdf = await buildProofPdf({ jobNumber: '32241', spec, plaqueImage: img });
    const doc = await PDFDocument.load(pdf);
    expect(doc.getPage(0).getSize()).toEqual({ width: 792, height: 612 });
    expect(doc.getTitle()).toBe('Proof - 32241');
  });

  it('still builds when an icon is missing from the asset library', async () => {
    const { spec } = await heritage();
    const finish = getCatalog().finishes.find((f) => f.id === spec.finish)!;
    const saved = finish.asset;
    finish.asset = 'assets/finishes/does-not-exist.png';
    try {
      expect(findAsset(finish.asset)).toBeNull();
      const img = await sharp({ create: { width: 60, height: 90, channels: 3, background: '#C49A6C' } }).png().toBuffer();
      const pdf = await buildProofPdf({ jobNumber: 'x', spec, plaqueImage: img });
      expect(pdf.length).toBeGreaterThan(1000);
    } finally {
      finish.asset = saved;
    }
  });
});

describe('vector production PDF', () => {
  it('is 864 x 1296 pt, one ink, no fonts, no images', async () => {
    const { spec, layout } = await heritage();
    const r = await buildProductionPdf({ jobNumber: '32241', name: 'Heritage Foundation', spec, layout });
    expect(r.fileName).toBe('32241_Heritage_Foundation_12x18_production.pdf');
    const checks = await preflight(r.pdf, layout, { fontLicensed: true });
    for (const c of checks.filter((c) => !c.warnOnly)) expect(c, c.label).toMatchObject({ ok: true });
  });

  it('traces a raster logo into vector paths', async () => {
    const { spec, wording } = await heritage();
    const layout = computeLayout({ spec, wording, photoAspect: 0.9, logoAspect: 2, logoSlot: 'bottom' }, 'classic');
    const logoPng = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><rect width="400" height="200" fill="#fff"/><circle cx="100" cy="100" r="80" fill="#1a3"/><circle cx="100" cy="100" r="40" fill="#fff"/></svg>')).png().toBuffer();
    const r = await buildProductionPdf({ jobNumber: '1', name: 'logo', spec, layout, logoPng });
    const checks = await preflight(r.pdf, layout, { fontLicensed: true, logoTraced: true });
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
