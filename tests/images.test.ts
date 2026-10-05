import { describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { config } from '../server/config';
import { canvasSize, imageLongEdgeForQuality, MAX_IMAGE_EDGE, MAX_IMAGE_PIXELS, imageAdapter, openai, withImageCompatibility, friendlyError } from '../server/ai/images';
import type { ImageEditParamsBase } from 'openai/resources/images';

const params: ImageEditParamsBase = { image: [], prompt: 'plaque', quality: 'xhigh', size: '1536x768', stream: true, partial_images: 2, background: 'opaque', output_format: 'png' };

describe('image parameter compatibility', () => {
  it('sends Max unchanged, including after a streaming compatibility retry', async () => {
    const send = vi.fn().mockRejectedValueOnce({ status: 400, param: 'stream', message: 'Unsupported stream' }).mockResolvedValue('image');
    await expect(withImageCompatibility({ ...params, quality: 'max' }, send)).resolves.toBe('image');
    expect(send.mock.calls.map(([p]) => p.quality)).toEqual(['max', 'max']);
  });
  it('reports rejected Max quality instead of downgrading it', async () => {
    const send = vi.fn().mockRejectedValue({ status: 400, param: 'quality', message: 'Unsupported quality' });
    await expect(withImageCompatibility({ ...params, quality: 'max' }, send)).rejects.toThrow('could not use Max quality');
    expect(send).toHaveBeenCalledTimes(1);
  });
  it.each([
    ['quality', 'high'], ['size', '1536x1024'], ['background', undefined],
    ['partial_images', undefined], ['output_format', undefined], ['stream', undefined],
  ] as const)('retries once when %s is rejected', async (param, expected) => {
    const send = vi.fn().mockRejectedValueOnce({ status: 400, error: { param, message: `Unsupported parameter: ${param}` } }).mockResolvedValue('image');
    await expect(withImageCompatibility(params, send)).resolves.toBe('image');
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1][0][param]).toBe(expected);
    if (param === 'stream') expect(send.mock.calls[1][0].partial_images).toBeUndefined();
    expect(params.quality).toBe('xhigh');
  });
  it('stops after the one compatibility retry', async () => {
    const send = vi.fn().mockRejectedValue({ status: 400, message: 'Invalid quality', param: 'quality' });
    await expect(withImageCompatibility(params, send)).rejects.toMatchObject({ status: 400 });
    expect(send).toHaveBeenCalledTimes(2);
  });
  it.each([401, 403, 429, 500])('does not retry status %s', async (status) => {
    const send = vi.fn().mockRejectedValue({ status, message: 'Unsupported quality' });
    await expect(withImageCompatibility(params, send)).rejects.toMatchObject({ status });
    expect(send).toHaveBeenCalledTimes(1);
  });
  it('finds parameters in messages without a param field and keeps orientation', async () => {
    const send = vi.fn().mockRejectedValueOnce({ status: 400, message: "Invalid value for 'size'" }).mockResolvedValue('image');
    await withImageCompatibility({ ...params, size: '768x1536' }, send);
    expect(send.mock.calls[1][0].size).toBe('1024x1536');
  });
  it('handles nested network errors and permission failures', () => {
    expect(friendlyError({ cause: { code: 'ENOTFOUND' } })).toContain('network problem');
    expect(friendlyError({ status: 403, error: { message: 'denied' } })).toContain('permission');
  });
});


describe('real Images API routing, with the SDK request stubbed offline', () => {
  it('calls images.edit with the source Sunburst model and Max unchanged', async () => {
    const old = { mockAI: config.mockAI, openaiKey: config.openaiKey };
    Object.assign(config, { mockAI: false, openaiKey: 'offline-placeholder' });
    const png = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#fff' } }).png().toBuffer();
    const edit = vi.spyOn(openai().images, 'edit').mockImplementation(() => Promise.resolve({ data: [{ b64_json: png.toString('base64') }] }) as never);
    try {
      const model = 'gpt-image-2.5-sunburst-2026-09-08';
      await imageAdapter().run({ model, quality: 'max', preserveQuality: true, size: '2560x1440', preserveSize: true, prompt: 'restore the white logo detail', images: [{ file: png, name: 'current.png', mime: 'image/png', role: 'current photograph' }] });
      expect(edit).toHaveBeenCalledTimes(1);
      expect(edit.mock.calls[0][0]).toMatchObject({ model, quality: 'max', size: '2560x1440', prompt: 'restore the white logo detail' });
    } finally { edit.mockRestore(); Object.assign(config, old); }
  });
  it('does not downgrade an inherited Extra high setting', async () => {
    const send = vi.fn().mockRejectedValue({ status: 400, param: 'quality', message: 'Unsupported quality' });
    await expect(withImageCompatibility(params, send, { preserveQuality: true })).rejects.toThrow('could not use xhigh quality');
    expect(send).toHaveBeenCalledTimes(1);
  });
});


describe('fixed 2K canvases', () => {
  it.each([
    [16, 9, 2560, 1440], [9, 16, 1440, 2560], [1, 1, 2560, 2560],
    [18, 12, 2560, 1712], [12, 18, 1712, 2560], [3, 1, 2560, 864],
  ])('sizes %s x %s to %s x %s within every API limit', (w, h, ew, eh) => {
    const size = canvasSize(w, h, MAX_IMAGE_EDGE);
    expect(size).toMatchObject({ w: ew, h: eh });
    expect(size.w * size.h).toBeLessThanOrEqual(MAX_IMAGE_PIXELS);
    expect(size.w % 16).toBe(0);
    expect(size.h % 16).toBe(0);
    expect(Math.max(size.w, size.h)).toBeLessThanOrEqual(MAX_IMAGE_EDGE);
  });
  it('never silently downgrades a rejected 2K size', async () => {
    const send = vi.fn().mockRejectedValue({ status: 400, param: 'size', message: 'Unsupported size' });
    await expect(withImageCompatibility({ ...params, quality: 'max', size: '2560x1440' }, send, { preserveSize: true })).rejects.toThrow('not reduced to a smaller size');
    expect(send).toHaveBeenCalledTimes(1);
  });
});


describe('fixed resolution regardless of legacy quality', () => {
  it.each([['medium', 2560, 1440], ['high', 2560, 1440], ['xhigh', 2560, 1440], ['max', 2560, 1440]])('requests %s at its resolution for either orientation', (quality, w, h) => {
    const edge = imageLongEdgeForQuality(quality as string);
    expect(canvasSize(16, 9, edge)).toMatchObject({ w, h });
    expect(canvasSize(9, 16, edge)).toMatchObject({ w: h, h: w });
  });
  it.each([1/3, 1/2, 1, 2, 3])('keeps the fixed canvas at ratio %s within supported pixel limits', (ratio) => {
    const { w, h } = canvasSize(ratio, 1, imageLongEdgeForQuality('medium'));
    expect(w * h).toBeGreaterThanOrEqual(655360);
    expect(w * h).toBeLessThanOrEqual(MAX_IMAGE_PIXELS);
    expect(w % 16).toBe(0);
    expect(h % 16).toBe(0);
    expect(w / h).toBeGreaterThanOrEqual(1/3);
    expect(w / h).toBeLessThanOrEqual(3);
  });
});
