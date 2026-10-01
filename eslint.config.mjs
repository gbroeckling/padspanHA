// ESLint for the panel: ONE rule, no-undef, and nothing else.
//
// An undeclared name is valid syntax, so `node --check` passes it, and
// panel.js loads views with `.catch(console.warn)`, so when it throws the
// user gets a blank view with a clean console. That shipped at least six
// times — the worst was an undeclared `el` in maps.js's Lights builder
// (5288c62c), a blank Lights tab for about a day. no-undef finds every one
// of them without running anything. Style rules are deliberately not enabled.
//
// Run with no package.json:
//   npx --yes -p eslint@9 -p globals@17 eslint "custom_components/padspan_ha/www/**/*.js"
// `globals` comes from that same npx install, which a config file cannot
// `import` (ESM resolves from THIS file's folder, where nothing is
// installed) — so it is required relative to the running eslint instead.
//
// Browser + ES-module globals are the whole list: the panel reaches Home
// Assistant only through the `hass` object it is handed, never a global.

import { createRequire } from "node:module";

const globals = createRequire(process.argv[1])("globals");

// vendor/ holds third-party builds, unmodified (three.js; see
// THIRD_PARTY_NOTICES.md). They are not ours to lint.
export default [{ ignores: ["**/vendor/**"] }, {
  files: ["custom_components/padspan_ha/www/**/*.js"],
  languageOptions: { ecmaVersion: "latest", sourceType: "module", globals: globals.browser },
  rules: { "no-undef": "error" },
}];
