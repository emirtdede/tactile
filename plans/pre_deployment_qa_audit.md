# Plan - Pre-deployment QA and architecture audit

Status: complete (1.0.0).

## Purpose

Before the first public release, walk the whole codebase with a hostile eye and
record every finding with a file, a line and a concrete fix. Then fix everything
and re-scan until the scan is empty.

## Sections

1. **Bugs and logic flaws.** Dead code paths, race conditions, unhandled
   promises, unvalidated IPC, off-by-one, wrong defaults, state that survives a
   view change when it should not.
2. **Performance.** Repeated work in hot paths, unbounded caches, listeners that
   accumulate, synchronous file I/O on the UI path, oversized synchronous
   payloads over IPC.
3. **Code cleanup.** Unused modules, unused CSS, duplicate helpers, stale
   comments, leftover debug output, assets nothing references.
4. **Data integrity and error handling.** Transactions without rollback,
   migrations that are not idempotent, writes that can truncate a file, restore
   paths that can destroy data, error messages that swallow the cause.
5. **Enhancements.** Small, high-value improvements that fit the release.

## Method

- Static scan: `node --check`, grep for `console.log`, `catch {}`, `TODO`,
  `innerHTML`, `eval`, `any`, and unbalanced listeners.
- Behaviour scan: run the test suite, the language gates and the screenshot
  harness; read the renderer console output.
- Data scan: trace every write path to the database and the cloud snapshot;
  confirm each has validation, an error path and a recovery story.
- Structure scan: compare `docs/DEVELOPMENT.md` file tree to the real tree.

## Output

- `docs/PRE_DEPLOYMENT_QA_AUDIT.md`: findings, ordered by priority, each with
  file, line and a fix example.
- `docs/QA_FIXES.md`: what was changed for each finding, with the verification
  command that proves it.

## Exit criteria

- No open P0/P1/P2 finding.
- `node --test tools/tests/` green.
- Language gates green, screenshots clean, installer builds.
