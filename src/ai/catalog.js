// Local model catalog for the optional AI assistant.
//
// No model ships inside the installer: each entry is pulled on demand through
// the user's own Ollama runtime and can be deleted again. Sizes are the
// download footprint, and minMemoryGB is the RAM the machine should have free
// for the model to stay responsive while Tactile keeps playing sounds.
const { canRunModel } = require('./hardware');

const MODELS = [
    {
        id: 'qwen2.5:0.5b',
        label: 'Qwen 2.5 0.5B',
        sizeGB: 0.4,
        minMemoryGB: 4,
        minTier: 'low',
        description: 'Fastest option. Good for short questions and simple commands.',
        recommendedFor: 'low'
    },
    {
        id: 'qwen2.5:1.5b',
        label: 'Qwen 2.5 1.5B',
        sizeGB: 1.0,
        minMemoryGB: 8,
        minTier: 'medium',
        description: 'Balanced quality and speed for everyday documentation questions.',
        recommendedFor: 'medium'
    },
    {
        id: 'qwen2.5:3b',
        label: 'Qwen 2.5 3B',
        sizeGB: 1.9,
        minMemoryGB: 12,
        minTier: 'high',
        description: 'Best all-round quality for settings help and troubleshooting.',
        recommendedFor: 'high'
    },
    {
        id: 'qwen2.5:7b',
        label: 'Qwen 2.5 7B',
        sizeGB: 4.7,
        minMemoryGB: 16,
        minTier: 'high',
        description: 'Highest quality local answers. Needs a fast disk and plenty of RAM.',
        recommendedFor: 'ultra'
    }
];

const EMBEDDING_MODEL = {
    id: 'nomic-embed-text',
    label: 'Nomic Embed Text',
    sizeGB: 0.27,
    minMemoryGB: 4,
    minTier: 'low',
    description: 'Turns the documentation into searchable vectors for the RAG index.',
    recommendedFor: 'low',
    embedding: true
};

/** All downloadable entries, chat models first. */
function allModels() {
    return [...MODELS, EMBEDDING_MODEL];
}

function findModel(id) {
    return allModels().find((model) => model.id === id) || null;
}

/**
 * Recommendation for a hardware profile. Picks the largest model the machine
 * can run, then falls back to the smallest one so a low-end PC still gets an
 * assistant instead of an empty page.
 */
function recommendedModel(hardware) {
    const runnable = MODELS.filter((model) => canRunModel(hardware, model));
    if (!runnable.length) return MODELS[0];
    return runnable[runnable.length - 1];
}

module.exports = { MODELS, EMBEDDING_MODEL, allModels, findModel, recommendedModel };
