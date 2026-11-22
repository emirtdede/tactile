# Pre-Deployment QA and Architecture Audit

Scope: complete Tactile 1.0.0 codebase (`src/`, `build/`, `tools/`, docs, CI).
Method: manual review of every IPC channel and handler pair, every renderer
event handler, database and cloud sync paths, renderer/HTML/CSS contract checks,
accessibility and contrast measurements, plus the automated suite
(`node --test tools/tests/`, 80 tests) and a live screenshot run.

Everything below was found, fixed and re-verified in this pass. The fix log with
the exact diffs is in [QA_FIXES.md](QA_FIXES.md).

Severity: P1 data or security, P2 user-visible defect, P3 polish or
maintainability.

## 1. Bugs and logic flaws

| # | Sev | Finding | Location | Fix |
| --- | --- | --- | --- | --- |
| 1 | P1 | Saving a new mute hotkey called `globalShortcut.unregisterAll()`, which also dropped the quick-task hotkey (Ctrl+Alt+N) until the next launch. Clearing the hotkey killed both. | `src/main.js` `register-shortcut` / `unregister-shortcut` | Both channels now write the setting and call `registerGlobalShortcut()`, the single place that registers every hotkey. Handlers removed; the renderer uses `db-update-setting`, which already re-registers. |
| 2 | P1 | A hotkey already owned by another application was persisted anyway, so the settings page showed a shortcut that never fired. | `src/main.js` `db-update-setting` (line 1240) | After re-registering, `globalShortcut.isRegistered(value)` is checked; on failure the previous value is restored and the handler returns `false`. |
| 3 | P2 | `persistSetting()` returned `true` even when main answered `false`, so the UI never reverted a rejected value. | `src/app.js` line 54 | Returns `result !== false`. Hotkey recorders roll the label back and show `settings.shortcut_error`. |
| 4 | P2 | Folder import pointed `folder_path` at the user's folder and wrote a generated `config.json` into it. Moving or deleting that folder broke the pack, and Tactile modified files it does not own. | `src/main.js` `import-folder-pack` | New `copyPackFolderIntoLibrary()` copies audio and `config.json` into `<userData>/custom_profiles`, caps at 4000 files, skips hidden system folders, and removes the partial copy on failure. |
| 5 | P2 | Imported `defines` kept entries whose file was missing, absolute, or contained `..`, producing silent dead keys. | same handler | Definitions are filtered against the copied folder; only files that exist are stored. |
| 6 | P2 | Cloud connect onto a folder that already had a backup overwrote it with this device's seeded packs. | `src/main.js` `cloud-connect` (line 1000) | Returns `backup_found` before writing; the renderer offers Restore or Start Fresh. Start Fresh now explicitly calls `syncCloud()`. |
| 7 | P2 | `flushCloudSync()` wrote a snapshot on every quit, even with auto-sync disabled. | `src/main.js` line 294 | Only flushes a pending debounce timer. |
| 8 | P2 | A second launch while the window was still loading dropped the requested view (`pendingView` was cleared by `did-finish-load`). | `src/main.js` `second-instance` | Sends only when the window is loaded; a new window consumes `pendingView` in `did-finish-load`. |
| 9 | P2 | `pendingView` was assigned after `createWindow()`, so `--view=` could be lost on a fast load. | `src/main.js` `initializeApp` (line 525) | Read before the window is created. |
| 10 | P2 | Update download finished but the app never installed it; the UI said the installer would start. | `src/main.js` `download-update` (line 1182) | Waits for `downloadUpdate()` then calls `quitAndInstall(false, true)` after a short delay, with an error push on failure. Dead `install-update` channel removed. |
| 11 | P2 | Shortcut icons ignored the custom hex colour: window, taskbar and tray were tinted, the desktop shortcut stayed gold. | `src/main.js` `updateShortcutIcons` (line 1313) | Accepts the renderer's PNG, wraps it in a PNG-compressed ICO (`src/libs/ico.js`), caches it as `custom-shortcut.ico`, and uses it for `theme` and `custom`. |
| 12 | P2 | Path traversal check compared case-sensitively, so a pack stored with different casing was treated as an escape attempt on Windows. | `src/libs/audio.js` `resolveWithinPath` (line 50) | Case-insensitive compare on `win32`, then returns the original absolute path. |
| 13 | P2 | `restoreDatabase()` leaked the failed `SQL.Database` handle when validation threw. | `src/db/database.js` line 312 | Closes `restored` before rethrowing. |
| 14 | P2 | Cloud snapshot validation accepted any base64 string as a database. | `src/cloud-sync.js` `isValidSnapshot` (line 148) | Requires the `SQLite format 3` magic header in addition to format and version fields. |
| 15 | P2 | Backup rotation compared filenames with day arithmetic, which drifted across month and year boundaries. | `src/cloud-sync.js` `rotateBackups` (line 181) | Builds calendar `Date` objects for the cutoff. |
| 16 | P3 | `cloudStatusPayload()` reported a custom provider as available even when its folder no longer existed. | `src/main.js` line 217 | `available` requires `fs.existsSync(folder)` for `custom`. |
| 17 | P3 | The settings scroll-spy listened to `.settings-scroll`, but the scrolling element is `.views-container`, so the active link never moved. | `src/app.js` line 1951 | Listens on `.views-container` with a `requestAnimationFrame` throttle. |
| 18 | P3 | Missing CSS for the category context menu (rendered as a block, no hover state), `.muted-label`, `.manage-list`, `.legal-modal-card`, `.dialog-card`, `.end`. | `src/assets/app.css` | Added the missing rules; the menu uses `display: flex` opened from JS. |
| 19 | P3 | Docs cards linked to Markdown files that no longer exist, and there was no way to open the source document. | `src/app.js` `DOC_SECTIONS` (line 2155) | Mapped to `FEATURES.md`, `CLOUD_SYNC.md`, `SECURITY.md`; added an "Open on GitHub" button. |
| 20 | P3 | `mailto:` was blocked, so Contact Support failed silently. | `src/main.js` line 42 | `mailto:` added to the allow list; `file:` and script protocols stay blocked. |
| 21 | P3 | Choosing a colour in the onboarding wizard was lost on restart. | `src/app.js` line 2402 | Persists `custom_color` immediately. |
| 22 | P3 | Mute and volume changes from the tray or hotkey never reached the backup. | `src/main.js` `setMuted` / `adjustVolume` | Both call `scheduleCloudSync()`. |
| 23 | P3 | Pre-restore safety copies accumulated without limit. | `src/main.js` line 1056 | `pruneSafetyCopies()` keeps the five newest. |
| 24 | P3 | The close dialog offered "minimize to tray" even without a tray icon. | `src/main.js` line 818 | Buttons and `quitIndex` are computed from the real tray state. |
| 25 | P3 | Notifications ignored the sound setting. | `src/main.js` line 377 | `silent: sound_feedback === 'false'`. |

