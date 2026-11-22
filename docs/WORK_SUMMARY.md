# Interface overhaul - Work Summary

This report records what was built for the 1.0.0 overhaul and the 1.2.0 parity
pass, and points at the evidence for each item. Every screenshot lives in
`docs/screenshots`.

## 1. Interface overhaul

Rebuilt the shell around one collapsible sidebar plus a content surface. A
second pass (1.2.0) restyled it on the shared Vellium design tokens and replaced
the two-level rail with a single grouped sidebar. Views: Sounds, Import,
Documentation, Diagnostics, Settings, About/Legal.

Evidence: `screenshots/01-sounds.png`, `screenshots/02-import.png`,
`screenshots/07-docs.png`, `screenshots/08-diagnostics.png`,
`screenshots/09-about.png`, `screenshots/18-sidebar-collapsed.png`.

- Sidebar: brand header with a collapse button, grouped navigation, category
  list, quick actions, application group, GitHub/Sponsor footer and the version
  line with the active profile.
- Collapsed sidebar: icon rail that keeps the brand mark and footer actions; the
  choice persists in `localStorage`.
- Settings and Documentation: split panes whose grouped topic list scrolls the
  content pane and follows the section in view.
- Cards: category chip, name, material, preview and activate actions, keyboard
  focusable.
- Section headers: compact uppercase label with a Material Symbols icon chip;
  settings controls live in card rows under a "Changes save automatically" pill.

## 2. Themes and icons

- Modes: System, Light, Dark.
- Fifteen palettes, each with a light and a dark variant: Obsidian, Slate, Navy,
  Blue, Cyan, Indigo, Purple, Pink, Red, Orange, Yellow, Emerald, Grass, Lime,
  Custom. The custom palette takes a hex value and mixes surfaces, borders and
  accents from it.
- Icon modes: Theme, Light, Dark, Custom; applied to window, taskbar, tray and
  desktop shortcut through `set-dynamic-app-icon`.

Evidence: `screenshots/17-settings-appearance.png` (palette grid and mode
segmented control), `screenshots/14-light-theme.png` (full light surface),
`screenshots/11-onboarding-theme.png` (live theme preview in onboarding).

## 3. Languages (73)

- Registry in `src/locales/languages.js`, 73 entries, one file per language.
- Every locale has the full key set; `node tools/i18n-status.js` reports
  `73 declared, 73 complete, 0 missing, 0 partial`.
- Zero leak: tests reject hard-coded copy, empty values, English text left in a
  non-English locale and attribute fallbacks that differ from English.
- RTL for `ar`, `he`, `fa`, `ur`.

Evidence: `screenshots/10-onboarding-language.png` (language step with picker).

## 4. Onboarding

Four separate screens in strict order, never combined:

1. Language (`10-onboarding-language.png`)
2. Theme (`11-onboarding-theme.png`)
3. Welcome (`12-onboarding-welcome.png`)
4. Tour (`13-onboarding-tour.png`)

Back is hidden on step 1, Skip completes onboarding, the choice is stored in
`onboarding_done`, and the footer shows "Step n of m".

## 5. Installer language picker

- `tools/gen-installer-languages.js` generates `build/installer-languages.nsh`
  from the registry (73 items, detection by Windows locale name, English
  fallback).
- The page appears first in the wizard; the choice is written to
  `%APPDATA%/Tactile/installer-language.txt` and consumed once on first launch.

Evidence: `docs/build/` is not committed; verify with
`node tools/gen-installer-languages.js` (prints `installer languages: 73`) and by
opening `dist/Tactile-Setup-1.0.0.exe`.

## 6. Cloud sync

`src/cloud-sync.js` plus IPC and the settings card.

- Providers: OneDrive, Google Drive, Dropbox, custom folder.
- `<root>/Tactile/tactile-sync.json`, previous snapshot, 15 daily backups.
- Atomic write with `EBUSY`/`EPERM` fallback; 400 ms debounce plus flush on quit.
- Recovery chain sync -> previous -> newest backup; empty local data never
  overwrites a non-empty backup; restore validates before swapping.

Evidence: `screenshots/04-settings-backup.png` (cloud card and sync controls).
Details: `docs/CLOUD_SYNC.md`.

## 7. Updates

- `electron-updater`, GitHub provider, delta packages, SHA-512 verification.
- States rendered in the update card with progress and release notes.
- Store builds report "managed by the Store".

Evidence: `screenshots/03-settings-general.png` shows the settings surface that
hosts the updates section; details in `docs/UPDATES.md`.

## 8. Accessibility

- Zoom 80-150 percent applied in the main process.
- High contrast and reduce motion toggles.
- Focus rings on every control, translated `aria-label` on icon-only buttons,
  dialogs announce as dialogs and close on Escape.

Evidence: `screenshots/03-settings-general.png`.

## 9. Platform integration

- Close behaviour: ask, tray, quit.
- Start with Windows into the silent tray.
- Taskbar Jump List: Sounds, Import, Settings, Docs.
- Global quick-task hotkey, default `Control+Alt+N`.
- Tray menu in the active language.
- Notifications with sound feedback.

## 10. Publisher and support

- About page: version, licence, publisher card (Vellium.dev), website, GitHub,
  sponsor links, legal and third-party notices.
- Diagnostics: system info copy, report export, log folder, GitHub issue form.

Evidence: `screenshots/09-about.png`, `screenshots/08-diagnostics.png`.

## 11. Verification

| Check | Result |
| --- | --- |
| `npm test` | 102 pass, 0 fail |
| `node tools/i18n-status.js` | 73 declared, 73 complete, 0 missing, 0 partial |
| `node tools/i18n/placeholders.js` | issues: 0 |
| `node node_modules/electron/cli.js tools/capture.js` | 18 screenshots, renderer errors: 0 |
| Windows installer build | `dist/Tactile-Setup-1.1.0.exe`, version metadata 1.1.0, brand icon |

## 12. Repository hygiene

- Removed legacy documentation, agent rule files, temporary logs and scripts.
- Single documentation tree under `docs/`.
- Version 1.0.0 in `package.json`, installer metadata and the About page.
- No em dash or en dash anywhere; enforced by `tools/tests/dashes.test.js`.
