# Decisions

Architecture decision records, newest first. Each entry states the decision, the
reason and the consequence.

## 2026-11-22 - Serverless folder sync instead of a backend

**Decision:** sync writes one JSON snapshot into a folder the user already
mirrors (OneDrive, Google Drive, Dropbox, custom).

**Reason:** a hosted backend costs money, needs accounts, and adds a privacy
surface. Provider folders are free, already available, and keep the data in the
user's own account.

**Consequence:** no conflict merging; the newest valid snapshot wins and previous
snapshots are retained so a bad choice is reversible.

## 2026-11-22 - Snapshot is a full sql.js export

**Decision:** the snapshot embeds `exportDatabase()` as base64 rather than a
per-table diff.

**Reason:** one artifact restores categories, profiles and settings atomically,
and it validates by construction (SQLite header plus schema).

**Consequence:** snapshots are a few hundred kilobytes; acceptable for a daily
cadence and much simpler to validate.

## 2026-11-22 - Theme modes `system|light|dark|custom`

**Decision:** custom is a real mode, not a modifier on light/dark.

**Reason:** users who pick a brand colour expect it to survive an OS scheme
change; folding it into light/dark made the choice silently revert.

**Consequence:** the main process resolves custom to the OS scheme for
`nativeTheme`, and the renderer tints surfaces from the chosen hex so contrast
holds in both schemes.

## 2026-11-22 - Installer asks for language first

**Decision:** the NSIS wizard opens with a 73-language page, viewing the Windows
display language, and writes the choice to `installer-language.txt`.

**Reason:** the app's own onboarding is too late - the installer's own text and
the first window paint should already be in the user's language.

**Consequence:** the language list is generated from the app registry, so the
two can never diverge; a test enforces the count.

## 2026-11-22 - Locale files are committed data

**Decision:** translations are produced offline by a pipeline and committed as
`src/locales/<code>.js`.

**Reason:** the app must work with no network, and shipping a translation call
at runtime would leak usage and break offline first-run.

**Consequence:** adding a key means touching 73 files; scripts and tests make
that mechanical and verifiable.

## 2026-11-22 - `«0»` placeholder marker

**Decision:** protect `%s` with the punctuation marker `«0»` during machine
translation instead of `__VALUE__`.

**Reason:** the public endpoint transliterated or ate the underscore marker,
producing strings such as `Version%sist verfugbar`.

**Consequence:** a repair pass and an audit script are part of the pipeline, and
`tools/i18n/placeholders.js` must report zero issues before release.

## 2026-11-20 - `node:test` with no test dependency

**Decision:** tests run with the Node built-in runner.

**Reason:** zero supply-chain surface for the build, and the suite runs anywhere
Node runs.

**Consequence:** structural assertions read source text; behavioural assertions
import the module directly.

## 2026-11-20 - Shared audio helper module

**Decision:** all audio resolution lives in `src/libs/audio.js`.

**Reason:** five call sites had drifted, each with its own path handling, and one
allowed traversal outside the pack root.

**Consequence:** any new read path must go through `resolveWithinPath` and the
mtime-keyed cache.

## 2026-11-20 - Settings writes are whitelisted

**Decision:** `SETTING_NORMALIZERS` in the main process validates every key.

**Reason:** the renderer could otherwise persist arbitrary keys or values that
break startup.

**Consequence:** a new setting is invisible until a normalizer exists; the write
returns `false` instead of failing loudly, so tests check the presence.

## 2026-11-19 - Delete dead modules after audit

**Decision:** remove unused modules and dependencies instead of keeping them
"just in case".

**Reason:** each dead file is an unmaintained attack surface and a lie about the
architecture.

**Consequence:** the file structure in `DEVELOPMENT.md` matches reality and the
dead-module test keeps it that way.
