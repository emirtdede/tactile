const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');
const { app } = require('electron');
const { fileToDataUri, getAudioExtension, resolveWithinPath } = require('../libs/audio');

let db;
let dbPath;
let SQLModule = null;
let saveTimeout = null;

const MAX_NAME_LENGTH = 120;
const MAX_MATERIAL_LENGTH = 60;
const MAX_DESCRIPTION_LENGTH = 500;
const MAX_CATEGORY_LENGTH = 60;

// One source of truth: insertProfile used to fall back to 'ABS' while
// updateProfileDetails and the create-profile IPC handler fell back to 'Mixed',
// so the same empty material produced a different card depending on the path.
// The create-profile / import-folder-pack handlers in main.js reuse these too.
const DEFAULT_MATERIAL = 'Mixed';
const DEFAULT_SWITCH_TYPE = 'Linear';

function assertDb() {
    if (!db) throw new Error('Database has not been initialized');
    return db;
}

function normalizeText(value, maxLength) {
    if (value === null || value === undefined) return '';
    return String(value).trim().slice(0, maxLength);
}

function slugify(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/ı/g, 'i')
        .replace(/ş/g, 's')
        .replace(/ğ/g, 'g')
        .replace(/ü/g, 'u')
        .replace(/ö/g, 'o')
        .replace(/ç/g, 'c')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

function rowsFromExec(result) {
    if (!result || result.length === 0) return [];
    const columns = result[0].columns;
    return result[0].values.map((row) => {
        const item = {};
        columns.forEach((column, index) => { item[column] = row[index]; });
        return item;
    });
}

async function initDB() {
    const userDataPath = app.getPath('userData');
    dbPath = path.join(userDataPath, 'tactile.sqlite');

    const SQL = await initSqlJs();
    SQLModule = SQL;

    if (fs.existsSync(dbPath)) {
        const fileBuffer = fs.readFileSync(dbPath);
        db = new SQL.Database(fileBuffer);
    } else {
        db = new SQL.Database();
    }

    db.run('PRAGMA foreign_keys = ON;');

    db.run(`
        CREATE TABLE IF NOT EXISTS app_settings (
            key TEXT PRIMARY KEY,
            value TEXT
        );

        CREATE TABLE IF NOT EXISTS sound_categories (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            sort_order INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS sound_profiles (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            type TEXT,
            material TEXT,
            description TEXT,
            key_define_type TEXT,
            folder_path TEXT NOT NULL,
            sound_file TEXT,
            sound_up TEXT,
            is_custom BOOLEAN DEFAULT 0,
            sort_order INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS sound_files (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            profile_id TEXT NOT NULL,
            keycode TEXT NOT NULL,
            file TEXT,
            start INTEGER,
            length INTEGER,
            FOREIGN KEY (profile_id) REFERENCES sound_profiles(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS custom_packs (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            folder_path TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS favorites (
            profile_id TEXT PRIMARY KEY,
            FOREIGN KEY (profile_id) REFERENCES sound_profiles(id) ON DELETE CASCADE
        );

        -- Lookup indexes: every profile switch, delete and preview runs a
        -- sound_files scan by profile_id, and category screens filter
        -- sound_profiles by type. Without these both degrade to full scans.
        CREATE INDEX IF NOT EXISTS idx_sound_files_profile ON sound_files(profile_id);
        CREATE INDEX IF NOT EXISTS idx_sound_profiles_type ON sound_profiles(type);
    `);

    runMigrations();

    // Seed default categories (idempotent: only when the table is empty).
    const catCheck = db.exec('SELECT COUNT(*) as count FROM sound_categories');
    if (catCheck.length === 0 || catCheck[0].values[0][0] === 0) {
        db.run("INSERT INTO sound_categories (id, name, sort_order) VALUES ('linear', 'Linear', 1)");
        db.run("INSERT INTO sound_categories (id, name, sort_order) VALUES ('tactile', 'Tactile', 2)");
        db.run("INSERT INTO sound_categories (id, name, sort_order) VALUES ('clicky', 'Clicky', 3)");
        saveDB();
    }

    // Seed default settings if empty.
    const res = db.exec('SELECT COUNT(*) as count FROM app_settings');
    let count = 0;
    if (res.length > 0 && res[0].values.length > 0) {
        count = res[0].values[0][0];
    }

    if (count === 0) {
        const defaultSettings = {
            volume: '50',
            start_minimized: 'false',
            tray_icon: 'true',
            muted: 'false',
            theme: 'system',
            selected_profile: 'default',
            // Empty on purpose: the main process resolves it from the OS locale on
            // first launch (see resolveLanguage in i18n.js), so a new install never
            // starts in a language the user cannot read.
            language: '',
            app_icon: 'theme',
            tray_click_single: 'open',
            tray_click_double: 'none',
            shortcut_toggle_mute: 'Control+K',
            shortcut_quick_task: 'Control+Alt+N',
            close_behavior: 'tray',
            zoom: '100',
            high_contrast: 'false',
            reduce_motion: 'false',
            notifications: 'true',
            sound_feedback: 'true',
            custom_color: '#D4AF37',
            cloud_provider: 'none',
            cloud_folder: '',
            cloud_auto: 'true',
            cloud_last_sync: '',
            ai_enabled: 'false',
            ai_model: '',
            ai_runtime: 'auto',
            ai_rag: 'true',
            api_enabled: 'false',
            api_port: '18457',
            webhook_url: '',
            webhook_events: 'profile,mute,sync',
            webhook_secret: '',
            onboarding_done: 'false'
        };

        db.run('BEGIN TRANSACTION;');
        try {
            const stmt = db.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?)');
            for (const [key, value] of Object.entries(defaultSettings)) {
                stmt.run([key, value]);
            }
            stmt.free();
            db.run('COMMIT;');
        } catch (err) {
            // Without the rollback a failed seed left the transaction open,
            // so every later write silently accumulated in an uncommitted
            // transaction and was lost on quit.
            db.run('ROLLBACK;');
            throw err;
        }
        saveDB();
    } else {
        // Upgrade check: ensure new settings exist for existing databases.
        const newDefaults = {
            app_icon: 'light',
            tray_click_single: 'open',
            tray_click_double: 'none',
            shortcut_toggle_mute: 'Control+K',
            muted: 'false'
        };
        let changed = false;
        for (const [key, value] of Object.entries(newDefaults)) {
            const check = db.prepare('SELECT COUNT(*) as count FROM app_settings WHERE key = ?');
            check.bind([key]);
            const exists = check.step() && check.getAsObject().count > 0;
            check.free();
            if (!exists) {
                db.run('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)', [key, value]);
                changed = true;
            }
        }
        if (changed) saveDB();
    }
}

