// The layout engine: exact plaque geometry, in inches from the plaque's top-left corner.
// The same layout drives the AI concept (as a reference drawing), the proof and the
// vector production file, so all three agree.
//
// Measured references:
//  - production_32241.ai (12x18): image frame 0.542 W wide, body 46.3 pt on a 64.6 pt pitch,
//    headline 56.3 pt, subhead 50.1 pt, ¼" single border, the stack centered in the field.
//  - Structure of Merit outline art (7x5) and Camp Southern Ground (12x16): double-line border
//    band / gap / inner line, growing with the plaque's shorter side.
import { getCatalog, mustOption, type BorderOption } from '../catalog.js';
import { loadFontFile, measure, missingGlyphs, resolveFont, SMALL_CAPS_SCALE, wrapText, type OTFont } from '../text/fonts.js';
import type { ImageFrame, LayoutAdjust, LayoutPresetId, LogoBox, PlaqueLayout, PlaqueSpec, Rect, TextLine, TextStyle, Wording, WordingRole } from '../../shared/types.js';

/** One uploaded photo or logo: its id (carried onto the layout) and width / height. */
export interface LayoutPicture {
  id?: string;
  aspect: number;
}

export interface LayoutInput {
  spec: PlaqueSpec;
  wording: Wording | null;
  /** Customer photos, in order. With an image option and no photo, one placeholder frame is drawn. */
  photos?: LayoutPicture[];
  /** Customer logos, in order; they sit together in one row (two rows for four or more). */
  logos?: LayoutPicture[];
  logoSlot?: 'auto' | 'top' | 'middle' | 'bottom';
  /** Put the image after this wording block; null/undefined = image first (top or left). */
  imageAfterBlock?: number | null;
  /** The job's own font file (custom font). */
  customFontFile?: string | null;
  /** Designer adjustments for this layout column (from Fix instructions). */
  adjust?: LayoutAdjust | null;
}

export const ADJUST_LIMITS = {
  textScale: [0.6, 1.6],
  spacing: [0.5, 2.5],
  imageScale: [0.5, 1.6],
  logoScale: [0.5, 2],
  verticalOffset: [-1, 1],
} as const satisfies Record<keyof LayoutAdjust, readonly [number, number]>;

/** Adjustments clamped to their limits; missing values mean unchanged. */
export function normalizeAdjust(a?: LayoutAdjust | null): Required<LayoutAdjust> {
  const v = (k: keyof LayoutAdjust, d: number) => {
    const n = a?.[k];
    const [lo, hi] = ADJUST_LIMITS[k];
    return typeof n === 'number' && Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
  };
  return { textScale: v('textScale', 1), spacing: v('spacing', 1), imageScale: v('imageScale', 1), logoScale: v('logoScale', 1), verticalOffset: v('verticalOffset', 0) };
}

interface PresetDef {
  id: LayoutPresetId;
  label: string;
  description: string;
  /** Image frame width as a fraction of plaque width when the image is in the column. */
  topImageFrac: number;
  /** Image column width as a fraction of the content width when the image sits left. */
  sideImageFrac: number;
  headline: number;
  subhead: number;
  body: number;
  /** Multiplier on the vertical gaps between groups. */
  gaps: number;
}

export const PRESETS: PresetDef[] = [
  {
    id: 'classic',
    label: 'Classic',
    description: 'Balanced, centered arrangement matching our standard recognition plaque proportions.',
    topImageFrac: 0.542,
    sideImageFrac: 0.4,
    headline: 1.216,
    subhead: 1.082,
    body: 1,
    gaps: 1,
  },
  {
    id: 'portrait',
    label: 'Feature Image',
    description: 'Larger image as the hero; the text block is set slightly smaller and tighter around it.',
    topImageFrac: 0.64,
    sideImageFrac: 0.48,
    headline: 1.2,
    subhead: 1.05,
    body: 0.92,
    gaps: 0.85,
  },
  {
    id: 'statement',
    label: 'Statement',
    description: 'Headline-led: a larger name line with more breathing room and a more compact image.',
    topImageFrac: 0.45,
    sideImageFrac: 0.34,
    headline: 1.5,
    subhead: 1.12,
    body: 1,
    gaps: 1.2,
  },
];

