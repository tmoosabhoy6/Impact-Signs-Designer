// The layout engine: exact plaque geometry, in inches from the plaque's top-left corner.
// The same layout drives the AI concept (as a reference drawing), the proof and the
// vector production file, so all three agree.
//
// The "classic" preset reproduces the real Heritage Foundation production file
// (production_32241.ai, 12x18): image frame 0.542 W wide, body type 46.3 pt with a
// 64.6 pt line pitch, headline 56.3 pt, subhead 50.1 pt, stack centered in the field.
import { getCatalog, mustOption } from '../catalog.js';
import { measure, missingGlyphs, resolveFont, wrapText, type OTFont } from '../text/fonts.js';
import type { LayoutPresetId, PlaqueLayout, PlaqueSpec, Rect, TextLine, Wording, WordingRole } from '../../shared/types.js';

export interface LayoutInput {
  spec: PlaqueSpec;
  wording: Wording | null;
  /** width / height of the customer photo, if any. */
  photoAspect?: number | null;
  /** width / height of the logo, if any. */
  logoAspect?: number | null;
  logoSlot?: 'auto' | 'top' | 'middle' | 'bottom';
}

interface PresetDef {
  id: LayoutPresetId;
  label: string;
  description: string;
  /** Image frame width as a fraction of plaque width when the image sits on top. */
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
    description: 'Larger image as the hero; the text block is set slightly smaller and tighter beneath it.',
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
  paragraph: 2.0,
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

type Item =
  | { kind: 'frame'; w: number; h: number }
  | { kind: 'logo'; w: number; h: number }
  | { kind: 'text'; role: WordingRole; lines: string[]; size: number; leading: number };

interface Placed {
  frame?: Rect;
  logo?: Rect;
  lines: { text: string; role: WordingRole; baseline: number; size: number }[];
  height: number;
  maxLineWidth: number;
}

function capHeightRatio(font: OTFont): number {
  const os2 = (font.tables as { os2?: { sCapHeight?: number } }).os2;
  return os2?.sCapHeight ? os2.sCapHeight / font.unitsPerEm : 0.66;
}

/** Stacks items vertically; returns positions relative to the stack's top (y = 0). */
function stack(items: Item[], B: number, gapMul: number, font: OTFont): Placed {
  const cap = capHeightRatio(font);
  const out: Placed = { lines: [], height: 0, maxLineWidth: 0 };
  let cursor = 0; // bottom of the previous box, or the previous baseline
  let prev: Item | null = null;
  for (const item of items) {
    if (item.kind === 'frame' || item.kind === 'logo') {
      let top = 0;
      if (prev?.kind === 'text') top = cursor + (item.kind === 'logo' ? GAP.textToLogo : GAP.textToFrame) * B * gapMul;
      else if (prev) top = cursor + 1.2 * B * gapMul;
      const r = { x: 0, y: top, w: item.w, h: item.h };
      if (item.kind === 'frame') out.frame = r;
      else out.logo = r;
      cursor = top + item.h;
    } else {
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
          : item.role === 'footer' ? GAP.toFooter
          : prev.role === item.role ? GAP.paragraph
          : GAP.headlineToSubhead;
        first = cursor + g * B * (prev.role === item.role ? 1 : gapMul);
      }
      item.lines.forEach((text, i) => {
        out.lines.push({ text, role: item.role, baseline: first + i * item.leading, size: item.size });
        out.maxLineWidth = Math.max(out.maxLineWidth, measure(font, text, item.size));
      });
      cursor = first + (item.lines.length - 1) * item.leading;
    }
    prev = item;
  }
  out.height = prev?.kind === 'text' ? cursor + GAP.descent * B : cursor;
  return out;
}

