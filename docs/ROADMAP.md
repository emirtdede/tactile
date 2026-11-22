# Roadmap

Direction after 1.0.0. Order reflects user value, not effort.

## 1.1 - Trust and distribution

- Code signing certificate; signed exe and installer, no SmartScreen warning.
- winget manifest and a Microsoft Store submission.
- Notarized macOS build and a Linux AppImage on the release page.
- Automatic update check cadence setting and a "what's new" panel after an
  update.

## 1.2 - Library depth

- Per-key sound editor with drag and drop assignment.
- Pack export/share as a single file with a preview image.
- Favourites and recently used profiles.
- Waveform preview per key in the profile editor.

## 1.3 - Comfort

- Per-application sound profiles (match by window title or process).
- Volume ducking while a microphone is in use.
- Scheduled mute (for example during calls) driven by the calendar-free quiet
  hours the user defines.
- Multiple simultaneous output devices.

## 2.0 - Platform

- Plugin API for community packs with a signed manifest.
- Optional encrypted cloud snapshots (user-provided passphrase).
- Multi-machine live sync with last-writer-wins per profile instead of whole
  snapshots.
- Command line interface for scripted profile switching.

## Continuous

- Native-speaker review of all 73 locales, in waves.
- Reduce `app.js` to focused modules (see `TECHNICAL_DEBT.md`).
- Screenshot refresh on every visual change, kept in `docs/screenshots`.
- One audit pass per minor release, recorded in `PRE_DEPLOYMENT_QA_AUDIT.md`
  and `QA_FIXES.md`.
