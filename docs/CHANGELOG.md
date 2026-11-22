# Changelog

All notable changes to Tactile. Format follows Keep a Changelog; versions follow
Semantic Versioning.

## [1.1.0] - 2026-11-22

Local assistant, integration surfaces and retail parity pass.

### Added

- Optional local assistant: hardware profiling, a five-model catalog sized to
  the detected machine, download, activation and deletion, and an off switch.
  No model ships in the installer; inference talks to a user-installed Ollama on
  loopback only.
- Retrieval over the bundled documentation: heading-aware chunking, BM25
  ranking, numbered citations and an optional embedding re-rank when the
  embedding model is installed. Search works with no download.
- Loopback REST API with a per-install token, request cap and rate limit.
- MCP server (JSON-RPC 2.0 over stdio) with eight tools and an installer that
  writes a client config.
- Terminal CLI with status, profiles, mute, volume, sync, docs and ask commands.
- Signed outbound webhooks for n8n, Zapier, Make or a custom endpoint, with
  per-event selection, HMAC signature, retries and a test button.
- Settings > Local assistant and Settings > Integrations, plus Documentation
  cards for both, with instant filtering.
- Uninstaller page that asks whether to delete local data and keeps it by
  default; publisher, support and icon metadata in Windows Settings.
- Brand surface: "A Vellium product" line, publisher card, GitHub and sponsor
  actions, security and KVKK rows, and `src/branding.js` as the single source.

### Changed

- About and legal copy now names Vellium as developer and publisher while the
  product stays Tactile.
- Documentation set extended with `AI.md`, `INTEGRATIONS.md` and `BRANDING.md`.

### Fixed

- Webhook secrets are write-only: a blank field keeps the stored secret instead
  of erasing it.

## [1.0.0] - 2026-11-22

First public release. Complete interface overhaul and platform integration.

### Added

- New application shell: icon rail plus contextual sub-navigation, seven
  settings sections, dedicated Docs, Diagnostics and About/Legal views.
- 73 complete languages with a live language picker, RTL support and a
  zero-leak contract enforced by tests.
- Four-step onboarding (language, theme, welcome, tour) shown once, each step on
  its own screen.
- Theme system: System, Light, Dark and Custom hex, with theme-matched app
  icons (Theme, Light, Dark, Custom) applied to window, taskbar, tray and
  desktop shortcut.
- Serverless cloud sync to OneDrive, Google Drive, Dropbox or any folder:
  atomic snapshots, 15-day backups, recovery chain and empty-data protection.
- Update centre backed by electron-updater with delta packages, progress and
  Store awareness.
- Diagnostics page with copy, export, log folder and one-click issue report.
- Accessibility: zoom 80-150 percent, high contrast, reduce motion.
- Close behaviour (ask / tray / quit), start with Windows into the silent tray,
  taskbar Jump List, quick-task global hotkey.
- Publisher card with website, GitHub and sponsor links; legal and third-party
  notices.
- Installer language page: 73 languages, Windows display language preselected,
  choice handed to the app on first launch.
- Documentation set under `docs/` including screenshots of every surface.

### Changed

- Interface rebuilt on a token-based stylesheet; all colours come from theme
  variables so light, dark and custom stay consistent.
- Settings are validated in the main process through a whitelist with range
  checks for every key.
- Language is resolved once in the main process from the OS locale; the old
  hard-coded Turkish seed is gone.
- Tray menu, Jump List and notifications are fully translated.
- Icons are generated from the brand source at build time.

### Fixed

- Profile cards no longer lose their category after a rename.
- Preview and activation no longer race when clicking quickly.
- Deleting the active category unloads the stale sound pack.
- Path traversal and absolute paths are rejected by the audio resolver.
- Placeholder corruption in translated strings (`%s` glued to text).
- Language leak on first paint from attribute fallbacks.
- Saving or clearing one hotkey no longer unregisters the other, and a hotkey
  owned by another application is reported instead of silently stored.
- Folder import copies the pack into the app library instead of referencing and
  writing to the user's folder.
- Connecting to a folder that already holds a backup asks Restore or Start Fresh
  before anything is written.
- Update download now installs the new version instead of leaving the app open.
- The custom icon colour also reaches the desktop shortcut icon.
- Accent text meets WCAG AA on both themes and on custom colours.

### Removed

- Dead modules, unused dependencies and legacy documentation.
- Test and seed data from the user-facing library.

## Earlier

Internal iterations before 1.0.0 covered the application skeleton, the sound
engine, the tray integration and the security hardening documented in
`DECISIONS.md`. They were never published.
