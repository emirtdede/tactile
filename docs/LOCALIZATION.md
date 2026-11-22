# Localization

## Contract

- Exactly **73** languages, defined once in `src/locales/languages.js`
  (`code`, `name`, `english`, `rtl`).
- Every locale file carries the **same keys in the same order** as `en.js`;
  `tools/tests/i18n.test.js` fails on any drift.
- `en.js` is the source of truth. A key that exists only in another locale is a
  test failure, as is a key defined but never used.
- Zero language leak: no hard-coded UI copy outside the locale files. A test
  scans `app.html`, `app.js` and `main.js` for literal text in the DOM and for
  `t('key')` calls whose key is missing.

`node tools/i18n-status.js` must print:

```
languages: 73 declared, 73 complete, 0 missing, 0 partial
```

## Registry

```js
{ code: 'tr', name: 'Turkce', english: 'Turkish', rtl: false }
```

`name` is the endonym shown in the picker; `english` is used for diagnostics and
the installer label. `rtl: true` for `ar`, `he`, `fa`, `ur` sets `dir="rtl"` on
the document.

## Resolution

`src/i18n.js`:

- `detectSystemLanguage(locale)` maps an OS tag to the closest supported code:
  `tr-TR` -> `tr`, `zh-Hant-TW` -> `zh-TW`, `pt-BR` -> `pt`, unknown -> `en`.
- `resolveLanguage(stored, osLocale)` prefers an explicitly stored, supported
  code, then the installer choice, then the OS locale, then English.
- The main process resolves once with `app.getLocale()` and writes the result
  back, so the renderer never guesses a different language from `navigator.*`.
- `setLang(code)` loads the locale module and sets the document language and
  direction; `t(key)` and `tf(key, ...args)` read from it.

## Installer language picker

The setup wizard shows a language page first, before the install directory.

- `tools/gen-installer-languages.js` generates `build/installer-languages.nsh`
  from the registry: the combobox items, the Windows-locale detection function
  and the code lookup used when the page is confirmed.
- Detection reads `HKCU\Control Panel\International\LocaleName`; Chinese script
  variants are matched in full (`zh-Hans*`, `zh-Hant*`, `zh-HK`, `zh-MO`), then
  three-letter codes (`fil`), then two-letter prefixes. English is the fallback.
- On install, the chosen code is written to
  `%APPDATA%/Tactile/installer-language.txt`. The main process reads it once on
  first launch (`consumeInstallerLanguage`) and deletes it.
- Regenerate after any registry change: `node tools/gen-installer-languages.js`.

## Translation pipeline

Scripts in `tools/i18n/`, run in this order after adding English keys to
`tools/i18n/new-keys.js`:

1. `translate.js` - fan out new keys through the public Google Translate
   endpoint (`client=gtx`, `sl=en`, `dt=t`). Results are committed as data; the
   runtime never needs the network.
2. `fix.js` - targeted corrections for values the machine got wrong.
3. `triage.js` - list values identical to English.
4. `retry.js` - retry values that are still identical (usually brand names).
5. `repair-placeholders.js` - restore `%s` placeholders damaged in transit.
6. `placeholders.js` - audit; must print `issues: 0`.

## Placeholder protection

`%s` is wrapped in the punctuation marker `«0»` while translating, because the
public endpoint transliterates or eats `__VALUE__`-style markers. After the
round trip the marker becomes `%s` again.

`placeholders.js` flags two things:

- leftover `__TOKEN__` markers
- `%s` glued to a letter or digit on a **spaced-word** language

Scripts and grammars that legitimately attach a placeholder are excluded:
`ja`, `zh-CN`, `zh-TW`, `th`, `km`, `lo`, `my`, `ko`, `az`, `te`, `uz`.

## Allowed identical values

Brand names stay untranslated and are allow-listed in
`ALLOWED_IDENTICAL_KEYS` (`settings.sync_provider_onedrive` and friends) plus
`IDENTICAL_PAIRS_ALLOWED` in `tools/tests/i18n.test.js` for native cognates
(for example `Information` in German).

## Adding a language

1. Add the entry to `src/locales/languages.js` in alphabetical position.
2. Create `src/locales/<code>.js` with the full key set (copy `en.js` and
   translate, keeping key order).
3. Run the tests, `i18n-status.js` and `gen-installer-languages.js`.
4. Capture a screenshot of the picker entry for `WORK_SUMMARY.md`.

## Encoding rules

Locale files are UTF-8 without BOM. Never rewrite them with PowerShell 5.1
`Set-Content -Encoding utf8`: it reads as the ANSI code page and double-encodes
every non-ASCII character. Use the editor or Node `fs.writeFileSync(..., 'utf8')`.
