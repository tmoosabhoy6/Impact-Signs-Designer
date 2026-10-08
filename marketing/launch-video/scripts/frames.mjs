// Renders stills at the given seconds (for review) and writes the sound-effect cue list.
// Usage: node scripts/frames.mjs [outDir] [seconds...]
import { bundle } from '@remotion/bundler';
import { renderStill, selectComposition } from '@remotion/renderer';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const [outDir = path.join(root, 'out/frames'), ...secs] = process.argv.slice(2);
const browserExecutable = process.env.REMOTION_BROWSER ?? '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
fs.mkdirSync(outDir, { recursive: true });

const serveUrl = await bundle({ entryPoint: path.join(root, 'src/index.js'), publicDir: path.join(root, 'public') });
const composition = await selectComposition({ serveUrl, id: 'Launch', browserExecutable });
let cues = null;
const onBrowserLog = (log) => {
  if (log.text.startsWith('CUES:')) cues = log.text.slice(5);
};
const list = secs.length ? secs.map(Number) : [0];
for (const s of list) {
  const frame = Math.min(composition.durationInFrames - 1, Math.round(s * composition.fps));
  await renderStill({ serveUrl, composition, frame, output: path.join(outDir, `f${String(frame).padStart(5, '0')}.png`), browserExecutable, onBrowserLog, chromiumOptions: { gl: 'swangle' } });
  console.log('frame', frame);
}
if (cues) {
  fs.writeFileSync(path.join(root, 'scripts/cues.json'), JSON.stringify(JSON.parse(cues), null, 1));
  console.log('cues written:', JSON.parse(cues).length);
} else console.log('no cue log seen');
