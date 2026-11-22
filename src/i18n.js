// Tactile i18n Engine - lightweight internationalization module.
// Locale data lives in ./locales/<code>.js; the language list in ./locales/languages.js.
// Browser usage: the locale scripts are loaded before this file (see app.html) and register
// themselves on window.TACTILE_LOCALES. Node usage (main process, tests): files are required.
// HTML: <span data-i18n="key">, data-i18n-html, data-i18n-placeholder, data-i18n-title,
// data-i18n-aria-label. JS: t('key') / tf('key', value) for one %s placeholder.

const translations = {};
let languages = [];

if (typeof module !== 'undefined' && module.exports) {
    const fs = require('fs');
    const path = require('path');
    const localeDir = path.join(__dirname, 'locales');
    languages = require('./locales/languages.js');
    for (const file of fs.readdirSync(localeDir).sort()) {
        if (!/^[a-z]{2,3}(-[A-Z]{2})?\.js$/.test(file) || file === 'languages.js') continue;
        translations[file.slice(0, -3)] = require(path.join(localeDir, file));
    }
} else if (typeof window !== 'undefined') {
    Object.assign(translations, window.TACTILE_LOCALES || {});
    languages = window.TACTILE_LANGUAGES || [];
}

const SUPPORTED_LANGS = new Set(Object.keys(translations));
const RTL_LANGS = new Set(languages.filter((lang) => lang.rtl).map((lang) => lang.code));

let currentLang = 'en';

function getLang() {
    return currentLang;
}

function isSupportedLang(code) {
    return typeof code === 'string' && SUPPORTED_LANGS.has(code);
}

/**
 * Pick the closest supported locale for a system locale tag, e.g.
 * 'tr-TR' -> 'tr', 'zh-Hant-TW' -> 'zh-TW', 'pt-BR' -> 'pt', unknown -> 'en'.
 * Called with the OS locale in the main process (app.getLocale()); in the
 * renderer the argument may be omitted and navigator.* is used instead.
 */
function detectSystemLanguage(locale) {
    // An explicit locale (main process: app.getLocale()) is authoritative and must
    // not be overridden by the machine's navigator data. Only fall back to
    // navigator when no locale was supplied at all.
    const candidates = [];
    if (typeof locale === 'string' && locale.trim()) {
        candidates.push(locale.trim());
    } else if (typeof navigator !== 'undefined') {
        if (navigator.language) candidates.push(navigator.language);
        if (Array.isArray(navigator.languages)) candidates.push(...navigator.languages);
    }

    for (const candidate of candidates) {
        const parts = String(candidate).replace(/_/g, '-').split('-').filter(Boolean);
        if (!parts.length) continue;
        const language = parts[0].toLowerCase();

        // Prefer an explicit region form (zh-CN, zh-TW) when it is supported.
        for (const part of parts.slice(1)) {
            if (/^[A-Za-z]{2}$/.test(part)) {
                const regional = `${language}-${part.toUpperCase()}`;
                if (SUPPORTED_LANGS.has(regional)) return regional;
            }
        }
        if (SUPPORTED_LANGS.has(language)) return language;
    }

    return 'en';
}

/**
 * Resolve a stored setting to a usable locale: a supported code wins,
 * anything else (empty seed, legacy value, unsupported code) follows the OS.
 * Pass the OS locale explicitly from the main process (app.getLocale()).
 */
function resolveLanguage(code, locale) {
    return isSupportedLang(code) ? code : detectSystemLanguage(locale);
}

/**
 * The picker list: endonyms sorted by their native name. Endonyms are intentionally
 * identical in every interface language, so they are never translated.
 */
function getAvailableLanguages() {
    return languages
        .filter((lang) => SUPPORTED_LANGS.has(lang.code))
        .map((lang) => ({ code: lang.code, name: lang.name, english: lang.english, rtl: !!lang.rtl }))
        .sort((a, b) => a.name.localeCompare(b.name));
}

function setLang(lang) {
    if (isSupportedLang(lang)) {
        currentLang = lang;
        return true;
    }
    return false;
}

/**
 * Translate a key. Interpolation lives in `tf()` only; every template uses `%s`.
 * Missing keys fall back to English and finally to the key itself, but a test
 * enforces that no locale is missing a key, so the fallback is unreachable in a
 * shipped build.
 */
function t(key) {
    return (translations[currentLang] && translations[currentLang][key]) ||
           (translations['en'] && translations['en'][key]) ||
           key;
}

function tf(key, ...args) {
    return args.reduce(
        (text, arg) => text.replace('%s', () => String(arg)),
        t(key)
    );
}

/**
 * Keep <html lang> and <html dir> in sync with the active locale.
 */
function applyDocumentLanguage() {
    if (typeof document === 'undefined') return;
    document.documentElement.lang = currentLang;
    document.documentElement.dir = RTL_LANGS.has(currentLang) ? 'rtl' : 'ltr';
}

/**
 * Apply translations to all DOM elements with data-i18n attributes.
 */
function applyTranslations() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        const translated = t(key);
        if (translated !== key) {
            el.innerText = translated;
        }
    });

    document.querySelectorAll('[data-i18n-html]').forEach(el => {
        const key = el.getAttribute('data-i18n-html');
        const translated = t(key);
        if (translated !== key) {
            el.innerHTML = translated;
        }
    });

    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        const key = el.getAttribute('data-i18n-placeholder');
        const translated = t(key);
        if (translated !== key) {
            el.placeholder = translated;
        }
    });

    document.querySelectorAll('[data-i18n-title]').forEach(el => {
        const key = el.getAttribute('data-i18n-title');
        const translated = t(key);
        if (translated !== key) {
            el.title = translated;
        }
    });

    document.querySelectorAll('[data-i18n-aria-label]').forEach(el => {
        const key = el.getAttribute('data-i18n-aria-label');
        const translated = t(key);
        if (translated !== key) {
            el.setAttribute('aria-label', translated);
        }
    });
}

// Export for use in both main process (Node) and renderer (browser)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        translations,
        languages,
        t,
        tf,
        getLang,
        setLang,
        isSupportedLang,
        detectSystemLanguage,
        resolveLanguage,
        getAvailableLanguages,
        applyDocumentLanguage,
        applyTranslations
    };
}
