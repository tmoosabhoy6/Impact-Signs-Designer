// Font loading. A licensed font file in brand-assets/fonts/ always wins;
// otherwise a close open-source stand-in is used and reported as such.
import fs from 'node:fs';
import opentype from 'opentype.js';
import { fromRoot } from '../config.js';
import { getCatalog } from '../catalog.js';
import type { TextStyle } from '../../shared/types.js';

export type OTFont = opentype.Font;

export interface ResolvedFont {
  font: OTFont;
  fontId: string;
  label: string;
  licensed: boolean;
  file: string;
}

const cache = new Map<string, OTFont>();

function load(file: string): OTFont {
  let f = cache.get(file);
  if (!f) {
    const buf = fs.readFileSync(file);
    f = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
    cache.set(file, f);
  }
  return f;
}

export function standInFile(pkg: string, weight = 400, italic = false): string {
  return fromRoot('node_modules', '@fontsource', pkg, 'files', `${pkg}-latin-${weight}-${italic ? 'italic' : 'normal'}.woff`);
}

export function resolveFont(fontId: string, style?: TextStyle): ResolvedFont {
  const opt = getCatalog().fonts.find((f) => f.id === fontId) ?? getCatalog().fonts[0];
  const suffix = style?.bold && style?.italic ? '-BoldItalic' : style?.bold ? '-Bold' : style?.italic ? '-Italic' : '';
  const licensed = fromRoot(suffix ? opt.licensedFile.replace(/(\.[^.]+)$/, `${suffix}$1`) : opt.licensedFile);
  if (fs.existsSync(licensed)) {
    return { font: load(licensed), fontId: opt.id, label: opt.label, licensed: true, file: licensed };
  }
  let file = standInFile(opt.standIn, style?.bold ? 700 : 400, style?.italic);
  if (!fs.existsSync(file)) file = standInFile(opt.standIn, style?.bold ? 700 : 400);
  return { font: load(file), fontId: opt.id, label: opt.label, licensed: false, file };
}

/** Font used for the labels on the proof sheet (Myriad Pro on the real proofs). */
export function proofLabelFontFile(): { file: string; licensed: boolean } {
  const licensed = fromRoot('brand-assets/fonts/MyriadPro-Regular.otf');
  if (fs.existsSync(licensed)) return { file: licensed, licensed: true };
  return { file: standInFile('source-sans-3'), licensed: false };
}

export function measure(font: OTFont, text: string, size: number, style?: TextStyle): number {
  if (style?.smallCaps) return [...text].reduce((w, ch) => w + font.getAdvanceWidth(ch.toUpperCase(), ch !== ch.toUpperCase() ? size * 0.8 : size), 0);
  return font.getAdvanceWidth(text, size);
}

/** Characters the font cannot draw (they would come out as empty boxes). */
export function missingGlyphs(font: OTFont, text: string): string[] {
  const missing = new Set<string>();
  for (const ch of text) {
    if (ch.trim() === '') continue;
    if (font.charToGlyph(ch).index === 0) missing.add(ch);
  }
  return [...missing];
}

export function wrapText(font: OTFont, text: string, size: number, maxWidth: number, style?: TextStyle): string[] {
  const out: string[] = [];
  for (const hard of text.split('\n')) {
    const words = hard.split(/ +/).filter(Boolean);
    let line = '';
    for (const word of words) {
      const trial = line ? `${line} ${word}` : word;
      if (!line || measure(font, trial, size, style) <= maxWidth) line = trial;
      else {
        out.push(line);
        line = word;
      }
    }
    if (line) out.push(line);
  }
  return out;
}
