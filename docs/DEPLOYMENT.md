# Deployment

## Targets

| Platform | Target | Output |
| --- | --- | --- |
| Windows | NSIS (x64) | `dist/Tactile-Setup-<version>.exe` + `.blockmap` + `latest.yml` |
| Windows | AppX (x64) | Store package |
| macOS | DMG (x64) | `dist/Tactile-<version>.dmg` |
| Linux | deb, snap, AppImage | per target |

`npm run build:win` builds the Windows installer after regenerating icons.
`npm run build:appx` produces the Microsoft Store package, while
`npm run build:mac` and `npm run build:linux` must run on their own platform
(macOS is required for signing and DMG creation).

## Windows build

```bash
node tools/build-icons.js
npx electron-builder --win nsis --x64 --publish never
```

Notes for offline or restricted machines:

- If the Electron download fails, pass `--config.electronDist=node_modules/electron/dist`
  to reuse the local Electron binary.
- electron-builder extracts `winCodeSign` even when nothing is signed. That
  archive contains macOS symlinks, which fail on Windows without developer mode.
  Expand it once into
  `%LOCALAPPDATA%/electron-builder/Cache/winCodeSign/winCodeSign-2.6.0` with
  `7za x <archive> -o<dir> -x!darwin*`; later builds reuse it.
- The build must be run from a shell where `node_modules/electron/dist` exists.

## Installer

- Per-user install (`perMachine: false`), no elevation required.
- User can change the install directory.
- First wizard page is the 73-language picker (see `LOCALIZATION.md`).
- `differentialPackage: true` publishes the block map used by delta updates.
- Uninstall keeps user data (`deleteAppDataOnUninstall: false`).
- Shortcut icon bridge: the installer copies light and dark `.ico` files into
  `%APPDATA%/Tactile/Icons` so the shortcut can follow the chosen theme.

## Store package

`appx` is configured with a stable identity. Build with:

```bash
npx electron-builder --win appx --x64
```

Store builds skip the GitHub updater (`process.windowsStore` is set by the
Store runtime) and the update card reports "managed by the Store".

## winget

Publish a manifest after the first public release:

```yaml
PackageIdentifier: Vellium.Tactile
PackageName: Tactile
Publisher: Vellium
PackageVersion: 1.1.0
InstallerType: nullsoft
Installers:
  - Architecture: x64
    InstallerUrl: https://github.com/emirtdede/tactile/releases/download/v1.0.0/Tactile-Setup-1.1.0.exe
    InstallerSha256: <sha256 of the exe>
ManifestType: singleton
ManifestVersion: 1.6.0
```

Submit with `winget-pkgs` PR or `wingetcreate submit`. `InstallerType: nullsoft`
matches the NSIS installer and lets winget pass `/S` for a silent install.

## CI/CD

`.github/workflows/ci.yml`:

1. `npm ci` with the Electron download cached.
2. `npm test`.
3. `node tools/i18n-status.js` and `node tools/i18n/placeholders.js`.
4. `node tools/build-icons.js`.
5. On tags `v*`: build the Windows installer and upload it to a draft release.

All steps must be green before tagging.

## Release checklist

1. `package.json` version bumped, `docs/CHANGELOG.md` updated.
2. Tests, language audit, screenshot capture all clean.
3. Installer built and installed on a clean profile: onboarding on first run,
   language from the installer, tray start works.
4. Tag `v1.1.0`, push, attach the installer, block map and `latest.yml`.
5. Make the release public; verify the update card finds it from 0.9.x.
6. Submit the winget manifest.

## Rollback

Publish a higher version containing the previous code. electron-updater never
downgrades, so a rollback is always a forward release.
