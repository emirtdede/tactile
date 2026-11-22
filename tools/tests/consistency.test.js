'use strict';

/**
 * Static consistency checks for the renderer / i18n layer.
 *
 * These tests guard the invariants that were broken before the pre-deployment
 * audit: hardcoded UI strings, missing translation keys, dead DOM references
 * and stray debug logging.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

const APP_JS = read('src', 'app.js');
const APP_HTML = read('src', 'app.html');
const MAIN_JS = read('src', 'main.js');
const I18N = require(path.join(ROOT, 'src', 'i18n.js'));

const getElementIds = (source) => {
    const ids = new Set();
    for (const match of source.matchAll(/getElementById\(\s*'([^']+)'\s*\)/g)) ids.add(match[1]);
    for (const match of source.matchAll(/getElementById\(\s*"([^"]+)"\s*\)/g)) ids.add(match[1]);
    return ids;
};

const getHtmlIds = (html) => {
    const ids = new Set();
    for (const match of html.matchAll(/\bid="([^"]+)"/g)) ids.add(match[1]);
    return ids;
};

test('every element id used by the renderer exists in app.html', () => {
    const htmlIds = getHtmlIds(APP_HTML);
    const missing = [...getElementIds(APP_JS)].filter((id) => !htmlIds.has(id));
    assert.deepStrictEqual(missing, [], `Missing DOM ids: ${missing.join(', ')}`);
});

test('every element id used by the main process handlers exists in app.html', () => {
    const htmlIds = getHtmlIds(APP_HTML);
    const injected = new Set([
        // Nodes are created by the renderer at runtime, not present in app.html.
        'dialog-input-group'
    ]);
    const missing = [...getElementIds(MAIN_JS)].filter((id) => !htmlIds.has(id) && !injected.has(id));
    assert.deepStrictEqual(missing, [], `Missing DOM ids in main.js: ${missing.join(', ')}`);
});

test('every locale shares the canonical English key set', () => {
    const en = Object.keys(I18N.translations.en).sort();
    for (const [code, dict] of Object.entries(I18N.translations)) {
        assert.deepStrictEqual(Object.keys(dict).sort(), en, `${code} keys differ from English`);
    }
});

const collectUsedKeys = () => {
    const sources = [APP_JS, APP_HTML, MAIN_JS];
    const used = new Set();

    for (const source of sources) {
        for (const match of source.matchAll(/\btf?\(\s*'([^']+)'/g)) used.add(match[1]);
        for (const match of source.matchAll(/\btf?\(\s*"([^"]+)"/g)) used.add(match[1]);
        for (const match of source.matchAll(/data-i18n(?:-html|-placeholder|-title)?="([^"]+)"/g)) used.add(match[1]);
    }

    // Keys may also be reached indirectly through a lookup table
    // (e.g. LEGAL_PAGES in app.js), where the key sits in a plain string
    // literal that is not wrapped in t()/tf(). Treat an exact literal match
    // of a known key as usage so refactors into tables stay covered.
    for (const key of Object.keys(I18N.translations.tr)) {
        if (sources.some((source) => source.includes(`'${key}'`) || source.includes(`"${key}"`))) {
            used.add(key);
        }
    }

    return used;
};

test('every translation key referenced in the code exists in both languages', () => {
    const used = collectUsedKeys();
    const missing = [...used].filter((key) => !(key in I18N.translations.tr) || !(key in I18N.translations.en));
    assert.deepStrictEqual(missing, [], `Translations missing for: ${missing.join(', ')}`);
});

test('no translation key is defined but unused', () => {
    const used = collectUsedKeys();
    const unused = Object.keys(I18N.translations.tr).filter((key) => !used.has(key));
    assert.deepStrictEqual(unused, [], `Unused translation keys: ${unused.join(', ')}`);
});

test('first-party renderer and main sources contain no console.log', () => {
    const offenders = [];
    const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (entry.name === 'node_modules' || entry.name === 'assets') continue;
                walk(full);
                continue;
            }
            if (!entry.name.endsWith('.js')) continue;
            if (/jquery|howler\.min/.test(entry.name)) continue;

            const source = fs.readFileSync(full, 'utf8');
            if (/console\.log/.test(source)) offenders.push(path.relative(ROOT, full));
        }
    };

    walk(path.join(ROOT, 'src'));
    assert.deepStrictEqual(offenders, [], `console.log found in: ${offenders.join(', ')}`);
});

test('renderer HTML is not generated with inline event handlers', () => {
    assert.ok(!/\bonclick="/.test(APP_JS), 'Inline onclick handlers must not be generated');
});

test('profile data is escaped before being written into innerHTML', () => {
    const cardMarkup = APP_JS.match(/card\.innerHTML = `([\s\S]*?)`;/);
    assert.ok(cardMarkup, 'profile card markup template not found');

    const template = cardMarkup[1];
    for (const token of ['p.name', 'p.material', 'p.description']) {
        const raw = new RegExp(`\\$\\{\\s*${token.replace('.', '\\.')}\\s*\\}`);
        assert.ok(!raw.test(template), `${token} must be wrapped in escapeHtml()`);
    }
});

test('icon-only buttons always expose an accessible name', () => {
    // Every button whose visible content is a glyph (_, □, ✕) must carry an
    // aria-label so screen readers announce an action instead of a symbol.
    const offenders = [];
    const lines = APP_HTML.split(/\r?\n/);
    lines.forEach((line, index) => {
        if (!/<button/i.test(line)) return;
        const text = line.replace(/<[^>]*>/g, '').replace(/&[a-z]+;/gi, '').trim();
        if (text === '') return;
        const glyphOnly = text.length <= 3 && !/[A-Za-z0-9ÇĞİÖŞÜçğıöşü]/.test(text);
        if (!glyphOnly) return;
        if (/aria-label=/.test(line) || /data-i18n/.test(line)) return;
        offenders.push(index + 1);
    });
    assert.deepStrictEqual(offenders, [], `Buttons without an accessible name at lines: ${offenders.join(', ')}`);
});

test('icon-only button labels are translated through data-i18n-aria-label', () => {
    const keys = [...APP_HTML.matchAll(/data-i18n-aria-label="([^"]+)"/g)].map((m) => m[1]);
    assert.ok(keys.length >= 9, 'window controls and modal close buttons must be labelled');
    for (const key of keys) {
        assert.ok(key in I18N.translations.tr, `${key} missing from tr`);
        assert.ok(key in I18N.translations.en, `${key} missing from en`);
    }
    // applyTranslations() must actually apply the attribute.
    const i18nSource = read('src', 'i18n.js');
    assert.ok(/data-i18n-aria-label/.test(i18nSource), 'applyTranslations must handle data-i18n-aria-label');
    assert.ok(
        /setAttribute\(\s*['"]aria-label['"]/.test(i18nSource),
        'applyTranslations must write the aria-label attribute'
    );
});

test('keyboard focus stays visible on controls that drop the native outline', () => {
    const css = read('src', 'assets', 'app.css');
    // input[type=range] and the search box set `outline: none`; without a
    // :focus-visible replacement the volume slider had no keyboard indicator.
    assert.ok(/:focus-visible\s*\{/.test(css), 'app.css must define a :focus-visible rule');
    assert.ok(
        /:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--accent-gold\)/.test(css),
        'the focus ring must be visible in both themes'
    );
});

test('app.css carries no rules for classes the UI never uses', () => {
    const css = read('src', 'assets', 'app.css');
    const html = APP_HTML;
    const js = APP_JS;

    const htmlClasses = new Set(
        [...html.matchAll(/class="([^"]*)"/g)].flatMap((m) => m[1].split(/\s+/).filter(Boolean))
    );
    const jsClasses = new Set();
    for (const m of js.matchAll(/class="([^"]*)"/g)) {
        m[1].replace(/\$\{[^}]*\}/g, ' ').split(/\s+/).filter(Boolean).forEach((c) => jsClasses.add(c));
    }
    for (const m of js.matchAll(/className\s*=\s*[`'"]([^`'"]+)[`'"]/g)) {
        m[1].replace(/\$\{[^}]*\}/g, ' ').split(/\s+/).filter(Boolean).forEach((c) => jsClasses.add(c));
    }
    for (const m of js.matchAll(/classList\.(?:add|toggle|remove)\(\s*'([^']+)'/g)) jsClasses.add(m[1]);
    for (const m of js.matchAll(/querySelector(?:All)?\(\s*'\.([\w-]+)/g)) jsClasses.add(m[1]);

    const used = new Set([...htmlClasses, ...jsClasses].filter(Boolean));
    // `.brand-logo` (the real markup uses `.app-brand-logo`) and `.description`
    // (the label is a form-group) were leftovers that styled nothing.
    for (const orphan of ['brand-logo', 'description']) {
        assert.ok(!used.has(orphan), `${orphan} is now used; the deletion is stale`);
        assert.ok(!new RegExp(`\\.${orphan}\\s*\\{`).test(css), `.${orphan} rule must be removed from app.css`);
    }
});

test('app.html ships a restrictive Content-Security-Policy', () => {
    const html = APP_HTML;
    const meta = /<meta http-equiv="Content-Security-Policy"[\s\S]*?content="([^"]+)"/i.exec(html);
    assert.ok(meta, 'app.html must declare a CSP meta tag');
    const policy = meta[1];

    // A policy without script-src or with wildcards would be decorative.
    assert.ok(/script-src[^;]*'self'/.test(policy), "script-src must allow 'self'");
    assert.ok(!/script-src[^;]*'unsafe-inline'/.test(policy), 'inline scripts must stay blocked');
    assert.ok(!/script-src[^;]*\*/.test(policy), 'script-src must not use a wildcard');
    assert.ok(/object-src 'none'/.test(policy), 'object-src must be disabled');
    assert.ok(/base-uri 'none'/.test(policy), 'base-uri must be disabled');

    // Inline scripts would be blocked by the policy, so the markup must not
    // contain any (otherwise the app silently stops working).
    assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/i.test(html), 'inline <script> blocks are forbidden');

    // Sound packs reach Howler as data: URIs decoded with atob, and the app
    // icon is rasterized to a data: URL, so both must stay permitted.
    assert.ok(/media-src[^;]*data:/.test(policy), 'media-src must allow data: for sound packs');
    assert.ok(/img-src[^;]*data:/.test(policy), 'img-src must allow data: for the rasterized icon');
});

