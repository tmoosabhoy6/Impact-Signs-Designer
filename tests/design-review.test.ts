import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import { config } from '../server/config';
import { openai } from '../server/ai/images';
import { createExampleJob } from '../server/examples';
import { layoutFor } from '../server/ai/pipeline';
import { designReferences } from '../server/ai/design-library';
import { parseDesignReview, spellcheckImage } from '../server/ai/spellcheck';
import { DESIGN_CRITERIA } from '../shared/types';

const checks = () => DESIGN_CRITERIA.map((criterion) => ({ criterion, ok: true, detail: `Checked ${criterion}.` }));

describe('checked design-review responses', () => {
  it('passes only a complete, positive set of independent criteria', () => {
    expect(parseDesignReview(checks())).toMatchObject({ ok: true, checked: true });
    const failed = checks();
    failed[0] = { criterion: 'layout', ok: false, detail: 'The bottom dedication is cut off.' };
    expect(parseDesignReview(failed)).toMatchObject({ ok: false, checked: true, checks: failed });
  });

  it.each([undefined, null, [], checks().slice(1), [...checks().slice(1), checks()[1]], [{ criterion: 'taste', ok: true, detail: 'Pretty' }], checks().map((c) => ({ ...c, ok: 'true' })), checks().map((c) => ({ ...c, detail: '' }))])('does not mark malformed or incomplete output as a pass (%j)', (value) => {
    expect(parseDesignReview(value)).toMatchObject({ ok: false, checked: false, checks: [] });
  });
});

describe('one combined vision call', () => {
  async function runStub(output: unknown, expected = ['Customer wording'], instruction?: string) {
    const old = { mockAI: config.mockAI, openaiKey: config.openaiKey };
    config.mockAI = false;
    config.openaiKey = 'offline-placeholder';
    const create = vi.spyOn(openai().responses, 'create');
    if (output instanceof Error) create.mockRejectedValue(output);
    else create.mockResolvedValue({ output_text: JSON.stringify(output) } as never);
    try {
      const p = await createExampleJob('32241-edwin-feulner', 'Design review');
      const resultPng = await sharp({ create: { width: 1024, height: 1536, channels: 3, background: '#333333' } }).png().toBuffer();
      const drawing = await sharp({ create: { width: 1024, height: 1536, channels: 3, background: '#ffffff' } }).png().toBuffer();
      const refs = designReferences(p.spec!, layoutFor(p, 'classic'), 3);
      const result = await spellcheckImage(resultPng, expected, [], { spec: p.spec!, layoutPng: drawing, styleRefs: refs, instruction });
      expect(create).toHaveBeenCalledTimes(1);
      const request = create.mock.calls[0][0] as { store: boolean; input: { content: { type: string; text?: string; image_url?: string }[] }[] };
      expect(request.store).toBe(false);
      const content = request.input[0].content;
      expect(content.filter((c) => c.type === 'input_image')).toHaveLength(5);
      expect(content[1].image_url).toBe(`data:image/png;base64,${resultPng.toString('base64')}`);
      expect(content[2].image_url).not.toEqual(content[1].image_url);
      expect(content[0].text).toContain('Read wording ONLY from Image 1');
      expect(content[0].text).not.toContain('Customer wording'); // avoid telling the OCR its answer
      refs.forEach((r, i) => expect(content[0].text).toContain(`Image ${i + 3}: ${r.role}`));
      if (instruction) expect(content[0].text).toContain(instruction);
      return result;
    } finally { create.mockRestore(); Object.assign(config, old); }
  }

  it('checks spelling and concrete design criteria independently', async () => {
    const result = await runStub({ lines: ['Customer wording'], designChecks: checks() });
    expect(result).toMatchObject({ ok: true, checked: true, designReview: { ok: true, checked: true } });
  });

  it('never hides a spelling difference behind a positive design review', async () => {
    const result = await runStub({ lines: ['Custmer wording'], designChecks: checks() });
    expect(result).toMatchObject({ ok: false, checked: true, designReview: { ok: true, checked: true } });
  });

  it('marks a missing design response as unchecked, while retaining valid OCR', async () => {
    const result = await runStub({ lines: ['Customer wording'] });
    expect(result).toMatchObject({ ok: true, checked: true, designReview: { ok: false, checked: false } });
  });

  it('keeps designer instructions in the review context without changing them', async () => {
    await runStub({ lines: ['Customer wording'], designChecks: checks() }, undefined, 'make the background blue');
  });

  it('still reviews an image with no plaque wording', async () => {
    const result = await runStub({ lines: [], designChecks: checks() }, []);
    expect(result.designReview).toMatchObject({ ok: true, checked: true });
  });

  it.each([{}, { lines: ['Customer wording', 12], designChecks: checks() }, new Error('offline failure')])('fails closed on invalid OCR or an unavailable reader (%j)', async (output) => {
    expect(await runStub(output)).toMatchObject({ checked: false, designReview: { ok: false, checked: false } });
  });
});
