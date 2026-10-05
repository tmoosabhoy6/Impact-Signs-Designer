// Several photos, logos and sketches per job: stored as lists, laid out as groups, sent to
// the image model within its reference limit, and carried into the vector production file.
import fs from 'node:fs';
import type { Server } from 'node:http';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../server/app';
import { config } from '../server/config';
import { createExampleJob } from '../server/examples';
import { blankProject, getConcept, getProject, newId, saveConcept, saveProject } from '../server/db';
import { arrangePictures, computeLayout } from '../server/layout/engine';
import { buildReferences, contentSnapshot, layoutDrawing, layoutFor, matchesSnapshot, MAX_REFERENCES, newConceptRecord } from '../server/ai/pipeline';
import { buildConceptPrompt, placeNames } from '../server/ai/prompts';
import { fallbackInstruction } from '../server/ai/instruct';
import { buildProductionPdf } from '../server/pdf/production';
import { preflight } from '../server/pdf/preflight';
import { autoDescription } from '../server/pdf/proofs/description-text';
import { storeUpload } from '../server/uploads';
import { logoForDrawing } from '../server/render/flat';
import { normalizeUploads, UPLOAD_LIMITS } from '../shared/uploads';
import type { PlaqueLayout, Project, Rect } from '../shared/types';

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

/** A distinct test picture (the hue makes every file different). */
const picture = (w: number, h: number, hue: number) =>
  sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="hsl(${hue},60%,50%)"/><circle cx="${w / 2}" cy="${h / 2}" r="${Math.min(w, h) / 3}" fill="#fff"/></svg>`)).png().toBuffer();
const logoPng = (hue: number) =>
  sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><rect width="400" height="200" fill="#fff"/><rect x="40" y="40" width="320" height="120" fill="hsl(${hue},70%,30%)"/><circle cx="200" cy="100" r="40" fill="#fff"/></svg>`)).png().toBuffer();

