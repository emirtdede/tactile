# Technical debt

Ranked by paydown order. Each item states the cost of leaving it.

## 1. `src/app.js` size (about 2800 lines)

One file owns theme, wizard, settings, cloud card, diagnostics, docs, updates
and rendering. **Cost:** merge conflicts and slow review. **Plan:** extract
`renderer/theme.js`, `renderer/wizard.js`, `renderer/settings.js`,
`renderer/cloud-card.js`, `renderer/diagnostics.js` behind the existing globals,
one module per release, keeping the test gates green.

## 2. No code signing

Unsigned binaries trigger SmartScreen and enterprise blocks. **Cost:** lost
installs. **Plan:** buy a certificate, wire `CSC_LINK`/`CSC_KEY_PASSWORD` into
the release workflow, sign exe and installer.

## 3. Single screenshot harness

`tools/capture.js` stubs IPC in memory, so a screenshot cannot catch a broken
main-process handler. **Cost:** regressions in IPC-only paths. **Plan:** add a
second harness that boots with a temporary database and a stub hook.

## 4. CSS monolith (about 2150 lines)

Theme tokens are split correctly, but feature blocks share one file. **Cost:**
dead-rule drift (mitigated by the dead-CSS test). **Plan:** split into
`base.css`, `layout.css`, `views.css`, `wizard.css` and import them from one
entry; the test reads the concatenated result.

## 5. Translation provenance

Machine translation is not marked per key. **Cost:** reviewers cannot tell which
strings were human-checked. **Plan:** add `reviewed: true` metadata per locale in
`languages.js` and a badge in the language picker once all keys are reviewed.

## 6. Update channel testing

Delta updates are configured but have only been exercised locally. **Cost:**
first real update could surprise users. **Plan:** publish a 0.9.9 test release on
a private tag, install it, and verify the delta path end to end.

## 7. Sync has no conflict UI

Newest snapshot wins. **Cost:** a stale machine can overwrite newer data if the
clock is wrong. **Plan:** compare `exportedAt` with the local last-edit time and
warn before an automatic upload when the local side is older.

## 8. Test coverage of UI state machines

The wizard, scroll-spy and toast queue are covered by structure, not behaviour.
**Cost:** subtle state bugs. **Plan:** extract pure state reducers and unit test
transitions.

## 9. Logging granularity

Main-process logs cover errors and lifecycle, not user actions. **Cost:** harder
diagnostics. **Plan:** add a ring buffer of the last 200 user actions, included
in the diagnostics export.

## 10. Duplicate icon assets

`build/` and `src/assets/` both hold `.ico` files generated from one source.
**Cost:** confusion about which to edit. **Plan:** make `build/` the only output
and generate `src/assets` tray images at build time too.
