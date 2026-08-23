// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
// views/training.js — PadSpan HA Training Hub
// Walkthroughs: animated step-by-step SVG guides
// Manual: auto-generated from HELP dict in help_content.js + supplement content
// Auto-update: manual sections read HELP at render time — update help_content.js = manual updates too

// ─── Animated SVG Builders ────────────────────────────────────────────────────

function _svgBleSignals() {
  return `<svg viewBox="0 0 400 220" xmlns="http://www.w3.org/2000/svg" width="100%" style="max-height:200px;background:#071008;border-radius:8px;display:block">
<style>
@keyframes wave{0%{r:8;opacity:0.8}100%{r:44;opacity:0}}
.w1{animation:wave 2s ease-out infinite}
.w2{animation:wave 2s ease-out 0.67s infinite}
.w3{animation:wave 2s ease-out 1.33s infinite}
@keyframes scanPulse{0%,100%{opacity:1}50%{opacity:0.4}}
.sc{animation:scanPulse 1.5s ease-in-out infinite}
</style>
<text x="200" y="16" text-anchor="middle" fill="#52b788" font-size="11" font-weight="600" font-family="system-ui">3 scanners detect the same phone</text>
<circle class="w1" cx="200" cy="110" fill="none" stroke="#52b788" stroke-width="1.5" r="8"/>
<circle class="w2" cx="200" cy="110" fill="none" stroke="#52b788" stroke-width="1.5" r="8"/>
<circle class="w3" cx="200" cy="110" fill="none" stroke="#52b788" stroke-width="1.5" r="8"/>
<rect x="183" y="85" width="34" height="50" rx="5" fill="#1b3526" stroke="#52b788" stroke-width="2"/>
<rect x="190" y="92" width="20" height="30" rx="2" fill="#071008"/>
<circle cx="200" cy="128" r="3" fill="#52b788"/>
<g class="sc" transform="translate(60,44)">
  <rect x="-18" y="-18" width="36" height="36" rx="6" fill="#0d2318" stroke="#43a047" stroke-width="1.5"/>
  <circle cx="0" cy="-3" r="8" fill="none" stroke="#43a047" stroke-width="2"/>
  <circle cx="0" cy="-3" r="4" fill="none" stroke="#43a047" stroke-width="1.5"/>
  <circle cx="0" cy="-3" r="2" fill="#43a047"/>
</g>
<text x="60" y="78" text-anchor="middle" fill="#4a6052" font-size="9" font-family="system-ui">Living Room</text>
<g class="sc" transform="translate(340,44)">
  <rect x="-18" y="-18" width="36" height="36" rx="6" fill="#0d2318" stroke="#43a047" stroke-width="1.5"/>
  <circle cx="0" cy="-3" r="8" fill="none" stroke="#43a047" stroke-width="2"/>
  <circle cx="0" cy="-3" r="4" fill="none" stroke="#43a047" stroke-width="1.5"/>
  <circle cx="0" cy="-3" r="2" fill="#43a047"/>
</g>
<text x="340" y="78" text-anchor="middle" fill="#4a6052" font-size="9" font-family="system-ui">Kitchen</text>
<g class="sc" transform="translate(200,190)">
  <rect x="-18" y="-18" width="36" height="36" rx="6" fill="#0d2318" stroke="#43a047" stroke-width="1.5"/>
  <circle cx="0" cy="-3" r="8" fill="none" stroke="#43a047" stroke-width="2"/>
  <circle cx="0" cy="-3" r="4" fill="none" stroke="#43a047" stroke-width="1.5"/>
  <circle cx="0" cy="-3" r="2" fill="#43a047"/>
</g>
<text x="200" y="215" text-anchor="middle" fill="#4a6052" font-size="9" font-family="system-ui">Hallway</text>
<line x1="200" y1="110" x2="60" y2="44" stroke="#52b788" stroke-width="0.8" stroke-dasharray="4,3" opacity="0.4"/>
<line x1="200" y1="110" x2="340" y2="44" stroke="#52b788" stroke-width="0.8" stroke-dasharray="4,3" opacity="0.4"/>
<line x1="200" y1="110" x2="200" y2="172" stroke="#52b788" stroke-width="0.8" stroke-dasharray="4,3" opacity="0.4"/>
</svg>`;
}

function _svgRssiComparison() {
  return `<svg viewBox="0 0 400 220" xmlns="http://www.w3.org/2000/svg" width="100%" style="max-height:200px;background:#071008;border-radius:8px;display:block">
<style>
@keyframes highlight{0%,100%{fill:#0d2318;stroke:#43a047}50%{fill:#1b4a2e;stroke:#52b788}}
.winner{animation:highlight 2s ease-in-out infinite}
</style>
<text x="200" y="16" text-anchor="middle" fill="#52b788" font-size="11" font-weight="600" font-family="system-ui">Strongest signal = nearest room</text>
<rect x="20" y="28" width="100" height="155" rx="8" fill="#071008" stroke="#1b3526" stroke-width="1.5"/>
<text x="70" y="48" text-anchor="middle" fill="#94a3b8" font-size="10" font-family="system-ui">Kitchen</text>
<text x="70" y="62" text-anchor="middle" fill="#4a6052" font-size="9" font-family="system-ui">−82 dBm</text>
<rect x="46" y="78" width="48" height="80" rx="3" fill="#1b3526"/>
<rect x="46" y="138" width="48" height="20" rx="3" fill="#ef4444" opacity="0.7"/>
<text x="70" y="174" text-anchor="middle" fill="#ef4444" font-size="9" font-family="system-ui">Weak</text>
<rect class="winner" x="150" y="28" width="100" height="155" rx="8" fill="#0d2318" stroke="#52b788" stroke-width="2"/>
<text x="200" y="48" text-anchor="middle" fill="#52b788" font-size="10" font-family="system-ui">Living Room</text>
<text x="200" y="62" text-anchor="middle" fill="#52b788" font-size="9" font-family="system-ui">−52 dBm</text>
<rect x="176" y="78" width="48" height="80" rx="3" fill="#1b3526"/>
<rect x="176" y="84" width="48" height="74" rx="3" fill="#52b788" opacity="0.85"/>
<text x="200" y="174" text-anchor="middle" fill="#52b788" font-size="9" font-family="system-ui">★ Nearest</text>
<rect x="280" y="28" width="100" height="155" rx="8" fill="#071008" stroke="#1b3526" stroke-width="1.5"/>
<text x="330" y="48" text-anchor="middle" fill="#94a3b8" font-size="10" font-family="system-ui">Hallway</text>
<text x="330" y="62" text-anchor="middle" fill="#4a6052" font-size="9" font-family="system-ui">−71 dBm</text>
<rect x="306" y="78" width="48" height="80" rx="3" fill="#1b3526"/>
<rect x="306" y="120" width="48" height="38" rx="3" fill="#fbbf24" opacity="0.7"/>
<text x="330" y="174" text-anchor="middle" fill="#fbbf24" font-size="9" font-family="system-ui">Medium</text>
<text x="200" y="208" text-anchor="middle" fill="#94a3b8" font-size="9" font-family="system-ui">→ Device placed in Living Room</text>
</svg>`;
}

function _svgRoomAssignment() {
  return `<svg viewBox="0 0 400 220" xmlns="http://www.w3.org/2000/svg" width="100%" style="max-height:200px;background:#071008;border-radius:8px;display:block">
<style>
@keyframes dotPulse{0%,100%{r:10;opacity:1}50%{r:16;opacity:0.5}}
.dot{animation:dotPulse 2s ease-in-out infinite}
@keyframes roomGlow{0%,100%{stroke:#52b788;fill:#0d2318}50%{stroke:#81c784;fill:#142e1a}}
.activeRoom{animation:roomGlow 2s ease-in-out infinite}
@keyframes refreshTick{0%{opacity:0.3}45%{opacity:0.3}50%{opacity:1}55%{opacity:1}100%{opacity:0.3}}
.refreshTxt{animation:refreshTick 5s ease-in-out infinite}
</style>
<text x="200" y="16" text-anchor="middle" fill="#52b788" font-size="11" font-weight="600" font-family="system-ui">Device assigned to room — updates every 5s</text>
<rect x="10" y="28" width="116" height="76" rx="6" fill="#071008" stroke="#1b3526" stroke-width="1.5"/>
<text x="68" y="48" text-anchor="middle" fill="#4a6052" font-size="10" font-family="system-ui">Kitchen</text>
<rect class="activeRoom" x="138" y="28" width="124" height="76" rx="6" fill="#0d2318" stroke="#52b788" stroke-width="2"/>
<text x="200" y="48" text-anchor="middle" fill="#52b788" font-size="10" font-weight="600" font-family="system-ui">Living Room</text>
<circle class="dot" cx="200" cy="78" r="10" fill="#14b8a6"/>
<text x="200" y="82" text-anchor="middle" fill="white" font-size="8" font-weight="700" font-family="system-ui">AL</text>
<rect x="274" y="28" width="116" height="76" rx="6" fill="#071008" stroke="#1b3526" stroke-width="1.5"/>
<text x="332" y="48" text-anchor="middle" fill="#4a6052" font-size="10" font-family="system-ui">Hallway</text>
<rect x="10" y="116" width="116" height="76" rx="6" fill="#071008" stroke="#1b3526" stroke-width="1.5"/>
<text x="68" y="136" text-anchor="middle" fill="#4a6052" font-size="10" font-family="system-ui">Bedroom</text>
<rect x="138" y="116" width="124" height="76" rx="6" fill="#071008" stroke="#1b3526" stroke-width="1.5"/>
<text x="200" y="136" text-anchor="middle" fill="#4a6052" font-size="10" font-family="system-ui">Bathroom</text>
<rect x="274" y="116" width="116" height="76" rx="6" fill="#071008" stroke="#1b3526" stroke-width="1.5"/>
<text x="332" y="136" text-anchor="middle" fill="#4a6052" font-size="10" font-family="system-ui">Office</text>
<text class="refreshTxt" x="200" y="210" text-anchor="middle" fill="#4a6052" font-size="9" font-family="system-ui">↻ Auto-refreshes in Live mode</text>
</svg>`;
}

function _svgDeviceTypes() {
  return `<svg viewBox="0 0 400 220" xmlns="http://www.w3.org/2000/svg" width="100%" style="max-height:200px;background:#071008;border-radius:8px;display:block">
<style>
@keyframes fadeUp{0%{opacity:0;transform:translateY(8px)}100%{opacity:1;transform:translateY(0)}}
.d1{animation:fadeUp 0.4s ease-out 0.1s both}
.d2{animation:fadeUp 0.4s ease-out 0.35s both}
.d3{animation:fadeUp 0.4s ease-out 0.6s both}
.d4{animation:fadeUp 0.4s ease-out 0.85s both}
.d5{animation:fadeUp 0.4s ease-out 1.1s both}
</style>
<text x="200" y="16" text-anchor="middle" fill="#52b788" font-size="11" font-weight="600" font-family="system-ui">Any Bluetooth device can be tracked</text>
<g class="d1">
  <circle cx="36" cy="52" r="14" fill="#14b8a6" opacity="0.15" stroke="#14b8a6" stroke-width="1.5"/>
  <text x="36" y="57" text-anchor="middle" fill="#14b8a6" font-size="14" font-family="system-ui">📱</text>
  <text x="60" y="47" fill="#cbd5e1" font-size="11" font-weight="600" font-family="system-ui">Smartphones</text>
  <text x="60" y="60" fill="#4a6052" font-size="9" font-family="system-ui">Via Home Assistant companion app</text>
</g>
<g class="d2">
  <circle cx="36" cy="98" r="14" fill="#14b8a6" opacity="0.15" stroke="#14b8a6" stroke-width="1.5"/>
  <text x="36" y="103" text-anchor="middle" fill="#14b8a6" font-size="14" font-family="system-ui">🏷️</text>
  <text x="60" y="93" fill="#cbd5e1" font-size="11" font-weight="600" font-family="system-ui">AirTags &amp; Tile</text>
  <text x="60" y="106" fill="#4a6052" font-size="9" font-family="system-ui">Apple &amp; Tile Bluetooth trackers</text>
</g>
<g class="d3">
  <circle cx="36" cy="144" r="14" fill="#fb923c" opacity="0.15" stroke="#fb923c" stroke-width="1.5"/>
  <text x="36" y="149" text-anchor="middle" fill="#fb923c" font-size="14" font-family="system-ui">🔑</text>
  <text x="60" y="139" fill="#cbd5e1" font-size="11" font-weight="600" font-family="system-ui">Key Fobs &amp; Tags</text>
  <text x="60" y="152" fill="#4a6052" font-size="9" font-family="system-ui">Any small BLE beacon or tracker</text>
</g>
<g class="d4">
  <circle cx="236" cy="52" r="14" fill="#14b8a6" opacity="0.15" stroke="#14b8a6" stroke-width="1.5"/>
  <text x="236" y="57" text-anchor="middle" fill="#14b8a6" font-size="14" font-family="system-ui">⌚</text>
  <text x="260" y="47" fill="#cbd5e1" font-size="11" font-weight="600" font-family="system-ui">Smartwatches</text>
  <text x="260" y="60" fill="#4a6052" font-size="9" font-family="system-ui">Apple Watch, Fitbit, Garmin</text>
</g>
<g class="d5">
  <circle cx="236" cy="98" r="14" fill="#fb923c" opacity="0.15" stroke="#fb923c" stroke-width="1.5"/>
  <text x="236" y="103" text-anchor="middle" fill="#fb923c" font-size="14" font-family="system-ui">📡</text>
  <text x="260" y="93" fill="#cbd5e1" font-size="11" font-weight="600" font-family="system-ui">Unknown BLE</text>
  <text x="260" y="106" fill="#4a6052" font-size="9" font-family="system-ui">Any BLE signal — tap Tag to name it</text>
</g>
<rect x="10" y="175" width="180" height="36" rx="6" fill="#071008" stroke="#14b8a6" stroke-width="1" opacity="0.7"/>
<circle cx="26" cy="193" r="6" fill="#14b8a6" opacity="0.5"/><text x="40" y="197" fill="#14b8a6" font-size="9" font-family="system-ui">Teal = Identified (named)</text>
<rect x="210" y="175" width="180" height="36" rx="6" fill="#071008" stroke="#fb923c" stroke-width="1" opacity="0.7"/>
<circle cx="226" cy="193" r="6" fill="#fb923c" opacity="0.5"/><text x="240" y="197" fill="#fb923c" font-size="9" font-family="system-ui">Orange = Unidentified</text>
</svg>`;
}

function _svgObjectsList() {
  return `<svg viewBox="0 0 400 220" xmlns="http://www.w3.org/2000/svg" width="100%" style="max-height:200px;background:#071008;border-radius:8px;display:block">
<style>
@keyframes rowHighlight{0%,100%{fill:#071008}50%{fill:#1a1000}}
.unidRow{animation:rowHighlight 2s ease-in-out infinite}
@keyframes badgePulse{0%,100%{opacity:1}50%{opacity:0.4}}
.badge{animation:badgePulse 1.5s ease-in-out infinite}
</style>
<text x="200" y="14" text-anchor="middle" fill="#52b788" font-size="11" font-weight="600" font-family="system-ui">Find an unidentified device</text>
<rect x="10" y="22" width="380" height="24" rx="4" fill="#0d2318"/>
<text x="30" y="38" fill="#52b788" font-size="10" font-weight="600" font-family="system-ui">Name / Address</text>
<text x="210" y="38" fill="#52b788" font-size="10" font-weight="600" font-family="system-ui">Room</text>
<text x="295" y="38" fill="#52b788" font-size="10" font-weight="600" font-family="system-ui">Status</text>
<text x="360" y="38" fill="#52b788" font-size="10" font-weight="600" font-family="system-ui">Tag</text>
<rect x="10" y="50" width="380" height="30" rx="4" fill="#071008" stroke="#1b3526" stroke-width="0.5"/>
<circle cx="24" cy="65" r="7" fill="#14b8a6" opacity="0.25" stroke="#14b8a6" stroke-width="1"/>
<circle cx="24" cy="65" r="3" fill="#14b8a6"/>
<text x="38" y="69" fill="#cbd5e1" font-size="10" font-family="system-ui">Alice's Phone</text>
<text x="210" y="69" fill="#94a3b8" font-size="10" font-family="system-ui">Living Room</text>
<rect x="291" y="58" width="54" height="16" rx="8" fill="#14b8a6" opacity="0.15"/>
<text x="318" y="70" text-anchor="middle" fill="#14b8a6" font-size="9" font-family="system-ui">Identified</text>
<rect class="unidRow" x="10" y="84" width="380" height="34" rx="4" fill="#071008" stroke="#fb923c" stroke-width="1.2"/>
<circle cx="24" cy="101" r="7" fill="#fb923c" opacity="0.25" stroke="#fb923c" stroke-width="1"/>
<circle cx="24" cy="101" r="3" fill="#fb923c"/>
<text x="38" y="97" fill="#94a3b8" font-size="9" font-family="monospace">AA:BB:CC:11:22:33</text>
<text x="38" y="111" fill="#4a6052" font-size="8" font-family="system-ui">Unknown device</text>
<text x="210" y="104" fill="#94a3b8" font-size="10" font-family="system-ui">Hallway</text>
<rect class="badge" x="289" y="92" width="62" height="16" rx="8" fill="#fb923c" opacity="0.15"/>
<text x="320" y="104" text-anchor="middle" fill="#fb923c" font-size="9" font-family="system-ui">Unidentified</text>
<rect x="352" y="92" width="32" height="16" rx="4" fill="#1b3526" stroke="#52b788" stroke-width="1"/>
<text x="368" y="104" text-anchor="middle" fill="#52b788" font-size="9" font-family="system-ui">Tag</text>
<rect x="10" y="122" width="380" height="30" rx="4" fill="#071008" stroke="#1b3526" stroke-width="0.5"/>
<circle cx="24" cy="137" r="7" fill="#14b8a6" opacity="0.25" stroke="#14b8a6" stroke-width="1"/>
<circle cx="24" cy="137" r="3" fill="#14b8a6"/>
<text x="38" y="141" fill="#cbd5e1" font-size="10" font-family="system-ui">Car Keys</text>
<text x="210" y="141" fill="#94a3b8" font-size="10" font-family="system-ui">Kitchen</text>
<rect x="291" y="129" width="54" height="16" rx="8" fill="#14b8a6" opacity="0.15"/>
<text x="318" y="141" text-anchor="middle" fill="#14b8a6" font-size="9" font-family="system-ui">Identified</text>
<text x="200" y="210" text-anchor="middle" fill="#fb923c" font-size="10" font-family="system-ui">↑ Click Tag on the orange row to name this device</text>
</svg>`;
}

function _svgTagModal() {
  return `<svg viewBox="0 0 400 220" xmlns="http://www.w3.org/2000/svg" width="100%" style="max-height:200px;background:#071008;border-radius:8px;display:block">
<style>
@keyframes blink{0%,100%{opacity:1}50%{opacity:0}}
.cursor{animation:blink 1s step-end infinite}
@keyframes typeIn{0%{clip-path:inset(0 100% 0 0)}100%{clip-path:inset(0 0% 0 0)}}
.typed{animation:typeIn 1.5s steps(12) 0.4s both}
@keyframes modalIn{0%{opacity:0;transform:scale(0.95)}100%{opacity:1;transform:scale(1)}}
.modal{animation:modalIn 0.3s ease-out both}
</style>
<rect x="0" y="0" width="400" height="220" fill="#000" opacity="0.45"/>
<g class="modal">
  <rect x="80" y="20" width="240" height="180" rx="10" fill="#0d2318" stroke="#52b788" stroke-width="1.5"/>
  <text x="200" y="48" text-anchor="middle" fill="#52b788" font-size="12" font-weight="700" font-family="system-ui">Tag Device</text>
  <text x="200" y="64" text-anchor="middle" fill="#4a6052" font-size="9" font-family="monospace">AA:BB:CC:11:22:33</text>
  <text x="100" y="90" fill="#94a3b8" font-size="10" font-family="system-ui">Friendly name</text>
  <rect x="96" y="98" width="208" height="28" rx="5" fill="#071008" stroke="#52b788" stroke-width="1.5"/>
  <g class="typed"><text x="104" y="117" fill="#cbd5e1" font-size="11" font-family="system-ui">My AirTag</text></g>
  <text class="cursor" x="170" y="117" fill="#52b788" font-size="13" font-family="system-ui">|</text>
  <rect x="96" y="142" width="95" height="28" rx="5" fill="#1b3526" stroke="#52b788" stroke-width="1.5"/>
  <text x="143" y="161" text-anchor="middle" fill="#52b788" font-size="11" font-family="system-ui">Save</text>
  <rect x="204" y="142" width="95" height="28" rx="5" fill="#071008" stroke="#1b3526" stroke-width="1"/>
  <text x="251" y="161" text-anchor="middle" fill="#4a6052" font-size="11" font-family="system-ui">Cancel</text>
</g>
</svg>`;
}

function _svgTaggedDevice() {
  return `<svg viewBox="0 0 400 220" xmlns="http://www.w3.org/2000/svg" width="100%" style="max-height:200px;background:#071008;border-radius:8px;display:block">
<style>
@keyframes popIn{0%{transform:scale(0);opacity:0}70%{transform:scale(1.08)}100%{transform:scale(1);opacity:1}}
.popIn{animation:popIn 0.5s ease-out both}
.popIn2{animation:popIn 0.5s ease-out 0.3s both}
.popIn3{animation:popIn 0.5s ease-out 0.6s both}
@keyframes sweep{0%,100%{opacity:0.4}50%{opacity:1}}
.sweep{animation:sweep 2s ease-in-out infinite}
</style>
<text x="200" y="14" text-anchor="middle" fill="#52b788" font-size="11" font-weight="600" font-family="system-ui">Your name appears everywhere instantly</text>
<g class="popIn">
  <rect x="10" y="24" width="185" height="88" rx="8" fill="#0a150e" stroke="#5eead4" stroke-width="1.5"/>
  <text x="22" y="42" fill="#5eead4" font-size="10" font-weight="600" font-family="system-ui">Follow</text>
  <rect x="18" y="48" width="170" height="26" rx="5" fill="#071008" stroke="#1b3526" stroke-width="1"/>
  <circle class="sweep" cx="32" cy="61" r="6" fill="#14b8a6" opacity="0.4"/>
  <circle cx="32" cy="61" r="3" fill="#14b8a6"/>
  <text x="44" y="65" fill="#cbd5e1" font-size="10" font-family="system-ui">My AirTag ▾</text>
  <text x="22" y="88" fill="#4a6052" font-size="9" font-family="system-ui">Location: Living Room</text>
  <text x="22" y="102" fill="#4a6052" font-size="9" font-family="system-ui">Signal: −54 dBm · 2s ago</text>
</g>
<g class="popIn2">
  <rect x="205" y="24" width="185" height="88" rx="8" fill="#0a150e" stroke="#52b788" stroke-width="1.5"/>
  <text x="218" y="42" fill="#52b788" font-size="10" font-weight="600" font-family="system-ui">Overview</text>
  <rect x="214" y="48" width="170" height="56" rx="5" fill="#0d2318" stroke="#52b788" stroke-width="1"/>
  <text x="299" y="66" text-anchor="middle" fill="#52b788" font-size="9" font-family="system-ui">Living Room</text>
  <circle cx="299" cy="88" r="11" fill="#14b8a6" opacity="0.2" stroke="#14b8a6" stroke-width="1.5"/>
  <circle cx="299" cy="88" r="5" fill="#14b8a6"/>
  <text x="299" y="91" text-anchor="middle" fill="#071008" font-size="6" font-weight="700" font-family="system-ui">MA</text>
</g>
<g class="popIn3">
  <rect x="10" y="124" width="185" height="72" rx="8" fill="#0a150e" stroke="#ff8a65" stroke-width="1.5"/>
  <text x="22" y="142" fill="#ff8a65" font-size="10" font-weight="600" font-family="system-ui">Objects</text>
  <circle cx="28" cy="168" r="7" fill="#14b8a6" opacity="0.25" stroke="#14b8a6" stroke-width="1"/>
  <circle cx="28" cy="168" r="3" fill="#14b8a6"/>
  <text x="42" y="172" fill="#cbd5e1" font-size="10" font-family="system-ui">My AirTag</text>
  <rect x="116" y="161" width="54" height="15" rx="7" fill="#14b8a6" opacity="0.15"/>
  <text x="143" y="172" text-anchor="middle" fill="#14b8a6" font-size="8" font-family="system-ui">Identified ✓</text>
</g>
<rect x="205" y="124" width="185" height="72" rx="8" fill="#0a150e" stroke="#1b3526" stroke-width="1.5"/>
<text x="218" y="142" fill="#4a6052" font-size="10" font-weight="600" font-family="system-ui">Tip</text>
<text x="218" y="158" fill="#4a6052" font-size="9" font-family="system-ui">Click Relabel any time to</text>
<text x="218" y="171" fill="#4a6052" font-size="9" font-family="system-ui">rename the device.</text>
<text x="218" y="184" fill="#4a6052" font-size="9" font-family="system-ui">Changes apply everywhere.</text>
</svg>`;
}

