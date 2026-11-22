# Testing

## Commands

```bash
npm test          # full suite, 94 tests
node tools/i18n-status.js         # 73 declared, 73 complete, 0 missing, 0 partial
node tools/i18n/placeholders.js   # issues: 0
node node_modules/electron/cli.js tools/capture.js   # screenshots, 0 renderer errors
```

The suite uses `node:test` only, with no third-party test dependency. Tests
import the real modules; nothing is mocked except the Electron shell itself.

## Suites

| File | Tests | Covers |
| --- | --- | --- |
| `audio.test.js` | 5 | Extension/MIME detection, traversal blocking, range expansion, define resolution |
| `cloud-sync.test.js` | 6 | Provider order, root resolution, snapshot validation, rotation, recovery chain |
| `consistency.test.js` | 19 | DOM ids, a11y, CSP, escaping, IPC parity, key usage, CSS dead rules |
| `dashes.test.js` | 1 | Bans em and en dashes in shipped text |
| `i18n.test.js` | 18 | 73 languages, key parity, leak detection, placeholders, RTL, picker generation |
| `ico.test.js` | 2 | ICO wrapper layout and malformed payload rejection |
| `modules.test.js` | 29 | Remapper, database transactions and indexes, renderer promise paths, UI state races |
| `ai.test.js` | 8 | Hardware tiers, model catalog, chunking, BM25 ranking, loopback client |
| `integrations.test.js` | 6 | API token, auth, rate limit, webhook signing, MCP/CLI install |

## Quality gates

A release build is blocked unless all of these hold.

### Interface

- Every element id read by the renderer or main exists in `app.html`.
- No inline `on*` handlers; delegation only.
- Every icon-only button has `data-i18n-aria-label` (translated name).
- Visible focus ring on every control that drops the native outline.
- Every modal declares `role="dialog"` and `aria-modal`, and Escape closes it.
- No CSS rule for a class the UI never uses (dead CSS gate).
- Restrictive Content-Security-Policy in `app.html`.

### Security and data

- Audio helpers reject traversal and absolute paths.
- Settings writes are whitelisted and range-checked.
- Text interpolation does not interpret `$&` in user data.
- Cleared shortcuts do not resurrect defaults on the next read.
- Every transaction has a rollback path.

### Language

- All 73 locales share the English key set exactly.
- No empty values, no English text left in a non-English locale (with an
  allow-list for brand names and native cognates).
- `%s` count is preserved and placeholders are not glued to letters on
  spaced-word languages.
- `app.html` has no hardcoded interface copy; attribute fallbacks are empty or
  exactly the English string.
- HTML inside translated strings stays well-formed.

### Screenshots

`tools/capture.js` prints `renderer errors: 0` when the 14 screens have no
console errors. Any error fails the release.

## Manual checklist

| Area | Check |
| --- | --- |
| Onboarding | Language -> theme -> welcome -> tour, Back hidden on step 1, Skip persisted |
| Language | Switch to Arabic: layout mirrors; restart keeps the choice |
| Theme | System follows OS live; a palette keeps its colour across light and dark |
| Icon | Theme/Light/Dark/Custom updates window, taskbar, tray, shortcut |
| Hotkeys | Mute and quick-task fire while another app is focused |
| Tray | Menu shows Open/Settings/Docs/Mute/Quit in the active language |
| Cloud | Connect, sync, restore on a second machine, disconnect |
| Updates | Check, download with progress, install (packaged build) |
| Diagnostics | Copy and export succeed; report opens GitHub with a pre-filled body |
| Installer | Language page appears first, Windows language preselected |
| Close | Ask/Tray/Quit behave as labelled; silent tray start via `--startup` |

## Conventions for new tests

- One behaviour per test, named as a sentence about the user-visible outcome.
- Read source text when asserting a structural property (for example "no
  inline handlers"); import the module when asserting behaviour.
- Never depend on the network, the clock or the OS locale.
