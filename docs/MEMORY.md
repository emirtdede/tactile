# Project memory

Last updated: 2026-11-22 (release 1.1.0)

## What Tactile is

An Electron desktop app that plays mechanical keyboard sounds while the user
types. Local-first: no account, no telemetry, no backend. Windows, macOS and
Linux targets; Windows is the release platform.

## Stack

- Electron 30.5.1, Node 26, CommonJS, no bundler.
- Renderer: HTML + vanilla JS + hand-written CSS with theme tokens.
- Persistence: `sql.js` (SQLite in memory, persisted to one file).
- Key capture: `uiohook-napi`. Audio: Howler with Base64 data URIs.
- Updates: `electron-updater` (GitHub provider, delta packages).
- Tests: `node:test` in `tools/tests/`, 101 tests.

## Current state

- Version 1.1.0 everywhere (`package.json`, installer, About).
- 73 languages complete, 0 missing keys, 0 placeholder issues.
- Screenshots for 18 surfaces in `docs/screenshots`, renderer errors 0.
- Local assistant (Ollama, optional models, BM25 retrieval) and four integration
  surfaces: loopback REST API, MCP server, terminal CLI, signed webhooks.
- Windows NSIS installer builds and installs; AppX target configured.
- Work lands on branch `development`; `main` carries the tagged release.

## Non-obvious rules

- The shell is one collapsible sidebar (`#app-sidebar`) plus floating window
  controls; settings and docs are split panes whose left nav scrolls a pane.
- `settings.theme` holds `system|light|dark`; `settings.theme_palette` holds the
  palette (`obsidian` ... `lime`, `custom`). Colours are CSS variables in
  `src/assets/themes.css` keyed by `<html data-theme>` plus `html.dark`.
- `SETTING_NORMALIZERS` in `src/main.js` gates every setting write. No entry,
  no persistence, silently.
- `applyTranslations()` only overwrites a node when the lookup differs from the
  key, so HTML fallbacks must be empty or exactly English.
- Locale files are UTF-8 without BOM. Never rewrite them with PowerShell 5.1
  `Set-Content -Encoding utf8`: it reads as cp1254 and double-encodes text.
- Hidden BrowserWindows throttle CSS; `tools/capture.js` disables animations and
  background throttling.
- `restoreDatabase()` swaps the live handle; callers must reload and notify the
  renderer through `settings-restored`.
- RTL comes from `dir="rtl"` set by the locale engine; CSS uses logical
  properties where it matters.
- `[hidden]` is forced with `display: none !important` because class-based
  display rules would otherwise win.

## Open items

- Code signing certificate: not configured, SmartScreen warns on first run.
- AppX/Store submission still needs WACK on a clean machine.
- `src/app.js` is about 2800 lines; splitting it is planned debt.
- winget manifest to be submitted after the first public release.

## Where to look

- Local assistant: `docs/AI.md`
- Integrations: `docs/INTEGRATIONS.md`
- Brand identity: `docs/BRANDING.md`
- Architecture: `docs/ARCHITECTURE.md`
- Languages: `docs/LOCALIZATION.md`
- Sync: `docs/CLOUD_SYNC.md`
- Updates: `docs/UPDATES.md`
- Tests: `docs/TESTING.md`
- Release steps: `docs/DEPLOYMENT.md`
