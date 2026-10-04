// Customer wording: kept exactly as the customer wrote it.
// Only leading/trailing spaces are removed, and every removal is reported.
import mammoth from 'mammoth';
import type { Wording, WordingBlock, WordingRole } from '../../shared/types.js';

let counter = 0;
const newId = () => `w${Date.now().toString(36)}${(counter++).toString(36)}`;

export async function docxToText(buffer: Buffer): Promise<string> {
  const { value } = await mammoth.extractRawText({ buffer });
  // mammoth separates paragraphs with blank lines; keep one paragraph per line.
  return value
    .split(/\n/)
    .filter((l, i, all) => l.trim() !== '' || (i > 0 && all[i - 1].trim() !== ''))
    .join('\n');
}

export function parseWording(text: string): Wording {
  const notes: string[] = [];
  const paragraphs = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((raw) => {
      const trimmed = raw.trim();
      if (trimmed && raw !== trimmed) {
        const where = raw.startsWith(trimmed) ? 'after' : raw.endsWith(trimmed) ? 'before' : 'around';
        notes.push(`Removed extra spaces ${where} "${trimmed.length > 40 ? trimmed.slice(0, 40) + '…' : trimmed}".`);
      }
      return trimmed;
    })
    .filter(Boolean);

  const blocks: WordingBlock[] = paragraphs.map((t, i) => ({ id: newId(), role: guessRole(t, i, paragraphs), text: t }));

  if (/[“”‘’]/.test(text) && /["']/.test(text.replace(/[A-Za-z]'[A-Za-z]/g, ''))) {
    notes.push('The wording mixes curly and straight quotes. It is kept exactly as written.');
  }
  return { blocks, notes };
}

function guessRole(t: string, i: number, all: string[]): WordingRole {
  const short = t.length <= 70 && !/[.!?]$/.test(t);
  if (i === 0) return 'headline';
  if (i === 1 && short && all.length > 2) return 'subhead';
  if (i === all.length - 1 && all.length > 2 && t.length <= 60 && /(\b(19|20)\d{2}\b|dedicated|established|est\.)/i.test(t)) return 'footer';
  return 'body';
}

export function wordingPlainLines(w: Wording): string[] {
  return w.blocks.flatMap((b) => b.text.split('\n'));
}
