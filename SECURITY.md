# Security policy

## Supported versions

Only the latest release receives security fixes.

| Version | Supported |
| --- | --- |
| 1.0.x | Yes |
| older | No |

## Reporting a vulnerability

Email **security@vellium.dev** with:

- the affected version,
- steps to reproduce,
- the impact you believe it has.

Please do not open a public issue for a vulnerability. You will get an
acknowledgement within 3 business days and a status update within 10 days. Once
a fix ships, you are credited in the release notes unless you prefer otherwise.

## Scope

In scope:

- the renderer to main IPC surface (`src/preload.js`, `src/main.js`),
- sandbox, CSP or navigation bypasses,
- path traversal in audio or cloud folder handling,
- snapshot validation gaps that could destroy user data,
- update verification.

Out of scope:

- unsigned-build SmartScreen warnings (known, see `docs/RISKS.md`),
- issues that require an already-compromised local account,
- third-party sound pack content.

## Design notes

- The renderer is sandboxed with context isolation and no Node access.
- Every IPC payload is validated in the main process.
- Audio reads are confined to the selected pack root.
- Cloud snapshots are validated before they can replace a database.
- Update packages are verified against the published SHA-512.
