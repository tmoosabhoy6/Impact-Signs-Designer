# AGENTS.md — working on Plaque Proof Studio

Read this before changing anything. Then read `README.md` and `docs/DECISIONS.md`.

## What this is
Impact Signs' internal tool for cast bronze (and aluminum) plaques. A designer enters an order. The app then:
1. Generates 2 concept images (Classic and Statement) with OpenAI's image model.
2. Builds the customer **proof PDF** (the Description sheet; the two other measured templates stay for the samples and tests).
3. Builds the one-ink **vector production PDF**.

The users are designers, not developers. All UI text and error messages are plain English.

## Commands
```bash
npm install                 # once
npm test                    # full offline suite; use only when broad regression coverage is warranted
MOCK_AI=1 npx vitest run tests/<affected>.test.ts  # run relevant test files; use -t to focus on affected behavior
npm run typecheck           # tsc --noEmit
npm run build               # builds the web app into dist/
npm start                   # serves app + API on http://localhost:8080 (reads .env)
npm run dev                 # web on :5173 + API on :8080 with reload
MOCK_AI=1 npm start         # demo mode: simulated images, no OpenAI calls, no cost
npm run samples             # rebuilds every reference job in its proof style, next to the real proof, in output/samples/
node scripts/screens.mjs    # drives the whole app in Chromium, screenshots into docs/screens/ (needs a running server; BASE=, PW=)
python3 scripts/build_proof_template.py   # re-cuts fixed proof parts from the real PDFs (needs pymupdf)
```
Tests and samples must run offline (`MOCK_AI=1`, no network).

## Non-negotiables (do not break these)
1. **`data/catalog.json` is the single source of truth.** It lists every finish, color, texture, border, font, image type, mounting, process and proof style. The UI, parser, prompts and PDFs all read it. Never invent an option in code.
2. **One layout engine drives everything.** `server/layout/engine.ts` computes exact geometry. That geometry feeds:
   - the flat drawing sent to the image model as Reference 1 (`server/render/flat.ts`);
   - the proof;
   - the vector production file.

   Any change to a plaque's content must go through the spec/wording → layout, or the image, the proof and the vector file will disagree.
