# Features

## Core experience

- Mechanical key sounds for 18 bundled packs (Cherry MX, Topre, NK Cream, Holy
  Pandas, EG Crystal/Oreo and travel variants); press and release variants,
  per-key overrides, volume per profile.
- Profiles grouped into user categories, activatable with one click; the active
  profile is highlighted in the library and reported in the sidebar footer.
- Import from a folder or a mixed zip, with format detection for both the
  `config.json` pack format and flat per-key audio folders.
- Global hotkey to mute/unmute (default `Control+Alt+M`) and a quick-task hotkey
  (default `Control+Alt+N`) that opens Tactile with the sound library focused.

## Interface

- One collapsible sidebar: brand header with a collapse button, grouped
  navigation (views, categories, quick actions, application) and a footer with
  GitHub and Sponsor. Collapsed, it becomes an icon rail and remembers the
  choice.
- Views: Sounds, Import, Documentation, Diagnostics, Settings and About, each in
  a card surface.
- Settings and Documentation are split panes: a grouped topic list scrolls the
  content pane and highlights the section in view.
- Settings carries a "Changes save automatically" pill; every control persists
  as soon as it changes.
- Floating window controls sit above the content, so the surface starts at the
  top edge.
- Responsive down to 800x500; the sidebar becomes a drawer under 900 pixels and
  long labels ellipsize instead of overflowing.

## Appearance

- Theme modes: System, Light, Dark.
- Fifteen palettes: Obsidian, Slate, Navy, Blue, Cyan, Indigo, Purple, Pink,
  Red, Orange, Yellow, Emerald, Grass, Lime and Custom. Each palette ships a
  light and a dark variant, so switching mode never loses the palette.
- Custom palette: any hex colour; the accent is mixed into surfaces, borders and
  icons so contrast stays readable in both schemes.
- App icon modes: Theme (follows the active theme), Light, Dark, Custom colour.
  Changing the icon updates the window, taskbar, tray and desktop shortcut.
- Accessibility: zoom 80-150 percent, high contrast mode, reduce motion.

## Language

- 73 languages, each complete (see `LOCALIZATION.md`).
- First run: the OS display language is preselected, English is the fallback.
- The setup wizard asks for the language before anything is installed and hands
  the choice to the app on first launch.
- Right-to-left layouts for Arabic, Hebrew, Persian and Urdu.

## Onboarding

Four sequential full-screen steps, never combined:

1. Language - pick from the 73 locales, previewed live.
2. Theme - System, Light, Dark or a custom accent colour, previewed live.
3. Welcome - what Tactile does, with a short value statement.
4. Tour - three panels covering profiles, settings and the tray/hotkeys.

Progress is shown as a bar plus "Step n of m"; Back is hidden on step 1; Skip
finishes onboarding and is remembered via `onboarding_done`.

## Data and sync

- Serverless cloud sync to OneDrive, Google Drive, Dropbox or any folder.
- Single JSON snapshot with atomic write, 15-day rotating backups and a
  corruption recovery chain (sync -> previous -> newest backup).
- Restore prompt when the cloud file is newer ("Restore" / "Start fresh").
- Manual and automatic sync (400 ms debounce, flush on quit).
- Full settings backup export/import is separate from cloud sync.

## Maintenance

- Diagnostics page: versions, locale, theme, database size, profile count,
  cloud status, log path; copy to clipboard, export a report, open the log
  folder, and a one-click issue report that pre-fills the GitHub template.
- Update centre: check, download with progress, install, and release notes.
- Close behaviour: ask, minimize to tray, or quit.
- Start with Windows, silently into the tray.
- Tray menu: Open, Settings, Docs, Mute, Quit; single/double click actions.
- Taskbar Jump List: Sounds, Import, Settings, Docs.

## Publisher and support

- About page with version, licence (MIT), publisher card (Vellium.dev),
  website, GitHub and sponsor links.
- Legal page with Terms, Privacy and Third-party notices.
- Every link opens in the user's browser via `shell.openExternal`.