function _svgUpload() {
  return `<svg viewBox="0 0 400 220" xmlns="http://www.w3.org/2000/svg" width="100%" style="max-height:200px;background:#071008;border-radius:8px;display:block">
<style>
@keyframes uploadArrow{0%,100%{transform:translateY(0)}50%{transform:translateY(-7px)}}
.upArrow{animation:uploadArrow 1.2s ease-in-out infinite;transform-origin:200px 120px}
@keyframes progressFill{0%{width:0}100%{width:200px}}
.progress{animation:progressFill 2s ease-out 1s both}
</style>
<rect x="40" y="14" width="320" height="196" rx="10" fill="#0a150e" stroke="#1b3526" stroke-width="1.5"/>
<text x="200" y="38" text-anchor="middle" fill="#52b788" font-size="12" font-weight="700" font-family="system-ui">Upload a Floor Plan</text>
<text x="60" y="62" fill="#94a3b8" font-size="10" font-family="system-ui">Map name</text>
<rect x="60" y="68" width="160" height="24" rx="5" fill="#071008" stroke="#1b3526" stroke-width="1"/>
<text x="72" y="85" fill="#cbd5e1" font-size="10" font-family="system-ui">Ground Floor</text>
<rect x="60" y="102" width="280" height="60" rx="6" fill="#071008" stroke="#253e2e" stroke-width="1" stroke-dasharray="6,4"/>
<g class="upArrow">
  <text x="200" y="128" text-anchor="middle" fill="#52b788" font-size="22" font-family="system-ui">⬆</text>
</g>
<text x="200" y="148" text-anchor="middle" fill="#4a6052" font-size="10" font-family="system-ui">Drop image here or click to browse</text>
<text x="200" y="160" text-anchor="middle" fill="#253e2e" font-size="9" font-family="system-ui">PNG · JPG · max 10 MB</text>
<rect x="130" y="176" width="140" height="26" rx="5" fill="#1b3526" stroke="#52b788" stroke-width="1.5"/>
<text x="200" y="193" text-anchor="middle" fill="#52b788" font-size="11" font-weight="600" font-family="system-ui">Upload &amp; Convert</text>
</svg>`;
}

function _svgDrawRooms() {
  return `<svg viewBox="0 0 400 220" xmlns="http://www.w3.org/2000/svg" width="100%" style="max-height:200px;background:#071008;border-radius:8px;display:block">
<style>
@keyframes drawPoly{0%{stroke-dashoffset:400}100%{stroke-dashoffset:0}}
.poly{animation:drawPoly 3s ease-out infinite;stroke-dasharray:400}
@keyframes ptPop{0%{r:0;opacity:0}100%{r:5;opacity:1}}
.pt1{animation:ptPop 0.3s ease-out 0.3s both}
.pt2{animation:ptPop 0.3s ease-out 0.8s both}
.pt3{animation:ptPop 0.3s ease-out 1.3s both}
.pt4{animation:ptPop 0.3s ease-out 1.8s both}
</style>
<rect x="10" y="14" width="248" height="194" rx="6" fill="#0a1a0f" stroke="#1b3526" stroke-width="1"/>
<polygon class="poly" points="28,32 200,32 200,148 28,148" fill="#52b788" fill-opacity="0.12" stroke="#52b788" stroke-width="2"/>
<circle class="pt1" cx="28" cy="32" r="5" fill="#52b788"/>
<circle class="pt2" cx="200" cy="32" r="5" fill="#52b788"/>
<circle class="pt3" cx="200" cy="148" r="5" fill="#52b788"/>
<circle class="pt4" cx="28" cy="148" r="5" fill="#52b788"/>
<text x="114" y="96" text-anchor="middle" fill="#52b788" font-size="11" font-weight="600" font-family="system-ui">Living Room</text>
<rect x="268" y="14" width="124" height="194" rx="6" fill="#050e08" stroke="#1b3526" stroke-width="1"/>
<text x="280" y="36" fill="#52b788" font-size="10" font-weight="600" font-family="system-ui">Draw Room</text>
<text x="280" y="54" fill="#4a6052" font-size="9" font-family="system-ui">Select room:</text>
<rect x="278" y="60" width="108" height="22" rx="4" fill="#071008" stroke="#1b3526" stroke-width="1"/>
<text x="290" y="75" fill="#cbd5e1" font-size="9" font-family="system-ui">Living Room ▾</text>
<text x="280" y="106" fill="#4a6052" font-size="9" font-family="system-ui">Click map to</text>
<text x="280" y="119" fill="#4a6052" font-size="9" font-family="system-ui">place points.</text>
<text x="280" y="132" fill="#4a6052" font-size="9" font-family="system-ui">Click first point</text>
<text x="280" y="145" fill="#4a6052" font-size="9" font-family="system-ui">to close shape.</text>
<rect x="278" y="178" width="108" height="22" rx="4" fill="#1b3526" stroke="#52b788" stroke-width="1"/>
<text x="332" y="193" text-anchor="middle" fill="#52b788" font-size="9" font-family="system-ui">Save Polygon</text>
</svg>`;
}

function _svgPlaceScanners() {
  return `<svg viewBox="0 0 400 220" xmlns="http://www.w3.org/2000/svg" width="100%" style="max-height:200px;background:#071008;border-radius:8px;display:block">
<style>
@keyframes scannerPop{0%{transform:scale(0);opacity:0}100%{transform:scale(1);opacity:1}}
.sc1{animation:scannerPop 0.4s ease-out 0.3s both}
.sc2{animation:scannerPop 0.4s ease-out 0.8s both}
.sc3{animation:scannerPop 0.4s ease-out 1.3s both}
@keyframes ringP{0%,100%{r:20;opacity:0.4}50%{r:28;opacity:0.12}}
.ring{animation:ringP 2s ease-in-out infinite}
</style>
<rect x="10" y="14" width="255" height="196" rx="6" fill="#0a1a0f" stroke="#1b3526" stroke-width="1"/>
<rect x="18" y="24" width="114" height="86" rx="4" fill="#1b3526" opacity="0.25" stroke="#253e2e" stroke-width="1"/>
<text x="75" y="72" text-anchor="middle" fill="#4a6052" font-size="10" font-family="system-ui">Living Room</text>
<rect x="140" y="24" width="118" height="86" rx="4" fill="#1b3526" opacity="0.15" stroke="#253e2e" stroke-width="1"/>
<text x="199" y="72" text-anchor="middle" fill="#4a6052" font-size="10" font-family="system-ui">Kitchen</text>
<rect x="18" y="120" width="240" height="84" rx="4" fill="#1b3526" opacity="0.15" stroke="#253e2e" stroke-width="1"/>
<text x="138" y="166" text-anchor="middle" fill="#4a6052" font-size="10" font-family="system-ui">Hallway</text>
<g class="sc1">
  <circle class="ring" cx="58" cy="62" fill="none" stroke="#43a047" stroke-width="1.2"/>
  <circle cx="58" cy="62" r="10" fill="#0d2318" stroke="#43a047" stroke-width="2"/>
  <circle cx="58" cy="62" r="5" fill="none" stroke="#43a047" stroke-width="1.5"/>
  <circle cx="58" cy="62" r="2" fill="#43a047"/>
</g>
<g class="sc2">
  <circle class="ring" cx="175" cy="62" fill="none" stroke="#43a047" stroke-width="1.2"/>
  <circle cx="175" cy="62" r="10" fill="#0d2318" stroke="#43a047" stroke-width="2"/>
  <circle cx="175" cy="62" r="5" fill="none" stroke="#43a047" stroke-width="1.5"/>
  <circle cx="175" cy="62" r="2" fill="#43a047"/>
</g>
<g class="sc3">
  <circle class="ring" cx="88" cy="156" fill="none" stroke="#43a047" stroke-width="1.2"/>
  <circle cx="88" cy="156" r="10" fill="#0d2318" stroke="#43a047" stroke-width="2"/>
  <circle cx="88" cy="156" r="5" fill="none" stroke="#43a047" stroke-width="1.5"/>
  <circle cx="88" cy="156" r="2" fill="#43a047"/>
</g>
<rect x="274" y="14" width="118" height="196" rx="6" fill="#050e08" stroke="#1b3526" stroke-width="1"/>
<text x="285" y="36" fill="#43a047" font-size="10" font-weight="600" font-family="system-ui">Receivers</text>
<text x="285" y="56" fill="#4a6052" font-size="9" font-family="system-ui">Click map to</text>
<text x="285" y="69" fill="#4a6052" font-size="9" font-family="system-ui">place a scanner</text>
<text x="285" y="96" fill="#94a3b8" font-size="9" font-family="system-ui">3 placed:</text>
<circle cx="290" cy="114" r="4" fill="#43a047"/><text x="300" y="118" fill="#4a6052" font-size="9" font-family="system-ui">Living Room</text>
<circle cx="290" cy="132" r="4" fill="#43a047"/><text x="300" y="136" fill="#4a6052" font-size="9" font-family="system-ui">Kitchen</text>
<circle cx="290" cy="150" r="4" fill="#43a047"/><text x="300" y="154" fill="#4a6052" font-size="9" font-family="system-ui">Hallway</text>
</svg>`;
}

function _svgKpiCards() {
  return `<svg viewBox="0 0 400 220" xmlns="http://www.w3.org/2000/svg" width="100%" style="max-height:200px;background:#071008;border-radius:8px;display:block">
<style>
@keyframes countUp{0%{opacity:0;transform:translateY(6px)}100%{opacity:1;transform:translateY(0)}}
.k1{animation:countUp 0.4s ease-out 0.1s both}
.k2{animation:countUp 0.4s ease-out 0.3s both}
.k3{animation:countUp 0.4s ease-out 0.5s both}
@keyframes clickHint{0%,100%{opacity:0.35}50%{opacity:1}}
.hint{animation:clickHint 1.5s ease-in-out infinite}
</style>
<text x="200" y="14" text-anchor="middle" fill="#52b788" font-size="11" font-weight="600" font-family="system-ui">Click any number to see a full list</text>
<g class="k1">
  <rect x="16" y="24" width="112" height="78" rx="8" fill="#0d2318" stroke="#52b788" stroke-width="1.5"/>
  <text x="72" y="48" text-anchor="middle" fill="#52b788" font-size="11" font-family="system-ui">Rooms</text>
  <text x="72" y="80" text-anchor="middle" fill="#52b788" font-size="30" font-weight="700" font-family="system-ui">6</text>
  <text class="hint" x="72" y="96" text-anchor="middle" fill="#52b788" font-size="9" font-family="system-ui">↗ tap to list</text>
</g>
<g class="k2">
  <rect x="144" y="24" width="112" height="78" rx="8" fill="#0d2318" stroke="#ff8a65" stroke-width="1.5"/>
  <text x="200" y="48" text-anchor="middle" fill="#ff8a65" font-size="11" font-family="system-ui">Objects</text>
  <text x="200" y="80" text-anchor="middle" fill="#ff8a65" font-size="30" font-weight="700" font-family="system-ui">12</text>
  <text class="hint" x="200" y="96" text-anchor="middle" fill="#ff8a65" font-size="9" font-family="system-ui">↗ tap to list</text>
</g>
<g class="k3">
  <rect x="272" y="24" width="112" height="78" rx="8" fill="#0d2318" stroke="#43a047" stroke-width="1.5"/>
  <text x="328" y="48" text-anchor="middle" fill="#43a047" font-size="11" font-family="system-ui">Radios</text>
  <text x="328" y="80" text-anchor="middle" fill="#43a047" font-size="30" font-weight="700" font-family="system-ui">3</text>
  <text class="hint" x="328" y="96" text-anchor="middle" fill="#43a047" font-size="9" font-family="system-ui">↗ tap to list</text>
</g>
<rect x="50" y="118" width="300" height="54" rx="8" fill="#0d2318" stroke="#253e2e" stroke-width="1"/>
<text x="200" y="138" text-anchor="middle" fill="#94a3b8" font-size="10" font-family="system-ui">Clicking opens a detail list — then click</text>
<text x="200" y="152" text-anchor="middle" fill="#94a3b8" font-size="10" font-family="system-ui">any row for full device / room / scanner info</text>
<text x="200" y="200" text-anchor="middle" fill="#4a6052" font-size="9" font-family="system-ui">Advanced mode shows all KPI cards</text>
</svg>`;
}

function _svgRoomGrid() {
  return `<svg viewBox="0 0 400 220" xmlns="http://www.w3.org/2000/svg" width="100%" style="max-height:200px;background:#071008;border-radius:8px;display:block">
<style>
@keyframes dp{0%,100%{r:7;opacity:1}50%{r:11;opacity:0.5}}
.teal{animation:dp 2s ease-in-out infinite}
@keyframes dp2{0%,100%{r:6;opacity:1}50%{r:9;opacity:0.5}}
.orange{animation:dp2 2.5s ease-in-out 0.5s infinite}
</style>
<text x="200" y="14" text-anchor="middle" fill="#52b788" font-size="11" font-weight="600" font-family="system-ui">Room grid — see what's in each room</text>
<rect x="8" y="22" width="188" height="90" rx="6" fill="#0d2318" stroke="#52b788" stroke-width="1.5"/>
<text x="20" y="38" fill="#52b788" font-size="9" font-weight="600" font-family="system-ui">Living Room</text>
<circle cx="46" cy="68" r="17" fill="none" stroke="#43a047" stroke-width="1.5" opacity="0.4"/>
<circle cx="46" cy="68" r="9" fill="none" stroke="#43a047" stroke-width="1.5" opacity="0.7"/>
<circle cx="46" cy="68" r="4" fill="#43a047"/>
<circle class="teal" cx="120" cy="62" r="7" fill="#14b8a6"/>
<text x="134" y="66" fill="#14b8a6" font-size="8" font-family="system-ui">Alice</text>
<circle class="orange" cx="155" cy="80" r="6" fill="#fb923c"/>
<rect x="204" y="22" width="188" height="90" rx="6" fill="#071008" stroke="#1b3526" stroke-width="1.5"/>
<text x="216" y="38" fill="#94a3b8" font-size="9" font-weight="600" font-family="system-ui">Kitchen</text>
<circle cx="270" cy="66" r="14" fill="none" stroke="#43a047" stroke-width="1.5" opacity="0.4"/>
<circle cx="270" cy="66" r="7" fill="none" stroke="#43a047" stroke-width="1" opacity="0.6"/>
<circle cx="270" cy="66" r="3" fill="#43a047" opacity="0.8"/>
<rect x="8" y="120" width="188" height="90" rx="6" fill="#071008" stroke="#1b3526" stroke-width="1.5"/>
<text x="20" y="136" fill="#94a3b8" font-size="9" font-weight="600" font-family="system-ui">Bedroom</text>
<rect x="204" y="120" width="188" height="90" rx="6" fill="#071008" stroke="#1b3526" stroke-width="1.5"/>
<text x="216" y="136" fill="#94a3b8" font-size="9" font-weight="600" font-family="system-ui">Hallway</text>
<circle class="teal" cx="312" cy="172" r="7" fill="#14b8a6" style="animation-delay:1s"/>
<text x="326" y="176" fill="#14b8a6" font-size="8" font-family="system-ui">Bob</text>
<circle cx="14" cy="217" r="5" fill="#14b8a6" opacity="0.7"/>
<text x="24" y="220" fill="#14b8a6" font-size="8" font-family="system-ui">Identified person/device</text>
<circle cx="168" cy="217" r="5" fill="#fb923c" opacity="0.7"/>
<text x="178" y="220" fill="#fb923c" font-size="8" font-family="system-ui">Unknown BLE signal</text>
</svg>`;
}

function _svgFollowTab() {
  return `<svg viewBox="0 0 400 220" xmlns="http://www.w3.org/2000/svg" width="100%" style="max-height:200px;background:#071008;border-radius:8px;display:block">
<style>
@keyframes locPulse{0%,100%{r:13;opacity:0.7}50%{r:20;opacity:0.25}}
.locPulse{animation:locPulse 2s ease-in-out infinite}
@keyframes histFade{0%{opacity:0;transform:translateY(3px)}100%{opacity:1;transform:translateY(0)}}
.h1{animation:histFade 0.3s ease-out 0.5s both}
.h2{animation:histFade 0.3s ease-out 0.9s both}
.h3{animation:histFade 0.3s ease-out 1.3s both}
</style>
<rect x="8" y="8" width="384" height="26" rx="6" fill="#0d2318" stroke="#1b3526" stroke-width="1"/>
<circle cx="26" cy="21" r="7" fill="#14b8a6" opacity="0.25" stroke="#14b8a6" stroke-width="1"/>
<circle cx="26" cy="21" r="3" fill="#14b8a6"/>
<text x="42" y="25" fill="#cbd5e1" font-size="11" font-family="system-ui">Alice's Phone</text>
<text x="368" y="25" fill="#4a6052" font-size="14" font-family="system-ui">▾</text>
<rect x="8" y="42" width="190" height="76" rx="6" fill="#0d2318" stroke="#52b788" stroke-width="1.5"/>
<text x="20" y="60" fill="#52b788" font-size="10" font-weight="600" font-family="system-ui">Current Location</text>
<text x="20" y="78" fill="#cbd5e1" font-size="13" font-weight="700" font-family="system-ui">Living Room</text>
<text x="20" y="94" fill="#4a6052" font-size="9" font-family="system-ui">Floor: Ground  ·  −54 dBm  ·  2s</text>
<rect x="206" y="42" width="186" height="76" rx="6" fill="#0a1a0f" stroke="#1b3526" stroke-width="1"/>
<rect x="214" y="50" width="80" height="58" rx="4" fill="#1b3526" opacity="0.45" stroke="#52b788" stroke-width="1.5"/>
<text x="254" y="68" text-anchor="middle" fill="#52b788" font-size="8" font-family="system-ui">Living Room</text>
<circle class="locPulse" cx="254" cy="96" fill="none" stroke="#14b8a6" stroke-width="1.5"/>
<circle cx="254" cy="96" r="7" fill="#14b8a6"/>
<rect x="302" y="50" width="84" height="58" rx="4" fill="#1b3526" opacity="0.15" stroke="#253e2e" stroke-width="1"/>
<text x="344" y="68" text-anchor="middle" fill="#253e2e" font-size="8" font-family="system-ui">Kitchen</text>
<rect x="8" y="126" width="384" height="84" rx="6" fill="#0a150e" stroke="#1b3526" stroke-width="1"/>
<text x="20" y="144" fill="#52b788" font-size="10" font-weight="600" font-family="system-ui">Movement History</text>
<g class="h1"><text x="20" y="162" fill="#4a6052" font-size="9" font-family="system-ui">14:32  Kitchen → Living Room</text></g>
<g class="h2"><text x="20" y="177" fill="#4a6052" font-size="9" font-family="system-ui">14:18  Hallway → Kitchen</text></g>
<g class="h3"><text x="20" y="192" fill="#4a6052" font-size="9" font-family="system-ui">13:55  Bedroom → Hallway</text></g>
</svg>`;
}

function _svgManageOverview() {
  return `<svg viewBox="0 0 400 220" xmlns="http://www.w3.org/2000/svg" width="100%" style="max-height:200px;background:#071008;border-radius:8px;display:block">
<style>
@keyframes tabHL{0%,100%{fill:#0d2318;stroke:#78909c}50%{fill:#1a2020;stroke:#b0bec5}}
.activeTab{animation:tabHL 2s ease-in-out infinite}
</style>
<rect x="0" y="0" width="108" height="220" fill="#050e08"/>
<text x="8" y="20" fill="#52b788" font-size="9" font-weight="700" font-family="system-ui">PadSpan™ HA</text>
<rect x="3" y="28" width="102" height="22" rx="5" fill="#071008"/>
<text x="16" y="43" fill="#94a3b8" font-size="9" font-family="system-ui">Settings</text>
<rect class="activeTab" x="3" y="54" width="102" height="22" rx="5" fill="#0d2318" stroke="#78909c" stroke-width="1.5"/>
<text x="16" y="69" fill="#b0bec5" font-size="9" font-weight="600" font-family="system-ui">Manage</text>
<rect x="3" y="80" width="102" height="22" rx="5" fill="#071008"/>
<text x="16" y="95" fill="#94a3b8" font-size="9" font-family="system-ui">Training</text>
<rect x="118" y="14" width="274" height="196" rx="8" fill="#0a150e" stroke="#1b3526" stroke-width="1"/>
<rect x="128" y="24" width="58" height="20" rx="4" fill="#0d2318" stroke="#78909c" stroke-width="1"/>
<text x="157" y="38" text-anchor="middle" fill="#b0bec5" font-size="9" font-family="system-ui">BLE Tags</text>
<rect x="192" y="24" width="58" height="20" rx="4" fill="#071008" stroke="#1b3526" stroke-width="1"/>
<text x="221" y="38" text-anchor="middle" fill="#4a6052" font-size="9" font-family="system-ui">Rooms</text>
<rect x="256" y="24" width="48" height="20" rx="4" fill="#071008" stroke="#1b3526" stroke-width="1"/>
<text x="280" y="38" text-anchor="middle" fill="#4a6052" font-size="9" font-family="system-ui">Data</text>
<rect x="128" y="52" width="256" height="26" rx="4" fill="#071008" stroke="#1b3526" stroke-width="0.5"/>
<circle cx="146" cy="65" r="5" fill="#14b8a6" opacity="0.6"/>
<text x="160" y="69" fill="#94a3b8" font-size="9" font-family="system-ui">Alice's AirTag</text>
<rect x="336" y="58" width="40" height="14" rx="3" fill="#1b3526" stroke="#52b788" stroke-width="1"/>
<text x="356" y="69" text-anchor="middle" fill="#52b788" font-size="8" font-family="system-ui">Delete</text>
<rect x="128" y="82" width="256" height="26" rx="4" fill="#071008" stroke="#1b3526" stroke-width="0.5"/>
<circle cx="146" cy="95" r="5" fill="#14b8a6" opacity="0.6"/>
<text x="160" y="99" fill="#94a3b8" font-size="9" font-family="system-ui">Car Keys</text>
<rect x="336" y="88" width="40" height="14" rx="3" fill="#1b3526" stroke="#52b788" stroke-width="1"/>
<text x="356" y="99" text-anchor="middle" fill="#52b788" font-size="8" font-family="system-ui">Delete</text>
<text x="255" y="168" text-anchor="middle" fill="#4a6052" font-size="9" font-family="system-ui">Advanced mode only</text>
<text x="255" y="184" text-anchor="middle" fill="#253e2e" font-size="9" font-family="system-ui">Toggle ⚡ Advanced in the top bar</text>
</svg>`;
}

