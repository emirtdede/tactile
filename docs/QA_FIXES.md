# QA Fix Log

Fix-by-fix record for the [Pre-Deployment QA and Architecture Audit](PRE_DEPLOYMENT_QA_AUDIT.md).
Each entry names the defect, the file touched and how it was verified.

## 1. Hotkeys

`src/main.js`

- Removed the `register-shortcut` and `unregister-shortcut` handlers. Both used
  `globalShortcut.unregisterAll()`, which also unregistered the quick-task
  hotkey and left it dead until the next launch.
- All hotkey writes now go through `db-update-setting`, which calls
  `registerGlobalShortcut()`. That function is the only place that registers or
  re-registers shortcuts.
- Added an ownership check: after registering, `globalShortcut.isRegistered()`
  must confirm the combination. Otherwise the previous value is restored, both
  hotkeys are re-registered and the handler returns `false`.
- `src/preload.js`: removed the two now-unused bridge members.
- `src/app.js`: both recorders persist through `persistSetting()`, which now
  propagates the `false` answer, revert the stored value and show the error
  dialog. Clearing the mute hotkey no longer touches the quick-task hotkey.

## 2. Pack import

`src/main.js` (`import-folder-pack`, new `copyPackFolderIntoLibrary`)

- Audio and `config.json` are copied into `<userData>/custom_profiles`; the
  source folder is never written to and never referenced again.
- Copies are capped at 4000 files, hidden folders are skipped, and a partial
  copy is deleted when the copy fails.
- `defines` entries are kept only when the referenced file exists in the copied
  folder, is relative and contains no `..`.
- A missing or unreadable `config.json` now falls back to a generated pack
  instead of aborting the import.

## 3. Cloud sync

`src/main.js`

- `cloud-connect` inspects the target folder first and returns `backup_found`
  when a snapshot already exists, so a fresh install cannot replace another
  device's backup. `src/app.js` shows Restore / Start Fresh; Start Fresh calls
  `syncCloud()` explicitly.
- `flushCloudSync()` only writes when a debounce timer was actually pending, so
  quitting with auto-sync off no longer writes a backup.
- `performCloudSync()` no longer calls `db.forceSaveDB()` before exporting; the
  snapshot is taken from memory (one instead of two synchronous writes).
- `pruneSafetyCopies()` keeps the five newest pre-restore copies.
- `cloudStatusPayload()` reports a custom provider as available only while its
  folder exists.
- `setMuted()` and `adjustVolume()` call `scheduleCloudSync()` so tray and hotkey
  changes are backed up.

`src/cloud-sync.js`

- `isValidSnapshot()` additionally requires the `SQLite format 3` magic header.
- `rotateBackups()` compares calendar days instead of filename arithmetic.
- `providerCandidates` is now exported (used by `tools/tests/cloud-sync.test.js`).

`src/db/database.js`

- `restoreDatabase()` closes the rejected `SQL.Database` handle before throwing.
- `saveDB()` / `forceSaveDB()` write through `writeDatabaseFile()`:
  `.tmp-<pid>` + rename, with an `EBUSY`/`EPERM`/`EACCES` copy fallback.

## 4. App icon

- `src/libs/ico.js` (new): `buildIcoFromPng()` wraps a 256 px PNG into a
  single-image ICO, rejects non-PNG and oversized payloads.
- `src/main.js` `updateShortcutIcons()` accepts the renderer PNG, caches the ICO
  as `custom-shortcut.ico` and uses it for `theme` and `custom`, so the desktop
  shortcut, taskbar and window all show the selected colour. Versioned cleanup
  keeps the cache.
- `src/app.js` `applyAppIcon()` sends the selected mode instead of only the
  light/dark base; the tinted colour is persisted from the onboarding wizard.

## 5. Renderer and layout

- `settings` scroll-spy bound to the real scrolling element (`.views-container`),
  throttled with `requestAnimationFrame`.
- Category context menu opens with `display: flex`; added the missing CSS for the
  context menu, `.muted-label`, `.manage-list`, `.legal-modal-card`,
  `.dialog-card`, `.modal-footer.end`, `.material-new-input-wrap`.
- Docs cards point at the correct Markdown files and can open the source file on
  GitHub.
- Restore prompt is reused for `backup_found`, not only `empty_local`.
- Second instance and `--view=` routing no longer race window creation.

## 6. Accessibility and theming

- `src/app.js`: `contrastRatio()` and `accessibleAccent()` compute a text-safe
  accent (at least 4.5:1) for the current background; `applyTheme()` publishes it
  as `--accent-text`.
- `src/assets/app.css`: added `--accent-text` to both themes and switched 25 text
  and icon rules from `--accent-gold` to `--accent-text`. Fills, borders and
  focus rings keep `--accent-gold`, so the chosen colour is still exact.
- Measured contrast: dark 6.62:1, light 4.92:1 (previously 3.01:1).

## 7. Security

- `mailto:` is allowed for the Contact Support button; `file:`, `javascript:`
  and custom protocol handlers remain blocked.
- `sendToRenderer()` declaration repaired; it returns whether the message was
  delivered so navigation can fall back to `pendingView`.
- `src/libs/audio.js` `resolveWithinPath()` now rejects Windows drive, UNC and
  rooted paths on every host platform and treats backslashes as separators, so
  the traversal contract is identical on Windows, macOS and Linux. NUL bytes are
  rejected as well.

## 8. Documentation and repository hygiene

- Bundled pack count corrected from 12 to 18 in README and `docs/FEATURES.md`.
- Database filename corrected to `tactile.sqlite` in README and
  `docs/ARCHITECTURE.md`.
- `build:all` removed, `build:appx` added; README, `docs/DEVELOPMENT.md` and
  `docs/DEPLOYMENT.md` list working scripts only.
- Removed root artifacts and added them to `.gitignore`.

## 9. Tests added

`tools/run-tests.js` resolves `tools/tests/*.test.js` and hands the files to
`node --test` explicitly. Passing a directory is not portable across Node
versions (Node 22 on the CI runner rejected it), so `npm test` now uses the
runner and behaves the same on every supported Node release.

| File | Covers |
| --- | --- |
| `tools/tests/cloud-sync.test.js` | Provider env order, root resolution, snapshot validation, rotation to previous, recovery chain, 15-day rotation |
| `tools/tests/ico.test.js` | ICO header and directory layout, PNG payload round trip, malformed payload rejection |

Suite result after all fixes:

```
ℹ pass 80
ℹ fail 0
```

Screenshots regenerated with `node node_modules/electron/cli.js tools/capture.js`:
14 images, `renderer errors: 0`.
