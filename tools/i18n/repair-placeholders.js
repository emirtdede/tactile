// Repairs the %s placeholders across every locale.
//
// The first bulk pass protected placeholders with markers that the public
// translation endpoint sometimes rewrote (transliterated, quoted or dropped),
// which left strings like "Version%s ist verfügbar" or "La%stáctica ..." with
// text eaten around the marker.
//
// This pass retranslates every %s string using a punctuation marker ("«0»")
// that the endpoint preserves, then restores %s and normalizes spacing for the
// target script (CJK, Thai, Khmer, Lao and Burmese do not separate words).
//
// Usage: node tools/i18n/repair-placeholders.js [--only=de,fr]
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const LOC = path.join(ROOT, 'src', 'locales');
const languages = require(path.join(LOC, 'languages.js'));

const onlyArg = process.argv.find((a) => a.startsWith('--only='));
const only = onlyArg ? new Set(onlyArg.slice(7).split(',')) : null;

const API = { fil: 'tl', he: 'iw', nb: 'no', jv: 'jw' };
const NO_SPACE = new Set(['ja', 'zh-CN', 'zh-TW', 'th', 'km', 'lo', 'my']);
const MARKER = '\u00AB0\u00BB';
const MARKER_RE = /[\u00AB\u00BB\u201C\u201D\u201E"]\s*0\s*[\u00AB\u00BB\u201C\u201D\u201E"]|[\u00AB\u00BB\u201C\u201D\u201E"]?0[\u00AB\u00BB\u201C\u201D\u201E"]/g;

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

function normalizeSpacing(text, code) {
    let value = text.replace(/[ \t]{2,}/g, ' ').trim();
    if (NO_SPACE.has(code)) {
        value = value.replace(/\s+%s/g, '%s').replace(/%s\s+/g, '%s');
        return value;
    }
    value = value.replace(/\s+%s/g, ' %s').replace(/%s\s+/g, '%s ');
    // A placeholder directly after an opening bracket or before punctuation
    // does not need a leading space.
    value = value.replace(/([(\[{/:])\s+%s/g, '$1 %s').replace(/%s\s+([)\]}.,;:!?/])/g, '%s$1');
    return value.trim();
}

async function apiTranslate(text, code, attempt = 0) {
    const url = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&dt=t'
        + `&tl=${encodeURIComponent(API[code] || code)}&q=${encodeURIComponent(text)}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) {
        if (attempt < 4) {
            await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
            return apiTranslate(text, code, attempt + 1);
        }
        throw new Error(`HTTP ${res.status}`);
    }
    const json = await res.json();
    return (json[0] || []).map((seg) => seg[0]).join('');
}

async function main() {
    const en = require(path.join(LOC, 'en.js'));
    const placeholderKeys = Object.keys(en).filter((key) => String(en[key]).includes('%s'));

    for (const { code } of languages) {
        if (only && !only.has(code)) continue;
        const file = path.join(LOC, `${code}.js`);
        delete require.cache[require.resolve(file)];
        const dict = require(file);

        let changed = 0;
        for (const key of placeholderKeys) {
            const source = String(en[key]);
            if (code === 'en') continue;

            const marked = source.split('%s').join(` ${MARKER} `);
            let translated;
            try {
                translated = await apiTranslate(marked, code);
            } catch (err) {
                console.error(`${code} ${key}: ${err.message}`);
                continue;
            }
            await new Promise((r) => setTimeout(r, 180));

            const expected = (source.match(/%s/g) || []).length;
            let replaced = translated.replace(MARKER_RE, '%s');
            const produced = (replaced.match(/%s/g) || []).length;
            if (produced !== expected) {
                console.error(`${code} ${key}: marker lost (got ${produced}, want ${expected})`);
                continue;
            }

            replaced = normalizeSpacing(replaced, code);
            if (!replaced || replaced === source) continue;
            dict[key] = replaced;
            changed += 1;
        }

        if (changed) {
            fs.writeFileSync(file, serialize(code, dict), 'utf8');
            console.log(`${code}: ${changed}/${placeholderKeys.length}`);
        }
    }
}

main().catch((err) => { console.error(err); process.exit(1); });
