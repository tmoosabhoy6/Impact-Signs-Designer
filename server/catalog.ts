import fs from 'node:fs';
import { fromRoot } from './config.js';

export interface Option {
  id: string;
  label: string;
  aliases: string[];
  prompt: string;
  asset?: string;
  proofLabel?: string;
  hex?: string;
  upcharge?: string;
  [k: string]: unknown;
}
export interface BorderOption extends Option {
  widthIn: number;
  innerLineIn?: number;
  gapIn?: number;
  verified: boolean;
}
export interface FontOption extends Option {
  licensedFile: string;
  standIn: string;
}
export interface Catalog {
  version: string;
  materials: Option[];
  sizeLimits: { minIn: number; maxIn: number; typicalMinIn: number; typicalMaxIn: number };
  finishes: Option[];
  backgroundColors: Option[];
  backgroundTextures: Option[];
  borders: BorderOption[];
  fonts: FontOption[];
  imageOptions: Option[];
  mountings: (Option & { diagram?: string; scale?: 'wall' | 'ground' })[];
  lettering: Option[];
  /** How a customer logo is made: cast as raised metal, or UV printed on a raised plate. */
  logoTreatments: (Option & { description: string; mode: 'raised' | 'monochrome' | 'color' })[];
  logoPositions: Option[];
  processes: (Option & { proofFinishNote: string; proofPaintNote: string })[];
  thickness: { defaultIn: number; options: number[] };
  proofStyles: { id: string; label: string; description: string }[];
  coating: string;
  proof: { disclaimer: string };
}

export type OptionGroup =
  | 'materials'
  | 'finishes'
  | 'backgroundColors'
  | 'backgroundTextures'
  | 'borders'
  | 'fonts'
  | 'imageOptions'
  | 'mountings'
  | 'lettering'
  | 'logoPositions'
  | 'logoTreatments'
  | 'processes';

export const OPTION_GROUPS: { key: OptionGroup; label: string }[] = [
  { key: 'materials', label: 'Material' },
  { key: 'finishes', label: 'Plaque finish' },
  { key: 'backgroundColors', label: 'Background color' },
  { key: 'backgroundTextures', label: 'Background texture' },
  { key: 'borders', label: 'Border' },
  { key: 'fonts', label: 'Font' },
  { key: 'imageOptions', label: 'Image option' },
  { key: 'mountings', label: 'Mounting' },
  { key: 'lettering', label: 'Lettering' },
  { key: 'logoTreatments', label: 'Logo treatment' },
  { key: 'processes', label: 'Process' },
];

let cached: Catalog | null = null;
export function getCatalog(): Catalog {
  if (!cached) cached = JSON.parse(fs.readFileSync(fromRoot('data/catalog.json'), 'utf8')) as Catalog;
  return cached;
}

export function findOption<G extends OptionGroup>(group: G, id: string): Catalog[G][number] | undefined {
  return (getCatalog()[group] as Option[]).find((o) => o.id === id) as Catalog[G][number] | undefined;
}

export function mustOption<G extends OptionGroup>(group: G, id: string): Catalog[G][number] {
  const o = findOption(group, id);
  if (!o) throw new Error(`Unknown ${group} option "${id}"`);
  return o;
}

import type { PlaqueSpec } from '../shared/types.js';

/** Paint color of the recessed field (custom paint matches carry their own color). */
export function paintHex(spec: PlaqueSpec): string {
  if (spec.backgroundColor === 'custom' && spec.customPaint?.hex) return spec.customPaint.hex;
  return findOption('backgroundColors', spec.backgroundColor)?.hex ?? '#231F20';
}

export function paintLabel(spec: PlaqueSpec): string {
  if (spec.backgroundColor === 'custom') return spec.customPaint?.name || 'Custom color';
  return findOption('backgroundColors', spec.backgroundColor)?.label ?? spec.backgroundColor;
}

export function fontLabel(spec: PlaqueSpec): string {
  if (spec.font === 'custom') return spec.customFontName || 'Custom font';
  return findOption('fonts', spec.font)?.label ?? spec.font;
}
