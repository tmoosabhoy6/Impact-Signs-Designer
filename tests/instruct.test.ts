import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { planInstruction, fallbackInstruction, applyWordingEdits, validateInstructionPlan, planSchema } from '../server/ai/instruct';
import { parseSpec } from '../server/parse/spec';
import { parseWording, docxToText } from '../server/parse/wording';
import { getCatalog } from '../server/catalog';
import { computeLayout } from '../server/layout/engine';
import { layoutTextPath } from '../server/render/flat';
import { buildProductionPdf } from '../server/pdf/production';
import { preflight } from '../server/pdf/preflight';
import { compareWording } from '../server/ai/spellcheck';
import { buildFixPrompt } from '../server/ai/prompts';
import type { ConceptRecord, Project } from '../shared/types';

async function heritage() {
  return {
    spec: parseSpec(fs.readFileSync('references/32241-edwin-feulner/spec.txt', 'utf8')).spec,
    wording: parseWording(await docxToText(fs.readFileSync('references/32241-edwin-feulner/Edwin-J.docx'))),
  } as Project;
}

describe('image-only edit prompt', () => {
  it('keeps the exact instruction and protects unmentioned details without generation rules', () => {
    const p = buildFixPrompt('  make the logo a UV print on a raised plate.  ');
    expect(p).toContain('make the logo a UV print on a raised plate.');
    expect(p).toContain('character for character');
    expect(p).toContain('overrides any conflicting preservation rule');
    expect(p).toContain('small, restrained adjustment');
    expect(p).toContain('  make the logo a UV print on a raised plate.  ');
    expect(p).not.toContain('PLAQUE RENDERER');
    expect(p).not.toContain('Image 2');
    expect(p).not.toContain('fully and clearly visible');
  });
});

