// Request handling the designer sees as messages: bad line edits, oversized uploads,
// malformed requests, and what the server hands out without sign-in.
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../server/app';
import { config } from '../server/config';
import { cleanBlocks } from '../server/routes';
import { createExampleJob } from '../server/examples';
import { getProject } from '../server/db';

let server: Server;
let base: string;
let cookie: string;
let ownerId: string;
beforeAll(async () => {
  server = await new Promise<Server>((resolve) => { const s = createApp().listen(0, '127.0.0.1', () => resolve(s)); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test address');
  base = `http://127.0.0.1:${address.port}`;
  const login = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Test', password: config.appPassword }) });
  cookie = login.headers.get('set-cookie')?.split(';')[0] ?? '';
  ownerId = (await (await fetch(`${base}/api/me`, { headers: { Cookie: cookie } })).json()).user.id;
});
afterAll(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); });

const send = (method: string, url: string, body?: BodyInit, headers: Record<string, string> = {}) =>
  fetch(base + url, { method, headers: { Cookie: cookie, ...headers }, body });
const json = (method: string, url: string, body: unknown) => send(method, url, JSON.stringify(body), { 'Content-Type': 'application/json' });

describe('wording line edits', () => {
  it('keeps the text and the known style fields, and drops the rest', () => {
    const blocks = cleanBlocks([
      { id: 'w1', role: 'headline', text: '  In Honor of ', style: { bold: true, size: 1, font: '', columns: 1, extra: 'x' } },
      { role: 'body', text: 'a\nb', style: { italic: 1, smallCaps: true, columns: 2, align: 'left', size: 1.2, font: 'garamond' } },
    ]);
    expect(blocks).toEqual([
      { id: 'w1', role: 'headline', text: '  In Honor of ', style: { bold: true } },
      // A line sent without an id gets one from its position.
      { id: 'w1', role: 'body', text: 'a\nb', style: { smallCaps: true, font: 'garamond', columns: 2, align: 'left', size: 1.2 } },
    ]);
    expect(() => cleanBlocks([{ role: 'title', text: 'x' }])).toThrow(/role/);
    expect(() => cleanBlocks([{ role: 'body', text: '   ' }])).toThrow(/no text/);
    expect(() => cleanBlocks([{ role: 'body', text: 'x', style: { font: 'comic-sans' } }])).toThrow(/fonts/);
    expect(() => cleanBlocks([])).toThrow(/at least one line/);
  });

  it('answers a bad line edit in plain English and leaves the job unchanged', async () => {
    const p = await createExampleJob('32241-edwin-feulner', 'Test', ownerId);
    const r = await json('PATCH', `/api/projects/${p.id}`, { wording: { blocks: [{ role: 'body', text: '' }] } });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/Line 1 has no text/);
    expect(getProject(p.id)?.wording).toEqual(p.wording);
  });
});

describe('requests the middleware rejects', () => {
  it('explains an oversized upload instead of an HTML error page', async () => {
    const p = await createExampleJob('32241-edwin-feulner', 'Test', ownerId);
    const fd = new FormData();
    fd.append('file', new Blob([new Uint8Array(61 * 1024 * 1024)], { type: 'image/png' }), 'huge.png');
    const r = await send('POST', `/api/projects/${p.id}/upload/photo`, fd);
    expect(r.status).toBe(413);
    expect(r.headers.get('content-type')).toMatch(/json/);
    expect((await r.json()).error).toMatch(/larger than 60 MB/);
  });

  it('explains malformed JSON and an unknown upload type', async () => {
    const p = await createExampleJob('32241-edwin-feulner', 'Test', ownerId);
    const bad = await send('PATCH', `/api/projects/${p.id}`, '{not json', { 'Content-Type': 'application/json' });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toMatch(/not valid JSON/);
    const kind = await send('DELETE', `/api/projects/${p.id}/upload/passport`);
    expect(kind.status).toBe(400);
    expect((await kind.json()).error).toMatch(/Unknown upload type/);
  });
});

describe('public files', () => {
  it('serves the logo but nothing else from brand-assets', async () => {
    expect((await fetch(`${base}/library/brand/logo.png`)).status).toBe(200);
    expect((await fetch(`${base}/library/brand/impact-signs-logo-original.jpeg`)).status).toBe(404);
    expect((await fetch(`${base}/library/brand/fonts/.gitkeep`)).status).toBe(404);
  });
});
