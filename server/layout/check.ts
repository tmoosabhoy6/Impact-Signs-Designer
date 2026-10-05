// Geometry checks on a finished layout: does every line of text sit on the plaque, and
// does anything land on top of anything else? The production file draws exactly what the
// layout says, so a layout that fails here makes a production file that fails in the shop.
import { capHeightRatio, loadFontFile, measure, resolveFont, type OTFont } from '../text/fonts.js';
import type { PlaqueLayout, Rect, TextLine } from '../../shared/types.js';

const TOLERANCE_IN = 0.02;

function faceOf(line: TextLine, fallbackFontId: string): OTFont {
  try {
    return line.face ? loadFontFile(line.face) : resolveFont(fallbackFontId).font;
  } catch {
    return resolveFont(fallbackFontId).font;
  }
}

/** The ink box of one line of type, in inches from the plaque's top-left corner. */
export function lineBox(line: TextLine, fallbackFontId: string): Rect {
  const face = faceOf(line, fallbackFontId);
  const w = measure(face, line.text, line.size, line.style?.smallCaps);
  const x = line.x ?? line.cx - w / 2;
  // Vertical extent from the real glyph outlines: ascenders, accents and tails all count.
  let up = capHeightRatio(face) * 0.9;
  let down = 0;
  for (const ch of new Set(line.text)) {
    if (ch === ' ') continue;
    const b = face.charToGlyph(ch).getBoundingBox();
    up = Math.max(up, b.y2 / face.unitsPerEm);
    down = Math.max(down, -b.y1 / face.unitsPerEm);
  }
  const top = line.baseline - up * line.size;
  return { x, y: top, w, h: (up + down) * line.size };
}

const overlap = (a: Rect, b: Rect) =>
  Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > TOLERANCE_IN && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > TOLERANCE_IN;

/** The area inside the plaque's border where text may sit. */
export function textArea(layout: PlaqueLayout): Rect {
  const il = layout.border.innerLine;
  const t = layout.border.innerLineIn ?? 0;
  return il ? { x: il.x + t / 2, y: il.y + t / 2, w: il.w - t, h: il.h - t } : layout.field;
}

/** Plain-English problems with a layout; empty when it is sound. */
export function layoutProblems(layout: PlaqueLayout, fontId: string): string[] {
  const problems: string[] = [];
  const area = textArea(layout);
  const boxes = layout.lines.map((l) => ({ line: l, box: lineBox(l, fontId) }));

  const outside = boxes.filter(({ box }) =>
    box.x < area.x - TOLERANCE_IN || box.y < area.y - TOLERANCE_IN || box.x + box.w > area.x + area.w + TOLERANCE_IN || box.y + box.h > area.y + area.h + TOLERANCE_IN);
  if (outside.length) {
    const first = outside[0].line.text;
    problems.push(`${outside.length} line${outside.length > 1 ? 's' : ''} of wording run past the edge of the plaque (starting with "${first.length > 30 ? first.slice(0, 30) + '…' : first}").`);
  }

  // Sorted by top edge, a line can only touch the lines just below it, so stop early.
  const sorted = [...boxes].sort((a, b) => a.box.y - b.box.y);
  let crowded = 0;
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length && sorted[j].box.y < sorted[i].box.y + sorted[i].box.h; j++) {
      if (overlap(sorted[i].box, sorted[j].box)) crowded++;
    }
  }
  if (crowded) problems.push(`${crowded} pair${crowded > 1 ? 's' : ''} of text lines overlap.`);

  const things = [...layout.imageFrames.map((f) => f.outer), ...layout.logos];
  const covered = boxes.filter(({ box }) => things.some((t) => overlap(box, t)));
  if (covered.length) problems.push(`${covered.length} line${covered.length > 1 ? 's' : ''} of wording overlap a photo or logo.`);
  return problems;
}
