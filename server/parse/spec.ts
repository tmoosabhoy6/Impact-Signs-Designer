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
  customFontName: null,
  customPaint: null,
};

/** A rough paint color from a custom paint name ("Dark Blue 2050"); the designer confirms it. */
export function guessPaintHex(name: string): string {
  const n = name.toLowerCase();
  const base: [RegExp, string][] = [
    [/navy|blue/, '#1D2B5E'], [/green|hunter|forest/, '#1F3B2A'], [/red|burgundy|maroon/, '#5A1A1E'],
    [/gr[ae]y|slate|charcoal/, '#3A3C40'], [/brown|bronze|chocolate/, '#4A3426'], [/black/, '#111111'],
    [/white|ivory|cream/, '#E8E4D8'], [/tan|beige|sand/, '#A08B6A'], [/gold|yellow/, '#9C7A2B'],
  ];
  const hit = base.find(([re]) => re.test(n));
  return hit ? hit[1] : '#2A2A2A';
}

// Phrases that are understood but carry no option (so their lines are not reported as unrecognized).
const KNOWN_PHRASES = [/recessed/i, /paint[- ]?fill/i, /plaque/i, /raised/i, /background/i, /mount/i, /layout/i, /lettering/i, /letters/i, /^copy\s*:/i, /^order\s*#/i, /^description\s*:/i];

/** "Qty. 1 set …", "DESCRIPTION: …" and "ORDER# 32582" are header words, not options. */
function stripHeaderWords(line: string): string {
  return line
    .replace(/^description\s*[:꞉]\s*/i, '')
    .replace(/order\s*#\s*\d+/gi, '')
    .replace(/qty\.?\s*\d+\s*(set|sets|pcs?|pieces?)?/gi, '')
    .replace(/^qty\.?$/i, '')
    .replace(/^\d+\s*(set|sets|pcs?|pieces?)\b\s*/i, '')
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
  const mat = matchOption('materials', lines);
  if (mat) {
    spec.material = mat.option.id;
    used.add(mat.line);
  } else assume('material', 'Material not stated. Assumed Cast Bronze.');

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

  // Finish (only finishes made for this material)
  const fin = matchOption('finishes', lines);
  const finishFits = (id: string) => ((catalog.finishes.find((f) => f.id === id)?.materials as string[] | undefined) ?? ['bronze']).includes(spec.material);
  if (fin && !finishFits(fin.option.id)) {
    const alt = catalog.finishes.find((f) => finishFits(f.id));
    if (alt) {
      notes.push({ field: 'finish', kind: 'info', message: `"${fin.alias}" read as ${alt.label} for ${label('materials', spec.material)}.` });
      spec.finish = alt.id;
      used.add(fin.line);
    }
  } else if (fin) {
    spec.finish = fin.option.id;
    used.add(fin.line);
    if (['satin', 'brushed'].includes(fin.alias)) {
      notes.push({ field: 'finish', kind: 'info', message: `"${fin.alias}" read as ${fin.option.label}.` });
    }
  } else {
    const alt = catalog.finishes.find((f) => finishFits(f.id));
    if (alt) spec.finish = alt.id;
    assume('finish', `Finish not stated. Assumed ${label('finishes', spec.finish)}.`);
  }

  // Background color and texture (look first at lines about the background / paint fill)
  const bgLines = lines.filter((l) => /background|paint|fill|field/i.test(l));
  const scope = bgLines.length ? bgLines : lines;
  const color = matchOption('backgroundColors', scope);
  const texture = matchOption('backgroundTextures', scope);
  // "Background painted Dark Blue 2050 with …": a color that is not in the catalog is a custom paint match.
  const painted = scope.join(' ').match(/(?:background|field)\s+painted\s+(.+?)(?:\s+with\b|$)/i);
  const paintedName = painted?.[1].replace(/\s+/g, ' ').trim();
  if (color && (!paintedName || paintedName.toLowerCase().includes(color.alias))) {
    spec.backgroundColor = color.option.id;
    used.add(color.line);
  } else if (paintedName) {
    spec.backgroundColor = 'custom';
    spec.customPaint = { name: paintedName, hex: guessPaintHex(paintedName) };
    scope.filter((l) => l.includes(painted![1].trim().split(' ')[0])).forEach((l) => used.add(l));
    assume('backgroundColor', `"${paintedName}" is a custom paint color. Confirm the color swatch (preview color is an estimate).`);
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

  // Font ("Font: Clarendon Fortune Bold" that is not in the catalog becomes a custom font)
  const fontPhrase = lines.join('\n').match(/font\s*:\s*([^\n.]+)/i)?.[1].trim();
  const font = matchOption('fonts', fontPhrase ? [fontPhrase] : lines);
  if (font && (!fontPhrase || fontPhrase.toLowerCase().startsWith(font.alias.split(' ')[0]))) {
    spec.font = font.option.id;
    used.add(font.line);
    lines.filter((l) => /font\s*:/i.test(l)).forEach((l) => used.add(l));
  } else if (fontPhrase) {
    spec.font = 'custom';
    spec.customFontName = fontPhrase;
    lines.filter((l) => /font\s*:/i.test(l)).forEach((l) => used.add(l));
    notes.push({ field: 'font', kind: 'unavailable', message: `"${fontPhrase}" is not one of our standard fonts. Upload the font file to this job to use it; until then a stand-in is shown.` });
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
    assumed.delete('imageOption');
  }
  // Reverse-etched backgrounds are smooth unless a texture is named.
  if (spec.process === 'reverse-etched' && !texture) {
    spec.backgroundTexture = 'smooth';
    assumed.delete('backgroundTexture');
    const i = notes.findIndex((n) => n.field === 'backgroundTexture' && n.kind === 'assumed');
    if (i >= 0) notes.splice(i, 1);
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