function runMigrations() {
    try {
        const tableInfo = db.exec('PRAGMA table_info(sound_profiles)');
        const columnNames = new Set(rowsFromExec(tableInfo).map((row) => row.name));

        let changed = false;
        if (!columnNames.has('sort_order')) {
            db.run('ALTER TABLE sound_profiles ADD COLUMN sort_order INTEGER DEFAULT 0');
            changed = true;
        }
        if (!columnNames.has('sound_up')) {
            db.run('ALTER TABLE sound_profiles ADD COLUMN sound_up TEXT');
            changed = true;
        }
        if (changed) saveDB();
    } catch (migErr) {
        console.error('Migration failed:', migErr);
    }
}

/**
 * Write the SQLite bytes without ever leaving a truncated database behind.
 * A crash in the middle of a direct write to `tactile.db` would destroy the
 * only copy of the user's library, so the file is written to a sibling
 * temporary and then renamed over the target.
 */
function writeDatabaseFile(data) {
    if (!dbPath) return false;
    const tmpPath = `${dbPath}.tmp-${process.pid}`;
    try {
        fs.writeFileSync(tmpPath, Buffer.from(data));

        try {
            fs.renameSync(tmpPath, dbPath);
        } catch (err) {
            if (err.code !== 'EBUSY' && err.code !== 'EPERM' && err.code !== 'EACCES') throw err;
            // Antivirus or a sync client may hold the destination briefly.
            fs.copyFileSync(tmpPath, dbPath);
            try { fs.unlinkSync(tmpPath); } catch (cleanupErr) { /* best effort */ }
        }

        return true;
    } catch (err) {
        try { fs.unlinkSync(tmpPath); } catch (cleanupErr) { /* best effort */ }
        throw err;
    }
}

function saveDB() {
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
        saveTimeout = null;
        try {
            if (!db) return;
            writeDatabaseFile(db.export());
        } catch (err) {
            console.error('Failed to save DB:', err);
        }
    }, 500);
}

