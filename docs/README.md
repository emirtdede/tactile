# Tactile Documentation

Tactile is a local-first mechanical keyboard sound engine for Windows, macOS and
Linux, built with Electron. This folder is the single documentation home for the
1.0.0 release.

| Document | What it covers |
| --- | --- |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Process model, IPC surface, data flow, storage |
| [FEATURES.md](FEATURES.md) | Product requirements and shipped feature set |
| [DEVELOPMENT.md](DEVELOPMENT.md) | Local setup, scripts, file structure, conventions |
| [LOCALIZATION.md](LOCALIZATION.md) | 73-language pipeline and installer language picker |
| [TESTING.md](TESTING.md) | Test suites, gates and how to run them |
| [SECURITY.md](SECURITY.md) | Threat model, sandboxing, IPC validation |
| [CLOUD_SYNC.md](CLOUD_SYNC.md) | Serverless folder sync, atomic writes, recovery |
| [UPDATES.md](UPDATES.md) | electron-updater flow, delta packages, signing |
| [DEPLOYMENT.md](DEPLOYMENT.md) | Build, installer, Store package, winget, CI/CD |
| [WORK_SUMMARY.md](WORK_SUMMARY.md) | 1.0.0 overhaul evidence and screenshot index |
| [PRE_DEPLOYMENT_QA_AUDIT.md](PRE_DEPLOYMENT_QA_AUDIT.md) | Audit report (findings) |
| [QA_FIXES.md](QA_FIXES.md) | Fix log for the audit findings |
| [CHANGELOG.md](CHANGELOG.md) | Release history |
| [DECISIONS.md](DECISIONS.md) | Architecture decision records |
| [MEMORY.md](MEMORY.md) | Working memory for maintainers |
| [RISKS.md](RISKS.md) | Risk register |
| [ROADMAP.md](ROADMAP.md) | Post-1.0 direction |
| [TECHNICAL_DEBT.md](TECHNICAL_DEBT.md) | Known debt and paydown order |

Screenshots for every major surface live in [screenshots/](screenshots).

## Conventions

- Every statement about behaviour in these documents is verifiable in `src/`.
- Line limits: 250 per document, 100 for `MEMORY.md`.
- No em dashes or en dashes anywhere in the project; hyphens only.
- All UI strings come from `src/locales/*`; no copy is hard-coded.