// Vertical rhythm, in multiples of the body size (measured on production_32241.ai).
const GAP = {
  frameToText: 2.549,
  headlineToSubhead: 1.348,
  subheadToBody: 2.715,
  headlineToBody: 2.4,
  bodyLeading: 1.395,
  paragraph: 1.85,
  toFooter: 2.4,
  textToLogo: 1.1,
  logoToText: 2.2,
  textToFrame: 1.2,
  descent: 0.15,
};
/** Body size as a fraction of the plaque's shorter side (0.643 in on a 12 in plaque). */
const BODY_FRAC = 0.0536;
/** Inner photo window inset inside the raised image frame (1/8 in on the real file). */
const FRAME_INSET_IN = 0.125;
/** Aspect ratio of the placeholder frame drawn before the photo is uploaded. */
const PLACEHOLDER_ASPECT = 0.9;

// ---------- Groups of pictures (several photos, a row of logos) ----------

/** Pictures in rows of one shared height; `rows` lists picture indices row by row. */
export interface Arrangement {
  rows: number[][];
  h: number;
}

/** The pictures' cells, relative to the group's top-left corner, in picture order. */
interface Group {
  w: number;
  h: number;
  cells: Rect[];
}

/** n pictures in r rows, in order, as evenly as possible (5 in 2 rows = 3 + 2). */
function splitRows(n: number, r: number): number[][] {
  const rows: number[][] = [];
  let i = 0;
  for (let k = 0; k < r; k++) rows.push(Array.from({ length: Math.floor(n / r) + (k < n % r ? 1 : 0) }, () => i++));
  return rows;
}

const rowAspect = (aspects: number[], row: number[]) => row.reduce((sum, i) => sum + aspects[i], 0);

/** The tallest shared picture height at which every row fits within maxW. */
export function heightForWidth(aspects: number[], rows: number[][], maxW: number, gutter: number): number {
  return Math.min(...rows.map((row) => (maxW - gutter * (row.length - 1)) / rowAspect(aspects, row)));
}

/**
 * The largest arrangement of pictures inside a bw x bh box, side by side with `gutter`
 * between them. Extra rows win only when they make the pictures clearly larger
 * (`preferFewer`, by area), so two portraits stay side by side. A single picture keeps the
 * measured single-frame rule exactly: bw wide, unless that is taller than bh.
 */
export function arrangePictures(
  aspects: number[],
  bw: number,
  bh: number,
  gutter: number,
  opts: { maxRows?: number; rows?: number; preferFewer?: number } = {},
): Arrangement {
  const n = aspects.length;
  if (n === 1) {
    // Same arithmetic as the original single frame: fh = fw / aspect, capped at the box height.
    const h = bw / aspects[0];
    return { rows: [[0]], h: h > bh ? bh : h };
  }
  const counts = opts.rows ? [opts.rows] : Array.from({ length: Math.min(n, opts.maxRows ?? 1) }, (_, i) => i + 1);
  const total = aspects.reduce((a, b) => a + b, 0);
  let best: (Arrangement & { area: number }) | null = null;
  for (const r of counts) {
    const rows = splitRows(n, r);
    const h = Math.min(heightForWidth(aspects, rows, bw, gutter), (bh - gutter * (r - 1)) / r);
    if (!(h > 0)) continue;
    const area = h * h * total;
    if (!best || area > best.area * (opts.preferFewer ?? 1.25)) best = { rows, h, area };
  }
  // A box too small for the gutters: one tight row, so nothing overlaps.
  return best ? { rows: best.rows, h: best.h } : { rows: splitRows(n, 1), h: Math.max(1e-3, Math.min(bw / total, bh)) };
}

/** Cell rectangles for an arrangement; each row is centered in the group's width. */
function groupCells(aspects: number[], arr: Arrangement, gutter: number): Group {
  const rowW = arr.rows.map((row) => arr.h * rowAspect(aspects, row) + gutter * (row.length - 1));
  const w = Math.max(...rowW);
  const cells: Rect[] = [];
  arr.rows.forEach((row, r) => {
    let x = (w - rowW[r]) / 2;
    const y = r * (arr.h + gutter);
    for (const i of row) {
      cells[i] = { x, y, w: arr.h * aspects[i], h: arr.h };
      x += arr.h * aspects[i] + gutter;
    }
  });
  return { w, h: arr.rows.length * arr.h + gutter * (arr.rows.length - 1), cells };
}

/** A box budget that widens for several pictures in a row, up to `cap`. */
const rowBudget = (base: number, n: number, cap: number) => (n <= 1 ? base : Math.min(cap, base * (1 + 0.55 * (n - 1))));

