'use strict';

/**
 * Local assistant guarantees:
 *  - the hardware profile never recommends a model the machine cannot host
 *  - the catalog exposes one embedding model and no bundled weights
 *  - the RAG index chunks Markdown, ranks by BM25 and cites real sections
 *  - the Ollama client only talks to loopback and parses streamed pulls
 */

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const { profileHardware, canRunModel, TIERS } = require(path.join(ROOT, 'src', 'ai', 'hardware'));
const { MODELS, EMBEDDING_MODEL, allModels, findModel, recommendedModel } = require(path.join(ROOT, 'src', 'ai', 'catalog'));
const { chunkMarkdown, buildIndex, bm25, buildContext } = require(path.join(ROOT, 'src', 'ai', 'rag'));
const { createOllamaClient, isLoopbackUrl } = require(path.join(ROOT, 'src', 'ai', 'ollama'));

test('hardware tiers follow memory and core counts', () => {
    const low = profileHardware({ cpus: [{ model: 'Old CPU' }], totalmem: 4 * 1024 ** 3 });
    const medium = profileHardware({ cpus: Array(4).fill({ model: 'CPU' }), totalmem: 8 * 1024 ** 3 });
    const high = profileHardware({ cpus: Array(8).fill({ model: 'CPU' }), totalmem: 16 * 1024 ** 3 });
    const ultra = profileHardware({ cpus: Array(16).fill({ model: 'CPU' }), totalmem: 64 * 1024 ** 3 });

    assert.strictEqual(low.tier, 'low');
    assert.strictEqual(medium.tier, 'medium');
    assert.strictEqual(high.tier, 'high');
    assert.strictEqual(ultra.tier, 'ultra');
    for (const profile of [low, medium, high, ultra]) {
        assert.ok(TIERS.includes(profile.tier));
        assert.ok(profile.memoryGB >= 1);
    }
});

test('a model is only runnable when memory and tier both fit', () => {
    const small = profileHardware({ cpus: Array(2).fill({}), totalmem: 4 * 1024 ** 3 });
    const big = profileHardware({ cpus: Array(16).fill({}), totalmem: 32 * 1024 ** 3 });
    const model = MODELS[MODELS.length - 1];

    assert.strictEqual(canRunModel(small, model), false);
    assert.strictEqual(canRunModel(big, model), true);
    assert.strictEqual(canRunModel(null, model), false);
});

test('the catalog ships no weights and always recommends a runnable model', () => {
    for (const model of allModels()) {
        assert.ok(model.id && model.label);
        assert.ok(model.sizeGB > 0 && model.minMemoryGB > 0);
        assert.strictEqual(model.path, undefined);
    }
    assert.ok(EMBEDDING_MODEL.embedding);
    assert.strictEqual(allModels().filter((model) => model.embedding).length, 1);
    assert.strictEqual(findModel('missing:model'), null);

    const tiny = profileHardware({ cpus: Array(2).fill({}), totalmem: 4 * 1024 ** 3 });
    const picked = recommendedModel(tiny);
    assert.ok(picked);
    assert.strictEqual(canRunModel(tiny, picked), true);
});

test('Markdown is chunked under the limit and keeps its heading', () => {
    const text = '# Setup\n' + 'a'.repeat(1500) + '\n# Restore\nRestore from the cloud card.';
    const chunks = chunkMarkdown(text, { maxChars: 600, minChars: 10 });
    assert.ok(chunks.length >= 2);
    assert.strictEqual(chunks[chunks.length - 1].heading, 'Restore');
    for (const chunk of chunks) assert.ok(chunk.text.length > 0);
});

test('BM25 ranks the section that answers the question first', () => {
    const index = buildIndex([
        { id: 'cloud', title: 'Cloud backup', text: '# Restore\nRestore a backup from the cloud card in settings.' },
        { id: 'keys', title: 'Shortcuts', text: '# Mute\nPress Control K to mute the keyboard sounds.' }
    ]);
    const hits = bm25(index, 'restore cloud backup', 2);
    assert.strictEqual(hits[0].entry.docId, 'cloud');
    const context = buildContext(hits);
    assert.ok(context.startsWith('[1] Cloud backup'));
});

test('the Ollama client refuses non-loopback hosts', async () => {
    assert.strictEqual(isLoopbackUrl('http://127.0.0.1:11434'), true);
    assert.strictEqual(isLoopbackUrl('http://localhost:11434'), true);
    assert.strictEqual(isLoopbackUrl('https://evil.example'), false);
    assert.strictEqual(isLoopbackUrl('file:///etc/passwd'), false);

    let called = null;
    const client = createOllamaClient({
        baseUrl: 'https://evil.example',
        fetchImpl: async (url) => {
            called = url;
            return { ok: true, text: async () => '{"models":[]}' };
        }
    });
    await client.isRunning();
    assert.ok(called.startsWith('http://127.0.0.1:11434'));
});

test('a streamed pull reports progress and resolves on success', async () => {
    const lines = [
        '{"status":"pulling","completed":10,"total":100}',
        '{"status":"pulling","completed":100,"total":100}',
        '{"status":"success"}'
    ].join('\n');
    const client = createOllamaClient({
        fetchImpl: async () => ({
            ok: true,
            body: {
                getReader() {
                    let sent = false;
                    return {
                        read: async () => {
                            if (sent) return { done: true };
                            sent = true;
                            return { done: false, value: new TextEncoder().encode(lines) };
                        }
                    };
                }
            }
        })
    });
    const seen = [];
    const result = await client.pullModel('qwen2.5:0.5b', (progress) => seen.push(progress));
    assert.strictEqual(result.success, true);
    assert.ok(seen.length >= 2);
});

test('the pull and delete endpoints reject malformed model ids', async () => {
    const client = createOllamaClient({ fetchImpl: async () => ({ ok: true, text: async () => '{}' }) });
    assert.deepStrictEqual(await client.pullModel('<script>'), { success: false, error: 'invalid-model' });
    assert.deepStrictEqual(await client.deleteModel('bad id!'), { success: false, error: 'invalid-model' });
});
