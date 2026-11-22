# Integrations

Tactile exposes four integration surfaces. All of them are off by default, all
of them stay on this computer unless the user configures an outbound webhook,
and each one is documented in Settings > Integrations.

## Local API

A loopback REST API for scripts and automation.

- Binds to `127.0.0.1` only. There is no option to listen on a LAN address.
- Requires the per-install bearer token, generated with 24 random bytes.
- Rate limited to 40 requests per second.
- Request bodies are capped at 64 KB and parsed as JSON only.
- No CORS headers are sent, so a web page cannot read responses.

Port and token are written to `api.json` in the app data folder when the API is
enabled, and the file is removed when it is disabled.

| Method | Path | Body |
| --- | --- | --- |
| GET | `/v1/status` | none |
| GET | `/v1/profiles` | none |
| POST | `/v1/profiles/activate` | `{ "id": "..." }` |
| POST | `/v1/mute` | `{ "muted": true }` |
| POST | `/v1/volume` | `{ "level": 0-100 }` |
| POST | `/v1/sync` | none |
| POST | `/v1/ask` | `{ "question": "..." }` |
| GET | `/v1/docs/search?q=` | none |

Every response uses `{ "ok": true, "data": ... }` or `{ "ok": false, "error": "..." }`.

## MCP server

`src/mcp/server.js` speaks JSON-RPC 2.0 over stdio and implements the Model
Context Protocol (version 2024-11-05). It is a thin client of the local API: the
server never opens the database.

Tools:

- `tactile_status`
- `tactile_list_profiles`
- `tactile_activate_profile`
- `tactile_set_mute`
- `tactile_set_volume`
- `tactile_sync`
- `tactile_search_docs`
- `tactile_ask`

Install from Settings > Integrations. Tactile copies the server into
`integrations/mcp/` and writes a `config.json` snippet for Claude Desktop,
Cursor, Windsurf or Cline. The snippet sets `TACTILE_USER_DATA` so the server
finds the same `api.json` as the app.

The local API must be enabled; the MCP server reports the API error instead of
pretending a call succeeded.

## Terminal CLI

`src/cli/tactile.js` is a dependency-free terminal client.

```text
tactile status
tactile profiles [--json]
tactile activate <profile-id>
tactile mute [on|off]
tactile volume <0-100>
tactile sync
tactile docs <query>
tactile ask "<question>"
```

Install from Settings > Integrations. On Windows the launcher is `tactile.cmd`
and runs the app binary with `ELECTRON_RUN_AS_NODE=1`; on macOS and Linux the
launcher is a POSIX shell script. No credentials are stored in the script.

## Webhooks

Outbound events for n8n, Zapier, Make or a custom endpoint.

- Only `http` and `https` URLs are accepted.
- Every request carries `X-Tactile-Event`, `X-Tactile-Timestamp` and
  `X-Tactile-Signature`.
- The signature is `sha256=HMAC(secret, timestamp + "." + body)`.
- Delivery is queued in the background, retried twice with backoff, and never
  blocks the UI or the audio thread.
- A failing endpoint is dropped after three attempts and logged.

Events: `profile`, `mute`, `volume`, `sync`, `restore`.

Example payload:

```json
{
  "event": "profile",
  "sentAt": "2026-01-01T10:00:00.000Z",
  "product": "Tactile",
  "source": "desktop",
  "data": { "id": "linear_cream" }
}
```

## Security notes

- The API token is stored with owner-only permissions where the platform
  supports it.
- `openIntegrationConfig` only reveals known files; the renderer cannot ask the
  main process to open an arbitrary path.
- Webhook secrets are never sent back to the renderer after they are saved.
- All integration code is covered by `tools/tests/integrations.test.js`.
