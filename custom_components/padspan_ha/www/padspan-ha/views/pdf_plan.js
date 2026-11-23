// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// A PDF floor plan as a picture, for Mapping → Upload: one page drawn in the
// browser by PDF.js (vendor/pdfjs, Apache-2.0; its legacy build, so older
// tablets and the Companion app's WebView read PDFs too) and handed back as a
// PNG file, so the upload goes on exactly as it does for a photo or a scan.
// PDF.js is loaded only when a PDF is picked. Its image decoders (vendor/
// pdfjs/wasm: black-and-white scans, JPEG 2000) and standard fonts come
// with it, so a scanned plan or one with unembedded fonts draws as it should.
//
// A failure is an Error with .code, which the upload card puts in words:
// "password", "unreadable", "empty" or "render".

const MAX_SIDE = 3200;   // px, the longer side of the drawn page; the upload then sizes it down as usual

let _lib = null;
const _search = new URL(import.meta.url).search;
const _vendor = (path) => new URL(`../vendor/pdfjs/${path}`, import.meta.url).href;

async function _pdfjs(){
  if (_lib) return _lib;
  const lib = await import(`../vendor/pdfjs/pdf.min.js${_search}`);
  lib.GlobalWorkerOptions.workerSrc = _vendor(`pdf.worker.min.js${_search}`);
  _lib = lib;
  return lib;
}

const _fail = (code, message) => Object.assign(new Error(message), { code });

/** Page `pageNo` (1-based) of a PDF file drawn as a PNG File named after the PDF.
 *  Returns { file, pages, page }. Throws an Error with .code when it can't. */
export async function pdfPageToPng(file, pageNo = 1, maxSide = MAX_SIDE){
  const lib = await _pdfjs();
  const data = new Uint8Array(await file.arrayBuffer());
  let doc;
  try {
    doc = await lib.getDocument({ data, wasmUrl: _vendor("wasm/"), standardFontDataUrl: _vendor("standard_fonts/") }).promise;
  } catch (e) {
    if (e && e.name === "PasswordException") throw _fail("password", "This PDF is password-protected.");
    throw _fail("unreadable", "This file could not be read as a PDF.");
  }
  try {
    const pages = doc.numPages;
    if (!pages) throw _fail("empty", "This PDF has no pages.");
    const n = Math.min(Math.max(1, Math.round(Number(pageNo) || 1)), pages);
    let canvas;
    try {
      const page = await doc.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(8, maxSide / Math.max(base.width, base.height));
      const viewport = page.getViewport({ scale });
      canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(viewport.width));
      canvas.height = Math.max(1, Math.round(viewport.height));
      const g = canvas.getContext("2d");
      g.fillStyle = "#ffffff";                       // a PDF page is paper: no see-through background
      g.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, canvasContext: g, viewport, background: "#ffffff" }).promise;
    } catch (e) {
      throw _fail("render", "This PDF page could not be drawn.");
    }
    const blob = await new Promise((res) => canvas.toBlob(res, "image/png"));
    if (!blob) throw _fail("render", "This PDF page could not be drawn.");
    const stem = String(file.name || "plan").replace(/\.pdf$/i, "");
    const name = pages > 1 ? `${stem} (page ${n}).png` : `${stem}.png`;
    return { file: new File([blob], name, { type: "image/png" }), pages, page: n };
  } finally {
    try { await doc.destroy(); } catch (_) { /* already gone */ }
  }
}
