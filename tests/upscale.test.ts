import type { Server } from 'node:http';
import express from 'express';
import sharp from 'sharp';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const edit = vi.fn();
vi.mock('../server/ai/images', async (orig) => {
  const real = await orig<typeof import('../server/ai/images')>();
  return { ...real, openai: () => ({ images: { edit } }) };
});

const { api } = await import('../server/routes');
const { config } = await import('../server/config');
const { modelCanvas, upscaleImage, UPSCALE_PROMPT } = await import('../server/ai/upscale');
const { targetSize } = await import('../shared/upscale');

/** A small test picture with edges, gradients and color so the comparisons mean something. */
async function testImage(width: number, height: number, alpha = false) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <defs><linearGradient id="g"><stop offset="0" stop-color="#2e3092"/><stop offset="1" stop-color="#c49a6c"/></linearGradient></defs>
    <rect width="100%" height="100%" fill="${alpha ? 'none' : 'url(#g)'}"/>
    <circle cx="${width * 0.3}" cy="${height * 0.5}" r="${Math.min(width, height) * 0.25}" fill="#ed1c24"/>
    <rect x="${width * 0.6}" y="${height * 0.2}" width="${width * 0.25}" height="${height * 0.6}" fill="#ffffff" stroke="#231f20" stroke-width="3"/>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

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
afterEach(() => {
  config.mockAI = true;
  edit.mockReset();
});

async function postImage(png: Buffer, target: string, name = 'logo.png') {
  const fd = new FormData();
  fd.append('file', new Blob([new Uint8Array(png)], { type: 'image/png' }), name);
  fd.append('target', target);
  return fetch(`${base}/upscales`, { method: 'POST', headers: { Cookie: cookie }, body: fd });
}

describe('upscale sizing', () => {
  it('enlarges only until the short side reaches the target', () => {
    expect(targetSize(400, 300, '720p')).toMatchObject({ width: 960, height: 720 });
    expect(targetSize(300, 400, '1080p')).toMatchObject({ width: 1080, height: 1440 });
    expect(targetSize(1280, 720, '720p').scale).toBe(1);
    // Extreme panoramas are capped at a 3840 px long edge.
    expect(targetSize(2000, 100, '1080p').width).toBe(3840);
  });

  it('asks the model for a canvas with the same proportions in multiples of 16', () => {
    const c = modelCanvas(400, 300, 960);
    expect(c.w % 16).toBe(0);
    expect(c.h % 16).toBe(0);
    expect(c.w / c.h).toBeCloseTo(4 / 3, 1);
    expect(Math.max(c.w, c.h)).toBeLessThanOrEqual(config.imageLongEdge);
  });
});

describe('upscaler routes in demo mode', () => {
  it('upscales, lists, serves and deletes an image', async () => {
    const res = await postImage(await testImage(400, 300), '720p');
    expect(res.status).toBe(200);
    const { upscale } = await res.json();
    expect(upscale.output).toEqual({ width: 960, height: 720 });
    expect(upscale.fidelity.tone).toBe('ok');
    expect(upscale.colorLocked).toBe(true);

    const file = await fetch(`${base}/upscales/${upscale.id}/upscaled.png`, { headers: { Cookie: cookie } });
    expect(file.status).toBe(200);
    expect(await sharp(Buffer.from(await file.arrayBuffer())).metadata()).toMatchObject({ width: 960, height: 720 });
    const dl = await fetch(`${base}/upscales/${upscale.id}/standard.png?download=1`, { headers: { Cookie: cookie } });
    expect(dl.headers.get('content-disposition')).toContain('logo-standard-720p.png');

    const list = await (await fetch(`${base}/upscales`, { headers: { Cookie: cookie } })).json();
    expect(list.upscales.some((u: { id: string }) => u.id === upscale.id)).toBe(true);

    const del = await fetch(`${base}/upscales/${upscale.id}`, { method: 'DELETE', headers: { Cookie: cookie } });
    expect(del.status).toBe(200);
    expect((await fetch(`${base}/upscales/${upscale.id}/upscaled.png`, { headers: { Cookie: cookie } })).status).toBe(404);
  });

  it('keeps transparency from the original', async () => {
    const { upscale } = await (await postImage(await testImage(200, 200, true), '720p')).json();
    const png = Buffer.from(await (await fetch(`${base}/upscales/${upscale.id}/upscaled.png`, { headers: { Cookie: cookie } })).arrayBuffer());
    const meta = await sharp(png).metadata();
    expect(meta.channels).toBe(4);
    expect((await sharp(png).stats()).channels[3].min).toBe(0);
  });

  it('refuses images that are already big enough and non-images', async () => {
    const big = await postImage(await testImage(1600, 1000), '720p');
    expect(big.status).toBe(400);
    expect((await big.json()).error).toMatch(/does not need upscaling/);
    const text = await postImage(Buffer.from('not an image'), '720p', 'notes.png');
    expect(text.status).toBe(400);
    expect((await text.json()).error).toMatch(/not an image/);
  });
});