test('every form control has a programmatic accessible name', () => {
    const html = APP_HTML;
    const controls = [...html.matchAll(/<(input|select|textarea)\b([^>]*)>/g)];
    assert.ok(controls.length >= 25, 'the settings form must still be present');

    const offenders = [];
    for (const [, tag, attrs] of controls) {
        const type = (/type="([^"]+)"/.exec(attrs) || [, 'text'])[1];
        if (type === 'hidden') continue;

        const id = (/id="([^"]+)"/.exec(attrs) || [])[1];
        const hasAria = /aria-label(?:ledby)?=/.test(attrs);
        const labelledByFor = id ? new RegExp(`<label[^>]*for="${id}"`).test(html) : false;
        const wrappedInLabel = id ? new RegExp(`<label[^>]*>[\\s\\S]{0,200}id="${id}"`).test(html) : false;

        if (!hasAria && !labelledByFor && !wrappedInLabel) {
            offenders.push(`<${tag} id=${id || '(none)'} type=${type}>`);
        }

        // A dangling aria-labelledby is worse than none: it names the control
        // with an empty string.
        const labelledBy = /aria-labelledby="([^"]+)"/.exec(attrs);
        if (labelledBy && !html.includes(`id="${labelledBy[1]}"`)) {
            offenders.push(`<${tag} id=${id || '(none)'}> aria-labelledby="${labelledBy[1]}" target missing`);
        }
    }

    // The settings rows carry a visible <h3>; the control must reference it
    // (aria-labelledby) instead of leaving the heading decorative.
    assert.deepStrictEqual(offenders, [], offenders.join('\n'));
});