const uploadFile = async (projectId: string, kind: string, name: string, data: Buffer) => {
  const fd = new FormData();
  fd.append('file', new Blob([new Uint8Array(data)]), name);
  return fetch(`${base}/api/projects/${projectId}/upload/${kind}`, { method: 'POST', headers: { Cookie: cookie }, body: fd });
};
const api = (method: string, url: string, body?: unknown) =>
  fetch(`${base}/api${url}`, { method, headers: { Cookie: cookie, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });

const inside = (r: Rect, box: Rect) => r.x >= box.x - 1e-6 && r.y >= box.y - 1e-6 && r.x + r.w <= box.x + box.w + 1e-6 && r.y + r.h <= box.y + box.h + 1e-6;
const overlap = (a: Rect, b: Rect) => a.x < b.x + b.w - 1e-6 && b.x < a.x + a.w - 1e-6 && a.y < b.y + b.h - 1e-6 && b.y < a.y + a.h - 1e-6;

/** Every frame and logo inside the field, none touching another, none over a line of text. */
function expectClean(layout: PlaqueLayout) {
  const boxes = [...layout.imageFrames.map((f) => f.outer), ...layout.logos];
  for (const b of boxes) expect(inside(b, layout.field)).toBe(true);
  boxes.forEach((a, i) => boxes.slice(i + 1).forEach((b) => expect(overlap(a, b)).toBe(false)));
  for (const l of layout.lines) {
    // Text band of the line: from cap height above the baseline to a little below it.
    const band = { x: 0, y: l.baseline - 0.75 * l.size, w: layout.widthIn, h: 0.95 * l.size };
    // A centered line whose middle falls inside a box horizontally must clear it vertically.
    for (const b of boxes) if (l.x == null && l.cx > b.x && l.cx < b.x + b.w) expect(overlap(band, b)).toBe(false);
  }
}

async function heritage(): Promise<Project> {
  return createExampleJob('32241-edwin-feulner', 'Test', ownerId);
}

describe('stored uploads', () => {
  it('reads jobs and versions saved with one photo, logo and sketch as one-item lists', () => {
    const legacy = {
      photo: { file: 'photo-abc.png', name: 'Dad.jpg', width: 400, height: 500 },
      logo: { file: 'logo-def.png', name: 'Rotary.svg', width: 600, height: 300, vectorSource: true },
      sketch: { file: 'sketch-ghi.png', name: 'sketch.pdf' },
      site: { file: 'site-x.png', name: 'wall.jpg', width: 10, height: 10 },
    };
    const u = normalizeUploads(legacy as never);
    expect(u.photos).toEqual([{ id: 'photo-abc', file: 'photo-abc.png', name: 'Dad.jpg', width: 400, height: 500 }]);
    expect(u.logos).toEqual([{ id: 'logo-def', file: 'logo-def.png', name: 'Rotary.svg', width: 600, height: 300, vectorSource: true }]);
    expect(u.sketches).toEqual([{ id: 'sketch-ghi', file: 'sketch-ghi.png', name: 'sketch.pdf' }]);
    expect(u.site).toEqual(legacy.site);
    // Upgrading twice changes nothing, and key order is fixed (snapshots compare as JSON).
    expect(JSON.stringify(normalizeUploads(u))).toBe(JSON.stringify(u));
    expect(normalizeUploads(null)).toEqual({ photos: [], logos: [], sketches: [] });
  });

  it('keeps "Use this version" and Undo working for versions saved before lists', async () => {
    const p = await heritage();
    const legacyUploads = { photo: { file: p.uploads.photos[0].file, name: p.uploads.photos[0].name, width: p.uploads.photos[0].width, height: p.uploads.photos[0].height } };
    const c = newConceptRecord(p, { preset: 'classic', kind: 'concept', batchId: newId('b'), status: 'done', hasImage: true });
    c.snapshot = { ...c.snapshot!, uploads: legacyUploads as never };
    saveConcept(c);
    const back = getConcept(c.id)!;
    expect(back.snapshot!.uploads!.photos.map((f) => f.file)).toEqual([p.uploads.photos[0].file]);
    // The job as stored now and the old version describe the same files.
    expect(matchesSnapshot({ ...p, uploads: { ...p.uploads, photos: p.uploads.photos.map(({ hash: _hash, ...f }) => f) } }, back.snapshot!)).toBe(true);
  });
});

describe('arranging several pictures', () => {
  it('keeps the measured single-frame rule for one picture', () => {
    expect(arrangePictures([0.8], 6, 20, 0.3)).toEqual({ rows: [[0]], h: 6 / 0.8 });
    expect(arrangePictures([0.8], 6, 5, 0.3)).toEqual({ rows: [[0]], h: 5 });
  });

  it('puts two portraits side by side and four in two rows when that is clearly larger', () => {
    const two = arrangePictures([0.8, 0.8], 10, 8, 0.4, { maxRows: 2 });
    expect(two.rows).toEqual([[0, 1]]);
    expect(two.h * 1.6 + 0.4).toBeCloseTo(10, 6);
    const four = arrangePictures([0.8, 0.8, 0.8, 0.8], 10, 12, 0.4, { maxRows: 2 });
    expect(four.rows).toEqual([[0, 1], [2, 3]]);
    // A short box keeps one row.
    expect(arrangePictures([0.8, 0.8, 0.8, 0.8], 10, 3, 0.4, { maxRows: 2 }).rows).toEqual([[0, 1, 2, 3]]);
  });
});

describe('layout with several photos and logos', () => {
  const portrait = (id: string) => ({ id, aspect: 0.8 });
  const wide = (id: string) => ({ id, aspect: 2 });

  it('gives each photo its own frame, in order, with body below and Statement headings beside it', async () => {
    const p = await heritage();
    for (const n of [2, 3, 4]) {
      const photos = Array.from({ length: n }, (_, i) => portrait(`p${i}`));
      for (const preset of ['classic', 'portrait', 'statement'] as const) {
        const l = computeLayout({ spec: p.spec!, wording: p.wording, photos }, preset);
        expect(l.imageFrames.map((f) => f.photoId)).toEqual(photos.map((x) => x.id));
        expectClean(l);
        // Every frame has the same height and the photo's own shape.
        for (const f of l.imageFrames) {
          expect(f.outer.h).toBeCloseTo(l.imageFrames[0].outer.h, 6);
          expect(f.outer.w / f.outer.h).toBeCloseTo(0.8, 6);
          expect(f.inner.w).toBeLessThan(f.outer.w);
        }
        // Statement reserves the top-right for opening text; the other presets stack everything.
        const bottom = Math.max(...l.imageFrames.map((f) => f.outer.y + f.outer.h));
        const below = preset === 'statement' ? l.lines.slice(3) : l.lines;
        expect(Math.min(...below.map((x) => x.baseline))).toBeGreaterThan(bottom);
      }
    }
  });

  it('centers the photo group on the plaque and reads left to right', async () => {
    const p = await heritage();
    const l = computeLayout({ spec: p.spec!, wording: p.wording, photos: [portrait('a'), portrait('b')] }, 'classic');
    const [a, b] = l.imageFrames.map((f) => f.outer);
    expect(a.x).toBeLessThan(b.x);
    expect(a.y).toBeCloseTo(b.y, 6);
    expect((a.x + b.x + b.w) / 2).toBeCloseTo(l.widthIn / 2, 6);
    expect(placeNames([a, b])).toEqual(['left', 'right']);
  });

  it('stacks two landscape photos at the left of a landscape plaque', async () => {
    const p = await heritage();
    const spec = { ...p.spec!, widthIn: 18, heightIn: 12 };
    const one = computeLayout({ spec, wording: p.wording, photos: [{ id: 'a', aspect: 1.5 }] }, 'classic');
    const two = computeLayout({ spec, wording: p.wording, photos: [{ id: 'a', aspect: 1.5 }, { id: 'b', aspect: 1.5 }] }, 'classic');
    expect(one.imageFrames[0].outer.x).toBeLessThan(one.widthIn / 3);
    const [a, b] = two.imageFrames.map((f) => f.outer);
    expect(a.y + a.h).toBeLessThan(b.y);
    expect(Math.max(a.x + a.w, b.x + b.w)).toBeLessThan(Math.min(...two.lines.map((x) => x.cx)));
    expectClean(two);
    expect(placeNames([a, b])).toEqual(['top', 'bottom']);
  });

  it('sets several logos in one row (two rows from four) at every slot', async () => {
    const p = await heritage();
    for (const n of [1, 2, 3, 4, 6]) {
      const logos = Array.from({ length: n }, (_, i) => wide(`l${i}`));
      for (const logoSlot of ['top', 'middle', 'bottom'] as const) {
        const l = computeLayout({ spec: p.spec!, wording: p.wording, photos: [portrait('p')], logos, logoSlot }, 'classic');
        expect(l.logos.map((x) => x.logoId)).toEqual(logos.map((x) => x.id));
        expectClean(l);
        for (const box of l.logos) expect(box.w / box.h).toBeCloseTo(2, 6);
        const rows = new Set(l.logos.map((x) => x.y.toFixed(4))).size;
        if (n < 4) expect(rows).toBe(1);
        else expect(rows).toBeLessThanOrEqual(2);
      }
    }
  });

  it('resizes the whole photo group and logo row together', async () => {
    const p = await heritage();
    const base = { spec: p.spec!, wording: p.wording, photos: [portrait('a'), portrait('b')], logos: [wide('x'), wide('y')] };
    const plain = computeLayout(base, 'classic');
    const bigger = computeLayout({ ...base, adjust: { imageScale: 1.3, logoScale: 1.3 } }, 'classic');
    for (const i of [0, 1]) {
      expect(bigger.imageFrames[i].outer.w).toBeGreaterThan(plain.imageFrames[i].outer.w);
      expect(bigger.logos[i].w).toBeGreaterThan(plain.logos[i].w);
    }
    expectClean(bigger);
  });

  it('fits four photos and six logos on a small plaque without overlaps', async () => {
    const p = await heritage();
    const spec = { ...p.spec!, widthIn: 8, heightIn: 10 };
    const l = computeLayout({ spec, wording: p.wording, photos: ['a', 'b', 'c', 'd'].map(portrait), logos: ['1', '2', '3', '4', '5', '6'].map(wide) }, 'classic');
    expect(l.imageFrames).toHaveLength(4);
    expect(l.logos).toHaveLength(6);
    expectClean(l);
  });
});

describe('upload routes', () => {
  it('adds several photos, logos and sketches, each kept with its own id', async () => {
    const p = await heritage();
    for (const [i, hue] of [10, 120].entries()) expect((await uploadFile(p.id, 'photo', `extra-${i}.png`, await picture(400, 500, hue))).status).toBe(200);
    for (const hue of [0, 200, 300]) expect((await uploadFile(p.id, 'logo', `logo-${hue}.png`, await logoPng(hue))).status).toBe(200);
    for (const hue of [40, 80]) expect((await uploadFile(p.id, 'sketch', `sketch-${hue}.png`, await picture(300, 300, hue))).status).toBe(200);
    const saved = getProject(p.id)!;
    expect(saved.uploads.photos.map((f) => f.name)).toEqual([p.uploads.photos[0].name, 'extra-0.png', 'extra-1.png']);
    expect(saved.uploads.logos).toHaveLength(3);
    expect(saved.uploads.sketches).toHaveLength(2);
    const ids = [...saved.uploads.photos, ...saved.uploads.logos, ...saved.uploads.sketches].map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    // Each file is served by its id.
    const logo = saved.uploads.logos[1];
    const r = await api('GET', `/projects/${p.id}/files/logo/${logo.id}`);
    expect(r.status).toBe(200);
    expect((await sharp(Buffer.from(await r.arrayBuffer())).metadata()).width).toBe(logo.width);
    expect((await api('GET', `/projects/${p.id}/files/logo/logo-nope`)).status).toBe(404);
    // The layouts show every file; each photo has its own resolution at size.
    const payload = await (await api('GET', `/projects/${p.id}`)).json();
    expect(payload.layouts[0].imageFrames).toHaveLength(3);
    expect(payload.layouts[0].logos).toHaveLength(3);
    expect(Object.keys(payload.layouts[0].photoPpi).sort()).toEqual(saved.uploads.photos.map((f) => f.id).sort());
  });

  it('keeps every file when several arrive at the same time', async () => {
    const p = await heritage();
    const results = await Promise.all([0, 60, 120, 180].map(async (hue) => uploadFile(p.id, 'logo', `same-time-${hue}.png`, await logoPng(hue))));
    expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200]);
    expect(getProject(p.id)!.uploads.logos.map((f) => f.name).sort()).toEqual(['same-time-0.png', 'same-time-120.png', 'same-time-180.png', 'same-time-60.png']);
  });

  it('refuses a repeated file and a full list in plain English', async () => {
    const p = await heritage();
    const again = await uploadFile(p.id, 'photo', 'copy.jpg', fs.readFileSync(`references/32241-edwin-feulner/${p.uploads.photos[0].name}`));
    expect(again.status).toBe(400);
    expect((await again.json()).error).toMatch(/copy\.jpg was not added: this photo is already on the job \(as /);
    for (let i = 1; i < UPLOAD_LIMITS.photo; i++) expect((await uploadFile(p.id, 'photo', `p${i}.png`, await picture(400, 500, i * 40))).status).toBe(200);
    const full = await uploadFile(p.id, 'photo', 'one-too-many.png', await picture(400, 500, 300));
    expect(full.status).toBe(400);
    expect((await full.json()).error).toMatch(/one-too-many\.png was not added: a job can have up to 4 photos/);
    expect(getProject(p.id)!.uploads.photos).toHaveLength(UPLOAD_LIMITS.photo);
  });

  it('explains a file that is not an image', async () => {
    const p = await heritage();
    const r = await uploadFile(p.id, 'logo', 'notes.png', Buffer.from('this is not a picture'));
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/notes\.png could not be read as an image/);
    expect(getProject(p.id)!.uploads.logos).toHaveLength(0);
  });

  it('removes one file and reorders the rest, refusing a stale order', async () => {
    const p = await heritage();
    for (const hue of [0, 90, 180]) await uploadFile(p.id, 'logo', `l${hue}.png`, await logoPng(hue));
    const [a, b, c] = getProject(p.id)!.uploads.logos;
    const moved = await api('PUT', `/projects/${p.id}/upload/logo/order`, { ids: [c.id, a.id, b.id] });
    expect(moved.status).toBe(200);
    expect(getProject(p.id)!.uploads.logos.map((f) => f.id)).toEqual([c.id, a.id, b.id]);
    // The layout follows the new order, left to right.
    const l = layoutFor(getProject(p.id)!, 'classic');
    expect([...l.logos].sort((x, y) => x.x - y.x).map((x) => x.logoId)).toEqual([c.id, a.id, b.id]);

    const stale = await api('PUT', `/projects/${p.id}/upload/logo/order`, { ids: [a.id, b.id] });
    expect(stale.status).toBe(400);
    expect((await stale.json()).error).toMatch(/have changed/);

    expect((await api('DELETE', `/projects/${p.id}/upload/logo/${a.id}`)).status).toBe(200);
    expect(getProject(p.id)!.uploads.logos.map((f) => f.id)).toEqual([c.id, b.id]);
    // The removed file stays on disk for versions that used it.
    expect(fs.existsSync(`${config.dataDir}/projects/${p.id}/uploads/${a.file}`)).toBe(true);
    const again = await api('DELETE', `/projects/${p.id}/upload/logo/${a.id}`);
    expect((await again.json()).error).toMatch(/no longer on this job/);
    const which = await api('DELETE', `/projects/${p.id}/upload/logo`);
    expect((await which.json()).error).toMatch(/Say which logo/);
  });

  it('restores the files of a version when it is used again', async () => {
    const p = await heritage();
    await uploadFile(p.id, 'photo', 'second.png', await picture(400, 500, 33));
    const two = getProject(p.id)!;
    const c = newConceptRecord(two, { preset: 'classic', kind: 'concept', batchId: newId('b'), status: 'done', hasImage: true });
    saveConcept(c);
    await api('DELETE', `/projects/${p.id}/upload/photo/${two.uploads.photos[1].id}`);
    expect(getProject(p.id)!.uploads.photos).toHaveLength(1);
    expect(matchesSnapshot(getProject(p.id)!, c.snapshot!)).toBe(false);
    expect((await api('POST', `/projects/${p.id}/select`, { conceptId: c.id })).status).toBe(200);
    expect(getProject(p.id)!.uploads.photos.map((f) => f.name)).toEqual([p.uploads.photos[0].name, 'second.png']);
  });
});

