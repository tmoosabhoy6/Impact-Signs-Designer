# Plaque Proof Studio

Impact Signs' internal tool for cast bronze plaques. It takes an order and produces:

1. **Three concept images** of the finished plaque, generated with OpenAI's image model (`gpt-image-2.5-sunburst-2026-09-08`). Each uses a different production-realistic layout.
2. **The customer proof PDF** in one of Impact Signs' three locked proof styles, each measured from real proofs:
   - **Standard** (Liquid Mercury): red dimension brackets, mounting diagram, finish and paint-fill swatches, disclaimer.
   - **Description sheet** (Awe, Raccoon River): DESCRIPTION header with ORDER#/VERSION, blue dimensions, captioned option tiles, and a Visual Scale panel (a 6 ft person on the ground or beside an 8 ft wall, or a photo of the site).
   - **Order version + outline art** (Structure of Merit): an "ORDER # – VERSION" header, side view and process captions, plus a second page with the production outline art.
3. **The vector production PDF**, built like `production_32241.ai`: plaque-size page, one ink (black = raised metal, white = recessed field), all text as outlines, no images, and an empty placeholder window for the photo.

![Workspace](docs/screens/03-raccoon-river-b-proof.png)

The interface uses the current impactsigns.com palette: navy navigation and buttons, blue links, charcoal text, gold selection accents and light neutral backgrounds. Customer proof and production PDF colors stay locked to the measured originals.

---

## How a designer uses it

1. **Sign in** with your username and password. Each person sees only their own jobs, versions, proofs and upscales.
2. **New plaque job:** enter the job number and a short name. To remove a job you no longer need, click the trash icon on its row in the Jobs list (this also removes its concepts, proofs and production files).
3. **01 Specification:** paste the order spec exactly as written and click **Read specification**. The app fills in a spec sheet from the catalog. Anything the order didn't state gets an amber **Assumed** tag; check those and change any dropdown if needed.
4. **02 Customer wording:** upload the customer's Word .docx or paste the text. The text is kept character for character. Each line gets a role (headline, subhead, body, footer), which you can change. Under each line, small buttons set:
   - **I / B / Sc**: italic, bold, small capitals.
   - **A− / A+**: size.
   - **Columns**: for donor lists.
   - **Rule**: a raised line under a heading.
   - **Font**: a different font for that line only.

   When there is a photo, a **Photo goes here** marker sets its position; use ↑ / ↓ to move it between lines. With several photos they move together.
5. **03 Customer files:** add the photos, logos (SVG or PDF/AI preferred) and any hand-drawn sketches. You can add several of each: pick several files at once with **Add**, or drop them onto the box.
   - **Photos** (up to 4) sit side by side, each in its own raised frame, left to right in the order listed (four may go in two rows of two). Two landscape photos on a landscape plaque stack at the left.
   - **Logos** (up to 6) sit together in one row, left to right in the order listed (from four logos, two rows when that makes them clearly larger). **Logo position** (top, middle, bottom) moves the whole row.
   - **Sketches** (up to 4) only guide the image model; they are never drawn on the plaque.
   - Use **‹ / ›** to change the order and the trash icon to remove one file. Removing a file does not delete it from older versions: **Use this one** on an older version brings its files back.
   - The same file added twice, a file that is not a picture, or one file too many is refused with its name; the other files are still added.
   - The app warns about each photo that is low resolution for its size on the plaque.
