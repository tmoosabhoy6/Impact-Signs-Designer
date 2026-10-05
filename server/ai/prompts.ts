// Builds the exact text sent to the image model. The Images API has no "system prompt",
// so every call carries everything: HOUSE RULES + JOB (or FIX) + reference list.
// The wording of the instructions lives in server/prompts/*.md so it can be tuned
// without touching code; the version hash of those files is stored with every image.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fromRoot } from '../config.js';
import { fontLabel, mustOption, paintLabel } from '../catalog.js';
import type { PlaqueLayout, PlaqueSpec, Rect } from '../../shared/types.js';

export const PROMPT_FILES = ['house_rules.md', 'concept.md', 'fix.md', 'relayout.md', 'spellcheck.md'] as const;
export type PromptFile = (typeof PROMPT_FILES)[number];

export function readPrompt(name: PromptFile): string {
  return fs.readFileSync(fromRoot('server/prompts', name), 'utf8').trim();
}

export function promptVersion(): string {
  const h = crypto.createHash('sha1');
  for (const f of PROMPT_FILES) h.update(readPrompt(f));
  return h.digest('hex').slice(0, 8);
}

function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? '');
}

export interface RefImage {
  role: string;
  file: Buffer;
  name: string;
  mime: string;
}

export function layoutText(layout: PlaqueLayout): string {
  return layout.lines
    .map((l) => {
      const s = l.style ?? {};
      const notes = [s.bold && 'bold', s.italic && 'italic', s.smallCaps && 'small capitals', l.x != null && 'left-aligned in its column'].filter(Boolean);
      return notes.length ? `${l.text}    [${notes.join(', ')}]` : l.text;
    })
    .join('\n');
}

const ORDINAL = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth'];

/**
 * Where each picture of a group sits, in words the image model can match against the layout
 * drawing: "left", "right", "top-left", "middle"… A single picture is just "the".
 */
export function placeNames(rects: Rect[]): string[] {
  if (rects.length <= 1) return rects.map(() => 'only');
  // Rows: pictures whose vertical centers are close share a row.
  const cy = (r: Rect) => r.y + r.h / 2;
  const rows: Rect[][] = [];
  for (const r of [...rects].sort((a, b) => cy(a) - cy(b))) {
    const row = rows.find((x) => Math.abs(cy(x[0]) - cy(r)) < Math.min(x[0].h, r.h) / 2);
    if (row) row.push(r);
    else rows.push([r]);
  }
  for (const row of rows) row.sort((a, b) => a.x - b.x);
  const across = (i: number, n: number) => (n === 1 ? '' : n === 2 ? ['left', 'right'][i] : n === 3 ? ['left', 'middle', 'right'][i] : `${ORDINAL[i] ?? `${i + 1}th`} from the left`);
  const down = (i: number, n: number) => (n === 1 ? '' : n === 2 ? ['top', 'bottom'][i] : n === 3 ? ['top', 'middle', 'bottom'][i] : `${ORDINAL[i] ?? `${i + 1}th`} from the top`);
  return rects.map((r) => {
    const ri = rows.findIndex((row) => row.includes(r));
    const ci = rows[ri].indexOf(r);
    const v = down(ri, rows.length);
    const h = across(ci, rows[ri].length);
    if (v && h) return h.includes(' ') ? `${v} row, ${h}` : `${v}-${h}`;
    return v || h;
  });
}

const fmtIn = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/0+$/, ''));

