# AGENTS.md — working on Plaque Proof Studio

Read this before changing anything. Then read `README.md` and `docs/DECISIONS.md`.

## What this is
Impact Signs' internal tool for cast bronze (and aluminum) plaques. A designer enters an order. The app then:
1. Generates 3 concept images with OpenAI's image model.
2. Builds the customer **proof PDF** in one of three locked proof styles.
3. Builds the one-ink **vector production PDF**.

The users are designers, not developers. All UI text and error messages are plain English.

## Commands
```bash
npm install                 # once
npm test                    # 33+ golden tests against the real files in references/ — must stay green
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
5. **Secrets only in environment variables** (`OPENAI_API_KEY`, `APP_PASSWORD`, `SESSION_SECRET`). Never put them in code, git, logs, test fixtures or the browser. `.env` is git-ignored.
6. **The measured proof templates stay exact.** `server/pdf/proofs/{standard,description,etched}.ts` use positions and sizes measured from the real Impact Signs proofs in `references/`. The fixed parts are lifted as vector art from those PDFs (`server/templates/`). Do not "tidy" these numbers. If you change one, re-measure and prove it with `npm run samples`.
7. **The production PDF is one ink:** `#231F20` means raised metal and white means the recessed field. All text is outlined and the file contains no images or fonts. `server/pdf/preflight.ts` must pass.
8. **Static icons are never AI-generated.** Proof icons come from `assets/` as named in the catalog.
9. **Brand look:**
   - colors: navy `#2E3092`, red `#ED1C24`, ink `#231F20`, bronze `#C49A6C` for plaques;
   - type: Barlow / Barlow Semi Condensed, with IBM Plex Mono for numbers;
   - no gradients-as-decoration, no emoji, no sparkle icons.

## Where things are
| Area | Files |
|---|---|
| Order parsing | `server/parse/spec.ts`, `server/parse/wording.ts` |
| Layout + fonts | `server/layout/engine.ts`, `server/text/fonts.ts` (glyphs placed manually, no OpenType shaping) |
| Image model | `server/ai/images.ts` (OpenAI adapter + mock), `server/ai/pipeline.ts` (`runConcept`, `buildReferences`, `layoutFor`), `server/ai/prompts.ts`, prompt text in `server/prompts/*.md` |
| Spell check | `server/ai/spellcheck.ts` (vision model reads the text back; word diff) |
| Proofs | `server/pdf/proofs/index.ts` → `standard.ts`, `description.ts`, `etched.ts`, shared `common.ts`, header text `description-text.ts` |
| Production PDF | `server/pdf/production.ts`, `server/pdf/trace.ts` (logo → vector), `server/pdf/preflight.ts` |
| API | `server/routes.ts` (generation streams as Server-Sent Events) |
| Web app | `client/src/` (React + Tailwind): `pages/Workspace.tsx`, `components/{OrderPanel,ConceptStage,OutputsPanel}.tsx` |
| AI Upscaler | `server/ai/upscale.ts` (prompt, sizing, fidelity check, tone lock), `server/upscale-routes.ts` (`/api/upscales`), `shared/upscale.ts`, `client/src/pages/Upscaler.tsx`; files in `DATA_DIR/upscales/<id>/`. Independent of jobs and the layout engine. |
| Examples | `references/<job>/example.json` + `server/examples.ts` (tests, samples and scripts only; not shown in the app, never seeded) |
| Tests | `tests/golden.test.ts` |

## How to work
- Make small, verified steps. Before you finish any task, run all of these:
  - `npm test`
  - `npm run typecheck`
  - `npm run build`
  - `npm run samples`, when proofs, layouts or production files could be affected
  - `scripts/screens.mjs` against `MOCK_AI=1 npm start`, when the UI changed
- Look at the rendered PNGs and screenshots yourself before you claim something works.
- Add tests for new behavior next to the existing ones.
- Record decisions and anything unverified in `docs/DECISIONS.md`. Keep `README.md` current, written for a non-developer.
- Match the surrounding code style: TypeScript, small functions, comments that explain *why*.
- Never delete reference files, measured constants, or tests to make something pass.
