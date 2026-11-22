# Local assistant

Tactile ships an optional on-device assistant. It is off by default, it never
uploads a prompt, and it never downloads a model without the user pressing
Download. Everything in this document is local to the computer.

## What it does

- Answers questions about Tactile from the bundled documentation.
- Searches the same documentation for the CLI and the MCP server.
- Cites the sections it used, with a link to the Markdown source.
- Suggests a model size that matches the hardware it detects.

## Runtime

The assistant talks to [Ollama](https://ollama.com/download) over its HTTP API on
`127.0.0.1:11434`. Tactile does not bundle a runtime and does not install one
silently. If the runtime is missing, Settings shows "Not installed" and the Get
Ollama button opens the official download page.

The client refuses any base URL that is not loopback, so a tampered setting
cannot send prompts to an unknown server.

## Hardware tiers

`src/ai/hardware.js` profiles the machine from `os.cpus()` and `os.totalmem()`:

| Tier | Memory | Cores |
| --- | --- | --- |
| low | under 8 GB | under 4 |
| medium | 8 GB | 4 |
| high | 16 GB | 6 |
| ultra | 32 GB | 8 |

`src/ai/catalog.js` lists four chat models and one embedding model. Each entry
declares a download size, the RAM it needs and the minimum tier. A model is only
offered when both checks pass; the largest runnable model is recommended.

## Download, activate, delete

1. Open Settings > Local assistant.
2. Press Download next to a model. Progress is streamed from Ollama to the card.
3. Press Use model to make it the active model.
4. Press Delete to remove the weights from the computer.

Deleting the active model clears the selection. No model is stored inside the
installer, so the installed app stays small.

## Turning it on and off

`ai_enabled` is a normal setting and part of the cloud backup. When it is off,
`ask` returns an empty answer and the IPC layer never contacts the runtime. The
RAG switch (`ai_rag`) is independent: with it off, the model answers without
documentation context.

## Retrieval index

`src/ai/rag.js` builds a BM25 index over the Markdown files in `docs/` plus the
in-app quick guide. Chunking is heading aware and caps each chunk at 900
characters. The index is cached in `ai-index.json` in the app data folder and
rebuilt when it is older than ten minutes or when Rebuild index is pressed.

When the embedding model is installed, `searchHybrid` re-ranks the same chunks
with cosine similarity. A missing vector simply contributes nothing, so search
works before any download.

## Failure modes

- Runtime not running: status shows Not installed and ask returns a hint.
- Model missing: the answer points to Settings > Local assistant.
- Documentation does not cover the question: the model is instructed to say so
  instead of inventing a menu name.
- Long pull interrupted: the stream stops, the model is not marked installed,
  and the user can retry.

## Files

- `src/ai/service.js` owns status, pull, delete, ask and reindex.
- `src/ai/ollama.js` is the loopback HTTP client.
- `src/ai/assistant.js` combines search with the model.
- `src/ai/corpus.js` reads the shipped Markdown.
- `tools/tests/ai.test.js` covers tiers, chunking, ranking and the client.
