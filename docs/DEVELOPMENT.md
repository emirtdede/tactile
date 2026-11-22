# Development

## Requirements

- Node.js 20 or newer (developed on Node 26).
- npm 10 or newer.
- Windows 10/11 for the Windows build; macOS 12+ or a modern Linux distro for
  the other targets.
- No global tooling; everything runs from `node_modules`.

## Install and run

```bash
npm install
npm start                # launches Electron with the real database
```

`postinstall` runs `electron-builder install-app-deps` so `uiohook-napi` is
rebuilt against the Electron ABI. If the Electron binary cannot be downloaded
(offline or blocked), expand a cached zip into `node_modules/electron/dist` and
write `path.txt` containing `electron.exe`; `tools/extract-electron.js` does this
from the local cache.

## Scripts

| Script | Purpose |
| --- | --- |
| `npm start` | Run the app from source |
| `npm run build:icons` | Regenerate app, tray and installer icons |
| `npm run build:win` | Icons, Windows installer, icon-cache refresh |
| `npm run build:appx` | Microsoft Store (APPX) package |
| `npm run build:mac` | macOS target (run on macOS) |
| `npm run build:linux` | Linux targets (run on Linux) |
| `npm run build:clean` | Remove build output |
| `npm test` | Full test suite |

## File structure

```
build/                 NSIS installer assets and scripts
  installer.nsh        custom wizard pages, shortcut icon bridge
  installer-languages.nsh   generated 73-language picker
docs/                  this documentation and screenshots
plans/                 implementation plans
public/                brand assets served to the renderer
src/
  app.html             single-page shell (rail, subnav, views, wizard)
  app.js               renderer logic
  main.js              main process
  preload.js           contextBridge API
  cloud-sync.js        serverless folder sync engine
  i18n.js              translation engine and locale resolution
  assets/              CSS, Howler, icons, tray images
  audio/               bundled sound packs
  db/database.js       sql.js persistence
  libs/audio.js        safe audio resolution and caching
  libs/keycodes.js     key code and remap tables
  locales/             73 locale files plus languages.js registry
  utils/remapper.js    key remapping helpers
tools/
  build-icons.js       icon generation (sharp)
  capture.js           screenshot harness (Electron + IPC stub)
  gen-installer-languages.js  generates the NSIS language picker
  i18n/                translation pipeline
  tests/               node:test suites
```

## Conventions

- CommonJS everywhere; no bundler, no transpiler.
- Two-space indentation in JS, four in CSS, semantic class names.
- No new npm dependency without an explicit decision recorded in `DECISIONS.md`.
- Renderer never touches Node, `fs` or `child_process`.
- User text is escaped with `escapeHtml` before it reaches the DOM.
- Hyphens only: no em dash or en dash in code, copy or documentation.

## Adding a setting

1. Add the default in `src/db/database.js` (`defaultSettings` and the additive
   `newDefaults` migration block).
2. Add a normalizer entry in `SETTING_NORMALIZERS` in `src/main.js`; without it
   the write silently returns `false`.
3. Add the control in `src/app.html` and the handler in `src/app.js`.
4. Add the translation key to `src/locales/en.js` and all 72 other locales.
5. Extend `tools/tests/consistency.test.js` if the setting affects a gate.

## Adding a translation key

Add the English string to `src/locales/en.js` and the same key to every other
locale in the same position, or run the pipeline in `tools/i18n/`:

```bash
node tools/i18n/translate.js     # fan out new keys to all locales
node tools/i18n/triage.js        # list values that stayed identical
node tools/i18n/retry.js         # retry still-identical values
node tools/i18n/repair-placeholders.js
node tools/i18n/placeholders.js  # must report 0 issues
node tools/i18n-status.js        # must report 73 complete
```

## Screenshots

```bash
node node_modules/electron/cli.js tools/capture.js
```

The harness boots the real renderer against an in-memory IPC stub, forces the
light/dark/system variants and writes PNGs to `docs/screenshots/`. It reports
renderer console errors at the end; the release requires 0.

## Running from a worktree

Worktrees share `node_modules` resolution from the main checkout, so run
`npm install` once per checkout and keep `dist/` ignored.
