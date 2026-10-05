// The logo reader: every kind of file designers upload must come out as the logo's own
// shape, with its lettering, for the vector production file and the layout drawing.
import fs from 'node:fs';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { inkMask, traceLogo, traceMask, maskSvg } from '../server/pdf/trace';
import { buildProductionPdf, uvPlateRect } from '../server/pdf/production';
import { preflight } from '../server/pdf/preflight';
import { computeLayout } from '../server/layout/engine';
import { parseSpec } from '../server/parse/spec';
import { autoDescription } from '../server/pdf/proofs/description-text';
import { fallbackInstruction } from '../server/ai/instruct';
import { blankProject } from '../server/db';

const svg = (body: string, w = 600, h = 600) => sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${body}</svg>`)).png().toBuffer();
const inkShare = (m: { data: Uint8Array }) => m.data.reduce((a, b) => a + b, 0) / m.data.length;
/** Ink share of a horizontal band of the mask (fy0..fy1 of its height). */
const bandInk = (m: { data: Uint8Array; width: number; height: number }, fy0: number, fy1: number) => {
  let ink = 0;
  let n = 0;
  for (let y = Math.floor(fy0 * m.height); y < Math.floor(fy1 * m.height); y++) for (let x = 0; x < m.width; x++) { ink += m.data[y * m.width + x]; n++; }
  return ink / n;
};

describe('logo reader', () => {
  it('reads a photo of a UV printed plate: the marks on the plate are the logo, lettering included', async () => {
    const m = await inkMask(fs.readFileSync('assets/logo-treatments/uv-print.png'));
    expect(m.fromPlate).toBe(true);
    expect(m.width / m.height).toBeGreaterThan(0.45); // the shield and three words, not the plate (which is wider)
    expect(m.width / m.height).toBeLessThan(0.7);
    expect(inkShare(m)).toBeGreaterThan(0.2);
    expect(inkShare(m)).toBeLessThan(0.5);
    // Three lines of lettering in the lower third, with field between the words.
    expect(bandInk(m, 0.7, 1)).toBeGreaterThan(0.2);
    expect(bandInk(m, 0.7, 1)).toBeLessThan(0.7);
    expect(traceMask(m).filter((p) => p.dark).length).toBeGreaterThan(8);
  });

  it('reads a gold logo on a dark textured background (raised cast photo)', async () => {
    const m = await inkMask(fs.readFileSync('assets/logo-treatments/raised-cast.png'));
    expect(m.fromPlate).toBe(false);
    expect(inkShare(m)).toBeGreaterThan(0.15);
    expect(inkShare(m)).toBeLessThan(0.4);
    expect(bandInk(m, 0.75, 1)).toBeGreaterThan(0.2); // the three words
  });

  it('keeps holes, outline frames, knock-outs and color', async () => {
    const seal = await inkMask(await svg('<rect width="600" height="600" fill="#fff"/><circle cx="300" cy="300" r="220" fill="#123"/><circle cx="300" cy="300" r="120" fill="#fff"/>'));
    expect(seal.data[Math.floor(seal.height / 2) * seal.width + Math.floor(seal.width / 2)]).toBe(0); // the hole
    expect(inkShare(seal)).toBeCloseTo((Math.PI * (220 * 220 - 120 * 120)) / (440 * 440), 1);
    const frame = await inkMask(await svg('<rect width="600" height="600" fill="#fff"/><rect x="40" y="40" width="520" height="520" fill="none" stroke="#123" stroke-width="24"/><text x="300" y="330" font-size="90" text-anchor="middle" fill="#123" font-family="sans-serif">FRAME</text>'));
    expect(frame.fromPlate).toBe(false);
    expect(frame.data[Math.round(0.04 * frame.height) * frame.width + Math.floor(frame.width / 2)]).toBe(1); // the frame line stays
    const gold = await inkMask(await svg('<rect width="600" height="300" fill="#1a1a1a"/><text x="300" y="185" font-size="110" text-anchor="middle" fill="#d4b36a" font-family="sans-serif" font-weight="bold">GOLD</text>', 600, 300));
    expect(gold.width / gold.height).toBeGreaterThan(2); // the letters, not the dark page
    // A knock-out logo file on plain white is cast as given: the bar raised, the letters recessed.
    const knock = await inkMask(await svg('<rect width="600" height="300" fill="#fff"/><rect x="30" y="30" width="540" height="240" fill="#123"/><text x="300" y="185" font-size="110" text-anchor="middle" fill="#fff" font-family="sans-serif" font-weight="bold">KNOCK</text>', 600, 300));
    expect(knock.fromPlate).toBe(false);
    expect(inkShare(knock)).toBeGreaterThan(0.6);
    // The same bar photographed on a textured card is a plate: the letters are the logo.
    const noise = Array.from({ length: 400 }, (_, i) => `<rect x="${(i * 37) % 600}" y="${(i * 53) % 300}" width="9" height="9" fill="hsl(30,20%,${14 + (i % 7) * 3}%)"/>`).join('');
    const photo = await inkMask(await svg(`<rect width="600" height="300" fill="#5a4a3a"/>${noise}<rect x="60" y="40" width="480" height="220" fill="#c9a86a"/><text x="300" y="185" font-size="100" text-anchor="middle" fill="#222" font-family="sans-serif" font-weight="bold">KNOCK</text>`, 600, 300));
    expect(photo.fromPlate).toBe(true);
    expect(inkShare(photo)).toBeLessThan(0.6);
    const color = await inkMask(await svg('<rect width="600" height="600" fill="#fff"/><polygon points="300,40 560,560 40,560" fill="#2a6a3a"/>'));
    expect(inkShare(color)).toBeCloseTo(0.5, 1);
    const svgText = maskSvg(color);
    expect(svgText).toMatch(/<path /);
  });

  it('traceLogo reports where the logo came from', async () => {
    const t = await traceLogo(fs.readFileSync('assets/logo-treatments/uv-print.png'));
    expect(t.fromPlate).toBe(true);
    expect(t.paths.some((p) => p.dark)).toBe(true);
  });
});

describe('logo treatment', () => {
  const heritage = () => parseSpec(fs.readFileSync('references/32241-edwin-feulner/spec.txt', 'utf8')).spec;

  it('is read from the order, defaults to raised cast, and never turns a logo into a printed photo', () => {
    expect(heritage().logoTreatment).toBe('raised-cast');
    const uv = parseSpec('Bronze plaque 12"w x 16"h\nSatin finish\nUV print logo\nBlind mounting');
    expect(uv.spec.logoTreatment).toBe('uv-print');
    expect(uv.spec.imageOption).toBe('none');
    expect(uv.assumed).not.toContain('logoTreatment');
    const plain = parseSpec('Bronze plaque 12"w x 16"h\nSatin finish\nIncludes customer logo\nBlind mounting');
    expect(plain.spec.logoTreatment).toBe('raised-cast');
    expect(plain.assumed).toContain('logoTreatment');
    expect(parseSpec('Bronze plaque 12"w x 16"h\nFull Color UV printed photo').spec.imageOption).toBe('full-color-uv');
  });

  it('is named in the Description-sheet header', () => {
    const s = heritage();
    expect(autoDescription(s, null, { logoCount: 1 })).toContain('Includes raised cast logo.');
    expect(autoDescription({ ...s, logoTreatment: 'uv-print' }, null, { logoCount: 2 })).toContain('Includes 2 UV printed logos on raised plates.');
    expect(autoDescription(s, null, {})).not.toContain('logo');
  });

  it('can be changed from the Fix box as an order change', () => {
    const p = blankProject({ jobNumber: 'L', name: 'L', createdBy: 'Test' });
    p.spec = heritage();
    p.wording = { blocks: [{ id: 'w1', role: 'headline', text: 'Name' }], notes: [] };
    expect(fallbackInstruction(p, 'make it a UV print logo')).toMatchObject({ kind: 'spec', specPatch: { logoTreatment: 'uv-print' } });
    expect(fallbackInstruction(p, 'change the logo to raised cast')).toMatchObject({ kind: 'spec', specPatch: { logoTreatment: 'raised-cast' } });
  });

  it('UV print: the production file carries the raised plate, not the artwork; raised cast traces the logo', async () => {
    const s = heritage();
    const wording = { blocks: [{ id: 'w1', role: 'headline' as const, text: 'Camp Southern Ground' }], notes: [] };
    const layout = computeLayout({ spec: s, wording, logos: [{ id: 'l', aspect: 440 / 284 }], logoSlot: 'bottom' }, 'classic');
    const photo = fs.readFileSync('assets/logo-treatments/uv-print.png');
    const uv = await buildProductionPdf({ jobNumber: '1', name: 'uv', spec: { ...s, logoTreatment: 'uv-print' }, layout, logos: [{ png: photo, name: 'plate.png', fromVector: false }] });
    expect(uv.notes.join(' ')).toMatch(/UV print\. The raised plate .* is in this file; the logo artwork is printed on it after casting/);
    const cast = await buildProductionPdf({ jobNumber: '1', name: 'cast', spec: s, layout, logos: [{ png: photo, name: 'plate.png', fromVector: false }] });
    expect(cast.notes.join(' ')).toMatch(/read from the marks on a plate/);
    // Outlined lettering makes the traced file much larger than one rectangle.
    expect(cast.pdf.length).toBeGreaterThan(uv.pdf.length + 2000);
    for (const r of [uv, cast]) {
      const checks = await preflight(r.pdf, layout, { fontLicensed: true, logosTraced: 1, logoTreatment: r === uv ? 'uv-print' : 'raised-cast' });
      for (const c of checks.filter((c) => !c.warnOnly)) expect(c, c.label).toMatchObject({ ok: true });
    }
    const plate = uvPlateRect(layout.logos[0], 412 / 738);
    expect(plate.w / plate.h).toBeCloseTo(412 / 738, 3);
    expect(plate.h).toBeLessThanOrEqual(layout.logos[0].h + 1e-9);
  });
});