6. **04 Concepts:** click **Generate 3 concepts**. Images stream in as they render (about a minute). Under each image you can:
   - **Use this one** to pick it for the proof.
   - **Regenerate** (↻) the same layout for a fresh take.
   - **Fix** with an instruction, small or large, and several changes at once if you like (e.g. *"move the text up, make the photo bigger and spread the lines out"*, *"make the name larger and the etching deeper"*, *"use verde patina and change Founder to Chairman"*). Enter applies; Shift+Enter adds a line. The app shows how it read the request, and the result is saved as a new version (v2, v3…).
     - **Layout** changes (text size, spacing, photo or logo size, moving the content up or down, photo above or below the text, logo position) change that column's layout drawing, so the proof and the vector production file follow them. Each column keeps its own adjustments. With several photos or logos, "make the logos bigger" resizes the whole row together; a change to just one of them ("make the left logo bigger") is made on the image only.
     - Adding, removing or swapping photos and logos is done in **03 Customer files**, not with Fix.
     - **Catalog** options and **exact wording** changes update the order, as before.
     - **Anything else** about how the image looks (etching depth, photo detail, finish appearance, moving one element in a way the layout can't) is made by the image model on the current picture. These change the image only; the vector file keeps the layout drawing.
     - Only requests that need something outside the catalog (e.g. *"purple anodized"*) or aren't about the plaque are refused. **Undo order change** reverses any layout, catalog or wording change.

   Every image is automatically **spell-checked**: the app reads the text back and compares it with the customer's wording.
7. **05 Customer proof:** pick the **Proof style**. For Description sheets, choose the scale panel (person, site photo or none) and adjust the auto-written DESCRIPTION header if needed. Optionally add a red note under the plaque. Then click **Create proof PDF**. If the spell check found a difference, the app stops and shows it: fix the image first, or confirm you've checked it. Each new proof is a new version (v2, v3…).
8. **06 Vector production PDF:** click **Create vector PDF**. A preflight checklist confirms page size, no fonts, no images and one ink, and warns about stand-in fonts, traced logos and minimum letter heights. Download it and open it in Illustrator (it opens directly, like the .ai files).

Nothing is ever overwritten: every image, proof and production file is kept as its own version.

### AI Upscaler

The **AI Upscaler** tab, next to **Plaque Proof Studio** at the top, enlarges a low-resolution image just enough to be usable, without changing it. It is separate from jobs.

1. Drop in or choose an image (PNG, JPG, WebP, TIFF or GIF, up to 30 MB).
2. Pick **720p** or **1080p**. The short side becomes 720 or 1080 px and the proportions stay the same. Pick the smallest size that works: the less the image is enlarged, the less the AI has to fill in. Images that are already that size are refused, at no cost.
3. Click **Upscale image** (about 30 to 90 seconds). The original and the upscale appear side by side with a **% match** score. The score comes from shrinking the upscale back to the original size and comparing them.
4. Download the **upscaled PNG**, or the **standard upscale (no AI)**: a plain enlargement with nothing added. Use the standard one if the match warning says the AI changed something.

How it stays faithful: the image model (`OPENAI_IMAGE_MODEL`, the same one used for concepts) gets a Lanczos enlargement of the original, high input fidelity, and a prompt that forbids any change. If the result still lines up with the original, the original's broad tones and colors are locked back in, so only fine detail comes from the AI. Transparent images keep their own transparency. Upscales count toward `DAILY_BUDGET_USD`, are listed under **Recent upscales**, and can be deleted there.

---

## Getting it online on Render.com (one time, about 10 minutes)

Do these once. Afterwards changes pushed to the branch redeploy only after the automated checks pass.

**Before you start: OpenAI account (5 minutes)**
1. Go to [platform.openai.com](https://platform.openai.com) → **API keys** → **Create new secret key**. Copy it somewhere safe. Also **revoke the old key** that was pasted in chat.
2. **Billing** → add at least $10 of credit. Image generation does not work on an account with no credit.
3. **Settings → Organization → General → Verify Organization.** OpenAI requires a verified organization before its image models can be used. It takes a few minutes with an ID check.

**Deploy**
1. Click **[Deploy to Render](https://render.com/deploy?repo=https://github.com/tmoosabhoy6/Impact-Signs-Designer/tree/claude/blissful-mccarthy-63trmd)** and sign in to Render with GitHub. If Render asks, allow it to access the `Impact-Signs-Designer` repository; it is private, so Render needs permission to read it.
   - *Or manually:* Render dashboard → **New** → **Blueprint** → choose `Impact-Signs-Designer` → set the branch to **`claude/blissful-mccarthy-63trmd`**.
2. Render reads `render.yaml` and shows one web service (`plaque-proof-studio`, Starter plan) with a 5 GB disk. It asks for these values:
   - `OPENAI_API_KEY`: the new key from step 1.
   - `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`: from Supabase → your project → **Project Settings → API Keys** (see **Sign-in accounts** below).
   - `APP_PASSWORD`: leave empty when the Supabase values are set.
3. Click **Apply** (or **Deploy Blueprint**). The first build takes about 5 minutes. When it says **Live**, open the address shown at the top, e.g. `https://plaque-proof-studio.onrender.com`.
4. Sign in, go to **Admin → System** and click **Run a test image**. One small image should appear within about a minute. If something is wrong, the message says exactly what (key, credit, organization verification…).

The Starter plan plus the 5 GB disk costs about $7–9/month. Jobs, images and PDFs are kept between updates.

**No webhook is needed.** The app calls OpenAI and receives each image in the same request, streaming progress to the screen.

### Sign-in accounts

Accounts (username + password) live in a Supabase project, in the `app_users` table created by [`supabase/migrations/`](supabase/migrations/). Passwords are stored only as bcrypt hashes. The table cannot be read with the publishable key. The app server checks a sign-in through the `app_login` database function, and ten wrong passwords in a row lock that account for 15 minutes.

- **Add a person or change a password:** Supabase → **SQL Editor** → run `select public.app_set_user('Name', 'their-password');`. Usernames are not case-sensitive.
- **Remove a person:** `delete from public.app_users where lower(username) = 'name';`
- Each job and upscale belongs to the account that made it; other accounts cannot list, open, download or delete it. Jobs made before accounts existed belong to `LEGACY_JOBS_OWNER` (default `taher`).
- Use passwords longer than 4 digits where you can: the lock-out slows guessing but a short PIN is still easy to guess over days.

---

## Settings (Render → your service → Environment)

| Setting | Default | What it does |
|---|---|---|
| `OPENAI_API_KEY` | (none) | OpenAI key. Required for real images. |
| `SUPABASE_URL` | (none) | Supabase project with the sign-in accounts, e.g. `https://<ref>.supabase.co`. |
| `SUPABASE_PUBLISHABLE_KEY` | (none) | That project's publishable key (`sb_publishable_…`; the legacy anon key also works). Used only by the server. |
| `LEGACY_JOBS_OWNER` | `taher` | Username that owns jobs and upscales made before sign-in accounts existed. |
| `APP_PASSWORD` | (none) | Older setup without Supabase: one shared team password plus each person's name. In production, with neither set, nobody can sign in. |
| `SESSION_SECRET` | generated | Signs login cookies. Render generates it. |
| `OPENAI_IMAGE_MODEL` | `gpt-image-2.5-sunburst-2026-09-08` | Image model. |
| `OPENAI_VISION_MODEL` | `gpt-5.4-mini` | Model that reads the text back for the spell check. |
| `OPENAI_PLANNER_MODEL` | `gpt-5.4` | Model that reads designer Fix instructions into a checked plan. Falls back to `OPENAI_VISION_MODEL`, then to the built-in reader. |
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
| [`references/`](references/README.md) | 11 real example jobs (spec, wording, photo, final proof, production file). Used to measure the templates, build the sample proofs and run the automated tests. They are not shown in the app. |
| [`data/catalog.json`](data/catalog.json) | Every option the app offers (finishes and their upcharges, colors, textures, borders, fonts, image types, mountings, size limits) and which icon each uses. To add an option, add it here and drop its icon into `assets/`. |
| [`server/prompts/`](server/prompts) | The instructions sent to the image model with every request. Edit them to tune the look; the version is recorded on every image. Shown read-only in **Admin → Image prompts**. |

---

## How the AI is kept honest (the "prompting" problem)

The image API has no saved "system prompt": every request carries everything. Each concept request sends:

- **Reference 1, the exact layout drawing.** The app draws the plaque flat with code: true size and proportions, real typeface, every line of wording in place, the customer photo in its frame. The model is told to keep every position and letter and only make it look like real cast metal. This one drawing is what keeps the AI from inventing layouts or rewording text, and it is also why the vector PDF matches the chosen concept.
- **Real reference photos from `assets/`:** the chosen image-type example (bas relief vs photo relief vs etched vs UV print), the finish swatch, paint swatch, texture, border example, plus the customer's photos, logos and sketches. Each photo and logo is named by its place in the layout drawing ("customer photo 2 of 2, for the right image frame"). The image model accepts at most 16 pictures per request; when a job has more files than fit, the sketches (then the logos) are sent together on one numbered sheet.
- **The house rules** (`server/prompts/house_rules.md`): one real plaque, straight-on, filling the frame edge to edge, raised metal vs recessed painted field, nothing added.
- **The job details**, built from the catalog's descriptions of each option.

After generation, the app crops the image to the plaque's exact proportions (so the proof brackets line up) and spell-checks it.

---

## Run it on your computer or in Codex

Open this project folder in Terminal, or ask Codex to run these commands. Install Node.js 22 or 24 first if your computer does not have Node and npm.

1. Run `npm install` once.
2. Copy `.env.example` to `.env`. Open that file and fill in `OPENAI_API_KEY`, `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` (or `APP_PASSWORD`). Keep the key private; never put it in a browser field or commit the file.
3. Run `npm run build && npm start`, then open [localhost:8080](http://localhost:8080). Keep Terminal open while using the app.
4. For a no-cost demonstration, run `npm run demo` instead. Images are simulated and spelling checks are skipped. A fresh data folder starts with an empty Jobs list.

In Codex cloud, set `OPENAI_API_KEY` as a runtime environment variable, not a setup-only secret, and allow agent internet access to `api.openai.com`. Never paste the key into source code. Local Codex can use the git-ignored `.env` file.

The **Fix** box distinguishes appearance edits from changes to the order. “Double line border” changes the catalog specification and regenerates the image, proof and vector together. “Change Founder to Chairman” changes exactly that text. Version chips show **edit / spec / wording**, and **Undo order change** restores the previous order without deleting images. Unsupported or ambiguous requests are refused with catalog alternatives.

### Verification commands

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

For screenshots, install Chromium once with `npx playwright-core install chromium`, start the server in demo mode, then run `BASE=http://localhost:8080 PW=test node scripts/screens.mjs` (use your own team password). The script also verifies the Fix plan, refusal and Undo flow, and refuses to run against live mode. `CHROME` can point to an existing Chromium executable.

For paid live verification, run `BASE=http://localhost:8080 PW=test node scripts/verify-live.mjs`. It creates new verification jobs, streams three concepts for each of the three specified examples, and saves previews and checked PDFs in a new timestamped `output/live/` folder. It never auto-confirms a spelling warning. Image costs are usage-based estimates; planner and spelling-reader calls are additional.

GitHub Actions runs tests, type checking, build and offline samples on Node 22 and 24 for pushes and pull requests. Render's Blueprint waits for passing checks. Use the Docker Blueprint with a persistent disk for production: the free Node service's temporary filesystem is not safe storage for customer jobs. Sites and Vercel are not drop-in hosts for this Express/SQLite/Poppler app.

See [`docs/DECISIONS.md`](docs/DECISIONS.md) for design decisions and what is still unverified.
