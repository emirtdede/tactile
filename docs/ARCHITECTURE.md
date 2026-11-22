# Architecture

## Shape

Tactile is a three-layer Electron application with no remote backend.

```
main process (Node)              renderer (sandboxed)         OS
src/main.js                      src/app.html                 uiohook-napi
  - windows, tray, jump list       src/app.js                   Windows registry
  - global shortcuts               src/assets/app.css           nativeTheme
  - settings normalization         src/locales/*.js             taskbar / tray
  - cloud sync orchestration
  - updates, notifications
            |                              |
            +--------- preload bridge -----+   src/preload.js (contextBridge)
                          IPC
src/db/database.js (sql.js)      src/cloud-sync.js      src/libs/audio.js
  - schema, queries, export        - folder providers      - path safety, caching
```

The renderer has no Node access: `nodeIntegration: false`, `contextIsolation: true`,
`sandbox: true`. Everything that touches the file system, the registry, audio
files or the OS goes through a named IPC channel.

## Process responsibilities

### Main (`src/main.js`)

- Creates the `BrowserWindow` (frameless, custom title bar, 1360x880 default).
- Owns the single `sql.js` database handle.
- Normalizes every setting write through `SETTING_NORMALIZERS`: an unknown key or
  an out-of-range value is rejected before it reaches the database.
- Registers global shortcuts (`shortcut_toggle_mute`, `shortcut_quick_task`).
- Resolves the effective theme and applies `nativeTheme.themeSource`; the
  renderer maps the palette to CSS tokens.
- Schedules cloud snapshots (400 ms debounce) and flushes them on `will-quit`.
- Drives `electron-updater` when the module is available (packaged builds only).
- Builds the taskbar Jump List and the tray menu from translated strings.

### Preload (`src/preload.js`)

A flat, explicit API surface exposed as `window.api`. Each method is a thin
`ipcRenderer.invoke` or a subscription helper that returns an unsubscribe
function. No Node primitive is leaked.

### Renderer (`src/app.js`)

- Renders profile cards, categories, settings, docs, diagnostics and onboarding.
- Applies theme (system/light/dark/custom), icon tinting and accessibility
  preferences (zoom, high contrast, reduce motion).
- Owns the four-step onboarding wizard state machine.
- Never writes user text with `innerHTML`; `escapeHtml` is applied first.

## IPC surface

Grouped by domain; all handlers are registered with `ipcMain.handle`.

| Domain | Channels |
| --- | --- |
| App | `get-app-version`, `open-external`, `copy-text`, `set-zoom`, `show-notification` |
| Database | `db-get-settings`, `db-update-setting`, `db-get-profiles`, `db-get-profile-details`, `db-delete-profile`, `db-update-profile-order`, `db-update-profile-details`, `db-get-categories`, `db-create-category`, `db-delete-category`, `db-update-category-order`, `db-rename-category`, `create-profile`, `set-active-profile` |
| Import | `select-directory`, `select-audio-file`, `import-folder-pack`, `import-mixed-zip-pack` |
| Icons | `set-dynamic-app-icon`, `get-svg-data-uri` |
| Shortcuts | `register-shortcut`, `unregister-shortcut` |
| Cloud | `cloud-get-status`, `cloud-choose-folder`, `cloud-connect`, `cloud-disconnect`, `cloud-sync`, `cloud-open-folder`, `cloud-restore` |
| Diagnostics | `get-diagnostics`, `open-logs-folder`, `save-diagnostics` |
| Updates | `check-for-updates`, `download-update`, `install-update` |

Events pushed to the renderer: `update-status`, `navigate`, `settings-restored`,
`global-shortcut-fired`.

## Data model

`sql.js` keeps an in-memory SQLite database persisted to
`app.getPath('userData')/tactile.sqlite`. Tables:

- `categories` - id, name, sort_order
- `profiles` - id, name, category_id, sound_pack, volume, sound_up, sort_order, ...
- `settings` - key/value store (every setting is a string)

`database.js` exposes `initDB`, `getProfiles`, `createProfile`, category CRUD,
`getSetting`/`setSetting`, plus the sync helpers `exportDatabase`,
`databaseHasContent` and `restoreDatabase`.

Migrations are additive and idempotent (`sound_up`, `sort_order`), executed on
init. Default sound packs are seeded exactly once, guarded by a setting flag.

## Audio path

`src/libs/audio.js` resolves a requested file inside the pack root with
`resolveWithinPath`, rejects traversal, expands `{1-10}` ranges, resolves the
`sound`/`soundup` aliases, and caches Base64 data URIs keyed by path plus mtime
in a bounded LRU. The renderer plays them through Howler. Nothing outside the
selected pack root is ever read.

## Storage locations

| Purpose | Path |
| --- | --- |
| Database | `%APPDATA%/Tactile/tactile.sqlite` |
| Logs | `%APPDATA%/Tactile/logs` |
| Diagnostics exports | user-chosen folder |
| Cloud snapshot | `<provider root>/Tactile/tactile-sync.json` |
| Installer language handoff | `%APPDATA%/Tactile/installer-language.txt` |
