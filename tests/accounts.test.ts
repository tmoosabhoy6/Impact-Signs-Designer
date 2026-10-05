import type { Server } from 'node:http';
import express from 'express';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { api } from '../server/routes';
import { config } from '../server/config';
import { blankProject, newId, saveConcept, saveProject } from '../server/db';
import { createExampleJob } from '../server/examples';
import { newConceptRecord } from '../server/ai/pipeline';

// A stand-in for the Supabase app_login function (the real one is in supabase/migrations).
const SUPABASE = 'https://example-project.supabase.co';
const ACCOUNTS: Record<string, { id: string; username: string; display_name: string; password: string }> = {
  taher: { id: '00000000-0000-0000-0000-000000000001', username: 'Taher', display_name: 'Taher', password: 'test-pass-1' },
  bea: { id: '00000000-0000-0000-0000-000000000002', username: 'Bea', display_name: 'Bea', password: 'other-pass' },
};
const realFetch = globalThis.fetch;
const rpc = vi.fn(async (body: { p_username: string; p_password: string }, headers: Record<string, string>) => {
  if (headers.apikey !== 'sb_publishable_test') return new Response(JSON.stringify({ message: 'Invalid API key' }), { status: 401 });
  if (body.p_username === 'locked') return new Response(JSON.stringify({ message: 'Too many wrong passwords. Try again in 15 minutes.' }), { status: 400 });
  if (body.p_username === 'offline') throw new TypeError('fetch failed');
  const a = ACCOUNTS[body.p_username.trim().toLowerCase()];
  const rows = a && a.password === body.p_password ? [{ id: a.id, username: a.username, display_name: a.display_name }] : [];
  return new Response(JSON.stringify(rows), { status: 200 });
});

let server: Server;
let base: string;
beforeAll(async () => {
  config.supabaseUrl = SUPABASE;
  config.supabaseKey = 'sb_publishable_test';
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url === `${SUPABASE}/rest/v1/rpc/app_login`) return rpc(JSON.parse(String(init?.body)), init?.headers as Record<string, string>);
    return realFetch(input, init);
  });
  const app = express();
  app.use('/api', api);
  server = await new Promise<Server>((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test address');
  base = `http://127.0.0.1:${address.port}/api`;
});
afterAll(async () => {
  vi.restoreAllMocks();
  config.supabaseUrl = '';
  config.supabaseKey = '';
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function login(username: string, password: string) {
  return realFetch(`${base}/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
}
async function signIn(username: string, password: string) {
  const res = await login(username, password);
  expect(res.status).toBe(200);
  return res.headers.get('set-cookie')!.split(';')[0];
}
const get = (url: string, cookie?: string) => realFetch(base + url, { headers: cookie ? { Cookie: cookie } : {} });
const post = (url: string, cookie: string, body = {}) => realFetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify(body) });

describe('username and password sign-in (Supabase accounts)', () => {
  it('requires sign-in and accepts only the right password', async () => {
    expect(await (await get('/me')).json()).toMatchObject({ user: null, authMode: 'supabase', passwordRequired: true });
    expect((await get('/projects')).status).toBe(401);
    expect((await login('Taher', '1111')).status).toBe(401);
    expect((await login('nobody', 'test-pass-1')).status).toBe(401);
    const cookie = await signIn('taher', 'test-pass-1');
    expect(await (await get('/me', cookie)).json()).toMatchObject({ user: { username: 'Taher', name: 'Taher', id: `sb:${ACCOUNTS.taher.id}` } });
    expect(rpc).toHaveBeenCalledWith({ p_username: 'taher', p_password: 'test-pass-1' }, expect.objectContaining({ apikey: 'sb_publishable_test' }));
  });

  it('passes on the lock-out message and explains when the service is unreachable', async () => {
    expect(await (await login('locked', 'x')).json()).toMatchObject({ error: 'Too many wrong passwords. Try again in 15 minutes.' });
    expect(await (await login('offline', 'x')).json()).toMatchObject({ error: expect.stringContaining('Could not reach the sign-in service') });
  });

  it('rejects a cookie from the older shared-password sign-in', async () => {
    const supabaseCookie = await signIn('Taher', 'test-pass-1');
    config.supabaseUrl = '';
    config.appPassword = 'team';
    const teamCookie = (await realFetch(`${base}/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Taher', password: 'team' }) })).headers.get('set-cookie')!.split(';')[0];
    config.supabaseUrl = SUPABASE;
    config.appPassword = '';
    expect((await get('/projects', teamCookie)).status).toBe(401);
    expect((await get('/projects', supabaseCookie)).status).toBe(200);
  });
});

