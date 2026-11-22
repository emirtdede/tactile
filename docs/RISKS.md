# Risks

| # | Risk | Impact | Likelihood | Mitigation |
| --- | --- | --- | --- | --- |
| 1 | No code signing certificate | SmartScreen "unknown publisher" reduces installs; some enterprises block unsigned binaries | High | Document it; purchase an OV/EV certificate before wide promotion; keep `verifyUpdateCodeSignature` on |
| 2 | Store package untested on hardware | AppX submission could be rejected (WACK) | Medium | Run WACK on a clean VM before submitting; NSIS remains the primary channel |
| 3 | Machine translation quality | Awkward phrasing in low-resource languages; trust loss | Medium | Native-speaker review for top 15 locales; placeholder and leak gates already automated |
| 4 | Global hook conflicts | Another app may own the mute or quick-task accelerator | Medium | Registration failure is reported; shortcuts are user-editable |
| 5 | Antivirus false positives | uiohook-napi and unsigned exe can be flagged | Medium | Submit binaries for whitelisting after signing; keep the hook optional |
| 6 | Cloud folder unavailable | Sync silently stops (provider signed out) | Medium | Status card shows last sync and folder; writes fall back to app data with a visible notice |
| 7 | Snapshot size growth | Very large libraries produce big JSON | Low | Snapshot is a compact SQLite export; backups rotate at 15 days |
| 8 | Single-file renderer | `app.js` near 2800 lines raises change risk | Medium | Tests cover behaviour; planned modular split (see `TECHNICAL_DEBT.md`) |
| 9 | Audio pack licensing | Bundled packs must be redistributable | Low | Packs ship with their own licenses; new packs require provenance checks |
| 10 | Windows file locks during sync | `EBUSY`/`EPERM` on rename | Medium | Atomic write with copy fallback and a single retry; previous snapshot preserved |
| 11 | Locale drift | New key reaches English only | Low | `i18n.test.js` fails on key parity; `i18n-status.js` gate in CI |
| 12 | Migration bug on upgrade | User loses profiles | Low | Additive migrations, pre-restore safety copy, export before restore |

## Monitoring

There is no remote telemetry by design. Risk signals come from:

- the diagnostics export users attach to issues;
- the update adoption curve in GitHub release statistics;
- CI failures on the language and dead-CSS gates.