const orientationOf = (aspect: number): ImageFrame['orientation'] => (aspect > 1.1 ? 'landscape' : aspect < 0.91 ? 'portrait' : 'square');

const offset = (r: Rect, x: number, y: number): Rect => ({ x: r.x + x, y: r.y + y, w: r.w, h: r.h });

/** Border geometry for this plaque size (double-line scales with the shorter side). */
export function borderGeometry(border: BorderOption, W: number, H: number) {
  const s = (border as BorderOption & { scaling?: { perInch: Record<string, number>; fromIn: number; max: Record<string, number> } }).scaling;
  const grow = (key: 'widthIn' | 'gapIn' | 'innerLineIn', base: number) =>
    s ? Math.min(s.max[key] ?? Infinity, base + (s.perInch[key] ?? 0) * Math.max(0, Math.min(W, H) - s.fromIn)) : base;
  return {
    band: grow('widthIn', border.widthIn),
    gap: border.gapIn ? grow('gapIn', border.gapIn) : 0,
    inner: border.innerLineIn ? grow('innerLineIn', border.innerLineIn) : 0,
  };
}

interface StyledText {
  text: string;
  /** Offset of the line's anchor from the column center (center-aligned) … */
  dx: number;
  /** … or from the column's left edge (left-aligned). */
  left?: number;
}

type Item =
  | { kind: 'frame'; w: number; h: number; cells: Rect[] }
  | { kind: 'logo'; w: number; h: number; cells: Rect[] }
  | { kind: 'text'; role: WordingRole; lines: StyledText[]; size: number; leading: number; style: TextStyle; face: OTFont; faceFile: string; width: number };

interface Placed {
  /** The whole photo group and each frame in it (relative to the group). */
  frame?: Rect & { cells: Rect[] };
  /** The whole logo row and each logo in it (relative to the row). */
  logo?: Rect & { cells: Rect[] };
  lines: (StyledText & { role: WordingRole; baseline: number; size: number; style: TextStyle; faceFile: string })[];
  rules: { y: number; w: number; t: number }[];
  height: number;
  maxLineWidth: number;
}

export function capHeightRatio(font: OTFont): number {
  const os2 = (font.tables as { os2?: { sCapHeight?: number } }).os2;
  return os2?.sCapHeight ? os2.sCapHeight / font.unitsPerEm : 0.66;
}

/** Stacks items vertically; returns positions relative to the stack's top (y = 0). */
function stack(items: Item[], B: number, gapMul: number, spacing = 1): Placed {
  const out: Placed = { lines: [], rules: [], height: 0, maxLineWidth: 0 };
  let cursor = 0; // bottom of the previous box, or the previous baseline (+ rule)
  let prev: Item | null = null;
  for (const item of items) {
    if (item.kind === 'frame' || item.kind === 'logo') {
      let top = 0;
      if (prev?.kind === 'text') top = cursor + (item.kind === 'logo' ? GAP.textToLogo : GAP.textToFrame) * B * gapMul + GAP.descent * B;
      else if (prev) top = cursor + 1.2 * B * gapMul;
      const r = { x: 0, y: top, w: item.w, h: item.h, cells: item.cells };
      if (item.kind === 'frame') out.frame = r;
      else out.logo = r;
      cursor = top + item.h;
    } else {
      const cap = capHeightRatio(item.face);
      let first: number;
      if (!prev) first = cap * item.size;
      else if (prev.kind === 'frame') first = cursor + GAP.frameToText * B * gapMul;
      else if (prev.kind === 'logo') first = cursor + GAP.logoToText * B * gapMul;
      else {
        const pair = `${prev.role}>${item.role}`;
        const g =
          pair === 'headline>subhead' ? GAP.headlineToSubhead
          : pair === 'subhead>body' ? GAP.subheadToBody
          : pair === 'headline>body' ? GAP.headlineToBody
          : item.role === 'footer' && prev.role === 'body' ? GAP.toFooter
          : prev.role === item.role ? (item.role === 'headline' || item.role === 'subhead' ? 1.25 * (item.size / B) : GAP.paragraph)
          : GAP.headlineToSubhead;
        first = cursor + g * B * (prev.role === item.role ? spacing : gapMul);
      }
      const rows = new Map<number, number>(); // row index -> baseline (columns share rows)
      item.lines.forEach((l, i) => {
        const row = (l as StyledText & { row?: number }).row ?? i;
        const baseline = first + row * item.leading;
        rows.set(row, baseline);
        out.lines.push({ ...l, role: item.role, baseline, size: item.size, style: item.style, faceFile: item.faceFile });
      });
      out.maxLineWidth = Math.max(out.maxLineWidth, item.width);
      cursor = Math.max(...rows.values());
      if (item.style.ruleBelow) {
        const t = Math.max(0.03, item.size * 0.05);
        out.rules.push({ y: cursor + item.size * 0.42, w: 0, t });
        cursor += item.size * 0.7;
      }
    }
    prev = item;
  }
  out.height = prev?.kind === 'text' ? cursor + GAP.descent * B : cursor;
  return out;
}

