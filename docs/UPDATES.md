# Updates

## Mechanism

Tactile uses `electron-updater` with the GitHub provider. The module is loaded
lazily: in development (or if the module is missing) `getAutoUpdater()` returns
`null` and the update card reports "unavailable" instead of throwing.

```json
"publish": [
  { "provider": "github", "owner": "emirtdede", "repo": "tactile", "releaseType": "release" }
]
```

`latest.yml` is generated next to the installer by electron-builder and carries
the version, the installer file name and its SHA-512.

## Flow

1. On start (packaged builds, after the window is ready) the app checks for an
   update; the user can also press Check now in Settings -> Updates.
2. `checking` -> `available` (with version and release notes) or `current`.
3. Download streams progress to the renderer (`update-status` events with
   percent, transferred and total bytes).
4. The SHA-512 in `latest.yml` is verified before the file is accepted.
5. Install restarts the app through `quitAndInstall`.

States surfaced in the UI: `idle`, `checking`, `available`, `not-available`,
`downloading`, `downloaded`, `error`, `disabled`.

## Delta packages

`nsis.differentialPackage: true` makes electron-builder publish a block map.
Clients that already have the previous version download only the changed
blocks, which keeps routine updates to a few megabytes instead of 110 MB.

## Store compatibility

- The NSIS target installs per-user by default (`perMachine: false`) and does
  not require elevation, which keeps it compatible with Store-side packaging.
- The `appx` target is configured with a stable identity (`TactileApp`,
  `applicationId: Tactile`, publisher `CN=VelliumPublisher`). Store builds are
  delivered by the Store and skip the GitHub updater, so the update card reports
  "managed by the Store" when the app runs from an AppX package.
- `allowToChangeInstallationDirectory` is enabled for the direct download, but
  the Store package owns its location.

## Signing

`signAndEditExecutable` stays on by default so the exe metadata and icon are
written. Without a certificate electron-builder only edits resources; with a
certificate (`CSC_LINK` / `CSC_KEY_PASSWORD` in CI) it also signs the exe and
the installer.

Signing is currently **not** configured. Until it is:

- SmartScreen shows "unknown publisher" on first run.
- `verifyUpdateCodeSignature` must stay at its default `true`, so a tampered
  package is still rejected by the signature check if a signature exists.

## Release procedure

1. Bump `version` in `package.json` (and `docs/CHANGELOG.md`).
2. `npm run build:win` (or the CI workflow) produces
   `dist/Tactile-Setup-<version>.exe`, `.blockmap` and `latest.yml`.
3. Create a GitHub release with the same tag (`v<version>`), attach the three
   files, and let CI mark it as the latest release.
4. Installed clients see the update on their next check.

## Failure handling

- Network errors leave the current version running and show a translated error
  with a Retry action.
- A failed download resumes from zero rather than installing a partial file.
- A checksum mismatch aborts the install and keeps the downloaded file out of
  the cache.
- Rolling back is done by publishing a higher version with the previous code;
  electron-updater never downgrades automatically.
