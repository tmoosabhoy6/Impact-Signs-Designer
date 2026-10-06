# Impact Signs design library

All 25 General Purpose Examples screenshots were visually reviewed. `index.json` records each source filename and checksum, a compact derivative checksum, observed treatment matches, plaque proportions, content density, related views of the same job, and a specific craft lesson. The `.webp` files are the shipped reference pictures (maximum edge 768 px; about 3.3 MB for the whole collection). Originals are unchanged.

The recurring lessons are strong inscription hierarchy, separated text groups, restrained borders, complete customer marks, readable metal-to-field contrast, controlled relief depth and distinct treatment of sculpted forms and flat photographs. These guide rendering within the exact shared layout. They do not change its geometry or import customer content from another job.

New concepts and regenerations retrieve at most three examples locally. Treatment compatibility outranks composition; similar proportions and text density break ties. Duplicate full/detail views of one job are not selected together. Customer artwork and catalog swatches have priority within the 16-image limit. An unmatched process uses text-only craft references plus the catalog's treatment sample, rather than borrowing an incompatible photo process.

The photographed manufacturing process cannot always be proven from a screenshot. The Bee Murphy and FAA flat tonal photographs and the mixed-color September memorial have empty `imageOptions`; they informed the overall design analysis but are not sent as evidence of a specific process. Other treatment tags describe visual resemblance, not a certified order specification. Script, decorative flowers, shield outlines, ornate borders and selective painting are specific to the original orders; they cannot authorize new options. Catalog IDs remain the only treatment choices. In particular, the catalog has no separate halftone-UV photo option; do not silently equate it to etched photo or photo relief.

The existing spelling-reader request also screens the result for layout fidelity, materials, treatment, readability and house workmanship. It receives the generated image first, the drawing second, then the selected examples. Incomplete responses remain unchecked. Failed/unavailable live reviews require visible designer acknowledgment before proofing. The reviewer is not a foundry preflight and does not certify likeness or pixel-exact geometry. No automatic extra images or rerolls are purchased. A Fix edit gets no competing gallery input; its reviewer sees examples and the designer's literal request.

To add work:

1. Keep the new originals in `references/general-purpose-examples/`.
2. Visually review each picture and add an entry to `index.json`. Use existing catalog image-option IDs only, or an empty list if uncertain. Estimate the plaque's actual aspect ratio, not the screenshot's ratio. Group repeat views under one `family` and mark cropped closeups as `detail`.
3. Write a concrete lesson about observed craft. Clearly identify order-specific features that cannot be transferred.
4. Run `node scripts/build-design-library.mjs` to create compact copies and checksums, then run the focused library tests in mock mode. Ship the index and derivatives and restart the server; the bounded library cache lasts for the process lifetime.

Each concept records the library version and selected examples' IDs, labels, lessons and image hashes. Its complete generation prompt is saved as before. Existing versions are retained. New paid image quality and the vision review's precision still need live assessment; offline checks establish reference routing, validation and UI behavior only.