function _svgUntagDevice() {
  return `<svg viewBox="0 0 400 220" xmlns="http://www.w3.org/2000/svg" width="100%" style="max-height:200px;background:#071008;border-radius:8px;display:block">
<style>
@keyframes fadeRow{0%,60%{opacity:1;transform:translateX(0)}100%{opacity:0;transform:translateX(30px)}}
.fadeRow{animation:fadeRow 1.2s ease-in 2.5s both}
@keyframes confirmPop{0%{opacity:0;transform:scale(0.85)}100%{opacity:1;transform:scale(1)}}
.confirm{animation:confirmPop 0.25s ease-out 1s both}
</style>
<rect x="8" y="14" width="384" height="22" rx="4" fill="#0d2318"/>
<text x="28" y="29" fill="#52b788" font-size="10" font-weight="600" font-family="system-ui">BLE Tags</text>
<text x="200" y="29" fill="#52b788" font-size="10" font-weight="600" font-family="system-ui">Last seen</text>
<text x="336" y="29" fill="#52b788" font-size="10" font-weight="600" font-family="system-ui">Action</text>
<g class="fadeRow">
  <rect x="8" y="40" width="384" height="30" rx="4" fill="#071008" stroke="#dc2626" stroke-width="1"/>
  <text x="28" y="59" fill="#94a3b8" font-size="10" font-family="system-ui">Sample AirTag</text>
  <text x="200" y="59" fill="#4a6052" font-size="9" font-family="system-ui">Sample data</text>
  <g class="confirm">
    <rect x="292" y="47" width="52" height="17" rx="4" fill="#7f1d1d" stroke="#dc2626" stroke-width="1"/>
    <text x="318" y="59" text-anchor="middle" fill="#fca5a5" font-size="8" font-family="system-ui">Yes, delete</text>
    <rect x="350" y="47" width="36" height="17" rx="4" fill="#071008" stroke="#1b3526" stroke-width="1"/>
    <text x="368" y="59" text-anchor="middle" fill="#4a6052" font-size="8" font-family="system-ui">Cancel</text>
  </g>
</g>
<rect x="8" y="74" width="384" height="30" rx="4" fill="#071008" stroke="#1b3526" stroke-width="0.5"/>
<text x="28" y="93" fill="#cbd5e1" font-size="10" font-family="system-ui">Alice's AirTag</text>
<text x="200" y="93" fill="#4a6052" font-size="9" font-family="system-ui">2 min ago</text>
<rect x="342" y="81" width="44" height="16" rx="4" fill="#1b3526" stroke="#52b788" stroke-width="1"/>
<text x="364" y="93" text-anchor="middle" fill="#52b788" font-size="8" font-family="system-ui">Delete</text>
<rect x="8" y="108" width="384" height="30" rx="4" fill="#071008" stroke="#1b3526" stroke-width="0.5"/>
<text x="28" y="127" fill="#cbd5e1" font-size="10" font-family="system-ui">Car Keys</text>
<text x="200" y="127" fill="#4a6052" font-size="9" font-family="system-ui">18 min ago</text>
<rect x="342" y="115" width="44" height="16" rx="4" fill="#1b3526" stroke="#52b788" stroke-width="1"/>
<text x="364" y="127" text-anchor="middle" fill="#52b788" font-size="8" font-family="system-ui">Delete</text>
<text x="200" y="180" text-anchor="middle" fill="#4a6052" font-size="9" font-family="system-ui">Two-click confirm prevents accidental deletes.</text>
<text x="200" y="196" text-anchor="middle" fill="#4a6052" font-size="9" font-family="system-ui">Device goes back to showing its hardware address.</text>
</svg>`;
}

function _svgOrphanClean() {
  return `<svg viewBox="0 0 400 220" xmlns="http://www.w3.org/2000/svg" width="100%" style="max-height:200px;background:#071008;border-radius:8px;display:block">
<style>
@keyframes orphanGlow{0%,100%{stroke:#f59e0b;opacity:0.7}50%{stroke:#fbbf24;opacity:1}}
.orphan{animation:orphanGlow 1.5s ease-in-out infinite}
@keyframes sweepAway{0%,60%{transform:translateX(0);opacity:1}100%{transform:translateX(220px);opacity:0}}
.sweep{animation:sweepAway 1.2s ease-in 3s both}
</style>
<rect x="8" y="8" width="384" height="92" rx="8" fill="#1a0e00" stroke="#f59e0b" stroke-width="1.5"/>
<text x="26" y="28" fill="#f59e0b" font-size="11" font-weight="600" font-family="system-ui">⚠ Orphan Room Polygons Found</text>
<text x="20" y="44" fill="#94a3b8" font-size="9" font-family="system-ui">These room shapes exist in your maps but don't match any HA area.</text>
<rect class="orphan sweep" x="18" y="52" width="370" height="22" rx="3" fill="#071008" stroke="#f59e0b" stroke-width="1"/>
<text x="28" y="67" fill="#fbbf24" font-size="10" font-family="system-ui">⚠ Sample Room</text>
<text x="188" y="67" fill="#4a6052" font-size="9" font-family="system-ui">Ground Floor map · 6 pts</text>
<rect x="326" y="56" width="54" height="15" rx="3" fill="#7f1d1d" stroke="#dc2626" stroke-width="1" class="sweep"/>
<text x="353" y="67" text-anchor="middle" fill="#fca5a5" font-size="8" font-family="system-ui">Delete</text>
<rect class="orphan" x="18" y="78" width="370" height="22" rx="3" fill="#071008" stroke="#f59e0b" stroke-width="1"/>
<text x="28" y="93" fill="#fbbf24" font-size="10" font-family="system-ui">⚠ Demo Area</text>
<text x="188" y="93" fill="#4a6052" font-size="9" font-family="system-ui">Level 2 map · 4 pts</text>
<rect x="326" y="82" width="54" height="15" rx="3" fill="#7f1d1d" stroke="#dc2626" stroke-width="1"/>
<text x="353" y="93" text-anchor="middle" fill="#fca5a5" font-size="8" font-family="system-ui">Delete</text>
<rect x="8" y="110" width="384" height="34" rx="8" fill="#071008" stroke="#dc2626" stroke-width="1.5"/>
<text x="200" y="132" text-anchor="middle" fill="#fca5a5" font-size="11" font-weight="600" font-family="system-ui">Delete ALL 2 orphans</text>
<text x="200" y="170" text-anchor="middle" fill="#4a6052" font-size="9" font-family="system-ui">Found in Manage → Data → Orphan Room Polygons</text>
<text x="200" y="186" text-anchor="middle" fill="#4a6052" font-size="9" font-family="system-ui">Usually leftover from sample mode or deleted rooms</text>
</svg>`;
}

function _svgIbeacon() {
  return `<svg viewBox="0 0 400 220" xmlns="http://www.w3.org/2000/svg" width="100%" style="max-height:200px;background:#071008;border-radius:8px;display:block">
<style>
@keyframes macFade{0%,40%{opacity:1}60%,100%{opacity:0.2}}
.mac1{animation:macFade 2.5s ease-in-out infinite}
.mac2{animation:macFade 2.5s ease-in-out 1.25s infinite}
@keyframes uuidGlow{0%,100%{stroke:#d97706;opacity:0.6}50%{stroke:#fbbf24;opacity:1}}
.uuid{animation:uuidGlow 2s ease-in-out infinite}
</style>
<text x="200" y="14" text-anchor="middle" fill="#52b788" font-size="11" font-weight="600" font-family="system-ui">iBeacon: stable UUID survives MAC rotation</text>
<text x="80" y="36" text-anchor="middle" fill="#94a3b8" font-size="10" font-weight="600" font-family="system-ui">Rotating MACs</text>
<g class="mac1">
  <rect x="20" y="44" width="120" height="28" rx="6" fill="#1a1000" stroke="#d97706" stroke-width="1"/>
  <text x="80" y="62" text-anchor="middle" fill="#fbbf24" font-size="9" font-family="monospace">61:A3:FC:22:D1:88</text>
</g>
<g class="mac2">
  <rect x="20" y="78" width="120" height="28" rx="6" fill="#1a1000" stroke="#d97706" stroke-width="1"/>
  <text x="80" y="96" text-anchor="middle" fill="#fbbf24" font-size="9" font-family="monospace">72:B4:ED:33:C2:99</text>
</g>
<text x="80" y="124" text-anchor="middle" fill="#4a6052" font-size="9" font-family="system-ui">Apple company ID 0x004C</text>
<text x="80" y="136" text-anchor="middle" fill="#4a6052" font-size="9" font-family="system-ui">type 0x02 — iBeacon frame</text>
<text x="170" y="76" fill="#52b788" font-size="20" font-family="system-ui">→</text>
<rect class="uuid" x="196" y="44" width="196" height="62" rx="8" fill="#1a0e00" stroke="#d97706" stroke-width="1.5"/>
<text x="294" y="64" text-anchor="middle" fill="#fbbf24" font-size="10" font-weight="700" font-family="system-ui">iBeacon</text>
<text x="294" y="80" text-anchor="middle" fill="#d97706" font-size="8" font-family="monospace">f7826da6-4fa2…</text>
<text x="294" y="94" text-anchor="middle" fill="#78909c" font-size="8" font-family="system-ui">Major 1 · Minor 2</text>
<text x="294" y="136" text-anchor="middle" fill="#a7f3d0" font-size="10" font-weight="600" font-family="system-ui">One stable object</text>
<text x="294" y="150" text-anchor="middle" fill="#4a6052" font-size="9" font-family="system-ui">Tag once — sticks forever</text>
<text x="294" y="164" text-anchor="middle" fill="#4a6052" font-size="9" font-family="system-ui">device_tracker.airtag_bag</text>
</svg>`;
}

function _svgAwayBadge() {
  return `<svg viewBox="0 0 400 220" xmlns="http://www.w3.org/2000/svg" width="100%" style="max-height:200px;background:#071008;border-radius:8px;display:block">
<style>
@keyframes awayPulse{0%,100%{opacity:1}50%{opacity:0.4}}
.awayBadge{animation:awayPulse 2s ease-in-out infinite}
</style>
<text x="200" y="14" text-anchor="middle" fill="#52b788" font-size="11" font-weight="600" font-family="system-ui">Objects tab — Away badge when device not seen</text>
<rect x="8" y="22" width="384" height="20" rx="4" fill="#0d2318"/>
<text x="22" y="36" fill="#6b9e7e" font-size="9" font-weight="600" font-family="system-ui">KIND</text>
<text x="88" y="36" fill="#6b9e7e" font-size="9" font-weight="600" font-family="system-ui">NAME / ADDRESS</text>
<text x="234" y="36" fill="#6b9e7e" font-size="9" font-weight="600" font-family="system-ui">LAST SEEN</text>
<text x="316" y="36" fill="#6b9e7e" font-size="9" font-weight="600" font-family="system-ui">SCANNER</text>
<rect x="8" y="46" width="384" height="28" rx="3" fill="#071008" stroke="#131f17" stroke-width="0.5"/>
<rect x="14" y="52" width="40" height="14" rx="7" fill="#0d2318" stroke="#2d5a3d" stroke-width="1"/>
<text x="34" y="63" text-anchor="middle" fill="#a7f3d0" font-size="8" font-family="system-ui">BLE</text>
<text x="88" y="65" fill="#cbd5e1" font-size="10" font-family="system-ui">Car Keys</text>
<text x="234" y="65" fill="#94a3b8" font-size="10" font-family="system-ui">5s</text>
<text x="316" y="65" fill="#6b9e7e" font-size="9" font-family="system-ui">kitchen_hub</text>
<rect x="8" y="78" width="384" height="36" rx="3" fill="#150505" stroke="#7f1d1d" stroke-width="1"/>
<rect x="14" y="84" width="40" height="14" rx="7" fill="#0d2318" stroke="#2d5a3d" stroke-width="1"/>
<text x="34" y="95" text-anchor="middle" fill="#a7f3d0" font-size="8" font-family="system-ui">BLE</text>
<text x="88" y="91" fill="#cbd5e1" font-size="10" font-weight="600" font-family="system-ui">Dog Tracker</text>
<g class="awayBadge">
  <rect x="228" y="81" width="44" height="14" rx="7" fill="#3a0a0a" stroke="#7f1d1d" stroke-width="1"/>
  <text x="250" y="92" text-anchor="middle" fill="#f87171" font-size="8" font-family="system-ui">Away</text>
</g>
<text x="234" y="107" fill="#6b7280" font-size="9" font-family="system-ui">8m 3s</text>
<text x="316" y="91" fill="#6b7280" font-size="9" font-family="system-ui">Last: Hallway</text>
<rect x="8" y="118" width="384" height="28" rx="3" fill="#071008" stroke="#131f17" stroke-width="0.5"/>
<rect x="14" y="124" width="60" height="14" rx="7" fill="#1a3a5a" stroke="#3b82f6" stroke-width="1"/>
<text x="44" y="135" text-anchor="middle" fill="#7dd3fc" font-size="8" font-family="system-ui">Private BLE</text>
<text x="88" y="137" fill="#cbd5e1" font-size="10" font-family="system-ui">Alice's iPhone</text>
<text x="234" y="137" fill="#94a3b8" font-size="10" font-family="system-ui">3s</text>
<text x="316" y="137" fill="#6b9e7e" font-size="9" font-family="system-ui">living_room_hub</text>
<text x="200" y="174" text-anchor="middle" fill="#f87171" font-size="9" font-family="system-ui">Away = device_tracker shows not_home in HA</text>
<text x="200" y="190" text-anchor="middle" fill="#4a6052" font-size="9" font-family="system-ui">Timeout configurable in Settings → Presence</text>
</svg>`;
}

function _svgQuietMode() {
  return `<svg viewBox="0 0 400 220" xmlns="http://www.w3.org/2000/svg" width="100%" style="max-height:200px;background:#071008;border-radius:8px;display:block">
<style>
@keyframes fadeOut{0%{opacity:1}40%{opacity:1}60%{opacity:0.1}100%{opacity:0.1}}
@keyframes fadeStay{0%,100%{opacity:1}}
.fadeItem{animation:fadeOut 3s ease-in-out infinite}
.stayItem{animation:fadeStay 3s ease-in-out infinite}
</style>
<text x="200" y="16" text-anchor="middle" fill="#52b788" font-size="11" font-weight="600" font-family="system-ui">Quiet Mode hides unidentified clutter</text>
<rect x="20" y="28" width="160" height="170" rx="8" fill="#0a150e" stroke="#1b3526" stroke-width="1.5"/>
<text x="100" y="48" text-anchor="middle" fill="#94a3b8" font-size="10" font-weight="600" font-family="system-ui">Normal Mode</text>
<text x="100" y="68" text-anchor="middle" fill="#52b788" font-size="9" font-family="system-ui">Alice's Phone</text>
<text x="100" y="84" text-anchor="middle" fill="#52b788" font-size="9" font-family="system-ui">Car Keys</text>
<text x="100" y="100" text-anchor="middle" fill="#f59e0b" font-size="9" font-family="system-ui">AA:BB:CC:11:22:33</text>
<text x="100" y="116" text-anchor="middle" fill="#f59e0b" font-size="9" font-family="system-ui">DD:EE:FF:44:55:66</text>
<text x="100" y="132" text-anchor="middle" fill="#f59e0b" font-size="9" font-family="system-ui">11:22:33:AA:BB:CC</text>
<text x="100" y="148" text-anchor="middle" fill="#f59e0b" font-size="9" font-family="system-ui">77:88:99:DD:EE:FF</text>
<text x="100" y="170" text-anchor="middle" fill="#64748b" font-size="9" font-family="system-ui">2 tagged · 4 unknown</text>
<rect x="220" y="28" width="160" height="170" rx="8" fill="#0a150e" stroke="#52b788" stroke-width="2"/>
<text x="300" y="48" text-anchor="middle" fill="#52b788" font-size="10" font-weight="600" font-family="system-ui">Quiet Mode</text>
<text x="300" y="72" text-anchor="middle" fill="#52b788" font-size="10" font-family="system-ui">Alice's Phone</text>
<text x="300" y="92" text-anchor="middle" fill="#52b788" font-size="10" font-family="system-ui">Car Keys</text>
<text x="300" y="130" text-anchor="middle" fill="#64748b" font-size="9" font-family="system-ui">Only tracked devices shown</text>
<rect x="338" y="36" width="28" height="14" rx="7" fill="#1a3a2a" stroke="#52b788" stroke-width="1"/>
<circle cx="358" cy="43" r="5" fill="#52b788"/>
<text x="300" y="208" text-anchor="middle" fill="#4a6052" font-size="9" font-family="system-ui">Toggle in top-right of Overview</text>
</svg>`;
}

function _svgCompanionTrack() {
  return `<svg viewBox="0 0 400 220" xmlns="http://www.w3.org/2000/svg" width="100%" style="max-height:200px;background:#071008;border-radius:8px;display:block">
<style>
@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}
.pBtn{animation:pulse 2s ease-in-out infinite}
@keyframes check{0%,60%{opacity:0}70%{opacity:1}100%{opacity:1}}
.chk{animation:check 3s ease-in-out infinite}
</style>
<text x="200" y="16" text-anchor="middle" fill="#60a5fa" font-size="11" font-weight="600" font-family="system-ui">One-click phone tracking from Overview</text>
<rect x="40" y="30" width="320" height="60" rx="8" fill="#0f172a" stroke="#2563eb" stroke-width="1.5"/>
<text x="60" y="52" fill="#e2e8f0" font-size="12" font-weight="600" font-family="system-ui">Garry's iPhone</text>
<text x="60" y="68" fill="#64748b" font-size="9" font-family="system-ui">BLE active · visible to scanners</text>
<rect class="pBtn" x="260" y="42" width="80" height="28" rx="6" fill="none" stroke="#2563eb" stroke-width="1.5"/>
<text x="300" y="60" text-anchor="middle" fill="#60a5fa" font-size="11" font-weight="600" font-family="system-ui">Track</text>
<path class="chk" d="M 180 140 l 10 10 l 20 -20" fill="none" stroke="#34d399" stroke-width="3" stroke-linecap="round"/>
<text class="chk" x="200" y="175" text-anchor="middle" fill="#34d399" font-size="11" font-weight="600" font-family="system-ui">Tracked! Labels, follows, and enables BLE</text>
<text x="200" y="200" text-anchor="middle" fill="#4a6052" font-size="9" font-family="system-ui">Auto-enables BLE Transmitter on the phone</text>
</svg>`;
}

function _svgClearUnidentified() {
  return `<svg viewBox="0 0 400 220" xmlns="http://www.w3.org/2000/svg" width="100%" style="max-height:200px;background:#071008;border-radius:8px;display:block">
<style>
@keyframes sweep{0%{x:20}30%{x:20}70%{x:380}100%{x:380}}
@keyframes fadeClean{0%,30%{opacity:1}70%,100%{opacity:0}}
@keyframes stayClean{0%,100%{opacity:1}}
.sweepLine{animation:sweep 4s ease-in-out infinite}
.cleanFade{animation:fadeClean 4s ease-in-out infinite}
.cleanStay{animation:stayClean 4s ease-in-out infinite}
</style>
<text x="200" y="16" text-anchor="middle" fill="#f87171" font-size="11" font-weight="600" font-family="system-ui">Clear unidentified — keep tagged &amp; followed</text>
<text class="cleanStay" x="40" y="50" fill="#52b788" font-size="10" font-family="system-ui">Alice's Phone</text>
<rect class="cleanStay" x="160" y="38" width="50" height="16" rx="4" fill="#1a3a2a" stroke="#52b788" stroke-width="1"/>
<text class="cleanStay" x="185" y="50" text-anchor="middle" fill="#52b788" font-size="8" font-family="system-ui">Tagged</text>
<text class="cleanFade" x="40" y="75" fill="#f59e0b" font-size="10" font-family="system-ui">AA:BB:CC:11:22:33</text>
<text class="cleanStay" x="40" y="100" fill="#52b788" font-size="10" font-family="system-ui">Car Keys</text>
<rect class="cleanStay" x="120" y="88" width="60" height="16" rx="4" fill="#1a3a2a" stroke="#52b788" stroke-width="1"/>
<text class="cleanStay" x="150" y="100" text-anchor="middle" fill="#52b788" font-size="8" font-family="system-ui">Following</text>
<text class="cleanFade" x="40" y="125" fill="#f59e0b" font-size="10" font-family="system-ui">DD:EE:FF:44:55:66</text>
<text class="cleanFade" x="40" y="150" fill="#f59e0b" font-size="10" font-family="system-ui">77:88:99:AA:BB:CC</text>
<line class="sweepLine" x1="20" y1="30" x2="20" y2="165" stroke="#f87171" stroke-width="2" opacity="0.6"/>
<text x="200" y="190" text-anchor="middle" fill="#94a3b8" font-size="10" font-family="system-ui">Tagged and followed devices are preserved</text>
<text x="200" y="208" text-anchor="middle" fill="#4a6052" font-size="9" font-family="system-ui">Available in Overview and Objects tabs</text>
</svg>`;
}

