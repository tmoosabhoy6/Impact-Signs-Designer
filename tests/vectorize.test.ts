// The Vectorizer: any picture or PDF becomes a one-ink vector PDF, only for the person who made it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import type { Server } from 'node:http';
import { execFileSync } from 'node:child_process';
import express from 'express';
import sharp from 'sharp';
import { PDFDocument, PDFName, PDFRawStream, rgb } from 'pdf-lib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api } from '../server/routes';
import { config } from '../server/config';
import { authMode } from '../server/auth';
import { deleteVector, getVector, readVectorOptions, vectorizeFile, vectorRoot } from '../server/vectorize';
import { VECTOR_DEFAULTS } from '../shared/vectorize';

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

/** Counts fonts, images and fill colors in a PDF, as the production preflight does. */
async function inspect(pdf: Buffer) {
  const doc = await PDFDocument.load(pdf);
  let fonts = 0;
  let images = 0;
  const colors = new Set<string>();
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    const dict = (obj as { dict?: Map<unknown, unknown> }).dict ?? (obj as { get?: (k: unknown) => unknown } & { lookup?: unknown });
    const type = (dict as { get?: (k: PDFName) => unknown })?.get?.(PDFName.of('Type'))?.toString();
    const subtype = (dict as { get?: (k: PDFName) => unknown })?.get?.(PDFName.of('Subtype'))?.toString();
    if (type === '/Font') fonts++;
    if (subtype === '/Image') images++;
    if (obj instanceof PDFRawStream && !subtype) {
      const flate = obj.dict.get(PDFName.of('Filter'))?.toString() === '/FlateDecode';
      const text = (flate ? zlib.inflateSync(obj.contents) : Buffer.from(obj.contents)).toString('latin1');
      for (const m of text.matchAll(/([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+rg\b/g)) colors.add([m[1], m[2], m[3]].map((v) => Number(v).toFixed(3)).join(','));
    }
  }
  return { pages: doc.getPageCount(), size: doc.getPage(0).getSize(), fonts, images, colors: [...colors] };
}

describe('vectorizeFile', () => {
  const artwork = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><rect width="400" height="200" fill="white"/><path d="M20 20H180V180H20Z M50 50V150H150V50Z" fill="#231F20"/><rect x="80" y="80" width="40" height="40" fill="#231F20"/><circle cx="280" cy="100" r="60" fill="#231F20"/><circle cx="280" cy="100" r="30" fill="white"/></svg>');

  it.each(['png', 'jpeg', 'webp', 'tiff', 'gif'] as const)('reads %s without changing holes, islands or the one-ink PDF structure', async (format) => {
    const buffer = await sharp(artwork).toFormat(format).toBuffer();
    const r = await vectorizeFile({ name: `shapes.${format}`, buffer }, { widthIn: 6 }, 'Test');
    try {
      const info = await inspect(fs.readFileSync(vectorRoot(r.id, 'result.pdf')));
      expect(info).toMatchObject({ pages: 1, fonts: 0, images: 0, size: { width: 432 } });
      expect(info.colors).toEqual(['0.137,0.122,0.125']);
      expect(r.output.shapes).toBeGreaterThanOrEqual(3);
      expect(r.output.heightIn / r.output.widthIn).toBeGreaterThan(0.45);
      expect(r.output.heightIn / r.output.widthIn).toBeLessThan(0.55);
    } finally { deleteVector(r.id); }
  });

  it.skipIf(!hasPoppler)('PDF rendering agrees with SVG, including nested holes and a separate island', async () => {
    const r = await vectorizeFile({ name: 'holes.svg', buffer: artwork }, { widthIn: 4 }, 'Test');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vector-fidelity-'));
    try {
      execFileSync('pdftocairo', ['-png', '-singlefile', '-r', '144', vectorRoot(r.id, 'result.pdf'), path.join(tmp, 'pdf')]);
      const rendered = await sharp(path.join(tmp, 'pdf.png')).flatten({ background: '#ffffff' }).greyscale().raw().toBuffer({ resolveWithObject: true });
      const expected = await sharp(fs.readFileSync(vectorRoot(r.id, 'result.svg'))).resize(rendered.info.width, rendered.info.height, { fit: 'fill' }).flatten({ background: '#ffffff' }).greyscale().raw().toBuffer();
      let union = 0;
      let intersection = 0;
      for (let i = 0; i < expected.length; i++) {
        const a = rendered.data[i] < 128;
        const b = expected[i] < 128;
        if (a || b) union++;
        if (a && b) intersection++;
      }
      expect(intersection / union, 'PDF and SVG ink intersection / union').toBeGreaterThan(0.99);
      // These normalized positions sit well inside the strokes/counters, away from antialiasing.
      const dark = (x: number, y: number) => rendered.data[Math.floor(y * rendered.info.height) * rendered.info.width + Math.floor(x * rendered.info.width)] < 128;
      expect(dark(0.06, 0.5), 'outer frame').toBe(true);
      expect(dark(0.12, 0.5), 'frame hole').toBe(false);
      expect(dark(0.25, 0.5), 'island inside hole').toBe(true);
      expect(dark(0.8, 0.5), 'circular hole').toBe(false);
    } finally { deleteVector(r.id); fs.rmSync(tmp, { recursive: true, force: true }); }
  });

  it('keeps opaque white marks and empty space in transparent artwork', async () => {
    const buffer = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="100"><path d="M20 20H100V80H20Z M40 40V60H80V40Z" fill="white"/><circle cx="220" cy="50" r="30" fill="black"/></svg>')).png().toBuffer();
    const r = await vectorizeFile({ name: 'transparent.png', buffer }, { widthIn: 0.5 }, 'Test');
    try {
      expect(r.output.shapes).toBe(2);
      expect((await inspect(fs.readFileSync(vectorRoot(r.id, 'result.pdf')))).size.width).toBe(36);
      expect(r.inkPct).toBeGreaterThan(20);
      expect(r.inkPct).toBeLessThan(60);
    } finally { deleteVector(r.id); }
  });

  it.skipIf(!hasPoppler)('uses page 1 of multi-page PDF and PDF-compatible AI, and rejects damaged PDF', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([200, 100]).drawRectangle({ x: 20, y: 20, width: 160, height: 60, color: rgb(0, 0, 0) });
    doc.addPage([100, 300]).drawCircle({ x: 50, y: 150, size: 40, color: rgb(0, 0, 0) });
    const buffer = Buffer.from(await doc.save());
    for (const name of ['pages.pdf', 'pages.ai']) {
      const r = await vectorizeFile({ name, buffer }, { widthIn: 96 }, 'Test');
      try {
        expect(r.source.kind).toBe('pdf');
        expect(r.output.widthIn).toBe(96);
        expect(r.output.heightIn / r.output.widthIn).toBeLessThan(0.5);
        expect((await inspect(fs.readFileSync(vectorRoot(r.id, 'result.pdf'))))).toMatchObject({ pages: 1, fonts: 0, images: 0 });
      } finally { deleteVector(r.id); }
    }
    await expect(vectorizeFile({ name: 'broken.pdf', buffer: Buffer.from('%PDF-1.7 broken') }, VECTOR_DEFAULTS, 'Test')).rejects.toThrow(/Could not read this PDF/);
  });

  it('turns a photo of a plaque into the logo as one-ink outlines at the asked width', async () => {
    const r = await vectorizeFile({ name: 'camp.png', buffer: fs.readFileSync('assets/logo-treatments/uv-print.png') }, { ...VECTOR_DEFAULTS, widthIn: 4 }, 'Test', 'u1');
    expect(r).toMatchObject({ source: { kind: 'image', width: 440, height: 284 }, fromPlate: true, output: { widthIn: 4 } });
    expect(r.output.heightIn).toBeGreaterThan(6); // the shield and words stand taller than wide
    expect(r.output.shapes).toBeGreaterThan(8);
    expect(r.inkPct).toBeGreaterThan(15);
    expect(r.inkPct, 'the marks, not the solid plate behind them').toBeLessThan(50);
    const pdf = fs.readFileSync(`${config.dataDir}/vectors/${r.id}/result.pdf`);
    const info = await inspect(pdf);
    expect(info).toMatchObject({ pages: 1, fonts: 0, images: 0 });
    expect(info.size.width).toBeCloseTo(288, 0);
    expect(info.colors).toEqual(['0.137,0.122,0.125']);
    expect(fs.readFileSync(`${config.dataDir}/vectors/${r.id}/result.svg`, 'utf8')).toMatch(/<path /);
    expect(getVector(r.id)).toEqual(r);
  });

  it('reads an SVG and a PDF too', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="100"><rect width="300" height="100" fill="#fff"/><text x="150" y="70" font-size="60" text-anchor="middle" font-family="sans-serif" font-weight="bold">BOLD</text></svg>');
    const s = await vectorizeFile({ name: 'word.svg', buffer: svg }, VECTOR_DEFAULTS, 'Test');
    expect(s.source.kind).toBe('svg');
    expect(s.output.shapes).toBeGreaterThanOrEqual(4);
    if (!hasPoppler) return;
    const doc = await PDFDocument.create();
    const page = doc.addPage([300, 300]);
    page.drawCircle({ x: 150, y: 150, size: 100, color: rgb(0, 0, 0) });
    const p = await vectorizeFile({ name: 'circle.pdf', buffer: Buffer.from(await doc.save()) }, VECTOR_DEFAULTS, 'Test');
    expect(p.source.kind).toBe('pdf');
    expect(p.output.heightIn).toBeCloseTo(p.output.widthIn, 1);
    expect(p.inkPct).toBeGreaterThan(70);
  });

  it('refuses a flat picture and an unreadable file in plain English', async () => {
    const flat = await sharp({ create: { width: 200, height: 200, channels: 3, background: '#808080' } }).png().toBuffer();
    await expect(vectorizeFile({ name: 'flat.png', buffer: flat }, VECTOR_DEFAULTS, 'Test')).rejects.toThrow(/Nothing to trace/);
    await expect(vectorizeFile({ name: 'notes.txt', buffer: Buffer.from('hello') }, VECTOR_DEFAULTS, 'Test')).rejects.toThrow(/could not be read/);
  });

  it('checks options and keeps the width within limits', () => {
    expect(readVectorOptions(undefined)).toEqual(VECTOR_DEFAULTS);
    expect(readVectorOptions({ widthIn: '500' })).toEqual({ widthIn: 96 });
    expect(readVectorOptions({ background: 'dark', detail: 'fine', widthIn: 'abc' })).toEqual(VECTOR_DEFAULTS);
  });
});

