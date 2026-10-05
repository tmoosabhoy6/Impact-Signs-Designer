# Decisions and open items

## Decisions

- **The proof shows the selected AI image**, as requested. Everything else on the proof is exact:
  - Lifted from the real Liquid Mercury proof as untouched vector art: the mounting diagram, footer rule, impactsigns.com wordmark and disclaimer.
  - Drawn by code at the measured positions: the dimension brackets and labels.
  - Pulled from `assets/`: the finish and paint-fill icons.
- **One layout engine drives everything.** The concept image is generated from an exact layout drawing (Reference 1), and the vector production PDF is built from the same layout. The vector file therefore matches the concept you pick without tracing an AI image, which would produce unusable artwork.
- **Classic layout = the real Heritage job.** Measured from `production_32241.ai`:
  - image frame 0.542 × plaque width, at the photo's own aspect ratio
  - body 46.3 pt with a 64.6 pt line pitch
  - headline 56.3 pt, subhead 50.1 pt
  - ¼″ border
  - the whole stack centered in the field

  The automated test holds it within 2 pt of the real file.
- **Three layouts:**
  - **Classic:** the standard proportions.
  - **Feature Image:** a larger image.
  - **Statement:** a larger headline and a more compact image.

  Landscape photos on landscape plaques sit on the left with text on the right. Logos default to the bottom when there is a portrait image, otherwise the top. Designers can override this.
- **Spec parser is rule-based (no AI).** It only ever picks options that exist in `data/catalog.json` and labels every guess "Assumed":
  - "relief image" → Photo Relief
  - border not specified → Single Line
  - font not stated → Times New Roman
  - "Dark Oxide or Leatherette" → Dark Oxide paint with Leatherette texture
- **Wording is never changed.** Only leading and trailing spaces are removed, and each removal is reported. Straight quotes stay straight (the real Heritage plaque uses `'Onward'`).
- **Spell check before proof.** The image model draws its own letters, so each concept is read back by a vision model and compared word by word. A proof cannot be made from an image with differences unless the designer explicitly confirms.
- **Image-type examples follow the uploaded file names.** Photo Relief = the bronze man with glasses, Etched = the dark sepia man in a suit, Full UV = the color photo, Bas Relief = the sculpted soldier. Checksums match the files pasted in chat.
- **Logos in the production file are traced to vector.** Anything that is not near-white becomes raised metal, so colored logo parts are kept. A logo supplied as SVG/PDF/AI is rendered at high resolution first, then traced. Preflight always asks for a visual check.
- **Proof footer keeps the vector "impactsigns.com" wordmark** from the real proof. The uploaded logo (without ".com") is used in the app header. Add `brand-assets/proof-footer-logo.svg` to override the footer.
- **Fonts:** licensed files go in `brand-assets/fonts/`. Until then these open stand-ins are used and flagged:
  - Tinos for Times (identical letter widths)
  - EB Garamond for Garamond
  - Crimson Pro for Minion
  - Libre Franklin for Franklin
  - Arimo for Helvetica
  - Source Sans 3 for Myriad
- **Aluminum:** see Round 2 below; the current catalog includes Cast Aluminum and Brushed Aluminum.

## Round 2 (examples: Awe, Raccoon River, Sax-Zim Bog, Hadar, Arroyo Grande, Kane County, Audubon, Camp Southern Ground, Honeywell, Structure of Merit)

- **Three proof styles, each measured on the real PDFs.** Fixed parts are copied from those PDFs as vector art: disclaimers, mounting diagrams, the wordmark, and the person silhouette (exported as clean outlines). See `scripts/build_proof_template.py`.
- **Standard-proof scaling rule:** true size (72 pt/in) when it fits, otherwise scaled to at most 504 × 432 pt. This matches 12×18, 12×16, 6×2, 36×24 and 8×12 within 2 pt.
- **Description sheet:**
  - The header is written from the spec in the designers' own phrasing.
  - "Font:" is listed only when the order names a font.
  - ORDER# sits on the shorter of lines 2–3; VERSION n appears in red from v2.
  - Tiles: plate, background (texture photo tinted to the paint color), image type, border, mounting, font.
- **Order/version proof:** the 7×5 plaque is drawn at true size; page 2 is the one-ink production art at 72 pt/in (scaled down, and labeled as such, for big plaques).
- **Double-line border measured at two sizes:** 7×5 is 0.15 / 0.05 / 0.10 in; 12×16 is 0.28 / 0.12 / 0.13 in. It grows linearly with the plaque's shorter side, and is now marked verified.
- **Text features:**
  - per-line italic, bold, small caps (lowercase drawn as 78% capitals), size, and per-line font
  - donor-list columns and ruled section headings
  - the image can sit between text blocks
