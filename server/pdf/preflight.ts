// Automatic checks on a production PDF, shown to the designer after every build.
import { mustOption } from '../catalog.js';
import zlib from 'node:zlib';
import { PDFDocument, PDFRawStream, PDFName, PDFDict } from 'pdf-lib';
import { layoutProblems } from '../layout/check.js';
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

export async function preflight(pdf: Buffer, layout: PlaqueLayout, extra: { logosTraced?: number; fontLicensed: boolean; logoTreatment?: string; fontId?: string }): Promise<PreflightItem[]> {
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
  // The file draws what the layout says, so text hanging off the plate or lines on top of each
  // other would be cut that way. This is a hard failure, not a warning.
  const problems = layoutProblems(layout, extra.fontId ?? 'times-new-roman');
  items.push({
    label: 'Everything fits on the plaque',
    ok: problems.length === 0,
    detail: problems.length ? `${problems.join(' ')} Shorten the wording, use fewer or shorter names per line, or use a larger plaque.` : 'All wording sits inside the border with no overlaps',
  });
  const small = layout.warnings.find((w) => /casting minimum/.test(w));
  const enlarged = layout.warnings.find((w) => /enlarged to the ¼" minimum/.test(w));
  items.push({
    label: 'Letter heights',
    ok: !small,
    detail: small ?? `All letters are at least ¼" tall${layout.minLetterIn != null ? ` (smallest ${layout.minLetterIn.toFixed(2)}")` : ''}${enlarged ? `; ${enlarged.replace(/\.$/, '').replace(/^./, (c) => c.toLowerCase())}` : ''}`,
    warnOnly: true,
  });
  items.push({
    label: 'Font',
    ok: extra.fontLicensed,
    detail: extra.fontLicensed ? 'Licensed font file used' : 'Open stand-in used. Add the licensed font to brand-assets/fonts/ for exact letterforms.',
    warnOnly: true,
  });
  const logos = layout.logos.length;
  if (logos) {
    const traced = Math.min(logos, extra.logosTraced ?? 0);
    const uv = mustOption('logoTreatments', extra.logoTreatment ?? 'raised-cast').mode !== 'raised';
    const made = uv ? 'drawn as a raised UV print plate; the artwork is printed after casting' : 'traced to vector; check against the original';
    items.push({
      label: logos > 1 ? 'Logos' : 'Logo',
      ok: traced === logos,
      detail:
        logos === 1
          ? traced ? made.replace(/^./, (c) => c.toUpperCase()) : 'No logo file uploaded'
          : traced === logos
            ? `All ${logos} ${uv ? 'drawn as raised UV print plates; the artwork is printed after casting' : 'traced to vector; check each against its original'}`
            : `${traced} of ${logos} ${uv ? 'drawn as plates' : 'traced to vector'}; ${logos - traced} position(s) have no logo file`,
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
