// Converts a logo picture into the one-ink vector paths of the production file, and into the
// mask the layout drawing uses, so both show the same shape.
//
// A cast logo is one raised shape, so the picture is reduced to "ink" (raised metal) and
// "field" (recessed). Designers upload every kind of file: a clean logo on white, a gold logo
// on a dark background, a full-color logo, a photo of an existing plaque. The reader therefore
// decides for each picture which tone is the background (the outer edge of the picture) and
// splits the rest from it with Otsu's threshold, rather than assuming "dark on white". When
// the ink turns out to be one solid rectangle (a plate, card or sticker photographed
// straight-on), the marks inside that plate are the logo.
import { createRequire } from 'node:module';
import sharp from 'sharp';

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ImageTracer = require('imagetracerjs/imagetracer_v1.2.6.js') as {
  imagedataToSVG(img: { width: number; height: number; data: Uint8ClampedArray }, opts: Record<string, unknown>): string;
};

export interface TracedPath {
  d: string;
  dark: boolean;
}

export interface TracedLogo {
  width: number;
  height: number;
  paths: TracedPath[];
  /** The logo was read from the marks on a plate or card (a photo of a finished plaque, for example). */
  fromPlate: boolean;
  /** Share of the traced area that is ink, 0-1. */
  inkFraction: number;
}

/** Luminance (0-255) below which a pixel counts as ink on a plain white background. */
export const LOGO_RAISED_BELOW = 215;

/** Working size of the tracer: small logos are enlarged so curves and letters trace cleanly. */
export const TRACE_EDGE = 1600;

export interface InkMask {
  width: number;
  height: number;
  /** 1 = ink (raised metal), 0 = field, row-major. */
  data: Uint8Array;
  fromPlate: boolean;
  /** Where this mask sits in the analysed picture (the blank margin is cut away). */
  crop: { x: number; y: number; w: number; h: number };
  /** Picture size the crop refers to. */
  source: { width: number; height: number };
}

export interface InkOptions {
  /** 'auto' reads the background tone from the picture's outer edge. */
  background?: 'auto' | 'light' | 'dark';
  /** 0-255: fixed luminance split instead of Otsu's threshold. */
  threshold?: number | null;
  /** Look for marks inside a solid plate (on by default for logos). */
  plate?: boolean;
  /** Smallest ink speck kept, as a share of the picture area (texture noise is smaller). */
  minSpeck?: number;
}

interface Gray {
  width: number;
  height: number;
  data: Uint8Array;
}

interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
}

export async function toGray(png: Buffer, maxEdge = TRACE_EDGE): Promise<Gray> {
  const { data, info } = await sharp(png)
    .flatten({ background: '#ffffff' })
    .resize({ width: maxEdge, height: maxEdge, fit: 'inside', withoutEnlargement: false, kernel: 'lanczos3' })
    .greyscale()
    // Kills film grain and leatherette texture without rounding off letters.
    .median(3)
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8Array(data.buffer, data.byteOffset, data.length) };
}

/** Otsu's threshold over a histogram: the split that best separates two tones. */
export function otsu(hist: Float64Array | number[]): number {
  let total = 0;
  let sumAll = 0;
  for (let i = 0; i < 256; i++) {
    total += hist[i];
    sumAll += i * hist[i];
  }
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let threshold = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sumAll - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) {
      best = between;
      threshold = t;
    }
  }
  return threshold;
}

function histogram(g: Gray, r: Region): Float64Array {
  const hist = new Float64Array(256);
  for (let y = r.y; y < r.y + r.h; y++) {
    const row = y * g.width;
    for (let x = r.x; x < r.x + r.w; x++) hist[g.data[row + x]]++;
  }
  return hist;
}

/** Median luminance of the outer ring of a region: the tone the picture's background has. */
function ringMedian(g: Gray, r: Region): number {
  const t = Math.max(2, Math.round(0.03 * Math.min(r.w, r.h)));
  const hist = new Float64Array(256);
  let n = 0;
  for (let y = r.y; y < r.y + r.h; y++) {
    const inner = y >= r.y + t && y < r.y + r.h - t;
    const row = y * g.width;
    for (let x = r.x; x < r.x + r.w; x++) {
      if (inner && x >= r.x + t && x < r.x + r.w - t) continue;
      hist[g.data[row + x]]++;
      n++;
    }
  }
  let acc = 0;
  for (let i = 0; i < 256; i++) {
    acc += hist[i];
    if (acc >= n / 2) return i;
  }
  return 255;
}

/** Share of a region’s outer ring that is ink. A plate has solid edges all round (about 0.85 in a photo, whose edges are soft); a circle covers about 0.27 of its box’s ring. */
function ringInk(mask: Uint8Array, width: number, r: Region): number {
  const t = Math.max(2, Math.round(0.04 * Math.min(r.w, r.h)));
  let ink = 0;
  let n = 0;
  for (let y = r.y; y < r.y + r.h; y++) {
    const inner = y >= r.y + t && y < r.y + r.h - t;
    for (let x = r.x; x < r.x + r.w; x++) {
      if (inner && x >= r.x + t && x < r.x + r.w - t) continue;
      ink += mask[y * width + x];
      n++;
    }
  }
  return n ? ink / n : 0;
}