describe('/api/vectors', () => {
  it('uploads, lists, serves and deletes only the owner’s files', async () => {
    const fd = new FormData();
    fd.append('file', new Blob([fs.readFileSync('assets/logo-treatments/raised-cast.png')], { type: 'image/png' }), 'raised.png');
    fd.append('widthIn', '6');
    const made = await fetch(`${base}/vectors`, { method: 'POST', headers: { Cookie: cookie }, body: fd });
    expect(made.status).toBe(200);
    const { vector } = (await made.json()) as { vector: { id: string; output: { widthIn: number } } };
    expect(vector.output.widthIn).toBe(6);
    const list = (await (await fetch(`${base}/vectors`, { headers: { Cookie: cookie } })).json()) as { vectors: { id: string }[] };
    expect(list.vectors.some((v) => v.id === vector.id)).toBe(true);
    const pdf = await fetch(`${base}/vectors/${vector.id}/result.pdf?download=1`, { headers: { Cookie: cookie } });
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get('content-disposition')).toContain('raised-vector.pdf');
    expect((await fetch(`${base}/vectors/${vector.id}/preview.png`, { headers: { Cookie: cookie } })).status).toBe(200);
    expect((await fetch(`${base}/vectors/${vector.id}/meta.json`, { headers: { Cookie: cookie } })).status).toBe(404);
    // Another sign-in cannot see it (open mode, with no sign-in at all, is single-user).
    if (authMode() !== 'open') {
      const other = await fetch(`${base}/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Someone Else', password: config.appPassword }) });
      const otherCookie = other.headers.get('set-cookie')!.split(';')[0];
      const theirs = (await (await fetch(`${base}/vectors`, { headers: { Cookie: otherCookie } })).json()) as { vectors: { id: string }[] };
      expect(theirs.vectors.some((v) => v.id === vector.id)).toBe(false);
      expect((await fetch(`${base}/vectors/${vector.id}/result.pdf`, { headers: { Cookie: otherCookie } })).status).toBe(404);
    }
    expect((await fetch(`${base}/vectors/${vector.id}`, { method: 'DELETE', headers: { Cookie: cookie } })).status).toBe(200);
    expect(getVector(vector.id)).toBeNull();
  });

  it('answers a missing file plainly', async () => {
    const r = await fetch(`${base}/vectors`, { method: 'POST', headers: { Cookie: cookie }, body: new FormData() });
    expect(r.status).toBe(400);
    expect(await r.json()).toMatchObject({ error: 'Choose a picture or PDF to vectorize.' });
  });
});
