# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""PDF floor plans in Mapping → Upload (views/pdf_plan.js, vendor/pdfjs).

What must hold: the upload's file picker takes a PDF; PDF.js is vendored with
its licence and named in THIRD_PARTY_NOTICES.md; it loads only when a PDF is
picked (no top-level import anywhere); a PDF becomes a PNG File before the
upload's own path (so crop, size and scale work as for a picture); a PDF that
can't be read says so in words, and the report counts it.
"""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WWW = ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha"
MAPS = (WWW / "views" / "maps.js").read_text(encoding="utf-8")
PDF = (WWW / "views" / "pdf_plan.js").read_text(encoding="utf-8")


def test_the_picker_takes_a_pdf():
    assert 'file.accept = "image/*,application/pdf,.pdf";' in MAPS


def test_pdfjs_is_vendored_with_its_licence_and_notice():
    d = WWW / "vendor" / "pdfjs"
    for f in ("pdf.min.js", "pdf.worker.min.js", "LICENSE",
              # the image decoders a scanned plan needs, and the standard fonts
              "wasm/jbig2.wasm", "wasm/jbig2_nowasm_fallback.js", "wasm/openjpeg.wasm", "wasm/openjpeg_nowasm_fallback.js",
              "wasm/LICENSE_JBIG2", "wasm/LICENSE_OPENJPEG", "standard_fonts/LICENSE_FOXIT", "standard_fonts/LICENSE_LIBERATION"):
        assert (d / f).is_file(), f
    # The legacy build: it carries what older tablets and WebViews lack.
    assert "getOrInsertComputed" in (d / "pdf.worker.min.js").read_text(encoding="utf-8")
    assert 'wasmUrl: _vendor("wasm/")' in PDF and 'standardFontDataUrl: _vendor("standard_fonts/")' in PDF
    assert "Apache License" in (d / "LICENSE").read_text(encoding="utf-8")
    notices = (ROOT / "THIRD_PARTY_NOTICES.md").read_text(encoding="utf-8")
    assert "## PDF.js" in notices and "www/padspan-ha/vendor/pdfjs/pdf.min.js" in notices and "standard_fonts/" in notices and "wasm/" in notices


def test_pdfjs_loads_only_when_a_pdf_is_picked():
    # pdf_plan.js imports PDF.js inside a function; maps.js imports pdf_plan.js inside the PDF branch.
    assert re.search(r"^\s*(const|let|var)?\s*\w*\s*=?\s*await import\(`\.\./vendor/pdfjs", PDF, re.M)
    assert "async function _pdfjs()" in PDF
    top = [ln for ln in MAPS.splitlines() if ln.startswith(("import ", "const ")) and "pdf_plan" in ln]
    assert not top, top
    for f in list(WWW.glob("*.js")) + list((WWW / "views").glob("*.js")):
        if f.name == "pdf_plan.js":
            continue
        assert "vendor/pdfjs" not in f.read_text(encoding="utf-8"), f.name


def test_a_pdf_goes_on_as_a_png():
    assert 'new File([blob], name, { type: "image/png" })' in PDF
    assert "_showPicked(r.file);" in MAPS
    assert "quickjs" not in " ".join(p.name for p in (WWW / "vendor" / "pdfjs").rglob("*"))   # no JS-in-PDF engine shipped


def test_an_unreadable_pdf_says_why_and_is_counted():
    for code in ("password", "unreadable", "empty", "render"):
        assert f'_fail("{code}"' in PDF and f"    {code}: t(" in MAPS
    assert '_upTel("bad_pdf");' in MAPS and '_upTel("pdf");' in MAPS
    from custom_components.padspan_ha import telemetry as T
    assert {"plan_upload:pdf", "plan_upload:bad_pdf"} <= T.PLAN_UPLOAD_EVENTS


def test_only_the_latest_pick_counts_and_upload_waits_for_the_read():
    assert "if(seq !== ctx.state._mapsPdfSeq) return;" in MAPS
    assert "if(ctx.state._mapsPdfReading){" in MAPS
    assert "_drawPdfPicker();" in MAPS            # the page picker comes back after a redraw