function _svgPrivateBle() {
  return `<svg viewBox="0 0 400 220" xmlns="http://www.w3.org/2000/svg" width="100%" style="max-height:200px;background:#071008;border-radius:8px;display:block">
<style>
@keyframes rotate{0%{opacity:1}25%{opacity:0}50%{opacity:0}75%{opacity:1}100%{opacity:1}}
@keyframes rotateB{0%{opacity:0}25%{opacity:1}50%{opacity:0}75%{opacity:0}100%{opacity:0}}
@keyframes rotateC{0%{opacity:0}25%{opacity:0}50%{opacity:1}75%{opacity:0}100%{opacity:0}}
.macA{animation:rotate 4s ease-in-out infinite}
.macB{animation:rotateB 4s ease-in-out infinite}
.macC{animation:rotateC 4s ease-in-out infinite}
</style>
<text x="200" y="16" text-anchor="middle" fill="#60a5fa" font-size="11" font-weight="600" font-family="system-ui">Private BLE: IRK resolves rotating MACs</text>
<rect x="20" y="30" width="160" height="120" rx="8" fill="#0a150e" stroke="#1b3526" stroke-width="1.5"/>
<text x="100" y="50" text-anchor="middle" fill="#94a3b8" font-size="10" font-weight="600" font-family="system-ui">iPhone broadcasts</text>
<text class="macA" x="100" y="75" text-anchor="middle" fill="#f59e0b" font-size="10" font-family="monospace">4A:1B:2C:3D:4E:5F</text>
<text class="macB" x="100" y="75" text-anchor="middle" fill="#f59e0b" font-size="10" font-family="monospace">7C:8D:9E:AF:B0:C1</text>
<text class="macC" x="100" y="75" text-anchor="middle" fill="#f59e0b" font-size="10" font-family="monospace">D2:E3:F4:05:16:27</text>
<text x="100" y="95" text-anchor="middle" fill="#64748b" font-size="9" font-family="system-ui">MAC rotates every ~15 min</text>
<text x="100" y="130" text-anchor="middle" fill="#f87171" font-size="9" font-family="system-ui">Without IRK: 3 unknown devices</text>
<text x="200" y="90" text-anchor="middle" fill="#60a5fa" font-size="16" font-family="system-ui">→</text>
<rect x="220" y="30" width="160" height="120" rx="8" fill="#0a150e" stroke="#60a5fa" stroke-width="2"/>
<text x="300" y="50" text-anchor="middle" fill="#60a5fa" font-size="10" font-weight="600" font-family="system-ui">With IRK</text>
<rect x="250" y="60" width="100" height="24" rx="6" fill="#1a2744" stroke="#60a5fa" stroke-width="1"/>
<text x="300" y="76" text-anchor="middle" fill="#60a5fa" font-size="10" font-family="system-ui">Garry's iPhone</text>
<text x="300" y="100" text-anchor="middle" fill="#34d399" font-size="9" font-family="system-ui">1 stable identity</text>
<text x="300" y="130" text-anchor="middle" fill="#64748b" font-size="9" font-family="system-ui">Blue badge in all views</text>
<text x="200" y="175" text-anchor="middle" fill="#94a3b8" font-size="10" font-family="system-ui">Settings → Private BLE → Add IRK</text>
<text x="200" y="195" text-anchor="middle" fill="#4a6052" font-size="9" font-family="system-ui">Works with iPhones, Apple Watches, and Android phones</text>
</svg>`;
}

function _svgPresenceSettings() {
  return `<svg viewBox="0 0 400 220" xmlns="http://www.w3.org/2000/svg" width="100%" style="max-height:200px;background:#071008;border-radius:8px;display:block">
<style>
@keyframes saveGlow{0%,100%{stroke:#2d5a3d}50%{stroke:#52b788}}
.saveBtn{animation:saveGlow 2s ease-in-out infinite}
</style>
<text x="200" y="14" text-anchor="middle" fill="#52b788" font-size="11" font-weight="600" font-family="system-ui">Settings → Presence tab</text>
<rect x="8" y="22" width="384" height="78" rx="8" fill="#0a150e" stroke="#1b3526" stroke-width="1.5"/>
<text x="22" y="40" fill="#a7f3d0" font-size="11" font-weight="700" font-family="system-ui">Room Change Delay</text>
<text x="22" y="55" fill="#6b9e7e" font-size="9" font-family="system-ui">Seconds a scanner must dominate before switching rooms</text>
<text x="22" y="74" fill="#a7f3d0" font-size="10" font-family="system-ui">Room change delay</text>
<rect x="178" y="64" width="46" height="20" rx="5" fill="#0a150e" stroke="#2d5a3d" stroke-width="1.5"/>
<text x="201" y="78" text-anchor="middle" fill="#e2e8f0" font-size="11" font-family="system-ui">20</text>
<text x="230" y="78" fill="#6b9e7e" font-size="9" font-family="system-ui">seconds</text>
<rect class="saveBtn" x="294" y="64" width="42" height="20" rx="5" fill="#1a3a2a" stroke="#2d5a3d" stroke-width="1.5"/>
<text x="315" y="78" text-anchor="middle" fill="#a7f3d0" font-size="9" font-family="system-ui">Save</text>
<text x="22" y="94" fill="#4a6052" font-size="9" font-family="system-ui">Current: 20s → ~2 polls agreement · set to 0 for instant</text>
<rect x="8" y="110" width="384" height="78" rx="8" fill="#0a150e" stroke="#1b3526" stroke-width="1.5"/>
<text x="22" y="128" fill="#a7f3d0" font-size="11" font-weight="700" font-family="system-ui">Home / Away Timeout</text>
<text x="22" y="143" fill="#6b9e7e" font-size="9" font-family="system-ui">Not seen this long → device_tracker = not_home in HA</text>
<text x="22" y="162" fill="#a7f3d0" font-size="10" font-family="system-ui">Away timeout</text>
<rect x="178" y="152" width="46" height="20" rx="5" fill="#0a150e" stroke="#2d5a3d" stroke-width="1.5"/>
<text x="201" y="166" text-anchor="middle" fill="#e2e8f0" font-size="11" font-family="system-ui">5</text>
<text x="230" y="166" fill="#6b9e7e" font-size="9" font-family="system-ui">minutes</text>
<rect class="saveBtn" x="294" y="152" width="42" height="20" rx="5" fill="#1a3a2a" stroke="#2d5a3d" stroke-width="1.5"/>
<text x="315" y="166" text-anchor="middle" fill="#a7f3d0" font-size="9" font-family="system-ui">Save</text>
<text x="22" y="182" fill="#4a6052" font-size="9" font-family="system-ui">Default: 5 min · range 1 min – 24 h · no restart needed</text>
</svg>`;
}

function _svgHaEntities() {
  return `<svg viewBox="0 0 400 220" xmlns="http://www.w3.org/2000/svg" width="100%" style="max-height:200px;background:#071008;border-radius:8px;display:block">
<style>
@keyframes stateChange{0%,45%{fill:#1a3a2a;stroke:#52b788}55%,100%{fill:#3a0a0a;stroke:#dc2626}}
.stateBox{animation:stateChange 3s ease-in-out 1s infinite}
@keyframes textSwitch{0%,45%{opacity:1}50%{opacity:0}55%,100%{opacity:0}}
.stateHome{animation:textSwitch 3s ease-in-out 1s infinite}
@keyframes textSwitch2{0%,45%{opacity:0}50%{opacity:0}55%,100%{opacity:1}}
.stateAway{animation:textSwitch2 3s ease-in-out 1s infinite}
</style>
<text x="200" y="14" text-anchor="middle" fill="#52b788" font-size="11" font-weight="600" font-family="system-ui">HA entities update automatically</text>
<rect x="8" y="22" width="185" height="90" rx="8" fill="#0a150e" stroke="#1b3526" stroke-width="1.5"/>
<text x="20" y="40" fill="#78909c" font-size="9" font-weight="600" font-family="system-ui">device_tracker.car_keys</text>
<text x="20" y="56" fill="#4a6052" font-size="9" font-family="system-ui">state:</text>
<rect class="stateBox" x="50" y="46" width="80" height="18" rx="4"/>
<text class="stateHome" x="90" y="59" text-anchor="middle" fill="#52b788" font-size="9" font-weight="600" font-family="system-ui">Kitchen</text>
<text class="stateAway" x="90" y="59" text-anchor="middle" fill="#f87171" font-size="9" font-weight="600" font-family="system-ui">not_home</text>
<text x="20" y="78" fill="#4a6052" font-size="8" font-family="system-ui">source_type: bluetooth_le</text>
<text x="20" y="90" fill="#4a6052" font-size="8" font-family="system-ui">address: CC:DD:EE:33:44:55</text>
<text x="20" y="102" fill="#4a6052" font-size="8" font-family="system-ui">home: true / false</text>
<rect x="207" y="22" width="185" height="90" rx="8" fill="#0a150e" stroke="#1b3526" stroke-width="1.5"/>
<text x="219" y="40" fill="#78909c" font-size="9" font-weight="600" font-family="system-ui">sensor.car_keys_area</text>
<text x="219" y="56" fill="#4a6052" font-size="9" font-family="system-ui">state:</text>
<rect class="stateBox" x="249" y="46" width="80" height="18" rx="4"/>
<text class="stateHome" x="289" y="59" text-anchor="middle" fill="#52b788" font-size="9" font-weight="600" font-family="system-ui">Kitchen</text>
<text class="stateAway" x="289" y="59" text-anchor="middle" fill="#f87171" font-size="9" font-weight="600" font-family="system-ui">not_home</text>
<text x="219" y="78" fill="#4a6052" font-size="8" font-family="system-ui">kind: ble</text>
<text x="219" y="90" fill="#4a6052" font-size="8" font-family="system-ui">rssi: −64 dBm</text>
<text x="219" y="102" fill="#4a6052" font-size="8" font-family="system-ui">age_s: 5.0</text>
<text x="200" y="130" text-anchor="middle" fill="#94a3b8" font-size="10" font-weight="600" font-family="system-ui">Link device_tracker to a Person in HA</text>
<text x="200" y="146" text-anchor="middle" fill="#4a6052" font-size="9" font-family="system-ui">HA Settings → People → add device_tracker.car_keys</text>
<text x="200" y="162" text-anchor="middle" fill="#4a6052" font-size="9" font-family="system-ui">Works with HA automations, history, logbook, templates</text>
<text x="200" y="182" text-anchor="middle" fill="#4a6052" font-size="9" font-family="system-ui">Use padspan_ha.dump_devices service to inspect full state</text>
</svg>`;
}

function _svgCalibSetup() {
  return `<svg viewBox="0 0 400 220" xmlns="http://www.w3.org/2000/svg" width="100%" style="max-height:200px;background:#071008;border-radius:8px;display:block">
<style>
@keyframes phonePulse{0%,100%{opacity:1}50%{opacity:0.5}}
.phone{animation:phonePulse 1.5s ease-in-out infinite}
</style>
<text x="200" y="16" text-anchor="middle" fill="#52b788" font-size="11" font-weight="600" font-family="system-ui">Step 1: Choose a device and a floor plan</text>
<rect x="20" y="28" width="360" height="80" rx="8" fill="#0d2318" stroke="#52b788" stroke-width="1.5"/>
<text x="36" y="50" fill="#94a3b8" font-size="10" font-family="system-ui">Calibration Device</text>
<rect x="36" y="56" width="160" height="22" rx="5" fill="#071008" stroke="#1b3526" stroke-width="1"/>
<text x="48" y="72" fill="#cbd5e1" font-size="10" font-family="system-ui">Alice's Phone ▾</text>
<g class="phone"><circle cx="330" cy="68" r="14" fill="#14b8a6" opacity="0.2" stroke="#14b8a6" stroke-width="1.5"/><circle cx="330" cy="68" r="6" fill="#14b8a6"/></g>
<text x="36" y="96" fill="#94a3b8" font-size="10" font-family="system-ui">Floor Plan</text>
<rect x="136" y="86" width="160" height="22" rx="5" fill="#071008" stroke="#1b3526" stroke-width="1"/>
<text x="148" y="102" fill="#cbd5e1" font-size="10" font-family="system-ui">Ground Floor ▾</text>
<text x="200" y="140" text-anchor="middle" fill="#4a6052" font-size="10" font-family="system-ui">Open the Calibration tab (or standalone phone panel)</text>
<text x="200" y="156" text-anchor="middle" fill="#4a6052" font-size="9" font-family="system-ui">Pick the BLE device you'll carry and the map to calibrate on</text>
<text x="200" y="180" text-anchor="middle" fill="#52b788" font-size="10" font-weight="600" font-family="system-ui">Tip: Use the standalone Calibration panel on your phone</text>
<text x="200" y="196" text-anchor="middle" fill="#4a6052" font-size="9" font-family="system-ui">It's optimised for one-handed use while walking around</text>
</svg>`;
}

function _svgCalibPin() {
  return `<svg viewBox="0 0 400 220" xmlns="http://www.w3.org/2000/svg" width="100%" style="max-height:200px;background:#071008;border-radius:8px;display:block">
<style>
@keyframes pinDrop{0%{r:0;opacity:0}50%{r:8;opacity:1}100%{r:6;opacity:0.8}}
.pin1{animation:pinDrop 0.5s ease-out 0.3s both}
.pin2{animation:pinDrop 0.5s ease-out 1s both}
.pin3{animation:pinDrop 0.5s ease-out 1.7s both}
@keyframes listenRing{0%{r:8;opacity:0.6}100%{r:22;opacity:0}}
.listen{animation:listenRing 1.5s ease-out infinite}
</style>
<text x="200" y="16" text-anchor="middle" fill="#52b788" font-size="11" font-weight="600" font-family="system-ui">Step 2: Tap map → stand still → collect</text>
<rect x="10" y="26" width="240" height="180" rx="6" fill="#0a1a0f" stroke="#1b3526" stroke-width="1"/>
<rect x="20" y="36" width="100" height="70" rx="4" fill="#1b3526" opacity="0.2" stroke="#253e2e" stroke-width="1"/>
<text x="70" y="76" text-anchor="middle" fill="#4a6052" font-size="9" font-family="system-ui">Kitchen</text>
<rect x="130" y="36" width="110" height="70" rx="4" fill="#1b3526" opacity="0.2" stroke="#253e2e" stroke-width="1"/>
<text x="185" y="76" text-anchor="middle" fill="#4a6052" font-size="9" font-family="system-ui">Living Room</text>
<rect x="20" y="116" width="220" height="80" rx="4" fill="#1b3526" opacity="0.15" stroke="#253e2e" stroke-width="1"/>
<text x="130" y="160" text-anchor="middle" fill="#4a6052" font-size="9" font-family="system-ui">Hallway</text>
<circle class="listen" cx="60" cy="56" fill="none" stroke="#14b8a6" stroke-width="1.5"/>
<circle class="pin1" cx="60" cy="56" fill="#14b8a6"/>
<circle class="pin2" cx="170" cy="56" fill="#14b8a6"/>
<circle class="pin3" cx="100" cy="150" fill="#14b8a6"/>
<rect x="260" y="26" width="132" height="180" rx="6" fill="#050e08" stroke="#1b3526" stroke-width="1"/>
<text x="272" y="46" fill="#52b788" font-size="10" font-weight="600" font-family="system-ui">Pin &amp; Listen</text>
<text x="272" y="66" fill="#4a6052" font-size="9" font-family="system-ui">1. Tap map where</text>
<text x="272" y="79" fill="#4a6052" font-size="9" font-family="system-ui">   you're standing</text>
<text x="272" y="99" fill="#4a6052" font-size="9" font-family="system-ui">2. Stand still 10s</text>
<text x="272" y="119" fill="#4a6052" font-size="9" font-family="system-ui">3. PadSpan records</text>
<text x="272" y="132" fill="#4a6052" font-size="9" font-family="system-ui">   RSSI from every</text>
<text x="272" y="145" fill="#4a6052" font-size="9" font-family="system-ui">   scanner</text>
<text x="272" y="172" fill="#14b8a6" font-size="9" font-weight="600" font-family="system-ui">3 points collected</text>
<text x="272" y="192" fill="#4a6052" font-size="8" font-family="system-ui">More points = better</text>
</svg>`;
}

function _svgCalibHeatmap() {
  return `<svg viewBox="0 0 400 220" xmlns="http://www.w3.org/2000/svg" width="100%" style="max-height:200px;background:#071008;border-radius:8px;display:block">
<style>
@keyframes heatPulse{0%,100%{opacity:0.6}50%{opacity:0.9}}
.heat{animation:heatPulse 2s ease-in-out infinite}
</style>
<text x="200" y="16" text-anchor="middle" fill="#52b788" font-size="11" font-weight="600" font-family="system-ui">Step 3: Coverage heatmap shows where to walk next</text>
<rect x="10" y="26" width="240" height="180" rx="6" fill="#0a1a0f" stroke="#1b3526" stroke-width="1"/>
<g class="heat">
<rect x="20" y="36" width="46" height="34" rx="2" fill="#52b788" opacity="0.7"/>
<rect x="68" y="36" width="46" height="34" rx="2" fill="#52b788" opacity="0.5"/>
<rect x="116" y="36" width="46" height="34" rx="2" fill="#ffd54f" opacity="0.4"/>
<rect x="164" y="36" width="46" height="34" rx="2" fill="#ef5350" opacity="0.3"/>
<rect x="20" y="72" width="46" height="34" rx="2" fill="#52b788" opacity="0.6"/>
<rect x="68" y="72" width="46" height="34" rx="2" fill="#ffd54f" opacity="0.4"/>
<rect x="116" y="72" width="46" height="34" rx="2" fill="#ef5350" opacity="0.2"/>
<rect x="164" y="72" width="46" height="34" rx="2" fill="#ef5350" opacity="0.15"/>
<rect x="20" y="108" width="46" height="34" rx="2" fill="#52b788" opacity="0.8"/>
<rect x="68" y="108" width="46" height="34" rx="2" fill="#52b788" opacity="0.5"/>
<rect x="116" y="108" width="46" height="34" rx="2" fill="#ffd54f" opacity="0.35"/>
<rect x="164" y="108" width="46" height="34" rx="2" fill="#ef5350" opacity="0.2"/>
</g>
<circle cx="178" cy="84" r="8" fill="none" stroke="#ffd54f" stroke-width="2" stroke-dasharray="4,3"/>
<text x="178" y="88" text-anchor="middle" fill="#ffd54f" font-size="8" font-weight="700" font-family="system-ui">?</text>
<rect x="260" y="26" width="132" height="180" rx="6" fill="#050e08" stroke="#1b3526" stroke-width="1"/>
<text x="272" y="46" fill="#52b788" font-size="10" font-weight="600" font-family="system-ui">Roam</text>
<text x="272" y="68" fill="#4a6052" font-size="9" font-family="system-ui">Green = good</text>
<text x="272" y="82" fill="#4a6052" font-size="9" font-family="system-ui">coverage</text>
<text x="272" y="102" fill="#ffd54f" font-size="9" font-family="system-ui">Yellow = some data</text>
<text x="272" y="122" fill="#ef5350" font-size="9" font-family="system-ui">Red = needs more</text>
<text x="272" y="148" fill="#94a3b8" font-size="9" font-weight="600" font-family="system-ui">Walk to red areas</text>
<text x="272" y="162" fill="#4a6052" font-size="9" font-family="system-ui">and collect more</text>
<text x="272" y="176" fill="#4a6052" font-size="9" font-family="system-ui">fingerprints there</text>
</svg>`;
}

function _svgCalibModel() {
  return `<svg viewBox="0 0 400 220" xmlns="http://www.w3.org/2000/svg" width="100%" style="max-height:200px;background:#071008;border-radius:8px;display:block">
<style>
@keyframes barGrow{0%{width:0}100%{width:100%}}
.bar{animation:barGrow 1s ease-out both}
@keyframes checkPop{0%{transform:scale(0)}100%{transform:scale(1)}}
.check{animation:checkPop 0.3s ease-out 1.5s both}
</style>
<text x="200" y="16" text-anchor="middle" fill="#52b788" font-size="11" font-weight="600" font-family="system-ui">Step 4: Compute model and check accuracy</text>
<rect x="20" y="28" width="360" height="60" rx="8" fill="#0d2318" stroke="#52b788" stroke-width="1.5"/>
<text x="36" y="48" fill="#52b788" font-size="11" font-weight="700" font-family="system-ui">Compute Model</text>
<text x="36" y="64" fill="#4a6052" font-size="9" font-family="system-ui">Fits k-NN fingerprint + OLS path-loss model per scanner</text>
<rect x="36" y="70" width="160" height="8" rx="4" fill="#1b3526"/>
<rect class="bar" x="36" y="70" width="160" height="8" rx="4" fill="#52b788" style="width:140px"/>
<g class="check"><text x="340" y="62" text-anchor="middle" fill="#52b788" font-size="20" font-family="system-ui">✓</text></g>
<rect x="20" y="100" width="170" height="108" rx="8" fill="#0a150e" stroke="#1b3526" stroke-width="1.5"/>
<text x="36" y="120" fill="#94a3b8" font-size="10" font-weight="600" font-family="system-ui">Model Stats</text>
<text x="36" y="140" fill="#4a6052" font-size="9" font-family="system-ui">Points collected: 24</text>
<text x="36" y="156" fill="#4a6052" font-size="9" font-family="system-ui">Scanners used: 3</text>
<text x="36" y="172" fill="#4a6052" font-size="9" font-family="system-ui">LOO accuracy: 87%</text>
<text x="36" y="192" fill="#52b788" font-size="9" font-weight="600" font-family="system-ui">Model quality: Good</text>
<rect x="210" y="100" width="170" height="108" rx="8" fill="#0a150e" stroke="#1b3526" stroke-width="1.5"/>
<text x="226" y="120" fill="#94a3b8" font-size="10" font-weight="600" font-family="system-ui">What happens</text>
<text x="226" y="140" fill="#4a6052" font-size="9" font-family="system-ui">k-NN matches new</text>
<text x="226" y="154" fill="#4a6052" font-size="9" font-family="system-ui">signals to your</text>
<text x="226" y="168" fill="#4a6052" font-size="9" font-family="system-ui">collected fingerprints</text>
<text x="226" y="188" fill="#4a6052" font-size="9" font-family="system-ui">LOO = leave-one-out</text>
<text x="226" y="202" fill="#4a6052" font-size="9" font-family="system-ui">cross-validation score</text>
</svg>`;
}

// ─── Hardware SVG Builders ────────────────────────────────────────────────────

