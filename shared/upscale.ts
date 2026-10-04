// Shared by the AI Upscaler page and its server code.
export type UpscaleTarget = '720p' | '1080p';
export const UPSCALE_TARGETS: Record<UpscaleTarget, number> = { '720p': 720, '1080p': 1080 };
export const MAX_LONG_EDGE = 3840;
/** Below this enlargement the image is already usable at the chosen target. */
export const MIN_SCALE = 1.05;

/** Output size: the short edge reaches the target (720 or 1080 px), aspect ratio unchanged. */
export function targetSize(width: number, height: number, target: UpscaleTarget): { width: number; height: number; scale: number } {
  let scale = UPSCALE_TARGETS[target] / Math.min(width, height);
  scale = Math.min(scale, MAX_LONG_EDGE / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale), scale };
}

export interface UpscaleFidelity {
  /** Mean absolute difference from the original at the original's size, 0-255. */
  difference: number;
  /** 0-100, higher is closer to the original. */
  matchPct: number;
  tone: 'ok' | 'amber' | 'red';
  label: string;
}

export interface UpscaleRecord {
  id: string;
  name: string;
  createdAt: string;
  createdBy: string;
  target: UpscaleTarget;
  original: { width: number; height: number };
  output: { width: number; height: number };
  scale: number;
  fidelity: UpscaleFidelity;
  /** True when the original's broad tones and colors were locked onto the AI detail. */
  colorLocked: boolean;
  hasAlpha: boolean;
  model: string;
  costUsd: number;
  ms: number;
}
