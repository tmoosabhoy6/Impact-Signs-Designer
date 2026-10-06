// Reviewed once, retrieved locally per order. No planner call or full-gallery upload.
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import { fromRoot } from '../config.js';
import { mustOption } from '../catalog.js';
import type { PlaqueLayout, PlaqueSpec, DesignContext } from '../../shared/types.js';
import type { RefImage } from './prompts.js';

const exampleSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/), family: z.string(), label: z.string(),
  source: z.string(), asset: z.string().regex(/^[a-z0-9-]+\.webp$/),
  imageOptions: z.array(z.string()), aspect: z.number().positive(),
  density: z.enum(['sparse', 'medium', 'dense']), subject: z.enum(['none', 'portrait', 'scene']),
  hasLogo: z.boolean(), detail: z.boolean(), lesson: z.string(), sha256: z.string().regex(/^[a-f0-9]{64}$/),
  sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
});
export type DesignExample = z.infer<typeof exampleSchema>;
export const MAX_DESIGN_REFERENCES = 3;
let cached: { version: string; examples: DesignExample[]; images: Map<string, Buffer> } | undefined;

/** Also usable by offline checks; a broken library must never silently disappear. */
export function readDesignLibrary(directory: string) {
  try {
    const raw = fs.readFileSync(path.join(directory, 'index.json'), 'utf8');
    const parsed = z.object({ version: z.literal(1), examples: z.array(exampleSchema).min(1) }).parse(JSON.parse(raw));
    const images = new Map<string, Buffer>();
    for (const example of parsed.examples) {
      if (images.has(example.id)) throw new Error('Duplicate example');
      example.imageOptions.forEach((id) => mustOption('imageOptions', id));
      const image = fs.readFileSync(path.join(directory, example.asset));
      if (crypto.createHash('sha256').update(image).digest('hex') !== example.sha256) throw new Error('Changed reference');
      images.set(example.id, image);
    }
    return { version: crypto.createHash('sha256').update(raw).digest('hex').slice(0, 12), examples: parsed.examples, images };
  } catch {
    throw new Error('The Impact Signs design examples are missing or damaged. Restore the reviewed design library before generating.');
  }
}

export function designLibrary() {
  cached ??= readDesignLibrary(fromRoot('references/design-library'));
  return cached;
}

/** Treatment first, then proportions/content density. Distinct jobs, never duplicate closeups. */
export function selectDesignExamples(spec: PlaqueSpec, layout: PlaqueLayout, examples = designLibrary().examples, limit = MAX_DESIGN_REFERENCES): DesignExample[] {
  const treatment = layout.imageFrames.length ? spec.imageOption : 'none';
  const density = layout.lines.length > 14 ? 'dense' : layout.lines.length > 5 ? 'medium' : 'sparse';
  const aspect = spec.widthIn / spec.heightIn;
  const ranked = examples
    // Uncertain treatments are not taught as a known process. Text-only examples may teach craft.
    .filter((e) => e.imageOptions.includes(treatment) || e.imageOptions.includes('none'))
    .map((e) => ({ example: e, score: (e.imageOptions.includes(treatment) ? 100 : 0)
      + (e.density === density ? 12 : 0) - Math.abs(Math.log(e.aspect / aspect)) * 15
      - (e.detail ? 18 : 0) + (Boolean(layout.logos.length) === e.hasLogo ? 8 : 0) }))
    .sort((a, b) => b.score - a.score || a.example.id.localeCompare(b.example.id));
  const families = new Set<string>();
  const chosen: DesignExample[] = [];
  for (const { example } of ranked) {
    if (chosen.length >= Math.min(MAX_DESIGN_REFERENCES, Math.max(0, limit))) break;
    if (families.has(example.family)) continue;
    families.add(example.family);
    chosen.push(example);
  }
  return chosen;
}

export function designReferences(spec: PlaqueSpec, layout: PlaqueLayout, room: number): RefImage[] {
  const library = designLibrary();
  return selectDesignExamples(spec, layout, library.examples, room).map((e) => ({
    name: `impact-style-${e.id}.webp`, mime: 'image/webp', file: library.images.get(e.id)!,
    role: `reviewed Impact Signs workmanship example (${e.label}). Learn only: ${e.lesson} Style evidence only: never copy its wording, person, logo, ornament, silhouette, perspective, colors or mounting. JOB, customer artwork, swatches and Reference 1 override this example.`,
    designExample: { id: e.id, label: e.label, sha256: e.sha256, lesson: e.lesson },
  }));
}

export function designContext(refs: RefImage[]): DesignContext {
  return { libraryVersion: designLibrary().version, examples: refs.flatMap((r) => r.designExample ? [r.designExample] : []) };
}