describe('upscaler OpenAI call (stubbed client)', () => {
  it('sends the enlargement with the exact-copy prompt and high input fidelity, and records cost', async () => {
    config.mockAI = false;
    edit.mockImplementation(async (params: { image: File[]; size: string }) => {
      const input = Buffer.from(await params.image[0].arrayBuffer());
      const png = await sharp(input).sharpen().png().toBuffer();
      return { data: [{ b64_json: png.toString('base64') }], usage: { input_tokens: 1000, output_tokens: 4000, input_tokens_details: { text_tokens: 300, image_tokens: 700 } } };
    });
    const r = await upscaleImage({ name: 'photo.jpg', buffer: await testImage(320, 240) }, '1080p', 'Test');
    expect(edit).toHaveBeenCalledTimes(1);
    const params = edit.mock.calls[0][0];
    expect(params).toMatchObject({ model: config.imageModel, prompt: UPSCALE_PROMPT, input_fidelity: 'high', output_format: 'png', stream: false });
    const [w, h] = params.size.split('x').map(Number);
    expect(w / h).toBeCloseTo(4 / 3, 1);
    expect(r.output).toEqual({ width: 1440, height: 1080 });
    expect(r.fidelity.tone).toBe('ok');
    expect(r.costUsd).toBeGreaterThan(0);
  });

  it('retries without input fidelity when the model does not accept it', async () => {
    config.mockAI = false;
    edit.mockImplementation(async (params: { image: File[]; input_fidelity?: string }) => {
      if (params.input_fidelity) throw Object.assign(new Error("Unknown parameter: 'input_fidelity'."), { status: 400, param: 'input_fidelity' });
      return { data: [{ b64_json: Buffer.from(await params.image[0].arrayBuffer()).toString('base64') }], usage: null };
    });
    const r = await upscaleImage({ name: 'a.png', buffer: await testImage(300, 300) }, '720p', 'Test');
    expect(edit).toHaveBeenCalledTimes(2);
    expect(edit.mock.calls[1][0].input_fidelity).toBeUndefined();
    expect(r.output).toEqual({ width: 720, height: 720 });
  });

  it('flags an AI result that changed the picture and does not blend it', async () => {
    config.mockAI = false;
    edit.mockImplementation(async (params: { size: string }) => {
      const [w, h] = params.size.split('x').map(Number);
      const png = await sharp(await testImage(w, h)).flop().png().toBuffer();
      return { data: [{ b64_json: png.toString('base64') }], usage: null };
    });
    const r = await upscaleImage({ name: 'a.png', buffer: await testImage(400, 300) }, '720p', 'Test');
    expect(r.fidelity.tone).toBe('red');
    expect(r.colorLocked).toBe(false);
  });

  it('turns OpenAI errors into plain English', async () => {
    config.mockAI = false;
    edit.mockRejectedValue(Object.assign(new Error('Incorrect API key'), { status: 401 }));
    await expect(upscaleImage({ name: 'a.png', buffer: await testImage(300, 200) }, '720p', 'Test')).rejects.toThrow(/rejected the API key/);
  });
});
