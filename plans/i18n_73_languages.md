# Plan - 73 languages and zero language leak

Status: complete (1.0.0).

## Goal

Ship 73 fully translated languages with no leak: no hard-coded UI copy, no
English left in a non-English locale, and no locale with missing keys.

## Steps

1. **Registry.** Define all 73 languages in `src/locales/languages.js`
   (endonym, English name, RTL flag) and keep it alphabetical.
2. **Engine.** `src/i18n.js` resolves the language once in the main process from
   `app.getLocale()`, falls back to English, and applies `dir` for RTL.
3. **Locale files.** One `src/locales/<code>.js` per language with the same key
   order as `en.js`.
4. **HTML cleanup.** Every text node, `placeholder`, `title` and `aria-label` is
   hooked with `data-i18n*`; fallbacks are empty or exactly English.
5. **Translation.** `tools/i18n/translate.js` fans out new keys; `fix.js`,
   `triage.js` and `retry.js` correct machine output; placeholders are protected
   with the `«0»` marker and repaired afterwards.
6. **Gates.** `tools/tests/i18n.test.js` enforces key parity, no empty values,
   no English leaks, placeholder integrity, RTL direction and picker generation.
7. **Installer.** `tools/gen-installer-languages.js` generates the NSIS language
   page from the same registry, preselecting the Windows display language.
8. **Measure.** `node tools/i18n-status.js` must print
   `73 declared, 73 complete, 0 missing, 0 partial`; `tools/i18n/placeholders.js`
   must print `issues: 0`.

## Verification

- 73/73 locale files complete.
- 0 placeholder issues, 0 unused keys, 0 leaked English phrases.
- Language picker screenshot captured for `docs/WORK_SUMMARY.md`.