describe('image model references', () => {
  it.each(['classic', 'portrait', 'statement'].flatMap((preset) => ['portrait', 'landscape'].map((orientation) => [preset, orientation])))('preserves embedded logo captions in %s on a %s plaque', async (preset, orientation) => {
    let p = await heritage();
    p.spec = { ...p.spec!, widthIn: orientation === 'portrait' ? 12 : 18, heightIn: orientation === 'portrait' ? 18 : 12 };
    const artwork = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="600" height="400" fill="white"/><circle cx="300" cy="130" r="90" fill="black"/><text x="300" y="350" font-family="sans-serif" font-size="60" font-weight="bold" text-anchor="middle">IMPACT SIGNS</text></svg>')).png().toBuffer();
    p = await storeUpload(p, 'logo', 'logo-with-caption.png', artwork);
    const layout = layoutFor(p, preset as 'classic' | 'portrait' | 'statement');
    const w = orientation === 'portrait' ? 1200 : 1800;
    const h = orientation === 'portrait' ? 1800 : 1200;
    const drawing = await layoutDrawing(p, layout, w, h);
    const refs = await buildReferences(p, layout, drawing);
    const logo = refs.find((r) => r.name === 'customer-logo.png')!;
    expect(logo).toBeDefined();
    const expected = await sharp(artwork).flatten({ background: '#808080' }).png().toBuffer();
    expect(logo.file).toEqual(expected);
    expect(logo.role).toContain('including all embedded text underneath');
    const prompt = buildConceptPrompt(p.spec!, layout, refs, { logoCount: 1 });
    expect(prompt).toContain('Text already present inside a supplied logo is required artwork');
    expect(prompt).toContain('TEXT lists only the separate plaque wording');
    expect(prompt).toContain('Never crop to just the symbol');
    // The bottom quarter contains only the embedded caption, separated from the symbol.
    const box = layout.logos[0];
    const px = w / layout.widthIn;
    const caption = await sharp(drawing).extract({ left: Math.ceil(box.x * px), top: Math.ceil((box.y + box.h * 0.75) * px), width: Math.floor(box.w * px) - 1, height: Math.floor(box.h * 0.2 * px) }).stats();
    expect(caption.channels.some((channel) => channel.stdev > 5)).toBe(true);
    fs.writeFileSync(`/tmp/logo-caption-${orientation}-${preset}.png`, drawing);
  });

  it('names each photo and logo by its place in the layout drawing', async () => {
    let p = await heritage();
    p = await storeUpload(p, 'photo', 'mother.png', await picture(400, 500, 200));
    p = await storeUpload(p, 'logo', 'a.png', await logoPng(10));
    p = await storeUpload(p, 'logo', 'b.png', await logoPng(250));
    const layout = layoutFor(p, 'classic');
    const refs = await buildReferences(p, layout, await layoutDrawing(p, layout, 400, 600));
    const roles = refs.map((r) => r.role);
    expect(roles[0]).toMatch(/layout drawing/);
    expect(roles[1]).toMatch(/customer photo 1 of 2, for the left image frame/);
    expect(roles[2]).toMatch(/customer photo 2 of 2, for the right image frame/);
    expect(roles.filter((r) => /customer logo \d of 2/.test(r))).toHaveLength(2);
    const prompt = buildConceptPrompt(p.spec!, layout, refs, { logoCount: 2 });
    expect(prompt).toMatch(/There are 2 separate images, each inside its own thin raised metal frame/);
    expect(prompt).toMatch(/2 supplied customer logos/);
  });

  it('stays within the model limit with the most files a job can have', async () => {
    let p = await heritage();
    for (let i = 1; i < UPLOAD_LIMITS.photo; i++) p = await storeUpload(p, 'photo', `p${i}.png`, await picture(400, 500, i * 50));
    for (let i = 0; i < UPLOAD_LIMITS.logo; i++) p = await storeUpload(p, 'logo', `l${i}.png`, await logoPng(i * 50));
    for (let i = 0; i < UPLOAD_LIMITS.sketch; i++) p = await storeUpload(p, 'sketch', `s${i}.png`, await picture(300, 300, i * 70 + 5));
    // Face screws add the mounting example: the largest set of catalog references.
    p.spec = { ...p.spec!, mounting: 'screws-through-face' };
    const layout = layoutFor(p, 'classic');
    const refs = await buildReferences(p, layout, await layoutDrawing(p, layout, 400, 600));
    expect(refs.length).toBeLessThanOrEqual(MAX_REFERENCES);
    // Layout + 4 photos + 6 catalog pictures (type, finish, paint, texture, border, screws) + 2 sheets.
    expect(refs).toHaveLength(13);
    // Sketches and logos share a sheet each; every photo keeps its own reference.
    expect(refs.filter((r) => /^customer photo \d of 4/.test(r.role))).toHaveLength(4);
    expect(refs.find((r) => r.name === 'customer-logo-sheet.png')?.role).toMatch(/all 6 customer logos on one sheet/);
    expect(refs.find((r) => r.name === 'customer-sketch-sheet.png')?.role).toMatch(/4 hand-drawn sketches/);
    const sheet = await sharp(refs.find((r) => r.name === 'customer-logo-sheet.png')!.file).metadata();
    expect(sheet.width).toBe(3 * 512);
  });
});

