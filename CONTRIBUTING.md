# Contributing to PadSpan HA

Thanks for your interest in contributing to PadSpan HA! This is a Home Assistant
custom integration for BLE room-level presence tracking.

## Reporting Bugs

Please use the [Bug Report](https://github.com/gbroeckling/padspanHA/issues/new?template=bug_report.yml)
issue template. Include your PadSpan HA version, Home Assistant version, and
BLE scanner type so we can reproduce the problem.

## Requesting Features

Use the [Feature Request](https://github.com/gbroeckling/padspanHA/issues/new?template=feature_request.yml)
template. Describe your use case so we understand *why* the feature matters.

## Development Setup

1. Fork the repository and clone it.
2. Copy (or symlink) the `custom_components/padspan_ha` folder into your Home
   Assistant `config/custom_components/` directory.
3. Restart Home Assistant to load the integration.
4. Alternatively, add this repo as a HACS custom repository for easier testing:
   - HACS > Integrations > three-dot menu > Custom repositories
   - URL: `https://github.com/gbroeckling/padspanHA`
   - Category: Integration

## Code Style

- **Python** -- Follow standard Home Assistant conventions (`black`, `isort`,
  type hints where practical).
- **JavaScript** -- Vanilla JS, no frameworks. The frontend lives in
  `custom_components/padspan_ha/www/padspan-ha/` (panel.js + views/).
- **Names in markup** -- anything from a device, scanner, room, user or the
  backend goes through `ctx.helpers.esc` (or the file's own escaper) before it
  is put into an HTML or SVG string. `el()` text children are already safe.
- **New WebSocket commands** -- a command that changes the home's shared setup
  or state gets `@admin_if_enhanced_security` (from `ws_common.py`) directly
  above its `async def`, so the Enhanced security switch covers it; anything
  destructive or data-leaving gets `@websocket_api.require_admin`. Every
  command is classified in `tests/test_enhanced_security.py`, and the Settings
  card's list (views/settings.js) says what the switch covers.

## Pull Request Process

1. Create a feature branch from `main`.
2. Keep commits focused -- one logical change per commit.
3. Test your changes against a running Home Assistant instance.
4. Open a PR to `main` with a short description of what changed and why.
5. Agree to the [Contributor Licence Agreement](CLA.md) (a tick box in the PR
   template, once). PadSpan HA is dual-licensed (GPL-3.0 and a commercial
   licence, see [LICENSING.md](LICENSING.md)); the CLA lets your contribution
   be offered under both. You keep your copyright.
6. A maintainer will review and merge when ready.

## How This Project Is Built

PadSpan HA is built by [Garry Broeckling](https://github.com/gbroeckling) — a
30+ year veteran of coding and scripting who has never claimed to be a fast
typist. All architecture, product decisions, testing, and releases are
human-directed. Implementation is AI-assisted using
[Claude](https://claude.ai) by Anthropic, which accelerates the
write-test-ship cycle considerably.

If you contribute a PR, there is no requirement to use (or not use) AI tools.
Write code however you are most productive — what matters is that it works,
follows the existing patterns, and passes review.

## Code of Conduct

Be kind, be constructive. We are all here to make presence tracking better.
