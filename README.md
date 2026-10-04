# Plaque Proof Studio

Impact Signs' internal tool for cast bronze plaques. It takes an order and produces:

1. **Three concept images** of the finished plaque, generated with OpenAI's image model (`gpt-image-2.5-sunburst-2026-09-08`). Each uses a different production-realistic layout.
2. **The customer proof PDF** in one of Impact Signs' three locked proof styles, each measured from real proofs:
   - **Standard** (Liquid Mercury): red dimension brackets, mounting diagram, finish and paint-fill swatches, disclaimer.
   - **Description sheet** (Awe, Raccoon River): DESCRIPTION header with ORDER#/VERSION, blue dimensions, captioned option tiles, and a Visual Scale panel (a 6 ft person on the ground or beside an 8 ft wall, or a photo of the site).
   - **Order version + outline art** (Structure of Merit): an "ORDER # – VERSION" header, side view and process captions, plus a second page with the production outline art.
3. **The vector production PDF**, built like `production_32241.ai`: plaque-size page, one ink (black = raised metal, white = recessed field), all text as outlines, no images, and an empty placeholder window for the photo.

![Workspace](docs/screens/03-raccoon-river-b-proof.png)

---

## How a designer uses it

1. **Sign in** with your name and the team password.
2. **New plaque job:** enter the job number (e.g. `32241`) and a short name. Or click **Open** under **Start from an example** to load one of 11 real past orders, ready to generate.
3. **01 Specification:** paste the order spec exactly as written and click **Read specification**. The app fills in a spec sheet from the catalog. Anything the order didn't state gets an amber **Assumed** tag; check those and change any dropdown if needed.
4. **02 Customer wording:** upload the customer's Word .docx or paste the text. The text is kept character for character. Each line gets a role (headline, subhead, body, footer), which you can change. Under each line, small buttons set:
   - **I / B / Sc**: italic, bold, small capitals.
   - **A− / A+**: size.
   - **Columns**: for donor lists.
   - **Rule**: a raised line under a heading.
   - **Font**: a different font for that line only.

   When there is a photo, a **Photo goes here** marker sets its position; use ↑ / ↓ to move it between lines.
5. **03 Customer files:** add the photo, logo (SVG or PDF/AI preferred) and any hand-drawn sketch. The app warns if the photo is low resolution for its size on the plaque.
6. **04 Concepts:** click **Generate 3 concepts**. Images stream in as they render (about a minute). Under each image you can:
   - **Use this one** to pick it for the proof.
   - **Regenerate** (↻) the same layout for a fresh take.
   - **Fix** with a short instruction (e.g. *"correct the spelling of Feulner"*, *"make the border thinner"*). Only that change is made, and the result is saved as a new version (v2, v3…).

   Every image is automatically **spell-checked**: the app reads the text back and compares it with the customer's wording.
7. **05 Customer proof:** pick the **Proof style**. For Description sheets, choose the scale panel (person, site photo or none) and adjust the auto-written DESCRIPTION header if needed. Optionally add a red note under the plaque. Then click **Create proof PDF**. If the spell check found a difference, the app stops and shows it: fix the image first, or confirm you've checked it. Each new proof is a new version (v2, v3…).
8. **06 Vector production PDF:** click **Create vector PDF**. A preflight checklist confirms page size, no fonts, no images and one ink, and warns about stand-in fonts, traced logos and minimum letter heights. Download it and open it in Illustrator (it opens directly, like the .ai files).

Nothing is ever overwritten: every image, proof and production file is kept as its own version.

---

## Getting it online on Render.com (one time, about 10 minutes)

Do these once. Afterwards every change pushed to the branch redeploys by itself, so the link always shows the latest version.