function roleMul(role: WordingRole, p: PresetDef) {
  return role === 'headline' ? p.headline : role === 'subhead' ? p.subhead : role === 'footer' ? 0.85 : p.body;
}

function textItems(input: LayoutInput, B: number, p: PresetDef, maxWidth: number, spacing = 1): Item[] {
  const items: Item[] = [];
  // Wider spacing opens the line leading a little too.
  const lead = 1 + (spacing - 1) * 0.4;
  const blocks = (input.wording?.blocks ?? []).filter((b) => b.text.trim());
  for (const b of blocks) {
    const style = b.style ?? {};
    const rf = resolveFont(style.font ?? input.spec.font, style, input.customFontFile);
    const face = rf.font;
    let size = B * roleMul(b.role, p) * Math.min(2.5, Math.max(0.4, style.size ?? 1));
    const cols = Math.max(1, Math.min(4, style.columns ?? 1));
    if (cols > 1) {
      // Donor-list columns: entries fill columns top to bottom.
      const entries = b.text.split('\n').map((t) => t.trim()).filter(Boolean);
      const perCol = Math.ceil(entries.length / cols);
      const colW = maxWidth / cols;
      const longest = Math.max(...entries.map((e) => measure(face, e, size, style.smallCaps)));
      if (longest > colW * 0.94) size = Math.max(size * 0.4, (size * colW * 0.94) / longest);
      const lines: (StyledText & { row: number })[] = entries.map((text, i) => {
        const c = Math.floor(i / perCol);
        const row = i % perCol;
        const colLeft = -maxWidth / 2 + c * colW;
        return style.align === 'left' ? { text, dx: 0, left: colLeft + colW * 0.03, row } : { text, dx: colLeft + colW / 2, row };
      });
      items.push({ kind: 'text', role: b.role, lines, size, leading: 1.25 * size * lead, style, face, faceFile: rf.file, width: maxWidth });
      continue;
    }
    // Name and organization lines should stay on one line: shrink them (up to 25%) before wrapping.
    if ((b.role === 'headline' || b.role === 'subhead') && !b.text.includes('\n')) {
      const natural = measure(face, b.text, size, style.smallCaps);
      if (natural > maxWidth) size = Math.max(size * 0.75, (size * maxWidth) / natural);
    }
    const leading = (b.role === 'body' || b.role === 'footer' ? GAP.bodyLeading * size : 1.15 * size) * lead;
    const wrapped = wrapText(face, b.text, size, maxWidth, style.smallCaps);
    const width = Math.max(0, ...wrapped.map((t) => measure(face, t, size, style.smallCaps)));
    const lines: StyledText[] = wrapped.map((text) => (style.align === 'left' ? { text, dx: 0, left: -maxWidth / 2 } : { text, dx: 0 }));
    items.push({ kind: 'text', role: b.role, lines, size, leading, style, face, faceFile: rf.file, width });
  }
  return items;
}

