# Live image and PDF verification

Verified October 5, 2026 (UTC output folders dated October 4). Every image below used **`gpt-image-2.5-sunburst-2026-09-08`**, quality **high**, prompt version **`f58a9bca`**. Seconds include rendering and the wording check. USD is estimated image-token cost only; planner/wording-reader charges are additional. Each folder contains original `results.json`, preview JPEGs (longest edge ≤1200 px), and PDFs where a completed check passed. No failed check was silently acknowledged.

## Full three-job run

Folder: [2026-10-04T21-25-17-304Z](2026-10-04T21-25-17-304Z/results.json)

| Job / layout | API size | Seconds | Est. USD | Original wording check |
|---|---|---:|---:|---|
| Heritage / Classic | 1024x1536 | 32.905 | 0.077376 | Pass |
| Heritage / Feature Image | 1024x1536 | 37.117 | 0.072051 | Pass |
| Heritage / Statement | 1024x1536 | 37.012 | 0.077411 | Pass |
| Raccoon / Classic | 1152x1536 | 38.690 | 0.081158 | Two small-capital case flags |
| Raccoon / Feature Image | 1152x1536 | 39.123 | 0.081188 | Two small-capital case flags |
| Raccoon / Statement | 1152x1536 | 37.231 | 0.081193 | Two small-capital case flags |
| Structure / Classic | 1536x1104 | 30.902 | 0.071410 | Pass |
| Structure / Feature Image | 1536x1104 | 31.588 | 0.071450 | One small-capital case flag |
| Structure / Statement | 1536x1104 | 31.946 | 0.071445 | One small-capital case flag |

Heritage and Structure Classic produced proof/production pairs. The initial Raccoon run deliberately blocked PDFs rather than fabricating acknowledgement. The expected small-capital style was subsequently handled in the checker without relaxing ordinary spelling, case or punctuation requirements.

## Checked Raccoon child version

Folder: [fix-2026-10-04T21-28-49-091Z](fix-2026-10-04T21-28-49-091Z/results.json)

One paid visual Fix (`correct the spelling in this image`) created child `c_2891283d8439`, parent `c_40657473dadd`. Same model, high quality, `1152x1536`, **37.950 seconds**, **$0.083267**, prompt `f58a9bca`. The completed wording check passed. Both [proof](fix-2026-10-04T21-28-49-091Z/proof.pdf) and [vector production](fix-2026-10-04T21-28-49-091Z/production.pdf) were generated without an acknowledgement override.

## Earlier smoke run (preserved)

Folder: [2026-10-04T21-20-39-935Z](2026-10-04T21-20-39-935Z/results.json)

This checkout initially contained only Heritage; the other examples were reported missing before integrating the newer same-branch commits. All three images used `1024x1536`.

| Layout | Seconds | Est. USD | Wording check |
|---|---:|---:|---|
| Classic | 37.542 | 0.077231 | Pass |
| Feature Image | 36.515 | 0.074606 | Pass |
| Statement | 36.424 | 0.077266 | Failed: missing comma after `Jr.` |

The clean Classic version produced both PDFs. The separate connection test succeeded in 11.565 seconds at estimated $0.006150.

## Visual and structural review

All three jobs now have a checked proof/production pair. Production preflight confirms correct page size, outlined text, no embedded raster images and one ink. Rendered PDF previews were inspected. Warnings for licensed-font substitutes and undersized lettering remain visible; they are not a manufacture approval.

AI images are product-style previews, not guaranteed pixel-identical reproductions. Photo likeness, spacing, finish warmth and etched relief depth still need designer review. The deterministic layout supplies vector production art; the image model does not supply production lettering. See [DECISIONS](../../docs/DECISIONS.md) for limitations and deployment status.

To repeat (paid): run the live app, then `PW=your-app-password node scripts/verify-live.mjs`. To test an existing image edit, set `CONCEPT_ID` and run `scripts/verify-fix.mjs`. Never include the OpenAI key in command arguments; it belongs only in the server environment.