function _svgAntennaComparison() {
  return `<svg viewBox="0 0 400 220" xmlns="http://www.w3.org/2000/svg" width="100%" style="max-height:200px;background:#071008;border-radius:8px;display:block">
<style>
@keyframes goodPulse{0%,100%{r:28;opacity:0.3}50%{r:36;opacity:0.15}}
@keyframes badPulse{0%,100%{r:12;opacity:0.25}50%{r:16;opacity:0.1}}
.gp{animation:goodPulse 2s ease-in-out infinite}
.bp{animation:badPulse 2s ease-in-out infinite}
</style>
<text x="200" y="16" text-anchor="middle" fill="#52b788" font-size="11" font-weight="600" font-family="system-ui">External antenna vs chip antenna</text>
<rect x="20" y="28" width="160" height="180" rx="8" fill="#0a150e" stroke="#ef4444" stroke-width="1.5" opacity="0.8"/>
<text x="100" y="48" text-anchor="middle" fill="#ef4444" font-size="10" font-weight="600" font-family="system-ui">Chip Antenna</text>
<rect x="68" y="62" width="64" height="40" rx="4" fill="#1b3526" stroke="#2a5038" stroke-width="1.5"/>
<rect x="120" y="68" width="8" height="6" rx="1" fill="#4a6052"/>
<text x="100" y="86" text-anchor="middle" fill="#4a6052" font-size="7" font-family="system-ui">ESP32</text>
<circle class="bp" cx="100" cy="82" fill="none" stroke="#ef4444" stroke-width="1" r="12"/>
<text x="100" y="122" text-anchor="middle" fill="#94a3b8" font-size="9" font-family="system-ui">RSSI: −78 to −91 dBm</text>
<text x="100" y="138" text-anchor="middle" fill="#ef4444" font-size="9" font-family="system-ui">Inconsistent signal</text>
<text x="100" y="158" text-anchor="middle" fill="#4a6052" font-size="9" font-family="system-ui">Fine for home/away</text>
<text x="100" y="174" text-anchor="middle" fill="#ef4444" font-size="9" font-family="system-ui">Poor for room tracking</text>
<text x="100" y="198" text-anchor="middle" fill="#4a6052" font-size="8" font-family="system-ui">Most of the old boards</text>
<rect x="220" y="28" width="160" height="180" rx="8" fill="#0d2318" stroke="#52b788" stroke-width="1.5"/>
<text x="300" y="48" text-anchor="middle" fill="#52b788" font-size="10" font-weight="600" font-family="system-ui">External Antenna</text>
<rect x="268" y="62" width="64" height="40" rx="4" fill="#1b3526" stroke="#52b788" stroke-width="1.5"/>
<line x1="326" y1="72" x2="342" y2="56" stroke="#52b788" stroke-width="2" stroke-linecap="round"/>
<line x1="342" y1="56" x2="342" y2="42" stroke="#52b788" stroke-width="2.5" stroke-linecap="round"/>
<line x1="336" y1="48" x2="342" y2="42" stroke="#52b788" stroke-width="1.5" stroke-linecap="round"/>
<line x1="348" y1="48" x2="342" y2="42" stroke="#52b788" stroke-width="1.5" stroke-linecap="round"/>
<text x="300" y="86" text-anchor="middle" fill="#52b788" font-size="7" font-family="system-ui">ESP32-S3</text>
<circle class="gp" cx="300" cy="82" fill="none" stroke="#52b788" stroke-width="1" r="28"/>
<text x="300" y="122" text-anchor="middle" fill="#94a3b8" font-size="9" font-family="system-ui">RSSI: −48 to −72 dBm</text>
<text x="300" y="138" text-anchor="middle" fill="#52b788" font-size="9" font-family="system-ui">Stable, consistent</text>
<text x="300" y="158" text-anchor="middle" fill="#52b788" font-size="9" font-weight="600" font-family="system-ui">Great for room tracking</text>
<text x="300" y="174" text-anchor="middle" fill="#4a6052" font-size="9" font-family="system-ui">Accurate room edges</text>
<text x="300" y="198" text-anchor="middle" fill="#4a6052" font-size="8" font-family="system-ui">ESP32-S3 / C3</text>
</svg>`;
}

function _svgBoardRanking() {
  return `<svg viewBox="0 0 400 220" xmlns="http://www.w3.org/2000/svg" width="100%" style="max-height:200px;background:#071008;border-radius:8px;display:block">
<style>
@keyframes slideIn{0%{opacity:0;transform:translateX(-20px)}100%{opacity:1;transform:translateX(0)}}
.r1{animation:slideIn 0.4s ease-out both}
.r2{animation:slideIn 0.4s ease-out 0.2s both}
.r3{animation:slideIn 0.4s ease-out 0.4s both}
</style>
<text x="200" y="16" text-anchor="middle" fill="#52b788" font-size="11" font-weight="600" font-family="system-ui">What worked (a dozen old boards + 10 new)</text>
<g class="r1">
<rect x="20" y="28" width="360" height="50" rx="6" fill="#0d2318" stroke="#52b788" stroke-width="1.5"/>
<rect x="26" y="34" width="22" height="22" rx="11" fill="#52b788"/>
<text x="37" y="50" text-anchor="middle" fill="#071008" font-size="12" font-weight="700" font-family="system-ui">1</text>
<text x="58" y="48" fill="#52b788" font-size="10" font-weight="700" font-family="system-ui">ESP32-S3 + Ethernet + External Antenna</text>
<text x="58" y="64" fill="#4a6052" font-size="8.5" font-family="system-ui">Wired = no WiFi interference · Didn't test better, but best in theory</text>
</g>
<g class="r2">
<rect x="20" y="88" width="360" height="50" rx="6" fill="#0d2318" stroke="#43a047" stroke-width="1.5"/>
<rect x="26" y="94" width="22" height="22" rx="11" fill="#43a047"/>
<text x="37" y="110" text-anchor="middle" fill="#071008" font-size="12" font-weight="700" font-family="system-ui">2</text>
<text x="58" y="108" fill="#43a047" font-size="10" font-weight="700" font-family="system-ui">ESP32-S3 + External Antenna (WiFi)</text>
<text x="58" y="124" fill="#4a6052" font-size="8.5" font-family="system-ui">Great BLE 5.0 · Most practical pick for most people</text>
</g>
<g class="r3">
<rect x="20" y="148" width="360" height="50" rx="6" fill="#0a150e" stroke="#2a5038" stroke-width="1.5"/>
<rect x="26" y="154" width="22" height="22" rx="11" fill="#2a5038"/>
<text x="37" y="170" text-anchor="middle" fill="#52b788" font-size="12" font-weight="700" font-family="system-ui">3</text>
<text x="58" y="168" fill="#94a3b8" font-size="10" font-weight="700" font-family="system-ui">ESP32-C3 + External Antenna</text>
<text x="58" y="184" fill="#4a6052" font-size="8.5" font-family="system-ui">Cheaper than the S3 · Good BLE 5.0 · Still did the job well</text>
</g>
<text x="200" y="215" text-anchor="middle" fill="#4a6052" font-size="8.5" font-family="system-ui">All three use ESPresense or Bluetooth Proxy firmware</text>
</svg>`;
}

function _svgAntennaDetail() {
  return `<svg viewBox="0 0 400 220" xmlns="http://www.w3.org/2000/svg" width="100%" style="max-height:200px;background:#071008;border-radius:8px;display:block">
<style>
@keyframes signalGrow{0%{opacity:0}50%{opacity:0.6}100%{opacity:0}}
.sg1{animation:signalGrow 2.5s ease-out infinite}
.sg2{animation:signalGrow 2.5s ease-out 0.8s infinite}
.sg3{animation:signalGrow 2.5s ease-out 1.6s infinite}
</style>
<text x="200" y="16" text-anchor="middle" fill="#52b788" font-size="11" font-weight="600" font-family="system-ui">Why the antenna matters for room-level accuracy</text>
<rect x="20" y="30" width="360" height="85" rx="8" fill="#0a150e" stroke="#1b3526" stroke-width="1"/>
<text x="36" y="50" fill="#94a3b8" font-size="10" font-weight="600" font-family="system-ui">The challenge</text>
<text x="36" y="66" fill="#4a6052" font-size="9" font-family="system-ui">Home/away only needs to detect a signal somewhere. Room-level</text>
<text x="36" y="80" fill="#4a6052" font-size="9" font-family="system-ui">tracking needs to distinguish −55 dBm from −62 dBm reliably —</text>
<text x="36" y="94" fill="#4a6052" font-size="9" font-family="system-ui">that 7 dBm difference decides which room a device is assigned to.</text>
<text x="36" y="108" fill="#52b788" font-size="9" font-weight="600" font-family="system-ui">A full-size antenna turns noise into a clear signal.</text>
<rect x="20" y="124" width="175" height="84" rx="8" fill="#0a150e" stroke="#1b3526" stroke-width="1"/>
<text x="36" y="144" fill="#94a3b8" font-size="10" font-weight="600" font-family="system-ui">What to look for</text>
<text x="36" y="162" fill="#52b788" font-size="9" font-family="system-ui">✓ IPEX / u.FL antenna connector</text>
<text x="36" y="178" fill="#52b788" font-size="9" font-family="system-ui">✓ Included 2.4 GHz antenna</text>
<text x="36" y="194" fill="#52b788" font-size="9" font-family="system-ui">✓ ESP32-S3 or ESP32-C3 chip</text>
<rect x="205" y="124" width="175" height="84" rx="8" fill="#0a150e" stroke="#1b3526" stroke-width="1"/>
<text x="221" y="144" fill="#94a3b8" font-size="10" font-weight="600" font-family="system-ui">What to avoid</text>
<text x="221" y="162" fill="#ef4444" font-size="9" font-family="system-ui">✗ Onboard chip/PCB antenna only</text>
<text x="221" y="178" fill="#ef4444" font-size="9" font-family="system-ui">✗ Original ESP32 (not S3/C3)</text>
<text x="221" y="194" fill="#ef4444" font-size="9" font-family="system-ui">✗ No external antenna connector</text>
</svg>`;
}

// ─── Master Map SVG helpers ──────────────────────────────────────────────────

function _svgMasterWhy() {
  return `<svg viewBox="0 0 400 240" xmlns="http://www.w3.org/2000/svg" width="100%" style="max-height:220px;background:#071008;border-radius:8px;display:block">
<text x="200" y="18" text-anchor="middle" fill="#fbbf24" font-size="11" font-weight="700" font-family="system-ui">Why you need a Master Map</text>
<rect x="20" y="30" width="170" height="130" rx="8" fill="#0a150e" stroke="#fbbf2444" stroke-width="1.5" stroke-dasharray="6,3"/>
<text x="105" y="50" text-anchor="middle" fill="#fbbf24" font-size="10" font-weight="600" font-family="system-ui">Ground Floor (Master)</text>
<rect x="35" y="58" width="65" height="40" rx="4" fill="#52b78815" stroke="#52b788" stroke-width="0.8"/>
<text x="67" y="82" text-anchor="middle" fill="#52b788" font-size="8" font-family="system-ui">Kitchen</text>
<rect x="110" y="58" width="65" height="40" rx="4" fill="#52b78815" stroke="#52b788" stroke-width="0.8"/>
<text x="142" y="82" text-anchor="middle" fill="#52b788" font-size="8" font-family="system-ui">Living</text>
<rect x="35" y="105" width="140" height="40" rx="4" fill="#52b78815" stroke="#52b788" stroke-width="0.8"/>
<text x="105" y="129" text-anchor="middle" fill="#52b788" font-size="8" font-family="system-ui">Hallway</text>
<text x="105" y="155" text-anchor="middle" fill="#fbbf24" font-size="22">⭐</text>
<rect x="210" y="30" width="170" height="130" rx="8" fill="#0a150e" stroke="#1b3526" stroke-width="1"/>
<text x="295" y="50" text-anchor="middle" fill="#94a3b8" font-size="10" font-weight="600" font-family="system-ui">First Floor</text>
<rect x="225" y="58" width="65" height="40" rx="4" fill="#52b78815" stroke="#52b788" stroke-width="0.8"/>
<text x="257" y="82" text-anchor="middle" fill="#52b788" font-size="8" font-family="system-ui">Bedroom</text>
<rect x="300" y="58" width="65" height="40" rx="4" fill="#52b78815" stroke="#52b788" stroke-width="0.8"/>
<text x="332" y="82" text-anchor="middle" fill="#52b788" font-size="8" font-family="system-ui">Bath</text>
<line x1="190" y1="95" x2="210" y2="95" stroke="#78909c" stroke-width="1" stroke-dasharray="3,2"/>
<text x="200" y="90" text-anchor="middle" fill="#78909c" font-size="8" font-family="system-ui">aligns to</text>
<rect x="20" y="170" width="360" height="58" rx="6" fill="#0a150e" stroke="#1b3526" stroke-width="1"/>
<text x="200" y="190" text-anchor="middle" fill="#94a3b8" font-size="9" font-family="system-ui">The master map is the fixed anchor. Every other map aligns</text>
<text x="200" y="204" text-anchor="middle" fill="#94a3b8" font-size="9" font-family="system-ui">to it. When rooms overlap across floors, the master's room</text>
<text x="200" y="218" text-anchor="middle" fill="#52b788" font-size="9" font-weight="600" font-family="system-ui">boundaries take precedence for object placement.</text>
</svg>`;
}

function _svgMasterChoose() {
  return `<svg viewBox="0 0 400 240" xmlns="http://www.w3.org/2000/svg" width="100%" style="max-height:220px;background:#071008;border-radius:8px;display:block">
<text x="200" y="18" text-anchor="middle" fill="#fbbf24" font-size="11" font-weight="700" font-family="system-ui">Choosing the right Master Map</text>
<rect x="20" y="30" width="175" height="100" rx="8" fill="#0a150e" stroke="#52b788" stroke-width="1.5"/>
<text x="107" y="50" text-anchor="middle" fill="#52b788" font-size="10" font-weight="600" font-family="system-ui">Good master</text>
<text x="107" y="68" text-anchor="middle" fill="#52b788" font-size="9" font-family="system-ui">✓ Largest footprint</text>
<text x="107" y="82" text-anchor="middle" fill="#52b788" font-size="9" font-family="system-ui">✓ Most rooms covered</text>
<text x="107" y="96" text-anchor="middle" fill="#52b788" font-size="9" font-family="system-ui">✓ Clear room boundaries</text>
<text x="107" y="110" text-anchor="middle" fill="#52b788" font-size="9" font-family="system-ui">✓ Accurate scale / dimensions</text>
<text x="107" y="124" text-anchor="middle" fill="#52b788" font-size="9" font-family="system-ui">✓ Easy to read when overlaid</text>
<rect x="205" y="30" width="175" height="100" rx="8" fill="#0a150e" stroke="#ef4444" stroke-width="1"/>
<text x="292" y="50" text-anchor="middle" fill="#ef4444" font-size="10" font-weight="600" font-family="system-ui">Poor master</text>
<text x="292" y="68" text-anchor="middle" fill="#ef4444" font-size="9" font-family="system-ui">✗ Small partial floor plan</text>
<text x="292" y="82" text-anchor="middle" fill="#ef4444" font-size="9" font-family="system-ui">✗ Few rooms</text>
<text x="292" y="96" text-anchor="middle" fill="#ef4444" font-size="9" font-family="system-ui">✗ Wrong scale or rotated</text>
<text x="292" y="110" text-anchor="middle" fill="#ef4444" font-size="9" font-family="system-ui">✗ Hard to see under overlays</text>
<text x="292" y="124" text-anchor="middle" fill="#ef4444" font-size="9" font-family="system-ui">✗ Not on ground floor</text>
<rect x="20" y="140" width="360" height="86" rx="6" fill="#0a150e" stroke="#1b3526" stroke-width="1"/>
<text x="200" y="160" text-anchor="middle" fill="#fbbf24" font-size="10" font-weight="600" font-family="system-ui">Pick the map that covers the most of your home</text>
<text x="200" y="178" text-anchor="middle" fill="#94a3b8" font-size="9" font-family="system-ui">It should be the most accurate floor plan you have — the one</text>
<text x="200" y="192" text-anchor="middle" fill="#94a3b8" font-size="9" font-family="system-ui">where room positions and proportions are closest to reality.</text>
<text x="200" y="206" text-anchor="middle" fill="#94a3b8" font-size="9" font-family="system-ui">When other maps are stacked on top in the 3D view, you need</text>
<text x="200" y="220" text-anchor="middle" fill="#52b788" font-size="9" font-weight="600" font-family="system-ui">to still be able to see where things are on the master beneath.</text>
</svg>`;
}

function _svgMasterSet() {
  return `<svg viewBox="0 0 400 240" xmlns="http://www.w3.org/2000/svg" width="100%" style="max-height:220px;background:#071008;border-radius:8px;display:block">
<text x="200" y="18" text-anchor="middle" fill="#fbbf24" font-size="11" font-weight="700" font-family="system-ui">Setting the Master in Maps → Library</text>
<rect x="30" y="32" width="340" height="36" rx="6" fill="#0a150e" stroke="#1b3526" stroke-width="1"/>
<text x="46" y="55" fill="#94a3b8" font-size="10" font-family="system-ui">Ground Floor</text>
<rect x="280" y="40" width="78" height="20" rx="4" fill="#0a2a1a" stroke="#52b788" stroke-width="0.8"/>
<text x="319" y="54" text-anchor="middle" fill="#52b788" font-size="9" font-weight="600" font-family="system-ui">Set Master</text>
<rect x="30" y="74" width="340" height="36" rx="6" fill="#0a150e" stroke="#fbbf2444" stroke-width="1.5" stroke-dasharray="5,3"/>
<rect x="46" y="80" width="26" height="14" rx="3" fill="#fbbf2422" stroke="#fbbf24" stroke-width="0.6"/>
<text x="59" y="90" text-anchor="middle" fill="#fbbf24" font-size="7" font-weight="600" font-family="system-ui">⭐</text>
<text x="82" y="97" fill="#fbbf24" font-size="10" font-weight="600" font-family="system-ui">First Floor  (master)</text>
<rect x="280" y="82" width="78" height="20" rx="4" fill="#1a0a00" stroke="#d97706" stroke-width="0.8"/>
<text x="319" y="96" text-anchor="middle" fill="#fbbf24" font-size="9" font-family="system-ui">Unset</text>
<rect x="30" y="116" width="340" height="36" rx="6" fill="#0a150e" stroke="#1b3526" stroke-width="1"/>
<text x="46" y="139" fill="#94a3b8" font-size="10" font-family="system-ui">Basement</text>
<rect x="280" y="124" width="78" height="20" rx="4" fill="#0a2a1a" stroke="#52b788" stroke-width="0.8"/>
<text x="319" y="138" text-anchor="middle" fill="#52b788" font-size="9" font-weight="600" font-family="system-ui">Set Master</text>
<rect x="30" y="162" width="340" height="66" rx="6" fill="#0a150e" stroke="#1b3526" stroke-width="1"/>
<text x="200" y="182" text-anchor="middle" fill="#94a3b8" font-size="9" font-family="system-ui">Open Maps → Library. Find the map you want as master and</text>
<text x="200" y="196" text-anchor="middle" fill="#94a3b8" font-size="9" font-family="system-ui">click Set Master. Only ground-level maps (z_level 0) with no</text>
<text x="200" y="210" text-anchor="middle" fill="#94a3b8" font-size="9" font-family="system-ui">offsets or rotation are eligible. A gold star badge appears</text>
<text x="200" y="224" text-anchor="middle" fill="#fbbf24" font-size="9" font-weight="600" font-family="system-ui">and the map becomes protected from accidental changes.</text>
</svg>`;
}

function _svgMasterAlign() {
  return `<svg viewBox="0 0 400 240" xmlns="http://www.w3.org/2000/svg" width="100%" style="max-height:220px;background:#071008;border-radius:8px;display:block">
<style>@keyframes ap{0%{opacity:0.3}50%{opacity:1}100%{opacity:0.3}}</style>
<text x="200" y="18" text-anchor="middle" fill="#fbbf24" font-size="11" font-weight="700" font-family="system-ui">Aligning other maps to the Master</text>
<rect x="20" y="30" width="360" height="120" rx="8" fill="#0a150e" stroke="#1b3526" stroke-width="1"/>
<rect x="40" y="50" width="140" height="80" rx="6" fill="#fbbf2408" stroke="#fbbf2444" stroke-width="1.5" stroke-dasharray="5,3"/>
<text x="110" y="68" text-anchor="middle" fill="#fbbf24" font-size="9" font-weight="600" font-family="system-ui">⭐ Master (reference)</text>
<rect x="55" y="78" width="50" height="22" rx="3" fill="#52b78815" stroke="#52b788" stroke-width="0.6"/>
<text x="80" y="93" text-anchor="middle" fill="#52b788" font-size="7" font-family="system-ui">Kitchen</text>
<rect x="115" y="78" width="50" height="22" rx="3" fill="#52b78815" stroke="#52b788" stroke-width="0.6"/>
<text x="140" y="93" text-anchor="middle" fill="#52b788" font-size="7" font-family="system-ui">Living</text>
<rect x="55" y="105" width="110" height="18" rx="3" fill="#52b78815" stroke="#52b788" stroke-width="0.6"/>
<text x="110" y="118" text-anchor="middle" fill="#52b788" font-size="7" font-family="system-ui">Hallway</text>
<rect x="220" y="50" width="140" height="80" rx="6" fill="#c084fc08" stroke="#c084fc44" stroke-width="1"/>
<text x="290" y="68" text-anchor="middle" fill="#c084fc" font-size="9" font-weight="600" font-family="system-ui">First Floor (target)</text>
<rect x="235" y="78" width="50" height="22" rx="3" fill="#c084fc15" stroke="#c084fc" stroke-width="0.6"/>
<text x="260" y="93" text-anchor="middle" fill="#c084fc" font-size="7" font-family="system-ui">Bed 1</text>
<rect x="295" y="78" width="50" height="22" rx="3" fill="#c084fc15" stroke="#c084fc" stroke-width="0.6"/>
<text x="320" y="93" text-anchor="middle" fill="#c084fc" font-size="7" font-family="system-ui">Bath</text>
<line x1="180" y1="90" x2="220" y2="90" stroke="#78909c" stroke-width="1.5" stroke-dasharray="4,2"/>
<text x="200" y="85" text-anchor="middle" fill="#78909c" font-size="8" font-weight="600" font-family="system-ui" style="animation:ap 2s infinite">align</text>
<rect x="20" y="158" width="360" height="72" rx="6" fill="#0a150e" stroke="#1b3526" stroke-width="1"/>
<text x="200" y="178" text-anchor="middle" fill="#94a3b8" font-size="9" font-family="system-ui">Go to Maps → Alignment. Set the master as the Reference map</text>
<text x="200" y="192" text-anchor="middle" fill="#94a3b8" font-size="9" font-family="system-ui">and your second floor plan as the Target. Drag the target</text>
<text x="200" y="206" text-anchor="middle" fill="#94a3b8" font-size="9" font-family="system-ui">until stairwells, walls, or exterior boundaries line up.</text>
<text x="200" y="220" text-anchor="middle" fill="#52b788" font-size="9" font-weight="600" font-family="system-ui">Click Save. The master never moves — only the target shifts.</text>
</svg>`;
}

