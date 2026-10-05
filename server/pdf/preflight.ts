// Automatic checks on a production PDF, shown to the designer after every build.
import zlib from 'node:zlib';
import { PDFDocument, PDFRawStream, PDFName, PDFDict } from 'pdf-lib';
import type { PlaqueLayout, PreflightItem } from '../../shared/types.js';

const INK = [0x23 / 255, 0x1f / 255, 0x20 / 255];

function streamText(s: PDFRawStream): string {
  const filter = s.dict.get(PDFName.of('Filter'));
  const bytes = s.contents;
  try {
    return (filter?.toString() === '/FlateDecode' ? zlib.inflateSync(bytes) : Buffer.from(bytes)).toString('latin1');
  } catch {
    return '';
  }
}

export async function preflight(pdf: Buffer, layout: PlaqueLayout, extra: { logosTraced?: number; fontLicensed: boolean }): Promise<PreflightItem[]> {
  const doc = await PDFDocument.load(pdf);
  const items: PreflightItem[] = [];
  const page = doc.getPage(0);
  const { width, height } = page.getSize();
  const ew = layout.widthIn * 72;
  const eh = layout.heightIn * 72;
  items.push({
    label: 'Page size',
    ok: Math.abs(width - ew) < 0.1 && Math.abs(height - eh) < 0.1,
    detail: `${width.toFixed(1)} x ${height.toFixed(1)} pt (plaque ${layout.widthIn}" x ${layout.heightIn}" at 72 pt/in)`,
  });

  let fonts = 0;
  let images = 0;
  const colors = new Set<string>();
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    const dict = obj instanceof PDFRawStream ? obj.dict : obj instanceof PDFDict ? obj : null;
    if (!dict) continue;
    const type = dict.get(PDFName.of('Type'))?.toString();
    const subtype = dict.get(PDFName.of('Subtype'))?.toString();
    if (type === '/Font') fonts++;
    if (subtype === '/Image') images++;
    if (obj instanceof PDFRawStream && !subtype) {
      const text = streamText(obj);
      for (const m of text.matchAll(/([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+(rg|RG)\b/g)) colors.add([m[1], m[2], m[3]].map((v) => Number(v).toFixed(3)).join(','));
      for (const m of text.matchAll(/(?:^|\s)([\d.]+)\s+(g|G)\b/g)) colors.add([m[1], m[1], m[1]].map((v) => Number(v).toFixed(3)).join(','));
    }
  }
  items.push({ label: 'No fonts (all text outlined)', ok: fonts === 0, detail: fonts ? `${fonts} font(s) found` : 'All text is vector outlines' });
  items.push({ label: 'No raster images', ok: images === 0, detail: images ? `${images} image(s) found` : '100% vector' });
  const allowed = new Set([INK.map((v) => v.toFixed(3)).join(','), '1.000,1.000,1.000']);
  const bad = [...colors].filter((c) => !allowed.has(c));
  items.push({
    label: 'One ink (#231F20 + white)',
    ok: bad.length === 0,
    detail: bad.length ? `Unexpected colors: ${bad.join(' | ')}` : 'Only rich black #231F20 (raised) and white (recessed)',
  });
  const small = layout.warnings.find((w) => /casting minimum/.test(w));
  items.push({ label: 'Letter heights', ok: !small, detail: small ?? 'All lines meet the 3/8" (mixed case) / 1/4" (all caps) minimum', warnOnly: true });
  items.push({
    label: 'Font',
    ok: extra.fontLicensed,
    detail: extra.fontLicensed ? 'Licensed font file used' : 'Open stand-in used. Add the licensed font to brand-assets/fonts/ for exact letterforms.',
    warnOnly: true,
  });
  const logos = layout.logos.length;
  if (logos) {
    const traced = Math.min(logos, extra.logosTraced ?? 0);
    items.push({
      label: logos > 1 ? 'Logos' : 'Logo',
      ok: traced === logos,
      detail:
        logos === 1
          ? traced ? 'Traced to vector; check against the original' : 'No logo file uploaded'
          : traced === logos
            ? `All ${logos} traced to vector; check each against its original`
            : `${traced} of ${logos} traced to vector; ${logos - traced} position(s) have no logo file`,
      warnOnly: true,
    });
  }
  items.push({
    label: 'Border geometry',
    ok: layout.border.verified,
    detail: layout.border.verified ? 'Matches measured production files' : 'Not yet verified against a real production file; check in Illustrator',
    warnOnly: true,
  });
  return items;
}