describe('each login has its own jobs and upscales', () => {
  it('keeps jobs, versions and files private to their owner', async () => {
    const taher = await signIn('Taher', 'test-pass-1');
    const bea = await signIn('Bea', 'other-pass');
    const { project } = await (await post('/projects', taher, { jobNumber: 'T-1', name: 'Taher job' })).json();
    expect(project).toMatchObject({ ownerId: `sb:${ACCOUNTS.taher.id}`, createdBy: 'Taher' });
    const { project: beaJob } = await (await post('/projects', bea, { jobNumber: 'B-1', name: 'Bea job' })).json();

    const ids = async (cookie: string) => (await (await get('/projects', cookie)).json()).projects.map((p: { id: string }) => p.id);
    expect(await ids(taher)).toContain(project.id);
    expect(await ids(taher)).not.toContain(beaJob.id);
    expect(await ids(bea)).toEqual(expect.arrayContaining([beaJob.id]));
    expect(await ids(bea)).not.toContain(project.id);

    expect((await get(`/projects/${project.id}`, bea)).status).toBe(400);
    expect((await realFetch(`${base}/projects/${project.id}`, { method: 'DELETE', headers: { Cookie: bea } })).status).toBe(400);
    expect((await get(`/projects/${project.id}`, taher)).status).toBe(200);

    // Generated versions and their files follow the job's owner.
    const job = await createExampleJob('32241-edwin-feulner', 'Taher', `sb:${ACCOUNTS.taher.id}`);
    const c = newConceptRecord(job, { preset: 'classic', kind: 'concept', batchId: newId('b'), status: 'done', hasImage: true });
    saveConcept(c);
    expect((await get(`/concepts/${c.id}/layout.png`, bea)).status).toBe(404);
    expect((await post(`/concepts/${c.id}/regenerate`, bea)).status).toBe(400);
    expect((await post(`/concepts/${c.id}/fix`, bea, { instruction: 'move the text up' })).status).toBe(400);
  });

  it('gives jobs from before sign-in accounts to the legacy owner only', async () => {
    const legacy = blankProject({ jobNumber: 'OLD-1', name: 'Before accounts', createdBy: 'Designer' });
    saveProject(legacy);
    const taher = await signIn('Taher', 'test-pass-1');
    const bea = await signIn('Bea', 'other-pass');
    expect((await (await get('/projects', taher)).json()).projects.some((p: { id: string }) => p.id === legacy.id)).toBe(true);
    expect((await (await get('/projects', bea)).json()).projects.some((p: { id: string }) => p.id === legacy.id)).toBe(false);
  });

  it('keeps upscales private to whoever made them', async () => {
    const taher = await signIn('Taher', 'test-pass-1');
    const bea = await signIn('Bea', 'other-pass');
    const fd = new FormData();
    fd.append('file', new Blob([new Uint8Array(await sharp({ create: { width: 200, height: 150, channels: 3, background: '#2e3092' } }).png().toBuffer())], { type: 'image/png' }), 'mine.png');
    fd.append('target', '720p');
    const { upscale } = await (await realFetch(`${base}/upscales`, { method: 'POST', headers: { Cookie: taher }, body: fd })).json();
    expect(upscale.ownerId).toBe(`sb:${ACCOUNTS.taher.id}`);
    const list = async (cookie: string) => (await (await get('/upscales', cookie)).json()).upscales.map((u: { id: string }) => u.id);
    expect(await list(taher)).toContain(upscale.id);
    expect(await list(bea)).not.toContain(upscale.id);
    expect((await get(`/upscales/${upscale.id}/upscaled.png`, bea)).status).toBe(404);
    expect((await realFetch(`${base}/upscales/${upscale.id}`, { method: 'DELETE', headers: { Cookie: bea } })).status).toBe(404);
    expect((await get(`/upscales/${upscale.id}/upscaled.png`, taher)).status).toBe(200);
  });
});
