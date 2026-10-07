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
import { capHeightRatio, loadFontFile, measure, missingGlyphs, resolveFont, SMALL_CAPS_SCALE, wrapText, type OTFont } from '../text/fonts.js';
import { layoutProblems } from './check.js';
import type { ImageFrame, LayoutAdjust, LayoutPresetId, LogoBox, LogoPosition, PlaqueLayout, PlaqueSpec, Rect, TextLine, TextStyle, Wording, WordingBlock, WordingRole } from '../../shared/types.js';

/** One uploaded photo or logo: its id (carried onto the layout) and width / height. */
export interface LayoutPicture {
  id?: string;
  aspect: number;
  position?: LogoPosition;
}

export interface LayoutInput {
  spec: PlaqueSpec;
  wording: Wording | null;
  /** Customer photos, in order. With an image option and no photo, one placeholder frame is drawn. */
  photos?: LayoutPicture[];
  /** Customer logos, in order; they sit together in one row (two rows for four or more). */
  logos?: LayoutPicture[];
  exactDesign?: LayoutPicture;
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
    description: 'Balanced equal columns: photo centered at the top left, two or three opening text lines centered at the top right and vertically aligned with the photo, remaining wording centered across the bottom.',
    topImageFrac: 0.45,
    sideImageFrac: 0.34,
    headline: 1.5,
    subhead: 1.12,
    body: 1,
    gaps: 1.2,
  },
];

// Keep retired definitions for saved images and their proofs; new batches use these two.
export const ACTIVE_PRESETS = PRESETS.filter((p) => p.id !== 'portrait');

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
  rules: { x?: number; y: number; w: number; t: number }[];
  height: number;
  maxLineWidth: number;
}

export { capHeightRatio };

/** Letters are cast at least this tall; punctuation and digits have no minimum. */
export const MIN_LETTER_IN = 0.25;

/**
 * Height of a line's letters per inch of em size: the cap height for capitals (and digits,
 * which are cap height), about two thirds of it for lowercase (3/8" caps give 1/4"
 * lowercase), small capitals at their scale. Null when the line is only punctuation.
 */
export function letterRatio(face: OTFont, text: string, style?: TextStyle): number | null {
  if (!/[A-Za-z0-9]/.test(text)) return null;
  const cap = capHeightRatio(face);
  const hasLower = /[a-z]/.test(text);
  if (style?.smallCaps && hasLower) return cap * SMALL_CAPS_SCALE;
  return hasLower ? cap * (0.25 / 0.375) : cap;
}