test('every modal overlay announces itself as a dialog', () => {
    const html = APP_HTML;
    const overlays = [...html.matchAll(/<div[^>]*class="modal-overlay[^"]*"[^>]*>/g)].map((m) => m[0]);
    assert.ok(overlays.length >= 7, 'the seven overlays must still be present');

    const offenders = [];
    for (const tag of overlays) {
        const idMatch = /id="([^"]+)"/.exec(tag);
        const id = idMatch ? idMatch[1] : '(no id)';
        if (!/role="dialog"/.test(tag)) offenders.push(`${id}: missing role="dialog"`);
        if (!/aria-modal="true"/.test(tag)) offenders.push(`${id}: missing aria-modal="true"`);

        const labelledBy = /aria-labelledby="([^"]+)"/.exec(tag);
        if (!labelledBy) {
            offenders.push(`${id}: missing aria-labelledby`);
        } else if (!html.includes(`id="${labelledBy[1]}"`)) {
            offenders.push(`${id}: aria-labelledby target "${labelledBy[1]}" does not exist`);
        }
    }

    assert.deepStrictEqual(offenders, [], offenders.join('\n'));
});

test('Escape closes the open modal and never dead-ends a dialog', () => {
    const js = APP_JS;
    // Screen-reader users could not dismiss a modal with the keyboard, and the
    // message-box promise only settled on a click.
    assert.ok(/MODAL_CLOSE_BUTTONS/.test(js), 'the close-button map must exist');
    assert.ok(/event\.key !== 'Escape' \|\| isRecordingShortcut/.test(js), 'the recorder must keep owning Escape');

    const map = js.match(/const MODAL_CLOSE_BUTTONS = \{[\s\S]*?\n    \};/);
    assert.ok(map, 'MODAL_CLOSE_BUTTONS not found');
    for (const [, overlayId, buttonId] of map[0].matchAll(/'([\w-]+)':\s*'([\w-]+)'/g)) {
        assert.ok(APP_HTML.includes(`id="${overlayId}"`), `overlay ${overlayId} does not exist`);
        assert.ok(APP_HTML.includes(`id="${buttonId}"`), `close button ${buttonId} does not exist`);
    }

    // The custom dialog must be resolved, otherwise `await showCustomAlert()`
    // hangs forever when the user presses Escape.
    assert.ok(
        /overlay\.id === 'custom-dialog-overlay'[\s\S]{0,400}(cancelBtn|confirmBtn)[\s\S]{0,200}\.click\(\)/.test(js),
        'Escape on the custom dialog must click one of its buttons so the promise settles'
    );
});

