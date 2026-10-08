# Plaque Proof Studio launch film

A 100-second motion graphic for marketing Plaque Proof Studio: a walk through one real order
(job 32885, Raccoon River Pet Rescue) from pasted spec to vector production file, then the
rest of the toolkit. 1920 × 1080, 60 fps, with an original synthesized soundtrack.

**Finished files** (in `out/`):
- `plaque-proof-studio-launch.mp4`: with music and sound effects.
- `plaque-proof-studio-launch-no-music.mp4`: silent, for laying your own licensed track under it.

## What it shows

| Time | Scene |
|---|---|
| 0:00 | Hook: "Every bronze plaque starts as an order." Spec sheet, Word file, photo. |
| 0:06 | The old way: files, proofs, emails piling up. "Not anymore." |
| 0:12 | Reveal: impactsigns, Plaque Proof Studio. |
| 0:16 | The workspace, then a guided walk with the camera moving through it: |
| 0:18 | 01 Paste the order, the spec fills itself in (Assumed tag). |
| 0:28 | 02 Customer wording, character for character. |
| 0:32 | 03 Customer files: photos, logos, sketches, exact design. |
| 0:36 | 04 Two concepts (Classic, Statement) from the layout drawing, spell-checked. |
| 0:46 | 05 Fix in plain English: "Make the names larger and use a double line border". |
| 0:54 | 06 Use this one, create proof PDF, zoom into the real proof with callouts. |
| 1:06 | 07 Vector production file: wipe from concept to one-ink vector, preflight ticks. |
| 1:13 | One layout engine, three files that always agree. |
| 1:18 | Toolkit: AI Upscaler, Vectorizer, Proof Merger, spell check, versions, private sign-in. |
| 1:24 | No retyping. No redrawing. No files that disagree. |
| 1:28 | Wall of real Impact Signs plaques. |
| 1:34 | End card: impactsigns.com. |

The proof and vector images are the app's own sample outputs (`output/samples/32885-*`), the
gallery uses the reviewed examples in `references/design-library/`, and the plaque wording is the
customer's, unchanged. The app screens are rebuilt in HTML so they stay sharp when the camera
zooms in; they follow the current interface (two concepts, numbered sections, navy and bronze).

## How it is built

[Remotion](https://www.remotion.dev) renders the film. The stage is plain HTML and CSS
(`src/scene/markup.js`, `public/style.css`) animated by one paused GSAP timeline
(`src/scene/timeline.js`); Remotion seeks that timeline to every frame, so the render is exact
and repeatable. `src/scene/plaque.js` draws the plaque in its three states (layout drawing,
concept, concept after the Fix).

The soundtrack (`scripts/soundtrack.py`) is synthesized from scratch, so there is no licensing
question: a 120 BPM bed whose drops land on the scene cuts, plus clicks, typing, whooshes and
hits placed from `scripts/cues.json`. That file is written by the timeline itself, so sounds
follow the picture when timings change.

## Rebuilding

```bash
cd marketing/launch-video
npm install
npm run studio                 # preview and scrub in the browser
node scripts/frames.mjs out/frames 21 42.5 61   # stills at those seconds; also refreshes scripts/cues.json
npm run soundtrack             # needs Python 3 with numpy and scipy
npm run render                 # out/plaque-proof-studio-launch.mp4
npm run render:silent          # copies the picture without sound to out/plaque-proof-studio-launch-no-music.mp4
```

`remotion.config.ts` points at the Chromium headless shell installed with Playwright; set
`REMOTION_BROWSER` to another headless Chrome if yours lives elsewhere (or remove the line and
let Remotion download its own). Change wording in `src/scene/timeline.js` (captions) or
`src/scene/markup.js`, re-run `frames.mjs` and `soundtrack`, then render.

Cut-downs for social (1:1, 9:16 or a 30-second edit) can be made by adding compositions in
`src/Root.jsx` that reuse the same stage.
