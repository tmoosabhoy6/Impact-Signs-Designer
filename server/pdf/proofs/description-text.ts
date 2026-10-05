// Writes the "DESCRIPTION: Qty. 1 set 6”x4” Cast Bronze Plaque. …" header used on the
// Description-sheet proofs, in the same words the designers use (Awe, Raccoon River,
// Sax-Zim Bog, Hadar Family Hall).
import { mustOption, findOption, fontLabel, paintLabel } from '../../catalog.js';
import type { PlaqueSpec, Wording } from '../../../shared/types.js';
import { fractionText } from './common.js';

const inch = (v: number) => `${+v.toFixed(3)}”`;

export function finishPhrase(spec: PlaqueSpec): string {
  const f = findOption('finishes', spec.finish);
  if (!f) return '';
  if (f.id === 'natural-satin-brushed-bronze') return 'Satin brushed finish';
  if (f.id === 'brushed-aluminum') return 'Brushed aluminum finish';
  return `${f.label} finish`;
}

export function materialPhrase(spec: PlaqueSpec): string {
  const etched = spec.process === 'reverse-etched';
  if (spec.material === 'aluminum') return etched ? 'Reverse Etched Aluminum Plaque' : 'Cast Aluminum Plaque';
  return etched ? 'Reverse Etched Bronze Plaque' : 'Cast Bronze Plaque';
}

export function backgroundPhrase(spec: PlaqueSpec): string {
  const tex = findOption('backgroundTextures', spec.backgroundTexture);
  const texture = !tex || tex.id === 'smooth' ? '' : ` with ${tex.label} texture`;
  return `Background painted ${paintLabel(spec)}${texture}.`;
}

export function borderPhrase(spec: PlaqueSpec): string {
  const b = findOption('borders', spec.border);
  if (!b) return '';
  if (b.id === 'none') return 'No border.';
  const words = b.label.replace(/ Border$/, '').split(' ');
  return `${[words[0], ...words.slice(1).map((w) => w.toLowerCase())].join(' ')} border.`;
}

export function mountingPhrase(spec: PlaqueSpec): string {
  switch (spec.mounting) {
    case 'garden-stake':
      return `${spec.stakeLengthIn ? inch(spec.stakeLengthIn) + ' ' : ''}Garden Stake mount.`;
    case 'blind-studs':
      return 'Blind Stud Mount with pattern.';
    case 'screws-through-face':
      return '(4) Countersunk Wood Screw mount.';
    case 'rosettes':
      return 'Decorative rosette mount.';
    default:
      return `${findOption('mountings', spec.mounting)?.label ?? ''} mount.`;
  }
}

/** "Includes photo relief image." — or, with several frames, "Includes 2 photo relief images." */
export function imagePhrase(spec: PlaqueSpec, count = 1): string {
  const n = Math.max(1, count);
  const many = n > 1;
  switch (spec.imageOption) {
    case 'full-color-uv':
      return many ? `Includes ${n} Full Color UV printed photos.` : 'Includes Full Color UV printed photo.';
    case 'photo-relief':
      return many ? `Includes ${n} photo relief images.` : 'Includes photo relief image.';
    case 'bas-relief':
      return many ? `Includes ${n} sculpted bas relief images.` : 'Includes sculpted bas relief image.';
    case 'etched-photo':
      return many ? `Includes ${n} etched photos.` : 'Includes etched photo.';
    default:
      return '';
  }
}

/** "Includes raised cast logo." / "Includes UV printed logo on raised plate." */
export function logoPhrase(spec: PlaqueSpec, count = 0): string {
  if (count < 1) return '';
  const many = count > 1;
  const treatment = mustOption('logoTreatments', spec.logoTreatment ?? 'raised-cast');
  if (treatment.mode !== 'raised') {
    const tone = treatment.mode === 'color' ? 'color' : 'monochrome';
    return many ? `Includes ${count} UV printed ${tone} logos on raised plates.` : `Includes UV printed ${tone} logo on raised plate.`;
  }
  return many ? `Includes ${count} raised cast logos.` : 'Includes raised cast logo.';
}

/** The wording itself when it is short (Awe: "Copy: In Memory of Kathleen Awe 1949-2020"); otherwise "as per customer art file". */
export function copyPhrase(wording: Wording | null): string {
  const all = (wording?.blocks ?? []).map((b) => b.text.replace(/\n/g, ' ')).join(' ').replace(/\s+/g, ' ').trim();
  return all && all.length <= 60 ? `Copy: ${all}` : 'Copy: as per customer art file.';
}

export function autoDescription(spec: PlaqueSpec, wording: Wording | null, opts: { fontStated?: boolean; photoCount?: number; logoCount?: number } = {}): string {
  const thick = spec.thicknessIn ? ` ${fractionText(spec.thicknessIn)}” thick` : '';
  const size = `${inch(spec.widthIn)}x${inch(spec.heightIn)}`;
  // The designers only list the font when the order names one.
  const font = spec.font === 'custom' || opts.fontStated ? `Font: ${fontLabel(spec)}.` : '';
  const l1 = `DESCRIPTION: Qty. 1 set ${size}${thick} ${materialPhrase(spec)}. ${finishPhrase(spec)}. ${borderPhrase(spec)}`;
  const l2 = backgroundPhrase(spec);
  const l3 = [copyPhrase(wording), imagePhrase(spec, opts.photoCount), logoPhrase(spec, opts.logoCount), font, mountingPhrase(spec)].filter(Boolean).join('  ');
  return [l1, l2, l3].join('\n');
}
