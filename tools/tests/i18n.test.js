'use strict';

/**
 * i18n guarantees:
 *  - exactly 73 supported languages, each with a complete locale file
 *  - every locale covers the canonical English key set with non-empty values
 *  - no locale silently falls back to English text (language leak)
 *  - placeholders (%s) survive translation
 *  - the renderer loads every locale and builds the picker from the registry
 *  - app.html ships no hardcoded interface text
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

const I18N = require(path.join(ROOT, 'src', 'i18n.js'));
const LANGUAGES = require(path.join(ROOT, 'src', 'locales', 'languages.js'));
const APP_HTML = read('src', 'app.html');
const APP_JS = read('src', 'app.js');
const MAIN_JS = read('src', 'main.js');
const EN = I18N.translations.en;

const TARGET_LANGUAGES = 73;

// Keys whose value may legitimately be spelled exactly like English:
// international loanwords / cognates / universal abbreviations.
const IDENTICAL_TO_ENGLISH_ALLOWED = new Set([
    'switch.linear',
    'switch.tactile',
    'switch.clicky',
    'dialog.ok',
    'modal.ok',
    'about.version',
    'modal.description',
    'dialog.notification',
    'modal.material',
    'toolbar.volume',
    'about.website',
    'settings.icon_dark',
    'settings.icon_light',
    'about.copyright',
    // Cloud product names are brands and never translated.
    'cloud.provider_onedrive',
    'cloud.provider_googledrive',
    'cloud.provider_dropbox'
]);

// Per-language cognates: the correct translation really is spelled like English.
const IDENTICAL_PAIRS_ALLOWED = new Set([
    'es:settings.general',
    'es:about.legal',
    'pt:about.legal',
    // Native cognates introduced with the v1.0.0 interface.
    'af:sidebar.status',
    'az:settings.section_general',
    'bs:sidebar.status',
    'ca:sidebar.categories',
    'ca:sidebar.categories_count',
    'ca:settings.section_general',
    'da:sidebar.status',
    'da:diag.system',
    'da:diag.db',
    'de:sidebar.status',
    'de:diag.system',
    'de:diag.version',
    'es:settings.section_general',
    'fil:diag.db',
    'fr:nav.documents',
    'fr:nav.diagnostics',
    'fr:nav.application',
    'fr:docs.title',
    'fr:diag.title',
    'fr:diag.app',
    'fr:diag.version',
    'fr:about.docs',
    'fr:tray.docs',
    'hr:sidebar.status',
    'id:sidebar.status',
    'it:diag.db',
    'ms:sidebar.status',
    'nb:sidebar.status',
    'nb:diag.system',
    'nb:diag.db',
    'nl:sidebar.status',
    'nl:diag.db',
    'pt:sidebar.status',
    'sl:sidebar.status',
    'sv:sidebar.status',
    'sv:diag.system',
    'sv:diag.version',
    'uz:sidebar.status',
    'uz:settings.section_general',
    // Integration and assistant terms that are international loanwords in the
    // locale (webhook, CLI, MCP, port, URL) or are spelled identically by rule.
    'af:int.api_port',
    'af:int.webhook',
    'az:int.mcp',
    'az:int.cli',
    'bs:int.api_port',
    'bs:int.mcp',
    'bs:int.cli',
    'bs:int.webhook',
    'ca:int.api_port',
    'ca:int.cli',
    'ca:int.webhook',
    'cs:int.api_port',
    'cs:int.mcp',
    'da:ai.model_download',
    'da:int.mcp',
    'da:int.cli',
    'da:int.webhook',
    'de:int.webhook',
    'el:int.webhook',
    'es:int.cli',
    'et:int.api_port',
    'et:int.mcp',
    'eu:int.cli',
    'fi:int.webhook',
    'fil:int.api_port',
    'fil:int.mcp',
    'fil:int.cli',
    'fr:ai.sources',
    'fr:int.api_port',
    'fr:int.webhook',
    'ha:int.api_port',
    'ha:int.webhook',
    'he:int.webhook',
    'hu:int.api_port',
    'id:int.cli',
    'ig:int.api_port',
    'ig:int.webhook',
    'lo:int.cli',
    'lo:int.webhook',
    'lt:int.webhook',
    'mn:int.webhook',
    'ms:int.cli',
    'ms:int.webhook',
    'my:int.cli',
    'my:int.webhook',
    'nb:int.api_port',
    'nb:int.cli',
    'nb:int.webhook',
    'nb:int.url',
    'nb:int.test',
    'pt:int.cli',
    'pt:int.webhook',
    'ro:int.api_port',
    'ro:int.cli',
    'si:int.webhook',
    'sk:int.api_port',
    'sl:int.cli',
    'sl:int.webhook',
    'sq:int.api_port',
    'sv:int.api_port',
    'sv:int.cli',
    'sv:int.webhook',
    'uz:int.api_port',
    'yo:int.webhook',
]);

test(`the app declares exactly ${TARGET_LANGUAGES} languages`, () => {
    assert.strictEqual(LANGUAGES.length, TARGET_LANGUAGES);
    const codes = LANGUAGES.map((lang) => lang.code);
    assert.strictEqual(new Set(codes).size, codes.length, 'language codes must be unique');
    for (const lang of LANGUAGES) {
        assert.ok(/^[a-z]{2,3}(-[A-Z]{2})?$/.test(lang.code), `bad code: ${lang.code}`);
        assert.ok(lang.name && lang.english, `missing metadata for ${lang.code}`);
        assert.strictEqual(typeof lang.rtl, 'boolean');
    }
});

test('every declared language has a locale file and is loaded', () => {
    const missing = LANGUAGES
        .map((lang) => lang.code)
        .filter((code) => !fs.existsSync(path.join(ROOT, 'src', 'locales', `${code}.js`)) || !I18N.translations[code]);
    assert.deepStrictEqual(missing, [], `Missing locale files: ${missing.join(', ')}`);
});

test('every locale defines exactly the canonical English key set', () => {
    const expected = Object.keys(EN).sort();
    const problems = [];
    for (const code of Object.keys(I18N.translations)) {
        const keys = Object.keys(I18N.translations[code]).sort();
        const missing = expected.filter((key) => !keys.includes(key));
        const extra = keys.filter((key) => !expected.includes(key));
        if (missing.length) problems.push(`${code} missing: ${missing.join(', ')}`);
        if (extra.length) problems.push(`${code} extra: ${extra.join(', ')}`);
    }
    assert.deepStrictEqual(problems, []);
});

test('no locale leaves an empty value', () => {
    const problems = [];
    for (const [code, dict] of Object.entries(I18N.translations)) {
        for (const [key, value] of Object.entries(dict)) {
            if (typeof value !== 'string' || value.trim() === '') problems.push(`${code}: ${key}`);
        }
    }
    assert.deepStrictEqual(problems, []);
});

test('no locale silently ships English text', () => {
    const leaks = [];
    for (const [code, dict] of Object.entries(I18N.translations)) {
        if (code === 'en') continue;
        for (const [key, value] of Object.entries(dict)) {
            if (IDENTICAL_TO_ENGLISH_ALLOWED.has(key)) continue;
            if (IDENTICAL_PAIRS_ALLOWED.has(`${code}:${key}`)) continue;
            if (value === EN[key]) leaks.push(`${code}: ${key} = "${value}"`);
        }
    }
    assert.deepStrictEqual(leaks, [], `Untranslated strings:\n${leaks.join('\n')}`);
});

test('placeholders survive translation', () => {
    const problems = [];
    const placeholders = (text) => (text.match(/%s/g) || []).length;
    for (const [code, dict] of Object.entries(I18N.translations)) {
        for (const [key, value] of Object.entries(dict)) {
            if (placeholders(value) !== placeholders(EN[key])) {
                problems.push(`${code}: ${key}`);
            }
        }
    }
    assert.deepStrictEqual(problems, []);
});

test('every locale keeps its HTML markup well-formed', () => {
    const problems = [];
    for (const [code, dict] of Object.entries(I18N.translations)) {
        for (const key of ['legal.terms_body', 'legal.privacy_body', 'legal.licenses_body']) {
            const body = dict[key];
            for (const tag of ['p', 'h4', 'ul', 'li', 'strong']) {
                const open = (body.match(new RegExp(`<${tag}>`, 'g')) || []).length;
                const close = (body.match(new RegExp(`</${tag}>`, 'g')) || []).length;
                if (open !== close) problems.push(`${code}: ${key} <${tag}> ${open}/${close}`);
            }
        }
    }
    assert.deepStrictEqual(problems, []);
});

test('app.html loads every locale before the i18n engine', () => {
    const tags = [...APP_HTML.matchAll(/<script src="\.\/locales\/([a-z0-9A-Z-]+)\.js"><\/script>/g)].map((m) => m[1]);
    const expected = ['languages', ...LANGUAGES.map((lang) => lang.code)];
    assert.deepStrictEqual(tags, expected, 'locale script tags must match the registry exactly');
    assert.ok(
        APP_HTML.indexOf('<script src="./i18n.js"></script>') > APP_HTML.indexOf('<script src="./locales/languages.js"></script>'),
        'i18n.js must load after the locale scripts'
    );
});

test('the language picker is generated from the registry, not hardcoded', () => {
    const select = APP_HTML.match(/<select id="setting-lang"[^>]*>([\s\S]*?)<\/select>/);
    assert.ok(select, 'language select not found');
    assert.strictEqual(select[1].trim(), '', 'the select must not contain hardcoded options');
    assert.ok(/getAvailableLanguages\(\)/.test(APP_JS), 'app.js must build the options from getAvailableLanguages()');
    assert.ok(/isSupportedLang\(nextLang\)/.test(APP_JS), 'the change handler must validate the code');
    assert.ok(/resolveLanguage\(settings\.language\)/.test(APP_JS), 'the saved language must be validated on boot');
});

// A new install must never open in a language the user cannot read. The seed is
// empty and both processes resolve it from the OS locale, so detection has to be
// exercised directly rather than assumed.
test('first launch follows the OS locale instead of a hardcoded language', () => {
    const fsSource = read('src', 'db', 'database.js');
    const seed = fsSource.match(/language:\s*'([^']*)'/);
    assert.ok(seed, 'the seeded language must be declared');
    assert.strictEqual(seed[1], '', 'the seed must stay empty so the OS locale decides');
    assert.ok(/resolveLanguage\(/.test(MAIN_JS), 'main.js must resolve the stored language at boot');
    assert.ok(!/\|\|\s*'tr'/.test(MAIN_JS), 'no boot path may fall back to a hardcoded locale');

    // Region and script variants collapse onto the closest supported locale.
    assert.strictEqual(I18N.detectSystemLanguage('tr-TR'), 'tr');
    assert.strictEqual(I18N.detectSystemLanguage('de-AT'), 'de');
    assert.strictEqual(I18N.detectSystemLanguage('pt_BR'), 'pt');
    assert.strictEqual(I18N.detectSystemLanguage('zh-TW'), 'zh-TW');
    assert.strictEqual(I18N.detectSystemLanguage('zh-CN'), 'zh-CN');
    assert.strictEqual(I18N.detectSystemLanguage('zh-Hant-TW'), 'zh-TW');
    assert.strictEqual(I18N.detectSystemLanguage('en-US'), 'en');

    // Unknown or missing locales land on English, never on an arbitrary language.
    assert.strictEqual(I18N.detectSystemLanguage('xx-YY'), 'en');
    assert.strictEqual(I18N.detectSystemLanguage('klingon'), 'en');
    // With no explicit locale the environment decides, and the result is always valid.
    assert.strictEqual(I18N.detectSystemLanguage(''), I18N.detectSystemLanguage());
    assert.ok(I18N.isSupportedLang(I18N.detectSystemLanguage()));

    assert.strictEqual(I18N.resolveLanguage('ja'), 'ja');
    assert.ok(I18N.isSupportedLang(I18N.resolveLanguage('')));
    assert.ok(I18N.isSupportedLang(I18N.resolveLanguage('klingon')));
});

test('the main process accepts every supported language code', () => {
    assert.ok(
        /language:\s*\(value\)\s*=>\s*\(isSupportedLang\(value\)\s*\?\s*value\s*:\s*null\)/.test(MAIN_JS),
        'SETTING_NORMALIZERS.language must use isSupportedLang'
    );
});

test('RTL languages switch the document direction', () => {
    const rtl = LANGUAGES.filter((lang) => lang.rtl).map((lang) => lang.code);
    assert.ok(rtl.includes('ar') && rtl.includes('he') && rtl.includes('fa') && rtl.includes('ur'));
    assert.ok(/RTL_LANGS/.test(read('src', 'i18n.js')), 'i18n must know which locales are RTL');
    assert.ok(/applyDocumentLanguage\(\)/.test(read('src', 'i18n.js')), 'document language/direction helper missing');
    assert.ok(/dir = /.test(read('src', 'i18n.js')));
});

test('app.html has no hardcoded interface text', () => {
    const NON_TRANSLATABLE = new Set([
        'Tactile', 'Vellium.dev', 'vellium.dev', 'vellium.dev/terms',
        'PBT', 'ABS', 'Mixed', 'MIT', '❯'
    ]);
    const stripped = APP_HTML
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<script[\s\S]*?<\/script>/g, '');
    const leaks = [];
    stripped.split(/\r?\n/).forEach((line, index) => {
        for (const match of line.matchAll(/>([^<>]+)</g)) {
            const text = match[1].trim();
            if (!text || NON_TRANSLATABLE.has(text)) continue;
            if (/^[&;+\-\u2013\u2014\u2022\u00b7%\u00d7\u2715\u271a\u2699\u00ab\u00bb()\d\s]+$/.test(text)) continue;
            const before = line.slice(0, match.index + 1);
            const tag = before.slice(before.lastIndexOf('<'));
            if (/data-i18n(-html|-placeholder|-title|-aria-label)?=/.test(tag)) continue;
            leaks.push(`line ${index + 1}: ${text}`);
        }
    });
    assert.deepStrictEqual(leaks, [], `Hardcoded text:\n${leaks.join('\n')}`);
});

// A placeholder/title/aria-label is applied only when the lookup differs from the
// key, so a stale non-English fallback stays on screen until the first apply and
// leaks into every locale when a key is ever missing. Attribute fallbacks must
// therefore be empty or exactly the English source string.
test('app.html attribute fallbacks are empty or match the English source', () => {
    const problems = [];
    const NON_TRANSLATABLE = new Set(['Tactile', 'Vellium.dev', 'vellium.dev']);

    for (const [index, line] of APP_HTML.split(/\r?\n/).entries()) {
        for (const match of line.matchAll(/(?<!data-i18n-)(placeholder|title|aria-label)="([^"]*)"/g)) {
            const attr = match[1];
            const value = match[2].trim();
            if (!value) continue;
            if (NON_TRANSLATABLE.has(value)) continue;

            // The tag must carry a matching hook, or the value is a hardcoded string.
            const tagStart = line.lastIndexOf('<', match.index);
            const tagEnd = line.indexOf('>', match.index);
            const tag = line.slice(tagStart, tagEnd === -1 ? line.length : tagEnd + 1);
            const hook = tag.match(new RegExp(`data-i18n-${attr}="([^"]+)"`));

            if (!hook) {
                problems.push(`line ${index + 1}: ${attr}="${value}" has no data-i18n-${attr}`);
                continue;
            }
            if (value !== (EN[hook[1]] ?? '').trim()) {
                problems.push(`line ${index + 1}: ${attr}="${value}" is not the English "${hook[1]}"`);
            }
        }
    }

    assert.deepStrictEqual(problems, [], `Stale attribute fallbacks:\n${problems.join('\n')}`);
});

// `alt` is read aloud by screen readers, so English alt text is a real leak even
// though it is invisible. It has no data-i18n hook, so it must be empty or a
// brand name only: "Tactile Logo" / "Vellium Logo" used to ship untranslated.
test('app.html alt text is empty or a brand name, never English prose', () => {
    const BRAND_ALT = new Set(['Tactile', 'Vellium.dev', 'vellium.dev']);
    const problems = [];

    for (const [index, line] of APP_HTML.split(/\r?\n/).entries()) {
        for (const match of line.matchAll(/\balt="([^"]*)"/g)) {
            const value = match[1].trim();
            if (!value) continue;
            if (BRAND_ALT.has(value)) continue;
            problems.push(`line ${index + 1}: alt="${value}"`);
        }
    }

    assert.deepStrictEqual(problems, [], `Untranslated alt text:\n${problems.join('\n')}`);
});

// Same reasoning for element text: applyTranslations() only rewrites a node when
// the lookup differs from the key, so a leftover translation in another language
// is painted before the first apply. Text inside a data-i18n element must be
// empty or exactly the English source.
test('app.html text fallbacks are empty or match the English source', () => {
    const problems = [];
    const encode = (value) => value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    const decode = (value) => value
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, '&');

    const clean = APP_HTML
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<script[\s\S]*?<\/script>/g, '');

    for (const match of clean.matchAll(/<([a-zA-Z0-9-]+)([^>]*)>([^<]*)/g)) {
        const attrs = match[2];
        const inner = match[3].trim();
        if (!inner) continue;

        const hook = attrs.match(/(?<!-)\bdata-i18n="([^"]+)"/);
        if (!hook) continue;

        const expected = (EN[hook[1]] ?? '').trim();
        if (!expected) continue;
        if (decode(inner) === decode(encode(expected))) continue;

        const line = clean.slice(0, match.index).split(/\r?\n/).length;
        problems.push(`line ${line}: [${hook[1]}] "${inner}" is not "${expected}"`);
    }

    assert.deepStrictEqual(problems, [], `Stale text fallbacks:\n${problems.join('\n')}`);
});

// A full-string comparison only catches a value that is *entirely* English.
// The more common leak is an untranslated phrase embedded in an otherwise
// translated value (e.g. "Belata Gaa na Tray", "Malalim na sound signature").
// Any run of three or more consecutive English source words surviving verbatim
// is treated as a leak, except for proper nouns and library names.
test('no locale leaves an untranslated English phrase inside a translated value', () => {
    const NEUTRAL = new Set([
        'tactile', 'vellium', 'dev', 'tactile-bg', 'tactile-light', 'cherry', 'blue',
        'click', 'enter', 'backspace', 'ctrl', 'alt', 'shift', 'esc', 'tab', 'delete',
        'space', 'howler', 'js', 'mit', 'apache', 'electron', 'sql', 'uiohook', 'napi',
        'sharp', 'fs', 'extra', 'builder', 'apple', 'microsoft', 'corporation', 'eula',
        'copyright', 'premium', 'pbt', 'abs', 'mixed', 'pom', 'windows', 'macos', 'linux',
        // Integration and assistant vocabulary that stays in Latin script inside
        // otherwise translated sentences (product names, protocol names, units).
        'loopback', 'rest', 'api', 'model', 'context', 'protocol', 'zapier', 'make',
        'n8n', 'n', 'webhook', 'webhooks', 'cli', 'mcp', 'ollama', 'index', 'gb', 'ram',
        'server', 'terminal', 'local',
        // Cognates: the correct French wording really is spelled like English.
        'contact', 'questions'
    ]);
    const words = (text) => (String(text)
        .replace(/<[^>]+>/g, ' ')
        .replace(/&[a-z]+;/gi, ' ')
        // Email addresses and URLs are brand data, not translatable prose, and
        // must be removed before tokenizing or "support@vellium.dev" would break
        // into "support vellium dev" and look like an English phrase.
        .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/g, ' ')
        .replace(/https?:\/\/\S+/g, ' ')
        // Placeholders are tokens of the format string, not source words: "%s
        // documents" used to tokenize as "s documents" and look like a leak.
        .replace(/%s/g, ' ')
        .match(/[A-Za-z][A-Za-z'-]*/g) || []).map((word) => word.toLowerCase());

    const leaks = [];
    for (const [code, dict] of Object.entries(I18N.translations)) {
        if (code === 'en') continue;
        for (const [key, translated] of Object.entries(dict)) {
            const source = EN[key];
            if (!source) continue;

            const sourceWords = words(source);
            const targetWords = words(translated);
            const sourceJoined = ` ${sourceWords.join(' ')} `;

            for (let i = 0; i < targetWords.length; i += 1) {
                for (let j = 0; j < sourceWords.length; j += 1) {
                    let run = 0;
                    while (
                        targetWords[i + run] && sourceWords[j + run] &&
                        targetWords[i + run] === sourceWords[j + run]
                    ) run += 1;
                    if (run < 3) continue;

                    const phrase = targetWords.slice(i, i + run);
                    if (!sourceJoined.includes(` ${phrase.join(' ')} `)) continue;
                    if (phrase.every((word) => NEUTRAL.has(word))) continue;
                    leaks.push(`${code}: ${key} keeps "${phrase.join(' ')}"`);
                }
            }
        }
    }

    assert.deepStrictEqual([...new Set(leaks)], [], `Untranslated phrases:\n${[...new Set(leaks)].join('\n')}`);
});

// The phrase test above deliberately treats single words like "copyright" as
// neutral so brand/licence sentences do not flood it. That blind spot let the
// English word "Copyright" survive in about.copyright for 25 locales across two
// rounds, because the rest of the value (year, brand, "all rights reserved") was
// translated and no assertion looked at the leading noun on its own.
test('about.copyright is translated in every locale', () => {
    const ENGLISH = /(^|[^A-Za-z])copyright([^A-Za-z]|$)/i;
    const leaks = [];

    for (const [code, dict] of Object.entries(I18N.translations)) {
        if (code === 'en') continue;
        const value = String(dict['about.copyright'] || '');
        if (ENGLISH.test(value)) leaks.push(`${code}: "${value.replace(/\s+/g, ' ').trim()}"`);
    }

    assert.deepStrictEqual(leaks, [], `about.copyright still says Copyright:\n${leaks.join('\n')}`);
});
