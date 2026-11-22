// Retrieval index for the local documentation assistant (RAG).
//
// The corpus is the Markdown set in docs/ plus the in-app feature guide. It is
// small (well under a megabyte), so a deterministic lexical index is enough:
// no embedding server, no network, no model download is required for search to
// work. When the user installs the embedding model, `searchHybrid` re-ranks the
// same chunks with cosine similarity for better recall on paraphrased questions.
const STOPWORDS = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'if', 'then', 'than', 'that', 'this', 'these', 'those',
    'is', 'are', 'was', 'were', 'be', 'been', 'being', 'am', 'do', 'does', 'did', 'done',
    'i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'him', 'her', 'us', 'them',
    'my', 'your', 'his', 'its', 'our', 'their', 'mine', 'yours', 'ours', 'theirs',
    'to', 'of', 'in', 'on', 'at', 'by', 'for', 'with', 'about', 'from', 'into', 'over',
    'how', 'what', 'when', 'where', 'which', 'who', 'why', 'can', 'could', 'should',
    'would', 'will', 'shall', 'may', 'might', 'must', 'not', 'no', 'yes', 'as', 'so',
    'there', 'here', 'have', 'has', 'had', 'also', 'just', 'very', 'more', 'most'
]);

function tokenize(text) {
    return String(text || '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .split(' ')
        .map((word) => word.trim())
        .filter((word) => word.length > 1 && !STOPWORDS.has(word));
}

/** Split Markdown into heading-aware chunks that stay under `maxChars`. */
function chunkMarkdown(text, { maxChars = 900, minChars = 80 } = {}) {
    const source = String(text || '').replace(/\r\n/g, '\n');
    const lines = source.split('\n');
    const chunks = [];
    let heading = '';
    let buffer = [];

    const flush = () => {
        const body = buffer.join('\n').trim();
        if (body.length >= minChars) {
            chunks.push({ heading, text: body });
        }
        buffer = [];
    };

    for (const line of lines) {
        const match = /^(#{1,4})\s+(.*)$/.exec(line);
        if (match) {
            flush();
            heading = match[2].trim();
            continue;
        }
        buffer.push(line);
        if (buffer.join('\n').length >= maxChars) flush();
    }
    flush();

    // A document with no headings at all still becomes one chunk.
    if (chunks.length === 0) {
        const body = source.trim();
        if (body) chunks.push({ heading: '', text: body.slice(0, maxChars) });
    }
    return chunks;
}

/**
 * Build the index. `documents` is [{ id, title, text, url? }]. Each chunk keeps
 * its document id, title and a stable chunk id so a result can deep link back.
 */
function buildIndex(documents, options = {}) {
    const entries = [];
    for (const doc of documents || []) {
        if (!doc || typeof doc.text !== 'string') continue;
        const chunks = chunkMarkdown(doc.text, options);
        chunks.forEach((chunk, position) => {
            entries.push({
                id: `${doc.id}#${position}`,
                docId: doc.id,
                title: doc.title || doc.id,
                heading: chunk.heading,
                url: doc.url || '',
                text: chunk.text
            });
        });
    }

    const df = Object.create(null);
    const postings = entries.map((entry) => {
        const tokens = tokenize(`${entry.title} ${entry.heading} ${entry.text}`);
        const tf = Object.create(null);
        for (const token of tokens) tf[token] = (tf[token] || 0) + 1;
        for (const token of Object.keys(tf)) df[token] = (df[token] || 0) + 1;
        return tf;
    });

    return {
        version: 1,
        builtAt: new Date().toISOString(),
        documents: (documents || []).length,
        entries,
        postings,
        df,
        avgLength: entries.length
            ? postings.reduce((sum, tf) => sum + Object.values(tf).reduce((a, b) => a + b, 0), 0) / entries.length
            : 0
    };
}

function bm25(index, query, limit = 6) {
    const terms = tokenize(query);
    if (!index || !Array.isArray(index.entries) || terms.length === 0) return [];
    const total = index.entries.length;
    const k1 = 1.4;
    const b = 0.75;
    const scored = [];

    index.postings.forEach((tf, position) => {
        const length = Object.values(tf).reduce((a, c) => a + c, 0) || 1;
        let score = 0;
        for (const term of terms) {
            const frequency = tf[term];
            if (!frequency) continue;
            const docsWithTerm = index.df[term] || 0;
            const idf = Math.log(1 + (total - docsWithTerm + 0.5) / (docsWithTerm + 0.5));
            const denominator = frequency + k1 * (1 - b + b * (length / (index.avgLength || 1)));
            score += idf * ((frequency * (k1 + 1)) / denominator);
        }
        if (score > 0) scored.push({ entry: index.entries[position], score });
    });

    scored.sort((a, b2) => b2.score - a.score);
    return scored.slice(0, limit);
}

function cosine(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length === 0 || a.length !== b.length) return 0;
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i += 1) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Combines the lexical ranking with an embedding ranking. Vectors are optional:
 * a missing vector for a chunk simply contributes nothing, so the result is
 * still useful before the embedding model is installed.
 */
function searchHybrid(index, query, { queryVector = null, limit = 6, vectors = {} } = {}) {
    const lexical = new Map(bm25(index, query, limit * 3).map((hit) => [hit.entry.id, hit.score]));
    const results = [];

    for (const entry of (index && index.entries) || []) {
        const lexicalScore = lexical.get(entry.id) || 0;
        const vectorScore = queryVector ? cosine(queryVector, vectors[entry.id]) : 0;
        const score = lexicalScore + vectorScore * 2;
        if (score > 0) results.push({ entry, score, lexicalScore, vectorScore });
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
}

/** Compact context block handed to the model, with numbered sources. */
function buildContext(hits) {
    return (hits || [])
        .map((hit, position) => {
            const entry = hit.entry || hit;
            const where = entry.heading ? `${entry.title} / ${entry.heading}` : entry.title;
            return `[${position + 1}] ${where}\n${entry.text}`;
        })
        .join('\n\n');
}

module.exports = { tokenize, chunkMarkdown, buildIndex, bm25, cosine, searchHybrid, buildContext };
