// Font loading. A licensed font file in brand-assets/fonts/ always wins;
// otherwise a close open-source stand-in is used and reported as such.
// A job can also carry its own font file (a customer's custom font).
import fs from 'node:fs';
import path from 'node:path';
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
  /** Absolute path of the font file actually used. */
  file: string;
}

const cache = new Map<string, OTFont>();

export function loadFontFile(file: string): OTFont {
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

/** Licensed style variants are found next to the regular file: Name-Bold.otf, Name-Italic.otf, Name-BoldItalic.otf. */
function licensedVariant(regular: string, bold: boolean, italic: boolean): string | null {
  const ext = path.extname(regular);
  const base = regular.slice(0, -ext.length).replace(/-(Regular|Roman)$/i, '');
  const suffix = bold && italic ? 'BoldItalic' : bold ? 'Bold' : italic ? 'Italic' : '';
  const candidates = suffix ? [`${base}-${suffix}${ext}`, `${base}${suffix}${ext}`] : [regular];
  for (const c of candidates) if (fs.existsSync(fromRoot(c))) return fromRoot(c);
  return null;
}

/**
 * The font file for a catalog font in a given style.
 * @param customFile a job's own font file, used when fontId is 'custom'.
 */
export function resolveFont(fontId: string, style: Pick<TextStyle, 'bold' | 'italic'> = {}, customFile?: string | null): ResolvedFont {
  const fonts = getCatalog().fonts;
  const opt = fonts.find((f) => f.id === fontId) ?? fonts[0];
  const bold = !!style.bold;
  const italic = !!style.italic;
  if (opt.id === 'custom' && customFile && fs.existsSync(customFile)) {
    return { font: loadFontFile(customFile), fontId: opt.id, label: path.basename(customFile), licensed: true, file: customFile };
  }
  if (opt.licensedFile) {
    // A missing bold/italic file falls back to the licensed regular rather than mixing in a stand-in.
    const lic = licensedVariant(opt.licensedFile, bold, italic) ?? licensedVariant(opt.licensedFile, false, false);
    if (lic) return { font: loadFontFile(lic), fontId: opt.id, label: opt.label, licensed: true, file: lic };
  }
  const file = standInFile(opt.standIn, bold ? 700 : 400, italic);
  return { font: loadFontFile(file), fontId: opt.id, label: opt.label, licensed: false, file };
}

/** Font used for the labels on the proof sheet (Myriad Pro on the real proofs). */
export function proofLabelFontFile(bold = false): { file: string; licensed: boolean } {
  const licensed = fromRoot(`brand-assets/fonts/MyriadPro-${bold ? 'Bold' : 'Regular'}.otf`);
  if (fs.existsSync(licensed)) return { file: licensed, licensed: true };
  return { file: standInFile('source-sans-3', bold ? 700 : 400), licensed: false };
}

/** Helvetica-style labels used on the Description-sheet proofs. */
export function helveticaFile(bold = false): string {
  const licensed = fromRoot(`brand-assets/fonts/Helvetica${bold ? '-Bold' : ''}.ttf`);
  return fs.existsSync(licensed) ? licensed : standInFile('arimo', bold ? 700 : 400);
}

// ---------- Styled text (small caps) ----------

/** Small caps are drawn as capitals at this size for lowercase letters. */
export const SMALL_CAPS_SCALE = 0.78;

interface Segment {
  text: string;
  scale: number;
}

function segments(text: string, smallCaps?: boolean): Segment[] {
  if (!smallCaps) return [{ text, scale: 1 }];
  const out: Segment[] = [];
  for (const ch of text) {
    const lower = ch !== ch.toUpperCase();
    const seg = { text: lower ? ch.toUpperCase() : ch, scale: lower ? SMALL_CAPS_SCALE : 1 };
    const last = out[out.length - 1];
    if (last && last.scale === seg.scale) last.text += seg.text;
    else out.push(seg);
  }
  return out;
}

// Glyphs are placed one by one (character -> glyph, plus pair kerning). No ligatures or other
// substitutions: predictable letters for casting, and immune to unsupported OpenType features.
function run(font: OTFont, text: string, size: number, x0: number, draw?: (g: opentype.Glyph, x: number) => void): number {
  const scale = size / font.unitsPerEm;
  let x = x0;
  let prev: opentype.Glyph | null = null;
  for (const ch of text) {
    const g = font.charToGlyph(ch);
    if (prev) {
      try {
        x += font.getKerningValue(prev, g) * scale;
      } catch {
        /* fonts without kerning data */
      }
    }
    draw?.(g, x);
    x += (g.advanceWidth ?? 0) * scale;
    prev = g;
  }
  return x - x0;
}

export function measure(font: OTFont, text: string, size: number, smallCaps?: boolean): number {
  return segments(text, smallCaps).reduce((w, s) => w + run(font, s.text, size * s.scale, 0), 0);
}

/** SVG path data for a line of text starting at x (left edge) on the given baseline. */
export function textPath(font: OTFont, text: string, x: number, baseline: number, size: number, smallCaps?: boolean): string {
  let cx = x;
  const parts: string[] = [];
  for (const s of segments(text, smallCaps)) {
    cx += run(font, s.text, size * s.scale, cx, (g, gx) => {
      const d = g.getPath(gx, baseline, size * s.scale).toPathData(3);
      if (d) parts.push(d);
    });
  }
  return parts.join(' ');
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

export function wrapText(font: OTFont, text: string, size: number, maxWidth: number, smallCaps?: boolean): string[] {
  const out: string[] = [];
  for (const hard of text.split('\n')) {
    const words = hard.split(/ +/).filter(Boolean);
    let line = '';
    for (const word of words) {
      const trial = line ? `${line} ${word}` : word;
      if (!line || measure(font, trial, size, smallCaps) <= maxWidth) line = trial;
      else {
        out.push(line);
        line = word;
      }
    }
    if (line) out.push(line);
  }
  return out;
}
