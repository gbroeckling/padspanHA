// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// A WebGL2 context for the node harnesses that run the real 3D view
// (views/live_aboard.js) under the DOM shim: it answers what three.js asks
// and draws nothing. Install the shim first.

// A WebGL2 context that answers what three.js asks and draws nothing.
function stubGL(canvas){
  const names = {}, nums = {};
  let n = 0x9000;
  const param = (name) => (name === "VERSION" ? "WebGL 2.0" : name === "SHADING_LANGUAGE_VERSION" ? "WebGL GLSL ES 3.00"
    : name === "SCISSOR_BOX" || name === "VIEWPORT" ? new Int32Array([0, 0, 300, 150]) : name.startsWith("MAX_") ? 4096 : 0);
  const gl = {
    canvas, drawingBufferWidth: 300, drawingBufferHeight: 150,
    getParameter: (p) => param(names[p] || ""),
    getShaderPrecisionFormat: () => ({ precision: 23, rangeMin: 127, rangeMax: 127 }),
    getContextAttributes: () => ({ alpha: false, antialias: false, depth: true, stencil: false, premultipliedAlpha: true, preserveDrawingBuffer: false }),
    getExtension: () => null, getSupportedExtensions: () => [],
    getShaderParameter: () => true, getProgramParameter: (_p, k) => (names[k] === "LINK_STATUS" ? true : 0),
    getShaderInfoLog: () => "", getProgramInfoLog: () => "", isContextLost: () => false, getError: () => 0,
    checkFramebufferStatus: () => nums.FRAMEBUFFER_COMPLETE, getUniformLocation: () => ({}), getAttribLocation: () => -1,
    getActiveUniform: () => null, getActiveAttrib: () => null,
  };
  return new Proxy(gl, {
    get(o, k){
      if (k in o) return o[k];
      if (typeof k === "string" && /^[A-Z][A-Z0-9_]*$/.test(k)) { if (!(k in nums)) { nums[k] = ++n; names[n] = k; } return nums[k]; }
      if (typeof k === "string" && k.startsWith("create")) return () => ({});
      return () => undefined;
    },
  });
}
/** Every canvas (the DOM shim's Node) answers "webgl2" with the stub. */
export function installStubGL(){
  const realGetContext = globalThis.Node.prototype.getContext;
  globalThis.Node.prototype.getContext = function(kind, ...a){ return /webgl/i.test(String(kind)) ? stubGL(this) : realGetContext.call(this, kind, ...a); };
}