function _svgRotateImage() {
  return `<svg viewBox="0 0 400 240" xmlns="http://www.w3.org/2000/svg" width="100%" style="max-height:220px;background:#071008;border-radius:8px;display:block">
<style>@keyframes rotArrow{0%{transform:rotate(0deg)}100%{transform:rotate(90deg)}}.ra{animation:rotArrow 2s ease-in-out infinite alternate;transform-origin:200px 110px}</style>
<text x="200" y="18" text-anchor="middle" fill="#60a5fa" font-size="11" font-weight="700" font-family="system-ui">Rotate image BEFORE drawing rooms</text>
<rect x="30" y="34" width="140" height="100" rx="6" fill="#0a150e" stroke="#ef4444" stroke-width="1.5"/>
<text x="100" y="54" text-anchor="middle" fill="#ef4444" font-size="9" font-weight="600" font-family="system-ui">Before rotation</text>
<line x1="50" y1="70" x2="80" y2="120" stroke="#ef4444" stroke-width="1" stroke-dasharray="3,2"/>
<rect x="55" y="72" width="30" height="20" rx="2" fill="#ef444420" stroke="#ef4444" stroke-width="0.6" transform="rotate(-25 70 82)"/>
<text x="100" y="90" text-anchor="middle" fill="#64748b" font-size="8" font-family="system-ui">Rooms tilted in</text>
<text x="100" y="102" text-anchor="middle" fill="#64748b" font-size="8" font-family="system-ui">3D stack view</text>
<text x="100" y="128" text-anchor="middle" fill="#ef4444" font-size="8" font-family="system-ui">✗ Walls don't align</text>
<rect x="230" y="34" width="140" height="100" rx="6" fill="#0a150e" stroke="#52b788" stroke-width="1.5"/>
<text x="300" y="54" text-anchor="middle" fill="#52b788" font-size="9" font-weight="600" font-family="system-ui">After rotation</text>
<rect x="250" y="68" width="50" height="30" rx="2" fill="#52b78815" stroke="#52b788" stroke-width="0.6"/>
<text x="275" y="87" text-anchor="middle" fill="#52b788" font-size="7" font-family="system-ui">Kitchen</text>
<rect x="310" y="68" width="40" height="30" rx="2" fill="#52b78815" stroke="#52b788" stroke-width="0.6"/>
<text x="330" y="87" text-anchor="middle" fill="#52b788" font-size="7" font-family="system-ui">Bath</text>
<text x="300" y="115" text-anchor="middle" fill="#52b788" font-size="8" font-family="system-ui">✓ Clean alignment</text>
<text x="300" y="128" text-anchor="middle" fill="#52b788" font-size="8" font-family="system-ui">✓ Walls straight in 3D</text>
<g class="ra"><path d="M185 110 A20 20 0 0 1 215 110" fill="none" stroke="#60a5fa" stroke-width="2"/><polygon points="214,106 218,112 212,112" fill="#60a5fa"/></g>
<rect x="20" y="148" width="360" height="80" rx="6" fill="#0a150e" stroke="#1b3526" stroke-width="1"/>
<text x="200" y="168" text-anchor="middle" fill="#60a5fa" font-size="9" font-weight="600" font-family="system-ui">Rotate your floor plan image in Edit BEFORE drawing rooms</text>
<text x="200" y="184" text-anchor="middle" fill="#94a3b8" font-size="9" font-family="system-ui">Most floor plans from estate agents or architects are rotated</text>
<text x="200" y="198" text-anchor="middle" fill="#94a3b8" font-size="9" font-family="system-ui">so north faces up. But in the 3D stack view, walls should run</text>
<text x="200" y="212" text-anchor="middle" fill="#94a3b8" font-size="9" font-family="system-ui">parallel to the screen edges for clean alignment. Use Edit →</text>
<text x="200" y="226" text-anchor="middle" fill="#52b788" font-size="9" font-weight="600" font-family="system-ui">Rotate Image to fix this before placing any room boundaries.</text>
</svg>`;
}

function _svgFactoryReset() {
  return `<svg viewBox="0 0 400 200" xmlns="http://www.w3.org/2000/svg" width="100%" style="max-height:180px;background:#071008;border-radius:8px;display:block">
<style>@keyframes warnFlash{0%,100%{fill:#ef4444;opacity:1}50%{fill:#7f1d1d;opacity:0.6}}.wf{animation:warnFlash 1.5s ease-in-out infinite}</style>
<text x="200" y="18" text-anchor="middle" fill="#ef4444" font-size="11" font-weight="700" font-family="system-ui">Factory Reset — erases everything</text>
<rect x="30" y="30" width="340" height="80" rx="8" fill="#1a0a0a" stroke="#7f1d1d" stroke-width="1.5"/>
<text class="wf" x="200" y="52" text-anchor="middle" font-size="22" font-family="system-ui">⚠</text>
<text x="200" y="72" text-anchor="middle" fill="#fca5a5" font-size="9" font-family="system-ui">Clears: settings, calibration, objects, maps, model,</text>
<text x="200" y="86" text-anchor="middle" fill="#fca5a5" font-size="9" font-family="system-ui">alerts, movement, traceback, history, and backups</text>
<text x="200" y="100" text-anchor="middle" fill="#ef4444" font-size="9" font-weight="600" font-family="system-ui">BLE radios kept intact — only PadSpan data is erased</text>
<rect x="30" y="120" width="340" height="68" rx="6" fill="#0a150e" stroke="#1b3526" stroke-width="1"/>
<text x="200" y="140" text-anchor="middle" fill="#94a3b8" font-size="9" font-family="system-ui">Found in Settings → Manage tab (Advanced mode).</text>
<text x="200" y="156" text-anchor="middle" fill="#94a3b8" font-size="9" font-family="system-ui">Requires typing "FACTORY RESET" to confirm. Admin only.</text>
<text x="200" y="172" text-anchor="middle" fill="#94a3b8" font-size="9" font-family="system-ui">Use when starting over or troubleshooting persistent issues.</text>
<text x="200" y="188" text-anchor="middle" fill="#52b788" font-size="9" font-weight="600" font-family="system-ui">HA restart recommended after factory reset.</text>
</svg>`;
}

function _svg2dMode() {
  return `<svg viewBox="0 0 400 200" xmlns="http://www.w3.org/2000/svg" width="100%" style="max-height:180px;background:#071008;border-radius:8px;display:block">
<text x="200" y="18" text-anchor="middle" fill="#60a5fa" font-size="11" font-weight="700" font-family="system-ui">2D Flat Map vs 3D Isometric View</text>
<rect x="20" y="30" width="170" height="110" rx="8" fill="#0a150e" stroke="#1b3526" stroke-width="1.5"/>
<text x="105" y="50" text-anchor="middle" fill="#94a3b8" font-size="10" font-weight="600" font-family="system-ui">3D Isometric (default)</text>
<g transform="skewX(-15) translate(55,55)"><rect width="80" height="50" rx="3" fill="#52b78815" stroke="#52b788" stroke-width="0.8"/></g>
<g transform="skewX(-15) translate(55,35)"><rect width="80" height="50" rx="3" fill="#60a5fa15" stroke="#60a5fa" stroke-width="0.6" opacity="0.5"/></g>
<text x="105" y="130" text-anchor="middle" fill="#64748b" font-size="8" font-family="system-ui">Stacked floors in 3D</text>
<rect x="210" y="30" width="170" height="110" rx="8" fill="#0a150e" stroke="#60a5fa" stroke-width="1.5"/>
<text x="295" y="50" text-anchor="middle" fill="#60a5fa" font-size="10" font-weight="600" font-family="system-ui">2D Flat Map</text>
<rect x="230" y="58" width="130" height="70" rx="4" fill="#52b78815" stroke="#52b788" stroke-width="0.8"/>
<rect x="238" y="66" width="45" height="25" rx="2" fill="#52b78815" stroke="#52b788" stroke-width="0.5"/>
<text x="260" y="82" text-anchor="middle" fill="#52b788" font-size="7" font-family="system-ui">Kitchen</text>
<rect x="290" y="66" width="55" height="25" rx="2" fill="#52b78815" stroke="#52b788" stroke-width="0.5"/>
<text x="317" y="82" text-anchor="middle" fill="#52b788" font-size="7" font-family="system-ui">Living</text>
<circle cx="275" cy="105" r="4" fill="#14b8a6"/><text x="275" y="108" text-anchor="middle" fill="white" font-size="5" font-weight="700" font-family="system-ui">AL</text>
<text x="295" y="130" text-anchor="middle" fill="#64748b" font-size="8" font-family="system-ui">Zoom + pan, no tilt</text>
<rect x="20" y="150" width="360" height="40" rx="6" fill="#0a150e" stroke="#1b3526" stroke-width="1"/>
<text x="200" y="168" text-anchor="middle" fill="#94a3b8" font-size="9" font-family="system-ui">Enable in Settings → Appearance → 2D Flat Map Mode.</text>
<text x="200" y="182" text-anchor="middle" fill="#94a3b8" font-size="9" font-family="system-ui">Replaces the 3D isometric view with a flat zoomable map.</text>
</svg>`;
}

// ─── Walkthrough Definitions ──────────────────────────────────────────────────

const WALKTHROUGHS = [
  {
    id: "how_it_works",
    title: "How BLE Tracking Works",
    icon: "📡",
    summary: "Understand the technology behind PadSpan — BLE scanners, signal strength, and room detection.",
    steps: [
      { title: "Bluetooth Scanners Detect Devices",       text: "PadSpan uses Bluetooth Low Energy (BLE) scanners placed around your home. Each scanner continuously listens for nearby Bluetooth signals from phones, tags, key fobs, and any other BLE device.", svg: _svgBleSignals },
      { title: "Signal Strength Pinpoints the Room",      text: "Each scanner reports signal strength (RSSI) in dBm — more negative = weaker signal. The scanner with the strongest (least negative) reading is physically nearest to the device. That room is assigned as the device's location.", svg: _svgRssiComparison },
      { title: "Room Assignment Updates Live",            text: "PadSpan maps the signal data to your Home Assistant Areas. The location is recalculated every 5 seconds automatically — no manual refresh needed. In Sample mode you can explore with demo data before going live.", svg: _svgRoomAssignment },
      { title: "iBeacon Devices Survive MAC Rotation",    text: "Apple AirTags, Tile trackers, and the HA Companion App's iBeacon transmitter rotate their Bluetooth MAC address for privacy. PadSpan recognises these as iBeacon devices by the Apple manufacturer data (company ID 0x004C). All rotating MACs sharing the same UUID/Major/Minor are merged into one stable amber-badged object. Tag it once — the name sticks forever.", svg: _svgIbeacon },
      { title: "Track Anything Bluetooth",                text: "Phones tracked by the HA companion app, AirTags, Tile trackers, key fobs, smartwatches, fitness bands — if it emits a BLE signal, PadSpan can see it. Tag devices with friendly names so you always know what's what.", svg: _svgDeviceTypes },
    ],
  },
  {
    id: "scanner_hardware",
    title: "Choosing Scanner Hardware",
    icon: "🔧",
    summary: "Real-world testing with 20+ ESP32 boards — what actually works for room-level tracking and what doesn't.",
    steps: [
      { title: "The Antenna Makes the Difference",            text: "I had about a dozen old ESP32 boards kicking around from a project three years ago, and ordered 10 more specifically for testing. The old boards made OK BLE scanners when they happened to have a decent antenna, but most were poor. The signal readings jumped around too much from scan to scan — a room that read −62 one moment would read −78 the next. Swapping to boards with a full-size external antenna was the single biggest improvement. The chip matters way less than the antenna.", svg: _svgAntennaComparison },
      { title: "Three Boards That Worked",                    text: "Out of everything I tested, three setups stood out. First: an ESP32-S3 with a LAN (Ethernet) port and an external antenna — I'll be honest, this one didn't actually test better than the WiFi version, but the theory is sound (no WiFi radio competing with BLE) and it's the one I'd pick for a permanent install. Second: an ESP32-S3 with WiFi and a full-size antenna — this is probably the most practical choice for most people. Third: an ESP32-C3 with a full-size antenna — cheaper, and it still did the job well.", svg: _svgBoardRanking },
      { title: "Why Room Tracking Is Harder Than Home/Away",   text: "Getting a device's room right on a map is genuinely challenging. Home/away just needs to see any signal from any scanner — easy. Room-level tracking needs to reliably tell which scanner is closest, and sometimes the difference is only 7 dBm. A noisy chip antenna can flip that decision randomly. The whole point of PadSpan is placing devices in the correct room on a floor plan, and that only works when the signal readings are consistent enough to trust.", svg: _svgAntennaDetail },
    ],
  },
  {
    id: "tag_device",
    title: "Tag Your First Device",
    icon: "🏷️",
    summary: "Name an unidentified BLE device so it shows up with a friendly label across all of PadSpan.",
    steps: [
      { title: "Open the Objects Tab",                   text: "Click Objects in the sidebar. This lists every Bluetooth device currently visible to your scanners — including unidentified ones showing only a hardware address like AA:BB:CC:11:22:33.", svg: _svgObjectsList },
      { title: "Find an Unidentified Device",            text: "Look for an orange Unidentified badge next to a hardware address. That's a real BLE device your scanners can see but hasn't been named yet. You can use the search box to filter by address if you have many devices.", svg: _svgObjectsList },
      { title: "Click Tag and Enter a Name",             text: "Click the Tag button next to the device. A prompt appears — type a friendly name like 'Alice's AirTag', 'Car Keys', or 'Backpack Tracker'. Click Save. The name is stored permanently in Home Assistant.", svg: _svgTagModal },
      { title: "Your Named Device Appears Everywhere",   text: "The name instantly appears in Follow, Overview, Objects, and all other panels. The badge turns teal to show it's identified. You can rename it at any time using the Relabel button.", svg: _svgTaggedDevice },
    ],
  },
  {
    id: "floor_plan",
    title: "Set Up a Floor Plan",
    icon: "🗺️",
    summary: "Upload a floor plan image, draw room boundaries, and place your Bluetooth scanners on the map.",
    steps: [
      { title: "Upload Your Floor Plan",                 text: "Go to Mapping → Upload tab. Give the map a name like 'Ground Floor', choose your image file (PNG, JPG, or even a photo of a hand-drawn plan), and click Upload & Convert. PadSpan automatically resizes and stores it.", svg: _svgUpload },
      { title: "Rotate the Image First",                 text: "Before drawing rooms, check whether your floor plan needs rotating. Most plans from estate agents or architects are oriented with north at the top, but in PadSpan's 3D isometric stack view, walls should run parallel to the screen edges for clean alignment between floors. Open Edit, click Rotate Image, preview at 90°/180°/270°, then click Apply to bake the rotation into the actual image. This remaps any existing receivers and room boundaries automatically. Do this before drawing rooms — rotating after drawing means all your polygons shift perfectly, but it's easier to get the orientation right on a clean map.", svg: _svgRotateImage },
      { title: "Draw Room Boundaries",                   text: "In the Edit tab, select Rooms mode then pick a room from the dropdown. Rooms with a ⚠ warning are already placed on another map — you can still place them here but be aware they'll exist on multiple maps. Click on the floor plan image to place polygon points around that room. Click the first point again to close the shape. Repeat for each room.", svg: _svgDrawRooms },
      { title: "Place Your Bluetooth Scanners",          text: "Switch to Receivers mode in the Edit tab. Click anywhere on the floor plan to place a scanner icon where a physical Bluetooth radio is located. PadSpan uses these positions for distance calculations and visualisation.", svg: _svgPlaceScanners },
      { title: "Assign Scanners to Rooms (Bluetooth)",   text: "Go to Bluetooth → Scanners tab to see all detected radios. Use the Area dropdown on each scanner row to assign it to the correct room. This links the scanner's RSSI readings to the right room in the system.", svg: _svgPlaceScanners },
    ],
  },
  {
    id: "master_map",
    title: "Master Map & Alignment",
    icon: "⭐",
    summary: "Why one map should be your master — the fixed anchor that every other floor plan aligns to.",
    steps: [
      { title: "Why You Need a Master Map",
        text: "When your home has multiple floor plans — ground floor, first floor, basement — PadSpan stacks them in a 3D isometric view. But the system needs ONE fixed reference point so everything lines up correctly. The master map is that anchor. It never moves, never scales, never rotates. Every other map positions itself relative to the master. Without one, alignment drifts as you adjust maps independently and rooms end up misaligned across floors.",
        svg: _svgMasterWhy },
      { title: "Choosing the Right Master",
        text: "Pick the floor plan that covers the largest footprint of your home — usually the ground floor. It should be your most accurate map with the most rooms drawn. Critically, it needs to be easy to read when other maps are layered on top in the 3D stack view. If your master has thin lines or low contrast, it disappears under overlapping floors. A clear, high-contrast plan with well-defined room boundaries makes the best master because you can always see where things are even with two or three floors stacked above it.",
        svg: _svgMasterChoose },
      { title: "Setting the Master",
        text: "Open Maps → Library. Find your chosen map and click Set Master. Only maps at z_level 0 (ground level) with no offsets, scaling, or rotation are eligible — this ensures the master is in a pristine, unmodified state. Once set, a gold star badge appears next to the name. The master is now protected: PadSpan warns before any changes that would affect its position. You can unset it later if you need to, but avoid changing masters once other maps are aligned to it.",
        svg: _svgMasterSet },
      { title: "Aligning Other Maps to the Master",
        text: "Go to Maps → Alignment. Set your master as the Reference (it appears first with a star). Select the floor you want to align as the Target. Drag, scale, and rotate the target until structural features line up — stairwells, exterior walls, load-bearing walls that run through multiple floors. Click Save Alignment. The master stays fixed while the target records its offset. Repeat for each additional floor. If both maps are masters (shouldn't happen), PadSpan forces you to choose which one keeps the status before saving.",
        svg: _svgMasterAlign },
    ],
  },
  {
    id: "dashboard",
    title: "Reading the Dashboard",
    icon: "📊",
    summary: "Understand the Overview dashboard — KPI cards, room grid, and the Follow tracker.",
    steps: [
      { title: "Overview — Summary Counts",              text: "The Overview tab shows live counts of rooms, objects, and radios. In Advanced mode these appear as clickable KPI cards — tap any number to see a full list. Click any row in the list for detailed info on that item.", svg: _svgKpiCards },
      { title: "Room Grid — What's in Each Room",        text: "Scroll down to see the room grid. Each coloured box is a room. Inside: green antenna rings are Bluetooth scanners, teal dots are identified (named) devices, orange dots are unidentified BLE signals. Counts shown in the corner.", svg: _svgRoomGrid },
      { title: "2D Flat Map Mode",                        text: "If you prefer a simple flat view instead of the 3D isometric stack, enable 2D Flat Map Mode in Settings → Appearance. This replaces the tilted 3D floor stack with a flat overhead view of your floor plan that supports mouse-wheel zoom and click-drag panning. Device dots and scanner icons are rendered directly on the image. Useful on small screens or when you only have one floor.", svg: _svg2dMode },
      { title: "Follow — Track a Specific Tag",          text: "Switch to the Follow tab and pick any tracked device from the dropdown. You'll see its current room, signal strength, age of last detection, and a room map with a pulsing location dot. Advanced mode adds a movement history log.", svg: _svgFollowTab },
    ],
  },
  {
    id: "home_away",
    title: "Home/Away Detection",
    icon: "🏠",
    summary: "How PadSpan marks devices as not_home, the Away badge in Objects, and configuring the timeout.",
    steps: [
      { title: "Devices Are Tracked Even When Away",      text: "PadSpan keeps every tagged device in its tracking list even after it disappears from your scanners. A growing age_s counter tracks how long it's been since the device was last seen — no information is lost while waiting for it to return.", svg: _svgHaEntities },
      { title: "Away Badge Appears in Objects Tab",       text: "Once a device hasn't been seen for longer than the away timeout (default 5 minutes), a red Away badge replaces the signal bar in the Objects tab. 'Last: Kitchen' shows where it was before it went out of range. The normal teal/green badge returns the moment it reappears.", svg: _svgAwayBadge },
      { title: "HA Entities Switch to not_home",         text: "PadSpan creates a device_tracker entity (e.g. device_tracker.car_keys) and an area sensor (sensor.car_keys_area) for every tagged BLE device. When the device goes away, both entities automatically change state to not_home — ready for use in HA automations, the logbook, and Person tracking.", svg: _svgHaEntities },
      { title: "Configure the Timeout",                  text: "Go to Settings → Presence → Home/Away Timeout to change how long before a device is marked away. Default is 5 minutes. Raise it if devices drop off briefly in thick-walled rooms or during normal use (10–30 min is common). Set it lower for fast away detection (minimum 1 minute).", svg: _svgPresenceSettings },
    ],
  },
  {
    id: "calibration",
    title: "Calibrate for Accuracy",
    icon: "🎯",
    summary: "Walk around your home collecting signal fingerprints to build a calibration model for precise room detection.",
    steps: [
      { title: "Choose a Device and Floor Plan",           text: "Open the Calibration tab (visible in Advanced and Development modes) or use the standalone Calibration panel on your phone. Pick the BLE device you'll carry — usually your phone — and select which floor plan to calibrate. The standalone panel is optimised for one-handed phone use while walking around.", svg: _svgCalibSetup },
      { title: "Pin & Listen — Collect Fingerprints",      text: "In the Pin & Listen tab, tap the floor plan where you're physically standing. Stand still for about 10 seconds while PadSpan records the RSSI signal strength from every scanner that can see your device. Each tap-and-wait creates one calibration point. Collect 15–30 points spread around your home for a good model.", svg: _svgCalibPin },
      { title: "Roam — Check Coverage",                    text: "Switch to the Roam tab to see a coverage heatmap. Green cells have good fingerprint data, yellow have some, red need more. Walk to the red areas and collect more points there. The guided 'walk here next' target helps you fill gaps efficiently.", svg: _svgCalibHeatmap },
      { title: "Compute Model & Validate",                 text: "Switch to the Model tab and click Compute Model. PadSpan fits a k-NN fingerprint model and per-scanner OLS path-loss model from your collected data. Leave-one-out cross-validation scores the accuracy. 80%+ is good, 90%+ is excellent. You can always collect more points and recompute to improve the score.", svg: _svgCalibModel },
    ],
  },
  {
    id: "phone_tracking",
    title: "Track Your Phone",
    icon: "📱",
    summary: "Use the HA Companion App to track phones via BLE iBeacon. One-click setup with automatic transmitter enablement.",
    steps: [
      { title: "Install the HA Companion App",            text: "Install the Home Assistant Companion App on any phone you want to track (Android or iOS). The app includes a BLE Transmitter feature that broadcasts an iBeacon signal — a stable identifier that PadSpan can track even as the phone's Bluetooth MAC address rotates for privacy.", svg: _svgCompanionTrack },
      { title: "One-Click Track in Overview",              text: "Open Overview in PadSpan. If the Companion App is installed and registered with your HA instance, a blue 'Phones detected' card appears automatically. Click 'Track this phone' — PadSpan labels the phone, adds it to your followed list, and sends a command to enable the BLE Transmitter on the phone. All in one click.", svg: _svgCompanionTrack },
      { title: "What Happens Behind the Scenes",           text: "When you click Track, PadSpan: (1) stores a label for the phone's iBeacon key in the object store, (2) adds the key to your followed devices list, (3) enables the BLE Transmitter entity in HA's entity registry, and (4) sends a notification command to the Companion App to turn on BLE transmission. The phone starts broadcasting and appears on your map once a scanner picks it up.", svg: _svgIbeacon },
      { title: "Status Feedback",                         text: "After tracking, the button shows real status: green 'Tracked!' means the phone is visible to scanners. Yellow 'Waiting for signal' means the transmitter is on but no scanner has seen it yet — walk near a scanner. Amber 'Enable BLE Transmitter' means the command couldn't reach the app — open Companion App → Settings → Manage Sensors → BLE Transmitter and enable it manually.", svg: _svgCompanionTrack },
      { title: "Untrack a Phone",                         text: "In Advanced mode, already-tracked phones show their current status (Tracked / Waiting / BLE off) with an Untrack button. Clicking Untrack removes the label and unfollows the phone — it will revert to an anonymous BLE signal.", svg: _svgAwayBadge },
    ],
  },
  {
    id: "private_ble",
    title: "Private BLE (Apple Devices)",
    icon: "🔒",
    summary: "Track iPhones and Apple Watches that rotate their MAC address using Identity Resolving Keys (IRK).",
    steps: [
      { title: "The MAC Rotation Problem",                text: "Modern phones — especially iPhones and Apple Watches — rotate their Bluetooth MAC address every 15 minutes for privacy. Without special handling, each rotation creates a new 'unknown device' in your scanner list. Your iPhone might show up as dozens of different unidentified entries.", svg: _svgPrivateBle },
      { title: "IRK — Identity Resolving Key",            text: "Every Bluetooth device that uses private addressing has an IRK — a cryptographic key that can resolve the rotating addresses back to one stable identity. Home Assistant's Private BLE Device integration stores these IRKs and matches them to incoming advertisements. PadSpan reads the resolved identities and groups all the rotating MACs into a single blue-badged object.", svg: _svgPrivateBle },
      { title: "Adding an IRK in PadSpan",                text: "Go to Settings → Private BLE Devices and click Add IRK. Enter the IRK in any format — plain hex, colon-separated, or base64. PadSpan tries all three formats automatically. Once added, the device appears with a blue badge in Objects, and its advertisements are matched across all scanners regardless of which MAC address happens to be active.", svg: _svgPrivateBle },
      { title: "Calibration with Private BLE Devices",    text: "Private BLE devices work in calibration just like any other tracked device. The calibration system matches advertisements by canonical identity (not by MAC address), so fingerprints collected while the MAC was one value still match when it rotates to another. You can use your iPhone as the calibration device without worrying about address changes.", svg: _svgCalibSetup },
    ],
  },
  {
    id: "quiet_clear",
    title: "Quiet Mode & Cleanup",
    icon: "🧹",
    summary: "Reduce visual clutter with Quiet Mode and clean up unidentified devices while keeping your tagged items.",
    steps: [
      { title: "Quiet Mode",                             text: "Toggle Quiet Mode from the top-right corner of Overview (both Basic and Advanced modes). When enabled, the overview and room grid hide unidentified devices and show only your tagged and followed objects. The room dots switch from showing everything to showing just the devices you care about. Great for everyday use once your initial setup is done.", svg: _svgQuietMode },
      { title: "Clear Unidentified",                     text: "The 'Clear unidentified' button removes all untagged, unfollowed BLE objects from PadSpan's history cache. Available in the Overview Objects card (Advanced mode) and the Objects tab. Tagged devices (those you've named) and followed devices (those you're tracking) are always preserved — only anonymous hardware addresses are cleared.", svg: _svgClearUnidentified },
      { title: "When to Clear",                           text: "Clear unidentified after tagging your important devices, if you have dozens of unknown Bluetooth signals cluttering the list (neighbours' phones, passing cars, etc.). The devices will reappear on the next scan cycle if they're still in range, but old stale entries are gone. Use Quiet Mode to hide them without deleting — Clear to actually remove them.", svg: _svgClearUnidentified },
    ],
  },
  {
    id: "manage",
    title: "Manage Your Setup",
    icon: "⚙️",
    summary: "Clean up tags, delete HA areas, remove orphaned map data, and keep your system tidy.",
    steps: [
      { title: "The Manage Tab",                         text: "The Manage tab gives you full control over your PadSpan data. It's visible in Advanced and Development modes (cycle the mode toggle in the top bar). Click Manage in the sidebar to find tabs for BLE Tags, Rooms (HA Areas), Maps, and Data.", svg: _svgManageOverview },
      { title: "Untag or Remove BLE Devices",           text: "Under BLE Tags, every named BLE device is listed with its last-seen time. Click Delete to remove the name — the device reverts to showing its hardware address. A two-click confirm prevents accidental deletes.", svg: _svgUntagDevice },
      { title: "Clean Up Orphan Polygons",              text: "The Data tab's Orphan Room Polygons scanner finds room boundaries in your maps that no longer match a real HA area — commonly leftover from sample mode or rooms that were deleted. Delete them individually or all at once.", svg: _svgOrphanClean },
      { title: "Factory Reset",                         text: "When you need a completely fresh start, use Factory Reset in Settings → Manage tab. This erases all PadSpan persistent data — settings, calibration, objects, maps, model, alerts, movement history, and backups. BLE radio data is kept intact so scanners continue working. You must type 'FACTORY RESET' to confirm (admin only). Restart HA afterwards. Use this when troubleshooting persistent issues or starting a clean setup from scratch.", svg: _svgFactoryReset },
    ],
  },
];

