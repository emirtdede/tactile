// Minimal client for a local Ollama runtime.
//
// Tactile never bundles or silently installs a model runtime. It talks to the
// Ollama HTTP API on loopback, which the user installs themselves (or through
// the download link in the assistant page). Every request has a timeout and
// every failure is reported as data, not as an exception bubbling into IPC.
const DEFAULT_BASE_URL = 'http://127.0.0.1:11434';
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

function isLoopbackUrl(value) {
    try {
        const url = new URL(value);
        return (url.protocol === 'http:' || url.protocol === 'https:') && LOOPBACK_HOSTS.has(url.hostname);
    } catch (err) {
        return false;
    }
}

function createOllamaClient({ baseUrl = DEFAULT_BASE_URL, fetchImpl = globalThis.fetch, timeoutMs = 5000 } = {}) {
    // The runtime is local by definition. Refusing non-loopback URLs keeps a
    // tampered setting from sending prompts to an unknown server.
    const root = isLoopbackUrl(baseUrl) ? baseUrl.replace(/\/$/, '') : DEFAULT_BASE_URL;

    async function request(pathname, { method = 'GET', body, timeout = timeoutMs } = {}) {
        if (typeof fetchImpl !== 'function') {
            return { ok: false, error: 'fetch-unavailable' };
        }
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeout);
        try {
            const response = await fetchImpl(`${root}${pathname}`, {
                method,
                headers: body ? { 'Content-Type': 'application/json' } : undefined,
                body: body ? JSON.stringify(body) : undefined,
                signal: controller.signal
            });
            if (!response.ok) {
                return { ok: false, status: response.status, error: `HTTP ${response.status}` };
            }
            const text = await response.text();
            return { ok: true, data: text ? JSON.parse(text) : null };
        } catch (err) {
            return { ok: false, error: err && err.name === 'AbortError' ? 'timeout' : (err.message || 'network-error') };
        } finally {
            clearTimeout(timer);
        }
    }

    async function isRunning() {
        const result = await request('/api/tags', { timeout: 1500 });
        return { running: result.ok, models: result.ok && result.data && Array.isArray(result.data.models) ? result.data.models : [] };
    }

    async function listModels() {
        const result = await isRunning();
        return result.models.map((model) => ({
            id: model.name || model.model,
            sizeBytes: Number(model.size) || 0,
            modifiedAt: model.modified_at || null
        }));
    }

    /**
     * Streams a pull. Ollama answers with newline-delimited JSON; the callback
     * receives {status, completed, total} and the promise resolves with the
     * final state so the IPC layer can report "installed" or "failed".
     */
    async function pullModel(modelId, onProgress = () => {}) {
        if (typeof fetchImpl !== 'function') return { success: false, error: 'fetch-unavailable' };
        if (typeof modelId !== 'string' || !/^[A-Za-z0-9._:/-]{1,120}$/.test(modelId)) {
            return { success: false, error: 'invalid-model' };
        }
        const controller = new AbortController();
        // A 5 GB download over a slow line must not hit the short RPC timeout.
        const timer = setTimeout(() => controller.abort(), 60 * 60 * 1000);
        try {
            const response = await fetchImpl(`${root}/api/pull`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: modelId, stream: true }),
                signal: controller.signal
            });
            if (!response.ok || !response.body) {
                return { success: false, error: `HTTP ${response.status}` };
            }
            const decoder = new TextDecoder();
            let buffer = '';
            let last = { status: 'starting', completed: 0, total: 0 };
            const reader = response.body.getReader();
            for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';
                for (const line of lines) {
                    if (!line.trim()) continue;
                    try {
                        const event = JSON.parse(line);
                        last = {
                            status: event.status || last.status,
                            completed: Number(event.completed) || 0,
                            total: Number(event.total) || 0
                        };
                        if (event.error) return { success: false, error: String(event.error) };
                        onProgress(last);
                    } catch (err) {
                        // A partial chunk is retried on the next read.
                    }
                }
            }
            return { success: true, model: modelId, status: last.status };
        } catch (err) {
            return { success: false, error: err && err.name === 'AbortError' ? 'timeout' : (err.message || 'network-error') };
        } finally {
            clearTimeout(timer);
        }
    }

    async function deleteModel(modelId) {
        if (typeof modelId !== 'string' || !/^[A-Za-z0-9._:/-]{1,120}$/.test(modelId)) {
            return { success: false, error: 'invalid-model' };
        }
        const result = await request('/api/delete', { method: 'DELETE', body: { name: modelId }, timeout: 15000 });
        return result.ok ? { success: true } : { success: false, error: result.error };
    }

    async function chat({ model, messages, temperature = 0.2, timeout = 120000 }) {
        if (!model) return { ok: false, error: 'no-model' };
        const result = await request('/api/chat', {
            method: 'POST',
            body: { model, messages, stream: false, options: { temperature } },
            timeout
        });
        if (!result.ok) return result;
        const message = result.data && result.data.message;
        return { ok: true, text: message && typeof message.content === 'string' ? message.content.trim() : '' };
    }

    async function embed({ model, input }) {
        const result = await request('/api/embeddings', {
            method: 'POST',
            body: { model, prompt: input },
            timeout: 30000
        });
        if (!result.ok) return result;
        const vector = result.data && result.data.embedding;
        return Array.isArray(vector) ? { ok: true, vector } : { ok: false, error: 'no-embedding' };
    }

    return { baseUrl: root, isRunning, listModels, pullModel, deleteModel, chat, embed };
}

module.exports = { createOllamaClient, isLoopbackUrl, DEFAULT_BASE_URL };
