// The Proof Merger: PDFs joined in the order sent, every page kept, nothing stored.
import type { Server } from 'node:http';
import { execFileSync } from 'node:child_process';
import express from 'express';
import { PDFDocument } from 'pdf-lib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api } from '../server/routes';
import { config } from '../server/config';
import { authMode } from '../server/auth';
import { MERGE_MAX_FILES } from '../shared/merge';

let server: Server;
let base: string;
let cookie: string;
beforeAll(async () => {
  const app = express();
  app.use('/api', api);
  server = await new Promise<Server>((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test address');
  base = `http://127.0.0.1:${address.port}/api`;
  const login = await fetch(`${base}/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Test', password: config.appPassword }) });
  cookie = login.headers.get('set-cookie')!.split(';')[0];
});
afterAll(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); });

const hasPoppler = (() => {
  try {
    execFileSync('pdftocairo', ['-v'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

/** A PDF whose pages are each a different size, so the order can be read back from the result. */
async function pdf(widths: number[]): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (const w of widths) doc.addPage([w, 100]);
  return Buffer.from(await doc.save());
}
function form(files: { name: string; data: Buffer }[], field = 'files'): FormData {
  const fd = new FormData();
  for (const f of files) fd.append(field, new Blob([new Uint8Array(f.data)], { type: 'application/pdf' }), f.name);
  return fd;
}
const post = (url: string, body: FormData, withCookie = true) => fetch(`${base}${url}`, { method: 'POST', body, headers: withCookie ? { cookie } : {} });

describe('proof merger', () => {
  it('needs a sign-in', async () => {
    if (authMode() === 'open') return; // development mode has no sign-in to test
    expect((await post('/merge', form([{ name: 'a.pdf', data: await pdf([200]) }]), false)).status).toBe(401);
  });

  it('joins the PDFs in the order sent and keeps every page', async () => {
    const res = await post('/merge', form([
      { name: 'c.pdf', data: await pdf([300]) },
      { name: 'a.pdf', data: await pdf([100, 150]) },
      { name: 'b.pdf', data: await pdf([200]) },
    ]));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/pdf');
    const out = await PDFDocument.load(Buffer.from(await res.arrayBuffer()));
    expect(out.getPages().map((p) => Math.round(p.getWidth()))).toEqual([300, 100, 150, 200]);
  });

  it('asks for at least two PDFs and refuses more than the limit', async () => {
    const one = await post('/merge', form([{ name: 'a.pdf', data: await pdf([100]) }]));
    expect(one.status).toBe(400);
    expect((await one.json()).error).toMatch(/at least two/i);
    const data = await pdf([100]);
    const many = await post('/merge', form(Array.from({ length: MERGE_MAX_FILES + 1 }, (_, i) => ({ name: `p${i}.pdf`, data }))));
    expect(many.status).toBe(400);
    expect((await many.json()).error).toMatch(/up to 15/i);
  });

  it('names the file that is not a readable PDF', async () => {
    const res = await post('/merge', form([
      { name: 'good.pdf', data: await pdf([100]) },
      { name: 'notes.pdf', data: Buffer.from('this is not a pdf') },
    ]));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('"notes.pdf" is not a PDF');
  });

  it.runIf(hasPoppler)('previews page 1 and reports the page count', async () => {
    const res = await post('/merge/preview', form([{ name: 'a.pdf', data: await pdf([100, 150, 200]) }], 'file'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pages).toBe(3);
    expect(body.image).toMatch(/^data:image\/png;base64,/);
  });
});