test('audio helpers reject paths that escape the pack folder', () => {
    const audio = require(path.join(ROOT, 'src', 'libs', 'audio.js'));
    assert.strictEqual(audio.resolveWithinPath('C:\\packs\\a', '..\\..\\windows\\system32\\x.dll'), null);
    assert.strictEqual(audio.resolveWithinPath('C:\\packs\\a', 'C:\\packs\\b\\x.mp3'), null);
    assert.ok(audio.resolveWithinPath('C:\\packs\\a', 'sound.mp3'));
});

test('translation interpolation does not treat user data as a replace pattern', () => {
    I18N.setLang('en');
    // `$&`, `$'` and `` $` `` are special in String.replace when the
    // replacement argument is a plain string.
    const nasty = "$& $' $` $1 $$";
    assert.strictEqual(I18N.tf('msg.confirm_delete_category', nasty).includes(nasty), true);
    assert.strictEqual(I18N.tf('about.version', '$&1.2.3').includes('$&1.2.3'), true);

    // `t()` is plain lookup only; interpolation must go through `tf()`.
    assert.strictEqual(I18N.t('about.version'), 'Version %s');

    I18N.setLang('tr');
    assert.strictEqual(I18N.getLang(), 'tr');
    assert.strictEqual(I18N.tf('about.version', '1.2.3'), 'Sürüm 1.2.3');
});

test('clearing the shortcut does not resurrect the default on next read', () => {
    const source = MAIN_JS;
    // `x || 'Control+K'` coerces the user's explicit '' back to the default.
    assert.ok(
        !/db\.getSetting\('shortcut_toggle_mute'\)\s*\|\|\s*'Control\+K'/.test(source),
        'the empty shortcut must not fall back to the default'
    );
    assert.strictEqual(
        (source.match(/=== null \|\| stored(?:Shortcut)? === undefined/g) || []).length,
        2,
        'both the register and the settings reader must check for null explicitly'
    );
});
