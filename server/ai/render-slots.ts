// The shared queue for image-model work (concepts, fixes and upscales).
import { config } from '../config.js';

/**
 * Everyone shares one server process. Each render holds the layout drawing, the reference
 * pictures and the model's full-size result in memory at once, so unlimited parallel renders
 * (three per order, from several designers, plus upscales) run a 512 MB host out of memory and
 * restart it. Renders beyond the limit wait here and start as others finish.
 */
const waiters: (() => void)[] = [];
let running = 0;

/** Waits for a free render slot; call the returned function exactly once to give it back. */
export async function acquireRenderSlot(): Promise<() => void> {
  if (running >= config.maxParallelImages) await new Promise<void>((resolve) => waiters.push(resolve));
  else running++;
  let released = false;
  // A finishing render hands its slot straight to the next waiter (the count stays the same).
  return () => {
    if (released) return;
    released = true;
    const next = waiters.shift();
    if (next) next();
    else running--;
  };
}
