// Turns the order's specification text into structured fields.
// Rule-based on purpose: it only ever picks options that exist in data/catalog.json,
// and every value it had to guess is reported as an assumption the designer can change.
import { getCatalog, type Option, type OptionGroup } from '../catalog.js';
import type { ParseNote, ParseResult, PlaqueSpec, SpecField } from '../../shared/types.js';

const FRACTIONS: Record<string, number> = { '¼': 0.25, '½': 0.5, '¾': 0.75, '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875 };

function normalize(text: string): string {
  return text
    .replace(/[“”″]/g, '"')
    .replace(/[‘’′]/g, "'")
    .replace(/''/g, '"')
    .replace(/[×✕✖]/g, 'x')
    .replace(/\t/g, ' ')
    .replace(/ /g, ' ');
}

/** Reads "12", "12.5", "12 1/2", "12-1/2", "12½" as inches. */
export function parseInches(raw: string): number | null {
  let s = raw.trim();
  let extra = 0;
  for (const [ch, v] of Object.entries(FRACTIONS)) {
    if (s.includes(ch)) {
      extra += v;
      s = s.replace(ch, '');
    }
  }
  const m = s.match(/^(\d+(?:\.\d+)?)(?:[\s-]+(\d+)\/(\d+))?$/);
  if (!m) return s === '' && extra ? extra : null;
  let v = Number(m[1]) + extra;
  if (m[2] && m[3]) v += Number(m[2]) / Number(m[3]);
  return v;
}

const NUM = String.raw`(\d+(?:\.\d+)?(?:[\s-]+\d+\/\d+)?[¼½¾⅛⅜⅝⅞]?)`;
const UNIT = String.raw`\s*(?:"|in(?:ch(?:es)?)?\.?|')?\s*`;
const SIZE_RE = new RegExp(
  NUM + UNIT + String.raw`(w(?:ide)?|width|h(?:igh)?|height|t(?:all)?)?\.?\s*(?:x|by)\s*` + NUM + UNIT + String.raw`(w(?:ide)?|width|h(?:igh)?|height|t(?:all)?)?\b`,
  'i',
);

export function parseSize(text: string): { widthIn: number; heightIn: number; swapped: boolean } | null {
  const m = normalize(text).match(SIZE_RE);
  if (!m) return null;
  const a = parseInches(m[1]);
  const b = parseInches(m[3]);
  if (a == null || b == null) return null;
  const firstIsHeight = /^(h|t)/i.test(m[2] ?? '') || /^w/i.test(m[4] ?? '');
  return firstIsHeight ? { widthIn: b, heightIn: a, swapped: true } : { widthIn: a, heightIn: b, swapped: false };
}

interface Match {
  option: Option;
  alias: string;
  line: string;
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Finds the catalog option whose alias appears in the text, preferring the longest alias. */
function matchOption(group: OptionGroup, lines: string[]): Match | null {
  const options = getCatalog()[group] as Option[];
  const candidates = options
    .flatMap((option) => option.aliases.map((alias) => ({ option, alias })))
    .sort((a, b) => b.alias.length - a.alias.length);
  for (const { option, alias } of candidates) {
    const re = new RegExp(`(^|[^a-z])${escapeRe(alias.toLowerCase())}($|[^a-z])`);
    const line = lines.find((l) => re.test(l.toLowerCase()));
    if (line) return { option, alias, line };
  }
  return null;
}

const DEFAULTS: PlaqueSpec = {
  material: 'bronze',
  widthIn: 12,
  heightIn: 18,
  finish: 'natural-satin-brushed-bronze',
  backgroundColor: 'dark-oxide',
  backgroundTexture: 'leatherette',
  border: 'single-line',
  font: 'times-new-roman',
  imageOption: 'none',
  mounting: 'blind-studs',
  lettering: 'raised',
  process: 'cast',
  thicknessIn: null,
  stakeLengthIn: null,
};

// Phrases that are understood but carry no option (so their lines are not reported as unrecognized).
const KNOWN_PHRASES = [/recessed/i, /paint[- ]?fill/i, /plaque/i, /raised/i, /background/i, /mount/i, /layout/i, /lettering/i, /letters/i, /^copy\s*:/i, /^order\s*#/i, /^description\s*:/i];

/** "Qty. 1 set …", "DESCRIPTION: …" and "ORDER# 32582" are header words, not options. */
function stripHeaderWords(line: string): string {
  return line
    .replace(/^description\s*[:꞉]\s*/i, '')
    .replace(/order\s*#\s*\d+/gi, '')
    .replace(/qty\.?\s*\d+\s*(set|sets|pcs?|pieces?)?/gi, '')
    .trim();
}

export function parseThickness(text: string): number | null {
  const m = normalize(text).match(/(\d+(?:\.\d+)?(?:\/\d+)?|\d+[\s-]+\d+\/\d+|[¼½¾⅛⅜⅝⅞])\s*(?:"|in(?:ch(?:es)?)?\.?)?\s*thick/i);
  if (!m) return null;
  const raw = m[1];
  if (/^\d+\/\d+$/.test(raw)) {
    const [a, b] = raw.split('/').map(Number);
    return a / b;
  }
  return parseInches(raw);
}

export function parseStakeLength(text: string): number | null {
  const m = normalize(text).match(/(\d+(?:\.\d+)?)\s*(?:"|in(?:ch(?:es)?)?\.?)?\s*(?:long\s+)?(?:garden\s+|yard\s+|ground\s+)?stake/i);
  return m ? Number(m[1]) : null;
}

export function parseSpec(specText: string, hints: { hasPhoto?: boolean } = {}): ParseResult {
  const catalog = getCatalog();
  const notes: ParseNote[] = [];
  const assumed = new Set<SpecField>();
  const spec: PlaqueSpec = { ...DEFAULTS };
  const lines = normalize(specText)
    .split(/\r?\n/)
    // Description-style orders put everything in sentences: treat each sentence as a line.
    .flatMap((l) => (l.length > 90 || /\.\s+[A-Z]/.test(l) ? l.split(/(?<=[a-z0-9")])\.\s+(?=[A-Z0-9])/) : [l]))
    .map((l) => stripHeaderWords(l.trim()).replace(/\.$/, ''))
    .filter(Boolean);
  const used = new Set<string>();
  const label = (group: OptionGroup, id: string) => (catalog[group] as Option[]).find((o) => o.id === id)?.label ?? id;
  const assume = (field: SpecField, message: string) => {
    assumed.add(field);
    notes.push({ field, kind: 'assumed', message });
  };

  // Material
  const lower = lines.join('\n').toLowerCase();
  if (/alumin(i)?um/.test(lower)) {
    notes.push({
      field: 'material',
      kind: 'unavailable',
      message: 'Aluminum plaques are handled in a separate app. This studio produces cast bronze; the job is set to Cast Bronze.',
    });
  }
  const mat = matchOption('materials', lines);
  if (mat) used.add(mat.line);
  else assume('material', 'Material not stated. Assumed Cast Bronze.');

  // Size
  const sizeLine = lines.find((l) => parseSize(l));
  const size = sizeLine ? parseSize(sizeLine) : null;
  if (size && sizeLine) {
    used.add(sizeLine);
    spec.widthIn = size.widthIn;
    spec.heightIn = size.heightIn;
    const { minIn, maxIn, typicalMinIn, typicalMaxIn } = catalog.sizeLimits;
    for (const [dim, v] of [['width', size.widthIn], ['height', size.heightIn]] as const) {
      if (v < minIn || v > maxIn) {
        notes.push({ field: dim === 'width' ? 'widthIn' : 'heightIn', kind: 'unavailable', message: `${dim} ${v}" is outside the ${minIn}–${maxIn}" range we cast.` });
      } else if (v < typicalMinIn || v > typicalMaxIn) {
        notes.push({ field: dim === 'width' ? 'widthIn' : 'heightIn', kind: 'info', message: `${dim} ${v}" is outside the typical ${typicalMinIn}–${typicalMaxIn}" range. Confirm with production.` });
      }
    }
  } else {
    assume('widthIn', 'Size not found. Enter the width and height.');
    assumed.add('heightIn');
  }

  // Finish
  const fin = matchOption('finishes', lines);
  if (fin) {
    spec.finish = fin.option.id;
    used.add(fin.line);
    if (['satin', 'brushed'].includes(fin.alias)) {
      notes.push({ field: 'finish', kind: 'info', message: `"${fin.alias}" read as ${fin.option.label}.` });
    }
  } else assume('finish', `Finish not stated. Assumed ${label('finishes', spec.finish)}.`);

  // Background color and texture (look first at lines about the background / paint fill)
  const bgLines = lines.filter((l) => /background|paint|fill|field/i.test(l));
  const scope = bgLines.length ? bgLines : lines;
  const color = matchOption('backgroundColors', scope);
  const texture = matchOption('backgroundTextures', scope);
  if (color) {
    spec.backgroundColor = color.option.id;
    used.add(color.line);
  } else assume('backgroundColor', `Background color not stated. Assumed ${label('backgroundColors', spec.backgroundColor)}.`);
  if (texture) {
    spec.backgroundTexture = texture.option.id;
    used.add(texture.line);
  } else assume('backgroundTexture', `Background texture not stated. Assumed ${label('backgroundTextures', spec.backgroundTexture)}.`);
  if (color && texture && color.line === texture.line && / or /i.test(color.line)) {
    notes.push({
      field: 'backgroundColor',
      kind: 'info',
      message: `"${color.line}" read as ${color.option.label} paint with ${texture.option.label} texture.`,
    });
  }

  // Border
  const bor = matchOption('borders', lines);
  if (bor && bor.alias !== 'border') {
    spec.border = bor.option.id;
    used.add(bor.line);
  } else if (bor) {
    used.add(bor.line);
    assume('border', 'A border is requested without a style. Assumed Single Line Border.');
  } else assume('border', 'Border not mentioned. Assumed Single Line Border.');

  // Font
  const font = matchOption('fonts', lines);
  if (font) {
    spec.font = font.option.id;
    used.add(font.line);
  } else assume('font', `Font not stated. Assumed ${label('fonts', spec.font)}.`);

  // Image
  const textOnly = lines.some((l) => /text[- ]only/i.test(l));
  const imgLines = lines.map((l) => l.replace(/reverse[- ]etched[^,.;]*/gi, '').replace(/copy\s*:.*$/i, ''));
  const img = textOnly ? null : matchOption('imageOptions', imgLines);
  if (textOnly) {
    spec.imageOption = 'none';
  } else if (img) {
    spec.imageOption = img.option.id;
    used.add(img.line);
    if (['relief image', 'relief', 'photo'].includes(img.alias)) {
      assume('imageOption', `"${img.line}" does not name the relief type. Assumed ${img.option.label}.`);
    }
  } else if (hints.hasPhoto) {
    spec.imageOption = 'photo-relief';
    assume('imageOption', 'A photo was uploaded but the spec names no image option. Assumed Photo Relief.');
  } else {
    assume('imageOption', 'No image mentioned. Set to text only.');
  }

  // Mounting
  const mnt = matchOption('mountings', lines);
  if (mnt) {
    spec.mounting = mnt.option.id;
    used.add(mnt.line);
  } else assume('mounting', 'Mounting not stated. Assumed Blind Mount.');

  // Process: cast unless the order says reverse etched.
  const proc = matchOption('processes', lines);
  if (proc) {
    spec.process = proc.option.id;
    used.add(proc.line);
  }
  if (spec.process === 'reverse-etched' && spec.imageOption === 'etched-photo' && !lines.some((l) => /etched photo|photo etch/i.test(l))) {
    spec.imageOption = 'none';
  }

  // Thickness and garden stake length.
  for (const l of lines) {
    const t = parseThickness(l);
    if (t && !spec.thicknessIn) spec.thicknessIn = t;
    const sl = /stake/i.test(l) ? parseStakeLength(l) : null;
    if (sl && !spec.stakeLengthIn) spec.stakeLengthIn = sl;
  }
  if (spec.mounting === 'garden-stake' && !spec.stakeLengthIn) {
    spec.stakeLengthIn = 24;
    assume('stakeLengthIn', 'Garden stake length not stated. Assumed 24".');
  }

  // Lettering is always raised for cast plaques.
  const let_ = matchOption('lettering', lines);
  if (let_) used.add(let_.line);

  const unrecognizedLines = lines.filter((l) => !used.has(l) && !KNOWN_PHRASES.some((re) => re.test(l)));
  for (const l of unrecognizedLines) {
    notes.push({ field: 'general', kind: 'info', message: `Not understood, please check: "${l}"` });
  }

  return { spec, notes, assumed: [...assumed], unrecognizedLines };
}
