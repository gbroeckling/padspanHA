// ESLint for the panel: correctness rules only, no style rules.
//
// no-undef came first. An undeclared name is valid syntax, so `node --check`
// passes it, and panel.js loads views with `.catch(console.warn)`, so when it
// throws the user gets a blank view with a clean console. That shipped at
// least six times — the worst was an undeclared `el` in maps.js's Lights
// builder (5288c62c), a blank Lights tab for about a day. no-undef finds
// every one of them without running anything.
//
// The rest of the list is every rule in ESLint's recommended set that ESLint
// itself classes as a "problem" (code that is wrong or will not do what it
// says, as opposed to a "suggestion") and that the panel passes, plus three
// "suggestion" rules that guard a wrong result rather than a taste:
// no-global-assign (an assignment to an undeclared `name`, `status` or `event`
// is a write to the browser's own global, which no-undef cannot see),
// no-redeclare and no-shadow-restricted-names. no-dupe-keys is there because
// an object written with the same key twice silently keeps the second.
//
// Recommended rules left off, because the panel does not pass them today:
// no-unused-vars, no-empty, no-cond-assign (lib/ is third-party minified
// code), no-control-regex (the control characters are meant),
// no-async-promise-executor, no-func-assign, no-useless-catch,
// no-useless-escape. Turn one on only together with fixing what it finds.
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

const RULES = [
  "no-undef", "constructor-super", "for-direction", "getter-return", "no-class-assign",
  "no-compare-neg-zero", "no-const-assign", "no-constant-binary-expression",
  "no-constant-condition", "no-debugger", "no-dupe-args", "no-dupe-class-members",
  "no-dupe-else-if", "no-dupe-keys", "no-duplicate-case", "no-empty-character-class",
  "no-empty-pattern", "no-ex-assign", "no-fallthrough", "no-global-assign", "no-import-assign",
  "no-invalid-regexp", "no-irregular-whitespace", "no-loss-of-precision",
  "no-misleading-character-class", "no-new-native-nonconstructor", "no-obj-calls",
  "no-prototype-builtins", "no-redeclare", "no-self-assign", "no-setter-return",
  "no-shadow-restricted-names", "no-sparse-arrays", "no-this-before-super",
  "no-unexpected-multiline", "no-unreachable", "no-unsafe-finally", "no-unsafe-negation",
  "no-unsafe-optional-chaining", "no-unused-private-class-members", "no-useless-backreference",
  "use-isnan", "valid-typeof",
];

// vendor/ holds third-party builds, unmodified (three.js; see
// THIRD_PARTY_NOTICES.md). They are not ours to lint.
export default [{ ignores: ["**/vendor/**"] }, {
  files: ["custom_components/padspan_ha/www/**/*.js"],
  languageOptions: { ecmaVersion: "latest", sourceType: "module", globals: globals.browser },
  rules: Object.fromEntries(RULES.map((r) => [r, "error"])),
}];
