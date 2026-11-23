// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// A PDF floor plan as a picture, for Mapping → Upload: one page drawn in the
// browser by PDF.js (vendor/pdfjs, Apache-2.0) and handed back as a PNG file,
// so the upload goes on exactly as it does for a photo or a scan. PDF.js is
// loaded only when a PDF is picked.

const MAX_SIDE = 3200;   // px, the longer side of the drawn page; the upload then sizes it down as usual

let _lib = null;
async function _pdfjs(){
  if (_lib) return _lib;
  const search = new URL(import.meta.url).search;
  const lib = await import(`../vendor/pdfjs/pdf.min.js${search}`);
  lib.GlobalWorkerOptions.workerSrc = new URL(`../vendor/pdfjs/pdf.worker.min.js${search}`, import.meta.url).href;
  _lib = lib;
  return lib;
}

/** Is this file a PDF (by its type, or by its name when the browser gives none)? */
export function isPdf(file){
  return !!file && (file.type === "application/pdf" || /\.pdf$/i.test(file.name || ""));
}

/** Page `pageNo` (1-based) of a PDF file drawn as a PNG File named after the PDF.
 *  Returns { file, pages, page }. Throws with a plain message when it can't. */
export async function pdfPageToPng(file, pageNo = 1, maxSide = MAX_SIDE){
  const lib = await _pdfjs();
  const data = new Uint8Array(await file.arrayBuffer());
  let doc;
  try {
    doc = await lib.getDocument({ data, isEvalSupported: false }).promise;
  } catch (e) {
    const why = e && e.name === "PasswordException" ? "it is password-protected" : "it could not be read as a PDF";
    throw new Error(`This PDF can't be used: ${why}.`);
  }
  try {
    const pages = doc.numPages;
    const n = Math.min(Math.max(1, Math.round(Number(pageNo) || 1)), pages);
    const page = await doc.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(8, maxSide / Math.max(base.width, base.height));
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(viewport.width));
    canvas.height = Math.max(1, Math.round(viewport.height));
    const g = canvas.getContext("2d");
    g.fillStyle = "#ffffff";                       // a PDF page is paper: no see-through background
    g.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas, canvasContext: g, viewport, background: "#ffffff" }).promise;
    const blob = await new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("The PDF page could not be turned into a picture."))), "image/png"));
    const stem = String(file.name || "plan").replace(/\.pdf$/i, "");
    const name = pages > 1 ? `${stem} (page ${n}).png` : `${stem}.png`;
    return { file: new File([blob], name, { type: "image/png" }), pages, page: n };
  } finally {
    try { await doc.destroy(); } catch (_) { /* already gone */ }
  }
}
