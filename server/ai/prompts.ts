// Builds the exact text sent to the image model. The Images API has no "system prompt",
// so every call carries everything: HOUSE RULES + JOB (or FIX) + reference list.
// The wording of the instructions lives in server/prompts/*.md so it can be tuned
// without touching code; the version hash of those files is stored with every image.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fromRoot } from '../config.js';
import { fontLabel, mustOption, paintLabel } from '../catalog.js';
import type { PlaqueLayout, PlaqueSpec } from '../../shared/types.js';

export const PROMPT_FILES = ['house_rules.md', 'concept.md', 'fix.md', 'spellcheck.md'] as const;
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

const fmtIn = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/0+$/, ''));

export function buildConceptPrompt(spec: PlaqueSpec, layout: PlaqueLayout, refs: RefImage[], opts: { hasLogo: boolean }): string {
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
  const orientation = spec.widthIn > spec.heightIn ? 'landscape' : spec.widthIn < spec.heightIn ? 'portrait' : 'square';
  const imageTreatment =
    spec.imageOption === 'none'
      ? 'none. This is a text-only plaque; do not add any picture.'
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
    logo: opts.hasLogo
      ? 'the supplied customer logo, cast as raised metal in the plaque finish, in the logo position shown in Reference 1.'
      : 'none.',
    presetLabel: layout.presetLabel,
    presetDescription: `${layout.presetDescription}${extras.length ? ' ' + extras.join(' ') : ''}`,
    text: layoutText(layout) || '(no text)',
    references: refs.map((r, i) => `Reference ${i + 1}: ${r.role}`).join('\n'),
  });
  return `${readPrompt('house_rules.md')}\n\n${body}`;
}

export function buildFixPrompt(instruction: string, layout: PlaqueLayout | null, hasLayoutRef: boolean): string {
  return fill(readPrompt('fix.md'), {
    instruction: instruction.trim().replace(/\.?$/, '.'),
    layoutNote: hasLayoutRef ? 'Image 2 is the exact flat layout drawing; the text and positions must match it.' : '',
    text: layout ? layoutText(layout) : '(unchanged)',
  });
}