/** Spread of the tones around the ink's box: a photo's surroundings vary, a logo file's page does not. */
function outsideSpread(g: Gray, r: Region, box: Region): number {
  let n = 0;
  let sum = 0;
  let sq = 0;
  for (let y = r.y; y < r.y + r.h; y++) {
    const inBoxRow = y >= box.y && y < box.y + box.h;
    const row = y * g.width;
    for (let x = r.x; x < r.x + r.w; x++) {
      if (inBoxRow && x >= box.x && x < box.x + box.w) continue;
      const v = g.data[row + x];
      n++;
      sum += v;
      sq += v * v;
    }
  }
  if (n < 16) return 0;
  const mean = sum / n;
  return Math.sqrt(Math.max(0, sq / n - mean * mean));
}

function inset(r: Region, frac: number): Region {
  const dx = Math.max(2, Math.round(r.w * frac));
  const dy = Math.max(2, Math.round(r.h * frac));
  return { x: r.x + dx, y: r.y + dy, w: Math.max(1, r.w - 2 * dx), h: Math.max(1, r.h - 2 * dy) };
}

interface Split {
  mask: Uint8Array;
  count: number;
  bbox: Region | null;
  darkInk: boolean;
}

/** Splits one region into ink and background. */
function split(g: Gray, r: Region, opts: Required<Pick<InkOptions, 'background' | 'threshold'>>): Split {
  const hist = histogram(g, r);
  let lo = 0;
  while (lo < 255 && !hist[lo]) lo++;
  let hi = 255;
  while (hi > 0 && !hist[hi]) hi--;
  const mask = new Uint8Array(g.width * g.height);
  // A flat picture (one tone) has nothing to trace.
  if (hi - lo < 24) return { mask, count: 0, bbox: null, darkInk: true };
  const t = opts.threshold ?? otsu(hist);
  const bg = opts.background === 'auto' ? ringMedian(g, r) : opts.background === 'dark' ? 0 : 255;
  const darkInk = bg > t;
  let count = 0;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -1;
  let y1 = -1;
  for (let y = r.y; y < r.y + r.h; y++) {
    const row = y * g.width;
    for (let x = r.x; x < r.x + r.w; x++) {
      const v = g.data[row + x];
      const ink = darkInk ? v <= t : v > t;
      if (!ink) continue;
      mask[row + x] = 1;
      count++;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return { mask, count, bbox: count ? { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 } : null, darkInk };
}

/** Drops ink specks smaller than minPixels (texture noise, dust, JPEG grain). */
function despeckle(mask: Uint8Array, width: number, height: number, minPixels: number) {
  if (minPixels <= 1) return;
  const seen = new Uint8Array(mask.length);
  const stack: number[] = [];
  const members: number[] = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    stack.length = 0;
    members.length = 0;
    stack.push(start);
    seen[start] = 1;
    while (stack.length) {
      const i = stack.pop()!;
      members.push(i);
      const x = i % width;
      const y = (i - x) / width;
      if (x > 0 && mask[i - 1] && !seen[i - 1]) { seen[i - 1] = 1; stack.push(i - 1); }
      if (x < width - 1 && mask[i + 1] && !seen[i + 1]) { seen[i + 1] = 1; stack.push(i + 1); }
      if (y > 0 && mask[i - width] && !seen[i - width]) { seen[i - width] = 1; stack.push(i - width); }
      if (y < height - 1 && mask[i + width] && !seen[i + width]) { seen[i + width] = 1; stack.push(i + width); }
    }
    if (members.length < minPixels) for (const i of members) mask[i] = 0;
  }
}

function bboxOf(mask: Uint8Array, width: number, height: number): Region | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      if (!mask[row + x]) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** Reads the ink of a picture already converted to grey. */
export function inkMaskOfGray(g: Gray, options: InkOptions = {}): InkMask {
  const opts = { background: options.background ?? 'auto', threshold: options.threshold ?? null } as const;
  const plateSearch = options.plate ?? true;
  const full: Region = { x: 0, y: 0, w: g.width, h: g.height };
  const minSpeck = Math.max(4, Math.round((options.minSpeck ?? 0.00005) * g.width * g.height));
  let s = split(g, full, opts);
  let fromPlate = false;
  if (s.count && s.bbox) despeckle(s.mask, g.width, g.height, minSpeck);
  // A solid rectangle of ink with the same tone just inside its edge is a plate: the logo is
  // what sits on it. A logo drawn as an outline frame is not (its inside is background), and
  // neither is a solid logo on a plain white or black page: a plate sits in a photo (varied
  // surroundings) or on a colored card, while a logo file's page is flat paper.
  const plain = s.bbox ? outsideSpread(g, full, s.bbox) < 6 && (ringMedian(g, full) >= 215 || ringMedian(g, full) <= 40) : true;
  if (plateSearch && !plain && s.count && s.bbox && Math.min(s.bbox.w, s.bbox.h) >= 40 && s.bbox.w * s.bbox.h >= 0.04 * g.width * g.height && ringInk(s.mask, g.width, s.bbox) > 0.7) {
    // Just inside the plate's own edge (its highlight and shadow): the marks may run close to it.
    const inner = inset(s.bbox, 0.025);
    const innerBg = ringMedian(g, inner);
    const plateTone = s.darkInk ? innerBg <= (opts.threshold ?? otsu(histogram(g, full))) : innerBg > (opts.threshold ?? otsu(histogram(g, full)));
    if (plateTone) {
      const marks = split(g, inner, { background: 'auto', threshold: opts.threshold });
      despeckle(marks.mask, g.width, g.height, minSpeck);
      const area = inner.w * inner.h;
      const count = marks.mask.reduce((a, b) => a + b, 0);
      if (count > 0.005 * area && count < 0.6 * area) {
        s = { ...marks, count };
        fromPlate = true;
      }
    }
  }
  const bbox = bboxOf(s.mask, g.width, g.height);
  if (!bbox) return { width: 1, height: 1, data: new Uint8Array(1), fromPlate, crop: { x: 0, y: 0, w: 1, h: 1 }, source: { width: g.width, height: g.height } };
  // Keep a small margin so the outermost strokes are not cut by the box edge.
  const m = Math.max(2, Math.round(0.02 * Math.max(bbox.w, bbox.h)));
  const crop: Region = {
    x: Math.max(0, bbox.x - m),
    y: Math.max(0, bbox.y - m),
    w: Math.min(g.width, bbox.x + bbox.w + m) - Math.max(0, bbox.x - m),
    h: Math.min(g.height, bbox.y + bbox.h + m) - Math.max(0, bbox.y - m),
  };
  const data = new Uint8Array(crop.w * crop.h);
  for (let y = 0; y < crop.h; y++) data.set(s.mask.subarray((crop.y + y) * g.width + crop.x, (crop.y + y) * g.width + crop.x + crop.w), y * crop.w);
  return { width: crop.w, height: crop.h, data, fromPlate, crop, source: { width: g.width, height: g.height } };
}

/** The ink of a logo picture: 1 = raised metal. */
export async function inkMask(png: Buffer, options: InkOptions = {}, maxEdge = TRACE_EDGE): Promise<InkMask> {
  return inkMaskOfGray(await toGray(png, maxEdge), options);
}

/** Traces an ink mask into smooth vector outlines (paths in mask pixels). */
export function traceMask(mask: InkMask, detail: 'fine' | 'normal' | 'smooth' = 'normal'): TracedPath[] {
  const rgba = new Uint8ClampedArray(mask.width * mask.height * 4);
  for (let i = 0, n = mask.width * mask.height; i < n; i++) {
    const v = mask.data[i] ? 0 : 255;
    rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = v;
    rgba[i * 4 + 3] = 255;
  }
  const res = detail === 'fine' ? 0.35 : detail === 'smooth' ? 1 : 0.5;
  const svg = ImageTracer.imagedataToSVG(
    { width: mask.width, height: mask.height, data: rgba },
    {
      numberofcolors: 2,
      colorsampling: 0,
      pal: [
        { r: 0, g: 0, b: 0, a: 255 },
        { r: 255, g: 255, b: 255, a: 255 },
      ],
      ltres: res,
      qtres: res,
      // Short paths are the corners of small letters: keep them.
      pathomit: 2,
      roundcoords: 2,
      linefilter: true,
      blurradius: 0,
      strokewidth: 0,
      viewbox: true,
      desc: false,
    },
  );
  const paths: TracedPath[] = [];
  for (const m of svg.matchAll(/<path[^>]*fill="rgb\((\d+),(\d+),(\d+)\)"[^>]*d="([^"]+)"/g)) {
    paths.push({ dark: Number(m[1]) < 128, d: m[4] });
  }
  // The tracer writes the d attribute before fill on some versions; handle that order too.
  if (!paths.length) {
    for (const m of svg.matchAll(/<path[^>]*d="([^"]+)"[^>]*fill="rgb\((\d+),(\d+),(\d+)\)"/g)) {
      paths.push({ dark: Number(m[2]) < 128, d: m[1] });
    }
  }
  return paths;
}

/** A logo as one-ink vector outlines for the production file. */
export async function traceLogo(png: Buffer, options: InkOptions = {}): Promise<TracedLogo> {
  const mask = await inkMask(png, options);
  const paths = traceMask(mask);
  const ink = mask.data.reduce((a, b) => a + b, 0);
  return { width: mask.width, height: mask.height, paths, fromPlate: mask.fromPlate, inkFraction: ink / (mask.width * mask.height) };
}

/** The ink mask as an SVG document (black ink on a transparent page), in mask pixels. */
export function maskSvg(mask: InkMask, paths: TracedPath[] = traceMask(mask), fill = '#000000'): string {
  const body = paths.filter((p) => p.dark).map((p) => `<path d="${p.d}" fill="${fill}"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${mask.width}" height="${mask.height}" viewBox="0 0 ${mask.width} ${mask.height}">${body}</svg>`;
}
