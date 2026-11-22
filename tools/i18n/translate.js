// One-off localization fan-out for new interface keys.
//
// Uses the public Google Translate web endpoint (no API key, no npm package) to
// seed every registered locale, then normalizes the result: long dashes become
// hyphens, emoji are removed, and %s placeholders are preserved exactly.
// Translations are committed as data, so the app never needs network access.
//
// Usage: node tools/i18n/translate.js [--force] [--only=de,fr]
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const LOCALES = path.join(ROOT, 'src', 'locales');
const NEW_KEYS = require('./new-keys.js');
const languages = require(path.join(LOCALES, 'languages.js'));

const force = process.argv.includes('--force');
const onlyArg = process.argv.find((a) => a.startsWith('--only='));
const only = onlyArg ? new Set(onlyArg.slice(7).split(',')) : null;

// Google uses a few legacy/regional tags.
const API = {
    fil: 'tl', he: 'iw', nb: 'no', 'zh-CN': 'zh-CN', 'zh-TW': 'zh-TW',
    sr: 'sr', bs: 'bs', uz: 'uz', jv: 'jw'
};

const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2190}-\u{21FF}\u{2300}-\u{23FF}\u{2460}-\u{24FF}\u{2500}-\u{25FF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{FE00}-\u{FE0F}\u{E0020}-\u{E007F}]/gu;

function normalize(value) {
    return String(value)
        .replace(/\u2014|\u2013/g, '-')
        .replace(EMOJI, '')
        .replace(/[ \t]{2,}/g, ' ')
        .trim();
}

function esc(value) {
    return "'" + String(value)
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/\r?\n/g, '\\n') + "'";
}

function serialize(code, dict) {
    const body = Object.entries(dict)
        .map(([k, v]) => `        ${esc(k)}: ${esc(normalize(v))}`)
        .join(',\n');
    const bracket = code.includes('-') ? `['${code}']` : `.${code}`;
    return `(function (root) {
    const dict = {
${body}
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = dict;
    if (typeof window !== 'undefined') {
        window.TACTILE_LOCALES = window.TACTILE_LOCALES || {};
        window.TACTILE_LOCALES${bracket} = dict;
    }
})(typeof globalThis !== 'undefined' ? globalThis : this);
`;
}

async function translateBatch(text, target, attempt = 0) {
    const url = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&dt=t'
        + `&tl=${encodeURIComponent(API[target] || target)}&q=${encodeURIComponent(text)}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) {
        if (attempt < 3) {
            await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
            return translateBatch(text, target, attempt + 1);
        }
        throw new Error(`translate ${target}: HTTP ${res.status}`);
    }
    const json = await res.json();
    return (json[0] || []).map((seg) => seg[0]).join('');
}

// Translate one value, protecting %s placeholders by translating the pieces.
async function translateValue(value, target) {
    if (!value.includes('%s')) return translateBatch(value, target);
    const parts = value.split('%s');
    const joined = parts.join(' [[[S]]] ');
    const translated = await translateBatch(joined, target);
    return translated.replace(/\s*\[\[\[S\]\]\]\s*/g, '%s');
}

async function main() {
    const enFile = path.join(LOCALES, 'en.js');
    delete require.cache[require.resolve(enFile)];
    const en = { ...require(enFile) };
    for (const [key, value] of Object.entries(NEW_KEYS)) en[key] = normalize(value);
    fs.writeFileSync(enFile, serialize('en', en), 'utf8');

    const codes = languages.map((l) => l.code).filter((c) => c !== 'en' && (!only || only.has(c)));
    for (const code of codes) {
        const file = path.join(LOCALES, `${code}.js`);
        delete require.cache[require.resolve(file)];
        const dict = require(file);
        const missing = Object.keys(NEW_KEYS).filter((k) => force || !(k in dict));
        if (!missing.length) continue;

        let added = 0;
        for (let start = 0; start < missing.length; start += 20) {
            const chunk = missing.slice(start, start + 20);
            let pieces = null;
            try {
                const joined = await translateBatch(
                    chunk.map((k) => normalize(NEW_KEYS[k])).join('\n'), code);
                const lines = joined.split('\n');
                if (lines.length === chunk.length && lines.every((l) => l.trim())) {
                    pieces = lines.map((l) => l.trim());
                }
            } catch (err) {
                console.error(code, err.message);
            }

            // Fall back to one request per string: a few scripts drop line breaks.
            if (!pieces) {
                pieces = [];
                for (const key of chunk) {
                    try {
                        pieces.push((await translateValue(normalize(NEW_KEYS[key]), code)).trim());
                        await new Promise((r) => setTimeout(r, 120));
                    } catch (err) {
                        pieces.push('');
                    }
                }
            }

            chunk.forEach((key, i) => {
                let value = normalize(pieces[i] || '');
                if (!value) value = normalize(NEW_KEYS[key]);
                const sourceS = (NEW_KEYS[key].match(/%s/g) || []).length;
                const outS = (value.match(/%s/g) || []).length;
                if (sourceS !== outS) value = normalize(NEW_KEYS[key]);
                dict[key] = value;
                added += 1;
            });
        }

        // Keep canonical order: existing keys first, then any declared keys.
        const ordered = {};
        for (const key of Object.keys(en)) if (key in dict) ordered[key] = dict[key];
        fs.writeFileSync(file, serialize(code, ordered), 'utf8');
        console.log(`${code}: +${added}`);
        await new Promise((r) => setTimeout(r, 150));
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
