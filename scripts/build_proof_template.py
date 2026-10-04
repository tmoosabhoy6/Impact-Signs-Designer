"""Builds server/templates/proof-static.pdf from the real Liquid Mercury proof.

Keeps only the parts of the proof that never change between jobs (mounting
diagram, footer rule, impactsigns.com wordmark, red disclaimer) as untouched
vector art. Everything job-specific (plaque, dimensions, swatches) is removed
and redrawn by the app. Run once: python3 scripts/build_proof_template.py
"""
import pymupdf

SRC = "references/32241-edwin-feulner/Liquid Mercury.pdf"
OUT = "server/templates/proof-static.pdf"

doc = pymupdf.open(SRC)
page = doc[0]
for r in [(130, 20, 560, 540), (685, 333, 780, 445), (685, 445, 780, 566)]:
    page.add_redact_annot(pymupdf.Rect(*r))
page.apply_redactions(
    images=pymupdf.PDF_REDACT_IMAGE_REMOVE,
    graphics=pymupdf.PDF_REDACT_LINE_ART_REMOVE_IF_COVERED,
    text=pymupdf.PDF_REDACT_TEXT_REMOVE,
)
# Drop Illustrator's private editing data and the thumbnail (not needed, ~1 MB).
for key in ("PieceInfo", "Thumb", "Annots", "LastModified"):
    doc.xref_set_key(page.xref, key, "null")
doc.xref_set_key(doc.pdf_catalog(), "Metadata", "null")
doc.set_metadata({"title": "Proof template", "producer": "Plaque Proof Studio"})
doc.save(OUT, garbage=4, deflate=True, clean=True)
print("saved", OUT)