describe('logos in the layout drawing', () => {
  it('raised cast: the logo ink is the metal color and everything else is see-through, as the vector file traces it', async () => {
    const png = await logoForDrawing(await logoPng(200), 'raised-cast', '#C49A6C');
    const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
    // The drawing is cut to the logo (the 320 x 120 mark plus a small margin), so sample by position within it.
    const at = (fx: number, fy: number) => {
      const i = (Math.round(fy * (info.height - 1)) * info.width + Math.round(fx * (info.width - 1))) * 4;
      return { r: data[i], g: data[i + 1], b: data[i + 2], a: data[i + 3] };
    };
    expect(at(0.5, 0.5).a).toBe(0); // the white circle inside the mark shows the field
    expect(at(0.1, 0.1)).toMatchObject({ r: 0xc4, g: 0x9a, b: 0x6c, a: 255 }); // the mark is raised metal
    expect(info.width / info.height).toBeGreaterThan(2.3); // the 320 x 120 mark plus its margin
    expect(info.width / info.height).toBeLessThan(2.8);
  });
  it('UV print: a metal plate with the logo printed on it in its own colors', async () => {
    const png = await logoForDrawing(await logoPng(200), 'uv-print', '#C49A6C');
    const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
    const at = (fx: number, fy: number) => {
      const i = (Math.round(fy * (info.height - 1)) * info.width + Math.round(fx * (info.width - 1))) * 4;
      return { r: data[i], g: data[i + 1], b: data[i + 2], a: data[i + 3] };
    };
    expect(at(0.01, 0.01)).toMatchObject({ r: 0xc4, g: 0x9a, b: 0x6c, a: 255 }); // the plate's padding
    expect(at(0.5, 0.5)).toMatchObject({ r: 255, g: 255, b: 255, a: 255 }); // opaque white is printed white, not bronze
    const mark = at(0.25, 0.3); // hsl(200,70%,30%): a blue, printed as is
    expect(mark.a).toBe(255);
    expect(mark.b).toBeGreaterThan(mark.r + 40);
  });
});