- **Glyph placement:** glyphs are now placed character by character, with pair kerning but no ligatures. This avoids a crash on some fonts' OpenType tables and gives predictable letters for casting.
- **Aluminum added** (Honeywell was in the standard proof): Cast Aluminum with a Brushed Aluminum finish.
- **Reverse etched** is a process option. It changes the AI description and the swatch captions, and defaults to a smooth background.
- **Custom paint colors** ("Background painted Dark Blue 2050 …") get a name plus a color picker.
- **Custom fonts** ("Font: Clarendon Fortune Bold") get a name plus an upload slot for the font file. Until the file is uploaded, a stand-in is used and flagged.
- **The Audubon proof shows two plaques on one sheet.** Multi-plaque jobs are deferred, as agreed.

## Open items / unverified

- **Live OpenAI testing is now completed:** see the October verification below and `output/live/README.md`. This supersedes the earlier offline-only development note. Production hosting is not yet verified.
- **impactsigns.com styling:** verified October 5, 2026 against the public GeneratePress palette and child-theme CSS: navy `#1F2640`, link blue `#1C7293`, body text `#2B2B2B`, muted text `#686868`, gold `#B09E6E`, borders `#E1E1E1`, neutral `#ECEBE7`, page `#F7F8F9`, white panels. Shared UI tokens use these values; the supplied app wordmark is rendered as a navy silhouette. Fonts remain Barlow, and semantic warning/error/success colors remain distinct. Proof templates, catalog swatches and production ink are unchanged.
- **Bevel border geometry** is still unmeasured; preflight marks it "unverified". The double-line border is now measured.
- **Screw-hole size and position** for face-screw mounts are estimated (marked in the production file and flagged).
- **Inline logos and ornaments in text** (Kane County sponsor logos, Raccoon River paw prints) are not drawn by the layout. Do not promise them through Fix: they would not appear in vector production art. They need a future shared-layout feature.
- **Medium Oxidized icon** is currently the same image as Chemical Oxidized (the two uploaded oxidized files were identical).
- **Image-type examples are 100 × 100 px.** Full-size photos will noticeably improve how faithfully the AI reproduces each treatment.
- **Proof plaque centering** varies slightly between the real proofs (designers place by eye). The app always centers on the Liquid Mercury position.

## October 5, 2026: hardening and live verification

- **Preserve the backend.** Keep Express, SQLite, Sharp, Poppler and vector PDF tooling. No Cloudflare/Sites rewrite and no edits to the existing Sites project. The deployment blueprint uses Docker plus a persistent `/var/data` disk; free ephemeral hosting is not suitable for retaining jobs, uploads or PDFs.
- **Integrate the latest same-branch work.** Remote commit `1513b3a` supplied the 11 examples, all three measured proof styles, expanded catalog and per-line styles. Those template files, measured layout/production geometry, reference assets and original golden tests are retained unchanged relative to that commit. The font path serializer alone now formats finite coordinates without scientific notation, fixing an italic-font `NaN` PDF crash without changing layout measurements.
- **Exact prompts and exact model.** House rules and Fix text match the supplied brief; Fix prepends the house rules. All four prompt files contribute to version `f58a9bca`. Live calls used `gpt-image-2.5-sunburst-2026-09-08`, never substituted another model. Unsupported optional image parameters get at most one compatibility retry; authentication, permission, budget and moderation failures do not trigger that fallback. No compatibility fallback was needed by these live calls; simulated tests cover the rejection cases.
- **Safe Fix planning.** A validated union distinguishes appearance edits, catalog spec changes, literal wording edits and refusals. The Responses planner uses the configured vision model, retries malformed plans once, then uses a deterministic catalog-only fallback. Unsupported or ambiguous changes return 422 without creating an image record. Finish/material combinations are validated together. Every accepted fix creates a child version; spec/wording changes regenerate the same layout rather than painting a misleading change onto an old image.
- **Frozen content and Undo.** Versions freeze spec, customer wording, parse notes, uploads and image placement. Selecting an older version restores its corresponding content; Undo restores the prior order without deleting history. Stale versions and concurrent generation are rejected before another order mutation. The plan appears first in the stream, with refusal alternatives and explicit version labels in the interface.
- **Wording checks are fail-closed.** A failed or unavailable live wording check blocks proof creation until the designer explicitly acknowledges it. The initial Raccoon/Structure checks exposed false case differences from intentionally styled small capitals. The checker now permits only the expected small-capital tokens to differ in case; ordinary capitalization, spelling and punctuation remain exact. A subsequent paid Raccoon image edit passed a completed check and produced both PDFs without bypassing the gate. Earlier results are preserved, not rewritten as passes.
- **Verification:** 78 offline tests, typecheck, client build and all 11 sample proof/production pairs passed locally. Mock-only browser regression covers three example jobs, generation, selection, PDFs, spec Fix, refusal, Undo, admin and mobile. GitHub Actions runs the offline checks on Node 22 and 24; remote CI and the Docker container must be checked separately after pushing/deploying.
- **Live evidence:** health/model lookup and a paid test image succeeded. Three high-quality layouts were generated for Heritage, Raccoon River and Structure of Merit, with streamed partial images. A clean checked selection for each job produced a proof and one-ink, outlined, true-size vector PDF (Raccoon used the new checked child version). Preview JPEGs have a longest edge no greater than 1200 px. Metadata and costs are recorded in `output/live/`.
- **Quality limits remain visible.** Straight-on framing, edge-to-edge plaque coverage, photo-relief monochrome and full-color UV treatments worked. AI versions still vary slightly in spacing, metal warmth, texture, photo likeness and relief depth; the reverse-etched example looks deeper than ideal. Do not claim a pixel-identical rendering or automatically approve it for manufacture. The vector production art remains derived from the deterministic layout, not traced from AI lettering. Licensed-font stand-ins and minimum-letter-height warnings (about 0.20 in Raccoon, 0.24 in Structure vs 0.25 in guideline) still require designer/foundry review. No measured geometry was changed to hide these warnings.
- **Cost and security:** observed image usage was about $0.071–$0.083 per high-quality image (the connection test about $0.006). These are estimates from image token usage, not an invoice or a total-cost cap; planner and wording-reader charges are additional. The supplied key was injected only into the live server environment, never committed, logged or sent to the browser. Rotate the key exposed in chat before production. Set production credentials in the hosting environment, not source files.
- **Deployment open item:** the owner-created Render service is currently a free Node service without a persistent disk. It is not the verified production configuration. Prepare the Docker blueprint on this same branch, get approval for paid compute/storage, let the owner set fresh environment secrets, then verify the hosted app, uploads, PDF tools and restart persistence. Do not delete or upgrade the existing service without confirmation.