// ─── Manual Section Definitions ───────────────────────────────────────────────
// Auto-update: sections that reference helpKeys pull their text from the HELP dict
// at render time. Update help_content.js → the manual automatically reflects it.

const MANUAL_SECTIONS = [
  {
    id: "intro",
    title: "What is PadSpan™ HA?",
    icon: "🏠",
    paragraphs: [
      "PadSpan™ HA is a custom Home Assistant integration that adds whole-home Bluetooth Low Energy (BLE) presence tracking. It turns your existing Bluetooth scanners (ESPresense, Bermuda, or similar) into a real-time people and object tracking system.",
      "Unlike basic presence detection that only knows if someone is home or away, PadSpan tells you which room a person or device is in — and updates every 5 seconds.",
      "PadSpan shows all tracked devices on a live room map, lets you follow a specific tag, draw floor plans with room boundaries, and build multi-floor 3D visualisations. Everything runs locally inside Home Assistant — no cloud required.",
    ],
  },
  {
    id: "concepts",
    title: "Key Concepts",
    icon: "💡",
    paragraphs: [
      "BLE (Bluetooth Low Energy) — a low-power radio standard used by phones, AirTags, Tile trackers, key fobs, smartwatches, and many other devices. BLE devices broadcast a signal that nearby scanners can detect.",
      "RSSI (Received Signal Strength Indicator) — measured in dBm (e.g. −55 dBm). More negative = weaker signal = further away. PadSpan uses RSSI from multiple scanners to determine which room a device is in.",
      "Scanner / Radio — a Bluetooth receiver placed in a room. ESPresense on an ESP32 or a Bermuda-tracked device are common choices. Multiple scanners per floor give better accuracy.",
      "Area — a room defined in Home Assistant's Areas & Zones. PadSpan uses your HA areas as its room list. Create and rename rooms in HA Settings → Areas & Zones.",
      "Object — anything PadSpan is tracking. Could be a phone (via HA Companion App), an AirTag, a Tile tracker, a key fob, or any unnamed BLE signal.",
      "iBeacon — a BLE advertising format used by Apple AirTags, Tile trackers, and the HA Companion App. Contains a stable UUID/Major/Minor identifier that doesn't change even as the MAC address rotates. PadSpan groups all rotating MACs for the same iBeacon into one amber-badged object.",
      "Private BLE — phones (especially iPhones and Apple Watches) rotate their MAC address for privacy. PadSpan resolves these using IRK (Identity Resolving Key) so they appear as a single stable blue-badged object rather than many unknowns. Add IRKs via Settings → Private BLE Devices.",
      "Companion Phone Tracking — one-click phone tracking from the Overview tab. PadSpan detects phones with the HA Companion App installed, labels them, follows them, and sends a command to enable BLE transmission automatically.",
      "Tag — a friendly name you assign to an unidentified BLE device. Tagged devices show up with their name everywhere in PadSpan. PadSpan also creates HA entities (device_tracker and area sensor) for each tagged device.",
      "Follow — mark a device to track it. Followed devices appear in the Follow tab with live location, are preserved when clearing unidentified objects, and create ghost placeholders if not yet visible to scanners.",
      "Quiet Mode — toggle in Overview top-right. Hides unidentified devices from the overview and room grid, showing only tagged and followed objects. Default off.",
      "Home/Away — if a device hasn't been seen for longer than the away timeout (configurable, default 5 min), its device_tracker state changes to not_home and a red Away badge appears in the Objects tab.",
      "Sample Mode — a demo mode using fictional data (the Smith Residence). Great for exploring PadSpan without live hardware. Toggle between Sample and Live in the top bar.",
    ],
  },
  {
    id: "getting_started",
    title: "Getting Started",
    icon: "🚀",
    paragraphs: [
      "1. Install PadSpan HA via HACS as a custom repository. After adding the repository, install the integration and restart Home Assistant completely (not just reload — a full restart is required).",
      "2. Make sure your Bluetooth scanners are set up and reporting to Home Assistant. ESPresense and Bermuda are the most popular options and work out of the box with PadSpan.",
      "3. Create your rooms in HA Settings → Areas & Zones. PadSpan reads your areas directly — no separate room setup needed.",
      "4. Open PadSpan HA from the sidebar. Use Sample mode first to familiarise yourself with the interface, then switch to Live mode to see your real devices.",
      "5. Track phones: if you have the HA Companion App installed, open Overview — detected phones appear in a blue card. Click 'Track this phone' for one-click setup. PadSpan labels the phone, follows it, and enables BLE transmission automatically.",
      "6. Tag other devices in the Objects tab with friendly names. Then switch to Follow to track them in real time.",
      "7. For Apple devices (iPhones, Apple Watches), add their IRK via Settings → Private BLE Devices so PadSpan can resolve their rotating MAC addresses into a single stable identity.",
      "Tip: If the Bluetooth tab shows 'No live data', make sure HA was fully restarted after install — not just reloaded. Use Quiet Mode (Overview top-right toggle) to hide unidentified clutter once your devices are tagged.",
    ],
  },
  {
    id: "help_follow",
    title: "Follow Tab",
    icon: "🎯",
    helpKeys: ["follow", "follow_selector", "follow_map", "follow_alerts"],
  },
  {
    id: "help_overview",
    title: "Overview Tab",
    icon: "📋",
    helpKeys: ["overview", "overview_grid"],
  },
  {
    id: "help_objects",
    title: "Objects Tab",
    icon: "🏷️",
    helpKeys: ["objects", "objects_tag"],
  },
  {
    id: "phone_tracking_section",
    title: "Phone Tracking (Companion App)",
    icon: "📱",
    paragraphs: [
      "PadSpan can automatically detect and track phones running the HA Companion App. This works on both Android and iOS.",
      "How it works: The Companion App includes a BLE Transmitter sensor that broadcasts an iBeacon signal. PadSpan reads the transmitter entity's UUID, Major, and Minor values and constructs a stable iBeacon key. This key survives MAC address rotation — the phone always shows as one object.",
      "One-click setup: In Overview, detected Companion App phones appear in a blue card. Click 'Track this phone' to: (1) label the phone with its device name, (2) add it to your followed list, (3) enable the BLE Transmitter entity in HA, and (4) send a notification command to the Companion App to start BLE transmission.",
      "Status indicators: After tracking, the system shows real status — green 'Tracked!' means visible to scanners, yellow 'Waiting for signal' means transmitting but not yet seen (walk near a scanner), amber 'Enable BLE Transmitter' means the enable command didn't reach the app (enable manually in Companion App → Settings → Manage Sensors → BLE Transmitter).",
      "Ghost objects: If you track a phone but it's not yet visible to any scanner, PadSpan creates a placeholder (ghost) object so it appears in your Objects list immediately. The ghost disappears once a real BLE signal is received.",
      "Untracking: In Advanced mode, tracked phones show an Untrack button. This removes the label and unfollows the phone.",
    ],
  },
  {
    id: "private_ble_section",
    title: "Private BLE & IRK",
    icon: "🔒",
    paragraphs: [
      "Modern phones (especially Apple devices) rotate their Bluetooth MAC address every 15 minutes for privacy. Without resolution, each rotation creates a new unknown device in your list.",
      "IRK (Identity Resolving Key) is a cryptographic key that resolves rotating addresses back to one stable identity. Home Assistant's Private BLE Device integration stores IRKs and matches them to incoming BLE advertisements.",
      "Adding an IRK: Go to Settings → Private BLE Devices → Add IRK. Enter the key in any format: plain hex (32 chars), colon-separated (AA:BB:CC:...), or base64 encoded. PadSpan tries all three formats automatically and handles multi-step config flows.",
      "Once added, the device appears with a blue badge in Objects, Follow, Presence, and all other views. All rotating MAC addresses are merged into one stable entry.",
      "Calibration: Private BLE devices work in calibration by matching on canonical identity rather than MAC address. Fingerprints collected with one MAC still match after rotation. You can use your iPhone as a calibration device without issues.",
      "iBeacon vs Private BLE: These are complementary. iBeacon (amber badge) tracks devices by UUID/Major/Minor — used by AirTags, Tile trackers, and the Companion App transmitter. Private BLE (blue badge) resolves rotating MACs via IRK — used for iPhones and Apple Watches. Some devices can be tracked both ways.",
    ],
  },
  {
    id: "help_maps",
    title: "Mapping",
    icon: "🗺️",
    helpKeys: ["maps", "maps_library", "maps_upload", "maps_stack"],
  },
  {
    id: "master_map",
    title: "Master Map & Alignment",
    icon: "⭐",
    paragraphs: [
      "The master map is the fixed anchor that all other floor plans align to. When PadSpan stacks multiple maps in the 3D isometric view, it needs one reference point that never moves — that's the master.",
      "Why it matters: Without a master, each map is positioned independently. If you adjust one map's offset to line up a stairwell, another map's alignment might break. The master gives you a stable coordinate system: it stays at position (0, 0) with scale 1.0 and rotation 0. Every other map stores its offset, scale, and rotation relative to the master.",
      "Choosing the right master: Pick the floor plan that (1) covers the largest footprint of your home, (2) has the most rooms with drawn boundaries, (3) is the most dimensionally accurate, and (4) is easy to see when other maps are overlaid on top. The last point matters more than you'd expect — if the master has thin lines or low contrast, it disappears under overlapping floors and you can't verify alignment visually. A clear, bold floor plan makes the best master.",
      "The master should almost always be the ground floor. It's the largest level in most homes, and other floors typically have smaller footprints that align within its boundaries. Setting a small partial floor plan as master forces larger maps to squeeze to fit — the opposite of what you want.",
      "How to set it: Go to Maps → Library. Only maps at z_level 0 (ground level) with no offsets, scaling, or rotation are eligible for master status. Click Set Master on your chosen map. A gold star badge appears and the map becomes protected from accidental position changes.",
      "Aligning other maps: Go to Maps → Alignment. Choose the master as the Reference map (it's sorted to the top with a star). Select another floor as the Target. Drag and scale the target until shared structural features line up — stairwells, exterior walls, chimneys, load-bearing walls that pass through multiple floors. Click Save Alignment. The master stays fixed; only the target records the new position.",
      "Alignment protection: PadSpan warns before you modify a master's position. If you select a master as the alignment target, a warning banner explains that saving will revoke its master status. In the rare case where both reference and target are masters, PadSpan forces you to choose which one keeps the status before saving.",
      "Tip: Once your master is set and other maps are aligned to it, avoid changing masters. Re-aligning everything is tedious. Get the master right the first time.",
      "Changing masters: Maps \u2192 Library offers a Change Master wizard. It inverts the new master\u2019s alignment and moves every map \u2014 all of them, not only the ones aligned to the old master \u2014 into the new master\u2019s frame in one exact step, so maps keep their positions relative to each other, including maps placed by Point Align. The quality of the result is the quality of one input: the alignment between the old and new master. Align them as perfectly as possible in the Alignment tab first \u2014 the wizard refuses to run until that alignment exists, and whatever error it carries becomes the frame everything is measured in. Tie-in history is cleared on both masters. Afterward, verify the 3D Stack and Alignment tabs look right before recalibrating anything.",
    ],
  },
  {
    id: "quiet_cleanup_section",
    title: "Quiet Mode & Cleanup",
    icon: "🧹",
    paragraphs: [
      "Quiet Mode: Toggle from the top-right corner of Overview (both Basic and Advanced modes). When on, the overview and room grid hide unidentified BLE signals and show only tagged and followed devices. Default is off.",
      "Quiet Mode affects: the Objects card count (shows only tracked objects), the room grid dots (only tracked devices shown), and the Objects button label (changes to 'Tracked objects'). The underlying data is unchanged — toggle off to see everything again.",
      "Clear Unidentified: Removes all untagged, unfollowed BLE objects from PadSpan's history cache. Available in the Overview Objects card (Advanced mode) and the Objects tab.",
      "What's preserved: Any device with a user-assigned label (tagged) or in your followed list is kept. Ghost objects (phone placeholders) are also preserved. Only anonymous hardware addresses are removed.",
      "When to use: After initial setup when you've tagged your important devices and want to clean out the clutter. Cleared devices reappear if still in scanner range — this removes historical entries, not live data.",
    ],
  },
  {
    id: "help_settings",
    title: "Settings",
    icon: "⚙️",
    helpKeys: ["settings", "settings_colors", "settings_presence", "settings_manage"],
  },
  {
    id: "help_zones",
    title: "Zones",
    icon: "📍",
    helpKeys: ["zones"],
  },
  {
    id: "help_insights",
    title: "Insights",
    icon: "📈",
    helpKeys: ["insights"],
  },
  {
    id: "help_monitor",
    title: "Monitor",
    icon: "🖥️",
    helpKeys: ["monitor"],
  },
  {
    id: "help_history",
    title: "History",
    icon: "📜",
    helpKeys: ["history"],
  },
  {
    id: "help_events",
    title: "Events",
    icon: "⚡",
    helpKeys: ["events"],
  },
  {
    id: "help_qa",
    title: "QA",
    icon: "✅",
    helpKeys: ["qa"],
  },
  {
    id: "help_sandbox",
    title: "Sandbox",
    icon: "🧪",
    helpKeys: ["sandbox"],
  },
  {
    id: "bluetooth_section",
    title: "Bluetooth & Scanners",
    icon: "📡",
    paragraphs: [
      "The Bluetooth tab shows all BLE scanners detected by Home Assistant and the advertisements they're receiving.",
      "Scanners tab — lists every radio with its name, area assignment, device count, average RSSI, and quality grade. Use the Area dropdown to assign each scanner to the correct HA room. Click any row for full scanner details including WiFi SSID, IP address, and connection type.",
      "Monitor sub-tab — per-scanner breakdown of device counts, signal quality, and advertisement freshness. Useful for spotting connectivity problems (stale ads) or overloaded scanners.",
      "Visualization sub-tab — SVG diagrams showing scanner coverage and signal strength across your rooms.",
      "Scanner placement matters — scanners in the centre of a room perform better than those in corners. Avoid placing scanners behind large metal objects, inside cabinets, or directly against exterior walls. One scanner per room is the minimum; two per room gives significantly better accuracy for larger rooms.",
    ],
  },
  {
    id: "hardware_section",
    title: "Scanner Hardware",
    icon: "🔧",
    paragraphs: [
      "PadSpan's goal isn't just home/away — it's putting devices in the right room on your floor plan. That's a harder problem, and the hardware you use matters more than you'd think.",
      "I started with about a dozen old ESP32 boards left over from a project three years ago, and ordered 10 more for testing. Most of the old boards made poor BLE scanners — the signal readings were noisy and inconsistent, especially the ones with only a tiny chip antenna on the PCB. A few that had decent antennas worked OK, which is what clued me in: the antenna is the thing that matters.",
      "Three setups worked well. First: an ESP32-S3 with an Ethernet (LAN) port and a full-size external antenna. Being honest, this didn't test noticeably better than WiFi — but the theory is that a wired connection means no WiFi radio competing with BLE scanning, and for a permanent always-on scanner that seems like the right call. Second: an ESP32-S3 with WiFi and a full-size antenna. This is probably the most practical option for most people — great BLE 5.0 support, no need to run Ethernet to every room. Third: an ESP32-C3 with a full-size antenna. Cheaper than the S3, and it still performed well for room-level tracking.",
      "What to avoid: older ESP32 boards (not S3 or C3) with only an onboard chip antenna. They'll work fine for simple home/away detection or as basic Bluetooth proxies, but the RSSI readings are too inconsistent for reliable room assignment.",
      "Whatever board you go with, look for an IPEX or u.FL antenna connector and use the included 2.4 GHz antenna. A C3 with a good antenna will outperform an S3 with a chip antenna every time — the antenna matters more than the chip.",
    ],
  },
  {
    id: "calibration_section",
    title: "Calibration",
    icon: "🎯",
    paragraphs: [
      "Calibration improves room detection accuracy by collecting real signal fingerprints from your home. Instead of relying solely on 'strongest signal wins', PadSpan can match new signals against your calibration data using k-NN (k-Nearest Neighbours).",
      "Setup tab — choose the BLE device you'll carry (usually your phone) and the floor plan to calibrate on.",
      "Pin & Listen tab — tap the map where you're physically standing, then hold still for ~10 seconds. PadSpan records the RSSI from every scanner. Repeat at 15–30 locations spread around your home.",
      "Roam tab — shows a coverage heatmap (10×10 grid). Green = well-covered, red = needs more data. A guided target marker suggests where to collect next.",
      "Model tab — click Compute Model to fit the calibration data. Shows point count, scanner count, and LOO (leave-one-out) cross-validation accuracy. 80%+ is good, 90%+ is excellent. You can export or clear the model here.",
      "Tune tab — 3D isometric view with draggable receiver markers for visual fine-tuning of scanner positions.",
      "Standalone phone panel — a separate HA sidebar panel (PadSpan Calibration) optimised for one-handed phone use. Same calibration system, simpler shell — perfect for walk-around data collection.",
      "Tips: collect points in doorways and room boundaries (that's where room detection is hardest). Collect at least 3 points per room. Hold the phone at a natural height (waist to chest). Recompute the model after adding new points.",
    ],
  },
  {
    id: "ha_entities_section",
    title: "HA Entities & Automations",
    icon: "🤖",
    paragraphs: [
      "PadSpan creates two HA entities for every tagged BLE device:",
      "device_tracker.{label} — location_name = current room while home, not_home when away. Link this to a Person in HA Settings → People to get a combined home/away status. This works for manually tagged devices, Companion App phones, iBeacon trackers, and Private BLE devices alike.",
      "sensor.{label}_area — state = current room name, or not_home when the device has been away for longer than the configured timeout. Use this in automations: trigger when sensor.car_keys_area changes to 'Kitchen'.",
      "Extra attributes on both entities: address (MAC or UUID key), rssi, age_s, kind, and for iBeacon devices: ibeacon_uuid, ibeacon_major, ibeacon_minor, all_addresses. For Private BLE devices: canonical_id.",
      "Companion App phones: when tracked via the one-click button, PadSpan stores the phone's iBeacon key (ibeacon:{uuid}:{major}:{minor}). Both entities are created using the phone's device name as the label.",
      "padspan_ha.dump_devices service — call this from HA Developer Tools → Services to get a full JSON snapshot of all tracked devices and their current state. Useful for debugging and building advanced templates. Returns response data compatible with scripts and automations.",
      "Both entities persist across restarts — not_home is a permanent valid state, not an error. Entities never go 'unavailable' just because a device is away.",
    ],
  },
  {
    id: "manage_section",
    title: "Manage (Settings + Sidebar)",
    icon: "🔧",
    paragraphs: [
      "PadSpan has two 'Manage' areas, each for different tasks:",
      "Settings → Manage tab (Advanced / Development mode) — quick access for everyday cleanup: untag BLE devices and delete HA areas.",
      "Sidebar Manage tab (Advanced / Development mode) — deeper data management: BLE tag operations, HA entity deletion, map and integration controls, orphan room polygon cleanup.",
      "Untag a BLE device — go to Settings → Manage → BLE Tags. Find the device and click Untag (two-click confirm). The device reverts to its hardware address but is still tracked.",
      "Delete an HA Area — go to Settings → Manage → Rooms. Click Delete next to an area. This removes it from Home Assistant entirely and cannot be undone from within PadSpan. Re-add in HA Settings → Areas & Zones if needed.",
      "Orphan Room Polygons — found in Manage sidebar → Data. These are room boundaries in your maps that no longer match a real HA area — usually leftover from sample mode or deleted rooms. Delete individually or all at once.",
      "HA Entities — listed in Manage sidebar → Data. Note: entities created by PadSpan will be recreated on next restart. Entities from other integrations (like Bermuda) are managed by those integrations.",
      "Factory Reset — found in Settings → Manage tab (Advanced mode). Erases all PadSpan persistent data: settings, calibration, objects, maps, model, alerts, movement, traceback, history, and backups. BLE radio data is intentionally left intact so scanners keep working. Requires typing 'FACTORY RESET' to confirm (admin only). Restart HA afterwards. Use when you want a completely clean start or are troubleshooting persistent data issues.",
    ],
  },
  {
    id: "view_modes_section",
    title: "2D Flat Map & View Modes",
    icon: "🗺️",
    paragraphs: [
      "PadSpan offers two map view modes for the Overview and Maps tabs:",
      "3D Isometric View (default) — stacks your floor plans in a tilted 3D perspective. Each floor is rendered as a slab with room polygons, device dots, and scanner icons. Floors are separated vertically and can be individually hidden or focused. Outside maps auto-fit inside the indoor bounding box.",
      "2D Flat Map Mode — replaces the 3D stack with a simple flat overhead view of your floor plan. Supports mouse-wheel zoom and click-drag panning. Enable in Settings → Appearance → 2D Flat Map Mode. Best for single-floor setups or mobile screens where the 3D view is hard to navigate.",
      "Image Rotation — before drawing room boundaries on a new map, check if the image needs rotating. Most architectural floor plans are oriented with north at the top, but PadSpan's 3D isometric view looks best when walls run parallel to screen edges. Go to Maps → Edit → Rotate Image. Preview at 90°, 180°, or 270°, then click Apply. The rotation is baked into the actual image file, and any existing receivers and room boundaries are automatically remapped to match. Always rotate before drawing rooms — it's easier to start with the right orientation than to fix it later.",
      "Duplicate Room Warning — when editing a map and picking rooms from the dropdown, rooms that are already placed on another map show a ⚠ warning with the other map's name. You can still place them (useful for rooms spanning multiple floors), but the warning prevents accidental duplicates.",
    ],
  },
  {
    id: "troubleshooting",
    title: "Troubleshooting",
    icon: "🔍",
    paragraphs: [
      "No live Bluetooth data after install — HA needs a full restart (not just integration reload) after first install via HACS. Go to HA Settings → System → Restart.",
      "Devices not appearing in Objects — the device must be in range of at least one scanner and actively transmitting BLE. Check your scanner's integration (ESPresense / Bermuda) is working first.",
      "Location seems wrong (device in wrong room) — signal strength can be affected by walls, interference, or scanner placement. Adding more scanners improves accuracy. Make sure scanners are assigned to the correct HA area in Bluetooth → Scanners. Use the per-scanner RSSI offset (Bluetooth → Scanners → offset input) to compensate if one scanner reads consistently stronger or weaker.",
      "Device keeps flickering between two rooms — raise the Room Change Delay in Settings → Presence. 20–60 seconds is usually enough to stabilise a device on a room boundary.",
      "device_tracker shows not_home too quickly — raise the Home/Away Timeout in Settings → Presence. If a device is briefly out of range in a thick-walled room, try 10–30 minutes.",
      "device_tracker shows not_home too slowly — lower the timeout. The minimum is 1 minute.",
      "AirTag/iBeacon not appearing or keeps splitting into multiple objects — make sure your BLE scanner integration is forwarding the full manufacturer data for Apple devices. PadSpan looks for Apple company ID 0x004C with iBeacon payload. ESPresense and Bermuda both support this.",
      "iBeacon tag name disappeared after MAC rotation — this should not happen (the UUID key is stable). If it does, check that the UUID in the new advertisement matches the original — some third-party trackers change their UUID.",
      "Phone tracking says 'Waiting for signal' — the Companion App's BLE Transmitter may not be enabled. Open the Companion App → Settings → Manage Sensors → BLE Transmitter and ensure it's toggled on. Walk near a Bluetooth scanner to be detected. Check that the phone's Bluetooth is turned on.",
      "Phone tracked but shows 'BLE off' — the command to enable the transmitter didn't reach the app. Open the Companion App manually and enable BLE Transmitter in Settings → Manage Sensors. The phone must have an active connection to your HA instance for the notification command to work.",
      "iPhone not appearing despite being added as Private BLE — check your IRK format. PadSpan accepts plain hex (32 chars), colon-separated, and base64. If the config flow returns 'form', the IRK format may need adjustment. Check HA logs for details.",
      "iPhone shows as many unknown devices — add the device's IRK via Settings → Private BLE Devices. Without the IRK, each MAC rotation creates a new entry. With the IRK, all rotations merge into one blue-badged object.",
      "UI changes not showing — hard refresh your browser (Ctrl+F5 or Cmd+Shift+R). Check the build stamp in Diagnostics to confirm the installed version.",
      "Email alerts not sending — email is sent via HA's notify service. Confirm a notification integration (Gmail, SMTP, etc.) is configured in HA Settings → Integrations.",
      "Too many unknown devices cluttering the view — use Quiet Mode (toggle in Overview top-right) to hide unidentified devices, or use 'Clear unidentified' to remove them from history. Tagged and followed devices are always kept.",
      "Sample data lingering in Settings → Manage — use Untag in BLE Tags, or use the Orphan Polygons cleaner in Manage sidebar → Data to remove sample-mode leftovers.",
      "3D floor alignment looks wrong — after setting alignment in Maps → 3D Stack, click Save Alignment. The 3D preview will then use the correct reference aspect ratio. Re-open and re-save if alignment was set in an older version.",
    ],
  },
];

