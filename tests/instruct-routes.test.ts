import type { Server } from 'node:http';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api } from '../server/routes';
import { config } from '../server/config';
import { createExampleJob } from '../server/examples';
import { getConcept, getProject, listConcepts, newId, saveConcept, saveProject, spentToday } from '../server/db';
import { newConceptRecord } from '../server/ai/pipeline';
import type { ConceptRecord, Project } from '../shared/types';

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

async function post(url: string, body = {}) {
  return fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify(body) });
}
async function fixture() {
  const p = await createExampleJob('32241-edwin-feulner', 'Test');
  const c = newConceptRecord(p, { preset: 'classic', kind: 'concept', batchId: newId('b'), status: 'done', hasImage: true });
  saveConcept(c);
  return { p, c };
}
function streamEvents(text: string) {
  return text.split('\n\n').filter((s) => s.startsWith('data: ')).map((s) => JSON.parse(s.slice(6)));
}

describe('instruction routes in demo mode', () => {
  it('returns 422 on refusal without making a record, changing the job or spending', async () => {
    const { p, c } = await fixture();
    const before = listConcepts(p.id);
    const spend = spentToday();
    const response = await post(`/concepts/${c.id}/fix`, { instruction: 'use a purple anodized finish' });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ nearestOptions: expect.arrayContaining(['Verde Patina']) });
    expect(listConcepts(p.id)).toEqual(before);
    expect(getProject(p.id)).toEqual(p);
    expect(spentToday()).toBe(spend);
  });
  it('streams the plan first, regenerates from changed spec, and undoes without removing versions', async () => {
    const { p, c } = await fixture();
    const response = await post(`/concepts/${c.id}/fix`, { instruction: 'make the border double line' });
    expect(response.status).toBe(200);
    const events = streamEvents(await response.text());
    expect(events[0]).toMatchObject({ type: 'plan', plan: { kind: 'spec' } });
    expect(events[1].type).toBe('start');
    expect(events.at(-1).type).toBe('end');
    const version = listConcepts(p.id).at(-1)!;
    expect(version).toMatchObject({ kind: 'regenerate', status: 'done', parentId: c.id, quality: 'high', previous: { spec: { border: 'single-line' } }, snapshot: { spec: { border: 'double-line' } } });
    expect(version.prompt).toContain('double line border');
    expect(version.spellcheck).not.toBeNull();
    expect(getProject(p.id)?.spec?.border).toBe('double-line');
    expect((await post(`/concepts/${version.id}/undo`)).status).toBe(200);
    expect(getProject(p.id)?.spec).toEqual(p.spec);
    expect(listConcepts(p.id)).toHaveLength(2);
    expect(getConcept(c.id)).toEqual(c);
    // Selecting the changed version restores its content after Undo.
    expect((await post(`/projects/${p.id}/select`, { conceptId: version.id })).status).toBe(200);
    expect(getProject(p.id)?.spec?.border).toBe('double-line');
  });
  it('updates exact wording and restores both wording text and blocks on undo', async () => {
    const { p, c } = await fixture();
    const response = await post(`/concepts/${c.id}/fix`, { instruction: 'change Founder to Chairman' });
    await response.text();
    const version = listConcepts(p.id).at(-1)!;
    expect(version.plan?.kind).toBe('wording');
    expect(getProject(p.id)?.wording?.blocks[0].text).toBe('Edwin J. Feulner Jr., Chairman');
    await post(`/concepts/${version.id}/undo`);
    expect(getProject(p.id)?.wording).toEqual(p.wording);
    expect(getProject(p.id)?.wordingText).toEqual(p.wordingText);
  });
  it('refuses undo that would overwrite a subsequent order change', async () => {
    const { p, c } = await fixture();
    await (await post(`/concepts/${c.id}/fix`, { instruction: 'make the border double line' })).text();
    const first = listConcepts(p.id).at(-1)!;
    await (await post(`/concepts/${first.id}/fix`, { instruction: 'black paint' })).text();
    expect((await post(`/concepts/${first.id}/undo`)).status).toBe(409);
    expect(getProject(p.id)?.spec?.backgroundColor).toBe('black');
  });
  it('preserves the image anchor when inserting a wording block and restores it on undo', async () => {
    const { p, c } = await fixture();
    p.imageAfterBlock = 0;
    saveProject(p);
    await (await post(`/concepts/${c.id}/fix`, { instruction: 'add a line "Recognition" at the top' })).text();
    expect(getProject(p.id)?.imageAfterBlock).toBe(1);
    const version = listConcepts(p.id).at(-1)!;
    await post(`/concepts/${version.id}/undo`);
    expect(getProject(p.id)?.imageAfterBlock).toBe(0);
  });
  it('does not silently approve an unchecked live proof', async () => {
    const { p, c } = await fixture();
    const mock = config.mockAI;
    config.mockAI = false;
    try {
      const response = await post(`/projects/${p.id}/proof`, { conceptId: c.id });
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ error: expect.stringContaining('not completed a spelling check') });
    } finally { config.mockAI = mock; }
  });
});
