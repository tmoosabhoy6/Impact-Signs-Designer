// Reads the text back from a generated image with an OpenAI vision model and compares it
// word by word with the customer's wording. The image model draws the letters itself and
// can misspell, so every concept is checked before it can go on a proof.
import { config } from '../config.js';
import { friendlyError, openai } from './images.js';
import { readPrompt } from './prompts.js';
import type { RefImage } from './prompts.js';
import { DESIGN_CRITERIA, type DesignReview, type PlaqueSpec, type SpellcheckResult } from '../../shared/types.js';
import { mustOption, paintHex, paintLabel } from '../catalog.js';
import sharp from 'sharp';
import { z } from 'zod';

const norm = (s: string) =>
  s
    .replace(/[“”″]/g, '"')
    .replace(/[‘’′]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

/** Word-level diff (longest common subsequence). Returns the mismatched stretches. */
export function compareWording(expectedLines: string[], seenLines: string[], smallCapsLines: boolean[] = []): SpellcheckResult['differences'] {
  const a = norm(expectedLines.join(' ')).split(' ').filter(Boolean);
  const b = norm(seenLines.join(' ')).split(' ').filter(Boolean);
  // Small-cap glyphs are deliberately uppercase, while stored customer wording
  // remains verbatim. Only those styled tokens allow OCR capitalization changes.
  const flexible = expectedLines.flatMap((line, index) => norm(line).split(' ').filter(Boolean).map(() => !!smallCapsLines[index]));
  const same = (i: number, j: number) => a[i] === b[j] || (flexible[i] && a[i].toUpperCase() === b[j].toUpperCase());
  const dp = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--) dp[i][j] = same(i, j) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const diffs: SpellcheckResult['differences'] = [];
  let i = 0;
  let j = 0;
  let exp: string[] = [];
  let seen: string[] = [];
  const flush = () => {
    if (exp.length || seen.length) diffs.push({ expected: exp.join(' ') || '(nothing)', seen: seen.join(' ') || '(missing)' });
    exp = [];
    seen = [];
  };
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && same(i, j)) {
      flush();
      i++;
      j++;
    } else if (j < b.length && (i >= a.length || dp[i][j + 1] >= dp[i + 1][j])) seen.push(b[j++]);
    else exp.push(a[i++]);
  }
  flush();
  return diffs;
}

export interface DesignReviewInput {
  spec: PlaqueSpec;
  layoutPng: Buffer;
  styleRefs: RefImage[];
  instruction?: string;
  sourceImage?: Buffer;
  exactDesign?: boolean;
}

const checksSchema = z.array(z.object({ criterion: z.enum(DESIGN_CRITERIA), ok: z.boolean(), detail: z.string().trim().min(1).max(600) }))
  .length(DESIGN_CRITERIA.length)
  .refine((checks) => new Set(checks.map((c) => c.criterion)).size === DESIGN_CRITERIA.length);

export function parseDesignReview(value: unknown): DesignReview {
  const result = checksSchema.safeParse(value);
  if (!result.success) return { ok: false, checked: false, checks: [], message: 'Design review was incomplete. Inspect the image before making a proof.' };
  const checks = result.data;
  const ok = checks.every((check) => check.ok);
  return { ok, checked: true, checks, message: ok ? 'Design review found no visible issues.' : 'Design review found issues. Check the notes before making a proof.' };
}

function reviewSpecification(input: DesignReviewInput): string {
  const s = input.spec;
  const details = [
    `Material: ${mustOption('materials', s.material).label}; process: ${mustOption('processes', s.process ?? 'cast').label}.`,
    `Finish: ${mustOption('finishes', s.finish).label}; recessed paint: ${paintLabel(s)} (${paintHex(s)}); texture: ${mustOption('backgroundTextures', s.backgroundTexture).label}.`,
    `Image treatment: ${mustOption('imageOptions', s.imageOption).prompt}`,
    `Logo treatment: ${mustOption('logoTreatments', s.logoTreatment ?? 'raised-cast').prompt}`,
    `Border: ${mustOption('borders', s.border).label}; mounting: ${mustOption('mountings', s.mounting).label}.`,
    ...input.styleRefs.map((ref, i) => `Image ${i + 3}: ${ref.role}`),
  ];
  if (input.instruction) details.push(`The designer explicitly requested this edit; it overrides conflicting defaults for the requested change only: ${input.instruction}`);
  if (input.sourceImage) {
    const index = input.styleRefs.length + 3;
    details.push(input.instruction
      ? `Image ${index} is the original selected image BEFORE the edit. Compare Image 1 against it: every unrequested detail, including lettering, artwork, relative positions, border, lighting and finish must remain unchanged. Fail layout or treatment for collateral changes or a change larger than requested. The literal request overrides the drawing for moves the drawing cannot express.`
      : `Image ${index} is the authoritative EXACT DESIGN source. Compare every mark, letterform, handwritten stroke, doodle, relative position and space against Image 1. Physical material may change; its composition may not. Do not penalize intentional handwriting or doodles as unprofessional. Fail layout/readability for changed or missing artwork. Return an additional "sourceLines" array by reading wording from this source alone, so source spelling can be compared with the result. An empty array means the source contains no text.`);
  }
  if (input.exactDesign) details.push('This is exact customer artwork. The separate wording list and catalog font do not replace its text or letterforms. No house-style redesign is allowed. Neutral/black strokes become the ordered metal; the white page becomes the field. That physical transformation is intended and must not fail treatment. Non-neutral colored source marks are intentional painted/printed accents and must keep their original colors unless explicitly edited. Specifically inspect every colored mark: a red mark becoming bronze is a treatment failure. Compare relative positions and individual letter shapes rather than just presence of the major elements.');
  return details.join('\n');
}

