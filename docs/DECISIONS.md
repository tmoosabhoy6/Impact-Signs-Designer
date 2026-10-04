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
- **Aluminum** is out of scope (handled by a separate app). The parser flags it.

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

- **Live OpenAI testing:** this build workspace's network blocks api.openai.com, so the real model was not called during development. The OpenAI code follows the SDK's documented parameters for this model (reference images, any WIDTHxHEIGHT size, `xhigh`/`max` quality, streaming partial images). Expect prompt tuning on the first real jobs. Use **Admin → System → Check the OpenAI connection** after deploying.
- **impactsigns.com styling:** the site was blocked from this workspace too. The app's look is built from the brand's own material: the navy logo (#2E3092), the proof's red (#ED1C24) and ink (#231F20), and a DIN-style condensed typeface matching the logo lettering.
- **Bevel border geometry** is still unmeasured; preflight marks it "unverified". The double-line border is now measured.
- **Screw-hole size and position** for face-screw mounts are estimated (marked in the production file and flagged).
- **Inline logos and ornaments in text** (Kane County sponsor logos, Raccoon River paw prints) are not drawn by the layout; the AI concept can add them on request through the Fix box.
- **Medium Oxidized icon** is currently the same image as Chemical Oxidized (the two uploaded oxidized files were identical).
- **Image-type examples are 100 × 100 px.** Full-size photos will noticeably improve how faithfully the AI reproduces each treatment.
- **Proof plaque centering** varies slightly between the real proofs (designers place by eye). The app always centers on the Liquid Mercury position.