describe('offline instruction planner', () => {
  it('changes double-line borders through the catalog', async () => {
    const p = await heritage();
    expect(await planInstruction(p, { preset: 'classic' } as ConceptRecord, 'make the border double line')).toMatchObject({ kind: 'spec', specPatch: { border: 'double-line' } });
  });
  it('corrects image spelling without changing customer wording', async () => {
    expect(fallbackInstruction(await heritage(), 'correct the spelling of Feulner')).toMatchObject({ kind: 'visual' });
  });
  it('replaces only the literally requested customer text', async () => {
    const p = await heritage();
    const before = structuredClone(p.wording);
    const plan = fallbackInstruction(p, 'change Founder to Chairman');
    expect(plan.kind).toBe('wording');
    if (plan.kind !== 'wording') throw new Error('Expected wording');
    const after = applyWordingEdits(p.wording, plan.wordingEdits);
    expect(after.blocks[0].text).toBe('Edwin J. Feulner Jr., Chairman');
    expect(after.blocks.slice(1)).toEqual(before!.blocks.slice(1));
    expect(p.wording).toEqual(before);
  });
  it('sends a finish the catalog does not have to the image model, word for word', async () => {
    expect(fallbackInstruction(await heritage(), 'use a purple anodized finish')).toEqual({ kind: 'visual', restated: 'use a purple anodized finish' });
  });
  it('sets italic on the name/headline block', async () => {
    const p = await heritage();
    const plan = fallbackInstruction(p, 'make the name line italic');
    expect(plan).toMatchObject({ kind: 'wording', wordingEdits: [{ op: 'set_style', blockId: p.wording!.blocks[0].id, style: { italic: true } }] });
  });
  it.each([
    ['use verde patina', { finish: 'verde-patina' }],
    ['black paint', { backgroundColor: 'black' }],
    ['pebble texture', { backgroundTexture: 'pebble' }],
    ['Garamond', { font: 'garamond' }],
    ['screws through the face', { mounting: 'screws-through-face' }],
    ['make it 18 x 24', { widthIn: 18, heightIn: 24 }],
    ['use Double Line Border', { border: 'double-line' }],
  ])('plans %s without changing extra fields', async (instruction, specPatch) => {
    expect(fallbackInstruction(await heritage(), instruction)).toMatchObject({ kind: 'spec', specPatch });
  });
  it.each(['make it 120 x 24', 'use gold leaf', 'use a blue paint', 'write me a poem', 'recreate the entire image in a warmer light'])('never refuses: %s goes to the image model as written', async (instruction) => {
    expect(fallbackInstruction(await heritage(), instruction)).toEqual({ kind: 'visual', restated: instruction });
  });
  it('a catalog change plus something only the image can do becomes one edit', async () => {
    expect(fallbackInstruction(await heritage(), 'use double line and add neon lights')).toMatchObject({ kind: 'edit', specPatch: { border: 'double-line' }, imageEdit: 'add neon lights' });
  });
  it('a new metal takes a finish made for it; a finish the metal cannot have is an image change', async () => {
    const p = await heritage();
    expect(fallbackInstruction(p, 'use aluminum')).toMatchObject({ kind: 'spec', specPatch: { material: 'aluminum', finish: 'brushed-aluminum' } });
    for (const f of getCatalog().finishes) {
      const plan = fallbackInstruction(p, `use ${f.label}`);
      if ((f.materials as string[]).includes(p.spec!.material)) expect(plan).toMatchObject({ kind: 'spec', specPatch: { finish: f.id } });
      else expect(plan).toEqual({ kind: 'visual', restated: `use ${f.label}` });
    }
  });
  it('turns a refusal from the language model into an image edit', async () => {
    const p = await heritage();
    expect(validateInstructionPlan({ kind: 'refuse', reason: 'no', nearestOptions: [] }, p, 'make it glow')).toEqual({ kind: 'visual', restated: 'make it glow' });
  });
  it('inserts verbatim text at the bottom and preserves punctuation', async () => {
    const p = await heritage();
    const plan = fallbackInstruction(p, "add a line 'Est. 1989' at the bottom");
    if (plan.kind !== 'wording') throw new Error('Expected wording');
    expect(applyWordingEdits(p.wording, plan.wordingEdits).blocks.at(-1)).toMatchObject({ text: 'Est. 1989', role: 'footer' });
  });
  it('rejects invented ids, oversized plaques, extra fields and hallucinated wording', async () => {
    const p = await heritage();
    for (const specPatch of [{ finish: 'purple' }, { widthIn: 120 }, { extra: 'value' }, { thicknessIn: 0.01 }]) {
      expect(() => planSchema().parse({ kind: 'spec', restated: 'change', specPatch })).toThrow();
    }
    expect(() => validateInstructionPlan({ kind: 'wording', restated: 'rewrite', wordingEdits: [{ op: 'replace_text', blockId: p.wording!.blocks[0].id, from: 'Founder', to: 'President' }] }, p, 'change Founder to Chairman')).toThrow();
    expect(() => validateInstructionPlan({ kind: 'visual', restated: 'double border' }, p, 'make the border double line')).toThrow();
    expect(() => validateInstructionPlan({ kind: 'spec', restated: 'verde', specPatch: { finish: 'verde-patina' } }, p, 'use a purple anodized finish')).toThrow();
    expect(() => validateInstructionPlan({ kind: 'spec', restated: 'garamond', specPatch: { font: 'garamond' } }, p, 'make the border double line')).toThrow();
  });
  it('carries block styling into the shared drawing and vector outlines', async () => {
    const p = await heritage();
    const before = computeLayout({ spec: p.spec!, wording: p.wording, photos: [{ aspect: 402 / 450 }] }, 'classic');
    const plan = fallbackInstruction(p, 'make the name line italic');
    if (plan.kind !== 'wording') throw new Error('Expected wording');
    const wording = applyWordingEdits(p.wording, plan.wordingEdits);
    const after = computeLayout({ spec: p.spec!, wording, photos: [{ aspect: 402 / 450 }] }, 'classic');
    expect(after.lines[0].style?.italic).toBe(true);
    expect(layoutTextPath(after, p.spec!.font, 72)).not.toEqual(layoutTextPath(before, p.spec!.font, 72));
    const production = await buildProductionPdf({ spec: p.spec!, layout: after, jobNumber: 'styled', name: 'Styled' });
    const checks = await preflight(production.pdf, after, { fontLicensed: false });
    expect(checks.filter((c) => !c.warnOnly).every((c) => c.ok)).toBe(true);
  });
  it('does not apply only half of a mixed content request', async () => {
    const p = await heritage();
    for (const kind of ['visual', 'spec'] as const) {
      const raw = kind === 'visual' ? { kind, restated: 'change the border' } : { kind, restated: 'double border', specPatch: { border: 'double-line' } };
      expect(() => validateInstructionPlan(raw, p, 'use double line and change Founder to Chairman')).toThrow();
    }
  });
  it('preserves replacement punctuation exactly', async () => {
    const p = await heritage();
    const plan = fallbackInstruction(p, 'change Founder to Chairman.');
    if (plan.kind !== 'wording') throw new Error('Expected wording');
    expect(applyWordingEdits(p.wording, plan.wordingEdits).blocks[0].text).toBe('Edwin J. Feulner Jr., Chairman.');
  });
  it('uses the existing size style for larger names', async () => {
    const p = await heritage();
    const plan = fallbackInstruction(p, 'make the name line larger');
    expect(plan).toMatchObject({ kind: 'wording', wordingEdits: [{ style: { size: 1.2 } }] });
  });
  it('handles small-cap OCR without ignoring case changes in ordinary text or punctuation', () => {
    expect(compareWording(['Joyce Conklin-Repp Vankirk', 'Founder'], ['JOYCE CONKLIN-REPP VANKIRK', 'Founder'], [true, false])).toEqual([]);
    expect(compareWording(['Joyce Conklin-Repp Vankirk', 'Founder'], ['JOYCE CONKLIN-REPP VANKIRK', 'FOUNDER'], [true, false])).not.toEqual([]);
    expect(compareWording(['Joyce Conklin-Repp Vankirk,'], ['JOYCE CONKLIN REPP VANKIRK'], [true])).not.toEqual([]);
  });
});