export function computeLayout(input: LayoutInput, presetId: LayoutPresetId): PlaqueLayout {
  const { spec } = input;
  const preset = PRESETS.find((p) => p.id === presetId) ?? PRESETS[0];
  const W = spec.widthIn;
  const H = spec.heightIn;
  const border = mustOption('borders', spec.border);
  const geo = borderGeometry(border, W, H);
  const bw = geo.band;
  const field: Rect = { x: bw, y: bw, w: W - 2 * bw, h: H - 2 * bw };
  // Content stays inside a double border's inner line.
  const innerOffset = geo.gap + geo.inner;
  const content: Rect = { x: field.x + innerOffset, y: field.y + innerOffset, w: field.w - 2 * innerOffset, h: field.h - 2 * innerOffset };
  const warnings: string[] = [];
  const adj = normalizeAdjust(input.adjust);
  const gapMul = preset.gaps * adj.spacing;

  const main = resolveFont(spec.font, {}, input.customFontFile);
  if (spec.font === 'custom' && !input.customFontFile) {
    warnings.push(`Custom font "${spec.customFontName ?? 'not named'}" has no font file yet: a stand-in is used. Upload the font file to the job.`);
  } else if (!main.licensed) {
    warnings.push(`${main.label} is not installed; an open stand-in with matching proportions is used.`);
  }

  const hasImage = spec.imageOption !== 'none';
  // Photos are cropped into frames between 0.55 and 1.8 wide-to-tall, as the single frame always was.
  const photos: LayoutPicture[] = hasImage
    ? (input.photos?.length ? input.photos : [{ aspect: PLACEHOLDER_ASPECT }]).map((p) => ({ id: p.id, aspect: Math.min(1.8, Math.max(0.55, p.aspect || PLACEHOLDER_ASPECT)) }))
    : [];
  const photoAspects = photos.map((p) => p.aspect);
  const imageAfter = input.imageAfterBlock ?? null;
  // Landscape photos on a landscape plaque sit at the left (one, or two stacked); more go in a group above the text.
  const imageLeft = hasImage && W >= H && imageAfter == null && photos.length <= 2 && photos.every((p) => orientationOf(p.aspect) === 'landscape');
  const logos: LayoutPicture[] = (input.logos ?? []).map((l) => ({ id: l.id, aspect: Math.min(6, Math.max(0.3, l.aspect || 1)) }));
  const logoAspects = logos.map((l) => l.aspect);
  const hasLogo = logos.length > 0;
  // Space between pictures of a group: field shows between the raised frames / logos.
  const photoGap = Math.max(0.15, 0.035 * Math.min(W, H));
  const logoGap = Math.max(0.15, 0.03 * Math.min(W, H));

  // Face screws / rosettes sit in the field corners and keep text away from them.
  const mounting = spec.mounting;
  const screwD = mounting === 'rosettes' ? Math.min(0.5, 0.06 * Math.min(W, H)) : mounting === 'screws-through-face' ? Math.min(0.25, 0.045 * Math.min(W, H)) : 0;
  const screwInset = screwD ? Math.max(0.2, 0.05 * Math.min(W, H)) + screwD / 2 : 0;
  const screws = screwD
    ? [
        { cx: content.x + screwInset, cy: content.y + screwInset },
        { cx: content.x + content.w - screwInset, cy: content.y + screwInset },
        { cx: content.x + screwInset, cy: content.y + content.h - screwInset },
        { cx: content.x + content.w - screwInset, cy: content.y + content.h - screwInset },
      ].map((s) => ({ ...s, d: screwD }))
    : [];
  const screwKeepOut = screwD ? screwInset + screwD : 0;

  const pad = Math.max(0.35, 0.07 * Math.min(content.w, content.h));
  const B0 = BODY_FRAC * Math.min(W, H);
  const allText = (input.wording?.blocks ?? []).map((b) => b.text).join(' ');
  const missing = missingGlyphs(main.font, allText);
  if (missing.length) warnings.push(`The font cannot draw: ${missing.join(' ')}`);

  let slot = input.logoSlot ?? 'auto';
  if (slot === 'auto') slot = hasImage && !imageLeft && imageAfter == null ? 'bottom' : 'top';

  // The logo row: one box per logo. A resized row never grows wider than its column.
  const logoItem = (bw: number, bh: number, maxW: number): Item => {
    let arr = arrangePictures(logoAspects, bw, bh * (logos.length >= 4 ? 1.7 : 1), logoGap, { maxRows: logos.length >= 4 ? 2 : 1 });
    if (adj.logoScale !== 1) arr = { ...arr, h: Math.min(arr.h * adj.logoScale, heightForWidth(logoAspects, arr.rows, 0.9 * maxW, logoGap)) };
    const g = groupCells(logoAspects, arr, logoGap);
    return { kind: 'logo', w: g.w, h: g.h, cells: g.cells };
  };

  let best: Placed | null = null;
  let colX = content.x;
  let colW = content.w;
  let frameRect: Rect | null = null;
  let frameCells: Rect[] = [];
  let scale = 1;
  const textOnly = !hasImage;
  // Text-only plaques set their type large (Kathleen Awe, Sax-Zim Bog, Hadar Family Hall).
  const dense = (input.wording?.blocks.length ?? 0) >= 6;
  // Text-only type is sized to fill the field, so "larger text" fills more of it.
  const fillLimit = textOnly ? Math.min(0.97, (dense ? 0.92 : 0.82) * adj.textScale) : 1;
  const textMul = textOnly ? 1 : adj.textScale;
  for (scale = textOnly ? 3.2 : 1; scale >= 0.25; scale -= 0.02) {
    const B = B0 * scale * textMul;
    if (imageLeft) {
      const contentW = content.w - 2 * pad;
      const contentH = content.h - 2 * pad;
      // The image column: one frame, or two stacked.
      const bw = Math.min(contentW * 0.65, contentW * preset.sideImageFrac * adj.imageScale * Math.min(1, scale + 0.15));
      const group = groupCells(photoAspects, arrangePictures(photoAspects, bw, contentH, photoGap, { rows: photos.length }), photoGap);
      const fw = group.w;
      const fh = group.h;
      const gutter = 0.06 * contentW;
      colX = content.x + pad + fw + gutter;
      colW = contentW - fw - gutter;
      frameRect = { x: content.x + pad, y: content.y + (content.h - fh) / 2, w: fw, h: fh };
      frameCells = group.cells;
      const items = textItems(input, B, preset, colW, adj.spacing);
      if (hasLogo) {
        const logo = logoItem(rowBudget(0.5 * colW, logos.length, 0.95 * colW) * scale, 0.16 * contentH * scale, colW);
        if (slot === 'bottom') items.push(logo);
        else if (slot === 'middle') items.splice(Math.min(items.length, 2), 0, logo);
        else items.unshift(logo);
      }
      const placed = stack(items, B, gapMul, adj.spacing);
      best = placed;
      if (placed.height <= contentH * fillLimit && placed.maxLineWidth <= colW + 1e-6) break;
    } else {
      colX = content.x;
      colW = content.w;
      const maxText = Math.min(content.w * 0.92, content.w - 2 * screwKeepOut);
      const texts = textItems(input, B, preset, maxText, adj.spacing);
      const items: Item[] = [];
      let frame: Item | null = null;
      if (hasImage) {
        const fit = Math.min(1, scale + 0.1);
        const many = photos.length > 1;
        // Several photos share a wider budget; their height also shrinks as the type does.
        const bw = Math.min(content.w * 0.92, W * preset.topImageFrac * (imageAfter == null ? 1 : 1.15) * (many ? Math.min(1.8, 1 + 0.6 * (photos.length - 1)) : 1) * adj.imageScale * fit);
        const maxFh = content.h * Math.min(0.8, (imageAfter == null ? 0.55 : 0.5) * Math.max(1, adj.imageScale)) * (many ? fit : 1);
        const g = groupCells(photoAspects, arrangePictures(photoAspects, bw, maxFh, photoGap, { maxRows: 2 }), photoGap);
        frame = { kind: 'frame', w: g.w, h: g.h, cells: g.cells };
      }
      const after = imageAfter == null ? -1 : Math.min(imageAfter, texts.length - 1);
      if (frame && after < 0) items.push(frame);
      texts.forEach((t, i) => {
        items.push(t);
        if (frame && i === after) items.push(frame);
      });
      if (hasLogo) {
        const logo = logoItem(rowBudget(0.4 * W, logos.length, 0.9 * content.w) * scale, 0.12 * H * scale, content.w);
        if (slot === 'bottom') items.push(logo);
        else if (slot === 'middle') {
          const firstBody = items.findIndex((i) => i.kind === 'text' && i.role === 'body');
          items.splice(firstBody >= 0 ? firstBody : items.length, 0, logo);
        } else items.splice(frame && after < 0 ? 1 : 0, 0, logo);
      }
      const placed = stack(items, B, gapMul, adj.spacing);
      best = placed;
      const avail = content.h - 2 * Math.max(0.3, 0.05 * content.h, screwD ? screwInset * 0.6 : 0);
      if (placed.height <= avail * fillLimit && placed.maxLineWidth <= maxText + 1e-6) break;
    }
  }
  if (!best) throw new Error('Layout failed');
  if (scale < 0.25) warnings.push('The wording does not fit comfortably at a readable size. Consider a larger plaque or less text.');

  // Center the stack vertically in its area (or move it up/down within the free space).
  const areaTop = imageLeft ? content.y + pad : content.y;
  const areaH = imageLeft ? content.h - 2 * pad : content.h;
  const slack = areaH - best.height;
  const margin = imageLeft ? 0 : Math.max(0.3, 0.05 * content.h, screwD ? screwInset * 0.6 : 0);
  const dy = adj.verticalOffset && slack > 2 * margin
    ? areaTop + margin + ((slack - 2 * margin) * (1 + adj.verticalOffset)) / 2
    : areaTop + slack / 2;
  const cx = colX + colW / 2;
  const textWidth = imageLeft ? colW : Math.min(content.w * 0.92, content.w - 2 * screwKeepOut);

  const lines: TextLine[] = best.lines.map((l) => ({
    text: l.text,
    role: l.role,
    cx: cx + l.dx,
    baseline: l.baseline + dy,
    size: l.size,
    style: Object.keys(l.style).length ? l.style : undefined,
    face: l.faceFile,
    ...(l.left != null ? { x: cx + l.left } : {}),
  }));
  const rules: Rect[] = best.rules.map((r) => ({ x: cx - (textWidth * 0.94) / 2, y: r.y + dy - r.t / 2, w: textWidth * 0.94, h: r.t }));
  if (!imageLeft && best.frame) {
    frameRect = { x: (W - best.frame.w) / 2, y: best.frame.y + dy, w: best.frame.w, h: best.frame.h };
    frameCells = best.frame.cells;
  }
  const logoRow = best.logo ? { x: cx - best.logo.w / 2, y: best.logo.y + dy } : null;
  const logoBoxes: LogoBox[] = logoRow && best.logo
    ? best.logo.cells.map((c, i) => ({ ...offset(c, logoRow.x, logoRow.y), ...(logos[i].id ? { logoId: logos[i].id } : {}) }))
    : [];

  // Minimum letter heights: capitals ¼", mixed case ⅜" cap height (≈ ¼" lowercase).
  let minLetterIn = Infinity;
  for (const l of lines) {
    const cap = capHeightRatio(resolveFontFace(l.face) ?? main.font);
    const hasLower = /[a-z]/.test(l.text);
    const letter = cap * l.size * (l.style?.smallCaps && hasLower ? SMALL_CAPS_SCALE : 1);
    minLetterIn = Math.min(minLetterIn, hasLower && !l.style?.smallCaps ? letter * (0.25 / 0.375) : letter);
  }
  if (minLetterIn < 0.25 - 1e-3) {
    warnings.push(`The smallest letters are ${minLetterIn.toFixed(2)}" tall, below the ¼" casting minimum.`);
  }

  const imageFrames: ImageFrame[] = hasImage && frameRect
    ? frameCells.map((c, i) => {
        const outer = offset(c, frameRect!.x, frameRect!.y);
        const inset = Math.min(FRAME_INSET_IN, 0.04 * Math.min(outer.w, outer.h));
        return {
          ...(photos[i].id ? { photoId: photos[i].id } : {}),
          outer,
          inner: { x: outer.x + inset, y: outer.y + inset, w: outer.w - 2 * inset, h: outer.h - 2 * inset },
          orientation: orientationOf(photos[i].aspect),
        };
      })
    : [];
  const innerLineCenter = geo.gap + geo.inner / 2;
  return {
    preset: preset.id,
    presetLabel: preset.label,
    presetDescription: preset.description,
    widthIn: W,
    heightIn: H,
    border: {
      id: border.id,
      widthIn: bw,
      verified: border.verified,
      innerLineIn: geo.inner || undefined,
      innerLine: geo.inner
        ? { x: field.x + innerLineCenter, y: field.y + innerLineCenter, w: field.w - 2 * innerLineCenter, h: field.h - 2 * innerLineCenter }
        : undefined,
    },
    field,
    imageFrames,
    logos: logoBoxes,
    lines,
    rules,
    screws,
    minLetterIn: Number.isFinite(minLetterIn) ? +minLetterIn.toFixed(3) : null,
    warnings,
  };
}

function resolveFontFace(file?: string): OTFont | null {
  try {
    return file ? loadFontFile(file) : null;
  } catch {
    return null;
  }
}

export function computeAllLayouts(input: LayoutInput): PlaqueLayout[] {
  return PRESETS.map((p) => computeLayout(input, p.id));
}

export { getCatalog };
