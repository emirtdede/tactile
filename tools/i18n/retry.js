// Retries keys whose translated value is still identical to English.
//
// The public translation endpoint rate-limits (HTTP 429) and, under load, can
// echo the source text back unchanged. This pass re-requests only the affected
// strings, one at a time, with a backoff, and reports anything that stays
// untranslated so the allowlist in tools/tests/i18n.test.js stays deliberate.
//
// Usage: node tools/i18n/retry.js [--only=de,fr]
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const LOC = path.join(ROOT, 'src', 'locales');
const NEW_KEYS = require('./new-keys.js');
const languages = require(path.join(LOC, 'languages.js'));

const onlyArg = process.argv.find((a) => a.startsWith('--only='));
const only = onlyArg ? new Set(onlyArg.slice(7).split(',')) : null;

const API = { fil: 'tl', he: 'iw', nb: 'no', jv: 'jw' };
const BRANDS = /^(Microsoft OneDrive|Google Drive|Dropbox)$/;

function esc(value) {
    return "'" + String(value)
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/\r?\n/g, '\\n') + "'";
}

function serialize(code, dict) {
    const body = Object.entries(dict)
        .map(([k, v]) => `        ${esc(k)}: ${esc(v)}`)
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

async function apiTranslate(text, code, attempt = 0) {
    const url = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&dt=t'
        + `&tl=${encodeURIComponent(API[code] || code)}&q=${encodeURIComponent(text)}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) {
        if (attempt < 4) {
            await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
            return apiTranslate(text, code, attempt + 1);
        }
        throw new Error(`HTTP ${res.status}`);
    }
    const json = await res.json();
    return (json[0] || []).map((seg) => seg[0]).join('');
}

async function translateWithToken(value, code) {
    if (!value.includes('%s')) return apiTranslate(value, code);
    const parts = value.split('%s');
    const translated = await apiTranslate(parts.join(' __VALUE__ '), code);
    return translated.replace(/\s*__value__\s*/gi, '%s').replace(/\s{2,}/g, ' ').trim();
}

async function main() {
    const en = require(path.join(LOC, 'en.js'));
    const stillIdentical = [];

    for (const { code } of languages) {
        if (code === 'en') continue;
        if (only && !only.has(code)) continue;

        const file = path.join(LOC, `${code}.js`);
        delete require.cache[require.resolve(file)];
        const dict = require(file);

        const pending = Object.keys(NEW_KEYS)
            .filter((key) => !BRANDS.test(String(en[key]).trim()))
            .filter((key) => String(dict[key] || '').trim() === String(en[key]).trim());

        if (!pending.length) continue;

        let changed = false;
        for (const key of pending) {
            let value = '';
            try {
                value = (await translateWithToken(en[key], code)).trim();
            } catch (err) {
                value = '';
            }
            await new Promise((r) => setTimeout(r, 200));
            if (!value) continue;
            const sourceS = (en[key].match(/%s/g) || []).length;
            const outS = (value.match(/%s/g) || []).length;
            if (sourceS !== outS) continue;
            if (value.trim() === String(en[key]).trim()) continue;
            dict[key] = value;
            changed = true;
        }

        if (changed) {
            fs.writeFileSync(file, serialize(code, dict), 'utf8');
            console.log(`${code}: ${pending.length} candidates, updated`);
        }
    }

    // Report leftovers so they can be allowlisted explicitly.
    for (const { code } of languages) {
        if (code === 'en') continue;
        const dict = require(path.join(LOC, `${code}.js`));
        for (const key of Object.keys(NEW_KEYS)) {
            if (BRANDS.test(String(en[key]).trim())) continue;
            if (String(dict[key] || '').trim() === String(en[key]).trim()) {
                stillIdentical.push(`${code}:${key}`);
            }
        }
    }
    fs.writeFileSync(path.join(ROOT, 'i18n-identical.txt'), stillIdentical.join('\n') + '\n', 'utf8');
    console.log(`still identical: ${stillIdentical.length}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