function forceSaveDB() {
    if (saveTimeout) {
        clearTimeout(saveTimeout);
        saveTimeout = null;
    }
    try {
        if (db && dbPath) {
            return writeDatabaseFile(db.export());
        }
    } catch (err) {
        console.error('Failed to force save DB:', err);
    }
    return false;
}

/** Serializes the whole database for the cloud backup snapshot. */
function exportDatabase() {
    const database = assertDb();
    return Buffer.from(database.export()).toString('base64');
}

/** True when there is user data worth protecting from an empty overwrite. */
function databaseHasContent() {
    if (!db) return false;
    const result = db.exec('SELECT COUNT(*) AS count FROM sound_profiles');
    return Boolean(result.length && result[0].values.length && result[0].values[0][0] > 0);
}

/**
 * Replaces the live database with a snapshot after validating that the bytes
 * are a readable SQLite file. The current file is kept by the caller.
 */
function restoreDatabase(base64) {
    if (!SQLModule) throw new Error('Database module has not been initialized');
    if (typeof base64 !== 'string' || base64.length === 0) {
        throw new Error('Backup data is empty');
    }

    const bytes = Buffer.from(base64, 'base64');
    if (bytes.length === 0) throw new Error('Backup data is empty');

    let restored;
    try {
        restored = new SQLModule.Database(bytes);
        restored.exec('SELECT name FROM sqlite_master LIMIT 1');
        restored.exec('SELECT COUNT(*) FROM app_settings');
        restored.exec('SELECT COUNT(*) FROM sound_profiles');
    } catch (err) {
        if (restored) {
            try { restored.close(); } catch (closeErr) { /* best effort */ }
        }
        throw new Error(`Backup is not a readable Tactile database: ${err.message}`);
    }

    db = restored;
    db.run('PRAGMA foreign_keys = ON;');
    runMigrations();
    forceSaveDB();
    return true;
}

function getSetting(key) {
    if (!db) return null;
    const stmt = db.prepare('SELECT value FROM app_settings WHERE key = ?');
    stmt.bind([key]);
    let value = null;
    if (stmt.step()) {
        value = stmt.getAsObject().value;
    }
    stmt.free();
    return value;
}

function setSetting(key, value) {
    assertDb();
    if (typeof key !== 'string' || key.trim() === '') {
        throw new Error('Setting key is required');
    }
    db.run('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)', [key, value === null || value === undefined ? '' : String(value)]);
    saveDB();
}

function getProfiles() {
    assertDb();
    const rows = rowsFromExec(db.exec('SELECT * FROM sound_profiles ORDER BY sort_order ASC, name COLLATE NOCASE ASC'));
    return rows.map((profile) => ({ ...profile, is_custom: Boolean(profile.is_custom) }));
}

function getCategories() {
    assertDb();
    return rowsFromExec(db.exec('SELECT * FROM sound_categories ORDER BY sort_order ASC, name COLLATE NOCASE ASC'));
}

function getCategoryById(id) {
    assertDb();
    const stmt = db.prepare('SELECT * FROM sound_categories WHERE id = ?');
    stmt.bind([id]);
    const category = stmt.step() ? stmt.getAsObject() : null;
    stmt.free();
    return category;
}

function getCategoryByName(name) {
    assertDb();
    const stmt = db.prepare('SELECT * FROM sound_categories WHERE name = ? COLLATE NOCASE');
    stmt.bind([name]);
    const category = stmt.step() ? stmt.getAsObject() : null;
    stmt.free();
    return category;
}

function createCategory(rawName) {
    assertDb();
    const name = normalizeText(rawName, MAX_CATEGORY_LENGTH);
    if (!name) throw new Error('Category name is required');
    if (getCategoryByName(name)) throw new Error('A category with this name already exists');

    const baseId = slugify(name) || 'category';
    let id = baseId;
    let suffix = 2;
    while (getCategoryById(id)) {
        id = `${baseId}-${suffix}`;
        suffix += 1;
    }

    const orderRes = db.exec('SELECT COALESCE(MAX(sort_order), 0) + 1 FROM sound_categories');
    const order = orderRes[0].values[0][0];
    db.run('INSERT INTO sound_categories (id, name, sort_order) VALUES (?, ?, ?)', [id, name, order]);
    saveDB();
    return { id, name };
}