describe('production file and proof text', () => {
  it('traces every logo into its own box and leaves a window in every frame', async () => {
    const p = await heritage();
    const layout = computeLayout({ spec: p.spec!, wording: p.wording, photos: [{ id: 'a', aspect: 0.8 }, { id: 'b', aspect: 0.8 }], logos: [{ id: 'x', aspect: 2 }, { id: 'y', aspect: 2 }, { id: 'z', aspect: 2 }], logoSlot: 'bottom' }, 'classic');
    const r = await buildProductionPdf({
      jobNumber: '1', name: 'multi', spec: p.spec!, layout,
      logos: [{ png: await logoPng(0), name: 'x.png', fromVector: false }, { png: await logoPng(120), name: 'y.svg', fromVector: true }, { png: null, name: 'z.png', fromVector: false }],
    });
    expect(r.notes).toEqual(expect.arrayContaining([
      'Logo 1 (x.png) was traced from a raster image. Check its edges, or replace it with the vector original in Illustrator.',
      'Logo 2 (y.svg) was traced from a high-resolution render of the vector file. Check it against the original.',
      'Logo 3 (z.png) position is reserved but no logo file was uploaded.',
    ]));
    const checks = await preflight(r.pdf, layout, { fontLicensed: true, logosTraced: 2 });
    for (const label of ['No fonts (all text outlined)', 'No raster images', 'One ink (#231F20 + white)']) expect(checks.find((c) => c.label === label)?.ok).toBe(true);
    expect(checks.find((c) => c.label === 'Logos')).toMatchObject({ ok: false, detail: '2 of 3 traced to vector; 1 position(s) have no logo file', warnOnly: true });
  });

  it('counts the images in the Description-sheet header', async () => {
    const p = await heritage();
    expect(autoDescription(p.spec!, p.wording, { photoCount: 1 })).toContain('Includes photo relief image.');
    expect(autoDescription(p.spec!, p.wording, { photoCount: 2 })).toContain('Includes 2 photo relief images.');
  });
});

