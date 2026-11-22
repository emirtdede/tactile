'use strict';

/**
 * Regression tests for the logic fixed during the pre-deployment audit:
 * the keycode remapper, renderer conventions and database invariants.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const remapper = require(path.join(ROOT, 'src', 'utils', 'remapper.js'));

test('remapper does not read back keys it has already overwritten', () => {
    const result = remapper('standard', 'darwin', {
        3639: 'f13.mp3',
        70: 'f14.mp3',
        3653: 'f15.mp3',
        3676: 'cmd.mp3',
        3640: 'alt.mp3',
        3613: 'ctrl.mp3',
        69: 'clear.mp3'
    });

    // The F13 mapping used to be destroyed by a second assignment to 91.
    assert.strictEqual(result['91'], 'f13.mp3');
    assert.strictEqual(result['92'], 'f14.mp3');
    assert.strictEqual(result['93'], 'f15.mp3');

    // 56 = Command, 3675 = Option, 29 = Control.
    assert.strictEqual(result['56'], 'cmd.mp3');
    assert.strictEqual(result['3675'], 'alt.mp3');
    assert.strictEqual(result['29'], 'ctrl.mp3');
    assert.strictEqual(result['3597'], 'clear.mp3');
});

test('remapper maps the win32 edit/navigation cluster', () => {
    const result = remapper('standard', 'win32', { 3666: 'ins', 3655: 'home' });
    assert.strictEqual(result['61010'], 'ins');
    assert.strictEqual(result['60999'], 'home');
});

test('reverse macOS remap does not read back keys it already overwrote', () => {
    // darwin -> standard: 56/3675/3676/3640 overlap between source and target.
    const result = remapper('darwin', 'standard', {
        91: 'f13.mp3',
        92: 'f14.mp3',
        93: 'f15.mp3',
        56: 'cmd.mp3',
        3675: 'opt.mp3',
        29: 'ctrl.mp3',
        3597: 'clear.mp3'
    });

    assert.strictEqual(result['3639'], 'f13.mp3');
    assert.strictEqual(result['70'], 'f14.mp3');
    assert.strictEqual(result['3653'], 'f15.mp3');
    assert.strictEqual(result['3676'], 'cmd.mp3', 'Command must map from 56');
    assert.strictEqual(result['3640'], 'opt.mp3', 'Option must map from 3675');
    assert.strictEqual(result['3613'], 'ctrl.mp3');
    assert.strictEqual(result['69'], 'clear.mp3', 'Clear must map back to numlock');
});

test('remapper leaves the linux layout untouched', () => {
    const input = { 14: 'backspace.mp3' };
    assert.deepStrictEqual(remapper('standard', 'linux', input), { 14: 'backspace.mp3' });
});

test('preview howl is declared before the Howler options object', () => {
    const source = fs.readFileSync(path.join(ROOT, 'src', 'app.js'), 'utf8');
    const decl = source.indexOf('let previewHowl = null;');
    const options = source.indexOf('const options = {');

    assert.ok(decl !== -1, 'previewHowl must be pre-declared');
    assert.ok(options !== -1, 'Howler options object not found');
    // The onloaderror/onplayerror callbacks run inside `options`, so the
    // binding must already exist or they hit the temporal dead zone.
    assert.ok(decl < options, 'previewHowl must be declared before the options callbacks');
    assert.ok(!/const previewHowl = new Howl/.test(source), 'previewHowl must not be redeclared');
});

test('delegated card actions handle rejected promises', () => {
    const source = fs.readFileSync(path.join(ROOT, 'src', 'app.js'), 'utf8');
    const handler = source.match(/function handleProfileGridClick\(event\) \{[\s\S]*?\n\}/);
    assert.ok(handler, 'handleProfileGridClick not found');

    const body = handler[0];
    for (const fn of ['previewProfile(id)', 'setActiveProfile(id)', 'openEditProfileModal(id)']) {
        assert.ok(body.includes(fn), `${fn} must still be dispatched`);
    }
    assert.ok(!/^\s*(?:else if \([^)]*\)\s*)?previewProfile\(id\);/m.test(body), 'previewProfile must not be called bare');
    assert.ok(!/^\s*(?:else if \([^)]*\)\s*)?setActiveProfile\(id\);/m.test(body), 'setActiveProfile must not be called bare');
    assert.strictEqual(body.match(/\.catch\(/g)?.length, 3, 'all three async actions must be caught');
});

test('alert dialog hides the cancel button so it cannot dead-end', () => {
    const source = fs.readFileSync(path.join(ROOT, 'src', 'app.js'), 'utf8');
    const alertFn = source.match(/function showCustomAlert\([\s\S]*?\n\}/);
    assert.ok(alertFn, 'showCustomAlert not found');

    // prepareDialog defaults showCancel to true; an alert that forgets to opt
    // out renders a live "Cancel" button that resolves nothing.
    assert.ok(
        /showCancel:\s*false/.test(alertFn[0]),
        'showCustomAlert must pass showCancel: false to prepareDialog'
    );

    const prepare = source.match(/function prepareDialog\(\{([\s\S]*?)\}\)\s*\{/);
    assert.ok(prepare, 'prepareDialog signature not found');
    assert.ok(
        /showCancel\s*=\s*true/.test(prepare[1]),
        'prepareDialog must keep showCancel defaulting to true'
    );
});

test('shortcut label replaces CommandOrControl before Control', () => {
    const source = fs.readFileSync(path.join(ROOT, 'src', 'app.js'), 'utf8');
    const fn = source.match(/const formatShortcutForUser = \(shortcut\) => \{[\s\S]*?\n    \};/);
    assert.ok(fn, 'formatShortcutForUser not found');

    const body = fn[0];
    const cmdIdx = body.indexOf('CommandOrControl');
    const ctrlIdx = body.search(/\.replace\(\/Control\/g/);

    assert.ok(cmdIdx !== -1, 'CommandOrControl must be handled');
    assert.ok(ctrlIdx !== -1, 'Control must be handled');
    // `Control` occurs inside `CommandOrControl`, so replacing it first
    // produced labels like "CommandOrCTRL".
    assert.ok(cmdIdx < ctrlIdx, 'CommandOrControl must be replaced before Control');
});

test('order updates reject malformed id lists before touching the database', () => {
    const source = fs.readFileSync(path.join(ROOT, 'src', 'db', 'database.js'), 'utf8');

    const helper = source.match(/function assertIdList\(ids, label\) \{[\s\S]*?\n\}/);
    assert.ok(helper, 'assertIdList helper not found');
    assert.ok(/Array\.isArray\(ids\)/.test(helper[0]), 'assertIdList must check Array.isArray');
    assert.ok(/typeof id !== 'string'/.test(helper[0]), 'assertIdList must reject non-string ids');
    assert.ok(/length > 10000/.test(helper[0]), 'assertIdList must cap the list length');

    for (const fn of ['updateProfileOrder', 'updateCategoryOrder']) {
        const body = source.match(new RegExp(`function ${fn}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`));
        assert.ok(body, `${fn} not found`);
        assert.ok(/assertIdList\(/.test(body[0]), `${fn} must validate every entry via assertIdList`);
    }
});

test('deleting a profile removes dependent rows explicitly', () => {
    const source = fs.readFileSync(path.join(ROOT, 'src', 'db', 'database.js'), 'utf8');
    const fn = source.match(/function deleteProfile\(id\) \{[\s\S]*?\n\}/);
    assert.ok(fn, 'deleteProfile not found');

    const body = fn[0];
    // Legacy databases were created before sound_files/favorites declared
    // ON DELETE CASCADE, so relying on the foreign key left orphans behind.
    assert.ok(
        /DELETE FROM sound_files WHERE profile_id = \?/.test(body),
        'deleteProfile must delete sound_files rows explicitly'
    );
    assert.ok(
        /DELETE FROM favorites WHERE profile_id = \?/.test(body),
        'deleteProfile must delete favorites rows explicitly'
    );
    assert.ok(/BEGIN TRANSACTION/.test(body), 'deleteProfile must be transactional');
    assert.ok(/ROLLBACK/.test(body), 'deleteProfile must roll back on failure');
});

test('deleting a category removes every dependent table explicitly', () => {
    const source = fs.readFileSync(path.join(ROOT, 'src', 'db', 'database.js'), 'utf8');
    const fn = source.match(/function deleteCategory\(id\) \{[\s\S]*?\n\}/);
    assert.ok(fn, 'deleteCategory not found');

    const body = fn[0];
    for (const table of ['sound_files', 'favorites', 'sound_profiles', 'sound_categories']) {
        assert.ok(
            new RegExp(`DELETE FROM ${table} `).test(body),
            `deleteCategory must delete from ${table}`
        );
    }
    assert.ok(/BEGIN TRANSACTION/.test(body), 'deleteCategory must be transactional');
    assert.ok(/ROLLBACK/.test(body), 'deleteCategory must roll back on failure');
});

test('renderer never fires a privileged promise without a rejection path', () => {
    const source = fs.readFileSync(path.join(ROOT, 'src', 'app.js'), 'utf8');
    const lines = source.split(/\r?\n/);
    const offenders = [];

    lines.forEach((line, index) => {
        const text = line.trim();
        if (!/window\.api\.\w+\(/.test(text)) return;
        if (/await|return|=>|\bcatch\b|\.then\(/.test(text)) return;
        if (text.startsWith('//')) return;
        // A trailing `.catch(...)` may sit on the following line.
        const next = (lines[index + 1] || '').trim();
        if (next.startsWith('.catch(')) return;
        offenders.push(`${index + 1}: ${text.slice(0, 80)}`);
    });

    assert.deepStrictEqual(offenders, [], `Unhandled window.api promise:\n${offenders.join('\n')}`);
});

test('the database indexes the columns every hot query filters on', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'db', 'database.js'), 'utf8');

    // Profile switches, previews and cascaded deletes all filter sound_files
    // by profile_id; category screens filter sound_profiles by type. Without
    // these indexes both become full table scans on large packs.
    assert.ok(
        /CREATE INDEX IF NOT EXISTS idx_sound_files_profile ON sound_files\(profile_id\)/i.test(source),
        'sound_files(profile_id) must be indexed'
    );
    assert.ok(
        /CREATE INDEX IF NOT EXISTS idx_sound_profiles_type ON sound_profiles\(type\)/i.test(source),
        'sound_profiles(type) must be indexed'
    );

    // Indexes must be created with IF NOT EXISTS so existing databases upgrade
    // without throwing on launch.
    for (const m of source.matchAll(/CREATE INDEX([^;]*)/gi)) {
        assert.ok(/IF NOT EXISTS/i.test(m[1]), `index without IF NOT EXISTS: ${m[1].trim().slice(0, 60)}`);
    }
});

test('the Electron window denies every permission request', () => {
    const main = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'main.js'), 'utf8');

    // Without a handler Electron grants camera/microphone/notification access
    // by default, so any future renderer XSS could start recording audio.
    assert.ok(
        /setPermissionRequestHandler\(/.test(main),
        'main.js must install a permission request handler'
    );
    assert.ok(
        /setPermissionRequestHandler\([^)]*\)\s*=>\s*\{[\s\S]{0,160}callback\(false\)/.test(main),
        'the permission handler must deny every request'
    );
    assert.ok(
        /setPermissionCheckHandler\(\(\)\s*=>\s*false\)/.test(main),
        'synchronous permission checks must also be denied'
    );

    // The renderer is locked down in other ways too.
    assert.ok(/contextIsolation:\s*true/.test(main), 'contextIsolation must stay enabled');
    assert.ok(/nodeIntegration:\s*false/.test(main), 'nodeIntegration must stay disabled');
    assert.ok(/sandbox:\s*true/.test(main), 'the renderer must stay sandboxed');
    assert.ok(/setWindowOpenHandler\(\(\)\s*=>\s*\(\{\s*action:\s*'deny'\s*\}\)\)/.test(main), 'new windows must be denied');
});

test('the renderer logs an unhandled promise rejection instead of losing it', () => {
    const source = fs.readFileSync(path.join(ROOT, 'src', 'app.js'), 'utf8');

    // Every settings write is wrapped, but a future code path could still
    // produce a floating rejection. Without a global listener that failure is
    // completely invisible in production (no console, no UI feedback).
    assert.ok(
        /window\.addEventListener\('unhandledrejection'/.test(source),
        'app.js must register an unhandledrejection listener'
    );
    assert.ok(
        /unhandledrejection'[\s\S]{0,200}console\.error\(/.test(source),
        'the unhandled rejection must be logged for diagnosis'
    );
});

test('deleting the active category also unloads the stale sound pack', () => {
    const source = fs.readFileSync(path.join(ROOT, 'src', 'main.js'), 'utf8');
    const handler = source.match(/ipcMain\.handle\('db-delete-category'[\s\S]*?\n\}\);/);
    assert.ok(handler, 'db-delete-category handler not found');

    const body = handler[0];
    // When the category held the active profile and nothing is left, the
    // already-loaded pack must be released like db-delete-profile does.
    assert.ok(/current_pack_data\s*=\s*null/.test(body), 'must clear current_pack_data');
    assert.ok(
        /sendToRenderer\('load-pack-sounds'/.test(body),
        'must tell the renderer to drop the stale pack'
    );
});

test('both pack import paths refresh profiles and material chips', () => {
    const source = fs.readFileSync(path.join(ROOT, 'src', 'app.js'), 'utf8');

    const helper = source.match(/const handlePackImportResult = async \(res\) => \{[\s\S]*?\n    \};/);
    assert.ok(helper, 'handlePackImportResult helper not found');
    assert.ok(/loadAndRenderMaterials\(\)/.test(helper[0]), 'imports must rebuild the material chips');

    // The drop zone and the folder picker used to duplicate the whole
    // success/failure block, and neither refreshed the chips.
    assert.strictEqual(
        (source.match(/window\.api\.importFolderPack\(/g) || []).length,
        2,
        'both import entry points must exist'
    );
    assert.strictEqual(
        (source.match(/handlePackImportResult\(await window\.api\.importFolderPack/g) || []).length,
        2,
        'both import entry points must share the helper'
    );
});

test('assigning a key to the active pack reloads it in memory', () => {
    const source = fs.readFileSync(path.join(ROOT, 'src', 'main.js'), 'utf8');
    const start = source.indexOf("ipcMain.handle('import-mixed-zip-pack'");
    assert.ok(start !== -1, 'import-mixed-zip-pack handler not found');

    const body = source.slice(start, start + 2600);
    // The handler wrote config.json and the DB but never refreshed
    // current_pack_data, so the newly assigned key only played after the user
    // re-activated the same profile.
    assert.ok(
        /const storedId = db\.insertProfile\(/.test(body),
        'the handler must keep the id that insertProfile persisted'
    );
    assert.ok(
        /db\.getSetting\('selected_profile'\) === storedId[\s\S]{0,80}loadProfileIntoMemory\(storedId\)/.test(body),
        'the active pack must be reloaded after a key is assigned'
    );
});

test('renaming a category keeps its profiles visible', () => {
    const source = fs.readFileSync(path.join(ROOT, 'src', 'app.js'), 'utf8');
    const fn = source.match(/function renderProfiles\([\s\S]*?\n\}/);
    assert.ok(fn, 'renderProfiles not found');

    const body = fn[0];
    // renameCategory() rewrites sound_profiles.type but leaves the category id
    // on its original slug, so matching p.type against the view id blanked the
    // whole category after a rename.
    assert.ok(
        /categories\.find\(\(entry\) => entry\.id === type\)/.test(body),
        'renderProfiles must resolve the category that owns the current view'
    );
    assert.ok(
        /String\(viewType \|\| ''\)/.test(body),
        'the filter must compare against the category name, not its stale id'
    );
    assert.ok(
        !/String\(type \|\| ''\)\.toLowerCase\(\)\.replace/.test(body),
        'the view id must not be slugified directly into the comparison'
    );
});

test('every profile write path uses the same default material', () => {
    const source = fs.readFileSync(path.join(ROOT, 'src', 'db', 'database.js'), 'utf8');
    const mainSource = fs.readFileSync(path.join(ROOT, 'src', 'main.js'), 'utf8');

    const constant = source.match(/const DEFAULT_MATERIAL = '([^']+)';/);
    assert.ok(constant, 'DEFAULT_MATERIAL constant not found');

    // insertProfile used to say 'ABS' while updateProfileDetails said 'Mixed',
    // so the same empty material rendered differently per code path.
    assert.ok(
        !/MAX_MATERIAL_LENGTH\) \|\| '(Mixed|ABS|PBT)'/.test(source),
        'material fallbacks must use DEFAULT_MATERIAL, not a string literal'
    );
    assert.ok(
        /MAX_MATERIAL_LENGTH\) \|\| DEFAULT_MATERIAL/.test(source),
        'at least one fallback must reference DEFAULT_MATERIAL'
    );
    assert.ok(
        /const DEFAULT_SWITCH_TYPE = '([^']+)';/.test(source),
        'DEFAULT_SWITCH_TYPE constant not found'
    );
    assert.ok(
        !/MAX_NAME_LENGTH\) \|\| 'Linear'/.test(source),
        'switch type fallbacks must use DEFAULT_SWITCH_TYPE'
    );

    // The main-process handlers had their own literals for the same fields.
    assert.ok(
        !/sanitizeText\(material, 60\) \|\| '/.test(mainSource),
        'main.js must reuse db.DEFAULT_MATERIAL'
    );
    assert.ok(
        !/sanitizeText\(type, 120\) \|\| '/.test(mainSource),
        'main.js must reuse db.DEFAULT_SWITCH_TYPE'
    );
    assert.ok(/db\.DEFAULT_MATERIAL/.test(mainSource), 'main.js must reference db.DEFAULT_MATERIAL');
});

test('disabling the tray icon cancels the pending single-click timer', () => {
    const source = fs.readFileSync(path.join(ROOT, 'src', 'main.js'), 'utf8');
    const fn = source.match(/function setupTray\(\) \{[\s\S]*?\n\}/);
    assert.ok(fn, 'setupTray not found');

    const body = fn[0];
    // The 250 ms single-click timer used to survive tray.destroy() and run a
    // tray action for an icon the user had just removed.
    const destroyBlock = body.slice(0, body.indexOf('return;'));
    assert.ok(/clearTimeout\(clickTimeout\)/.test(destroyBlock), 'must clear clickTimeout when the tray is destroyed');
});

test('material "new" field cancels its pending hide timer', () => {
    const source = fs.readFileSync(path.join(ROOT, 'src', 'app.js'), 'utf8');
    const fn = source.match(/function bindMaterialSelectToggle\([\s\S]*?\n    \}/);
    assert.ok(fn, 'bindMaterialSelectToggle not found');

    const body = fn[0];
    // Re-selecting "__NEW__" within the 300 ms hide window used to leave the
    // wrapper at display:none because the stale timer still fired.
    assert.ok(/let hideTimer = null/.test(body), 'must keep a handle on the hide timer');
    assert.ok(/clearTimeout\(hideTimer\)/.test(body), 'must clear the pending hide timer');
    assert.ok(/hideTimer = setTimeout\(/.test(body), 'must store the hide timer id');
});

test('switching views clears the search filter for every entry point', () => {
    const source = fs.readFileSync(path.join(ROOT, 'src', 'app.js'), 'utf8');
    const fn = source.match(/function switchView\(view\) \{[\s\S]*?\n\}/);
    assert.ok(fn, 'switchView not found');

    // The sidebar handler cleared the search box, but category buttons called
    // switchView() directly, so a search query stayed active across views and
    // the newly opened category looked empty.
    assert.ok(/search-input/.test(fn[0]), 'switchView must reset the search box itself');
    assert.ok(/btn-clear-search/.test(fn[0]), 'switchView must hide the clear button');
    // The reset must live in switchView only, not be repeated in nav handlers.
    const navHandler = source.match(/document\.querySelectorAll\('\.rail-item'\)\.forEach\(btn => \{[\s\S]*?\n    \}\);/);
    assert.ok(navHandler, 'sidebar nav handler not found');
    assert.ok(
        !/searchInput\.value = ''/.test(navHandler[0]),
        'the nav handler must delegate the search reset to switchView()'
    );
});

test('shortcut recording stops when the window loses focus', () => {
    const source = fs.readFileSync(path.join(ROOT, 'src', 'app.js'), 'utf8');

    const start = source.match(/function startRecording\(\) \{[\s\S]*?\n    \}/);
    const stop = source.match(/function stopRecording\(\) \{[\s\S]*?\n    \}/);
    assert.ok(start, 'startRecording not found');
    assert.ok(stop, 'stopRecording not found');

    // Alt-tabbing away while recording kept the capture listener alive, so the
    // whole app swallowed keystrokes until Escape was pressed.
    assert.ok(
        /addEventListener\('blur', cancelRecording\)/.test(start[0]),
        'recording must be cancelled on blur'
    );
    assert.ok(
        /removeEventListener\('blur', cancelRecording\)/.test(stop[0]),
        'the blur listener must be removed when recording stops'
    );
    assert.ok(/function cancelRecording\(\)[\s\S]*?stopRecording\(\)/.test(source), 'cancelRecording must delegate to stopRecording');
});

test('every database transaction can be rolled back', () => {
    const source = fs.readFileSync(path.join(ROOT, 'src', 'db', 'database.js'), 'utf8');

    // Group BEGIN/ROLLBACK occurrences by the function that contains them.
    let currentFn = '(top)';
    const blocks = new Map();
    source.split(/\r?\n/).forEach((line) => {
        const fn = /^\s*(?:async\s+)?function\s+(\w+)/.exec(line);
        if (fn) currentFn = fn[1];
        if (!/BEGIN TRANSACTION|ROLLBACK/.test(line)) return;
        if (!blocks.has(currentFn)) blocks.set(currentFn, { begin: 0, rollback: 0 });
        const rec = blocks.get(currentFn);
        if (/BEGIN TRANSACTION/.test(line)) rec.begin += 1;
        if (/ROLLBACK/.test(line)) rec.rollback += 1;
    });

    assert.ok(blocks.size >= 6, 'the transactional writers must still exist');

    // The settings seed opened a transaction with a bare COMMIT: a throw left
    // it dangling, so every later write piled into an uncommitted transaction
    // and was lost on quit.
    for (const [fn, rec] of blocks) {
        assert.strictEqual(
            rec.begin,
            rec.rollback,
            `${fn} opens ${rec.begin} transaction(s) but only ${rec.rollback} rollback path(s)`
        );
    }
});

test('every writable setting is seeded so its default lives in one place', () => {
    const source = fs.readFileSync(path.join(ROOT, 'src', 'db', 'database.js'), 'utf8');
    const mainSource = fs.readFileSync(path.join(ROOT, 'src', 'main.js'), 'utf8');

    const seedBlock = /const defaultSettings = \{([\s\S]*?)\};/.exec(source);
    assert.ok(seedBlock, 'defaultSettings block not found');
    const seeded = new Set([...seedBlock[1].matchAll(/^\s*(\w+):/gm)].map((m) => m[1]));

    const upgradeBlock = /const newDefaults = \{([\s\S]*?)\};/.exec(source);
    assert.ok(upgradeBlock, 'newDefaults block not found');
    const upgraded = [...upgradeBlock[1].matchAll(/^\s*(\w+):/gm)].map((m) => m[1]);

    const normalizerBlock = /const SETTING_NORMALIZERS = \{([\s\S]*?)\n\};/.exec(mainSource);
    assert.ok(normalizerBlock, 'SETTING_NORMALIZERS block not found');
    const writable = [...normalizerBlock[1].matchAll(/^\s*(\w+):/gm)].map((m) => m[1]);

    // `muted` was accepted by the IPC whitelist but never seeded, so the
    // default lived in the renderer's state object and in a main-process
    // fallback instead of the database.
    for (const key of writable) {
        assert.ok(seeded.has(key), `setting "${key}" is writable but never seeded`);
    }

    // Every key added for existing databases must also be in the fresh seed,
    // otherwise a reinstall and an upgrade disagree about the defaults.
    for (const key of upgraded) {
        assert.ok(seeded.has(key), `upgrade default "${key}" is missing from defaultSettings`);
    }
});

test('the stylesheet mirrors for right-to-left locales', () => {
    const css = fs.readFileSync(path.join(ROOT, 'src', 'assets', 'app.css'), 'utf8');

    // <html dir="rtl"> is set by i18n.js for ar/fa/he/ur. Physical left/right
    // rules do not flip with the writing direction, so a sidebar pinned with
    // border-right kept its border on the wrong side and the active-card accent
    // stayed on the left in every RTL locale.
    const physical = /(text-align|margin|padding|border)\s*-\s*(left|right)\s*:|text-align\s*:\s*(left|right)\s*;/g;
    const offenders = [...css.matchAll(physical)].map((m) => {
        const line = css.slice(0, m.index).split(/\r?\n/).length;
        return `line ${line}: ${m[0]}`;
    });
    assert.deepStrictEqual(offenders, [], `Direction-dependent CSS found:\n${offenders.join('\n')}`);

    // Bare left/right offsets must be logical too, except on the fixed
    // full-viewport overlay where both axes are pinned to the viewport edge.
    const bare = [];
    for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const [, selector, body] = rule;
        if (/\.modal-overlay\b/.test(selector)) continue;
        if (/(^|[;\s])left\s*:/.test(body) || /(^|[;\s])right\s*:/.test(body)) {
            bare.push(`${selector.trim().split(/\r?\n/).pop().trim()} { ${body.trim().split(/\r?\n/)[0].trim()} }`);
        }
    }
    assert.deepStrictEqual(bare, [], `Physical offsets must be logical:\n${bare.join('\n')}`);

    // The toggle knob travels toward the inline-end edge, which is the left in
    // RTL, so the checked offset has to be negated explicitly.
    assert.ok(/\[dir="rtl"\][^{]*\.slider::before\s*\{[^}]*translateX\(-1\.125rem\)/.test(css),
        'RTL toggle must move its knob the other way');
});

test('language switch repaints every label built with tf() instead of a hook', () => {
    const source = fs.readFileSync(path.join(ROOT, 'src', 'app.js'), 'utf8');

    // app-version-display is filled with tf('about.version', version), so it has
    // no data-i18n hook and applyTranslations() cannot touch it. It used to be
    // painted once at boot, which left the version line in the previous language
    // after switching (e.g. "Bersyon 1.0" while the UI had moved to English).
    assert.ok(/function updateVersionLabel\(\)/.test(source), 'updateVersionLabel helper missing');
    assert.ok(
        /el\.innerText = app_version \? tf\('about\.version', app_version\) : ''/.test(source),
        'version label must be built with tf() so it follows the active locale'
    );

    const handler = source.match(/langSelect\.addEventListener\('change',[\s\S]*?\n        \}\);/);
    assert.ok(handler, 'language change handler not found');
    assert.ok(
        /updateVersionLabel\(\)/.test(handler[0]),
        'language change handler must repaint the version label'
    );
    // The boot path must go through the same helper rather than duplicating the call.
    assert.ok(
        !/getElementById\('app-version-display'\)\.innerText = tf\(/.test(source.split('function updateVersionLabel')[1] || ''),
        'boot must delegate to updateVersionLabel() instead of painting inline'
    );
});

test('theme mode and palette stay separate settings', () => {
    const renderer = fs.readFileSync(path.join(ROOT, 'src', 'app.js'), 'utf8');
    const main = fs.readFileSync(path.join(ROOT, 'src', 'main.js'), 'utf8');
    const database = fs.readFileSync(path.join(ROOT, 'src', 'db', 'database.js'), 'utf8');
    const boot = fs.readFileSync(path.join(ROOT, 'src', 'assets', 'theme-boot.js'), 'utf8');

    // "custom" is a palette; the mode still has to resolve to light or dark.
    const modes = /const THEME_MODES = \[([^\]]*)\]/.exec(main);
    assert.ok(modes, 'THEME_MODES not found');
    assert.ok(!/custom/.test(modes[1]), 'theme mode must not accept "custom"');
    const palettes = /const THEME_PALETTES = \[([\s\S]*?)\];/.exec(main);
    assert.ok(palettes && /'custom'/.test(palettes[1]), 'the palette list must include "custom"');

    const apply = /function applyTheme\(mode\) \{([\s\S]*?)\n\}/.exec(renderer);
    assert.ok(apply, 'applyTheme not found');
    assert.ok(
        /settings\.theme_palette = 'custom'/.test(apply[1]),
        'applyTheme("custom") must switch the palette, not the mode'
    );

    // A pre-1.2 database stored "custom" as the mode. It has to be migrated or
    // the window opens with a mode the normalizer now rejects.
    assert.ok(
        /value === 'custom'[\s\S]{0,200}theme_palette/.test(database),
        'existing "custom" theme rows must migrate to the custom palette'
    );

    // The pre-paint boot script reads the cached palette, so it must set the
    // same attribute the stylesheet keys on.
    assert.ok(/dataset\.theme = palette/.test(boot), 'theme-boot must set data-theme');
});

test('keycode remap keeps the keyup (-up) variants in sync with keydown', () => {
    // Compiled outside the test so the module can require the remapper.
    const { keycodesRemap } = require(path.join(ROOT, 'src', 'libs', 'keycodes.js'));

    const sprite = keycodesRemap({
        3666: 'ins.mp3',
        '3666-up': 'ins-up.mp3',
        57: 'space.mp3',
        '57-up': 'space-up.mp3'
    });

    assert.strictEqual(sprite['keycode-57'], 'space.mp3');
    assert.strictEqual(sprite['keycode-57-up'], 'space-up.mp3', 'keyup entry must survive remapping');

    if (process.platform === 'win32') {
        assert.strictEqual(sprite['keycode-61010'], 'ins.mp3', 'keydown must be remapped');
        assert.strictEqual(
            sprite['keycode-61010-up'],
            'ins-up.mp3',
            'keyup must follow the remapped keycode, otherwise release sounds never play'
        );
    }
});
