"""Cuts the fixed, never-changing parts of the real Impact Signs proofs into small vector
templates in server/templates/. The app draws everything job-specific on top.

    python3 scripts/build_proof_template.py

Each template is one page (Letter landscape) that keeps only the listed region of a real
proof, as untouched vector art (fonts, curves and colors exactly as the designers made them).
"""
import pymupdf

OUT = "server/templates"
W, H = 792, 612

LIQUID = "references/32241-edwin-feulner/Liquid Mercury.pdf"
HONEYWELL = "references/31882-honeywell/proof.pdf"
AWE = "references/32582-awe/proof.pdf"
RACCOON = "references/32885-raccoon-river/proof.pdf"
SOM = "references/32249-structure-of-merit/proof.pdf"


def complement(keep):
    """Four rectangles covering the page around a kept rectangle."""
    x0, y0, x1, y1 = keep
    return [(0, 0, W, y0), (0, y1, W, H), (0, y0, x0, y1), (x1, y0, W, y1)]


def build(src, out, remove=(), keep=None, page=0, touched=False):
    doc = pymupdf.open(src)
    for i in range(len(doc) - 1, -1, -1):
        if i != page:
            doc.delete_page(i)
    p = doc[0]
    rects = list(remove) + (complement(keep) if keep else [])
    for r in rects:
        p.add_redact_annot(pymupdf.Rect(*r))
    p.apply_redactions(
        images=pymupdf.PDF_REDACT_IMAGE_REMOVE,
        graphics=pymupdf.PDF_REDACT_LINE_ART_REMOVE_IF_TOUCHED if touched else pymupdf.PDF_REDACT_LINE_ART_REMOVE_IF_COVERED,
        text=pymupdf.PDF_REDACT_TEXT_REMOVE,
    )
    # Drop Illustrator's private editing data and thumbnails (not needed, often > 1 MB).
    for key in ("PieceInfo", "Thumb", "Annots", "LastModified"):
        doc.xref_set_key(p.xref, key, "null")
    doc.xref_set_key(doc.pdf_catalog(), "Metadata", "null")
    doc.set_metadata({"title": out, "producer": "Plaque Proof Studio"})
    doc.save(f"{OUT}/{out}.pdf", garbage=4, deflate=True, clean=True)
    print("saved", out)


# Each piece keeps only its own region; the app also clips to that region when placing it.
# The two disclaimers (standard, and the "photo for scale" variant from Honeywell).
build(LIQUID, "disclaimer-standard", keep=(300, 576, 790, 606), touched=True)
build(HONEYWELL, "disclaimer-photo", keep=(290, 583, 790, 606), touched=True)
# Blind-mount diagram with its "Mounting" caption (standard proof right column).
build(LIQUID, "mount-blind", keep=(686, 20, 782, 322), touched=True)
# Order/version proof (Structure of Merit): side-view blind mount and the red footer note.
build(SOM, "mount-blind-sideview", keep=(684, 10, 784, 316), touched=True)
build(SOM, "etched-footer-note", keep=(440, 578, 750, 606), touched=True)


# ---------- Pure vector shapes (wordmark, person) exported as SVG paths ----------
import json


def export_paths(src, bbox, page=0):
    """All filled drawings inside bbox, as SVG path data in page coordinates (y down)."""
    p = pymupdf.open(src)[page]
    out = []
    x0, y0, x1, y1 = bbox
    for d in p.get_drawings():
        r = d["rect"]
        if r.x0 < x0 - 0.5 or r.y0 < y0 - 0.5 or r.x1 > x1 + 0.5 or r.y1 > y1 + 0.5 or not d.get("fill"):
            continue
        parts = []
        last = None
        for it in d["items"]:
            op = it[0]
            if op == "l":
                a, b = it[1], it[2]
                if last is None or (abs(last.x - a.x) > 1e-3 or abs(last.y - a.y) > 1e-3):
                    parts.append(f"M{a.x:.3f} {a.y:.3f}")
                parts.append(f"L{b.x:.3f} {b.y:.3f}")
                last = b
            elif op == "c":
                a, c1, c2, b = it[1], it[2], it[3], it[4]
                if last is None or (abs(last.x - a.x) > 1e-3 or abs(last.y - a.y) > 1e-3):
                    parts.append(f"M{a.x:.3f} {a.y:.3f}")
                parts.append(f"C{c1.x:.3f} {c1.y:.3f} {c2.x:.3f} {c2.y:.3f} {b.x:.3f} {b.y:.3f}")
                last = b
            elif op == "re":
                rr = it[1]
                parts.append(f"M{rr.x0:.3f} {rr.y0:.3f}H{rr.x1:.3f}V{rr.y1:.3f}H{rr.x0:.3f}Z")
                last = None
            elif op == "qu":
                q = it[1]
                parts.append(f"M{q.ul.x:.3f} {q.ul.y:.3f}L{q.ur.x:.3f} {q.ur.y:.3f}L{q.lr.x:.3f} {q.lr.y:.3f}L{q.ll.x:.3f} {q.ll.y:.3f}Z")
                last = None
        if d.get("closePath"):
            parts.append("Z")
        fill = "#%02x%02x%02x" % tuple(round(c * 255) for c in d["fill"][:3])
        out.append({"d": " ".join(parts), "fill": fill, "evenOdd": bool(d.get("even_odd"))})
    return {"bbox": bbox, "paths": out}


vectors = {
    "wordmark": export_paths(LIQUID, (18, 575, 190, 606)),
    "person": export_paths(RACCOON, (496, 388, 558, 569)),
}
with open(f"{OUT}/vectors.json", "w") as f:
    json.dump(vectors, f)
print("saved vectors.json", {k: len(v["paths"]) for k, v in vectors.items()})
