# Contributing

Thanks for taking the time to improve Tactile.

## Before you start

- Open an issue for anything larger than a typo or a one-line fix, so the
  approach can be agreed before code is written.
- Security problems go to **security@vellium.dev**, never a public issue.

## Setup

```bash
npm install
npm start
```

`npm install` rebuilds `uiohook-napi` for Electron through
`electron-builder install-app-deps`.

## Definition of done

A change is ready when all of these hold:

1. `node --test tools/tests/` passes.
2. `node tools/i18n-status.js` prints `73 declared, 73 complete, 0 missing, 0 partial`.
3. `node tools/i18n/placeholders.js` prints `issues: 0`.
4. Any new interface string exists in all 73 locales, in the same position as
   `en.js`.
5. No em dash or en dash was introduced.
6. `node node_modules/electron/cli.js tools/capture.js` still reports
   `renderer errors: 0` when the interface changed.
7. Documentation in `docs/` is updated when behaviour or architecture changed.

## Style

- CommonJS, two-space indentation, semantic names.
- Renderer never touches Node, `fs` or `child_process`.
- Escape user text with `escapeHtml` before it reaches the DOM.
- Settings writes must be added to `SETTING_NORMALIZERS` in `src/main.js`.
- Prefer small, focused functions over long render blocks.

## Translations

Machine translation is a starting point, not a finish line. If you are a native
speaker, corrections to `src/locales/<code>.js` are very welcome; keep key order
and placeholders intact.

## Commits

Conventional prefixes (`feat:`, `fix:`, `docs:`, `test:`, `chore:`, `refactor:`),
a short imperative subject, and a body that explains the why when it is not
obvious.

## License

By contributing you agree that your work is released under the MIT license in
[`LICENSE`](LICENSE).