function deleteCategory(id) {
    assertDb();
    const category = getCategoryById(id);
    if (!category) return false;

    db.run('BEGIN TRANSACTION;');
    try {
        // Remove dependent sound files first so legacy databases without
        // working cascades do not keep orphan rows. `favorites` references
        // sound_profiles the same way and needs the same treatment.
        db.run('DELETE FROM sound_files WHERE profile_id IN (SELECT id FROM sound_profiles WHERE type = ?)', [category.name]);
        db.run('DELETE FROM favorites WHERE profile_id IN (SELECT id FROM sound_profiles WHERE type = ?)', [category.name]);
        db.run('DELETE FROM sound_profiles WHERE type = ?', [category.name]);
        db.run('DELETE FROM sound_categories WHERE id = ?', [id]);
        db.run('COMMIT;');
    } catch (err) {
        db.run('ROLLBACK;');
        throw err;
    }

    saveDB();
    return true;
}

function updateCategoryOrder(categoryIds) {
    assertDb();
    assertIdList(categoryIds, 'Category');

    db.run('BEGIN TRANSACTION;');
    try {
        const stmt = db.prepare('UPDATE sound_categories SET sort_order = ? WHERE id = ?');
        categoryIds.forEach((id, index) => {
            stmt.run([index, id]);
        });
        stmt.free();
        db.run('COMMIT;');
    } catch (err) {
        db.run('ROLLBACK;');
        throw err;
    }

    saveDB();
}

function renameCategory(id, rawName) {
    assertDb();
    const name = normalizeText(rawName, MAX_CATEGORY_LENGTH);
    if (!name) throw new Error('Category name is required');

    const category = getCategoryById(id);
    if (!category) return false;

    const duplicate = getCategoryByName(name);
    if (duplicate && duplicate.id !== id) throw new Error('A category with this name already exists');

    db.run('BEGIN TRANSACTION;');
    try {
        db.run('UPDATE sound_profiles SET type = ? WHERE type = ?', [name, category.name]);
        db.run('UPDATE sound_categories SET name = ? WHERE id = ?', [name, id]);
        db.run('COMMIT;');
    } catch (err) {
        db.run('ROLLBACK;');
        throw err;
    }

    saveDB();
    return true;
}

function deleteProfile(id) {
    assertDb();

    // Older databases may have been created before sound_files declared its
    // ON DELETE CASCADE, so the cascade cannot be relied on. deleteCategory
    // already deletes dependants explicitly; this path must do the same or a
    // legacy database keeps orphan sound_files/favorites rows forever.
    db.run('BEGIN TRANSACTION;');
    let deleted = false;
    try {
        db.run('DELETE FROM sound_files WHERE profile_id = ?', [id]);
        db.run('DELETE FROM favorites WHERE profile_id = ?', [id]);

        const stmt = db.prepare('DELETE FROM sound_profiles WHERE id = ?');
        stmt.run([id]);
        deleted = db.getRowsModified() > 0;
        stmt.free();

        db.run('COMMIT;');
    } catch (err) {
        db.run('ROLLBACK;');
        throw err;
    }

    saveDB();
    return deleted;
}

function assertIdList(ids, label) {
    if (!Array.isArray(ids)) throw new Error(`${label} order must be an array`);
    // A malformed payload (nested objects from a compromised renderer, or a
    // stale array containing undefined) used to reach sql.js as a bound value
    // and either corrupted sort_order or threw mid-transaction.
    if (ids.length > 10000) throw new Error(`${label} order has too many entries`);
    ids.forEach((id, index) => {
        if (typeof id !== 'string' || id === '' || id.length > 120) {
            throw new Error(`${label} order entry ${index} is invalid`);
        }
    });
}

function updateProfileOrder(profileIds) {
    assertDb();
    assertIdList(profileIds, 'Profile');

    db.run('BEGIN TRANSACTION;');
    try {
        const stmt = db.prepare('UPDATE sound_profiles SET sort_order = ? WHERE id = ?');
        profileIds.forEach((id, index) => {
            stmt.run([index, id]);
        });
        stmt.free();
        db.run('COMMIT;');
    } catch (err) {
        db.run('ROLLBACK;');
        throw err;
    }

    saveDB();
}

