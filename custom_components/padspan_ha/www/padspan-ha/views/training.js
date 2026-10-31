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
<text x="157" y="38" text-anchor="middle" fill="#b0bec5" font-size="9" font-family="system-ui">Data</text>
<rect x="192" y="24" width="58" height="20" rx="4" fill="#071008" stroke="#1b3526" stroke-width="1"/>
<text x="221" y="38" text-anchor="middle" fill="#4a6052" font-size="9" font-family="system-ui">Entities</text>
<rect x="256" y="24" width="48" height="20" rx="4" fill="#071008" stroke="#1b3526" stroke-width="1"/>
<text x="280" y="38" text-anchor="middle" fill="#4a6052" font-size="9" font-family="system-ui">Events</text>
<rect x="128" y="52" width="256" height="26" rx="4" fill="#071008" stroke="#1b3526" stroke-width="0.5"/>
<circle cx="146" cy="65" r="5" fill="#14b8a6" opacity="0.6"/>
<text x="160" y="69" fill="#94a3b8" font-size="9" font-family="system-ui">Alice's AirTag</text>
<rect x="336" y="58" width="40" height="14" rx="3" fill="#1b3526" stroke="#52b788" stroke-width="1"/>
<text x="356" y="69" text-anchor="middle" fill="#52b788" font-size="8" font-family="system-ui">Untag</text>
<rect x="128" y="82" width="256" height="26" rx="4" fill="#071008" stroke="#1b3526" stroke-width="0.5"/>
<circle cx="146" cy="95" r="5" fill="#14b8a6" opacity="0.6"/>
<text x="160" y="99" fill="#94a3b8" font-size="9" font-family="system-ui">Car Keys</text>
<rect x="336" y="88" width="40" height="14" rx="3" fill="#1b3526" stroke="#52b788" stroke-width="1"/>
<text x="356" y="99" text-anchor="middle" fill="#52b788" font-size="8" font-family="system-ui">Untag</text>
<text x="255" y="168" text-anchor="middle" fill="#4a6052" font-size="9" font-family="system-ui">Main menu in Advanced mode</text>
<text x="255" y="184" text-anchor="middle" fill="#253e2e" font-size="9" font-family="system-ui">In Basic: under More tools</text>
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
<text x="28" y="29" fill="#52b788" font-size="10" font-weight="600" font-family="system-ui">BLE Device Labels</text>
<text x="200" y="29" fill="#52b788" font-size="10" font-weight="600" font-family="system-ui">Last seen</text>
<text x="336" y="29" fill="#52b788" font-size="10" font-weight="600" font-family="system-ui">Action</text>
<g class="fadeRow">
  <rect x="8" y="40" width="384" height="30" rx="4" fill="#071008" stroke="#dc2626" stroke-width="1"/>
  <text x="28" y="59" fill="#94a3b8" font-size="10" font-family="system-ui">Sample AirTag</text>
  <text x="200" y="59" fill="#4a6052" font-size="9" font-family="system-ui">Sample data</text>
  <g class="confirm">
    <rect x="292" y="47" width="52" height="17" rx="4" fill="#7f1d1d" stroke="#dc2626" stroke-width="1"/>
    <text x="318" y="59" text-anchor="middle" fill="#fca5a5" font-size="8" font-family="system-ui">Yes</text>
    <rect x="350" y="47" width="36" height="17" rx="4" fill="#071008" stroke="#1b3526" stroke-width="1"/>
    <text x="368" y="59" text-anchor="middle" fill="#4a6052" font-size="8" font-family="system-ui">No</text>
  </g>
</g>
<rect x="8" y="74" width="384" height="30" rx="4" fill="#071008" stroke="#1b3526" stroke-width="0.5"/>
<text x="28" y="93" fill="#cbd5e1" font-size="10" font-family="system-ui">Alice's AirTag</text>
<text x="200" y="93" fill="#4a6052" font-size="9" font-family="system-ui">2 min ago</text>
<rect x="342" y="81" width="44" height="16" rx="4" fill="#1b3526" stroke="#52b788" stroke-width="1"/>
<text x="364" y="93" text-anchor="middle" fill="#52b788" font-size="8" font-family="system-ui">Untag</text>
<rect x="8" y="108" width="384" height="30" rx="4" fill="#071008" stroke="#1b3526" stroke-width="0.5"/>
<text x="28" y="127" fill="#cbd5e1" font-size="10" font-family="system-ui">Car Keys</text>
<text x="200" y="127" fill="#4a6052" font-size="9" font-family="system-ui">18 min ago</text>
<rect x="342" y="115" width="44" height="16" rx="4" fill="#1b3526" stroke="#52b788" stroke-width="1"/>
<text x="364" y="127" text-anchor="middle" fill="#52b788" font-size="8" font-family="system-ui">Untag</text>
<text x="200" y="180" text-anchor="middle" fill="#4a6052" font-size="9" font-family="system-ui">Untag, then Yes: two clicks prevent accidents.</text>
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
<text x="200" y="14" text-anchor="middle" fill="#52b788" font-size="11" font-weight="600" font-family="system-ui">Devices → By Room — Away badge when not heard</text>
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
<text x="200" y="190" text-anchor="middle" fill="#4a6052" font-size="9" font-family="system-ui">Timeout configurable in Settings → Tracking</text>
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
<text x="60" y="52" fill="#e2e8f0" font-size="12" font-weight="600" font-family="system-ui">Alice's Android</text>
<text x="60" y="68" fill="#64748b" font-size="9" font-family="system-ui">BLE active · visible to scanners</text>
<rect class="pBtn" x="260" y="42" width="80" height="28" rx="6" fill="none" stroke="#2563eb" stroke-width="1.5"/>
<text x="300" y="60" text-anchor="middle" fill="#60a5fa" font-size="11" font-weight="600" font-family="system-ui">Track</text>
<path class="chk" d="M 180 140 l 10 10 l 20 -20" fill="none" stroke="#4ade80" stroke-width="3" stroke-linecap="round"/>
<text class="chk" x="200" y="175" text-anchor="middle" fill="#4ade80" font-size="11" font-weight="600" font-family="system-ui">Tracked! Labels, follows, and enables BLE</text>
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
<text x="200" y="208" text-anchor="middle" fill="#4a6052" font-size="9" font-family="system-ui">Available in Overview and Devices → By Room</text>
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
<text x="300" y="100" text-anchor="middle" fill="#4ade80" font-size="9" font-family="system-ui">1 stable identity</text>
<text x="300" y="130" text-anchor="middle" fill="#64748b" font-size="9" font-family="system-ui">Blue badge in all views</text>
<text x="200" y="175" text-anchor="middle" fill="#94a3b8" font-size="10" font-family="system-ui">Settings → Tracking → Phone Tracking (Private BLE)</text>
<text x="200" y="195" text-anchor="middle" fill="#4a6052" font-size="9" font-family="system-ui">Works with iPhones, Apple Watches, and Android phones</text>
</svg>`;
}

function _svgPresenceSettings() {
  return `<svg viewBox="0 0 400 220" xmlns="http://www.w3.org/2000/svg" width="100%" style="max-height:200px;background:#071008;border-radius:8px;display:block">
