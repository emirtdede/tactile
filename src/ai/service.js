// Optional local assistant service.
//
// Owns the hardware profile, the Ollama client and the documentation index so
// the IPC layer stays a thin translation of settings into plain data. Nothing
// here touches the network unless the user installs or runs a model: search is
// fully local and works before any download.
const os = require('os');
const path = require('path');
const { profileHardware, canRunModel } = require('./hardware');
const { allModels, findModel, recommendedModel } = require('./catalog');
const { createOllamaClient } = require('./ollama');
const { createAssistant } = require('./assistant');

const RUNTIME_URL = 'http://127.0.0.1:11434';

function createAiService({
    userDataPath,
    docsDir,
    getSetting,
    setSetting,
    logger = console,
    onProgress = () => {}
}) {
    const hardware = profileHardware({ cpus: os.cpus(), totalmem: os.totalmem() });
    const ollama = createOllamaClient({ baseUrl: RUNTIME_URL, logger });
    const assistant = createAssistant({
        docsDir,
        cachePath: path.join(userDataPath, 'ai-index.json'),
        ollama,
        logger
    });

    function enabled() {
        return getSetting('ai_enabled') === 'true';
    }

    function selectedModel() {
        return getSetting('ai_model') || '';
    }

    async function installedModelIds() {
        const result = await ollama.isRunning();
        if (!result.running) return [];
        return result.models
            .map((model) => String((model && (model.name || model.model)) || ''))
            .filter(Boolean);
    }

    async function status() {
        const running = await ollama.isRunning();
        const installed = running.running
            ? running.models.map((model) => String((model && (model.name || model.model)) || '')).filter(Boolean)
            : [];
        const recommendation = recommendedModel(hardware);
        const rag = assistant.status();

        return {
            enabled: enabled(),
            model: selectedModel(),
            runtime: {
                url: RUNTIME_URL,
                running: running.running,
                installed: running.running
            },
            hardware,
            recommended: recommendation ? recommendation.id : '',
            catalog: allModels().map((model) => ({
                ...model,
                installed: installed.includes(model.id),
                runnable: canRunModel(hardware, model)
            })),
            installed,
            rag: {
                enabled: getSetting('ai_rag') !== 'false',
                documents: rag.documents,
                chunks: rag.chunks,
                builtAt: rag.builtAt
            }
        };
    }

    function search(query, limit = 6) {
        return assistant.search(String(query || ''), { limit });
    }

    async function ask(question) {
        if (!enabled()) {
            return { answer: '', sources: [], error: 'disabled' };
        }
        const useState = getSetting('ai_rag') !== 'false';
        if (!useState) {
            // RAG off still answers from the model, just without documentation
            // context; a missing runtime is reported instead of guessed.
            const response = await ollama.chat({
                model: selectedModel(),
                messages: [{ role: 'user', content: String(question || '').slice(0, 2000) }]
            });
            if (!response.ok) {
                return { answer: 'The local model did not answer. Check that Ollama is running and the selected model is installed.', sources: [], error: response.error || 'model-error' };
            }
            return { answer: response.text, sources: [], model: selectedModel() };
        }
        return assistant.ask(question, { model: selectedModel() });
    }

    async function toggle(next) {
        const value = next === true || next === 'true' ? 'true' : 'false';
        setSetting('ai_enabled', value);
        return status();
    }

    async function pull(modelId) {
        const model = findModel(modelId);
        if (!model) return { success: false, error: 'unknown-model' };
        if (!canRunModel(hardware, model)) return { success: false, error: 'insufficient-hardware' };
        const result = await ollama.pullModel(model.id, (progress) => onProgress({ model: model.id, ...progress }));
        if (result.success) {
            setSetting('ai_model', model.embedding ? (selectedModel() || '') : model.id);
        }
        return result;
    }

    async function remove(modelId) {
        const model = findModel(modelId);
        if (!model) return { success: false, error: 'unknown-model' };
        const result = await ollama.deleteModel(model.id);
        if (result.success && selectedModel() === model.id) setSetting('ai_model', '');
        return result;
    }

    function reindex() {
        assistant.reindex();
        return status();
    }

    return {
        status,
        search,
        ask,
        toggle,
        pull,
        remove,
        reindex,
        installedModelIds,
        hardware,
        paths: { docsDir, cachePath: path.join(userDataPath, 'ai-index.json') }
    };
}

module.exports = { createAiService, RUNTIME_URL };
