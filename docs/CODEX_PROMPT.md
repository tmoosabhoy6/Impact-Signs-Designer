# Prompt for ChatGPT Codex

Copy everything inside the box below into Codex, with this repository connected (branch `claude/blissful-mccarthy-63trmd`).

````text
You are a senior full-stack engineer continuing work on "Plaque Proof Studio", Impact Signs' internal tool for cast bronze and aluminum plaques. The app is already built, tested and documented. Your job is to finish the live OpenAI image work described below, to the same standard, WITHOUT undoing or "simplifying" anything that exists.

BEFORE YOU WRITE ANY CODE
1. Read AGENTS.md (rules and commands), README.md and docs/DECISIONS.md.
2. Read these files fully:
   - server/ai/images.ts, server/ai/pipeline.ts, server/ai/prompts.ts, server/ai/spellcheck.ts
   - server/prompts/*.md
   - server/routes.ts (the /generate, /concepts/:id/regenerate and /concepts/:id/fix routes)
   - client/src/components/ConceptStage.tsx
   - shared/types.ts, data/catalog.json, server/layout/engine.ts (just the inputs), tests/golden.test.ts
3. Run: npm ci && npm test && npm run typecheck && npm run build. All must pass before you start. They must still pass when you finish.
4. Then write a short plan, and follow it.

HOW THE APP WORKS (do not change this architecture)
- The order is parsed into a spec using only options in data/catalog.json.
- server/layout/engine.ts computes exact plaque geometry.
- server/render/flat.ts draws that geometry as a flat picture ("Reference 1").
- server/ai/pipeline.ts sends Reference 1 plus real swatch photos from assets/ and the customer's photo/logo to OpenAI images.edit. The model is the env OPENAI_IMAGE_MODEL, default gpt-image-2.5-sunburst-2026-09-08.
- The prompt is HOUSE RULES (server/prompts/house_rules.md) + JOB (server/prompts/concept.md, filled from the spec).
- The result is cropped to the plaque's proportions, spell-checked (server/ai/spellcheck.ts) and saved as a new version.
- Proofs (server/pdf/proofs/*) and the vector production PDF (server/pdf/production.ts) are built from the SAME spec and layout. That is why any change to the plaque's content must go through the spec/wording, never only through the image.

NON-NEGOTIABLES
- The catalog is the only source of options.
- Customer wording is verbatim.
- Never overwrite records; every edit is a new version with parentId.
- OPENAI_API_KEY only ever comes from the environment: never in code, git, logs, test fixtures or the browser.
- Tests and `npm run samples` must still run offline with MOCK_AI=1.
- Do not touch the measured proof geometry (server/pdf/proofs/*), server/templates/*, the layout constants, references/ or the existing tests. The only exception is adding new tests.
- UI text is plain English for designers.

=====================================================================
PART A — Make live OpenAI generation work and prove it
=====================================================================
1. Check that OPENAI_API_KEY is present in the environment and that https://api.openai.com is reachable.
   - If either is missing, STOP Part A, say exactly what is missing, and continue with Parts B–D (they must work offline).
2. Run the server live (MOCK_AI=0, APP_PASSWORD=test) and call:
   - POST /api/health/test-image
   - GET /api/health/details?live=1
3. Make the real adapter in server/ai/images.ts robust:
   - If the API rejects a parameter (400 "unknown/unsupported parameter" or invalid value for partial_images, stream, background, quality, output_format or size), retry ONCE without it, or with the nearest valid value. Rules for the size and quality values:
     - size: keep multiples of 16 and the plaque ratio, clamped to 1:3–3:1; fall back to 1024x1536, 1536x1024 or 1024x1024 by orientation.
     - quality: fall back from xhigh/max to high.
   - Log which parameter was dropped (no secrets).
   - Keep streaming partial previews when supported.
   - Extend friendlyError() for any new error shapes you see.
4. Using "Start from an example" via the API (POST /api/examples/:id), generate real concepts and finish each job to a proof and a production PDF. Use these three jobs:
   - 32241-edwin-feulner (Standard proof)
   - 32885-raccoon-river (Description sheet)
   - 32249-structure-of-merit (Order/version proof)
5. Save JPEG previews (max 1200 px) of the concepts and the proof first pages to output/live/. Also add a short output/live/README.md covering, for each image: model, quality, size, seconds, cost, prompt version, spell-check result.
6. Judge the images honestly against the house rules:
   - text exact
   - layout matches Reference 1
   - plaque fills the frame
   - finish/paint/texture match the swatches
   - the image treatment is right (photo relief vs UV print)

   Write the findings in docs/DECISIONS.md under "Live OpenAI results".

=====================================================================
PART B — The image model's "system prompt"
=====================================================================
The Images API has no separate system-prompt field. HOUSE RULES text is prepended to every request and acts as the system prompt. Do all of the following:

1. Replace server/prompts/house_rules.md with EXACTLY the text between the markers below. You may later refine wording based on Part A evidence, recording each change and its reason in docs/DECISIONS.md.

<<<HOUSE_RULES
SYSTEM: IMPACT SIGNS PLAQUE RENDERER
You are the rendering engine inside Impact Signs' Plaque Proof Studio. Every image you produce goes onto a customer proof that is signed off before a U.S. foundry makes the plaque. It must be a faithful product photograph of exactly the plaque that will be made, not an artistic interpretation.

1. OUTPUT
- One plaque, photographed perfectly straight-on: orthographic, no perspective, tilt, rotation or keystone.
- The plaque fills the ENTIRE image edge to edge. The image border IS the plaque's outer edge. No wall, background, table, shadow, margin or frame outside it.
- Even, soft studio light from the upper left at about 45 degrees. Neutral white balance. No colored light, glare hot-spots, lens effects, vignette or watermark.

2. LAYOUT: REFERENCE 1 IS THE BLUEPRINT
- Reference 1 is the exact flat drawing of this plaque at the same proportions as your output.
- Keep every element at exactly its drawn position, size and alignment: border bands, inner lines, image frame, logo, screw heads, rules and every line of text.
- Do not move, resize, re-space, re-wrap, re-center, add or remove anything. When in doubt, copy Reference 1.

3. TEXT: ZERO TOLERANCE
- Reproduce every line exactly as listed under TEXT and drawn in Reference 1: same words, spelling, capitalization, punctuation, quote marks, numerals and line breaks.
- Use the typeface shown in Reference 1, including italic, bold and small capitals where marked.
- Never add text of any kind (captions, signatures, foundry marks, dates, serial numbers, placeholders). Never correct, translate, abbreviate or "improve" the wording.
- Letters are raised metal with crisp, even strokes. Small text stays sharp and legible.

4. MATERIAL AND CONSTRUCTION
- RAISED = solid metal in the specified finish: border bands, lettering, image frame, rules, logo and screw heads.
  - Their flat top faces show the finish (brushed grain, polish, oxidation or patina).
  - Edges facing the light get a thin highlight; their vertical sides are slightly darker.
- RECESSED = the background field, filled with the specified baked paint color and carrying the specified texture (leatherette, stipple, pebble or smooth).
  - Paint sits only in the recesses. Raised faces are clean metal.
- Cast plaques: raised elements stand about 1/32 to 1/16 inch proud, with very slightly softened cast edges. Reverse-etched plaques are flatter, with razor-crisp edges.
- Match the supplied swatches for metal color and sheen, paint color and texture. The swatches override your assumptions.

5. IMAGES AND LOGOS
- Follow IMAGE TREATMENT exactly (photo relief, bas relief, etched photo or full-color UV print).
- Keep the customer photo's likeness, expression, pose, clothing and crop. Never beautify, age, re-pose or replace a person.
- The image-type example shows only the treatment style. Never copy its subject.
- Reproduce logos exactly in shape and proportion as raised metal. Never redraw, re-letter, simplify or invent a logo.

6. NEVER
- No hands, people, props, plants, rooms, reflections of surroundings, extra hardware (unless MOUNTING asks), stickers, dirt, damage or wear beyond the specified patina.
- No illustration, painting, cartoon, CGI or 3D-render look, HDR halos or over-sharpening. It must look like a real professional product photograph.
HOUSE_RULES>>>

2. Replace server/prompts/fix.md with the text below. Keep the {{placeholders}}; buildFixPrompt fills them.

<<<FIX
EDIT MODE. Image 1 is the current photograph of this plaque. Image 2 is its exact flat layout drawing.
Change ONLY this: {{instruction}}
Everything not named in that change must stay exactly the same:
- the framing (the plaque still fills the image edge to edge), camera angle and lighting
- every word and letter, the finish, paint, texture, border, image and logo
- every position and size

If the change cannot be made without touching something else, make the smallest possible change.
{{layoutNote}}
The text on the plaque must read exactly:
{{text}}
FIX>>>

3. Change buildFixPrompt in server/ai/prompts.ts so fix requests are also prefixed with house_rules.md, the same as concept requests.
4. Keep everything else working as it does now:
   - promptVersion() hashes all prompt files, and every ConceptRecord stores the exact prompt and promptVersion.
   - Admin → Image prompts shows the files read-only.
   - The prompt list in server/ai/prompts.ts (PROMPT_FILES) includes any new file you add.

=====================================================================
PART C — Make the edit ("Fix") box a smart, safe link to the image API
=====================================================================
Today, the Fix input under each concept (client/src/components/ConceptStage.tsx) calls POST /api/concepts/:id/fix. That calls runConcept with kind 'fix', which sends images.edit [current image, layout drawing] + fix prompt. Keep that path, and add an instruction planner in front of it.

1. Create server/ai/instruct.ts exporting:
   planInstruction(project, concept, instruction) -> Plan
   Plan is a zod-validated union:
   - { kind: 'visual', restated }
     The look of the image only, e.g. "more contrast in the photo", "make the leatherette texture finer", "the border looks too thick in this image", "fix the spelling of Feulner".
   - { kind: 'spec', restated, specPatch }
     Something that exists in data/catalog.json, e.g. "make the border double line", "use verde patina", "black paint", "pebble texture", "Garamond", "screws through the face", "make it 18 x 24".
     specPatch may only contain catalog ids (validate every value) and sizes within catalog.sizeLimits.
   - { kind: 'wording', restated, wordingEdits }
     A change to the customer text, e.g. "change Founder to Chairman", "add a line 'Est. 1989' at the bottom", "make the name line italic/bold/small caps/larger".
     wordingEdits are exact operations on Wording blocks: replace text, insert block, delete block, set role, set style. Never paraphrase customer text; only apply what was literally asked.
   - { kind: 'refuse', reason, nearestOptions[] }
     Anything that is not in the catalog (e.g. "purple anodized finish", "gold leaf"), physically impossible, or unrelated to the plaque.

   How it decides:
   - Use the OpenAI Responses API with model OPENAI_VISION_MODEL (default gpt-5.4-mini). Send: the catalog option ids and labels, the current spec, the wording blocks, and the instruction. Ask for strict JSON (json_schema or json_object), then validate with zod. On invalid output, retry once, then fall back.
   - The deterministic keyword fallback is used when MOCK_AI=1 or there is no key. It handles at least the five test cases below, reusing matchOption-style alias matching from server/parse/spec.ts and the catalog aliases.

2. In server/routes.ts, POST /api/concepts/:id/fix:
   - plan = await planInstruction(...)
   - refuse → respond 422 { error: reason, nearestOptions }. No image call, no cost.
   - visual → the existing kind 'fix' path. Pass plan.restated as the note. Quality: the request's, or 'high'.
   - spec → apply specPatch to the project (save it; keep the previous spec on the new ConceptRecord, e.g. a new field 'previous': { spec?, wording? }, so it can be undone). Then run a NEW concept for the same preset with kind 'regenerate', parentId = this concept, and note = restated. This uses the full concept prompt and the new layout, so the image, proof and vector PDF agree.
   - wording → apply wordingEdits the same way, then regenerate as for spec.
   - Stream exactly like today (SSE: start / concept / partial / end), and send an extra event { type: 'plan', plan } first so the UI can show it.

3. Add POST /api/concepts/:id/undo. It restores 'previous' spec/wording onto the project. It does not delete any image; the earlier version stays selectable.

4. In ConceptStage.tsx:
   - Show the plan as a one-line note under the input ("Interpreted as: change border to Double Line Border (updates the proof and vector file)" / "Visual edit to this image" / refusal message with the nearest options as clickable chips that fill the input).
   - Label version chips by kind (v3 · edit, v4 · spec, v5 · wording).
   - Add an Undo button on versions created by spec/wording plans.
   - Keep the existing look (dark stage, Barlow type, navy buttons) and accessibility (labels, focus rings).

5. The spell check must still run after every edit (runConcept already does this; keep it).

6. Tests (tests/instruct.test.ts, offline, fallback planner):
   - "make the border double line" → spec { border: 'double-line' }
   - "correct the spelling of Feulner" → visual
   - "change Founder to Chairman" on the Heritage example → wording, and the new text is exactly "Edwin J. Feulner Jr., Chairman"
   - "use a purple anodized finish" → refuse, and nearestOptions are catalog finishes
   - "make the name line italic" → wording with style.italic on the headline block

   Also add one route-level test that a refused instruction returns 422 and creates no ConceptRecord.

=====================================================================
PART D — Running and demoing
=====================================================================
1. Add an npm script "demo": builds the client, then starts the server with MOCK_AI=1. On a fresh DATA_DIR the server already seeds the Heritage example; all 11 examples are under Jobs → "Start from an example".
2. In README.md, add a section "Run it on your computer or in Codex", written for a non-developer:
   - npm install, copy .env.example to .env and fill in OPENAI_API_KEY and APP_PASSWORD
   - npm run build && npm start → open http://localhost:8080
   - npm run demo for no-cost demo mode
   - in Codex cloud: OPENAI_API_KEY must be set as an environment variable (not a setup-only secret), and agent internet access must allow api.openai.com
3. Start the server (MOCK_AI=1 if there is no key, otherwise live). Run `BASE=http://localhost:8080 PW=test node scripts/screens.mjs` and look at the screenshots, including the new Fix flow (add a step to scripts/screens.mjs that types "make the border double line" into a Fix box and waits for the plan note).

FINISH
- npm test, npm run typecheck, npm run build and npm run samples all pass.
- Commit in small logical commits with clear messages, and push to the same branch. Never commit .env, data-store/ or node_modules/.
- Update docs/DECISIONS.md (what you changed, what you verified live, what is still unverified) and README.md.
- End with a plain-English summary for the owner (not a developer):
  - what now works
  - what you saw in the live images (with the output/live paths)
  - what it costs per concept
  - anything that still needs the owner's action
````

## Setting up Codex before you paste the prompt

1. Use a **new** OpenAI API key (the one shared in chat should be revoked). Never paste a key into a prompt.
2. In Codex → your environment → settings:
   - **Environment variables:**
     - Add `OPENAI_API_KEY` = your key, as an environment variable rather than a setup-only "secret", so the agent can use it while it works.
     - Optionally also add `APP_PASSWORD` = test.
   - **Agent internet access:** turn it on and allow at least `api.openai.com` (plus the npm registry, so packages install).
   - **Setup script:** `npm ci` (and, if the image allows it, `apt-get update && apt-get install -y poppler-utils` for PDF previews).

   Codex's menus get renamed from time to time. If a name differs, what matters is that the key and internet access are available *while the agent runs*, not only during setup.
3. Codex in the cloud can run the app and take screenshots, but it cannot give you a link to click around in. To use the app yourself, either:
   - run it on your computer (Codex app or CLI, or just a terminal): `npm install`, copy `.env.example` to `.env` and fill in the key and a password, then `npm run build && npm start` and open http://localhost:8080; or
   - deploy to Render as described in the README. Every push then updates your link.