<style>
@keyframes saveGlow{0%,100%{stroke:#2d5a3d}50%{stroke:#52b788}}
.saveBtn{animation:saveGlow 2s ease-in-out infinite}
</style>
<text x="200" y="14" text-anchor="middle" fill="#52b788" font-size="11" font-weight="600" font-family="system-ui">Settings → Tracking tab</text>
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
<text x="200" y="16" text-anchor="middle" fill="#52b788" font-size="11" font-weight="600" font-family="system-ui">Step 1: Choose a device and a floor</text>
<rect x="20" y="28" width="360" height="80" rx="8" fill="#0d2318" stroke="#52b788" stroke-width="1.5"/>
<text x="36" y="50" fill="#94a3b8" font-size="10" font-family="system-ui">Beacon Device</text>
<rect x="36" y="56" width="160" height="22" rx="5" fill="#071008" stroke="#1b3526" stroke-width="1"/>
<text x="48" y="72" fill="#cbd5e1" font-size="10" font-family="system-ui">Alice's Phone ▾</text>
<g class="phone"><circle cx="330" cy="68" r="14" fill="#14b8a6" opacity="0.2" stroke="#14b8a6" stroke-width="1.5"/><circle cx="330" cy="68" r="6" fill="#14b8a6"/></g>
<text x="36" y="96" fill="#94a3b8" font-size="10" font-family="system-ui">Floor</text>
<rect x="136" y="86" width="160" height="22" rx="5" fill="#071008" stroke="#1b3526" stroke-width="1"/>
<text x="148" y="102" fill="#cbd5e1" font-size="10" font-family="system-ui">Ground Floor ▾</text>
<text x="200" y="140" text-anchor="middle" fill="#4a6052" font-size="10" font-family="system-ui">Calibration → Beacon and floor</text>
<text x="200" y="156" text-anchor="middle" fill="#4a6052" font-size="9" font-family="system-ui">Pick the phone or tag you'll carry and the floor to calibrate</text>
<text x="200" y="180" text-anchor="middle" fill="#52b788" font-size="10" font-weight="600" font-family="system-ui">Tip: 60 s at each spot is recommended</text>
<text x="200" y="196" text-anchor="middle" fill="#4a6052" font-size="9" font-family="system-ui">The floor plan needs a scale before points can be saved</text>
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
<text x="272" y="99" fill="#4a6052" font-size="9" font-family="system-ui">2. Start Collecting</text>
<text x="272" y="119" fill="#4a6052" font-size="9" font-family="system-ui">3. Stand still, then</text>
<text x="272" y="132" fill="#4a6052" font-size="9" font-family="system-ui">   Save Point (or</text>
<text x="272" y="145" fill="#4a6052" font-size="9" font-family="system-ui">   Discard)</text>
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
<text x="36" y="64" fill="#4a6052" font-size="9" font-family="system-ui">Works out how accurately your points place people</text>
<rect x="36" y="70" width="160" height="8" rx="4" fill="#1b3526"/>
<rect class="bar" x="36" y="70" width="160" height="8" rx="4" fill="#52b788" style="width:140px"/>
<g class="check"><text x="340" y="62" text-anchor="middle" fill="#52b788" font-size="20" font-family="system-ui">✓</text></g>
<rect x="20" y="100" width="170" height="108" rx="8" fill="#0a150e" stroke="#1b3526" stroke-width="1.5"/>
<text x="36" y="120" fill="#94a3b8" font-size="10" font-weight="600" font-family="system-ui">Model Stats</text>
<text x="36" y="140" fill="#4a6052" font-size="9" font-family="system-ui">Calibration Points: 24</text>
<text x="36" y="156" fill="#4a6052" font-size="9" font-family="system-ui">Scanners Seen: 3</text>
<text x="36" y="172" fill="#4a6052" font-size="9" font-family="system-ui">Est. Accuracy: ~1.4m</text>
<text x="36" y="192" fill="#52b788" font-size="9" font-weight="600" font-family="system-ui">Under 2 m shows green</text>
<rect x="210" y="100" width="170" height="108" rx="8" fill="#0a150e" stroke="#1b3526" stroke-width="1.5"/>
<text x="226" y="120" fill="#94a3b8" font-size="10" font-weight="600" font-family="system-ui">What happens</text>
<text x="226" y="140" fill="#4a6052" font-size="9" font-family="system-ui">PadSpan compares live</text>
<text x="226" y="154" fill="#4a6052" font-size="9" font-family="system-ui">signals with your</text>
<text x="226" y="168" fill="#4a6052" font-size="9" font-family="system-ui">calibration points</text>
<text x="226" y="188" fill="#4a6052" font-size="9" font-family="system-ui">Results: the stricter test</text>
<text x="226" y="202" fill="#4a6052" font-size="9" font-family="system-ui">on spots it hasn't seen</text>
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

// ─── Floor Alignment SVG helpers ─────────────────────────────────────────────

function _svgAlignWhy() {
  return `<svg viewBox="0 0 400 240" xmlns="http://www.w3.org/2000/svg" width="100%" style="max-height:220px;background:#071008;border-radius:8px;display:block">
<text x="200" y="18" text-anchor="middle" fill="#fbbf24" font-size="11" font-weight="700" font-family="system-ui">Why your floors need lining up</text>
<rect x="20" y="30" width="170" height="130" rx="8" fill="#0a150e" stroke="#fbbf2444" stroke-width="1.5" stroke-dasharray="6,3"/>
<text x="105" y="50" text-anchor="middle" fill="#fbbf24" font-size="10" font-weight="600" font-family="system-ui">Ground Floor (Reference)</text>
<rect x="35" y="58" width="65" height="40" rx="4" fill="#52b78815" stroke="#52b788" stroke-width="0.8"/>
<text x="67" y="82" text-anchor="middle" fill="#52b788" font-size="8" font-family="system-ui">Kitchen</text>
<rect x="110" y="58" width="65" height="40" rx="4" fill="#52b78815" stroke="#52b788" stroke-width="0.8"/>
<text x="142" y="82" text-anchor="middle" fill="#52b788" font-size="8" font-family="system-ui">Living</text>
<rect x="35" y="105" width="140" height="40" rx="4" fill="#52b78815" stroke="#52b788" stroke-width="0.8"/>
<text x="105" y="129" text-anchor="middle" fill="#52b788" font-size="8" font-family="system-ui">Hallway</text>
<text x="105" y="155" text-anchor="middle" fill="#fbbf24" font-size="9" font-family="system-ui">stays put</text>
<rect x="210" y="30" width="170" height="130" rx="8" fill="#0a150e" stroke="#1b3526" stroke-width="1"/>
<text x="295" y="50" text-anchor="middle" fill="#94a3b8" font-size="10" font-weight="600" font-family="system-ui">First Floor (Target)</text>
<rect x="225" y="58" width="65" height="40" rx="4" fill="#52b78815" stroke="#52b788" stroke-width="0.8"/>
<text x="257" y="82" text-anchor="middle" fill="#52b788" font-size="8" font-family="system-ui">Bedroom</text>
<rect x="300" y="58" width="65" height="40" rx="4" fill="#52b78815" stroke="#52b788" stroke-width="0.8"/>
<text x="332" y="82" text-anchor="middle" fill="#52b788" font-size="8" font-family="system-ui">Bath</text>
<text x="295" y="155" text-anchor="middle" fill="#94a3b8" font-size="9" font-family="system-ui">you move it</text>
<line x1="190" y1="95" x2="210" y2="95" stroke="#78909c" stroke-width="1" stroke-dasharray="3,2"/>
<text x="200" y="90" text-anchor="middle" fill="#78909c" font-size="8" font-family="system-ui">aligns to</text>
<rect x="20" y="170" width="360" height="58" rx="6" fill="#0a150e" stroke="#1b3526" stroke-width="1"/>
<text x="200" y="190" text-anchor="middle" fill="#94a3b8" font-size="9" font-family="system-ui">Each floor plan has its own place in metres. Line the floors</text>
<text x="200" y="204" text-anchor="middle" fill="#94a3b8" font-size="9" font-family="system-ui">up against each other so stairwells and walls stack —</text>
<text x="200" y="218" text-anchor="middle" fill="#52b788" font-size="9" font-weight="600" font-family="system-ui">aligning a map moves that map and nothing else.</text>
</svg>`;
}

function _svgAlignReference() {
  return `<svg viewBox="0 0 400 240" xmlns="http://www.w3.org/2000/svg" width="100%" style="max-height:220px;background:#071008;border-radius:8px;display:block">
<text x="200" y="18" text-anchor="middle" fill="#fbbf24" font-size="11" font-weight="700" font-family="system-ui">Choosing the Reference map</text>
<rect x="20" y="30" width="175" height="100" rx="8" fill="#0a150e" stroke="#52b788" stroke-width="1.5"/>
<text x="107" y="50" text-anchor="middle" fill="#52b788" font-size="10" font-weight="600" font-family="system-ui">Good reference</text>
<text x="107" y="68" text-anchor="middle" fill="#52b788" font-size="9" font-family="system-ui">✓ Measured (scale saved)</text>
<text x="107" y="82" text-anchor="middle" fill="#52b788" font-size="9" font-family="system-ui">✓ Largest footprint</text>
<text x="107" y="96" text-anchor="middle" fill="#52b788" font-size="9" font-family="system-ui">✓ Clear room boundaries</text>
<text x="107" y="110" text-anchor="middle" fill="#52b788" font-size="9" font-family="system-ui">✓ Accurate proportions</text>
<text x="107" y="124" text-anchor="middle" fill="#52b788" font-size="9" font-family="system-ui">✓ Easy to read when overlaid</text>
<rect x="205" y="30" width="175" height="100" rx="8" fill="#0a150e" stroke="#ef4444" stroke-width="1"/>
<text x="292" y="50" text-anchor="middle" fill="#ef4444" font-size="10" font-weight="600" font-family="system-ui">Poor reference</text>
<text x="292" y="68" text-anchor="middle" fill="#ef4444" font-size="9" font-family="system-ui">✗ Not placed (no scale yet)</text>
<text x="292" y="82" text-anchor="middle" fill="#ef4444" font-size="9" font-family="system-ui">✗ Small partial floor plan</text>
<text x="292" y="96" text-anchor="middle" fill="#ef4444" font-size="9" font-family="system-ui">✗ Few rooms</text>
<text x="292" y="110" text-anchor="middle" fill="#ef4444" font-size="9" font-family="system-ui">✗ Stretched or skewed photo</text>
<text x="292" y="124" text-anchor="middle" fill="#ef4444" font-size="9" font-family="system-ui">✗ Hard to see under overlays</text>
<rect x="20" y="140" width="360" height="86" rx="6" fill="#0a150e" stroke="#1b3526" stroke-width="1"/>
<text x="200" y="160" text-anchor="middle" fill="#fbbf24" font-size="10" font-weight="600" font-family="system-ui">Pick your most accurate plan — usually the ground floor</text>
<text x="200" y="178" text-anchor="middle" fill="#94a3b8" font-size="9" font-family="system-ui">Measure it first: Edit → Measure → Save Scale. A map with</text>
<text x="200" y="192" text-anchor="middle" fill="#94a3b8" font-size="9" font-family="system-ui">no scale is "not placed", and nothing can be aligned onto it.</text>
<text x="200" y="206" text-anchor="middle" fill="#94a3b8" font-size="9" font-family="system-ui">The Target is drawn see-through on top of the Reference,</text>
<text x="200" y="220" text-anchor="middle" fill="#52b788" font-size="9" font-weight="600" font-family="system-ui">so the Reference must still be easy to read underneath.</text>
</svg>`;
}

function _svgAlignDrag() {
  return `<svg viewBox="0 0 400 240" xmlns="http://www.w3.org/2000/svg" width="100%" style="max-height:220px;background:#071008;border-radius:8px;display:block">
<text x="200" y="18" text-anchor="middle" fill="#fbbf24" font-size="11" font-weight="700" font-family="system-ui">Alignment Overlay in Mapping → 3D Stack</text>
<rect x="30" y="32" width="340" height="36" rx="6" fill="#0a150e" stroke="#1b3526" stroke-width="1"/>
<text x="46" y="55" fill="#94a3b8" font-size="10" font-family="system-ui">Reference (fixed)</text>
<rect x="200" y="40" width="158" height="20" rx="4" fill="#0a150e" stroke="#fbbf24" stroke-width="0.8"/>
<text x="279" y="54" text-anchor="middle" fill="#fbbf24" font-size="9" font-weight="600" font-family="system-ui">Ground Floor ▾</text>
<rect x="30" y="74" width="340" height="36" rx="6" fill="#0a150e" stroke="#1b3526" stroke-width="1"/>
<text x="46" y="97" fill="#94a3b8" font-size="10" font-family="system-ui">Target (draggable)</text>
<rect x="200" y="82" width="158" height="20" rx="4" fill="#0a150e" stroke="#c084fc" stroke-width="0.8"/>
<text x="279" y="96" text-anchor="middle" fill="#c084fc" font-size="9" font-weight="600" font-family="system-ui">First Floor ▾</text>
<rect x="30" y="116" width="340" height="36" rx="6" fill="#0a150e" stroke="#1b3526" stroke-width="1"/>
<rect x="40" y="124" width="58" height="20" rx="4" fill="#0a2a1a" stroke="#52b788" stroke-width="0.8"/>
<text x="69" y="138" text-anchor="middle" fill="#52b788" font-size="9" font-weight="600" font-family="system-ui">Scale +</text>
<rect x="104" y="124" width="58" height="20" rx="4" fill="#0a2a1a" stroke="#52b788" stroke-width="0.8"/>
<text x="133" y="138" text-anchor="middle" fill="#52b788" font-size="9" font-weight="600" font-family="system-ui">Scale −</text>
<rect x="168" y="124" width="58" height="20" rx="4" fill="#0a2a1a" stroke="#52b788" stroke-width="0.8"/>
<text x="197" y="138" text-anchor="middle" fill="#52b788" font-size="9" font-weight="600" font-family="system-ui">−15°</text>
<rect x="232" y="124" width="58" height="20" rx="4" fill="#0a2a1a" stroke="#52b788" stroke-width="0.8"/>
<text x="261" y="138" text-anchor="middle" fill="#52b788" font-size="9" font-weight="600" font-family="system-ui">+15°</text>
<rect x="296" y="124" width="58" height="20" rx="4" fill="#0a2a1a" stroke="#52b788" stroke-width="0.8"/>
<text x="325" y="138" text-anchor="middle" fill="#52b788" font-size="9" font-weight="600" font-family="system-ui">Reset</text>
<rect x="30" y="162" width="340" height="66" rx="6" fill="#0a150e" stroke="#1b3526" stroke-width="1"/>
<text x="200" y="182" text-anchor="middle" fill="#94a3b8" font-size="9" font-family="system-ui">Pick the Reference and the Target. A Target that has never</text>
<text x="200" y="196" text-anchor="middle" fill="#94a3b8" font-size="9" font-family="system-ui">been placed says Not placed — press Reset to start it on top.</text>
<text x="200" y="210" text-anchor="middle" fill="#94a3b8" font-size="9" font-family="system-ui">Drag it until stairwells and outside walls line up; use Scale</text>
<text x="200" y="224" text-anchor="middle" fill="#52b788" font-size="9" font-weight="600" font-family="system-ui">and Rotate if it's the wrong size or turned the wrong way.</text>
</svg>`;
}

function _svgAlignSave() {
  return `<svg viewBox="0 0 400 240" xmlns="http://www.w3.org/2000/svg" width="100%" style="max-height:220px;background:#071008;border-radius:8px;display:block">
<style>@keyframes ap{0%{opacity:0.3}50%{opacity:1}100%{opacity:0.3}}</style>
<text x="200" y="18" text-anchor="middle" fill="#fbbf24" font-size="11" font-weight="700" font-family="system-ui">Save Alignment — or use Point Align</text>
<rect x="20" y="30" width="360" height="120" rx="8" fill="#0a150e" stroke="#1b3526" stroke-width="1"/>
<rect x="40" y="50" width="140" height="80" rx="6" fill="#fbbf2408" stroke="#fbbf2444" stroke-width="1.5" stroke-dasharray="5,3"/>
<text x="110" y="68" text-anchor="middle" fill="#fbbf24" font-size="9" font-weight="600" font-family="system-ui">Ground Floor (reference)</text>
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
<text x="200" y="178" text-anchor="middle" fill="#94a3b8" font-size="9" font-family="system-ui">Click Save Alignment — nothing is saved while you drag.</text>
<text x="200" y="192" text-anchor="middle" fill="#94a3b8" font-size="9" font-family="system-ui">Or click Point Align: click the same real-world point on both</text>
<text x="200" y="206" text-anchor="middle" fill="#94a3b8" font-size="9" font-family="system-ui">maps (3+ pairs), Compute, Apply, then Save Alignment.</text>
<text x="200" y="220" text-anchor="middle" fill="#52b788" font-size="9" font-weight="600" font-family="system-ui">Only the Target moves — every other map keeps its place.</text>
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
<text x="200" y="140" text-anchor="middle" fill="#94a3b8" font-size="9" font-family="system-ui">Found in Manage → Factory Reset (Live mode).</text>
<text x="200" y="156" text-anchor="middle" fill="#94a3b8" font-size="9" font-family="system-ui">Requires typing "FACTORY RESET" to confirm. Admin only.</text>
<text x="200" y="172" text-anchor="middle" fill="#94a3b8" font-size="9" font-family="system-ui">Use when starting over or troubleshooting persistent issues.</text>
<text x="200" y="188" text-anchor="middle" fill="#52b788" font-size="9" font-weight="600" font-family="system-ui">Then press Reload Page. No HA restart needed.</text>
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

function _svgAtlasOverview() {
  return `<svg viewBox="0 0 400 220" xmlns="http://www.w3.org/2000/svg" width="100%" style="max-height:200px;background:#071008;border-radius:8px;display:block">
<style>
@keyframes markerPop{0%{transform:scale(0);opacity:0}100%{transform:scale(1);opacity:1}}
.m1{animation:markerPop 0.4s ease-out 0.2s both}
.m2{animation:markerPop 0.4s ease-out 0.6s both}
.m3{animation:markerPop 0.4s ease-out 1.0s both}
</style>
<text x="200" y="16" text-anchor="middle" fill="#52b788" font-size="11" font-weight="600" font-family="system-ui">Atlas — every device on the real floor plan</text>
<g transform="skewX(-15) translate(80,50)">
<rect width="200" height="130" rx="4" fill="#52b78812" stroke="#52b788" stroke-width="1"/>
<line x1="0" y1="65" x2="200" y2="65" stroke="#1b3526" stroke-width="1"/>
<line x1="100" y1="0" x2="100" y2="130" stroke="#1b3526" stroke-width="1"/>
<text x="50" y="35" text-anchor="middle" fill="#4a6052" font-size="9" font-family="system-ui">Bedroom</text>
<text x="150" y="35" text-anchor="middle" fill="#4a6052" font-size="9" font-family="system-ui">Bath</text>
<text x="100" y="100" text-anchor="middle" fill="#4a6052" font-size="9" font-family="system-ui">Hallway</text>
<g class="m1" transform="translate(55,25)"><circle r="7" fill="#fbbf2440" stroke="#fbbf24" stroke-width="1.5"/><circle r="2.5" fill="#fbbf24"/></g>
<g class="m2" transform="translate(150,95)"><rect x="-7" y="-7" width="14" height="14" rx="3" fill="#60a5fa40" stroke="#60a5fa" stroke-width="1.5"/></g>
<g class="m3" transform="translate(120,20)"><circle r="7" fill="#f8717140" stroke="#f87171" stroke-width="1.5"/><path d="M-2.5,-1 L2.5,-1 M0,-1 L0,3" stroke="#f87171" stroke-width="1.2"/></g>
</g>
<text x="200" y="200" text-anchor="middle" fill="#94a3b8" font-size="9" font-family="system-ui">Lights, sensors, locks and doors — one map, real positions</text>
</svg>`;
}

function _svgAtlasEditions() {
  return `<svg viewBox="0 0 400 220" xmlns="http://www.w3.org/2000/svg" width="100%" style="max-height:200px;background:#071008;border-radius:8px;display:block">
<text x="200" y="16" text-anchor="middle" fill="#52b788" font-size="11" font-weight="600" font-family="system-ui">One key unlocks the same Atlas on either download</text>
<rect x="20" y="28" width="165" height="160" rx="8" fill="#0a150e" stroke="#1b3526" stroke-width="1.5"/>
<text x="102" y="48" text-anchor="middle" fill="#94a3b8" font-size="10" font-weight="600" font-family="system-ui">Free</text>
<circle cx="60" cy="75" r="6" fill="#52b78840" stroke="#52b788" stroke-width="1.5"/>
<text x="76" y="79" fill="#94a3b8" font-size="9" font-family="system-ui">One marker per light</text>
<text x="102" y="130" text-anchor="middle" fill="#64748b" font-size="9" font-family="system-ui">Floors, rooms,</text>
<text x="102" y="144" text-anchor="middle" fill="#64748b" font-size="9" font-family="system-ui">tap-to-toggle.</text>
<text x="102" y="168" text-anchor="middle" fill="#4a6052" font-size="8" font-family="system-ui">No key required</text>
<rect x="215" y="28" width="165" height="160" rx="8" fill="#0a150e" stroke="#52b788" stroke-width="2"/>
<text x="297" y="48" text-anchor="middle" fill="#52b788" font-size="10" font-weight="600" font-family="system-ui">Pro / Bright Pro</text>
<text x="297" y="70" text-anchor="middle" fill="#52b788" font-size="9" font-family="system-ui">Real placement</text>
<text x="297" y="86" text-anchor="middle" fill="#52b788" font-size="9" font-family="system-ui">Sensors, locks, doors</text>
<text x="297" y="102" text-anchor="middle" fill="#52b788" font-size="9" font-family="system-ui">Automorph + Showcase</text>
<rect x="255" y="112" width="84" height="22" rx="11" fill="#1b3526" stroke="#52b788" stroke-width="1"/>
<text x="297" y="127" text-anchor="middle" fill="#a7f3d0" font-size="9" font-family="system-ui">pro / bright key</text>
<text x="297" y="168" text-anchor="middle" fill="#4a6052" font-size="8" font-family="system-ui">90-day free trial, no card</text>
</svg>`;
}

function _svgAtlasNav() {
  return `<svg viewBox="0 0 400 220" xmlns="http://www.w3.org/2000/svg" width="100%" style="max-height:200px;background:#071008;border-radius:8px;display:block">
<style>
@keyframes navGlow{0%,100%{opacity:0.6}50%{opacity:1}}
.navSel{animation:navGlow 2s ease-in-out infinite}
</style>
<text x="200" y="16" text-anchor="middle" fill="#52b788" font-size="11" font-weight="600" font-family="system-ui">Two ways to open Atlas</text>
<rect x="16" y="28" width="130" height="176" rx="6" fill="#0a150e" stroke="#1b3526" stroke-width="1"/>
<text x="30" y="46" fill="#4a6052" font-size="9" font-weight="600" font-family="system-ui">MAPPING</text>
<text x="30" y="66" fill="#64748b" font-size="9" font-family="system-ui">Rooms</text>
<text x="30" y="84" fill="#64748b" font-size="9" font-family="system-ui">Scanners</text>
<rect class="navSel" x="24" y="94" width="112" height="20" rx="4" fill="#1b3526" stroke="#52b788" stroke-width="1"/>
<text x="30" y="108" fill="#a7f3d0" font-size="9" font-weight="600" font-family="system-ui">Atlas</text>
<text x="30" y="128" fill="#64748b" font-size="9" font-family="system-ui">Barriers</text>
<rect x="170" y="28" width="212" height="176" rx="6" fill="#050e08" stroke="#1b3526" stroke-width="1"/>
<text x="184" y="46" fill="#4a6052" font-size="9" font-weight="600" font-family="system-ui">SIDEBAR</text>
<text x="184" y="68" fill="#64748b" font-size="9" font-family="system-ui">Overview · Objects · Maps</text>
<rect x="178" y="80" width="196" height="22" rx="4" fill="#1b3526" stroke="#52b788" stroke-width="1"/>
<text x="188" y="95" fill="#a7f3d0" font-size="9" font-weight="600" font-family="system-ui">🗺️ Atlas (standalone panel)</text>
<text x="184" y="126" fill="#64748b" font-size="9" font-family="system-ui">Settings → turn on the Atlas</text>
<text x="184" y="140" fill="#64748b" font-size="9" font-family="system-ui">sidebar panel for a lighter view</text>
<text x="184" y="154" fill="#64748b" font-size="9" font-family="system-ui">without the rest of Mapping.</text>
</svg>`;
}

function _svgAtlasPlace() {
  return `<svg viewBox="0 0 400 220" xmlns="http://www.w3.org/2000/svg" width="100%" style="max-height:200px;background:#071008;border-radius:8px;display:block">
<style>
@keyframes dragPin{0%{transform:translate(40px,40px)}100%{transform:translate(190px,110px)}}
.pin{animation:dragPin 2.4s ease-in-out infinite}
@keyframes pinPulse{0%,100%{r:9;opacity:0.9}50%{r:13;opacity:0.4}}
.pinRing{animation:pinPulse 2.4s ease-in-out infinite}
</style>
<text x="200" y="16" text-anchor="middle" fill="#52b788" font-size="11" font-weight="600" font-family="system-ui">Drag the pin, or queue it and tap the map</text>
<rect x="16" y="28" width="240" height="176" rx="6" fill="#0a1a0f" stroke="#1b3526" stroke-width="1"/>
<rect x="30" y="42" width="100" height="70" rx="3" fill="#1b3526" opacity="0.2" stroke="#253e2e"/>
<text x="80" y="80" text-anchor="middle" fill="#4a6052" font-size="9" font-family="system-ui">Living Room</text>
<g class="pin">
  <circle class="pinRing" cx="0" cy="0" r="9" fill="none" stroke="#fbbf24" stroke-width="1.5"/>
  <circle cx="0" cy="0" r="5" fill="#0d2318" stroke="#fbbf24" stroke-width="2"/>
</g>
<rect x="270" y="28" width="112" height="176" rx="6" fill="#050e08" stroke="#1b3526" stroke-width="1"/>
<text x="282" y="48" fill="#52b788" font-size="10" font-weight="600" font-family="system-ui">Hallway Light</text>
<rect x="282" y="60" width="90" height="20" rx="10" fill="#1b3526" stroke="#52b788" stroke-width="1"/>
<text x="327" y="74" text-anchor="middle" fill="#a7f3d0" font-size="9" font-family="system-ui">+ Place</text>
<text x="282" y="100" fill="#4a6052" font-size="8" font-family="system-ui">or, once queued:</text>
<rect x="282" y="108" width="90" height="20" rx="10" fill="#0d2318" stroke="#4a6052" stroke-width="1"/>
<text x="327" y="122" text-anchor="middle" fill="#94a3b8" font-size="9" font-family="system-ui">◎ Queued</text>
<text x="282" y="150" fill="#64748b" font-size="8" font-family="system-ui">Tap the map where</text>
<text x="282" y="162" fill="#64748b" font-size="8" font-family="system-ui">it really sits.</text>
</svg>`;
}

function _svgAtlasShape() {
  return `<svg viewBox="0 0 400 220" xmlns="http://www.w3.org/2000/svg" width="100%" style="max-height:200px;background:#071008;border-radius:8px;display:block">
<text x="200" y="16" text-anchor="middle" fill="#52b788" font-size="11" font-weight="600" font-family="system-ui">Real shape, size and rotation — not a generic dot</text>
<rect x="16" y="28" width="368" height="46" rx="6" fill="#0a150e" stroke="#1b3526" stroke-width="1"/>
<g transform="translate(48,51)"><rect x="-10" y="-14" width="20" height="24" rx="3" fill="#1b3526" stroke="#94a3b8" stroke-width="1"/><text y="30" text-anchor="middle" fill="#4a6052" font-size="7" font-family="system-ui">Pendant</text></g>
<g transform="translate(120,51)"><ellipse rx="12" ry="7" fill="#1b3526" stroke="#94a3b8" stroke-width="1"/><text y="30" text-anchor="middle" fill="#4a6052" font-size="7" font-family="system-ui">Sconce</text></g>
<g transform="translate(192,51)"><rect x="-16" y="-4" width="32" height="8" rx="4" fill="#52b78840" stroke="#52b788" stroke-width="1.5"/><text y="30" text-anchor="middle" fill="#52b788" font-size="7" font-family="system-ui">Strip ✓</text></g>
<g transform="translate(264,51)"><polygon points="0,-12 10,8 -10,8" fill="#1b3526" stroke="#94a3b8" stroke-width="1"/><text y="30" text-anchor="middle" fill="#4a6052" font-size="7" font-family="system-ui">Chandelier</text></g>
<g transform="translate(336,51) rotate(30)"><rect x="-14" y="-3" width="28" height="6" rx="3" fill="#1b3526" stroke="#94a3b8" stroke-width="1"/></g>
<text x="336" y="75" text-anchor="middle" fill="#4a6052" font-size="7" font-family="system-ui">30°</text>
<rect x="16" y="90" width="368" height="98" rx="6" fill="#050e08" stroke="#1b3526" stroke-width="1"/>
<text x="30" y="110" fill="#4a6052" font-size="9" font-family="system-ui">Width</text>
<rect x="30" y="116" width="70" height="20" rx="4" fill="#071008" stroke="#1b3526"/><text x="65" y="130" text-anchor="middle" fill="#cbd5e1" font-size="9" font-family="system-ui">80 cm</text>
<text x="120" y="110" fill="#4a6052" font-size="9" font-family="system-ui">Length</text>
<rect x="120" y="116" width="70" height="20" rx="4" fill="#071008" stroke="#1b3526"/><text x="155" y="130" text-anchor="middle" fill="#cbd5e1" font-size="9" font-family="system-ui">12 cm</text>
<text x="210" y="110" fill="#4a6052" font-size="9" font-family="system-ui">Rotation</text>
<rect x="210" y="116" width="70" height="20" rx="4" fill="#071008" stroke="#1b3526"/><text x="245" y="130" text-anchor="middle" fill="#cbd5e1" font-size="9" font-family="system-ui">30°</text>
<text x="30" y="164" fill="#64748b" font-size="8" font-family="system-ui">Centimetres, not a generic dot — the same real size the</text>
<text x="30" y="178" fill="#64748b" font-size="8" font-family="system-ui">fixture actually is, at the angle it's actually mounted.</text>
</svg>`;
}

function _svgAtlasSensors() {
  return `<svg viewBox="0 0 400 220" xmlns="http://www.w3.org/2000/svg" width="100%" style="max-height:200px;background:#071008;border-radius:8px;display:block">
<style>
@keyframes motionFlash{0%{opacity:1}20%{opacity:1}100%{opacity:0.15}}
.mFlash{animation:motionFlash 3s ease-out infinite}
</style>
<text x="200" y="16" text-anchor="middle" fill="#52b788" font-size="11" font-weight="600" font-family="system-ui">Live readings tint the marker itself</text>
<rect x="16" y="30" width="115" height="160" rx="6" fill="#0a150e" stroke="#f87171" stroke-width="1.5"/>
<text x="73" y="50" text-anchor="middle" fill="#f87171" font-size="10" font-weight="600" font-family="system-ui">Temperature</text>
<circle cx="73" cy="80" r="14" fill="#f8717130" stroke="#f87171" stroke-width="2"/>
<text x="73" y="84" text-anchor="middle" fill="#f87171" font-size="10" font-weight="700" font-family="system-ui">22°</text>
<text x="73" y="112" text-anchor="middle" fill="#4a6052" font-size="7" font-family="system-ui">blue &lt;20°</text>
<text x="73" y="124" text-anchor="middle" fill="#4a6052" font-size="7" font-family="system-ui">red ≥20°</text>
<text x="73" y="136" text-anchor="middle" fill="#4a6052" font-size="7" font-family="system-ui">orange &gt;34°</text>
<rect x="143" y="30" width="115" height="160" rx="6" fill="#0a150e" stroke="#60a5fa" stroke-width="1.5"/>
<text x="200" y="50" text-anchor="middle" fill="#60a5fa" font-size="10" font-weight="600" font-family="system-ui">Humidity</text>
<circle cx="200" cy="80" r="14" fill="#60a5fa30" stroke="#60a5fa" stroke-width="2"/>
<text x="200" y="84" text-anchor="middle" fill="#60a5fa" font-size="10" font-weight="700" font-family="system-ui">47%</text>
<text x="200" y="118" text-anchor="middle" fill="#4a6052" font-size="7" font-family="system-ui">digits when placed</text>
<text x="200" y="130" text-anchor="middle" fill="#4a6052" font-size="7" font-family="system-ui">and reported this hour</text>
<rect x="270" y="30" width="115" height="160" rx="6" fill="#0a150e" stroke="#fbbf24" stroke-width="1.5"/>
<text x="327" y="50" text-anchor="middle" fill="#fbbf24" font-size="10" font-weight="600" font-family="system-ui">Motion</text>
<circle class="mFlash" cx="327" cy="80" r="14" fill="#fbbf2430" stroke="#fbbf24" stroke-width="2"/>
<text x="327" y="118" text-anchor="middle" fill="#4a6052" font-size="7" font-family="system-ui">short flash, then a</text>
<text x="327" y="130" text-anchor="middle" fill="#4a6052" font-size="7" font-family="system-ui">graded fade — the same</text>
<text x="327" y="142" text-anchor="middle" fill="#4a6052" font-size="7" font-family="system-ui">on a 5s PIR or a 20min</text>
<text x="327" y="154" text-anchor="middle" fill="#4a6052" font-size="7" font-family="system-ui">radar hold</text>
</svg>`;
}

function _svgAtlasOutdoor() {
  return `<svg viewBox="0 0 400 220" xmlns="http://www.w3.org/2000/svg" width="100%" style="max-height:200px;background:#071008;border-radius:8px;display:block">
<text x="200" y="16" text-anchor="middle" fill="#52b788" font-size="11" font-weight="600" font-family="system-ui">Outdoor gear places beside the room, not off the map</text>
<g transform="skewX(-15) translate(90,50)">
<rect width="200" height="120" rx="4" fill="#52b78812" stroke="#52b788" stroke-width="1"/>
<text x="100" y="65" text-anchor="middle" fill="#4a6052" font-size="9" font-family="system-ui">Kitchen</text>
</g>
<g transform="translate(300,150)">
<rect x="-24" y="-14" width="48" height="28" rx="4" fill="#0a1a0f" stroke="#1b3526" stroke-width="1"/>
<text y="4" text-anchor="middle" fill="#4a6052" font-size="7" font-family="system-ui">Outside</text>
</g>
<line x1="255" y1="135" x2="292" y2="145" stroke="#43a047" stroke-width="1" stroke-dasharray="3,2"/>
<circle cx="292" cy="148" r="6" fill="#43a04740" stroke="#43a047" stroke-width="1.5"/>
<text x="292" y="180" text-anchor="middle" fill="#43a047" font-size="8" font-family="system-ui">Driveway camera</text>
<text x="200" y="200" text-anchor="middle" fill="#64748b" font-size="8" font-family="system-ui">Drop the pin on any real floor plate, right beside the room it sits outside of</text>
</svg>`;
}

function _svgAtlasHoverHud() {
  return `<svg viewBox="0 0 400 220" xmlns="http://www.w3.org/2000/svg" width="100%" style="max-height:200px;background:#071008;border-radius:8px;display:block">
<style>
@keyframes hudPulse{0%,100%{opacity:0.85}50%{opacity:1}}
.hud{animation:hudPulse 2s ease-in-out infinite}
</style>
<text x="200" y="16" text-anchor="middle" fill="#52b788" font-size="11" font-weight="600" font-family="system-ui">Three markers, one spot — the hover HUD sorts it out</text>
<g transform="translate(120,120)">
<circle r="10" fill="#fbbf2440" stroke="#fbbf24" stroke-width="1.5"/>
<circle cx="6" cy="-6" r="10" fill="#60a5fa40" stroke="#60a5fa" stroke-width="1.5"/>
<circle cx="-6" cy="6" r="10" fill="#f8717140" stroke="#f87171" stroke-width="1.5"/>
</g>
<rect class="hud" x="20" y="26" width="200" height="80" rx="6" fill="#050e08" stroke="#52b788" stroke-width="1.5"/>
<text x="32" y="44" fill="#52b788" font-size="9" font-weight="600" font-family="system-ui">Under cursor:</text>
<text x="32" y="60" fill="#fbbf24" font-size="9" font-family="system-ui">● Hallway Light</text>
<text x="32" y="75" fill="#60a5fa" font-size="9" font-family="system-ui">■ Temp Sensor</text>
<text x="32" y="90" fill="#f87171" font-size="9" font-family="system-ui">● Front Lock</text>
<text x="200" y="150" text-anchor="middle" fill="#94a3b8" font-size="9" font-family="system-ui">Alt+click cycles the stack directly</text>
<text x="200" y="170" text-anchor="middle" fill="#4a6052" font-size="8" font-family="system-ui">A held tap shows a gold ring filling in before it selects</text>
</svg>`;
}

function _svgAtlasDoor() {
  return `<svg viewBox="0 0 400 220" xmlns="http://www.w3.org/2000/svg" width="100%" style="max-height:200px;background:#071008;border-radius:8px;display:block">
<style>
@keyframes doorSwing{0%,100%{opacity:1}50%{opacity:0.3}}
.doorState{animation:doorSwing 2.5s ease-in-out infinite}
</style>
<text x="200" y="16" text-anchor="middle" fill="#52b788" font-size="11" font-weight="600" font-family="system-ui">A door in a signal wall</text>
<rect x="16" y="30" width="220" height="160" rx="6" fill="#0a1a0f" stroke="#1b3526" stroke-width="1"/>
<line x1="30" y1="110" x2="110" y2="110" stroke="#94a3b8" stroke-width="4"/>
<line x1="140" y1="110" x2="222" y2="110" stroke="#94a3b8" stroke-width="4"/>
<rect class="doorState" x="112" y="88" width="26" height="44" rx="2" fill="#52b78830" stroke="#52b788" stroke-width="1.5"/>
<text x="125" y="150" text-anchor="middle" fill="#4a6052" font-size="8" font-family="system-ui">marked on the wall list,</text>
<text x="125" y="163" text-anchor="middle" fill="#4a6052" font-size="8" font-family="system-ui">or drawn from the Atlas map</text>
<rect x="252" y="30" width="132" height="160" rx="6" fill="#050e08" stroke="#1b3526" stroke-width="1"/>
<text x="264" y="50" fill="#4a6052" font-size="9" font-family="system-ui">Material</text>
<rect x="264" y="56" width="108" height="20" rx="4" fill="#071008" stroke="#1b3526"/>
<text x="270" y="70" fill="#cbd5e1" font-size="9" font-family="system-ui">Steel ▾</text>
<text x="264" y="96" fill="#4a6052" font-size="8" font-family="system-ui">Blocks harder than</text>
<text x="264" y="108" fill="#4a6052" font-size="8" font-family="system-ui">hollow-core</text>
<rect x="264" y="122" width="60" height="16" rx="8" fill="#0d2318" stroke="#52b788" stroke-width="1"/>
<text x="294" y="134" text-anchor="middle" fill="#a7f3d0" font-size="8" font-family="system-ui">Closed</text>
</svg>`;
}

function _svgAtlasInvert() {
  return `<svg viewBox="0 0 400 220" xmlns="http://www.w3.org/2000/svg" width="100%" style="max-height:200px;background:#071008;border-radius:8px;display:block">
<text x="200" y="16" text-anchor="middle" fill="#52b788" font-size="11" font-weight="600" font-family="system-ui">A backwards sensor? Flip it, don't fight it</text>
<rect x="20" y="34" width="360" height="34" rx="4" fill="#0a150e" stroke="#1b3526" stroke-width="1"/>
<text x="34" y="55" fill="#cbd5e1" font-size="10" font-family="system-ui">Upper Garage Car Door</text>
<rect x="250" y="42" width="52" height="18" rx="9" fill="#1b3526" stroke="#52b788" stroke-width="1"/>
<text x="276" y="55" text-anchor="middle" fill="#a7f3d0" font-size="8" font-family="system-ui">Invert</text>
<rect x="310" y="42" width="52" height="18" rx="9" fill="#0d0d0d" stroke="#4a6052" stroke-width="1"/>
<text x="336" y="55" text-anchor="middle" fill="#94a3b8" font-size="8" font-family="system-ui">Delete</text>
<rect x="60" y="90" width="130" height="80" rx="6" fill="#150505" stroke="#7f1d1d" stroke-width="1"/>
<text x="125" y="112" text-anchor="middle" fill="#f87171" font-size="9" font-weight="600" font-family="system-ui">Without Invert</text>
<text x="125" y="134" text-anchor="middle" fill="#94a3b8" font-size="8" font-family="system-ui">state:on read as</text>
<text x="125" y="148" text-anchor="middle" fill="#f87171" font-size="9" font-family="system-ui">Open (wrong)</text>
<rect x="210" y="90" width="130" height="80" rx="6" fill="#0a1a0f" stroke="#52b788" stroke-width="1.5"/>
<text x="275" y="112" text-anchor="middle" fill="#52b788" font-size="9" font-weight="600" font-family="system-ui">With Invert</text>
<text x="275" y="134" text-anchor="middle" fill="#94a3b8" font-size="8" font-family="system-ui">state:on read as</text>
<text x="275" y="148" text-anchor="middle" fill="#52b788" font-size="9" font-family="system-ui">Closed (correct)</text>
<text x="200" y="196" text-anchor="middle" fill="#4a6052" font-size="8" font-family="system-ui">Fixes the reading — no change to the sensor itself</text>
</svg>`;
}

function _svgAtlasLock() {
  return `<svg viewBox="0 0 400 220" xmlns="http://www.w3.org/2000/svg" width="100%" style="max-height:200px;background:#071008;border-radius:8px;display:block">
<style>
@keyframes lockToggle{0%,45%{transform:translateY(0)}50%,95%{transform:translateY(-4px)}100%{transform:translateY(0)}}
.shackle{animation:lockToggle 3s ease-in-out infinite}
</style>
<text x="200" y="16" text-anchor="middle" fill="#52b788" font-size="11" font-weight="600" font-family="system-ui">Locks placed and tapped like anything else on Atlas</text>
<g transform="translate(160,100)">
<rect x="-22" y="-4" width="44" height="34" rx="4" fill="#1b3526" stroke="#52b788" stroke-width="1.5"/>
<path class="shackle" d="M-12,-4 v-10 a12,12 0 0 1 24,0 v10" fill="none" stroke="#52b788" stroke-width="3"/>
<circle cx="0" cy="14" r="3" fill="#071008"/>
</g>
<rect x="230" y="72" width="140" height="56" rx="6" fill="#0a150e" stroke="#1b3526" stroke-width="1"/>
<text x="244" y="92" fill="#52b788" font-size="9" font-weight="600" font-family="system-ui">Front Door Lock</text>
<text x="244" y="110" fill="#94a3b8" font-size="9" font-family="system-ui">Tap to lock / unlock</text>
<text x="244" y="122" fill="#4a6052" font-size="7" font-family="system-ui">state shown live on the map</text>
</svg>`;
}

function _svgAutomorph() {
  return `<svg viewBox="0 0 400 220" xmlns="http://www.w3.org/2000/svg" width="100%" style="max-height:200px;background:#071008;border-radius:8px;display:block">
<style>
@keyframes auraGrow{0%{r:8;opacity:0.7}100%{r:70;opacity:0.05}}
.aura1{animation:auraGrow 2.4s ease-out infinite}
.aura2{animation:auraGrow 2.4s ease-out 0.8s infinite}
</style>
<text x="200" y="16" text-anchor="middle" fill="#52b788" font-size="11" font-weight="600" font-family="system-ui">Automorph grows a soft aura into the room</text>
<rect x="60" y="40" width="280" height="140" rx="6" fill="#0a1a0f" stroke="#1b3526" stroke-width="1"/>
<circle class="aura1" cx="200" cy="110" r="8" fill="#52b788"/>
<circle class="aura2" cx="200" cy="110" r="8" fill="#52b788"/>
<circle cx="200" cy="110" r="6" fill="#0d2318" stroke="#52b788" stroke-width="2"/>
<text x="200" y="200" text-anchor="middle" fill="#4a6052" font-size="8" font-family="system-ui">A rendering layer over the fixture's real position — placement never moves</text>
</svg>`;
}

function _svgAutomorphStyles() {
  return `<svg viewBox="0 0 400 220" xmlns="http://www.w3.org/2000/svg" width="100%" style="max-height:200px;background:#071008;border-radius:8px;display:block">
<text x="200" y="16" text-anchor="middle" fill="#52b788" font-size="11" font-weight="600" font-family="system-ui">A growing, curated set of styles</text>
<g transform="translate(60,70)"><circle r="18" fill="#52b78830" stroke="#52b788" stroke-width="1.5"/><text y="34" text-anchor="middle" fill="#4a6052" font-size="8" font-family="system-ui">Glow</text></g>
<g transform="translate(140,70)"><rect x="-16" y="-16" width="32" height="32" fill="none" stroke="#60a5fa" stroke-width="1" stroke-dasharray="2,2"/><text y="34" text-anchor="middle" fill="#4a6052" font-size="8" font-family="system-ui">Blueprint</text></g>
<g transform="translate(220,70)"><circle r="16" fill="#a78bfa20" stroke="#a78bfa" stroke-width="1.5"/><circle r="8" fill="#a78bfa30" stroke="#a78bfa" stroke-width="1"/><text y="34" text-anchor="middle" fill="#4a6052" font-size="8" font-family="system-ui">Nebula</text></g>
<g transform="translate(300,70)"><circle r="17" fill="none" stroke="#fbbf24" stroke-width="2"/><text y="34" text-anchor="middle" fill="#4a6052" font-size="8" font-family="system-ui">Halo</text></g>
<g transform="translate(360,70)"><path d="M0,-16 4,-4 16,0 4,4 0,16 -4,4 -16,0 -4,-4 Z" fill="#f8717130" stroke="#f87171" stroke-width="1"/><text y="34" text-anchor="middle" fill="#4a6052" font-size="8" font-family="system-ui">Bloom</text></g>
<text x="200" y="140" text-anchor="middle" fill="#94a3b8" font-size="9" font-family="system-ui">Pruned whenever two styles read the same at real marker size</text>
<text x="200" y="160" text-anchor="middle" fill="#4a6052" font-size="8" font-family="system-ui">— the current list lives in the Automorph picker itself</text>
</svg>`;
}

function _svgShowcase() {
  return `<svg viewBox="0 0 400 220" xmlns="http://www.w3.org/2000/svg" width="100%" style="max-height:200px;background:#071008;border-radius:8px;display:block">
<text x="200" y="16" text-anchor="middle" fill="#52b788" font-size="11" font-weight="600" font-family="system-ui">19 curated themes for the whole map</text>
<rect x="30" y="34" width="80" height="60" rx="4" fill="#0d0d0d" stroke="#94a3b8" stroke-width="1"/><text x="70" y="106" text-anchor="middle" fill="#4a6052" font-size="7" font-family="system-ui">Neo HUD</text>
<rect x="130" y="34" width="80" height="60" rx="4" fill="#f8fafc" stroke="#b8860b" stroke-width="1"/><text x="170" y="106" text-anchor="middle" fill="#4a6052" font-size="7" font-family="system-ui">Real-Estate</text>
<rect x="230" y="34" width="80" height="60" rx="4" fill="#0a2a1a" stroke="#22d3ee" stroke-width="1"/><text x="270" y="106" text-anchor="middle" fill="#4a6052" font-size="7" font-family="system-ui">Bioluminescent</text>
<rect x="330" y="34" width="45" height="60" rx="4" fill="#2a0a2a" stroke="#e879f9" stroke-width="1"/>
<rect x="30" y="120" width="345" height="52" rx="6" fill="#0a150e" stroke="#52b788" stroke-width="1.5"/>
<text x="46" y="140" fill="#52b788" font-size="9" font-weight="600" font-family="system-ui">Presentation → Showcase</text>
<text x="46" y="158" fill="#94a3b8" font-size="8" font-family="system-ui">Colour, room edges, glow and light-pools all change together</text>
</svg>`;
}

function _svgPresets() {
  return `<svg viewBox="0 0 400 220" xmlns="http://www.w3.org/2000/svg" width="100%" style="max-height:200px;background:#071008;border-radius:8px;display:block">
<text x="200" y="16" text-anchor="middle" fill="#52b788" font-size="11" font-weight="600" font-family="system-ui">Save a whole look, load it back later</text>
<rect x="20" y="34" width="180" height="24" rx="4" fill="#0a150e" stroke="#1b3526" stroke-width="1"/>
<text x="30" y="50" fill="#cbd5e1" font-size="9" font-family="system-ui">▾ Select a look</text>
<rect x="210" y="34" width="170" height="24" rx="4" fill="#0a150e" stroke="#1b3526" stroke-width="1"/>
<text x="220" y="50" fill="#cbd5e1" font-size="9" font-family="system-ui">"Evening, downstairs"</text>
<rect x="20" y="76" width="360" height="106" rx="6" fill="#050e08" stroke="#1b3526" stroke-width="1"/>
<text x="34" y="96" fill="#4a6052" font-size="9" font-family="system-ui">Evening, downstairs</text>
<rect x="300" y="86" width="64" height="18" rx="9" fill="#1b3526" stroke="#52b788" stroke-width="1"/><text x="332" y="98" text-anchor="middle" fill="#a7f3d0" font-size="8" font-family="system-ui">Apply</text>
<text x="34" y="122" fill="#4a6052" font-size="9" font-family="system-ui">Bright morning, whole house</text>
<rect x="300" y="112" width="64" height="18" rx="9" fill="#1b3526" stroke="#52b788" stroke-width="1"/><text x="332" y="124" text-anchor="middle" fill="#a7f3d0" font-size="8" font-family="system-ui">Apply</text>
<text x="34" y="160" fill="#64748b" font-size="8" font-family="system-ui">Theme + Automorph style, and optionally floor/spacing/</text>
<text x="34" y="172" fill="#64748b" font-size="8" font-family="system-ui">layout — an older preset never moves your camera</text>
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
      { title: "Receivers Hear Devices",                  text: "PadSpan listens through the Bluetooth receivers Home Assistant already has: ESPHome Bluetooth proxies (small ESP32 boards, ideally one per room), Shelly devices with Bluetooth, or the Home Assistant machine's own Bluetooth. Each receiver keeps hearing the short signals that phones, tags, key fobs and watches send out. The Receivers page lists them all.", svg: _svgBleSignals },
      { title: "Signal Strength Points to the Room",      text: "Each receiver reports how strongly it hears a device, in dBm: −55 is stronger than −80. The receiver that hears a device best is usually the nearest one, so its Home Assistant area becomes the device's room. With a floor plan, three or more receivers placed on it and some calibration, PadSpan can also place devices between receivers.", svg: _svgRssiComparison },
      { title: "Rooms Update Live",                       text: "Rooms are your Home Assistant areas. PadSpan works out every device's room again every 5 seconds (Settings → Tracking → Performance → Presence Poll Interval, 1–60 s), and the panel updates itself. A new install starts on the sample house, so you can see a finished setup before yours is done.", svg: _svgRoomAssignment },
      { title: "iBeacon Devices Survive MAC Rotation",    text: "The HA Companion App's iBeacon transmitter and other iBeacon devices may rotate their Bluetooth MAC address for privacy, but keep broadcasting the same iBeacon identity (UUID/Major/Minor). All rotating MACs sharing it are merged into one stable amber-badged object. Tag it once — the name sticks forever. (AirTags and other Apple Find My tags are not iBeacons: they have no lasting identity — see MAC Rotation Bridging in Settings → Features.)", svg: _svgIbeacon },
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
      { title: "Three Boards That Worked",                    text: "Out of everything I tested, three setups stood out. First: an ESP32-S3 with a LAN (Ethernet) port and an external antenna — I'll be honest, this one didn't actually test better than the WiFi version, but the theory is sound (no WiFi radio competing with BLE) and it's the one I'd pick for a permanent install. Second: an ESP32-S3 with WiFi and a full-size antenna — this is probably the most practical choice for most people. Third: an ESP32-C3 with a full-size antenna — cheaper, and it still did the job well. What to avoid: older ESP32 boards (not S3 or C3) with only a tiny chip antenna on the board. They're fine for home/away or as a basic Bluetooth proxy, but too noisy to tell rooms apart. Whatever you buy, look for an IPEX (u.FL) antenna connector and use a 2.4 GHz antenna with it.", svg: _svgBoardRanking },
      { title: "Why Room Tracking Is Harder Than Home/Away",   text: "Getting a device's room right on a map is genuinely challenging. Home/away just needs to see any signal from any scanner — easy. Room-level tracking needs to reliably tell which scanner is closest, and sometimes the difference is only 7 dBm. A noisy chip antenna can flip that decision randomly. The whole point of PadSpan is placing devices in the correct room on a floor plan, and that only works when the signal readings are consistent enough to trust.", svg: _svgAntennaDetail },
    ],
  },
  {
    id: "tag_device",
    title: "Tag Your First Device",
    icon: "🏷️",
    summary: "Name an unnamed Bluetooth device so it shows up with a friendly name across all of PadSpan.",
    steps: [
      { title: "Open Devices → By Room",                 text: "Open Devices (under More tools at the bottom of the menu) and pick the By Room tab. It lists every Bluetooth device your receivers hear, including unnamed ones that show only an address like AA:BB:CC:11:22:33. (On Follow, Name this tag does the same for the tag you are following.)", svg: _svgObjectsList },
      { title: "Find an Unnamed Device",                 text: "In Basic mode, unnamed devices are in the Unidentified card. In Advanced mode, set the status filter to Unidentified or click the unidentified count; the search box finds one by address. Their badge ends in a question mark (BLE?).", svg: _svgObjectsList },
      { title: "Press Tag and Enter a Name",             text: "Press Tag next to the device. In the box that opens, type a name like 'Alice's AirTag' or 'Car Keys' and press Save label (or Enter). The name is kept in Home Assistant.", svg: _svgTagModal },
      { title: "Your Named Device Appears Everywhere",   text: "The name appears on Follow, the Overview, Devices and every other page, and Home Assistant gets a tracker and a room sensor for it (see HA Entities & Automations in the Full Manual). Relabel changes the name; Untag removes it.", svg: _svgTaggedDevice },
    ],
  },
  {
    id: "floor_plan",
    title: "Set Up a Floor Plan",
    icon: "🗺️",
    summary: "Upload a floor plan, set its scale, draw the rooms and place your receivers on it.",
    steps: [
      { title: "Upload Your Floor Plan",                 text: "The easy way is guided: click Setup at the top of Mapping, or Start Setup Wizard in an empty Library, and it takes you through every step below (in Basic mode, Open on a plan starts it too). By hand: go to Mapping → Upload (an administrator's tab), pick the Floor (from HA) the plan belongs to, choose the picture (PNG, JPG, even a photo of a paper plan), crop it if you like and click Upload & Convert.", svg: _svgUpload },
      { title: "Rotate the Image if Needed",             text: "If the plan sits at an angle, straighten it before you draw: walls that run along the screen's edges line up best between floors in 3D. In Edit, click Rotate Image, use -90°, -15°, -5°, +5°, +15° or +90° (0° starts again) and click Apply Rotation. Anything already drawn turns with it; if the scale can't be kept, PadSpan asks you to measure again. Once a plan is tied to another in 3D Stack, Rotate Image is hidden.", svg: _svgRotateImage },
      { title: "Set the Scale",                          text: "In Edit, click 📏 Measure. Click two points you know the real distance between (a wall, a doorway), type it in metres and click Add 1st Measurement. Do the same with two points at a different angle and click Add 2nd Measurement, then Save Scale. The second angle shows whether the picture is stretched. Walls, heights and lining up floors all need the scale.", svg: _svgAlignReference },
      { title: "Draw Room Boundaries",                   text: "Click Rooms and pick the room in Choose room… (these are your Home Assistant areas). Click its corners on the plan, then double-click or click Finish once you have 3 points or more; Undo point takes back a click. A room marked ⚠ is already drawn on another plan, so drawing it here makes a second copy. When the rooms are done, click Save Layout: until then they're only a draft.", svg: _svgDrawRooms },
      { title: "Place Your Receivers",                   text: "Click Radios. In Live BLE Radios, click Add next to a receiver: it appears in the middle of the map, already in its Home Assistant room. Drag it to where it's really mounted. Double-clicking the map adds a blank \"Receiver N\" instead, one that isn't tied to any real receiver.", svg: _svgPlaceScanners },
      { title: "Check Each Receiver's Room and Height",  text: "Click a placed receiver to check its Room and set its Height above floor (Save height keeps that straight away). Then click Save Layout to keep the receivers. The Receivers page lists every receiver with its room; its Place and Move buttons bring you back here.", svg: _svgPlaceScanners },
    ],
  },
  {
    id: "floor_alignment",
    title: "Lining Up Your Floors",
    icon: "📐",
    summary: "Align your floor plans in Mapping → 3D Stack so each floor sits exactly over the one below it.",
    steps: [
      { title: "Why Your Floors Need Lining Up",
        text: "When your home has several floor plans (ground floor, first floor, basement), PadSpan stacks them in 3D. Each plan carries its own placement in real metres: where it sits, how big it is and which way it faces. Until you line the floors up against each other, the stairwell upstairs won't sit over the stairwell below. There's no master map: aligning one plan moves that plan and nothing else. Set each floor's height first, in Floor Heights at the top of 3D Stack.",
        svg: _svgAlignWhy },
      { title: "Measure Your Reference First",
        text: "You always align a Target plan onto a Reference plan, and the Reference must be measured: without a scale it has no size in metres to line anything up against. In Edit, click 📏 Measure, take your two measurements and click Save Scale. The Library shows \"not placed\" for a plan that hasn't been measured yet. Pick your most accurate plan as the Reference, usually the ground floor. It also needs to be easy to read with another floor on top: the Target is drawn see-through over it, and a plan with thin, faint lines disappears underneath.",
        svg: _svgAlignReference },
      { title: "Drag the Target Into Place",
        text: "Open Mapping → 3D Stack and scroll to Alignment Overlay. Choose the Reference (fixed) and the Target (draggable); ⚠ marks a plan that isn't placed yet. If the Target has never been placed, the readout says Not placed: press Reset to start it on top of the Reference. Then drag the Target until shared features line up: stairwells, outside walls, chimneys. Scale + and Scale − resize it, with Lock AR turned off, X − and X + stretch it left-right only, and −15°, ﹢15° and 0° turn it. Zoom and Opacity change only your view.",
        svg: _svgAlignDrag },
      { title: "Save It — or Use Point Align",
        text: "Nothing is saved while you drag. Click Save Alignment to keep the Target's new position. If that position would put more than half of the plan's calibration points off the map, PadSpan refuses, changes nothing and tells you why. For a close fit, click Point Align instead: click the same real point on both plans (it switches between them for you) until you have 3 pairs or more, click Compute, check the preview and click Apply. Apply moves the Target on screen; click Save Alignment to keep it. Repeat for each floor, then check the 3D preview further down the tab, or Compare Maps in the Library.",
        svg: _svgAlignSave },
    ],
  },
  {
    id: "dashboard",
    title: "Reading the Dashboard",
    icon: "📊",
    summary: "Understand the Overview: its counts, the 3D map, the overhead map, and Follow.",
    steps: [
      { title: "Overview — Summary Counts",              text: "Basic mode shows counts of rooms, objects, scanners and calibration points above the map. Advanced mode shows People in building at the top and, under the map, cards for Rooms, Objects, Bluetooth radios and Calibration; their buttons (View rooms list, All objects, View radios list) open full lists. Click a row for its details.", svg: _svgKpiCards },
      { title: "The Map — What's Where",                 text: "Once rooms are drawn, the map is a 3D stack of your floors. Green rings are receivers (a red blinking inner ring means that receiver uses active scanning). Devices you follow are amber markers with a percentage; turn Pins on to show your other named devices too. Before any rooms are drawn, Who's where now lists each room and who is in it instead.", svg: _svgRoomGrid },
      { title: "2D Overhead Map",                        text: "Prefer a flat view? Press ▣ Overhead on the 3D map, or turn on Settings → Appearance → 2D Map Mode. The overhead map (marked experimental) zooms with the mouse wheel and pans by dragging; ◈ 3D view goes back.", svg: _svg2dMode },
      { title: "Follow — Track a Specific Tag",          text: "Open Follow and pick a device in the search box. You'll see its room, its floor and when it was last heard, and a room map with a pulsing dot. Advanced mode adds which receivers hear it and a movement log.", svg: _svgFollowTab },
    ],
  },
  {
    id: "home_away",
    title: "Home/Away Detection",
    icon: "🏠",
    summary: "How PadSpan marks devices as away (not_home), the Away badge, and changing the timeout.",
    steps: [
      { title: "Devices Are Kept While Away",            text: "PadSpan keeps every named device on its list after it leaves range, and counts the time since a receiver last heard it. Nothing is lost while it is gone; it picks up where it left off when it comes back.", svg: _svgHaEntities },
      { title: "The Away Badge",                         text: "Once a device hasn't been heard for longer than the away timeout (5 minutes unless changed), Devices → By Room shows a red Away badge with the last room PadSpan was sure of, and when — for example 📍 Kitchen · 2h 5m ago. The normal display returns the moment it is heard again.", svg: _svgAwayBadge },
      { title: "Home Assistant Switches to not_home",    text: "Each named device has a tracker (like device_tracker.car_keys) and a room sensor (sensor.car_keys_area) in Home Assistant. When the device is away, both change to not_home, ready for automations, the logbook and Person tracking.", svg: _svgHaEntities },
      { title: "Change the Timeout",                     text: "In Advanced or Development mode, open Settings → Tracking → Rooms and timing → Home/Away Timeout (Basic's Settings page doesn't have it: switch with the mode button at the top right). The default is 5 minutes; anything from 1 minute to 24 hours works. Raise it if devices drop out briefly in thick-walled rooms (10–30 minutes is common); lower it for faster away detection.", svg: _svgPresenceSettings },
    ],
  },
  {
    id: "calibration",
    title: "Calibrate for Accuracy",
    icon: "🎯",
    summary: "Walk your home with your phone so PadSpan learns what each spot sounds like, then see how accurate it is, room by room.",
    steps: [
      { title: "Choose a Device and Floor",                text: "Open Calibration (in the main menu in every mode). It opens on Results; press \"🧭 Guided calibration\" to go step by step. On \"Beacon and floor\", pick the phone or tag you'll carry and the floor to calibrate, and a \"Collection Duration\": 15 s to start with, 60 s recommended. The floor plan needs a scale first: if it has none, \"Measure this floor →\" takes you to measure one distance you know.", svg: _svgCalibSetup },
      { title: "Pin & Listen — Collect Points",            text: "On Pin & Listen, tap the map where you're standing, press \"Start Collecting\" and stand still until the time is up. Then press \"Save Point\" to keep it, or \"Discard\". Each saved spot is one calibration point: how strongly every receiver heard your phone there. Aim for 10–20 spots spread across each floor, including doorways and the walls between rooms.", svg: _svgCalibPin },
      { title: "Roam — Let PadSpan Pick the Spot",          text: "Roam shows how well each part of the floor is covered (green covered, amber partly, red not yet) and a blue crosshair for the next target. Walk there, stand still and press \"I'm Here — Collect\". Once the accuracy has been worked out, a \"Priority:\" card names the room that needs points most.", svg: _svgCalibHeatmap },
      { title: "Check the Accuracy",                       text: "On Model, press \"Compute Model\" (it needs 4 points or more). \"Est. Accuracy\" is how far off PadSpan's guess was on average, in metres; under 2 m shows green. Results then shows the stricter test on spots it hasn't seen, room by room, and the next best thing to do. Add points and compute again any time.", svg: _svgCalibModel },
    ],
  },
  {
    id: "phone_tracking",
    title: "Track Your Phone",
    icon: "📱",
    summary: "Track a phone from the Overview: an Android phone with the Companion app's BLE Transmitter, an iPhone with its IRK.",
    steps: [
      { title: "Android: the Companion App",             text: "Install the Home Assistant Companion app on the phone. On Android it has a BLE Transmitter sensor that sends a steady beacon, which PadSpan can follow even though the phone changes its Bluetooth address for privacy. The iPhone app has no BLE Transmitter: see the last step.", svg: _svgCompanionTrack },
      { title: "One Click on the Overview",              text: "Open the Overview in Live mode and open the Track Your Phone card (click its title if it's folded). Press Track (Basic) or Track this phone (Advanced). PadSpan names the phone, follows it, and asks the app to start sending.", svg: _svgCompanionTrack },
      { title: "What Happens Behind the Scenes",         text: "PadSpan (1) names the phone's beacon, (2) adds it to your followed list, (3) switches the BLE Transmitter sensor on in Home Assistant if it was off, and (4) sends the app a command to start sending. The phone appears on your map once a receiver hears it.", svg: _svgIbeacon },
      { title: "Status Feedback",                        text: "In Advanced mode the button then says how it went: Tracked! (a receiver hears it), Registered — waiting for signal (walk near a receiver), or Registered — enable BLE (in the Companion app, open Settings → Companion App → Manage Sensors → BLE Transmitter and turn it on). Later the card shows Tracked, Waiting for signal or BLE off, with Untrack; Basic shows Unfollow.", svg: _svgCompanionTrack },
      { title: "iPhones: Use the IRK",                   text: "An iPhone is followed by its IRK, a key that recognises it through every address change. Add it in Settings → Tracking → Phones and guest tags → Phone Tracking (Private BLE) (Advanced mode) or in Bluetooth → IRK Manager. Turn on iPhone Setup Path in Settings → Features and an iPhone in the card gets a Setup button with the steps.", svg: _svgPrivateBle },
    ],
  },
  {
    id: "private_ble",
    title: "Private BLE (Apple Devices)",
    icon: "🔒",
    summary: "Track iPhones, Apple Watches and other phones that keep changing their Bluetooth address, using their IRK (Identity Resolving Key).",
    steps: [
      { title: "The Changing-Address Problem",            text: "iPhones, Apple Watches and many Android phones change their Bluetooth address every few minutes for privacy. Without help, each change looks like a new unknown device, so one phone can show up as dozens of unidentified entries.", svg: _svgPrivateBle },
      { title: "IRK — Identity Resolving Key",            text: "An IRK is a key the phone shares with devices it is paired with. With it, PadSpan recognises every new address as the same phone. The key is kept in Home Assistant as a Private BLE Device, and PadSpan shows the phone as one device with a blue \"Private BLE\" badge (Devices → By Room).", svg: _svgPrivateBle },
      { title: "Adding an IRK in PadSpan",                text: "In Advanced or Development mode, open Settings → Tracking → Phones and guest tags → \"Phone Tracking (Private BLE)\" (or Bluetooth → IRK Manager). Press \"Auto-Detect IRKs\" to find keys PadSpan can see on its own, or paste the IRK, give it a name and press \"Add IRK\". Keep the phone awake, with Bluetooth on, near a receiver: PadSpan checks for up to 30 seconds that the key matches the phone, then saves it. With no match it offers \"Save Anyway\", \"Retry\" or \"Cancel\". \"Delete from HA\" removes a phone's Private BLE Device from Home Assistant itself.", svg: _svgPrivateBle },
      { title: "Calibration with Private BLE Devices",    text: "A phone tracked by its IRK works in calibration like any other device: it is matched by its identity, not its changing address, so you can calibrate with your iPhone without worrying about address changes.", svg: _svgCalibSetup },
    ],
  },
  {
    id: "quiet_clear",
    title: "Quiet Mode & Cleanup",
    icon: "🧹",
    summary: "Hide the clutter with Quiet and clear out unnamed devices, keeping the ones you named or follow.",
    steps: [
      { title: "Quiet",                                  text: "Tick Quiet at the top right of the Overview (in every mode). Devices nobody has named or followed are then hidden on the Overview, in Devices, in Follow's list, in Zones and on the maps, so only the ones you care about remain. It changes only what is shown: untick it to see everything again.", svg: _svgQuietMode },
      { title: "Clear Unidentified",                     text: "Clear unidentified removes every device nobody has named or followed from PadSpan's list. It is on the Overview's Objects card (Advanced mode) and in Devices → By Room. Named and followed devices are always kept.", svg: _svgClearUnidentified },
      { title: "When to Clear",                          text: "Clear after naming your important devices, when the list is cluttered with neighbours' phones and passing devices. Anything still in range comes back on the next scan; old entries are gone. Quiet hides them without removing them; Clear removes them.", svg: _svgClearUnidentified },
    ],
  },
  {
    id: "manage",
    title: "Manage Your Setup",
    icon: "⚙️",
    summary: "Remove device names, clean up old map data, back up, and start again if you need to.",
    steps: [
      { title: "The Manage Screen",                      text: "Manage is in the main menu in Advanced and Development mode, and under More tools in Basic. Its tabs are Data, HA Entities, Beacon Characteristics, History, Events, Logs and Factory Reset. Anything that changes or deletes data needs Live mode.", svg: _svgManageOverview },
      { title: "Untag a Device",                         text: "Manage → Data → BLE Device Labels lists every Bluetooth device you named, with its address and when it was last seen. Press \"Untag\", then \"Yes\": the name goes and the device shows its address again, but it is still tracked.", svg: _svgUntagDevice },
      { title: "Clean Up Orphan Polygons",               text: "When a map has room shapes whose room no longer exists in Home Assistant (often left over from the sample house), Manage → Data shows an Orphan Room Polygons card. Delete them one at a time, or with \"Delete ALL orphans\" when there is more than one.", svg: _svgOrphanClean },
      { title: "Factory Reset",                          text: "For a completely fresh start, use Manage → Factory Reset (Live mode, Home Assistant administrator). It erases all of PadSpan's data, backups included; your licence key is kept. Type FACTORY RESET, press \"Erase All Data & Reset\", confirm, then press \"Reload Page\" when it finishes. No Home Assistant restart is needed, and your receivers keep working.", svg: _svgFactoryReset },
    ],
  },
  {
    id: "atlas_intro",
    title: "Atlas: Your Device Map",
    icon: "🗺️",
    summary: "Meet the Atlas: the map for lights, fans, sensors, locks and doors. What's free, what needs a key, and where to find it.",
    steps: [
      { title: "What Atlas Is",                          text: "The Atlas is one map of every floor, drawn the way an electrician draws a lighting plan, for seeing and switching real devices where they really are: lights, fans, locks, motion, temperature, humidity and air-quality sensors, doors and windows.", svg: _svgAtlasOverview },
      { title: "Free vs. Pro",                           text: "Without a key, the Atlas shows your floors and rooms with every device gathered at the middle of its room; tap a light (or its row) to switch it. A PadSpan Bright Pro or PadSpan Pro key adds placing each device where it really is, its shape, size and angle, and the Showcase, Fit room, Light spread, Scene, Ripple, Automorph and Hide untouched tools. PadSpan Pro adds Whole house presets, Vacation Mode, Live Aboard, the heatmap and wall screens.", svg: _svgAtlasEditions },
      { title: "Getting There",                          text: "The Atlas has its own entry in Home Assistant's sidebar, on by default: that's the everyday view. To hide or show it, use Settings → Atlas → Show the Atlas in the Home Assistant sidebar, then restart Home Assistant. Mapping → Atlas (Advanced mode) is the builder, where devices are placed and styled; administrators can jump there from the sidebar Atlas with ✎ Edit map.", svg: _svgAtlasNav },
    ],
  },
  {
    id: "atlas_placement",
    title: "Placing Fixtures on Atlas",
    icon: "📍",
    summary: "Put lights, fans, locks and sensors on the map at their real spot, shape and size.",
    steps: [
      { title: "Drag or Queue-and-Tap",                  text: "In Mapping → Atlas, a device that isn't placed yet waits in the middle of its room. Drag it to its real spot. Or click + Place on its row in the light index (it then reads ◎ Queued) and tap the map where it is; ◎ Queue all unplaced queues every one, and the bar names the next. With a light selected, you can also drag the pulsing pin from the map's bottom-right corner onto its spot. Click 💾 Save placements to keep them.", svg: _svgAtlasPlace },
      { title: "Real Shape, Size and Angle",             text: "A plain tap switches a light, so to select one, hold it, Shift-click or Alt-click it, or click its row in the index. The panel under the map then sets its Shape (pendant, sconce, strip, chandelier and more), its Width and Length in centimetres, and Rotate. Fans, locks and sensors work the same way.", svg: _svgAtlasShape },
      { title: "Live Sensor Readings",                   text: "Sensors show what they read. A temperature tints its marker and digits: blue under 20°, red from 20°, bright orange over 34°. Humidity shows as a percentage. Motion flashes, then fades the longer it has been quiet, whatever the sensor. A leak sensor that reports wet sends a red ring through its room and puts a banner with Reset on every PadSpan screen, until someone dismisses it or for 2 days.", svg: _svgAtlasSensors },
      { title: "Outdoor Gear",                           text: "Anything whose Home Assistant area is on an Outside floor (a shed, the garden, the driveway) has no floor of its own to draw on. Drag it, or queue it and tap the map, onto any floor right where it sits outside the room it's next to.", svg: _svgAtlasOutdoor },
      { title: "Finding a Device Under Another",         text: "Hover over a crowded spot (or hold a finger on it) and the box at the top-left of the map names everything stacked there, as rows you can click. Alt+click cycles through the stack, and right-click lists everything there.", svg: _svgAtlasHoverHud },
    ],
  },
  {
    id: "atlas_barriers",
    title: "Doors, Windows & Locks",
    icon: "🚪",
    summary: "Mark real doors and windows in your walls, and put locks on the map to tap.",
    steps: [
      { title: "Mark a Door or Window",                  text: "A door or window sits in a wall, so draw the walls first (Mapping → Edit → Signal walls). Then either click Door on a wall in Walls on this floor, click the opening's two edges, choose its Linked sensor and click Create door/window; or, in Mapping → Atlas, click Place on the sensor's row in the light index, click the map over that bit of wall, drag the circle to fit and click 💾 Save opening. Its open or closed state then shows live on the map. Steel on that row marks a steel door, which blocks more signal.", svg: _svgAtlasDoor },
      { title: "Invert for a Backwards Sensor",          text: "Some door sensors report 'on' when the door is closed. If a door shows the wrong state, click Invert on its row in the Atlas's light index, or on its wall in Edit → Signal walls. It only changes how PadSpan reads the sensor.", svg: _svgAtlasInvert },
      { title: "Locks on the Map",                       text: "A lock is placed like any other device; tap it to lock or unlock (with a PadSpan Bright Pro or PadSpan Pro key). Link wall on its row ties it to the bit of wall it's in, which then flashes red while it's unlocked. A linked door's row can also take a + Lock and a + Opener.", svg: _svgAtlasLock },
    ],
  },
  {
    id: "atlas_style",
    title: "Automorph & Showcase",
    icon: "✨",
    summary: "Give the map a look: a soft glow around each fixture, and 19 Showcase themes for the whole plan.",
    steps: [
      { title: "Automorph Grows an Aura",                text: "◈ Automorph grows a soft glow from each placed fixture out into its room. It's drawn on top of the fixture's real position, so turning it on or off never moves anything. Room %, Hardness and Subtlety shape it.", svg: _svgAutomorph },
      { title: "Pick a Style",                           text: "Automorph has 16 styles, from Glow, Blueprint and Nebula to Halo and Bloom. Pick one in Style (under Automorph tuning in the new layout). It only changes the look.", svg: _svgAutomorphStyles },
      { title: "Showcase Themes",                        text: "Turn on ✦ Showcase and pick a Theme: 19 looks for the whole map, where colour, room edges, glow and the style of the light pools change together, from Classic and Luxury Real-Estate to Organic Bioluminescent. In the new layout, Theme is under Showcase options.", svg: _svgShowcase },
      { title: "Save a Look",                            text: "With Showcase on, the Presets bar saves the whole look under a name (type it, then Save current), and Apply brings it back: Showcase, Theme, Fit room, Light spread, Beacons, Codes, Untouched, Automorph and the Floor, Spacing, L / R and Zoom positions. The sidebar Atlas can apply a preset too.", svg: _svgPresets },
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
      "PadSpan™ HA is a Home Assistant integration that tells you which room each person or thing is in, using Bluetooth. It listens through the Bluetooth receivers Home Assistant already has: ESPHome Bluetooth proxies, Shelly devices with Bluetooth, or the Home Assistant machine's own Bluetooth.",
      "Plain presence detection knows home or away. PadSpan knows the room, and checks again every 5 seconds by default.",
      "It shows everyone on a live map of your floors, lets you follow one tag and be alerted when it moves, and gives Home Assistant a room sensor for every device you name. Everything runs inside Home Assistant: no cloud needed.",
    ],
  },
  {
    id: "concepts",
    title: "Key Concepts",
    icon: "💡",
    paragraphs: [
      "Bluetooth (BLE) — Bluetooth Low Energy, the low-power radio that phones, AirTags, Tile trackers, key fobs and watches use. They keep sending short signals that receivers nearby can hear.",
      "Receiver (also called scanner or radio) — something that hears those signals and passes them to Home Assistant: an ESPHome Bluetooth proxy, a Shelly with Bluetooth, or the Home Assistant machine's own Bluetooth. Put one in each room you want told apart. The Receivers page lists them all. (Bermuda is a separate integration, not a receiver.)",
      "Signal strength — how loudly a receiver hears a device, in dBm: −55 is louder, so nearer, than −80. Experts call it RSSI.",
      "Room (area) — your rooms are your Home Assistant areas, and each receiver belongs to the area you give it. Add or rename rooms in HA Settings → Areas & Zones.",
      "Device (object) — anything PadSpan hears: a phone, an AirTag, a tag, or an unnamed signal.",
      "iBeacon — a beacon format with a fixed ID that stays the same when the device's address changes. The Android Companion app's BLE Transmitter and many key finders use it. PadSpan groups all of one beacon's addresses into one amber-badged device. (AirTags and other Apple Find My tags are not iBeacons — they have no lasting ID; see MAC Rotation Bridging in Settings → Features.)",
      "Private BLE and IRK — phones and watches change their Bluetooth address for privacy. An IRK (Identity Resolving Key) is the key that recognises one device through every change, so PadSpan shows it as one blue-badged device. Add one in Bluetooth → IRK Manager or Settings → Tracking → Phones and guest tags.",
      "Track Your Phone — the Overview card that tracks a phone in one click. See Phone Tracking below.",
      "Tag (name) — a name you give a device. Named devices show by that name everywhere, and Home Assistant gets a tracker and a room sensor for each.",
      "Follow — mark a device you care about. Followed devices are always drawn as amber markers on the Overview map, are kept when you clear unnamed devices, and are listed in the Live Tracker.",
      "Quiet — the tick at the top of the Overview that hides devices nobody has named or followed. Off by default. See Quiet Mode & Cleanup below.",
      "Home / Away — a device not heard for longer than the away timeout (5 minutes by default) is away: its Home Assistant tracker reads not_home and Devices shows a red Away badge.",
      "Live and Sample, Basic / Advanced / Development — whether you see your own house or the sample house, and how much each screen shows. See the section on them below.",
    ],
  },
  {
    id: "getting_started",
    title: "Getting Started",
    icon: "🚀",
    helpKeys: ["getting_started"],
    paragraphs: [
      "Installing: add PadSpan HA through HACS, then restart Home Assistant fully (Settings → System → Restart; reloading the integration is not enough the first time).",
      "If PadSpan says Bluetooth feed unavailable, Home Assistant needs that full restart.",
    ],
  },
  {
    id: "help_modes",
    title: "Live / Sample and Basic / Advanced / Development",
    icon: "⚡",
    helpKeys: ["data_mode", "complexity_mode"],
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
    helpKeys: ["overview", "overview_grid", "whos_where", "overview_3d_controls", "overview_2d_controls"],
  },
  {
    id: "help_live_tracker",
    title: "Live Tracker",
    icon: "⚡",
    helpKeys: ["live_tracker"],
  },
  {
    id: "help_objects",
    title: "Devices",
    icon: "🏷️",
    helpKeys: ["devices", "objects", "objects_tag", "walk_to_identify"],
  },
  {
    id: "help_occupancy",
    title: "Occupancy and Guests",
    icon: "👥",
    helpKeys: ["occupancy", "unknown_phone", "guest_tags"],
  },
  {
    id: "phone_tracking_section",
    title: "Phone Tracking (Companion App and iPhone)",
    icon: "📱",
    helpKeys: ["phone_tracking"],
  },
  {
    id: "private_ble_section",
    title: "Private BLE & IRK",
    icon: "🔒",
    helpKeys: ["private_ble"],
  },
  {
    id: "help_maps",
    title: "Mapping",
    icon: "🗺️",
    helpKeys: ["maps", "maps_library", "maps_upload", "maps_wizard", "maps_edit", "maps_stack", "maps_layout", "maps_export", "lights_build_controls"],
  },
  {
    id: "help_atlas",
    title: "The Atlas, Vacation Mode, Wall Screens and Live Aboard",
    icon: "💡",
    helpKeys: ["atlas_page", "vacation_mode", "wall_screens", "aboard_3d"],
  },
  {
    id: "floor_alignment",
    title: "Lining Up Floors (3D Stack)",
    icon: "📐",
    paragraphs: [
      "Each floor plan carries its own placement in real metres: where it sits in your home, how big it is, and which way it faces. When PadSpan stacks multiple maps in the 3D isometric view, it uses those placements — so floors only line up once you've aligned them against each other. With a single floor plan there's nothing to align. Either way, set each floor's height in Floor Heights at the top of the tab.",
      "There's no master map. Every map owns its placement, and aligning a map moves that map only — nothing else shifts with it. You align a Target onto a Reference, one pair at a time, under Alignment Overlay in Mapping → 3D Stack.",
      "Measure first: the Reference needs a scale, or there are no metres to line anything up against. In Edit, click 📏 Measure, take two measurements and click Save Scale. The Library shows \"not placed\" for a map with no scale yet, and a ⚠ marks it in the dropdowns. Until the Reference is measured, Reset and Point Align tell you to measure it first.",
      "Choosing the Reference: pick the floor plan that (1) covers the largest footprint of your home, (2) is the most dimensionally accurate, and (3) is easy to see with another map laid over it. The last point matters more than you'd expect — the Target is drawn see-through on top, and a Reference with thin lines or low contrast disappears underneath, so you can't check the fit by eye. That's almost always the ground floor.",
      "Aligning: choose the Reference (fixed) and the Target (draggable). If the Target has never been placed, the readout says Not placed — press Reset to start it on top of the Reference. Drag the Target until shared structural features line up: stairwells, exterior walls, chimneys, load-bearing walls that pass through multiple floors. Scale + and Scale − resize it, with Lock AR turned off, X − and X + stretch it left-right only, −15°, ﹢15° and 0° turn it, and Zoom and Opacity change only your view. Outside plans aren't in the dropdowns — they aren't aligned here.",
      "Saving: nothing is written while you drag. Click Save Alignment to keep the Target's position. If it would leave more than half of that map's calibration points off the map, PadSpan refuses, changes nothing, and says so. If the new position disagrees with a tie-in saved earlier (+ Tie-in), it shows the conflict and offers Average & Save, Override & Save or Cancel.",
      "Point Align: for a precise fit, click Point Align next to the Alignment Overlay heading. Click the same real-world point on both maps — a stairwell corner, the corner of an exterior wall — and it alternates between the two for you. With 3 or more pairs, click Compute and check the preview: Apply accepts it, Back returns you to placing points, Discard throws it away. Apply moves the Target on screen only — click Save Alignment to keep it. With Bake ticked (administrators), the button is Bake & Apply instead: it redraws the Target's picture to fit and saves it at once.",
      "Afterward, check the 3D preview further down the same tab. It shows the whole building stacked together, so a floor that's off is easy to spot. Compare Maps in the Library gives the fit a rating.",
    ],
  },
  {
    id: "quiet_cleanup_section",
    title: "Quiet Mode & Cleanup",
    icon: "🧹",
    paragraphs: [
      "Quiet: the tick at the top right of the Overview, in every mode (with the Atlas as your Overview, it is on the Live Tracker's ▦ Overview side). When on, devices nobody has named or followed are hidden on the Overview, in Devices, in Follow's list, in Zones and on the maps. Off by default.",
      "Quiet changes only what is shown. The Overview's Objects count then counts only named and followed devices, its All objects button becomes Tracked objects, and Devices → By Room says how many are hidden. Untick it to see everything again.",
      "Clear unidentified: removes every device nobody has named or followed from PadSpan's list. It is on the Overview's Objects card (Advanced mode) and in Devices → By Room.",
      "What's kept: every named or followed device, including a phone you set up to track that no receiver has heard yet.",
      "When to use it: after naming your important devices, to clear out neighbours' phones and passing devices. Anything still in range comes back; old entries are gone.",
    ],
  },
  {
    id: "help_settings",
    title: "Settings",
    icon: "⚙️",
    helpKeys: ["settings", "settings_colors", "settings_presence", "settings_tracking_rooms", "settings_tracking_phones",
               "guest_tags", "settings_tracking_shown", "settings_tracking_positioning", "settings_tracking_receivers",
               "settings_tracking_performance", "settings_tracking_integrations", "settings_tracking_privacy",
               "settings_features", "settings_tiers", "settings_ai", "settings_atlas", "settings_ui", "settings_manage"],
  },
  {
    id: "help_zones",
    title: "Zones",
    icon: "📍",
    helpKeys: ["zones"],
  },
  {
    id: "help_traceback",
    title: "Traceback",
    icon: "⏪",
    helpKeys: ["traceback_overview"],
  },
  {
    id: "help_insights",
    title: "Insights",
    icon: "📈",
    helpKeys: ["insights"],
  },
  {
    id: "help_busytimes",
    title: "Busy Times",
    icon: "🔥",
    helpKeys: ["busytimes"],
  },
  {
    id: "help_locate",
    title: "Locate",
    icon: "🧭",
    helpKeys: ["locate"],
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
    helpKeys: ["qa", "qa_propagation", "qa_backup", "qa_radio_analysis"],
  },
  {
    id: "help_health",
    title: "Health",
    icon: "🩺",
    helpKeys: ["health", "status_dot", "health_critics", "diagnostics"],
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
    helpKeys: ["bluetooth_overview"],
    paragraphs: [
      "Scanner placement matters — scanners in the centre of a room perform better than those in corners. Avoid placing scanners behind large metal objects, inside cabinets, or directly against exterior walls. One scanner per room is the minimum; two per room gives significantly better accuracy for larger rooms.",
    ],
  },
  {
    id: "hardware_section",
    title: "Scanner Hardware",
    icon: "🔧",
    paragraphs: [
      "The full story, with the boards that worked and what to avoid, is the \"Choosing Scanner Hardware\" walkthrough (Training → Walkthroughs). In short: the antenna matters more than the chip, and an ESP32-S3 or ESP32-C3 with a full-size external antenna works well.",
    ],
  },
  {
    id: "help_setup",
    title: "Setup",
    icon: "🧩",
    helpKeys: ["setup"],
  },
  {
    id: "help_rooms",
    title: "Rooms",
    icon: "🚪",
    helpKeys: ["rooms"],
  },
  {
    id: "calibration_section",
    title: "Calibration",
    icon: "🎯",
    helpKeys: ["calibration_overview", "calibration_results", "calibration_guided", "calibration_beacon", "calibration_matrix", "calibration_walk"],
  },
  {
    id: "ha_entities_section",
    title: "HA Entities & Automations",
    icon: "🤖",
    paragraphs: [
      "When you name a device, PadSpan adds it to Home Assistant as a device with up to four kinds of entity. Their IDs come from the name you gave it. For a tag called Car Keys:",
      "device_tracker.car_keys — its state is the room it is in; not_home once it hasn't been heard for longer than the away timeout; unknown while it is home but has no room yet. Attributes: address, padspan_id (its fixed PadSpan ID), rssi (signal strength, while home), age_s (seconds since it was last heard), user_label and home (true or false).",
      "sensor.car_keys_area — the same room as its state (unknown, or not_home when away). Attributes: kind, address, padspan_id, rssi, age_s, sources (the receivers that hear it), home, room_confidence and rssi_margin_confidence; for a beacon also ibeacon_uuid, ibeacon_major and ibeacon_minor; and num_addresses with the first 5 all_addresses when it uses several addresses.",
      "sensor.car_keys_distance — metres to the nearest receiver.",
      "sensor.car_keys_distance_kitchen_proxy — metres to one receiver: there is one for each receiver that hears it, named after that receiver and added the first time it hears the device. The distance sensors are empty while it is away. Use them for automations like within 1.5 m of the bedside receiver.",
      "Use them in automations (for example: when sensor.car_keys_area changes to Kitchen), and link the tracker to a person in HA Settings → People for a combined home/away. Phones tracked with Track Your Phone get the same entities under the phone's name.",
      "Manage → HA Entities → Entity Publishing Controls turns each kind of entity on or off.",
      "padspan_ha.dump_devices — run it from HA Developer Tools → Actions (Home Assistant's name for services) for a full JSON list of every tracked device and its state. It returns its answer to scripts and automations too.",
      "The entities stay available across restarts: not_home is a normal state, not an error.",
    ],
  },
  {
    id: "manage_section",
    title: "Manage",
    icon: "🔧",
    helpKeys: ["manage", "manage_data", "manage_entities", "manage_espresense_import", "manage_beacon_chars",
               "manage_events", "manage_logs", "manage_factory_reset"],
  },
  {
    id: "view_modes_section",
    title: "2D Flat Map & View Modes",
    icon: "🗺️",
    paragraphs: [
      "The Overview draws your house in two ways:",
      "3D view (the default) — your floors stacked in a tilted 3D drawing, with rooms, receivers and devices. Its buttons focus one floor, space the floors apart and show outdoor areas: see 3D map controls under Overview Tab.",
      "Overhead (2D) view, experimental — a flat top-down map that zooms with the mouse wheel and pans by dragging. Press ▣ Overhead on the 3D map or turn on Settings → Appearance → 2D Map Mode; ◈ 3D view goes back. Handy on small screens or with one floor: see 2D overhead map controls under Overview Tab.",
    ],
  },
  {
    id: "troubleshooting",
    title: "Troubleshooting",
    icon: "🔍",
    paragraphs: [
      "No live Bluetooth data after install — HA needs a full restart (not just integration reload) after first install via HACS. Go to HA Settings → System → Restart.",
      "The status dot in the top bar is amber or red — click it to open Health, which says what is wrong. Amber: a receiver is silent or hearing less than usual, or learning is suspended. Red: PadSpan isn't answering, positioning has stopped, or no receiver is reporting. Training → Full Manual → Health → The status dot explains when it shows.",
      "A receiver shows Silent or Hearing less (Receivers page, Health) — restart it; on ESPHome, also check its version and Wi-Fi. Rooms near it can be wrong until it recovers.",
      "Devices not appearing — the device must be in range of at least one receiver and sending Bluetooth. Check first that your receivers are reporting: the Receivers page shows each one's status, and Bluetooth → Scanners shows what each one hears.",
      "Location seems wrong (device in wrong room) — signal strength can be affected by walls, interference, or receiver placement, and more receivers improve accuracy. Health → Problems found often names the cause. Make sure each receiver is in the right room: set it in Overview → View radios list → Assign or Change, or in Mapping → Edit → Radios → Room (Advanced and Development modes). If one receiver reads consistently stronger or weaker, give it a signal adjustment on the Receivers page (the same value as Settings → Tracking → Receivers and Bluetooth → Scanners → RSSI offset).",
      "Device keeps flickering between two rooms — raise the Room Change Delay in Settings → Tracking. 20–60 seconds is usually enough to stabilise a device on a room boundary.",
      "device_tracker shows not_home too quickly — raise the Home/Away Timeout in Settings → Tracking. If a device is briefly out of range in a thick-walled room, try 10–30 minutes.",
      "device_tracker shows not_home too slowly — lower the timeout. The minimum is 1 minute.",
      "iBeacon not appearing or keeps splitting into multiple objects — make sure your BLE scanner integration is forwarding the full manufacturer data. PadSpan looks for company ID 0x004C with an iBeacon payload. ESPresense and Bermuda both support this. An AirTag or other Find My tag turning into a new object from time to time is expected: it changes its address (every 15 minutes near its owner, once a day away) — turn on MAC Rotation Bridging in Settings → Features to keep a named one.",
      "iBeacon tag name disappeared after MAC rotation — this should not happen (the UUID key is stable). If it does, check that the UUID in the new advertisement matches the original — some third-party trackers change their UUID.",
      "Phone tracking says 'Waiting for signal' — the Companion App's BLE Transmitter may not be enabled. Open the Companion App → Settings → Manage Sensors → BLE Transmitter and ensure it's toggled on. Walk near a Bluetooth scanner to be detected. Check that the phone's Bluetooth is turned on.",
      "Phone tracked but shows 'BLE off' — the command to enable the transmitter didn't reach the app. Open the Companion App manually and enable BLE Transmitter in Settings → Manage Sensors. The phone must have an active connection to your HA instance for the notification command to work.",
      "iPhone not appearing despite being added as Private BLE — check your IRK format. PadSpan accepts plain hex (32 characters), colon-separated, and base64; Bluetooth → IRK Manager → Test only checks a key without saving it. Check the Home Assistant log for details.",
      "iPhone shows as many unknown devices — add the phone's IRK in Bluetooth → IRK Manager → Add an IRK. Without the IRK, each address change creates a new entry. With the IRK, they all merge into one object.",
      "UI changes not showing — hard refresh your browser (Ctrl+F5 or Cmd+Shift+R). Health → System shows the panel's version and build; Diagnostics → Install Verification compares it with the server's.",
      "Email alerts not sending — email is sent through Home Assistant's notify service. Confirm a notification integration (Gmail, SMTP, etc.) is set up in Home Assistant (Settings → Devices & services), then press Test Notification in Manage → Events.",
      "Too many unknown devices cluttering the view — turn on Quiet mode (the Quiet switch on Overview) to hide unidentified devices, or use 'Clear unidentified' on Overview to remove them. Tagged and followed devices are always kept.",
      "Sample data lingering — in Manage → Data, use Untag on leftover names, or the Orphan Polygons cleaner, to remove sample-mode leftovers.",
      "3D floor alignment looks wrong — after setting alignment in Mapping → 3D Stack, click Save Alignment. The 3D preview will then use the correct reference aspect ratio. Re-open and re-save if alignment was set in an older version.",
      "Asking support for help — open Diagnostics (QA → Go to Diagnostics) or Monitor → Export for support, copy the report and attach it to a GitHub issue or an email to support.",
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
      "PadSpan™ HA tells you which room each person or thing is in, using the Bluetooth receivers Home Assistant already has (ESPHome Bluetooth proxies, Shelly devices, or the Home Assistant machine's own Bluetooth).",
      "Plain presence detection knows home or away; PadSpan knows the room, checks again every 5 seconds by default, and shows it on a live map. Everything runs locally inside Home Assistant.",
    ],
  },
  {
    id: "qs_getting_started",
    title: "Getting Started",
    icon: "🚀",
    helpKeys: ["getting_started"],
    paragraphs: [
      "Not installed yet? Add PadSpan HA through HACS, then restart Home Assistant fully.",
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
    title: "Mapping",
    icon: "🗺️",
    helpKeys: ["maps", "maps_wizard", "maps_edit", "lights_build_controls"],
  },
  {
    id: "qs_settings",
    title: "Settings",
    icon: "⚙️",
    paragraphs: [
      "Settings is in the menu in every mode. Basic shows the Appearance settings, with buttons for the usage report and guest tags; Advanced and Development mode have these tabs:",
      "Appearance — room colours, Panel Style, Theme and 2D Map Mode. Floors come from Home Assistant (shown as \"Floor (HA)\" beside each room): add or change them in HA Settings → Areas & Zones.",
      "Scanner Map — where PadSpan estimates each scanner is, from your calibration points. Clear one map's calibration points here if you need to start that map again.",
      "Tracking — Room Change Delay (how long before PadSpan confirms a room switch), Home/Away Timeout (how long before a missing device is marked away), guest tags, Phone Tracking (Private BLE) for an iPhone's or Apple Watch's IRK, positioning, receivers, performance and privacy.",
      "Features — your PadSpan licence, the experimental switches and Forensics.",
      "AI — the Home Assistant AI Task PadSpan can use to read photos and floor plans.",
      "Atlas — the Atlas in the sidebar, Live Aboard, wall screens and the Atlas as Overview.",
      "UI Structure — choose which extra tabs appear in the main menu in Advanced and Development mode instead of under More tools.",
      "Quiet Mode — switched with the Quiet tick at the top of Overview. Hides unidentified devices to reduce clutter, so only tagged and followed ones show.",
    ],
  },
  {
    id: "qs_manage",
    title: "Manage",
    icon: "🔧",
    paragraphs: [
      "Manage is in the main menu in Advanced and Development mode, and under More tools in Basic.",
      "Data — remove device names (BLE Device Labels → \"Untag\"), clean up orphan room shapes and phantom entries, delete Home Assistant entities, areas or maps, Backup & Restore, and reload the integration. Live mode only.",
      "HA Entities — which entities PadSpan creates, and the MQTT, ESPresense (with the ESPresense Companion import) and Tasmota connections.",
      "Beacon Characteristics — a report of how each beacon reads.",
      "History — opens History → Movement, the saved room changes.",
      "Events — email and phone alerts for room changes, and this session's room log.",
      "Logs — PadSpan's recent log messages, for troubleshooting.",
      "Factory Reset — erase everything PadSpan stored and start again (your licence key is kept).",
    ],
  },
  {
    id: "qs_calibration",
    title: "Calibration",
    icon: "📐",
    paragraphs: [
      "Calibration teaches PadSpan what each spot in your house sounds like, so it puts people in the right room. It is in the main menu in every mode and opens on Results: how accurate it is now, room by room, and the next best thing to do.",
      "To start, press \"🧭 Guided calibration\". It checks your receiver positions (Tune), asks which phone or tag you'll carry and which floor (Beacon and floor), walks you from spot to spot (Roam), then works out the accuracy (Model). The floor plan needs a scale first.",
      "At each spot, stand still for the \"Collection Duration\" (15 s to start with, 60 s recommended). Aim for 10–20 spots spread across each floor.",
      "Pin & Listen lets you pick the spots yourself, and Beacon Tune pins beacons that stay in one place so they keep calibrating on their own. Each tab's ? explains more.",
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
    title: "Basic / Advanced / Development, Live / Sample",
    icon: "⚡",
    helpKeys: ["complexity_mode", "data_mode"],
  },
];

// A translated help is read here inside English section names and intros:
// the same note the help modal opens with, once at the top. English: nothing.
function _helpNote(ctx, el, wrap) {
  const note = ctx.helpers.helpNote ? ctx.helpers.helpNote() : "";
  if (note) wrap.appendChild(el("div", { style: "font-size:13px;margin-bottom:12px;color:#94a3b8;font-style:italic;line-height:1.6" }, note));
}

function _renderQuickStart(ctx, el, ts, HELP) {
  const wrap = el("div", {});

  wrap.appendChild(el("div", { class: "muted", style: "font-size:12px;margin-bottom:16px;line-height:1.6" },
    "A simplified guide covering the tabs visible in Advanced mode. For the complete reference, switch to the Full Manual tab."));
  _helpNote(ctx, el, wrap);

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
  _helpNote(ctx, el, wrap);

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