describe('Fix requests about several photos or logos', () => {
  const withFiles = (photos: number, logos: number): Project => {
    const p = blankProject({ jobNumber: 'F', name: 'F', createdBy: 'Test' });
    const f = (kind: string, i: number) => ({ id: `${kind}-${i}`, file: `${kind}-${i}.png`, name: `${kind}${i}.png`, width: 400, height: 200 });
    p.uploads = { photos: Array.from({ length: photos }, (_, i) => f('photo', i)), logos: Array.from({ length: logos }, (_, i) => ({ ...f('logo', i), vectorSource: false })), sketches: [] };
    p.wording = { blocks: [{ id: 'w1', role: 'headline', text: 'Name' }], notes: [] };
    saveProject(p);
    return p;
  };

  it('resizes the whole group and says so', () => {
    const plan = fallbackInstruction(withFiles(2, 3), 'make the logos bigger');
    expect(plan).toMatchObject({ kind: 'edit', layoutPatch: { logoScale: 1.18 } });
    expect(plan.kind === 'edit' && plan.restated).toMatch(/the 3 logos 18% larger/);
    expect(fallbackInstruction(withFiles(2, 0), 'make the photos smaller')).toMatchObject({ layoutPatch: { imageScale: 1 / 1.18 } });
    expect(fallbackInstruction(withFiles(2, 3), 'move the logos to the top')).toMatchObject({ placement: { logos: [{ logoId: 'logo-0', position: 'top' }, { logoId: 'logo-1', position: 'top' }, { logoId: 'logo-2', position: 'top' }] } });
  });

  it('treats a change to one of several as image-only, and one logo as before', () => {
    expect(fallbackInstruction(withFiles(1, 2), 'make the left logo bigger')).toMatchObject({ kind: 'visual' });
    expect(fallbackInstruction(withFiles(2, 1), 'make the second photo smaller')).toMatchObject({ kind: 'visual' });
    expect(fallbackInstruction(withFiles(1, 1), 'make the logo bigger')).toMatchObject({ kind: 'edit', layoutPatch: { logoScale: 1.18 } });
  });

  it('passes requests about adding, removing or swapping files to the image model as written', () => {
    for (const s of ['add another logo', 'add a second photo', 'remove the Rotary logo', 'swap the two photos', 'reorder the logos']) {
      expect(fallbackInstruction(withFiles(2, 2), s), s).toEqual({ kind: 'visual', restated: s });
    }
    // Appearance requests that mention a photo are still image edits.
    expect(fallbackInstruction(withFiles(2, 2), 'add more contrast to the photos').kind).toBe('visual');
    expect(fallbackInstruction(withFiles(2, 2), 'remove the glare from the photos').kind).toBe('visual');
  });
});