**Before you start: OpenAI account (5 minutes)**
1. Go to [platform.openai.com](https://platform.openai.com) → **API keys** → **Create new secret key**. Copy it somewhere safe. Also **revoke the old key** that was pasted in chat.
2. **Billing** → add at least $10 of credit. Image generation does not work on an account with no credit.
3. **Settings → Organization → General → Verify Organization.** OpenAI requires a verified organization before its image models can be used. It takes a few minutes with an ID check.

**Deploy**
1. Click **[Deploy to Render](https://render.com/deploy?repo=https://github.com/tmoosabhoy6/Impact-Signs-Designer/tree/claude/blissful-mccarthy-63trmd)** and sign in to Render with GitHub. If Render asks, allow it to access the `Impact-Signs-Designer` repository; it is private, so Render needs permission to read it.
   - *Or manually:* Render dashboard → **New** → **Blueprint** → choose `Impact-Signs-Designer` → set the branch to **`claude/blissful-mccarthy-63trmd`**.
2. Render reads `render.yaml` and shows one web service (`plaque-proof-studio`, Starter plan) with a 5 GB disk. It asks for two values:
   - `OPENAI_API_KEY`: the new key from step 1.
   - `APP_PASSWORD`: any password your team will use to sign in.
3. Click **Apply** (or **Deploy Blueprint**). The first build takes about 5 minutes. When it says **Live**, open the address shown at the top, e.g. `https://plaque-proof-studio.onrender.com`.
4. Sign in, go to **Admin → System** and click **Run a test image**. One small image should appear within about a minute. If something is wrong, the message says exactly what (key, credit, organization verification…).

The Starter plan plus the 5 GB disk costs about $7–9/month. Jobs, images and PDFs are kept between updates.

**No webhook is needed.** The app calls OpenAI and receives each image in the same request, streaming progress to the screen.

---

## Settings (Render → your service → Environment)

| Setting | Default | What it does |
|---|---|---|
| `OPENAI_API_KEY` | (none) | OpenAI key. Required for real images. |
| `APP_PASSWORD` | (none) | Team sign-in password. If empty, anyone with the link can use the app. |
| `SESSION_SECRET` | generated | Signs login cookies. Render generates it. |
| `OPENAI_IMAGE_MODEL` | `gpt-image-2.5-sunburst-2026-09-08` | Image model. |
| `OPENAI_VISION_MODEL` | `gpt-5.4-mini` | Model that reads the text back for the spell check. |
| `IMAGE_QUALITY` | `high` | Default quality (`low`, `medium`, `high`, `xhigh`, `max`). Designers can also pick Draft / High / Extra high per run. |
| `IMAGE_LONG_EDGE` | `1536` | Longest side of generated images, in pixels. |
| `MOCK_AI` | `0` | `1` = demo mode: simulated images, no OpenAI calls, no cost. |
| `MAX_IMAGE_CALLS_PER_PROJECT` | `40` | Safety cap on images per job. |
| `DAILY_BUDGET_USD` | `40` | Generation stops for the day once estimated spend reaches this. |
| `PRICE_TEXT_IN` / `PRICE_IMAGE_IN` / `PRICE_IMAGE_OUT` | `5` / `8` / `30` | USD per million tokens, used for the cost estimates and the budget. |
| `DATA_DIR` | `/var/data` on Render | Where jobs, images and PDFs are stored (the persistent disk). |

---

## The folders you maintain

| Folder | What goes in it |
|---|---|
| [`assets/`](assets/README.md) | The **static icon library**: finishes, paint colors, textures, borders and image-type examples. Proof icons are pulled from here, never generated. The README lists the exact file names. **Admin → Asset Library** shows what's present. |
| [`brand-assets/`](brand-assets/README.md) | Logo and licensed font files (Myriad Pro for proof labels; Times / Garamond / Minion / Franklin / Helvetica for plaque text). |
| [`references/`](references/README.md) | 11 real example jobs (spec, wording, photo, final proof, production file). Used to measure the templates, power **Start from an example**, and run the automated tests. |
| [`data/catalog.json`](data/catalog.json) | Every option the app offers (finishes and their upcharges, colors, textures, borders, fonts, image types, mountings, size limits) and which icon each uses. To add an option, add it here and drop its icon into `assets/`. |
| [`server/prompts/`](server/prompts) | The instructions sent to the image model with every request. Edit them to tune the look; the version is recorded on every image. Shown read-only in **Admin → Image prompts**. |

---

## How the AI is kept honest (the "prompting" problem)

The image API has no saved "system prompt": every request carries everything. Each concept request sends:

- **Reference 1, the exact layout drawing.** The app draws the plaque flat with code: true size and proportions, real typeface, every line of wording in place, the customer photo in its frame. The model is told to keep every position and letter and only make it look like real cast metal. This one drawing is what keeps the AI from inventing layouts or rewording text, and it is also why the vector PDF matches the chosen concept.
- **Real reference photos from `assets/`:** the chosen image-type example (bas relief vs photo relief vs etched vs UV print), the finish swatch, paint swatch, texture, border example, plus the customer's photo, logo and sketch.
- **The house rules** (`server/prompts/house_rules.md`): one real plaque, straight-on, filling the frame edge to edge, raised metal vs recessed painted field, nothing added.
- **The job details**, built from the catalog's descriptions of each option.

After generation, the app crops the image to the plaque's exact proportions (so the proof brackets line up) and spell-checks it.

---

## Running it on a computer (developers)

```bash
npm install
cp .env.example .env        # then fill in OPENAI_API_KEY and APP_PASSWORD (or set MOCK_AI=1)
npm run build && npm start  # http://localhost:8080
# or, while editing code:  npm run dev   (web on :5173, API on :8080)
```

- `npm test` runs the golden tests: the Heritage Foundation job must reproduce the real proof and production file within 2 pt, the production PDF must pass preflight, and more.
- `npm run samples` rebuilds every example job in its proof style next to the real proof: see [`output/samples/README.md`](output/samples/README.md).
- `node scripts/screens.mjs` drives the whole app in a browser (sign in, example jobs, generate, proof, vector PDF) and saves screenshots to `docs/screens/` (needs a running server, demo mode recommended).
- `python3 scripts/build_proof_template.py` re-cuts the fixed proof parts (disclaimers, mounting diagrams, wordmark and person outlines) from the real proofs, if a proof design ever changes.

Optional system tool: **Poppler** (`pdftocairo`), installed automatically in the Docker image. It reads PDF/.ai uploads and renders proof previews.

See [`docs/DECISIONS.md`](docs/DECISIONS.md) for design decisions and what is still unverified.