function updateProfileDetails(id, name, type, material, description) {
    assertDb();
    const safeName = normalizeText(name, MAX_NAME_LENGTH);
    if (!safeName) throw new Error('Profile name is required');

    const safeType = normalizeText(type, MAX_NAME_LENGTH) || DEFAULT_SWITCH_TYPE;
    const safeMaterial = normalizeText(material, MAX_MATERIAL_LENGTH) || DEFAULT_MATERIAL;
    const safeDescription = normalizeText(description, MAX_DESCRIPTION_LENGTH);

    db.run(
        'UPDATE sound_profiles SET name = ?, type = ?, material = ?, description = ? WHERE id = ?',
        [safeName, safeType, safeMaterial, safeDescription, id]
    );

    // Keep the on-disk config in sync when the profile lives in a writable folder.
    const profile = getProfileRow(id);
    if (profile && profile.folder_path) {
        const configPath = path.join(profile.folder_path, 'config.json');
        if (fs.existsSync(configPath)) {
            try {
                const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
                config.name = safeName;
                config.type = safeType;
                config.material = safeMaterial;
                config.description = safeDescription;
                fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
            } catch (err) {
                // Packaged built-in packs live inside app.asar and are read-only.
                console.warn('Could not update config.json (read-only pack?):', configPath, err.message);
            }
        }
    }

    saveDB();
    return true;
}

function getProfileRow(id) {
    assertDb();
    if (typeof id !== 'string' || id === '') return null;

    const stmt = db.prepare('SELECT * FROM sound_profiles WHERE id = ?');
    stmt.bind([id]);
    const row = stmt.step() ? stmt.getAsObject() : null;
    stmt.free();
    return row ? { ...row, is_custom: Boolean(row.is_custom) } : null;
}

function getProfileDetails(id, { includeSound = true } = {}) {
    assertDb();
    if (typeof id !== 'string' || id === '') return null;

    const stmt = db.prepare('SELECT * FROM sound_profiles WHERE id = ?');
    stmt.bind([id]);
    if (!stmt.step()) {
        stmt.free();
        return null;
    }
    const profile = stmt.getAsObject();
    stmt.free();
    profile.is_custom = Boolean(profile.is_custom);

    if (includeSound && profile.sound_file && profile.folder_path) {
        // Resolve inside the pack folder: a crafted config.json must not be
        // able to read (and base64-encode) arbitrary files from the machine.
        const fullPath = resolveWithinPath(profile.folder_path, profile.sound_file);
        if (fullPath && fs.existsSync(fullPath)) {
            try {
                profile.sound_base64 = fileToDataUri(fullPath);
                profile.sound_format = getAudioExtension(fullPath);
            } catch (err) {
                console.warn('Failed to read profile sound file:', fullPath, err.message);
            }
        } else if (!fullPath) {
            console.warn('Sound file path escapes the pack folder, ignoring:', profile.sound_file);
        }
    }

    const defines = {};
    const soundStmt = db.prepare('SELECT keycode, file, start, length FROM sound_files WHERE profile_id = ?');
    soundStmt.bind([id]);
    while (soundStmt.step()) {
        const sound = soundStmt.getAsObject();
        if (profile.key_define_type === 'single') {
            defines[sound.keycode] = [sound.start, sound.length];
        } else {
            defines[sound.keycode] = sound.file;
        }
    }
    soundStmt.free();

    profile.defines = defines;
    return profile;
}

function profileExists(id) {
    assertDb();
    const stmt = db.prepare('SELECT 1 FROM sound_profiles WHERE id = ? LIMIT 1');
    stmt.bind([id]);
    const exists = stmt.step();
    stmt.free();
    return exists;
}