/** The smallest em size (inches) at which this line's letters are MIN_LETTER_IN tall. */
function minSizeFor(face: OTFont, text: string, style?: TextStyle): number {
  const ratio = letterRatio(face, text, style);
  return ratio ? MIN_LETTER_IN / ratio : 0;
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
        // Never closer than the previous line's descent plus this line's cap height: lines
        // held at the ¼" minimum are larger than the base size the gaps scale with.
        first = Math.max(first, cursor + 0.28 * prev.size + (cap + 0.12) * item.size);
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

/** What the text builder noticed, for the fit loop (reset on every pass). */
interface TextStats {
  /** Column entries that are wider than their column after the ¼" minimum was applied. */
  wide: number;
  /** Smallest type size (inches) among the lines of donor lists (see `listRuns`). */
  listSize: number;
  /** Ids of the wording blocks that belong to donor lists. */
  members: Set<string>;
}

function textItems(input: LayoutInput, B: number, p: PresetDef, maxWidth: number, spacing = 1, stats?: TextStats, minLetter = true): { items: Item[]; raised: number } {
  const items: Item[] = [];
  // Lines whose letters would be cast smaller than the minimum are set at the minimum instead.
  let raised = 0;
  const floor = (size: number, face: OTFont, text: string, style: TextStyle) => {
    if (!minLetter) return size;
    const min = minSizeFor(face, text, style);
    if (size >= min - 1e-9) return size;
    raised++;
    return min;
  };
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
      const slots = columnSlots(entries, cols);
      const colW = maxWidth / cols;
      const longest = Math.max(...entries.map((e) => measure(face, e, size, style.smallCaps)));
      if (longest > colW * 0.94) size = Math.max(size * 0.4, (size * colW * 0.94) / longest);
      size = floor(size, face, b.text, style);
      if (stats) {
        // The ¼" minimum can lift the type back above what the column holds: entries would touch.
        if (Math.max(...entries.map((e) => measure(face, e, size, style.smallCaps))) > colW * 0.97) stats.wide++;
        if (stats.members.has(b.id)) stats.listSize = Math.min(stats.listSize, size);
      }
      const lines: (StyledText & { row: number })[] = entries.map((text, i) => {
        const { col: c, row } = slots[i]!;
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
    size = floor(size, face, b.text, style);
    if (stats?.members.has(b.id)) stats.listSize = Math.min(stats.listSize, size);
    const leading = (b.role === 'body' || b.role === 'footer' ? GAP.bodyLeading * size : 1.15 * size) * lead;
    const wrapped = wrapText(face, b.text, size, maxWidth, style.smallCaps);
    const width = Math.max(0, ...wrapped.map((t) => measure(face, t, size, style.smallCaps)));
    const lines: StyledText[] = wrapped.map((text) => (style.align === 'left' ? { text, dx: 0, left: -maxWidth / 2 } : { text, dx: 0 }));
    items.push({ kind: 'text', role: b.role, lines, size, leading, style, face, faceFile: rf.file, width });
  }
  return { items, raised };
}

/** One fitting attempt: the layout, whether the type fit at a legal size, and the donor-list type size. */
interface Fitted {
  layout: PlaqueLayout;
  fits: boolean;
  listSize: number;
  /** Nothing runs off the plaque or overlaps (it may still be tighter than comfortable). */
  sound: boolean;
}

interface FitPlan {
  dense: boolean;
  members: Set<string>;
  /** Hold letters at the ¼" minimum. Off only when the wording cannot fit at it (see `computeCore`). */
  minLetter: boolean;
}

function fitLayout(input: LayoutInput, presetId: LayoutPresetId, contentOverride: Rect | undefined, plan: FitPlan): Fitted {
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
  const plaqueContent: Rect = { x: field.x + innerOffset, y: field.y + innerOffset, w: field.w - 2 * innerOffset, h: field.h - 2 * innerOffset };
  const content = contentOverride ?? plaqueContent;
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
  // Landscape plaques reserve the left for photos; Statement splits the top in either orientation.
  const splitTop = hasImage && presetId === 'statement';
  const imageLeft = hasImage && !splitTop && W >= H;
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
        { cx: plaqueContent.x + screwInset, cy: plaqueContent.y + screwInset },
        { cx: plaqueContent.x + plaqueContent.w - screwInset, cy: plaqueContent.y + screwInset },
        { cx: plaqueContent.x + screwInset, cy: plaqueContent.y + plaqueContent.h - screwInset },
        { cx: plaqueContent.x + plaqueContent.w - screwInset, cy: plaqueContent.y + plaqueContent.h - screwInset },
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
  let raised = 0;
  const textOnly = !hasImage;
  // Text-only plaques set their type large (Kathleen Awe, Sax-Zim Bog, Hadar Family Hall).
  const dense = plan.dense;
  // Text-only type is sized to fill the field, so "larger text" fills more of it.
  const fillLimit = textOnly ? Math.min(0.97, (dense ? 0.92 : 0.82) * adj.textScale) : 1;
  const textMul = textOnly ? 1 : adj.textScale;
  let stats: TextStats = { wide: 0, listSize: Infinity, members: plan.members };
  for (scale = textOnly ? 3.2 : 1; scale >= 0.25; scale -= 0.02) {
    const B = B0 * scale * textMul;
    stats = { wide: 0, listSize: Infinity, members: plan.members };
    if (splitTop) {
      const maxW = content.w - 2 * pad;
      const maxH = content.h - 2 * pad;
      const gutter = 0.06 * maxW;
      // Equal columns keep their centers mirrored even when a tall photo must shrink.
      const headW = (maxW - gutter) / 2;
      const photoW = Math.min(headW, headW * adj.imageScale * Math.min(1, scale + 0.15));
      const group = groupCells(photoAspects, arrangePictures(photoAspects, photoW, maxH * 0.46, photoGap, { maxRows: 2 }), photoGap);
      const blocks = (input.wording?.blocks ?? []).filter((b) => b.text.trim());
      const opening: Item[] = [];
      const remaining: typeof blocks = [];
      let count = 0;
      let openingRaised = 0;
      let openingDone = false;
      // Split only for display; the stored customer's wording is never edited.
      for (const block of blocks) {
        if (openingDone || count >= 3 || (count >= 2 && block.role !== 'headline' && block.role !== 'subhead') || (block.style?.columns ?? 1) > 1) {
          openingDone = true;
          remaining.push(block);
          continue;
        }
        const made = textItems({ ...input, wording: { blocks: [block], notes: [] } }, B, preset, headW, adj.spacing, stats, plan.minLetter);
        openingRaised += made.raised;
        const item = made.items[0];
        if (!item || item.kind !== 'text') continue;
        const take = Math.min(3 - count, item.lines.length);
        const lines = item.lines.slice(0, take);
        opening.push({ ...item, lines, width: Math.max(...lines.map((l) => measure(item.face, l.text, item.size, item.style.smallCaps))) });
        count += take;
        if (take < item.lines.length) remaining.push({ ...block, text: item.lines.slice(take).map((l) => l.text).join('\n') });
      }
      const head = stack(opening, B, gapMul, adj.spacing);
      const bodyMade = textItems({ ...input, wording: { blocks: remaining, notes: [] } }, B, preset, maxW, adj.spacing, stats, plan.minLetter);
      raised = openingRaised + bodyMade.raised;
      const bodyItems = bodyMade.items;
      if (hasLogo) {
        const logo = logoItem(rowBudget(0.4 * maxW, logos.length, 0.9 * maxW) * scale, 0.12 * maxH * scale, maxW);
        if (slot === 'top') bodyItems.unshift(logo);
        else if (slot === 'middle') bodyItems.splice(Math.min(bodyItems.length, 1), 0, logo);
        else bodyItems.push(logo);
      }
      const body = stack(bodyItems, B, gapMul, adj.spacing);
      const topH = Math.max(group.h, head.height);
      const bodyY = Math.max(maxH * 0.5, topH + Math.max(0.3, B * gapMul));
      colX = content.x + pad;
      colW = maxW;
      const headDx = headW + gutter + headW / 2 - maxW / 2;
      const headY = (topH - head.height) / 2;
      best = {
        ...body,
        lines: [...head.lines.map((l) => ({ ...l, baseline: l.baseline + headY, dx: l.dx + headDx, ...(l.left != null ? { left: l.left + headDx } : {}) })), ...body.lines.map((l) => ({ ...l, baseline: l.baseline + bodyY }))],
        rules: [...head.rules.map((r) => ({ ...r, y: r.y + headY, w: headW, x: headW + gutter })), ...body.rules.map((r) => ({ ...r, y: r.y + bodyY }))],
        frame: { x: (headW - group.w) / 2, y: (topH - group.h) / 2, w: group.w, h: group.h, cells: group.cells },
        logo: body.logo ? { ...body.logo, y: body.logo.y + bodyY } : undefined,
        height: Math.max(topH, bodyY + body.height),
        maxLineWidth: Math.max(body.maxLineWidth, head.maxLineWidth + group.w + gutter),
      };
      if (best.height <= maxH && body.maxLineWidth <= maxW + 1e-6 && head.maxLineWidth <= headW + 1e-6 && !stats.wide) break;
    } else if (imageLeft) {
      const contentW = content.w - 2 * pad;
      const contentH = content.h - 2 * pad;
      // Keep one or two landscape photos stacked; other groups choose the largest fitting rows.
      const bw = Math.min(contentW * 0.65, contentW * preset.sideImageFrac * adj.imageScale * Math.min(1, scale + 0.15));
      const group = groupCells(photoAspects, arrangePictures(photoAspects, bw, contentH, photoGap, photos.length <= 2 && photos.every((p) => orientationOf(p.aspect) === 'landscape') ? { rows: photos.length } : { maxRows: photos.length }), photoGap);
      const fw = group.w;
      const fh = group.h;
      const gutter = 0.06 * contentW;
      colX = content.x + pad + fw + gutter;
      colW = contentW - fw - gutter;
      frameRect = { x: content.x + pad, y: content.y + (content.h - fh) / 2, w: fw, h: fh };
      frameCells = group.cells;
      const texts = textItems(input, B, preset, colW, adj.spacing, stats, plan.minLetter);
      raised = texts.raised;
      const items = texts.items;
      if (hasLogo) {
        const logo = logoItem(rowBudget(0.5 * colW, logos.length, 0.95 * colW) * scale, 0.16 * contentH * scale, colW);
        if (slot === 'bottom') items.push(logo);
        else if (slot === 'middle') items.splice(Math.min(items.length, 2), 0, logo);
        else items.unshift(logo);
      }
      const placed = stack(items, B, gapMul, adj.spacing);
      best = placed;
      if (placed.height <= contentH * fillLimit && placed.maxLineWidth <= colW + 1e-6 && !stats.wide) break;
    } else {
      colX = content.x;
      colW = content.w;
      const maxText = Math.min(content.w * 0.92, content.w - 2 * screwKeepOut);
      const made = textItems(input, B, preset, maxText, adj.spacing, stats, plan.minLetter);
      raised = made.raised;
      const texts = made.items;
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
      if (placed.height <= avail * fillLimit && placed.maxLineWidth <= maxText + 1e-6 && !stats.wide) break;
    }
  }
  if (!best) throw new Error('Layout failed');
  if (scale < 0.25) {
    warnings.push(raised
      ? `At the ¼" minimum letter height the wording does not fit this plaque. Shorten the wording or use a larger plaque.`
      : 'The wording does not fit comfortably at a readable size. Consider a larger plaque or less text.');
  }
  if (raised) warnings.push(`${raised} line${raised > 1 ? 's were' : ' was'} enlarged to the ¼" minimum letter height for casting.`);

  // Center the stack vertically in its area (or move it up/down within the free space).
  const areaTop = imageLeft || splitTop ? content.y + pad : content.y;
  const areaH = imageLeft || splitTop ? content.h - 2 * pad : content.h;
  const slack = areaH - best.height;
  const margin = imageLeft || splitTop ? 0 : Math.max(0.3, 0.05 * content.h, screwD ? screwInset * 0.6 : 0);
  const dy = adj.verticalOffset && slack > 2 * margin
    ? areaTop + margin + ((slack - 2 * margin) * (1 + adj.verticalOffset)) / 2
    : areaTop + slack / 2;
  const cx = colX + colW / 2;
  const textWidth = imageLeft || splitTop ? colW : Math.min(content.w * 0.92, content.w - 2 * screwKeepOut);

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
  const rules: Rect[] = best.rules.map((r) => ({ x: r.x != null ? colX + r.x + r.w * 0.03 : cx - ((r.w || textWidth) * 0.94) / 2, y: r.y + dy - r.t / 2, w: (r.w || textWidth) * 0.94, h: r.t }));
  if (!imageLeft && best.frame) {
    frameRect = { x: splitTop ? colX + best.frame.x : content.x + (content.w - best.frame.w) / 2, y: best.frame.y + dy, w: best.frame.w, h: best.frame.h };
    frameCells = best.frame.cells;
  }
  const logoRow = best.logo ? { x: cx - best.logo.w / 2, y: best.logo.y + dy } : null;
  const logoBoxes: LogoBox[] = logoRow && best.logo
    ? best.logo.cells.map((c, i) => ({ ...offset(c, logoRow.x, logoRow.y), ...(logos[i].id ? { logoId: logos[i].id } : {}) }))
    : [];

  // Height of the smallest letters (lines without letters do not count).
  let minLetterIn = Infinity;
  for (const l of lines) {
    const ratio = letterRatio(resolveFontFace(l.face) ?? main.font, l.text, l.style);
    if (ratio) minLetterIn = Math.min(minLetterIn, ratio * l.size);
  }
  if (minLetterIn < MIN_LETTER_IN - 1e-3) {
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
  const layout: PlaqueLayout = {
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
  // Say so when the drawing is not sound, instead of handing on text that hangs off the plaque.
  const problems = layoutProblems(layout, spec.font);
  layout.warnings.push(...problems);
  return { layout, fits: scale >= 0.25 && !stats.wide, listSize: stats.listSize, sound: !problems.length };
}

// ---------- Donor lists ----------

/** A run of this many short, single-line paragraphs (or lines) is a list of names. */
const MIN_LIST = 8;
/** Most columns a list is set in. */
const MAX_LIST_COLUMNS = 5;

/** A list entry: a short line that is a name or a short phrase, not a sentence. */
function isEntry(text: string): boolean {
  const t = text.trim();
  const words = t.split(/\s+/).length;
  return t.length > 0 && t.length <= 48 && words <= 8 && (words <= 3 || !/[.!?]$/.test(t) || /\b(Jr|Sr|Dr|Mr|Mrs|Ms|Inc|Co|Ltd|St)\.$/.test(t));
}

/** A tier heading such as GOLD: capitals only, three letters or more. */
const isCaps = (text: string) => /[A-Z]{3}/.test(text) && text === text.toUpperCase();

/** A gift-range tier heading such as "$15,000+", "$7,500-$14,999" or "$1,000 and up". */
const isAmount = (text: string) =>
  /^\$\s?\d[\d,.]*(\s*\+|\s*(?:-|–|—|to)\s*\$?\s?\d[\d,.]*\+?)?(\s+(?:and|&)\s+(?:up|above|over))?$/i.test(text.trim());

/**
 * The column and row of each entry of a list set in `cols` columns, filled top to bottom.
 * A tiered list (headings over groups of names) breaks columns between tiers when the columns
 * still come out about even, as Impact Signs sets donor walls; otherwise the entries are shared
 * evenly. Either way a heading never sits alone at the foot of a column.
 */
function columnSlots(entries: string[], cols: number): { col: number; row: number }[] {
  const n = entries.length;
  const even = Math.ceil(n / cols);
  const capsShare = entries.filter(isCaps).length / Math.max(1, n);
  const heading = (t: string) => isAmount(t) || (capsShare < 0.5 && isCaps(t));
  // Start index of each column.
  let starts: number[] | null = null;
  const groupStarts = entries.map((t, i) => i).filter((i) => i === 0 || heading(entries[i]!));
  if (groupStarts.length >= cols && entries.some(heading)) {
    const sizes = groupStarts.map((s, g) => (groupStarts[g + 1] ?? n) - s);
    const split = balancedSplit(sizes, cols);
    const tallest = Math.max(...split.map((first, c) => sizes.slice(first, split[c + 1] ?? sizes.length).reduce((a, b) => a + b, 0)));
    if (tallest <= even + Math.max(2, Math.ceil(even * 0.2))) starts = split.map((g) => groupStarts[g]!);
  }
  if (!starts) {
    starts = Array.from({ length: cols }, (_, c) => Math.min(n, c * even));
    // Move a heading that would end a column to the top of the next one.
    for (let c = 1; c < cols; c++) if (starts[c]! > starts[c - 1]! + 1 && heading(entries[starts[c]! - 1] ?? '')) starts[c]!--;
  }
  return entries.map((_, i) => {
    let col = 0;
    while (col + 1 < cols && i >= starts![col + 1]!) col++;
    return { col, row: i - starts![col]! };
  });
}

/** Splits consecutive groups into `parts` runs with the smallest tallest run; returns each run's first group. */
function balancedSplit(sizes: number[], parts: number): number[] {
  const m = sizes.length;
  const prefix = [0];
  for (const s of sizes) prefix.push(prefix[prefix.length - 1]! + s);
  // best[k][i]: smallest tallest run when the first i groups make k runs.
  const best = Array.from({ length: parts + 1 }, () => new Array<number>(m + 1).fill(Infinity));
  const cut = Array.from({ length: parts + 1 }, () => new Array<number>(m + 1).fill(0));
  best[0]![0] = 0;
  for (let k = 1; k <= parts; k++) {
    for (let i = k; i <= m; i++) {
      for (let j = k - 1; j < i; j++) {
        const v = Math.max(best[k - 1]![j]!, prefix[i]! - prefix[j]!);
        if (v < best[k]![i]!) { best[k]![i] = v; cut[k]![i] = j; }
      }
    }
  }
  const firsts: number[] = [];
  for (let k = parts, i = m; k > 0; k--) { i = cut[k]![i]!; firsts.unshift(i); }
  return firsts;
}

const styleKey = (b: WordingBlock) => JSON.stringify(b.style ?? {});

/**
 * Donor lists in the wording: runs of body paragraphs that are each one short line (the way
 * a customer pastes names, one per line), and single body blocks of many short lines. A block
 * the designer already set in columns is theirs and is left alone.
 */
function listRuns(blocks: WordingBlock[]): WordingBlock[][] {
  const runs: WordingBlock[][] = [];
  // In a list of mixed-case names, a line in capitals is a heading for the names after it.
  const singles = blocks.filter((b) => b.role === 'body' && !b.text.includes('\n') && isEntry(b.text));
  const headings = singles.length > 0 && singles.filter((b) => isCaps(b.text)).length / singles.length < 0.5;
  let run: WordingBlock[] = [];
  const flush = () => {
    if (run.length >= MIN_LIST) runs.push(run);
    run = [];
  };
  for (const b of blocks) {
    const lines = b.text.split('\n').map((l) => l.trim()).filter(Boolean);
    const plain = b.role === 'body' && !(b.style?.columns && b.style.columns > 1);
    if (plain && lines.length >= MIN_LIST && lines.every(isEntry)) {
      flush();
      runs.push([b]);
    } else if (plain && lines.length === 1 && isEntry(lines[0]) && !(headings && isCaps(lines[0])) && (!run.length || styleKey(run[0]) === styleKey(b))) {
      run.push(b);
    } else flush();
  }
  flush();
  return runs;
}

/** The wording with each donor list set in `columns` columns. Only display: the words stay as written. */
function withListColumns(wording: Wording, runs: WordingBlock[][], columns: number): Wording {
  const first = new Map(runs.map((r) => [r[0].id, r]));
  const inRun = new Set(runs.flat().map((b) => b.id));
  const blocks: WordingBlock[] = [];
  for (const b of wording.blocks) {
    const run = first.get(b.id);
    if (run) blocks.push({ ...b, text: run.map((x) => x.text.trim()).join('\n'), style: { ...b.style, columns } });
    else if (!inRun.has(b.id)) blocks.push(b);
  }
  return { ...wording, blocks };
}

/**
 * Fits the plaque. Donor lists are tried in one column (as pasted) and in two to five, and
 * the columns win only when the whole list fits at a clearly larger size: a list of fifty
 * names in one column cannot be cast at ¼" letters, in four columns it can.
 *
 * The ¼" minimum holds whenever the wording fits at it. When it cannot (a long donor list on a
 * small plate), the type is made smaller until everything fits, as the engine did before the
 * minimum existed, and the layout says so. Text hanging off the plate is never an answer: it
 * made production files that could not be used at all.
 */
function computeCore(input: LayoutInput, presetId: LayoutPresetId, contentOverride?: Rect): PlaqueLayout {
  const strict = arrange(input, presetId, contentOverride, true);
  // Tighter than comfortable but on the plate and clear of everything: ¼" letters win.
  if (strict.fits || strict.sound) return strict.layout;
  const relaxed = arrange(input, presetId, contentOverride, false);
  if (!relaxed.sound) return strict.layout;
  const { widthIn: W, heightIn: H } = input.spec;
  const smallest = relaxed.layout.minLetterIn;
  // Drop the strict pass's "does not fit" lines: this layout fits; say what it cost instead.
  relaxed.layout.warnings = [
    `At the ¼" minimum letter height the wording does not fit this ${W}" x ${H}" plaque, so the letters were made smaller to fit${smallest != null ? ` (smallest ${smallest.toFixed(2)}")` : ''}. For ¼" letters, use a larger plaque or shorten the wording.`,
    ...relaxed.layout.warnings,
  ];
  return relaxed.layout;
}

/** The best arrangement of the wording, with or without the ¼" letter minimum. */
function arrange(input: LayoutInput, presetId: LayoutPresetId, contentOverride: Rect | undefined, minLetter: boolean): Fitted {
  const blocks = input.wording?.blocks ?? [];
  const runs = listRuns(blocks);
  const plan: FitPlan = { dense: blocks.length >= 6, members: new Set(runs.flat().map((b) => b.id)), minLetter };
  const one = fitLayout(input, presetId, contentOverride, plan);
  if (!runs.length) return one;
  const tries = Array.from({ length: MAX_LIST_COLUMNS - 1 }, (_, i) => i + 2).map((n) =>
    fitLayout({ ...input, wording: withListColumns(input.wording!, runs, n) }, presetId, contentOverride, plan));
  // Fits comfortably, then at least sound (nothing off the plate or overlapping), then anything.
  const rank = (t: Fitted) => (t.fits ? 2 : t.sound ? 1 : 0);
  const top = Math.max(rank(one), ...tries.map(rank));
  const pool = tries.filter((t) => rank(t) === top);
  // Largest type first; fewer columns when the type is the same.
  const best = pool.length ? pool.reduce((a, b) => (b.listSize > a.listSize * 1.001 ? b : a)) : null;
  if (rank(one) < top) return best!;
  if (!best) return one;
  // A list that fits as pasted is set in columns only for clearly larger type.
  return best.listSize >= one.listSize * (top === 2 ? 1.15 : 1.001) ? best : one;
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

/**
 * Explicit per-logo sides reserve their own space before fitting the wording and photos.
 * Orders without these controls keep the measured legacy layout.
 */
export function computeLayout(input: LayoutInput, presetId: LayoutPresetId): PlaqueLayout {
  if (input.exactDesign?.id) {
    // The artwork is a single unit. Presets cannot retype it or rearrange its contents.
    const layout = computeCore({ ...input, wording: null, photos: [], logos: [], spec: { ...input.spec, imageOption: 'none' } }, presetId);
    const inner = layout.border.innerLine;
    const edge = (layout.border.innerLineIn ?? 0) / 2;
    const area = inner ? { x: inner.x + edge, y: inner.y + edge, w: inner.w - 2 * edge, h: inner.h - 2 * edge } : layout.field;
    const pad = Math.max(0.1, ...layout.screws.map((s) => s.d * 2));
    if (area.w <= 2 * pad || area.h <= 2 * pad) throw new Error('This plaque is too small for the exact design and its mounting. Increase the plaque size or change the mounting.');
    const aspect = Math.max(0.01, input.exactDesign.aspect || 1);
    const w = Math.min(Math.max(0.01, area.w - 2 * pad), Math.max(0.01, area.h - 2 * pad) * aspect);
    const h = w / aspect;
    layout.exactDesign = { designId: input.exactDesign.id, x: area.x + (area.w - w) / 2, y: area.y + (area.h - h) / 2, w, h };
    layout.presetDescription = 'Exact customer design: preserve the complete artwork and its proportions.';
    layout.warnings.push('Exact design keeps the supplied lettering and artwork. Check fine lines and letter heights with production.');
    return layout;
  }
  if (!input.logos?.some((l) => l.position && l.position !== 'auto')) return computeCore(input, presetId);
  let layout: PlaqueLayout | undefined;
  for (let attempt = 0; attempt <= 8; attempt++) {
    layout = positionedLayout(input, presetId, 1 - attempt * 0.1);
    if (!layout.warnings.some((w) => w.includes('wording does not fit'))) {
      if (attempt) layout.warnings.push('Logos were reduced to leave room for the wording at the minimum letter height.');
      return layout;
    }
  }
  return layout!;
}

function positionedLayout(input: LayoutInput, presetId: LayoutPresetId, fit: number): PlaqueLayout {
  const bare = { ...input, logos: [] };
  const base = computeCore(bare, presetId);
  const border = base.border;
  const inner = border.innerLine;
  const edge = inner ? (border.innerLineIn ?? 0) / 2 : 0;
  const field = inner ? { x: inner.x + edge, y: inner.y + edge, w: inner.w - 2 * edge, h: inner.h - 2 * edge } : base.field;
  const screwPad = base.screws.length ? Math.max(...base.screws.map((s) => s.d)) * 2 : 0;
  const pad = Math.max(0.25, 0.04 * Math.min(field.w, field.h), screwPad);
  const area = { x: field.x + pad, y: field.y + pad, w: Math.max(0.1, field.w - 2 * pad), h: Math.max(0.1, field.h - 2 * pad) };
  const gap = Math.min(0.35, 0.035 * Math.min(area.w, area.h));
  const scale = normalizeAdjust(input.adjust).logoScale * fit;
  const fallback = input.logoSlot === 'bottom' ? 'bottom' : input.logoSlot === 'top' || input.logoSlot === 'middle' ? 'top' : base.imageFrames.length && input.spec.heightIn > input.spec.widthIn ? 'bottom' : 'top';
  const groups = (side: LogoPosition) => input.logos!.filter((l) => (l.position && l.position !== 'auto' ? l.position : fallback) === side);
  const boxes = new Map<LayoutPicture, Rect>();
  const row = (pictures: LayoutPicture[]) => {
    if (!pictures.length) return { w: 0, h: 0, cells: [] };
    const aspects = pictures.map((l) => Math.max(0.05, l.aspect || 1));
    return groupCells(aspects, arrangePictures(aspects, area.w, area.h * Math.min(0.25, 0.17 * scale), gap, { maxRows: pictures.length >= 4 ? 2 : 1 }), gap);
  };
  const top = groups('top');
  const bottom = groups('bottom');
  const topRow = row(top);
  const bottomRow = row(bottom);
  top.forEach((l, i) => boxes.set(l, offset(topRow.cells[i], area.x + (area.w - topRow.w) / 2, area.y)));
  bottom.forEach((l, i) => boxes.set(l, offset(bottomRow.cells[i], area.x + (area.w - bottomRow.w) / 2, area.y + area.h - bottomRow.h)));
  const middle = { ...area, y: area.y + (top.length ? topRow.h + gap : 0), h: area.h - (top.length ? topRow.h + gap : 0) - (bottom.length ? bottomRow.h + gap : 0) };
  const column = (pictures: LayoutPicture[]) => {
    if (!pictures.length) return { w: 0, h: 0, cells: [] };
    // Arrange a row with reciprocal proportions, then transpose it into a column.
    const aspects = pictures.map((l) => 1 / Math.max(0.05, l.aspect || 1));
    const g = groupCells(aspects, arrangePictures(aspects, middle.h, area.w * Math.min(0.25, 0.2 * scale), gap, { maxRows: 1 }), gap);
    return { w: g.h, h: g.w, cells: g.cells.map((c) => ({ x: c.y, y: c.x, w: c.h, h: c.w })) };
  };
  const left = groups('left');
  const right = groups('right');
  const leftCol = column(left);
  const rightCol = column(right);
  left.forEach((l, i) => boxes.set(l, offset(leftCol.cells[i], area.x, middle.y + (middle.h - leftCol.h) / 2)));
  right.forEach((l, i) => boxes.set(l, offset(rightCol.cells[i], area.x + area.w - rightCol.w, middle.y + (middle.h - rightCol.h) / 2)));
  const center = { ...middle, x: middle.x + (left.length ? leftCol.w + gap : 0), w: middle.w - (left.length ? leftCol.w + gap : 0) - (right.length ? rightCol.w + gap : 0) };
  const layout = computeCore(bare, presetId, center);
  layout.logos = input.logos!.map((l) => ({ ...boxes.get(l)!, ...(l.id ? { logoId: l.id } : {}) }));
  return layout;
}
