// Makes a generated image fit the proof exactly: if the model left a background margin
// around the plaque, it is cropped away; the result is then sized to the plaque's exact
// proportions so the dimension brackets on the proof line up with its edges.
import sharp from 'sharp';

function dist(a: number[], b: number[]) {
  return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
}

export async function fitToPlaque(png: Buffer, widthIn: number, heightIn: number, longEdgePx = 2048, allowTrim = true): Promise<{ png: Buffer; trimmed: boolean }> {
  const img = sharp(png).removeAlpha();
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  const px = (x: number, y: number) => {
    const i = (y * info.width + x) * info.channels;
    return [data[i], data[i + 1], data[i + 2]];
  };
  const W = info.width;
  const H = info.height;
  const corners = [px(2, 2), px(W - 3, 2), px(2, H - 3), px(W - 3, H - 3)];
  const similar = corners.every((c) => dist(c, corners[0]) < 14);
  let input = png;
  let trimmed = false;
  if (allowTrim && similar) {
    // Only trim when the corners share one background color and the trim keeps most of the image.
    const t = await sharp(png).trim({ background: { r: corners[0][0], g: corners[0][1], b: corners[0][2] }, threshold: 18 }).toBuffer({ resolveWithObject: true });
    const area = (t.info.width * t.info.height) / (W * H);
    if (area > 0.45 && area < 0.97) {
      input = t.data;
      trimmed = true;
    }
  }
  const ratio = widthIn / heightIn;
  const outW = ratio >= 1 ? longEdgePx : Math.round(longEdgePx * ratio);
  const outH = ratio >= 1 ? Math.round(longEdgePx / ratio) : longEdgePx;
  const out = await sharp(input).resize(outW, outH, { fit: 'fill' }).png().toBuffer();
  return { png: out, trimmed };
}

export async function smallPreview(png: Buffer, width = 480): Promise<Buffer> {
  return sharp(png).resize({ width }).jpeg({ quality: 70 }).toBuffer();
}