export function buildConceptPrompt(spec: PlaqueSpec, layout: PlaqueLayout, refs: RefImage[], opts: { logoCount: number; direction?: string }): string {
  const material = mustOption('materials', spec.material);
  const finish = mustOption('finishes', spec.finish);
  const paint = mustOption('backgroundColors', spec.backgroundColor);
  const process = mustOption('processes', spec.process ?? 'cast');
  const texture = mustOption('backgroundTextures', spec.backgroundTexture);
  const border = mustOption('borders', spec.border);
  const font = mustOption('fonts', spec.font);
  const mounting = mustOption('mountings', spec.mounting);
  const lettering = mustOption('lettering', spec.lettering);
  const image = mustOption('imageOptions', spec.imageOption);
  const logoTreatment = mustOption('logoTreatments', spec.logoTreatment ?? 'raised-cast');
  const orientation = spec.widthIn > spec.heightIn ? 'landscape' : spec.widthIn < spec.heightIn ? 'portrait' : 'square';
  const frames = layout.imageFrames.length;
  const imageTreatment =
    spec.imageOption === 'none'
      ? 'none. This is a text-only plaque; do not add any picture.'
      : frames > 1
        ? `${image.prompt} There are ${frames} separate images, each inside its own thin raised metal frame, filling that frame's window exactly where Reference 1 shows it. Each frame shows only its own customer photo: never swap, merge, mirror or repeat the photos.`
        : `${image.prompt} The image sits inside a thin raised metal frame, filling the frame window exactly where Reference 1 shows it.`;
  const extras: string[] = [];
  if (layout.rules.length) extras.push('Thin raised horizontal rules under section headings, exactly as in Reference 1.');
  if (layout.screws.length) extras.push(`${layout.screws.length} visible ${mustOption('mountings', spec.mounting).label.toLowerCase()} heads in the corners, exactly where Reference 1 shows them.`);
  const body = fill(readPrompt('concept.md'), {
    material: `${material.prompt}; ${process.prompt}`,
    width: fmtIn(spec.widthIn),
    height: fmtIn(spec.heightIn),
    orientation,
    finish: finish.prompt,
    paint: spec.backgroundColor === 'custom' ? `a custom-matched ${paintLabel(spec)} baked paint (match the paint swatch exactly)` : paint.prompt,
    texture: texture.prompt,
    border: border.prompt,
    lettering: lettering.prompt,
    font: spec.font === 'custom' ? `${fontLabel(spec)} (copy the letterforms from Reference 1)` : font.prompt,
    mounting: mounting.prompt,
    imageTreatment,
    logo: opts.logoCount > 1
      ? `${opts.logoCount} supplied customer logos, each in its own logo position shown in Reference 1, in that order. LOGO TREATMENT: ${logoTreatment.prompt}. Keep them separate; never merge, swap, repeat or restyle them to match each other.`
      : opts.logoCount === 1
        ? `the supplied customer logo, in the logo position shown in Reference 1. LOGO TREATMENT: ${logoTreatment.prompt}.`
        : 'none.',
    presetLabel: layout.presetLabel,
    presetDescription: `${layout.presetDescription}${extras.length ? ' ' + extras.join(' ') : ''}`,
    text: layoutText(layout) || '(no text)',
    references: refs.map((r, i) => `Reference ${i + 1}: ${r.role}`).join('\n'),
  });
  // A designer's requested change (from Fix) rides on top of the layout; wording stays exact.
  const direction = opts.direction
    ? `\n\nDESIGNER CHANGE (apply it fully and visibly; Reference 1 still decides the wording and the positions it shows):\n${opts.direction.trim().replace(/\.?$/, '.')}`
    : '';
  return `${readPrompt('house_rules.md')}\n\n${body}${direction}`;
}

export function buildFixPrompt(instruction: string, layout: PlaqueLayout | null, hasLayoutRef: boolean): string {
  const body = fill(readPrompt('fix.md'), {
    instruction: instruction.trim().replace(/\.?$/, '.'),
    layoutNote: hasLayoutRef ? 'Image 2 shows the planned layout: copy the exact wording and letterforms from it, and keep its positions except where the change moves or resizes something.' : '',
    text: layout ? layoutText(layout) : '(unchanged)',
  });
  return `${readPrompt('house_rules.md')}\n\n${body}`;
}

/** Edit of the current image to follow an updated layout drawing (layout or wording change). */
export function buildRelayoutPrompt(change: string, imageEdit: string | undefined, layout: PlaqueLayout): string {
  const body = fill(readPrompt('relayout.md'), {
    change: change.trim().replace(/\.?$/, '.'),
    extra: imageEdit ? `Also make this change to the image: ${imageEdit.trim().replace(/\.?$/, '.')}` : '',
    text: layoutText(layout) || '(no text)',
  });
  return `${readPrompt('house_rules.md')}\n\n${body}`;
}