describe('content snapshots', () => {
  it('freeze the list of files and their order', async () => {
    let p = await heritage();
    p = await storeUpload(p, 'logo', 'a.png', await logoPng(5));
    p = await storeUpload(p, 'logo', 'b.png', await logoPng(95));
    const snap = contentSnapshot(p);
    const swapped = { ...p, uploads: { ...p.uploads, logos: [...p.uploads.logos].reverse() } };
    expect(matchesSnapshot(p, snap)).toBe(true);
    expect(matchesSnapshot(swapped, snap)).toBe(false);
  });
});

describe('individual logo placement', () => {
  it('keeps automatic layouts unchanged and fits four independent sides without overlaps', async () => {
    const p = await heritage();
    const base = { spec: p.spec!, wording: p.wording, photos: [{ id: 'photo', aspect: 0.8 }], logos: [{ id: 'old', aspect: 1.5 }] };
    expect(computeLayout({ ...base, logos: [{ ...base.logos[0], position: 'auto' }] }, 'classic')).toEqual(computeLayout(base, 'classic'));
    for (const preset of ['classic', 'portrait', 'statement'] as const) {
      const layout = computeLayout({ ...base, logos: [
        { id: 'top', aspect: 1.5, position: 'top' }, { id: 'bottom', aspect: 2, position: 'bottom' },
        { id: 'left', aspect: 0.55, position: 'left' }, { id: 'right', aspect: 0.7, position: 'right' },
      ] }, preset);
      expectClean(layout);
      expect(layout.logos.map((l) => l.logoId)).toEqual(['top', 'bottom', 'left', 'right']);
      const [top, bottom, left, right] = layout.logos;
      const frame = layout.imageFrames[0].outer;
      expect(top.y + top.h).toBeLessThan(frame.y);
      expect(bottom.y).toBeGreaterThan(frame.y + frame.h);
      expect(left.x + left.w).toBeLessThan(frame.x);
      expect(right.x).toBeGreaterThan(frame.x + frame.w);
    }
  });

  it('saves only the requested logo position and freezes it with older versions', async () => {
    let p = await heritage();
    p = await storeUpload(p, 'logo', 'first.png', await logoPng(20));
    p = await storeUpload(p, 'logo', 'second.png', await logoPng(100));
    saveProject(p);
    const before = contentSnapshot(p);
    const url = `${base}/api/projects/${p.id}/upload/logo/${p.uploads.logos[1].id}/placement`;
    const patch = (position: string) => fetch(url, { method: 'PATCH', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ position }) });
    expect((await patch('left')).status).toBe(200);
    const saved = getProject(p.id)!;
    expect(saved.uploads.logos[0]).toEqual(p.uploads.logos[0]);
    expect(saved.uploads.logos[1].position).toBe('left');
    expect(before.uploads!.logos[1].position).toBeUndefined();
    expect(normalizeUploads(saved.uploads)).toEqual(saved.uploads);
    expect(matchesSnapshot(saved, before)).toBe(false);
    expect((await patch('diagonal')).status).toBe(400);
    expect(getProject(p.id)!.uploads).toEqual(saved.uploads);
    const restored = { ...saved, ...before };
    expect(layoutFor(restored, 'classic')).toEqual(layoutFor(p, 'classic'));
  });

  it('moves numbered logos through Fix and keeps separate moves in a combined request', async () => {
    const p = await heritage();
    p.uploads.logos = [0, 1].map((i) => ({ id: `l${i}`, file: `l${i}.png`, name: `Mark ${i}.png`, width: 200, height: 300, vectorSource: false }));
    expect(fallbackInstruction(p, 'move the second logo to the right')).toMatchObject({ placement: { logos: [{ logoId: 'l1', position: 'right' }] } });
    expect(fallbackInstruction(p, 'move logo 1 to the left and move logo 2 to the bottom')).toMatchObject({ placement: { logos: [{ logoId: 'l0', position: 'left' }, { logoId: 'l1', position: 'bottom' }] } });
  });
});

