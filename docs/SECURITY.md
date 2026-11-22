# Security

## Threat model

Tactile is a local desktop app that reads audio files the user selects and
stores a small database. The valuable assets are the user's file system and the
integrity of the update channel. There is no account, no telemetry and no
remote service owned by the project.

Trust boundaries:

1. **Renderer to main**: the renderer is untrusted for file system access.
2. **Chosen folders to app**: imported packs and cloud folders are untrusted
   input.
3. **Network to app**: only the updater talks to the network.

## Sandboxing

```js
webPreferences: {
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true
}
```

- The renderer cannot require Node modules, spawn processes or read files.
- `window.api` in `src/preload.js` is the entire privileged surface: named
  methods only, no `invoke(channel, ...)` escape hatch.
- `setWindowOpenHandler` denies popups; `will-navigate` blocks navigation away
  from the app page. All external links go through `shell.openExternal` after a
  scheme check (`http`/`https`/`mailto` only).
- `session.setPermissionRequestHandler` denies every permission.

## IPC validation

- Every `ipcMain.handle` validates types before use: numbers are parsed and
  ranged, ids must be finite positive integers, paths must be strings.
- Setting writes pass through `SETTING_NORMALIZERS`: unknown keys are rejected,
  enumerations are checked against their allowed list, hex colours must match
  `^#[0-9a-fA-F]{6}$`, shortcuts must be valid Electron accelerators.
- Order updates (`db-update-profile-order`, `db-update-category-order`) reject
  malformed id lists before opening a transaction.
- All SQL is parameterized; no string concatenation reaches `exec`.

## File system

`src/libs/audio.js`:

- `resolveWithinPath(root, requested)` resolves both paths, then rejects the
  request unless the result stays inside the pack root. Both traversal (`../`)
  and absolute paths are rejected.
- Only known audio extensions are served, with the matching MIME type.
- File contents are cached as data URIs keyed by path and mtime, so a replaced
  file is never served from a stale cache.

Cloud sync (`src/cloud-sync.js`):

- Writes only inside `<root>/Tactile`, and only the three file families it owns
  (`tactile-sync.json`, `tactile-previous.json`, `tactile-backup-*.json`).
- Atomic write: write to `.tmp-<pid>`, then rename; on `EBUSY`/`EPERM`/`EACCES`
  fall back to copy plus rename.
- Incoming snapshots are validated (`format`, `formatVersion`, base64 payload)
  before `restoreDatabase` swaps the live handle. An invalid file can never
  replace a working database.

## Updates

- `electron-updater` verifies the SHA-512 from `latest.yml` before installing.
- The GitHub publish target is public and read-only; publishing requires the
  release token, which exists only in CI secrets.
- Builds are not code-signed yet (see `RISKS.md`); SmartScreen therefore shows
  an "unknown publisher" prompt until a certificate is available.

## Content and privacy

- No analytics, no crash reporting service, no account.
- Diagnostics stay local until the user clicks Copy or Export.
- The issue-report button opens the public GitHub issue form with a pre-filled
  body; the user reviews it before submitting.
- The database and logs live under `%APPDATA%/Tactile` and are removed only when
  the user asks (uninstall keeps them by default:
  `deleteAppDataOnUninstall: false`).

## Reporting

Security reports go to `support@vellium.dev`. Do not open a public issue for a
vulnerability. See `.github/SECURITY.md`.