// ─── Render ───────────────────────────────────────────────────────────────────

export function render(ctx) {
  const { el } = ctx.helpers;
  const HELP = ctx.helpers.HELP || {};

  if (!ctx.state._training) ctx.state._training = { tab: "walkthroughs", walkId: null, walkStep: 0, manualOpen: {} };
  const ts = ctx.state._training;

  const root = el("section", { id: "training" });
  root.className = ctx.state.view === "training" ? "" : "hidden";

  // ── Page header ────────────────────────────────────────────────────────────
  const header = el("div", { style: "display:flex;align-items:center;gap:12px;margin-bottom:18px;flex-wrap:wrap" });
  header.appendChild(el("div", { style: "font-size:20px;font-weight:700;color:#52b788" }, "Training Hub"));
  header.appendChild(el("div", { class: "muted", style: "font-size:13px" }, "Walkthroughs, animated guides, and the full PadSpan manual."));
  root.appendChild(header);

  // ── Tab bar ────────────────────────────────────────────────────────────────
  const tabBar = el("div", { style: "display:flex;gap:8px;margin-bottom:18px;border-bottom:1px solid #1b3526;padding-bottom:10px;flex-wrap:wrap" });
  for (const [id, label, icon] of [["walkthroughs","Walkthroughs","📡"],["quickstart","Quick Start","🗒️"],["manual","Full Manual","📖"]]) {
    const active = ts.tab === id;
    const btn = el("button", {
      class: "btn" + (active ? "" : " inline"),
      style: active ? "border-color:#52b788;font-weight:600" : "",
      onclick: () => { ts.tab = id; ctx.actions.renderRooms(); },
    }, icon + "  " + label);
    tabBar.appendChild(btn);
  }
  root.appendChild(tabBar);

  // ── Content ────────────────────────────────────────────────────────────────
  if (ts.tab === "walkthroughs") {
    root.appendChild(_renderWalkthroughs(ctx, el, ts));
  } else if (ts.tab === "quickstart") {
    root.appendChild(_renderQuickStart(ctx, el, ts, HELP));
  } else {
    root.appendChild(_renderManual(ctx, el, ts, HELP));
  }

  return root;
}

// ─── Walkthroughs Tab ─────────────────────────────────────────────────────────

function _renderWalkthroughs(ctx, el, ts) {
  const wrap = el("div", {});

  if (!ts.walkId) {
    // ── Walkthrough selector grid ────────────────────────────────────────────
    wrap.appendChild(el("div", { class: "muted", style: "font-size:13px;margin-bottom:14px" },
      "Choose a topic to get started. Each walkthrough is step-by-step with animated diagrams."));
    const grid = el("div", { style: "display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:14px" });
    for (const wt of WALKTHROUGHS) {
      const card = el("div", {
        style: "background:#0a150e;border:1px solid #1b3526;border-radius:10px;padding:16px;cursor:pointer;transition:border-color 0.15s",
        onclick: () => { ts.walkId = wt.id; ts.walkStep = 0; ctx.actions.renderRooms(); },
      });
      card.addEventListener("mouseenter", () => card.style.borderColor = "#52b788");
      card.addEventListener("mouseleave", () => card.style.borderColor = "#1b3526");
      card.appendChild(el("div", { style: "font-size:26px;margin-bottom:8px" }, wt.icon));
      card.appendChild(el("div", { style: "font-size:14px;font-weight:600;color:#cbd5e1;margin-bottom:6px" }, wt.title));
      card.appendChild(el("div", { class: "muted", style: "font-size:12px;line-height:1.5" }, wt.summary));
      card.appendChild(el("div", { style: "margin-top:10px;font-size:11px;color:#52b788" }, `${wt.steps.length} steps →`));
      grid.appendChild(card);
    }
    wrap.appendChild(grid);
    return wrap;
  }

  // ── Step view ──────────────────────────────────────────────────────────────
  const wt = WALKTHROUGHS.find(w => w.id === ts.walkId);
  if (!wt) { ts.walkId = null; ctx.actions.renderRooms(); return wrap; }
  const step = wt.steps[ts.walkStep] || wt.steps[0];
  const stepCount = wt.steps.length;

  // Back button
  const backBtn = el("button", { class: "btn inline", style: "margin-bottom:14px", onclick: () => { ts.walkId = null; ctx.actions.renderRooms(); } },
    "← All Walkthroughs");
  wrap.appendChild(backBtn);

  const card = el("div", { class: "card", style: "max-width:700px" });

  // Header
  const cardHeader = el("div", { style: "display:flex;align-items:center;gap:10px;margin-bottom:14px" });
  cardHeader.appendChild(el("span", { style: "font-size:22px" }, wt.icon));
  const hgroup = el("div", {});
  hgroup.appendChild(el("div", { style: "font-size:15px;font-weight:700;color:#cbd5e1" }, wt.title));
  hgroup.appendChild(el("div", { class: "muted", style: "font-size:12px;margin-top:2px" }, `Step ${ts.walkStep + 1} of ${stepCount}`));
  cardHeader.appendChild(hgroup);
  card.appendChild(cardHeader);

  // Step title
  card.appendChild(el("div", { style: "font-size:14px;font-weight:600;color:#52b788;margin-bottom:10px" }, step.title));

  // SVG diagram
  const svgWrap = el("div", { style: "margin-bottom:14px;border-radius:8px;overflow:hidden" });
  svgWrap.innerHTML = step.svg();
  card.appendChild(svgWrap);

  // Step text
  card.appendChild(el("div", { style: "font-size:13px;line-height:1.75;color:#94a3b8;margin-bottom:16px" }, step.text));

  // Step dots + nav
  const navRow = el("div", { style: "display:flex;align-items:center;gap:10px;flex-wrap:wrap" });

  const prevBtn = el("button", { class: "btn inline" + (ts.walkStep === 0 ? " disabled" : ""), onclick: () => {
    if (ts.walkStep > 0) { ts.walkStep--; ctx.actions.renderRooms(); }
  }}, "← Previous");
  if (ts.walkStep === 0) prevBtn.disabled = true;
  navRow.appendChild(prevBtn);

  // Step dots
  const dots = el("div", { style: "display:flex;gap:6px;align-items:center;flex:1;justify-content:center" });
  for (let i = 0; i < stepCount; i++) {
    const dot = el("button", {
      style: `width:10px;height:10px;border-radius:50%;border:none;cursor:pointer;padding:0;background:${i === ts.walkStep ? "#52b788" : "#1b3526"};transition:background 0.15s`,
      onclick: () => { ts.walkStep = i; ctx.actions.renderRooms(); },
    });
    dots.appendChild(dot);
  }
  navRow.appendChild(dots);

  if (ts.walkStep < stepCount - 1) {
    navRow.appendChild(el("button", { class: "btn", onclick: () => { ts.walkStep++; ctx.actions.renderRooms(); } }, "Next →"));
  } else {
    navRow.appendChild(el("button", { class: "btn", style: "border-color:#52b788", onclick: () => { ts.walkId = null; ts.walkStep = 0; ctx.actions.renderRooms(); } }, "Done ✓"));
  }

  card.appendChild(navRow);
  wrap.appendChild(card);
  return wrap;
}

// ─── Quick Start (simplified manual — default Advanced tabs only) ─────────────

const QUICKSTART_SECTIONS = [
  {
    id: "qs_intro",
    title: "What is PadSpan™ HA?",
    icon: "🏠",
    paragraphs: [
      "PadSpan™ HA is a custom Home Assistant integration that adds whole-home Bluetooth Low Energy (BLE) presence tracking. It turns your existing Bluetooth scanners into a real-time room-level tracking system.",
      "Unlike basic presence detection that only knows home or away, PadSpan tells you which room a person or device is in — updated every 5 seconds, displayed on a live map, all running locally inside Home Assistant.",
    ],
  },
  {
    id: "qs_getting_started",
    title: "Getting Started",
    icon: "🚀",
    paragraphs: [
      "1. Install PadSpan HA via HACS (custom repository) and restart Home Assistant completely.",
      "2. Open PadSpan HA from the sidebar. Use Sample mode first to explore the interface with demo data.",
      "3. Switch to Live mode to see your real Bluetooth scanners and devices.",
      "4. Create rooms in HA Settings → Areas & Zones — PadSpan reads your areas directly.",
      "5. Track phones: if the HA Companion App is installed, detected phones appear in Overview. Click 'Track this phone' for automatic setup.",
      "6. Tag other key devices in the Objects tab with friendly names.",
      "7. For iPhones / Apple Watches: add their IRK in Settings → Private BLE Devices to resolve rotating MAC addresses.",
      "Tip: Use Quiet Mode (Overview top-right) to hide unidentified devices once your setup is complete.",
    ],
  },
  {
    id: "qs_follow",
    title: "Follow",
    icon: "🎯",
    helpKeys: ["follow", "follow_selector", "follow_map", "follow_alerts"],
  },
  {
    id: "qs_overview",
    title: "Overview",
    icon: "📋",
    helpKeys: ["overview", "overview_grid"],
  },
  {
    id: "qs_maps",
    title: "Maps",
    icon: "🗺️",
    helpKeys: ["maps", "maps_library", "maps_upload", "maps_stack"],
  },
  {
    id: "qs_settings",
    title: "Settings",
    icon: "⚙️",
    paragraphs: [
      "Appearance — assign rooms to floors, pick room colours for the Follow map and Overview grid.",
      "Scanner Map — view and manage calibration points per map. Clear calibration for a specific map if you need to start fresh.",
      "Presence — adjust Room Change Delay (how long before PadSpan confirms a room switch) and Home/Away Timeout (how long before a missing device is marked away).",
      "Private BLE Devices — add IRKs for iPhones and Apple Watches so PadSpan resolves their rotating MAC addresses into stable identities.",
      "Quiet Mode — toggle in Overview top-right. Hides unidentified devices to reduce clutter. Only shows tagged and followed objects.",
      "UI Structure — choose which extra tabs appear in Advanced mode. All tabs are always visible in Development mode.",
    ],
  },
  {
    id: "qs_manage",
    title: "Manage",
    icon: "🔧",
    paragraphs: [
      "Data — BLE tag operations (untag devices), HA entity deletion, orphan room polygon cleanup, and map/integration controls.",
      "History — historical data browser with export and cleanup options.",
      "Events — event log viewer for tracking system activity.",
      "Health — system health metrics, scanner status, and BLE diagnostics.",
      "Diagnostics — detailed error logs, performance stats, and build stamp verification.",
      "Debug — low-level state inspection for troubleshooting.",
    ],
  },
  {
    id: "qs_calibration",
    title: "Calibration",
    icon: "📐",
    paragraphs: [
      "Calibration improves room detection accuracy by collecting real signal fingerprints from your home. The default Advanced view exposes two calibration tools:",
      "Tune — a 3D isometric view of your floor plans with draggable scanner markers. Drag each marker to match the scanner's real-world position so PadSpan's distance calculations start from the right place.",
      "Beacon Tune — mark a beacon's physical position on the map, then let PadSpan auto-collect a 60-second RSSI fingerprint from every scanner. Repeat at several locations for best coverage.",
      "Additional calibration tools (Setup, Pin & Listen, Roam, Model) are available in Development mode for advanced fingerprint collection and model analysis.",
    ],
  },
  {
    id: "qs_training",
    title: "Training Hub",
    icon: "🎓",
    paragraphs: [
      "You're here! The Training Hub has animated step-by-step walkthroughs for major features (like BLE signal propagation and room detection). The Full Manual tab contains the complete reference for every PadSpan tab and feature.",
    ],
  },
  {
    id: "qs_modes",
    title: "Basic / Advanced / Development",
    icon: "⚡",
    paragraphs: [
      "PadSpan has three UI modes, cycled by the toggle button in the top-right corner:",
      "Basic — 5 tabs (Follow, Overview, Maps, Settings, Training). Best for everyday use after initial setup. Includes one-click phone tracking and Quiet Mode.",
      "Advanced — 7 tabs by default (adds Manage and Calibration). Adds Clear Unidentified, detailed phone tracking status, and more diagnostic info. You can opt extra tabs into Advanced via Settings → UI Structure.",
      "Development — all 14 tabs visible. Includes Objects, Devices, Bluetooth, Presence, Monitor, QA, and Sandbox for debugging and development.",
    ],
  },
];

function _renderQuickStart(ctx, el, ts, HELP) {
  const wrap = el("div", {});

  wrap.appendChild(el("div", { class: "muted", style: "font-size:12px;margin-bottom:16px;line-height:1.6" },
    "A simplified guide covering the tabs visible in Advanced mode. For the complete reference, switch to the Full Manual tab."));

  for (const section of QUICKSTART_SECTIONS) {
    const isOpen = ts.manualOpen["qs_" + section.id] !== false;
    const sectionEl = el("div", { style: "margin-bottom:10px" });

    const headerBtn = el("button", {
      style: [
        "display:flex;align-items:center;gap:10px;width:100%;background:#0a150e",
        "border:1px solid #1b3526;border-radius:8px;padding:12px 14px;cursor:pointer",
        "text-align:left;transition:border-color 0.15s",
        isOpen ? "border-bottom-left-radius:0;border-bottom-right-radius:0;border-color:#253e2e" : "",
      ].join(";"),
      onclick: () => {
        ts.manualOpen["qs_" + section.id] = !isOpen;
        ctx.actions.renderRooms();
      },
    });
    headerBtn.appendChild(el("span", { style: "font-size:16px" }, section.icon));
    headerBtn.appendChild(el("span", { style: "font-size:13px;font-weight:600;color:#cbd5e1;flex:1" }, section.title));
    headerBtn.appendChild(el("span", { style: "font-size:12px;color:#4a6052" }, isOpen ? "▲" : "▼"));
    sectionEl.appendChild(headerBtn);

    if (isOpen) {
      const body = el("div", { style: "background:#071008;border:1px solid #253e2e;border-top:none;border-radius:0 0 8px 8px;padding:14px 16px" });

      if (section.helpKeys && section.helpKeys.length) {
        for (const key of section.helpKeys) {
          const h = HELP[key];
          if (!h) continue;
          body.appendChild(el("div", { style: "font-size:12px;font-weight:700;color:#52b788;margin-bottom:6px;margin-top:12px" }, h.title));
          const paras = Array.isArray(h.body) ? h.body : [h.body];
          for (const p of paras) {
            body.appendChild(el("div", { style: "font-size:13px;line-height:1.75;color:#94a3b8;margin-bottom:8px" }, p));
          }
        }
      }

      if (section.paragraphs && section.paragraphs.length) {
        for (const p of section.paragraphs) {
          body.appendChild(el("div", { style: "font-size:13px;line-height:1.75;color:#94a3b8;margin-bottom:8px" }, p));
        }
      }

      sectionEl.appendChild(body);
    }

    wrap.appendChild(sectionEl);
  }

  return wrap;
}

// ─── Manual Tab ───────────────────────────────────────────────────────────────

function _renderManual(ctx, el, ts, HELP) {
  const wrap = el("div", {});

  wrap.appendChild(el("div", { class: "muted", style: "font-size:12px;margin-bottom:16px;line-height:1.6" },
    "This manual is generated automatically from PadSpan's help content. When a new feature is added and its help text is updated, it appears here without any manual editing."));

  for (const section of MANUAL_SECTIONS) {
    const isOpen = ts.manualOpen[section.id] !== false; // default open
    const sectionEl = el("div", { style: "margin-bottom:10px" });

    // Section header (accordion toggle)
    const headerBtn = el("button", {
      style: [
        "display:flex;align-items:center;gap:10px;width:100%;background:#0a150e",
        "border:1px solid #1b3526;border-radius:8px;padding:12px 14px;cursor:pointer",
        "text-align:left;transition:border-color 0.15s",
        isOpen ? "border-bottom-left-radius:0;border-bottom-right-radius:0;border-color:#253e2e" : "",
      ].join(";"),
      onclick: () => {
        ts.manualOpen[section.id] = !isOpen;
        ctx.actions.renderRooms();
      },
    });
    headerBtn.appendChild(el("span", { style: "font-size:16px" }, section.icon));
    headerBtn.appendChild(el("span", { style: "font-size:13px;font-weight:600;color:#cbd5e1;flex:1" }, section.title));
    headerBtn.appendChild(el("span", { style: "font-size:12px;color:#4a6052" }, isOpen ? "▲" : "▼"));
    sectionEl.appendChild(headerBtn);

    if (isOpen) {
      const body = el("div", { style: "background:#071008;border:1px solid #253e2e;border-top:none;border-radius:0 0 8px 8px;padding:14px 16px" });

      // Render HELP-sourced subsections
      if (section.helpKeys && section.helpKeys.length) {
        for (const key of section.helpKeys) {
          const h = HELP[key];
          if (!h) continue;
          body.appendChild(el("div", { style: "font-size:12px;font-weight:700;color:#52b788;margin-bottom:6px;margin-top:12px" }, h.title));
          const paras = Array.isArray(h.body) ? h.body : [h.body];
          for (const p of paras) {
            body.appendChild(el("div", { style: "font-size:13px;line-height:1.75;color:#94a3b8;margin-bottom:8px" }, p));
          }
        }
      }

      // Render hardcoded paragraphs
      if (section.paragraphs && section.paragraphs.length) {
        for (const p of section.paragraphs) {
          body.appendChild(el("div", { style: "font-size:13px;line-height:1.75;color:#94a3b8;margin-bottom:8px" }, p));
        }
      }

      sectionEl.appendChild(body);
    }

    wrap.appendChild(sectionEl);
  }

  // Footer note
  const footer = el("div", { style: "margin-top:20px;padding:12px;background:#050e08;border:1px solid #1b3526;border-radius:8px" });
  footer.appendChild(el("div", { style: "font-size:11px;color:#4a6052;line-height:1.6" },
    "Manual version: auto-generated from help_content.js. Content marked with a feature section heading reflects the current help text for that tab. To contribute corrections or additions, update help_content.js in the PadSpan HA source."));
  wrap.appendChild(footer);

  return wrap;
}