/** Spelling and design use one vision request. No taste score, auto-approval or paid reroll. */
export async function spellcheckImage(png: Buffer, expectedLines: string[], smallCapsLines: boolean[] = [], review?: DesignReviewInput): Promise<SpellcheckResult & { designReview?: DesignReview }> {
  if (!expectedLines.length && !review) return { ok: true, checked: false, differences: [], message: 'No text to check.' };
  if (config.mockAI || !config.openaiKey) {
    return { ok: true, checked: false, differences: [], message: 'Spelling check skipped (demo mode). Proofread the image yourself.',
      ...(review ? { designReview: { ok: false, checked: false, checks: [], message: 'Design review skipped (demo mode). Inspect the image yourself.' } } : {}) };
  }
  try {
    const content: import('openai/resources/responses/responses').ResponseInputContent[] = [
      { type: 'input_text', text: readPrompt('spellcheck.md') + (review ? `\n\n${readPrompt('design-review.md')}\n\n${reviewSpecification(review)}` : '') },
      { type: 'input_image', image_url: `data:image/png;base64,${png.toString('base64')}`, detail: 'high' },
    ];
    if (review) {
      const drawing = await sharp(review.layoutPng).resize({ width: 768, height: 768, fit: 'inside', withoutEnlargement: true }).png().toBuffer();
      content.push({ type: 'input_image', image_url: `data:image/png;base64,${drawing.toString('base64')}`, detail: 'high' });
      for (const ref of review.styleRefs) content.push({ type: 'input_image', image_url: `data:${ref.mime};base64,${ref.file.toString('base64')}`, detail: 'high' });
      if (review.sourceImage) {
        const source = await sharp(review.sourceImage).resize({ width: 1536, height: 1536, fit: 'inside', withoutEnlargement: true }).png().toBuffer();
        content.push({ type: 'input_image', image_url: `data:image/png;base64,${source.toString('base64')}`, detail: 'high' });
      }
    }
    const res = await openai().responses.create({
      model: config.visionModel,
      store: false,
      input: [
        {
          role: 'user',
          content,
        },
      ],
      text: { format: { type: 'json_object' } },
    // Its own limit: the image client allows 10 minutes, and a stuck check would leave the version "running".
    }, { timeout: 90_000, maxRetries: 1 });
    const parsed = z.object({ lines: z.array(z.string()), sourceLines: z.array(z.string()).optional(), designChecks: z.unknown().optional() }).parse(JSON.parse(res.output_text || '{}'));
    const seen = parsed.lines;
    const sourceCheck = review?.exactDesign && !review.instruction;
    if (sourceCheck && !parsed.sourceLines) throw new Error('The exact design source wording was not read.');
    // Exact artwork edits may explicitly change embedded wording. The before/after
    // design review judges those instructions; an empty synthetic list is not an OCR target.
    const exactEdit = review?.exactDesign && !!review.instruction;
    const differences = exactEdit ? [] : compareWording(sourceCheck ? parsed.sourceLines! : expectedLines, seen, smallCapsLines);
    return {
      ok: differences.length === 0,
      checked: !exactEdit,
      differences,
      message: exactEdit ? 'Exact design edit reviewed against the selected image. Proofread its embedded wording before making a proof.' : differences.length ? `${differences.length} wording difference${differences.length > 1 ? 's' : ''} found. Use "Fix" or regenerate.` : 'Wording matches the customer text.',
      ...(review ? { designReview: parseDesignReview(parsed.designChecks) } : {}),
    };
  } catch (e) {
    return { ok: true, checked: false, differences: [], message: `Spelling check could not run (${friendlyError(e)}). Proofread the image yourself.`,
      ...(review ? { designReview: { ok: false, checked: false, checks: [], message: 'Design review could not run. Inspect the image before making a proof.' } } : {}) };
  }
}