## October 5, 2026: audit pass

- **Concept columns line up.** The three concept columns are a CSS subgrid: the headers, the images and the controls sit on shared rows, so a "Selected" badge or a longer description in one column no longer pushes its image lower than the others. The badge sits beside the title instead of squeezing the description. The stage is a container: three columns appear whenever the stage itself is at least 560 px wide (below 1400 px (the `wide` breakpoint) the side panels narrow to 340 / 300 px, so a 1366 px laptop still gets three across), and each column clamps its own width so a wide control cannot push it over its neighbour. On big monitors the stage grows to 1440 px with portrait images up to 440 px wide. Nothing about the plaque images, proofs or layouts changed.
- **Unsaved line edits survive other saves.** The wording editor only resets when the saved lines actually change, not whenever another panel (photo upload, proof style) returns a fresh project. Before, an upload in the middle of editing lines silently threw the edits away.
- **Errors appear where they happened.** A failed proof shows its message under "Create proof PDF", not under the vector PDF section. Oversized uploads, malformed requests and unknown upload types now get plain-English JSON answers (the API router has an error handler), instead of Express's HTML error page and "Request failed (500)".
- **Line edits are checked on the server.** `PATCH /projects/:id` keeps only the fields the layout understands for each line (role, exact text, known style keys, catalog fonts). The text itself is still stored character for character.
- **Only the logo is public.** `/library/brand` serves `logo.png` / `logo.svg` and nothing else, so licensed font files dropped into `brand-assets/fonts/` are never downloadable without sign-in. The app is built by `server/app.ts` (`createApp`), which the tests mount directly.
- **Startup warnings follow the real sign-in mode** (Supabase, shared password, open, unconfigured) and production warns when `SESSION_SECRET` is the built-in default.
- **Lightbox:** Esc closes the full-size view, which now names the layout.

## October 5, 2026: automatic commits

- The owner requested automatic commits of all work as it progresses. Commit completed changes without asking each time; secrets and ignored files remain excluded.
- Existing interface palette changes and screenshots were committed as a checkpoint. `git diff --check` passed. Tests, typecheck and build could not run in this shell because `npm` was not on PATH; this checkpoint does not establish runtime or visual verification.

- **Shell tooling restored:** Node.js v24.19.0 and npm/npx v11.6.2 are available through user-local binaries, with `~/.local/bin` added to the zsh PATH. npm was copied from the existing temporary installation into persistent user-local storage. The earlier checkpoint checks now pass: 117 offline tests, typecheck, and production build. No application code changed for this environment repair.
