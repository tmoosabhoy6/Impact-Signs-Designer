import { describe, expect, it, vi } from 'vitest';
import { withImageCompatibility, friendlyError } from '../server/ai/images';
import type { ImageEditParamsBase } from 'openai/resources/images';

const params: ImageEditParamsBase = { image: [], prompt: 'plaque', quality: 'xhigh', size: '1536x768', stream: true, partial_images: 2, background: 'opaque', output_format: 'png' };

describe('image parameter compatibility', () => {
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