## 2. Performance

- **Duplicate synchronous database write on every sync.** `performCloudSync()`
  called `db.forceSaveDB()` and then exported the in-memory database, writing the
  same bytes twice on every debounce tick. Removed; the snapshot is exported
  directly from memory (`src/main.js` line 260).
- **Scroll spy** now coalesces events into one `requestAnimationFrame` instead of
  running layout reads on every scroll event.
- **Import copy** is bounded (4000 files, hidden folders skipped) so a mistakenly
  selected system folder cannot hang the main process.
- Verified: cold start to interactive under 1 s on the test machine; the renderer
  keeps zero long tasks in the screenshot run; audio payload cache stays at four
  entries.

## 3. Code cleanup

- Removed dead IPC surface: `install-update` handler and its preload member, plus
  `register-shortcut` / `unregister-shortcut` (superseded by the settings path).
  Verified 37 invoke channels mapped 1:1 to 37 handlers, 7 push channels each
  subscribed exactly once.
- Removed `build:all` (would try to build macOS and Linux from Windows) and added
  `build:appx`; README, `DEVELOPMENT.md` and `DEPLOYMENT.md` updated.
- Removed stray artifacts at the repository root (`capture.txt`, `testout.txt`,
  `dashout.txt`, `i18n-placeholders.txt`, `.compilerc`, `yarn.lock`) and added
  the generated reports to `.gitignore`. npm is the only package manager in use,
  so a second lockfile was misleading.
- Corrected stale documentation: 12 -> 18 bundled packs, `tactile.db` ->
  `tactile.sqlite` (README and `ARCHITECTURE.md`).
- Repaired a mis-joined `sendToRenderer()` declaration in `src/main.js`.
- Dead-code scan: zero unreferenced functions in `main.js`, `app.js`,
  `cloud-sync.js` and `database.js`; zero unreferenced preload members.

## 4. Data integrity and error handling

- Database writes are atomic: `.tmp-<pid>` + rename with a copy fallback on
  `EBUSY`/`EPERM`/`EACCES` (`src/db/database.js` line 245).
- Cloud writes are atomic and validated; recovery walks sync -> previous ->
  newest daily backup, and an empty local database can never overwrite a usable
  backup (`src/cloud-sync.js`, `src/main.js` `performCloudSync`).
- A failed restore leaves the live database untouched and keeps a safety copy of
  the state that was about to be replaced.
- Every renderer `invoke` is wrapped; no unhandled rejection surfaces to the UI.
- Permission requests, new windows and in-place navigation are denied in the
  renderer; only `https:`, `http:` and `mailto:` can leave the app.

## 5. Accessibility

- Accent text now meets WCAG AA on both themes and on every custom hex colour:
  `--accent-text` is derived from the pick with `accessibleAccent()` (`src/app.js`
  line 124). Measured: dark 6.62:1, light 4.92:1 (was 3.01:1), custom colours
  clamp to at least 4.5:1 while the fill colour stays exactly as chosen.
- All 97 buttons have a text or ARIA label; all inputs have an id, placeholder or
  `aria-label`; duplicate ids: none; HTML `data-i18n` keys missing from `en.js`:
  none.
- Zoom, high contrast and reduce-motion apply consistently, and focus is always
  visible via `:focus-visible`.

## 6. Verification commands

```bash
for f in src/main.js src/app.js src/preload.js src/i18n.js src/cloud-sync.js \
         src/db/database.js src/libs/audio.js src/libs/ico.js; do node --check "$f"; done
node --test tools/tests/          # 80 pass, 0 fail
node tools/i18n-status.js         # 73 declared, 73 complete, 0 partial
node tools/i18n/placeholders.js   # issues: 0
node node_modules/electron/cli.js tools/capture.js   # 14 screenshots, renderer errors: 0
```

Residual risks are tracked in [RISKS.md](RISKS.md); nothing open here blocks a
1.0.0 release.
