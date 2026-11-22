// The optional local assistant: documentation retrieval plus a local model.
//
// Search always works (lexical index over the shipped Markdown). Answer
// generation needs Ollama and an installed model; without them `ask` returns
// the matching sections so the user still gets an answer from the docs.
const fs = require('fs');
const path = require('path');
const { loadDocuments } = require('./corpus');
const { buildIndex, searchHybrid, buildContext } = require('./rag');

const CACHE_TTL_MS = 10 * 60 * 1000;

const SYSTEM_PROMPT = [
    'You are the Tactile documentation assistant.',
    'Tactile is a Windows, macOS and Linux desktop app that plays mechanical keyboard sounds.',
    'Answer only from the numbered context. If the context does not contain the answer, say that the documentation does not cover it and point to Settings or the Diagnostics page.',
    'Be concise: at most five sentences or a short list.',
    'Never invent menu names, shortcuts, pricing or URLs.',
    'Do not use emoji or long dashes.'
].join(' ');

function createAssistant({ docsDir, cachePath = null, ollama, logger = console } = {}) {
    let cache = null;
    let builtAt = 0;

    function loadFromDisk() {
        if (!cachePath) return null;
        try {
            const raw = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
            if (raw && raw.index && raw.index.version === 1) {
                cache = raw.index;
                builtAt = Number(raw.builtAt) || 0;
                return cache;
            }
        } catch (err) {
            // No usable cache: rebuild from the Markdown.
        }
        return null;
    }

    function ensureIndex({ force = false } = {}) {
        if (!force && cache && Date.now() - builtAt < CACHE_TTL_MS) return cache;
        if (!force && !cache) loadFromDisk();
        if (!cache || force || Date.now() - builtAt >= CACHE_TTL_MS) {
            const documents = loadDocuments(docsDir);
            cache = buildIndex(documents);
            builtAt = Date.now();
            if (cachePath) {
                try {
                    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
                    fs.writeFileSync(cachePath, JSON.stringify({ builtAt, index: cache }), 'utf8');
                } catch (err) {
                    logger.warn('Could not write the documentation index cache:', err.message);
                }
            }
        }
        return cache;
    }

    function status() {
        const index = ensureIndex();
        return {
            documents: index.documents,
            chunks: index.entries.length,
            builtAt: new Date(builtAt).toISOString()
        };
    }

    function search(query, { limit = 6, vectors = {}, queryVector = null } = {}) {
        const index = ensureIndex();
        return searchHybrid(index, query, { limit, vectors, queryVector }).map((hit) => ({
            id: hit.entry.id,
            docId: hit.entry.docId,
            title: hit.entry.title,
            heading: hit.entry.heading,
            url: hit.entry.url,
            text: hit.entry.text,
            score: Number(hit.score.toFixed(3))
        }));
    }

    async function ask(question, { model = '', embeddingModel = '' } = {}) {
        const clean = String(question || '').trim().slice(0, 2000);
        if (!clean) return { answer: '', sources: [] };

        let queryVector = null;
        const vectors = {};
        if (ollama && embeddingModel) {
            const embedded = await ollama.embed({ model: embeddingModel, input: clean });
            if (embedded.ok) queryVector = embedded.vector;
        }

        const hits = search(clean, { limit: 6, vectors, queryVector });
        const sources = hits.map((hit) => ({
            title: hit.title,
            heading: hit.heading,
            url: hit.url,
            text: hit.text.slice(0, 240)
        }));

        if (!ollama || !model) {
            return {
                answer: hits.length
                    ? 'The assistant model is not enabled. The closest documentation sections are listed under Sources.'
                    : 'No matching documentation found.',
                sources,
                model: ''
            };
        }

        const context = buildContext(hits);
        const response = await ollama.chat({
            model,
            messages: [
                { role: 'system', content: SYSTEM_PROMPT },
                { role: 'user', content: `Context:\n${context || 'No matching sections.'}\n\nQuestion: ${clean}` }
            ]
        });

        if (!response.ok) {
            return {
                answer: 'The local model did not answer. Check that Ollama is running and the selected model is installed.',
                sources,
                model,
                error: response.error || 'model-error'
            };
        }
        return { answer: response.text, sources, model };
    }

    return { ensureIndex, status, search, ask, reindex: () => ensureIndex({ force: true }) };
}

module.exports = { createAssistant, SYSTEM_PROMPT };
