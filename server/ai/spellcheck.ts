// Reads the text back from a generated image with an OpenAI vision model and compares it
// word by word with the customer's wording. The image model draws the letters itself and
// can misspell, so every concept is checked before it can go on a proof.
import { config } from '../config.js';
import { openai } from './images.js';
import { readPrompt } from './prompts.js';
import type { SpellcheckResult } from '../../shared/types.js';

const norm = (s: string) =>
  s
    .replace(/[“”″]/g, '"')
    .replace(/[‘’′]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

/** Word-level diff (longest common subsequence). Returns the mismatched stretches. */
export function compareWording(expectedLines: string[], seenLines: string[]): SpellcheckResult['differences'] {
  const a = norm(expectedLines.join(' ')).split(' ').filter(Boolean);
  const b = norm(seenLines.join(' ')).split(' ').filter(Boolean);
  const dp = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
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
    if (i < a.length && j < b.length && a[i] === b[j]) {
      flush();
      i++;
      j++;
    } else if (j < b.length && (i >= a.length || dp[i][j + 1] >= dp[i + 1][j])) seen.push(b[j++]);
    else exp.push(a[i++]);
  }
  flush();
  return diffs;
}

export async function spellcheckImage(png: Buffer, expectedLines: string[]): Promise<SpellcheckResult> {
  if (!expectedLines.length) return { ok: true, checked: false, differences: [], message: 'No text to check.' };
  if (config.mockAI || !config.openaiKey) {
    return { ok: true, checked: false, differences: [], message: 'Spelling check skipped (demo mode). Proofread the image yourself.' };
  }
  try {
    const res = await openai().responses.create({
      model: config.visionModel,
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_text', text: readPrompt('spellcheck.md') },
            { type: 'input_image', image_url: `data:image/png;base64,${png.toString('base64')}`, detail: 'high' },
          ],
        },
      ],
      text: { format: { type: 'json_object' } },
    });
    const parsed = JSON.parse(res.output_text || '{}') as { lines?: string[] };
    const seen = Array.isArray(parsed.lines) ? parsed.lines.map(String) : [];
    const differences = compareWording(expectedLines, seen);
    return {
      ok: differences.length === 0,
      checked: true,
      differences,
      message: differences.length ? `${differences.length} wording difference${differences.length > 1 ? 's' : ''} found. Use "Fix" or regenerate.` : 'Wording matches the customer text.',
    };
  } catch (e) {
    return { ok: true, checked: false, differences: [], message: `Spelling check could not run (${(e as Error).message}). Proofread the image yourself.` };
  }
}