function insertProfile(data, isCustom = false) {
    assertDb();
    if (!data || !data.folder_path) throw new Error('Profile folder path is required');

    const name = normalizeText(data.name, MAX_NAME_LENGTH);
    if (!name) throw new Error('Profile name is required');

    // The folder name keeps ids unique across packs that reuse the same config id.
    const uniqueId = `${path.basename(data.folder_path)}_${data.id}`;
    const keyDefineType = data.key_define_type === 'multi' ? 'multi' : 'single';
    const defines = data.defines && typeof data.defines === 'object' ? data.defines : {};

    db.run('BEGIN TRANSACTION;');
    try {
        // UPSERT keeps the existing `sort_order` (user drag & drop ordering)
        // intact. INSERT OR REPLACE used to reset it on every launch.
        db.run(`
            INSERT INTO sound_profiles (id, name, type, material, description, key_define_type, folder_path, sound_file, sound_up, is_custom)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                type = excluded.type,
                material = excluded.material,
                description = excluded.description,
                key_define_type = excluded.key_define_type,
                folder_path = excluded.folder_path,
                sound_file = excluded.sound_file,
                sound_up = excluded.sound_up,
                is_custom = excluded.is_custom
        `, [
            uniqueId,
            name,
            normalizeText(data.type, MAX_NAME_LENGTH) || DEFAULT_SWITCH_TYPE,
            normalizeText(data.material, MAX_MATERIAL_LENGTH) || DEFAULT_MATERIAL,
            normalizeText(data.description, MAX_DESCRIPTION_LENGTH),
            keyDefineType,
            data.folder_path,
            data.sound || null,
            data.soundup || data.sound_up || null,
            isCustom ? 1 : 0
        ]);

        db.run('DELETE FROM sound_files WHERE profile_id = ?', [uniqueId]);

        const stmt = db.prepare('INSERT INTO sound_files (profile_id, keycode, file, start, length) VALUES (?, ?, ?, ?, ?)');
        for (const [keycode, value] of Object.entries(defines)) {
            if (!value) continue;
            if (keyDefineType === 'single') {
                if (Array.isArray(value) && value.length >= 2) {
                    stmt.run([uniqueId, keycode, null, value[0], value[1]]);
                }
            } else {
                const file = Array.isArray(value) ? value[0] : value;
                if (typeof file === 'string' && file) {
                    stmt.run([uniqueId, keycode, file, null, null]);
                }
            }
        }
        stmt.free();
        db.run('COMMIT;');
    } catch (err) {
        db.run('ROLLBACK;');
        throw err;
    }

    saveDB();
    return uniqueId;
}

function loadDefaultPacks() {
    assertDb();
    const audioPath = path.join(__dirname, '..', 'audio');
    if (!fs.existsSync(audioPath)) {
        console.warn('Audio path does not exist:', audioPath);
        return;
    }

    const folders = fs.readdirSync(audioPath);
    let changed = false;

    folders.forEach((folder) => {
        const folderPath = path.join(audioPath, folder);
        const configPath = path.join(folderPath, 'config.json');
        if (!fs.existsSync(configPath)) {
            console.warn('No config.json found in', folder);
            return;
        }

        try {
            const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            config.folder_path = folderPath;

            const expectedId = `${path.basename(folderPath)}_${config.id}`;
            // Seed once: re-inserting on every launch used to overwrite user
            // edits (name/description/material) and reset sort_order.
            if (profileExists(expectedId)) return;

            const lname = String(config.name || '').toLowerCase();
            const folderName = folder.toLowerCase();
            if (lname.includes('clicky') || lname.includes('blue') || folderName.includes('blue') || folderName.includes('clicky')) {
                config.type = 'Clicky';
            } else if (lname.includes('tactile') || lname.includes('brown') || lname.includes('panda') || folderName.includes('brown') || folderName.includes('tactile') || folderName.includes('panda')) {
                config.type = 'Tactile';
            } else {
                config.type = DEFAULT_SWITCH_TYPE;
            }
            config.material = (lname.includes('pbt') || folderName.includes('pbt')) ? 'PBT' : ((lname.includes('abs') || folderName.includes('abs')) ? 'ABS' : DEFAULT_MATERIAL);
            // Never persist a translated description: it was translated once at
            // first launch and then stayed in that language forever. The renderer
            // falls back to t('card.default_desc') at paint time instead.
            config.description = '';

            insertProfile(config, false);
            changed = true;
        } catch (err) {
            console.error('Failed to load pack:', folder, 'Error:', err.message);
        }
    });

    if (changed) saveDB();
}

module.exports = {
    initDB,
    // Shared defaults so main.js does not duplicate the fallback strings.
    DEFAULT_MATERIAL,
    DEFAULT_SWITCH_TYPE,
    getSetting,
    setSetting,
    getProfiles,
    getCategories,
    createCategory,
    deleteCategory,
    updateCategoryOrder,
    renameCategory,
    deleteProfile,
    updateProfileOrder,
    updateProfileDetails,
    getProfileDetails,
    getProfileRow,
    insertProfile,
    loadDefaultPacks,
    forceSaveDB,
    exportDatabase,
    databaseHasContent,
    restoreDatabase
};
