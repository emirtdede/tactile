# Cloud Sync

## Design goal

Back up and restore settings and profiles across machines with **no server and
no subscription**. Any folder that a free provider already syncs is enough:
OneDrive (5 GB), Google Drive (15 GB), Dropbox (2 GB) or a network share.

## Provider detection

`src/cloud-sync.js` reads environment variables, in order:

| Provider | Variables (first match wins) |
| --- | --- |
| OneDrive | `OneDriveConsumer`, `OneDrive`, `OneDriveCommercial`, `~/OneDrive` |
| Google Drive | `GoogleDrive`, `~/GoogleDrive`, `~/Google Drive` |
| Dropbox | `Dropbox`, `~/Dropbox` |

Any other folder can be selected manually with the folder picker. The app never
requires the provider client to be installed; a folder path is all it needs.

## Layout

```
<provider root>/
  Tactile/
    tactile-sync.json            newest snapshot
    tactile-previous.json        one snapshot behind
    tactile-backup-YYYY-MM-DD.json   daily backups, 15 kept
```

The `Tactile` subfolder is created on connect. If the provider root is not
writable, the app falls back to a `Tactile` folder under the local app data
directory and reports the reduced durability in the status card.

## Snapshot format

```json
{
  "format": "tactile-backup",
  "formatVersion": 1,
  "appVersion": "1.0.0",
  "exportedAt": "2026-11-22T09:14:00.000Z",
  "data": "<base64 sql.js export>"
}
```

`data` is `database.exportDatabase()` - a full serialized SQLite file. Restoring
is a single handle swap, so categories, profiles and settings all come back
together.

## Write path

1. `exportDatabase()` produces the base64 payload.
2. The snapshot is written to `tactile-sync.json.tmp-<pid>`.
3. `rename` moves it over `tactile-sync.json`; the old file is first copied to
   `tactile-previous.json`.
4. On `EBUSY`, `EPERM` or `EACCES` (Windows file locks, antivirus scanners) the
   write falls back to copy-then-rename and retries once.
5. A daily backup is written when no `tactile-backup-<today>.json` exists, and
   backups older than 15 days are deleted.

Writes are debounced by 400 ms after any change and flushed synchronously on
`will-quit`, so closing the app never loses the last edit.

## Read path and recovery

`cloud-get-status` reports: provider, folder, last sync time, whether the cloud
file is newer than local, and health.

Restore order, stopping at the first valid snapshot:

1. `tactile-sync.json`
2. `tactile-previous.json`
3. the newest `tactile-backup-*.json`

A file is valid when it parses as JSON, has `format: 'tactile-backup'`,
`formatVersion: 1`, and a base64 `data` string that `restoreDatabase` accepts.

## Safety rules

- **Never overwrite a non-empty cloud backup with empty local data.** If the
  local database reports no content (`databaseHasContent() === false`) and the
  cloud snapshot has content, the app refuses to upload and offers Restore.
- A snapshot from a newer `formatVersion` is rejected instead of partially
  applied.
- Restore never deletes the current database first: it validates, swaps, and
  only then reloads the renderer. A failed validation leaves the app untouched.

## User flow

1. Settings -> Data -> Cloud sync card.
2. Choose OneDrive / Google Drive / Dropbox / Custom folder.
3. Connect (creates `Tactile/` and writes the first snapshot).
4. Toggle automatic sync, or press Sync now.
5. On another machine: connect to the same folder, then Restore.

Card actions: Connect, Sync now, Restore, Open folder, Disconnect, plus the
auto-sync switch and the last-sync timestamp. Every string is translated.

## Failure handling

| Failure | Behaviour |
| --- | --- |
| Provider folder missing | Card shows "not found"; Connect is disabled until a folder is chosen |
| Permission denied | Falls back to local app data, status explains it |
| Corrupt newest file | Falls through to previous, then newest backup, and reports which was used |
| No valid snapshot | Restore is disabled with a translated explanation |
| Disk full | Write fails without touching the previous snapshot; error is surfaced as a toast |

## Non-goals

- No conflict merging: the newest valid snapshot wins, and previous snapshots
  are retained so a bad choice is reversible.
- No encryption: the provider account is the trust boundary. The snapshot holds
  the same data as the local database.