function textItems(wording: Wording | null, B: number, p: PresetDef, font: OTFont, maxWidth: number): Item[] {
  const items: Item[] = [];
  const blocks = (wording?.blocks ?? []).filter((b) => b.text.trim());
  // Keep the customer's order, but group consecutive blocks of the same role.
  for (const b of blocks) {
    const mul = b.role === 'headline' ? p.headline : b.role === 'subhead' ? p.subhead : b.role === 'footer' ? 0.85 : p.body;
    let size = B * mul;
    // Name and organization lines should stay on one line: shrink them (up to 25%) before wrapping.
    if ((b.role === 'headline' || b.role === 'subhead') && !b.text.includes('\n')) {
      const natural = measure(font, b.text, size);
      if (natural > maxWidth) size = Math.max(size * 0.75, (size * maxWidth) / natural);
    }
    const leading = b.role === 'body' || b.role === 'footer' ? GAP.bodyLeading * size : 1.15 * size;
    items.push({ kind: 'text', role: b.role, lines: wrapText(font, b.text, size, maxWidth), size, leading });
  }
  return items;
}

export function computeLayout(input: LayoutInput, presetId: LayoutPresetId): PlaqueLayout {
  const { spec } = input;
  const preset = PRESETS.find((p) => p.id === presetId) ?? PRESETS[0];
  const W = spec.widthIn;
  const H = spec.heightIn;
  const border = mustOption('borders', spec.border);
  const bw = border.widthIn;
  const field: Rect = { x: bw, y: bw, w: W - 2 * bw, h: H - 2 * bw };
  const warnings: string[] = [];
  const { font, licensed, label: fontLabel } = resolveFont(spec.font);
  if (!licensed) warnings.push(`${fontLabel} is not installed; an open stand-in with matching proportions is used.`);

  const hasImage = spec.imageOption !== 'none';
  const photoAspect = Math.min(1.8, Math.max(0.55, input.photoAspect || 0.9));
  const orientation = photoAspect > 1.1 ? 'landscape' : photoAspect < 0.91 ? 'portrait' : 'square';
  const imageLeft = hasImage && orientation === 'landscape' && W >= H;
  const hasLogo = !!input.logoAspect;
  const logoAspect = Math.min(6, Math.max(0.3, input.logoAspect || 1));

  // Inner margin for side-by-side layouts.
  const pad = Math.max(0.35, 0.07 * Math.min(field.w, field.h));
  const B0 = BODY_FRAC * Math.min(W, H);
  const allText = (input.wording?.blocks ?? []).map((b) => b.text).join(' ');
  const missing = missingGlyphs(font, allText);
  if (missing.length) warnings.push(`The font cannot draw: ${missing.join(' ')}`);

  let slot = input.logoSlot ?? 'auto';
  if (slot === 'auto') slot = hasImage && !imageLeft ? 'bottom' : 'top';

  let best: Placed | null = null;
  let colX = field.x;
  let colW = field.w;
  let frameRect: Rect | null = null;
  let scale = 1;
  // Text-only plaques may grow the type to fill the field; image layouts keep the measured sizes.
  const textOnly = !hasImage;
  const fillLimit = textOnly ? 0.72 : 1;
  for (scale = textOnly ? 1.8 : 1; scale >= 0.3; scale -= 0.02) {
    const B = B0 * scale;
    if (imageLeft) {
      const contentW = field.w - 2 * pad;
      const contentH = field.h - 2 * pad;
      let fw = contentW * preset.sideImageFrac * Math.min(1, scale + 0.15);
      let fh = fw / photoAspect;
      if (fh > contentH) {
        fh = contentH;
        fw = fh * photoAspect;
      }
      const gutter = 0.06 * contentW;
      colX = field.x + pad + fw + gutter;
      colW = contentW - fw - gutter;
      frameRect = { x: field.x + pad, y: field.y + (field.h - fh) / 2, w: fw, h: fh };
      const items = textItems(input.wording, B, preset, font, colW);
      if (hasLogo) {
        const lh = Math.min(0.16 * contentH, (0.5 * colW) / logoAspect) * scale;
        const logo: Item = { kind: 'logo', w: lh * logoAspect, h: lh };
        if (slot === 'bottom') items.push(logo);
        else if (slot === 'middle') items.splice(Math.min(items.length, 2), 0, logo);
        else items.unshift(logo);
      }
      const placed = stack(items, B, preset.gaps, font);
      best = placed;
      if (placed.height <= contentH * fillLimit && placed.maxLineWidth <= colW + 1e-6) break;
    } else {
      colX = field.x;
      colW = field.w;
      const maxText = field.w * 0.92;
      const items: Item[] = [];
      if (hasImage) {
        let fw = W * preset.topImageFrac * Math.min(1, scale + 0.1);
        let fh = fw / photoAspect;
        const maxFh = field.h * 0.55;
        if (fh > maxFh) {
          fh = maxFh;
          fw = fh * photoAspect;
        }
        items.push({ kind: 'frame', w: fw, h: fh });
      }
      items.push(...textItems(input.wording, B, preset, font, maxText));
      if (hasLogo) {
        const lh = Math.min(0.12 * H, (0.4 * W) / logoAspect) * scale;
        const logo: Item = { kind: 'logo', w: lh * logoAspect, h: lh };
        if (slot === 'bottom') items.push(logo);
        else if (slot === 'middle') {
          const firstBody = items.findIndex((i) => i.kind === 'text' && i.role === 'body');
          items.splice(firstBody >= 0 ? firstBody : items.length, 0, logo);
        } else items.splice(hasImage ? 1 : 0, 0, logo);
      }
      const placed = stack(items, B, preset.gaps, font);
      best = placed;
      const avail = field.h - 2 * Math.max(0.3, 0.05 * field.h);
      if (placed.height <= avail * fillLimit && placed.maxLineWidth <= maxText + 1e-6) break;
    }
  }
  if (!best) throw new Error('Layout failed');
  if (scale < 0.3) warnings.push('The wording does not fit comfortably at a readable size. Consider a larger plaque or less text.');

  // Center the stack vertically in its area.
  const areaTop = imageLeft ? field.y + pad : field.y;
  const areaH = imageLeft ? field.h - 2 * pad : field.h;
  const dy = areaTop + (areaH - best.height) / 2;
  const cx = colX + colW / 2;

  const lines: TextLine[] = best.lines.map((l) => ({ text: l.text, role: l.role, cx, baseline: l.baseline + dy, size: l.size }));
  if (!imageLeft && best.frame) {
    frameRect = { x: (W - best.frame.w) / 2, y: best.frame.y + dy, w: best.frame.w, h: best.frame.h };
  }
  const logo = best.logo ? { x: cx - best.logo.w / 2, y: best.logo.y + dy, w: best.logo.w, h: best.logo.h } : null;

  // Minimum letter heights (cap height): 3/8 in for mixed case, 1/4 in for all caps.
  const cap = capHeightRatio(font);
  for (const l of lines) {
    const allCaps = l.text === l.text.toUpperCase() && /[A-Z]/.test(l.text);
    const min = allCaps ? 0.25 : 0.375;
    if (cap * l.size < min - 1e-3) {
      warnings.push(`"${l.text.slice(0, 30)}${l.text.length > 30 ? '…' : ''}" is ${(cap * l.size).toFixed(2)} in tall, below the ${min} in casting minimum.`);
      break;
    }
  }

  const inset = Math.min(FRAME_INSET_IN, 0.04 * Math.min(frameRect?.w ?? 1, frameRect?.h ?? 1));
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
      innerLineIn: border.innerLineIn,
      innerLine: border.gapIn ? { x: field.x + border.gapIn, y: field.y + border.gapIn, w: field.w - 2 * border.gapIn, h: field.h - 2 * border.gapIn } : undefined,
    },
    field,
    imageFrame: hasImage && frameRect
      ? { outer: frameRect, inner: { x: frameRect.x + inset, y: frameRect.y + inset, w: frameRect.w - 2 * inset, h: frameRect.h - 2 * inset }, orientation }
      : null,
    logo,
    lines,
    warnings,
  };
}

export function computeAllLayouts(input: LayoutInput): PlaqueLayout[] {
  return PRESETS.map((p) => computeLayout(input, p.id));
}

export { getCatalog };