describe('UV print fidelity', () => {
  it('preserves white and color regions; monochrome preserves the same artwork in gray', async () => {
    const original = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="400" height="400" fill="#e5e5e5"/><rect x="30" y="30" width="160" height="160" fill="#f9a51a"/><rect x="210" y="30" width="160" height="160" fill="white"/><rect x="30" y="250" width="340" height="10" fill="white"/><text x="200" y="350" font-size="65" text-anchor="middle" fill="white">CAMP</text></svg>')).png().toBuffer();
    for (const mode of ['uv-print', 'uv-print-mono']) {
      const { data, info } = await sharp(await logoForDrawing(original, mode)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      const pixel = (x: number, y: number) => {
        const px = Math.round((x / 400 + 0.08) / 1.16 * info.width);
        const py = Math.round((y / 400 + 0.08) / 1.16 * info.height);
        return [...data.subarray((py * info.width + px) * 3, (py * info.width + px) * 3 + 3)];
      };
      expect(pixel(280, 100)).toEqual([255, 255, 255]);
      expect(pixel(200, 255)).toEqual([255, 255, 255]);
      if (mode === 'uv-print') expect(pixel(100, 100)).toEqual([249, 165, 26]);
      else expect(new Set(pixel(100, 100)).size).toBe(1);
    }
  });
});