3. **Customer wording is reproduced character for character.** Never autocorrect, change quotes, or "improve" it.
4. **Nothing is overwritten.** Every image, fix, proof and production file is a new record (`server/db.ts`) with a parent id.
5. **Secrets only in environment variables** (`OPENAI_API_KEY`, `APP_PASSWORD`, `SESSION_SECRET`, `SUPABASE_URL`/`SUPABASE_PUBLISHABLE_KEY`, and account passwords). Never put them in code, git (this repository is public), logs, test fixtures or the browser. `.env` is git-ignored.
6. **The measured proof templates stay exact.** `server/pdf/proofs/{standard,description,etched}.ts` use positions and sizes measured from the real Impact Signs proofs in `references/`. The fixed parts are lifted as vector art from those PDFs (`server/templates/`). Do not "tidy" these numbers. If you change one, re-measure and prove it with `npm run samples`. The app makes only the Description sheet (without the real proofs' Visual Scale figure); the plaque box and the header are the measured ones.
7. **The production PDF is one ink:** `#231F20` means raised metal and white means the recessed field. All text is outlined and the file contains no images or fonts. `server/pdf/preflight.ts` must pass. Letters are at least ¼" tall (`MIN_LETTER_IN` in the layout engine; digits and punctuation exempt): the floor lives in the layout so the image, proof and vector file agree. Only when the wording cannot sit on the plate at ¼" does `computeCore` set it smaller to fit, with a warning: text never runs off the plaque or overlaps.
8. **Static icons are never AI-generated.** Proof icons come from `assets/` as named in the catalog.
9. **Brand look:**
   - colors: navy `#2E3092`, red `#ED1C24`, ink `#231F20`, bronze `#C49A6C` for plaques;
   - type: Barlow / Barlow Semi Condensed, with IBM Plex Mono for numbers;
   - no gradients-as-decoration, no emoji, no sparkle icons.
10. **Each login sees only its own work.** Every route that reads a job, concept, output, upscale or vector file goes through `loadProject` / `loadConcept` / `loadOutput` / `loadUpscale` / `loadVector`, which check `owns()` in `server/auth.ts`. A new route must do the same.

## Where things are
| Area | Files |
|---|---|
| Order parsing | `server/parse/spec.ts`, `server/parse/wording.ts` |
| Layout + fonts | `server/layout/engine.ts` (photo frames and logos are groups: `arrangePictures`), `server/text/fonts.ts` (glyphs placed manually, no OpenType shaping) |
| Customer files | `server/uploads.ts` (prepare / add / remove / reorder), `shared/uploads.ts` (limits, upgrade of single-file jobs). Photos, logos and sketches are lists; each logo has an optional catalog `logoPositions` position frozen in snapshots. Every route reads them through `loadProject`. |
| Image model | `server/ai/images.ts` (OpenAI adapter + mock), `server/ai/pipeline.ts` (`runConcept`, `buildReferences`, `layoutFor`), `server/ai/prompts.ts`, prompt text in `server/prompts/*.md` |
| Fix instructions | `server/ai/instruct.ts`: the planner model (`OPENAI_PLANNER_MODEL`) returns one checked plan (catalog `specPatch`, literal `wordingEdits`, per-column `layoutPatch`, `placement`, image-only `imageEdit`); offline reader `fallbackInstruction` splits multi-part requests. **Nothing is refused:** what the order cannot hold becomes an `imageEdit` in the designer's words (`asImage`). Layout adjustments live in `Project.layoutAdjust[preset]` and go through `computeLayout` (`adjust`), so proof and vector agree. Prompts: `fix.md` (image-only), `relayout.md` (new layout drawing). |
| Spell check | `server/ai/spellcheck.ts` (vision model reads the text back; word diff) |
| Proofs | `server/pdf/proofs/index.ts` → `standard.ts`, `description.ts`, `etched.ts`, shared `common.ts`, header text `description-text.ts` |
| Production PDF | `server/pdf/production.ts` (raised-cast logos traced; UV-print logos as a raised plate, `uvPlateRect`), `server/pdf/trace.ts` (the logo reader: background from the picture's edge, Otsu split, plate detection for photos, speck removal; `inkMask` feeds both the trace and the layout drawing), `server/pdf/preflight.ts` |
| API | `server/routes.ts` (generation streams as Server-Sent Events) |
| Sign-in | `server/auth.ts`: Supabase accounts (`app_login` RPC, `supabase/migrations/`), else shared `APP_PASSWORD`, else open (development only); signed cookie; `owns()` for per-login jobs and upscales (`ownerId`). |
| Web app | `client/src/` (React + Tailwind): `pages/Workspace.tsx` (resizable sections, `useWorkspaceWidths`), `components/{OrderPanel,ConceptStage,OutputsPanel}.tsx`, `components/Lightbox.tsx` (zoom/pan viewer), `components/outputs.tsx` (proof / vector requests and the "From Classic v2" tags) |
| AI Upscaler | `server/ai/upscale.ts` (prompt, sizing, fidelity check, tone lock), `server/upscale-routes.ts` (`/api/upscales`), `shared/upscale.ts`, `client/src/pages/Upscaler.tsx`; files in `DATA_DIR/upscales/<id>/`. Independent of jobs and the layout engine. |
| Vectorizer | `server/vectorize.ts` (reads image/SVG/PDF, `inkMask` + `traceMask`, one-ink PDF + SVG), `server/vector-routes.ts` (`/api/vectors`, `loadVector` ownership), `shared/vectorize.ts`, `client/src/pages/Vectorizer.tsx`; files in `DATA_DIR/vectors/<id>/`. |
| Logo treatment | catalog group `logoTreatments` (`raised-cast`, `uv-print-mono`, `uv-print` for color), `PlaqueSpec.logoTreatment`; read by the parser, the planner, `render/flat.ts` (`logoForDrawing`), `ai/prompts.ts`, `proofs/description-text.ts` (`logoPhrase`) and `pdf/production.ts`. |
| Examples | `references/<job>/example.json` + `server/examples.ts` (tests, samples and scripts only; not shown in the app, never seeded) |
| Tests | `tests/golden.test.ts`, `tests/uploads.test.ts` (several photos, logos and sketches), `tests/trace.test.ts` (logo reader, logo treatment), `tests/letters.test.ts` (¼" floor), `tests/vectorize.test.ts` |

## How to work
- Make small, verified steps. Run only the tests and checks relevant to the changed code and the behavior it affects; do not run the entire suite for every task.
  - Select affected test files or cases with `MOCK_AI=1 npx vitest run ...` (use `-t` when appropriate). Cover the changed behavior, important edge cases, failure paths and directly affected integrations robustly.
  - Run `npm run typecheck` when TypeScript types or contracts could be affected, and `npm run build` when application compilation or bundling could be affected.
  - For proof, layout or production changes, render and inspect the affected samples. Run all samples only when the change affects all of them.
  - For UI changes, check the affected flow in mock mode. Run the complete `scripts/screens.mjs` flow only when broader UI coverage is warranted.
  - Expand testing when shared code affects multiple areas, a failure exposes a wider issue, or the user explicitly requests it. Run `npm test` only when the scope warrants the full suite.
  - Documentation-only changes need a content/diff check, not application tests.
- Look at relevant rendered PNGs and screenshots yourself before claiming visual behavior works.
- Add regression tests for new or fixed behavior next to the existing ones; do not remove or weaken unrelated tests.
- Record decisions and anything unverified in `docs/DECISIONS.md`. Keep `README.md` current, written for a non-developer.
- Match the surrounding code style: TypeScript, small functions, comments that explain *why*.
- Never delete reference files, measured constants, or tests to make something pass.
