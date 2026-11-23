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
    for f in ("pdf.min.js", "pdf.worker.min.js", "LICENSE"):
        assert (d / f).is_file(), f
    assert "Apache License" in (d / "LICENSE").read_text(encoding="utf-8")
    notices = (ROOT / "THIRD_PARTY_NOTICES.md").read_text(encoding="utf-8")
    assert "## PDF.js" in notices and "vendor/pdfjs/pdf.min.js" in notices


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
    assert "isEvalSupported: false" in PDF       # no eval of PDF content


def test_an_unreadable_pdf_says_why_and_is_counted():
    assert "This PDF can't be used:" in PDF and "password-protected" in PDF
    assert '_upTel("bad_pdf");' in MAPS and '_upTel("pdf");' in MAPS
    from custom_components.padspan_ha import telemetry as T
    assert {"plan_upload:pdf", "plan_upload:bad_pdf"} <= T.PLAN_UPLOAD_EVENTS
