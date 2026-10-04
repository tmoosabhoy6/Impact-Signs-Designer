// Converts a logo image into one-ink vector paths for the production file.
// A cast plaque logo is a single raised shape, so the logo is reduced to dark (raised)
// and light (recessed) areas and traced into smooth vector outlines.
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
}

/**
 * @param threshold pixels darker than this (0-255 luminance) become raised metal. Anything that is
 * not close to white counts, so colored logo parts are kept, not lost.
 */
export async function traceLogo(png: Buffer, maxEdge = 1200, threshold = 215): Promise<TracedLogo> {
  const { data, info } = await sharp(png)
    .flatten({ background: '#ffffff' })
    .resize({ width: maxEdge, height: maxEdge, fit: 'inside', withoutEnlargement: false })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  // Black = raised, white = background, as RGBA pixels for the tracer.
  const rgba = new Uint8ClampedArray(info.width * info.height * 4);
  for (let i = 0, n = info.width * info.height; i < n; i++) {
    const o = i * info.channels;
    const lum = 0.2126 * data[o] + 0.7152 * data[o + 1] + 0.0722 * data[o + 2];
    const v = lum < threshold ? 0 : 255;
    rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = v;
    rgba[i * 4 + 3] = 255;
  }
  const svg = ImageTracer.imagedataToSVG(
    { width: info.width, height: info.height, data: rgba },
    {
      numberofcolors: 2,
      colorsampling: 0,
      pal: [
        { r: 0, g: 0, b: 0, a: 255 },
        { r: 255, g: 255, b: 255, a: 255 },
      ],
      ltres: 0.5,
      qtres: 0.5,
      pathomit: 6,
      roundcoords: 2,
      linefilter: true,
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
  return { width: info.width, height: info.height, paths };
}
