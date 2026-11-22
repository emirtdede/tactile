const { app, BrowserWindow, Tray, Menu, ipcMain, globalShortcut, nativeImage, shell, dialog, Notification, nativeTheme } = require('electron');
const os = require('os');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { execFile } = require('child_process');
const db = require('./db/database');
const cloudSync = require('./cloud-sync');
const { uIOhook } = require('uiohook-napi');
const { keycodesRemap, keycodesFill } = require('./libs/keycodes');
const { setLang, t, tf, isSupportedLang, resolveLanguage } = require('./i18n');
const {
    getAudioExtension,
    isSupportedAudioFile,
    resolveWithinPath,
    resolveMultiDefines,
    fileToDataUri
} = require('./libs/audio');
const { buildIcoFromPng } = require('./libs/ico');
const { createAiService } = require('./ai/service');
const { createIntegrationService } = require('./integrations/service');
const BRAND = require('./branding');

let win = null;
let tray = null;
let aiService = null;
let integrationService = null;
let current_pack_data = null;
let is_muted = false;
let hook_started = false;
let clickTimeout = null;
let syncTimer = null;
let updater = null;
let pendingView = null;

const activeKeys = new Set();

const SYSTRAY_ICON = path.join(__dirname, 'assets/system-tray-icon.png');

const TRAY_ACTIONS = ['open', 'mute', 'vol_up', 'vol_down', 'none'];
const CLOSE_BEHAVIORS = ['ask', 'tray', 'quit'];
const THEME_MODES = ['system', 'light', 'dark'];
const THEME_PALETTES = [
    'obsidian', 'slate', 'navy', 'blue', 'cyan', 'indigo', 'purple',
    'pink', 'red', 'orange', 'yellow', 'emerald', 'grass', 'lime', 'custom'
];
const ICON_MODES = ['theme', 'custom', 'light', 'dark'];
// mailto: is needed by the "Contact support" button; everything else (file:,
// javascript:, ms-msdt: ...) stays blocked so a malicious link cannot launch a
// local handler.
const ALLOWED_PROTOCOLS = new Set(['https:', 'http:', 'mailto:']);

const SETTING_NORMALIZERS = {
    volume: (value) => {
        const parsed = Number.parseInt(value, 10);
        if (!Number.isFinite(parsed)) return null;
        return String(Math.max(0, Math.min(100, parsed)));
    },
    start_minimized: (value) => (value === 'true' || value === true ? 'true' : 'false'),
    tray_icon: (value) => (value === 'true' || value === true ? 'true' : 'false'),
    muted: (value) => (value === 'true' || value === true ? 'true' : 'false'),
    theme: (value) => (THEME_MODES.includes(value) ? value : null),
    theme_palette: (value) => (THEME_PALETTES.includes(value) ? value : null),
    app_icon: (value) => (ICON_MODES.includes(value) ? value : null),
    language: (value) => (isSupportedLang(value) ? value : null),
    tray_click_single: (value) => (TRAY_ACTIONS.includes(value) ? value : null),
    tray_click_double: (value) => (TRAY_ACTIONS.includes(value) ? value : null),
    shortcut_toggle_mute: (value) => normalizeShortcut(value),
    shortcut_quick_task: (value) => normalizeShortcut(value),
    close_behavior: (value) => (CLOSE_BEHAVIORS.includes(value) ? value : null),
    zoom: (value) => {
        const parsed = Number.parseInt(value, 10);
        if (!Number.isFinite(parsed)) return null;
        return String(Math.max(80, Math.min(150, parsed)));
    },
    high_contrast: (value) => (value === 'true' || value === true ? 'true' : 'false'),
    reduce_motion: (value) => (value === 'true' || value === true ? 'true' : 'false'),
    notifications: (value) => (value === 'true' || value === true ? 'true' : 'false'),
    sound_feedback: (value) => (value === 'true' || value === true ? 'true' : 'false'),
    custom_color: (value) => (/^#[0-9a-fA-F]{6}$/.test(String(value || '')) ? String(value).toUpperCase() : null),
    cloud_provider: (value) => (cloudSync.PROVIDERS.includes(value) || value === 'none' ? value : null),
    cloud_folder: (value) => (typeof value === 'string' ? value.trim().slice(0, 1024) : null),
    cloud_auto: (value) => (value === 'true' || value === true ? 'true' : 'false'),
    cloud_last_sync: (value) => (typeof value === 'string' ? value.slice(0, 40) : null),
    ai_enabled: (value) => (value === 'true' || value === true ? 'true' : 'false'),
    ai_model: (value) => (typeof value === 'string' && /^[A-Za-z0-9._:/-]{0,120}$/.test(value) ? value : null),
    ai_runtime: (value) => (value === 'auto' || value === 'ollama' ? value : null),
    ai_rag: (value) => (value === 'true' || value === true ? 'true' : 'false'),
    api_enabled: (value) => (value === 'true' || value === true ? 'true' : 'false'),
    api_port: (value) => {
        const parsed = Number.parseInt(value, 10);
        if (!Number.isFinite(parsed)) return null;
        return String(Math.max(1024, Math.min(65535, parsed)));
    },
    webhook_url: (value) => (typeof value === 'string' ? value.trim().slice(0, 1024) : null),
    webhook_events: (value) => (typeof value === 'string' ? value.trim().slice(0, 200) : null),
    webhook_secret: (value) => (typeof value === 'string' ? value.trim().slice(0, 200) : null),
    onboarding_done: (value) => (value === 'true' || value === true ? 'true' : 'false')
};

function normalizeShortcut(value) {
    if (value === null || value === undefined) return '';
    const shortcut = String(value).trim();
    if (shortcut === '') return '';
    if (shortcut.length > 64) return null;
    // Electron accelerator: modifiers plus a final key, e.g. Control+Alt+K.
    if (!/^[A-Za-z0-9+._\- ]+$/.test(shortcut)) return null;

    // A bare key (e.g. "A") would register a global hotkey that swallows every
    // keystroke system-wide and make the machine unusable. Require at least
    // one modifier, exactly like every other well-behaved global shortcut.
    const parts = shortcut.split('+').map((part) => part.trim()).filter(Boolean);
    if (parts.length < 2) return null;
    const hasModifier = parts
        .slice(0, -1)
        .some((part) => /^(Control|Ctrl|Alt|Shift|Meta|Super|Command|Cmd|CommandOrControl|CmdOrCtrl)$/i.test(part));
    return hasModifier ? shortcut : null;
}

function normalizeSetting(key, value) {
    if (typeof key !== 'string' || !Object.prototype.hasOwnProperty.call(SETTING_NORMALIZERS, key)) {
        return null;
    }
    return SETTING_NORMALIZERS[key](value);
}

function sanitizeText(value, maxLength) {
    if (value === null || value === undefined) return '';
    return String(value).trim().slice(0, maxLength);
}

function effectiveTheme() {
    const mode = db.getSetting('theme') || 'system';
    if (mode === 'light') return 'light';
    if (mode === 'dark') return 'dark';
    return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
}

function resolveIconType(iconMode = db.getSetting('app_icon') || 'theme') {
    if (iconMode === 'light' || iconMode === 'dark') return iconMode;
    // "Match theme" and a custom colour both fall back to the bundled ICO that
    // contrasts with the active theme; the renderer also sets a colour-tinted
    // window icon through set-dynamic-app-icon.
    return effectiveTheme() === 'light' ? 'dark' : 'light';
}

function normalizeAppIconType(iconType) {
    return resolveIconType(iconType) === 'dark' ? 'dark' : 'light';
}

function getAppIconPath(iconType = 'light') {
    const normalizedIconType = normalizeAppIconType(iconType);
    const iconFileName = normalizedIconType === 'dark' ? 'Tactile-bg.ico' : 'Tactile-light.ico';
    return path.join(__dirname, '../public', iconFileName);
}

function getSharedShortcutIconPath(iconFileName) {
    // The NSIS installer writes these into %APPDATA%\Tactile\Icons so a
    // per-user (no elevation) install can create shortcuts that keep working
    // after the app updates its icon. ProgramData is not writable here.
    return path.join(app.getPath('appData'), 'Tactile', 'Icons', iconFileName);
}

function getWindowIconPath(iconType = db.getSetting('app_icon') || 'light') {
    if (process.platform !== 'win32') {
        return path.join(__dirname, 'assets', 'icon.png');
    }

    return getAppIconPath(iconType);
}

function applyWindowIcon(iconType) {
    if (process.platform !== 'win32' || !win || win.isDestroyed()) return;

    const iconPath = getAppIconPath(iconType);
    if (!fs.existsSync(iconPath)) {
        console.warn('Window icon source not found:', iconPath);
        return;
    }

    const image = nativeImage.createFromPath(iconPath);
    if (image.isEmpty()) {
        console.warn('Window icon image is empty:', iconPath);
        return;
    }

    win.setIcon(image);
}

function consumeInstallerLanguage() {
    // The NSIS setup wizard writes the user's language choice next to the app
    // data before the first launch. It is read once and removed so a later OS
    // language change is not fought by a stale installer choice.
    try {
        const file = path.join(app.getPath('appData'), 'Tactile', 'installer-language.txt');
        if (!fs.existsSync(file)) return null;
        const code = fs.readFileSync(file, 'utf8').trim();
        try {
            fs.unlinkSync(file);
        } catch (err) {
            console.warn('Failed to remove the installer language file:', err.message);
        }
        return isSupportedLang(code) ? code : null;
    } catch (err) {
        console.warn('Failed to read the installer language:', err.message);
        return null;
    }
}

function sendToRenderer(channel, payload) {
    if (win && !win.isDestroyed()) {
        win.webContents.send(channel, payload);
        return true;
    }
    return false;
}

function navigateTo(view) {
    if (!view) return;
    if (!sendToRenderer('navigate', view)) {
        pendingView = view;
    }
}

function cloudSettings() {
    return {
        provider: db.getSetting('cloud_provider') || 'none',
        folder: db.getSetting('cloud_folder') || ''
    };
}

function cloudRoot() {
    const { provider, folder } = cloudSettings();
    return cloudSync.resolveSyncRoot({
        provider,
        folder,
        fallback: path.join(app.getPath('userData'), 'Backups')
    });
}

function cloudStatusPayload() {
    const { provider, folder } = cloudSettings();
    const root = cloudRoot();
    const dir = cloudSync.backupDirectory(root);
    let status = { hasBackup: false, exportedAt: null, source: null, backups: 0, appVersion: null };
    try {
        status = cloudSync.readStatus(dir);
    } catch (err) {
        console.warn('Failed to read cloud backup status:', err.message);
    }

    return {
        provider,
        folder,
        root,
        backupDir: dir,
        connected: provider !== 'none',
        available: provider === 'custom'
            ? Boolean(folder) && fs.existsSync(folder)
            : Boolean(cloudSync.resolveProviderRoot(provider)),
        detected: cloudSync.detectProviders(),
        lastSync: db.getSetting('cloud_last_sync') || '',
        auto: db.getSetting('cloud_auto') !== 'false',
        ...status
    };
}

function performCloudSync(reason = 'manual') {
    const { provider } = cloudSettings();
    if (provider === 'none') {
        return { success: false, error: 'not_connected' };
    }

    try {
        const dir = cloudSync.backupDirectory(cloudRoot());
        const hasContent = db.databaseHasContent();
        const existing = cloudSync.readStatus(dir);

        // An empty local database must never destroy a usable cloud backup.
        if (!hasContent && existing.hasBackup) {
            return { success: false, error: 'empty_local', status: cloudStatusPayload() };
        }

        // The snapshot is exported from the in-memory database; force-saving the
        // file first would duplicate a full synchronous write on every debounce.
        const snapshot = cloudSync.buildSnapshot({
            database: db.exportDatabase(),
            appVersion: app.getVersion()
        });
        const result = cloudSync.writeSnapshot(dir, snapshot);
        db.setSetting('cloud_last_sync', snapshot.exportedAt);
        if (integrationService) {
            integrationService.notify('sync', { exportedAt: snapshot.exportedAt, file: result.file });
        }
        return {
            success: true,
            reason,
            path: result.file,
            exportedAt: snapshot.exportedAt,
            status: cloudStatusPayload()
        };
    } catch (err) {
        console.error('Cloud backup failed:', err);
        return { success: false, error: 'write_failed', status: cloudStatusPayload() };
    }
}

function scheduleCloudSync() {
    if (db.getSetting('cloud_auto') === 'false') return;
    if ((db.getSetting('cloud_provider') || 'none') === 'none') return;
    if (syncTimer) clearTimeout(syncTimer);
    // One debounce for rapid edits (typing a name, dragging a category).
    syncTimer = setTimeout(() => {
        syncTimer = null;
        performCloudSync('auto');
    }, 400);
}

function flushCloudSync() {
    // Only a debounced write can be pending; when auto-sync is off no timer was
    // scheduled, and quitting must not write a backup behind the user's back.
    const hasPendingWrite = Boolean(syncTimer);
    if (syncTimer) {
        clearTimeout(syncTimer);
        syncTimer = null;
    }
    if (hasPendingWrite && (db.getSetting('cloud_provider') || 'none') !== 'none') {
        performCloudSync('exit');
    }
}

function applyRestoredState() {
    const language = resolveLanguage(db.getSetting('language'), app.getLocale());
    setLang(language);
    is_muted = db.getSetting('muted') === 'true';
    if (is_muted) stopHook();
    else startHook();

    const iconMode = db.getSetting('app_icon') || 'theme';
    applyWindowIcon(iconMode);
    updateShortcutIcons(iconMode);
    setupTray();
    registerGlobalShortcut();

    const profiles = db.getProfiles();
    ensureValidSelectedProfile(profiles);
    const selected = db.getSetting('selected_profile');
    if (selected && selected !== 'default') loadProfileIntoMemory(selected);
    else current_pack_data = null;

    sendToRenderer('settings-restored', null);
    sendToRenderer('mute-status-changed', is_muted);
}

function setupJumpList() {
    if (process.platform !== 'win32') return;
    try {
        app.setJumpList([
            {
                type: 'tasks',
                items: [
                    {
                        type: 'task',
                        program: process.execPath,
                        args: '--view=settings',
                        iconPath: process.execPath,
                        iconIndex: 0,
                        title: t('tray.settings'),
                        description: t('tray.settings')
                    },
                    {
                        type: 'task',
                        program: process.execPath,
                        args: '--view=docs',
                        iconPath: process.execPath,
                        iconIndex: 0,
                        title: t('tray.docs'),
                        description: t('tray.docs')
                    },
                    {
                        type: 'task',
                        program: process.execPath,
                        args: '--view=custom',
                        iconPath: process.execPath,
                        iconIndex: 0,
                        title: t('tray.open'),
                        description: t('tray.open')
                    }
                ]
            }
        ]);
    } catch (err) {
        console.warn('Failed to build the jump list:', err.message);
    }
}

function readRequestedView(argv) {
    const arg = (argv || []).find((value) => value.startsWith('--view='));
    return arg ? arg.slice(7) : null;
}

function showNotification(title, body) {
    if (db.getSetting('notifications') === 'false') return false;
    if (!Notification.isSupported()) return false;
    try {
        const notification = new Notification({
            title: String(title || 'Tactile'),
            body: String(body || ''),
            icon: nativeImage.createFromPath(path.join(__dirname, 'assets', 'icon.png')),
            // Windows plays the system notification sound unless the payload
            // asks for silence; the setting controls exactly that.
            silent: db.getSetting('sound_feedback') === 'false'
        });
        notification.on('click', openWindow);
        notification.show();
        return true;
    } catch (err) {
        console.warn('Failed to show a desktop notification:', err.message);
        return false;
    }
}

function getAutoUpdater() {
    if (process.windowsStore) return null;
    if (updater) return updater;
    try {
        // electron-updater is optional at runtime: a development checkout without
        // the dependency still starts, and Store builds are updated by Windows.
        const { autoUpdater } = require('electron-updater');
        autoUpdater.autoDownload = false;
        autoUpdater.autoInstallOnAppQuit = true;
        autoUpdater.on('checking-for-update', () => sendToRenderer('update-status', { state: 'checking' }));
        autoUpdater.on('update-available', (info) => {
            sendToRenderer('update-status', { state: 'available', version: info.version });
            showNotification(t('notify.update_title'), tf('notify.update_body', info.version));
        });
        autoUpdater.on('update-not-available', () => sendToRenderer('update-status', { state: 'latest' }));
        autoUpdater.on('download-progress', (progress) => {
            sendToRenderer('update-status', {
                state: 'downloading',
                percent: Math.round(progress.percent || 0)
            });
        });
        autoUpdater.on('update-downloaded', () => sendToRenderer('update-status', { state: 'ready' }));
        autoUpdater.on('error', (err) => {
            console.warn('Update error:', err.message);
            sendToRenderer('update-status', { state: 'error' });
        });
        updater = autoUpdater;
        return updater;
    } catch (err) {
        return null;
    }
}

function startHook() {
    if (hook_started) return;
    try {
        uIOhook.start();
        hook_started = true;
    } catch (err) {
        console.error('Failed to start the keyboard hook:', err);
    }
}

function stopHook() {
    activeKeys.clear();
    if (!hook_started) return;
    try {
        uIOhook.stop();
    } catch (err) {
        console.warn('Failed to stop the keyboard hook:', err);
    }
    hook_started = false;
}

function setMuted(muted, { persist = true } = {}) {
    is_muted = Boolean(muted);
    if (persist) db.setSetting('muted', is_muted ? 'true' : 'false');

    if (is_muted) {
        stopHook();
    } else {
        startHook();
    }

    setupTray();
    sendToRenderer('mute-status-changed', is_muted);
    if (integrationService) integrationService.notify('mute', { muted: is_muted });
    // Mute is part of the backup; a hotkey toggle must reach it too.
    scheduleCloudSync();
}

function toggleMute() {
    setMuted(!is_muted);
}

function adjustVolume(delta) {
    const current = Number.parseInt(db.getSetting('volume') || '50', 10) || 0;
    const next = Math.max(0, Math.min(100, current + delta));
    db.setSetting('volume', String(next));
    sendToRenderer('volume-changed', next);
    scheduleCloudSync();
    return next;
}

function openWindow() {
    if (!win || win.isDestroyed()) {
        createWindow(true);
        return;
    }
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
}

function setupServices() {
    const userDataPath = app.getPath('userData');

    aiService = createAiService({
        userDataPath,
        docsDir: path.join(__dirname, '..', 'docs'),
        getSetting: (key) => db.getSetting(key),
        setSetting: (key, value) => db.setSetting(key, value),
        onProgress: (payload) => sendToRenderer('ai-pull-progress', payload)
    });

    integrationService = createIntegrationService({
        userDataPath,
        appVersion: app.getVersion(),
        getSetting: (key) => db.getSetting(key),
        actions: {
            status: () => {
                const id = db.getSetting('selected_profile');
                const profile = id && id !== 'default' ? db.getProfileRow(id) : null;
                return {
                    version: app.getVersion(),
                    profile: profile ? { id: profile.id, name: profile.name, type: profile.type } : null,
                    muted: is_muted,
                    volume: Number.parseInt(db.getSetting('volume') || '50', 10) || 0,
                    cloud: cloudStatusPayload()
                };
            },
            profiles: () => db.getProfiles(),
            activateProfile: (id) => {
                if (typeof id !== 'string' || !db.getProfileRow(id)) return { success: false };
                db.setSetting('selected_profile', id);
                const success = loadProfileIntoMemory(id);
                if (success && integrationService) integrationService.notify('profile', { id });
                return { success };
            },
            setMuted: (muted) => {
                setMuted(Boolean(muted));
                return { success: true, muted: is_muted };
            },
            setVolume: (level) => {
                const next = Math.max(0, Math.min(100, Math.round(Number(level) || 0)));
                db.setSetting('volume', String(next));
                sendToRenderer('volume-changed', next);
                if (integrationService) integrationService.notify('volume', { level: next });
                return { success: true, level: next };
            },
            sync: () => performCloudSync('api'),
            ask: (question) => (aiService ? aiService.ask(question) : { answer: '', sources: [] }),
            search: (query) => (aiService ? aiService.search(query, 6) : [])
        }
    });

    integrationService.applyApiSetting().catch((err) => {
        console.warn('Local API could not start:', err.message);
    });
}

async function initializeApp() {
    app.setAppUserModelId('dev.vellium.tactile');

    try {
        await db.initDB();
    } catch (err) {
        console.error('Database initialization failed:', err);
        dialog.showErrorBox(t('error.db_title'), t('error.db_message'));
        app.quit();
        return;
    }

    // Resolve the stored language once, in the process that knows the OS locale
    // (app.getLocale()). The resolved code is written back so the renderer never
    // has to guess a different language from navigator.* and the two stay in sync.
    // A language picked in the setup wizard (installer-language.txt) outranks the
    // OS locale on a fresh install, because the user chose it explicitly.
    const storedLanguage = db.getSetting('language');
    const installerLanguage = consumeInstallerLanguage();
    const activeLanguage = isSupportedLang(storedLanguage)
        ? storedLanguage
        : (installerLanguage || resolveLanguage(storedLanguage, app.getLocale()));
    if (!isSupportedLang(storedLanguage)) {
        db.setSetting('language', activeLanguage);
    }
    setLang(activeLanguage);
    db.loadDefaultPacks();
    setupServices();

    is_muted = db.getSetting('muted') === 'true';
    const profiles = db.getProfiles();
    ensureValidSelectedProfile(profiles);

    // Resolve the requested view before the window exists: did-finish-load may
    // fire right after loadFile, and it consumes pendingView.
    pendingView = readRequestedView(process.argv);
    createWindow(shouldShowWindowOnLaunch());
    setupHook();
    setupTray();
    registerGlobalShortcut();
    syncStartupSetting();
    setupJumpList();
    updateShortcutIcons(db.getSetting('app_icon') || 'theme');

    const activeProfileId = db.getSetting('selected_profile');
    if (activeProfileId && activeProfileId !== 'default') {
        loadProfileIntoMemory(activeProfileId);
    }

    // Finish an interrupted backup from the previous session.
    scheduleCloudSync();
}

function ensureValidSelectedProfile(profiles) {
    const selected = db.getSetting('selected_profile');
    if (profiles.some((profile) => profile.id === selected)) return;

    const nextId = profiles.length > 0 ? profiles[0].id : 'default';
    db.setSetting('selected_profile', nextId);
}

function shouldShowWindowOnLaunch() {
    const startHidden = db.getSetting('start_minimized') === 'true';
    const trayEnabled = db.getSetting('tray_icon') === 'true';
    // "Start minimized" is an autostart behaviour: it must only hide the window
    // when Windows launched the app via the login item, never when the user
    // double-clicks the shortcut manually.
    const launchedAtLogin = process.argv.includes('--startup');
    if (!startHidden || !launchedAtLogin) return true;
    // Never start hidden without a tray icon: the window would be unreachable.
    return !trayEnabled;
}

function syncStartupSetting() {
    if (!app.isPackaged) return;
    try {
        app.setLoginItemSettings({
            openAtLogin: db.getSetting('start_minimized') === 'true',
            args: ['--startup']
        });
    } catch (err) {
        console.warn('Failed to update login item settings:', err.message);
    }
}

function registerGlobalShortcut() {
    // Only fall back to the default when the setting was never written.
    // Using `||` treated the user's explicit "no shortcut" ('') as unset and
    // re-registered Control+K on every launch after they cleared it.
    const stored = db.getSetting('shortcut_toggle_mute');
    const shortcut = stored === null || stored === undefined ? 'Control+K' : stored;
    const storedQuickTask = db.getSetting('shortcut_quick_task');
    const quickTask = storedQuickTask === null || storedQuickTask === undefined
        ? 'Control+Alt+N'
        : storedQuickTask;

    globalShortcut.unregisterAll();

    if (shortcut) {
        try {
            const success = globalShortcut.register(shortcut, toggleMute);
            if (!success) {
                console.warn('Failed to register global shortcut:', shortcut);
            }
        } catch (err) {
            console.warn('Failed to register global shortcut:', shortcut, err.message);
        }
    }

    if (quickTask) {
        try {
            const success = globalShortcut.register(quickTask, () => {
                openWindow();
                navigateTo('custom');
            });
            if (!success) {
                console.warn('Failed to register quick-task shortcut:', quickTask);
            }
        } catch (err) {
            console.warn('Failed to register quick-task shortcut:', quickTask, err.message);
        }
    }
}

function buildSinglePackPayload(profile) {
    const soundData = {
        type: 'single',
        src: [],
        format: [],
        sprite: keycodesRemap(profile.defines || {})
    };

    if (!profile.sound_file) {
        console.warn('Single-type profile has no sound file:', profile.id);
        return soundData;
    }

    const fullPath = resolveWithinPath(profile.folder_path, profile.sound_file);
    if (!fullPath || !fs.existsSync(fullPath)) {
        console.warn('Sound file is missing or outside of the pack folder:', profile.sound_file);
        return soundData;
    }

    try {
        soundData.src = [profile.sound_base64 || fileToDataUri(fullPath)];
        soundData.format = [getAudioExtension(fullPath)];
    } catch (err) {
        console.error('Failed to read single pack sound:', fullPath, err.message);
    }

    return soundData;
}

function buildMultiPackPayload(profile) {
    const defines = profile.defines && typeof profile.defines === 'object' ? profile.defines : {};
    const resolved = resolveMultiDefines({
        defines,
        fallbackDown: profile.sound_file,
        fallbackUp: profile.sound_up,
        keycodes: Object.keys(keycodesFill(defines))
    });
    const remapped = keycodesRemap(resolved);

    const soundData = { type: 'multi', data: {}, sources: {} };

    for (const [soundId, fileName] of Object.entries(remapped)) {
        if (typeof fileName !== 'string' || fileName === '') continue;

        const fullPath = resolveWithinPath(profile.folder_path, fileName);
        if (!fullPath || !fs.existsSync(fullPath)) continue;

        const sourceKey = fileName.split(path.sep).join('/');
        if (!soundData.sources[sourceKey]) {
            try {
                soundData.sources[sourceKey] = {
                    src: fileToDataUri(fullPath),
                    format: [getAudioExtension(fullPath)]
                };
            } catch (err) {
                console.warn('Failed to read multi pack sound:', fullPath, err.message);
                continue;
            }
        }

        soundData.data[soundId] = sourceKey;
    }

    return soundData;
}

function loadProfileIntoMemory(profileId) {
    try {
        const row = db.getProfileRow(profileId);
        if (!row) {
            current_pack_data = null;
            sendToRenderer('load-pack-sounds', { type: 'multi', data: {}, sources: {} });
            return false;
        }

        const profile = db.getProfileDetails(profileId, { includeSound: row.key_define_type !== 'multi' });
        if (!profile) {
            current_pack_data = null;
            return false;
        }

        // Keep only the light metadata in memory; base64 payloads are large.
        current_pack_data = { id: profile.id, key_define_type: profile.key_define_type };

        const soundData = profile.key_define_type === 'multi'
            ? buildMultiPackPayload(profile)
            : buildSinglePackPayload(profile);

        sendToRenderer('load-pack-sounds', soundData);
        return true;
    } catch (err) {
        console.error('Failed to load profile into memory:', profileId, err);
        return false;
    }
}

function setupHook() {
    if (!is_muted) startHook();

    uIOhook.on('keydown', (event) => {
        if (activeKeys.has(event.keycode)) return;
        activeKeys.add(event.keycode);

        if (is_muted || !current_pack_data) return;
        sendToRenderer('play-sound', {
            type: current_pack_data.key_define_type || 'single',
            sound_id: `keycode-${event.keycode}`
        });
    });

    uIOhook.on('keyup', (event) => {
        activeKeys.delete(event.keycode);

        if (is_muted || !current_pack_data) return;
        sendToRenderer('play-sound', {
            type: current_pack_data.key_define_type || 'single',
            sound_id: `keycode-${event.keycode}-up`
        });
    });
}

function createWindow(show) {
    app.isQuiting = false;
    win = new BrowserWindow({
        width: 1078,
        height: 705,
        minWidth: 800,
        minHeight: 500,
        frame: false, // Custom titlebar
        transparent: false,
        backgroundColor: '#1A2E40', // Deep navy background
        icon: getWindowIconPath(),
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            autoplayPolicy: 'no-user-gesture-required'
        },
        show: Boolean(show)
    });

    win.loadFile(path.join(__dirname, 'app.html')).catch((err) => {
        console.error('Failed to load the application window:', err);
    });

    // Keep the custom titlebar's maximize/restore glyph in sync with reality.
    const sendWindowState = () => {
        if (win && !win.isDestroyed()) {
            win.webContents.send('window-state', win.isMaximized());
        }
    };
    win.on('maximize', sendWindowState);
    win.on('unmaximize', sendWindowState);

    // The renderer never needs to open new windows or navigate away.
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (event, url) => {
        if (url !== win.webContents.getURL()) event.preventDefault();
    });

    // The app plays local audio only; nothing it renders needs camera,
    // microphone, geolocation, notifications or clipboard access. Without a
    // handler Electron grants these by default, so any future XSS in the
    // renderer could silently record from the microphone.
    win.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => {
        callback(false);
    });
    win.webContents.session.setPermissionCheckHandler(() => false);

    win.webContents.on('did-finish-load', () => {
        if (current_pack_data) {
            loadProfileIntoMemory(current_pack_data.id);
        }
        if (pendingView) {
            win.webContents.send('navigate', pendingView);
            pendingView = null;
        }
    });

    win.on('close', (event) => {
        if (app.isQuiting) return;

        const behavior = db.getSetting('close_behavior') || 'tray';
        const trayEnabled = db.getSetting('tray_icon') === 'true' && tray;

        if (behavior === 'quit') {
            app.isQuiting = true;
            return;
        }

        if (behavior === 'ask') {
            event.preventDefault();
            askCloseBehavior();
            return;
        }

        if (trayEnabled) {
            event.preventDefault();
            win.hide();
            return;
        }

        // Without a tray icon, hiding the window would leave the app
        // unreachable. Let the close go through and quit normally.
        app.isQuiting = true;
    });

    win.on('closed', () => {
        win = null;
    });
}

function askCloseBehavior() {
    if (!win || win.isDestroyed()) return;

    // Only offer "minimize to tray" when there is actually a tray icon to
    // restore the window from; otherwise hiding would strand the app.
    const trayEnabled = db.getSetting('tray_icon') === 'true' && Boolean(tray);
    const buttons = trayEnabled
        ? [t('settings.close_tray'), t('settings.close_quit'), t('dialog.cancel')]
        : [t('settings.close_quit'), t('dialog.cancel')];

    dialog.showMessageBox(win, {
        type: 'question',
        buttons,
        defaultId: 0,
        cancelId: buttons.length - 1,
        title: 'Tactile',
        message: t('settings.close_title'),
        detail: t('settings.close_desc')
    }).then((result) => {
        if (!win || win.isDestroyed()) return;
        if (trayEnabled && result.response === 0) {
            win.hide();
            return;
        }
        const quitIndex = trayEnabled ? 1 : 0;
        if (result.response === quitIndex) {
            app.isQuiting = true;
            app.quit();
        }
    }).catch((err) => console.warn('Close dialog failed:', err.message));
}

function setupTray() {
    if (db.getSetting('tray_icon') !== 'true') {
        if (tray) {
            tray.destroy();
            tray = null;
        }
        // A pending single-click timer would still fire 250 ms later and run a
        // tray action for an icon that no longer exists (e.g. toggling mute or
        // adjusting volume after the user turned the tray icon off).
        if (clickTimeout) {
            clearTimeout(clickTimeout);
            clickTimeout = null;
        }
        return;
    }

    if (!tray) {
        const trayIconPath = fs.existsSync(SYSTRAY_ICON) ? SYSTRAY_ICON : path.join(__dirname, 'assets', 'icon.png');
        tray = new Tray(trayIconPath);
        tray.setToolTip('Tactile');

        tray.on('click', () => {
            // A pending timer means this is the second click of a double click.
            // The `double-click` handler below performs the double action.
            if (clickTimeout) {
                clearTimeout(clickTimeout);
                clickTimeout = null;
            }
            clickTimeout = setTimeout(() => {
                clickTimeout = null;
                executeTrayAction('single');
            }, 250);
        });

        tray.on('double-click', () => {
            if (clickTimeout) {
                clearTimeout(clickTimeout);
                clickTimeout = null;
            }
            executeTrayAction('double');
        });
    }

    const contextMenu = Menu.buildFromTemplate([
        {
            label: t('tray.open'),
            icon: nativeImage.createFromPath(path.join(__dirname, 'assets/tray-app.png')),
            click: openWindow
        },
        {
            label: t('tray.settings'),
            click: () => {
                openWindow();
                navigateTo('settings');
            }
        },
        {
            label: t('tray.docs'),
            click: () => {
                openWindow();
                navigateTo('docs');
            }
        },
        { type: 'separator' },
        {
            label: is_muted ? t('tray.unmute') : t('tray.mute'),
            icon: nativeImage.createFromPath(path.join(__dirname, is_muted ? 'assets/tray-mute.png' : 'assets/tray-sound.png')),
            click: toggleMute
        },
        {
            label: t('tray.quit'),
            icon: nativeImage.createFromPath(path.join(__dirname, 'assets/tray-quit.png')),
            click: () => {
                app.isQuiting = true;
                app.quit();
            }
        }
    ]);

    tray.setContextMenu(contextMenu);
}

function executeTrayAction(actionType) {
    const settingKey = actionType === 'single' ? 'tray_click_single' : 'tray_click_double';
    const fallback = actionType === 'single' ? 'open' : 'none';
    const action = db.getSetting(settingKey) || fallback;

    switch (action) {
        case 'open':
            openWindow();
            break;
        case 'mute':
            toggleMute();
            break;
        case 'vol_up':
            adjustVolume(10);
            break;
        case 'vol_down':
            adjustVolume(-10);
            break;
        default:
            break;
    }
}

// IPC Handlers
ipcMain.on('window-control', (event, action) => {
    if (!win || win.isDestroyed()) return;
    if (action === 'minimize') win.minimize();
    else if (action === 'maximize') {
        if (win.isMaximized()) win.unmaximize();
        else win.maximize();
    } else if (action === 'close') {
        win.close();
    }
});

ipcMain.handle('open-external', async (event, url) => {
    try {
        const parsed = new URL(String(url));
        if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) return false;
        await shell.openExternal(parsed.toString());
        return true;
    } catch (err) {
        console.warn('Blocked invalid external URL:', err.message);
        return false;
    }
});

ipcMain.handle('set-zoom', (event, percent) => {
    if (!win || win.isDestroyed()) return false;
    const parsed = Number.parseInt(percent, 10);
    const clamped = Math.max(80, Math.min(150, Number.isFinite(parsed) ? parsed : 100));
    win.webContents.setZoomFactor(clamped / 100);
    return clamped;
});

ipcMain.handle('show-notification', (event, title, body) => showNotification(title, body));

ipcMain.handle('cloud-get-status', () => cloudStatusPayload());

ipcMain.handle('cloud-choose-folder', async () => {
    const result = await dialog.showOpenDialog(win || undefined, {
        title: t('cloud.choose_folder'),
        properties: ['openDirectory', 'createDirectory']
    });
    if (result.canceled) return null;
    return result.filePaths[0] || null;
});

ipcMain.handle('cloud-connect', async (event, provider, folder) => {
    const normalizedProvider = normalizeSetting('cloud_provider', provider);
    if (!normalizedProvider || normalizedProvider === 'none') {
        return { success: false, error: 'invalid_provider', status: cloudStatusPayload() };
    }

    let selectedFolder = '';
    if (normalizedProvider === 'custom') {
        selectedFolder = normalizeSetting('cloud_folder', folder) || '';
        if (!selectedFolder || !fs.existsSync(selectedFolder)) {
            return { success: false, error: 'invalid_folder', status: cloudStatusPayload() };
        }
    }

    db.setSetting('cloud_provider', normalizedProvider);
    db.setSetting('cloud_folder', selectedFolder);

    // Connecting to a folder that already holds a backup must never replace it
    // with this device's seeded packs. Ask the renderer to choose between
    // restoring the backup and deliberately starting fresh.
    try {
        const dir = cloudSync.backupDirectory(cloudRoot());
        if (cloudSync.readStatus(dir).hasBackup) {
            return { success: false, error: 'backup_found', status: cloudStatusPayload() };
        }
    } catch (err) {
        console.warn('Failed to inspect the existing backup:', err.message);
    }

    const result = performCloudSync('connect');
    return { ...result, status: cloudStatusPayload() };
});

ipcMain.handle('cloud-disconnect', () => {
    db.setSetting('cloud_provider', 'none');
    db.setSetting('cloud_last_sync', '');
    if (syncTimer) {
        clearTimeout(syncTimer);
        syncTimer = null;
    }
    return { success: true, status: cloudStatusPayload() };
});

ipcMain.handle('cloud-sync', () => performCloudSync('manual'));

ipcMain.handle('cloud-open-folder', async () => {
    const dir = cloudSync.backupDirectory(cloudRoot());
    try {
        fs.mkdirSync(dir, { recursive: true });
        const error = await shell.openPath(dir);
        return { success: !error, error: error || null };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

function pruneSafetyCopies(safetyDir) {
    // Each restore leaves one file behind; keep only the five most recent so a
    // long-lived install does not accumulate hundreds of copies.
    try {
        const copies = fs.readdirSync(safetyDir)
            .filter((name) => /^tactile-local-before-restore-\d+\.json$/.test(name))
            .sort()
            .reverse();
        for (const name of copies.slice(5)) {
            try { fs.unlinkSync(path.join(safetyDir, name)); } catch (err) { /* best effort */ }
        }
    } catch (err) {
        console.warn('Failed to prune pre-restore safety copies:', err.message);
    }
}

ipcMain.handle('cloud-restore', async () => {
    try {
        const dir = cloudSync.backupDirectory(cloudRoot());
        const chain = cloudSync.readRecoveryChain(dir);
        if (!chain) return { success: false, error: 'no_backup' };

        // Keep a safety copy of the current local database before replacing it.
        try {
            const safetyDir = path.join(app.getPath('userData'), 'Backups');
            fs.mkdirSync(safetyDir, { recursive: true });
            const safetyFile = path.join(safetyDir, `tactile-local-before-restore-${Date.now()}.json`);
            const safety = cloudSync.buildSnapshot({
                database: db.exportDatabase(),
                appVersion: app.getVersion()
            });
            fs.writeFileSync(safetyFile, JSON.stringify(safety), 'utf8');
            pruneSafetyCopies(safetyDir);
        } catch (err) {
            console.warn('Failed to keep a pre-restore safety copy:', err.message);
        }

        db.restoreDatabase(chain.snapshot.data);
        applyRestoredState();
        return {
            success: true,
            source: chain.source,
            exportedAt: chain.snapshot.exportedAt,
            status: cloudStatusPayload()
        };
    } catch (err) {
        console.error('Cloud restore failed:', err);
        return { success: false, error: 'restore_failed', status: cloudStatusPayload() };
    }
});

ipcMain.handle('get-diagnostics', () => {
    let hookOk = hook_started;
    let dbOk = false;
    try {
        dbOk = Array.isArray(db.getProfiles());
    } catch (err) {
        dbOk = false;
    }

    return {
        platform: process.platform,
        osRelease: os.release(),
        arch: process.arch,
        version: app.getVersion(),
        electron: process.versions.electron,
        locale: app.getLocale(),
        language: db.getSetting('language') || '',
        dataDir: app.getPath('userData'),
        logsDir: app.getPath('logs'),
        hookOk,
        dbOk,
        trayOk: Boolean(tray),
        cloud: cloudStatusPayload(),
        memoryMB: Math.round(process.memoryUsage().rss / 1024 / 1024)
    };
});

ipcMain.handle('open-logs-folder', async () => {
    try {
        const dir = app.getPath('logs');
        fs.mkdirSync(dir, { recursive: true });
        const error = await shell.openPath(dir);
        return { success: !error, error: error || null };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

ipcMain.handle('save-diagnostics', async (event, content) => {
    try {
        const result = await dialog.showSaveDialog(win || undefined, {
            title: t('diag.export'),
            defaultPath: path.join(app.getPath('documents'), 'tactile-diagnostics.txt'),
            filters: [{ name: t('diag.export'), extensions: ['txt'] }]
        });
        if (result.canceled || !result.filePath) return { success: false, canceled: true };
        fs.writeFileSync(result.filePath, String(content || ''), 'utf8');
        return { success: true, path: result.filePath };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

ipcMain.handle('copy-text', (event, text) => {
    const { clipboard } = require('electron');
    clipboard.writeText(String(text || ''));
    return true;
});

ipcMain.handle('check-for-updates', async () => {
    if (process.windowsStore) return { supported: true, state: 'store' };
    if (!app.isPackaged) {
        return { supported: false, state: 'development', version: app.getVersion() };
    }
    const instance = getAutoUpdater();
    if (!instance) return { supported: false, state: 'unavailable', version: app.getVersion() };
    try {
        await instance.checkForUpdates();
        return { supported: true, state: 'checking', version: app.getVersion() };
    } catch (err) {
        console.warn('Update check failed:', err.message);
        return { supported: true, state: 'error', version: app.getVersion() };
    }
});

ipcMain.handle('download-update', async () => {
    const instance = getAutoUpdater();
    if (!instance) return { success: false, error: 'unavailable' };
    try {
        // Resolves when the download is verified and finished; the
        // 'update-downloaded' event already told the renderer what happens next.
        await instance.downloadUpdate();
        // Give the notice one paint before the installer replaces the app: the
        // old build never called quitAndInstall, so "the installer will start
        // now" was shown while the app simply stayed open.
        setTimeout(() => {
            app.isQuiting = true;
            try {
                instance.quitAndInstall(false, true);
            } catch (err) {
                sendToRenderer('update-status', { state: 'error' });
            }
        }, 1500);
        return { success: true };
    } catch (err) {
        console.warn('Update download failed:', err.message);
        return { success: false, error: err.message };
    }
});

ipcMain.handle('db-get-settings', () => {
    // `''` is a real value here: it means the user removed the shortcut.
    // Coercing it to the default made the cleared shortcut reappear in the UI.
    const storedShortcut = db.getSetting('shortcut_toggle_mute');
    const storedQuickTask = db.getSetting('shortcut_quick_task');
    return {
        volume: db.getSetting('volume') || '50',
        start_minimized: db.getSetting('start_minimized') || 'false',
        tray_icon: db.getSetting('tray_icon') || 'true',
        theme: db.getSetting('theme') || 'system',
        theme_palette: db.getSetting('theme_palette') || 'obsidian',
        app_icon: db.getSetting('app_icon') || 'theme',
        selected_profile: db.getSetting('selected_profile') || 'default',
        muted: db.getSetting('muted') || 'false',
        language: db.getSetting('language') || '',
        tray_click_single: db.getSetting('tray_click_single') || 'open',
        tray_click_double: db.getSetting('tray_click_double') || 'none',
        shortcut_toggle_mute: storedShortcut === null || storedShortcut === undefined ? 'Control+K' : storedShortcut,
        shortcut_quick_task: storedQuickTask === null || storedQuickTask === undefined ? 'Control+Alt+N' : storedQuickTask,
        close_behavior: db.getSetting('close_behavior') || 'tray',
        zoom: db.getSetting('zoom') || '100',
        high_contrast: db.getSetting('high_contrast') || 'false',
        reduce_motion: db.getSetting('reduce_motion') || 'false',
        notifications: db.getSetting('notifications') || 'true',
        sound_feedback: db.getSetting('sound_feedback') || 'true',
        custom_color: db.getSetting('custom_color') || '#D4AF37',
        cloud_provider: db.getSetting('cloud_provider') || 'none',
        cloud_folder: db.getSetting('cloud_folder') || '',
        cloud_auto: db.getSetting('cloud_auto') || 'true',
        cloud_last_sync: db.getSetting('cloud_last_sync') || '',
        ai_enabled: db.getSetting('ai_enabled') || 'false',
        ai_model: db.getSetting('ai_model') || '',
        ai_rag: db.getSetting('ai_rag') || 'true',
        api_enabled: db.getSetting('api_enabled') || 'false',
        api_port: db.getSetting('api_port') || '18457',
        webhook_url: db.getSetting('webhook_url') || '',
        webhook_events: db.getSetting('webhook_events') || 'profile,mute,sync',
        onboarding_done: db.getSetting('onboarding_done') || 'false'
    };
});

ipcMain.handle('db-update-setting', (event, key, rawValue) => {
    const value = normalizeSetting(key, rawValue);
    if (value === null) return false;

    const previousValue = db.getSetting(key);
    db.setSetting(key, value);

    switch (key) {
        case 'tray_icon':
            setupTray();
            break;
        case 'muted':
            setMuted(value === 'true', { persist: false });
            break;
        case 'language':
            setLang(value);
            setupTray();
            setupJumpList();
            break;
        case 'start_minimized':
            syncStartupSetting();
            break;
        case 'theme':
            if (value === 'light' || value === 'dark') {
                nativeTheme.themeSource = value;
            } else {
                nativeTheme.themeSource = 'system';
            }
            applyWindowIcon(db.getSetting('app_icon') || 'theme');
            updateShortcutIcons(db.getSetting('app_icon') || 'theme');
            break;
        case 'app_icon':
            applyWindowIcon(value);
            updateShortcutIcons(value);
            break;
        case 'close_behavior':
        case 'zoom':
        case 'high_contrast':
        case 'reduce_motion':
        case 'notifications':
        case 'sound_feedback':
        case 'custom_color':
            break;
        case 'cloud_provider':
        case 'cloud_folder':
        case 'cloud_auto':
            scheduleCloudSync();
            break;
        case 'api_enabled':
        case 'api_port':
            if (integrationService) {
                integrationService.applyApiSetting().catch((err) => {
                    console.warn('Local API could not start:', err.message);
                });
            }
            break;
        case 'shortcut_toggle_mute':
        case 'shortcut_quick_task':
            registerGlobalShortcut();
            // Report a hotkey that another application already owns instead of
            // silently saving it and leaving the user with a dead shortcut.
            if (value && !globalShortcut.isRegistered(value)) {
                const fallback = key === 'shortcut_quick_task' ? 'Control+Alt+N' : 'Control+K';
                const restored = previousValue === null || previousValue === undefined
                    ? fallback
                    : previousValue;
                db.setSetting(key, restored);
                registerGlobalShortcut();
                return false;
            }
            break;
        default:
            break;
    }

    // Every persisted setting is part of the backup. Debounced so a slider drag
    // does not write one snapshot per pixel.
    if (key !== 'cloud_last_sync') scheduleCloudSync();
    return true;
});

function updateShortcutIcons(iconType, pngBuffer) {
    if (process.platform !== 'win32') return;

    try {
        const iconMode = normalizeSetting('app_icon', iconType) || 'theme';
        const normalizedIconType = normalizeAppIconType(iconMode);
        const userDataPath = app.getPath('userData');
        const usesTint = iconMode === 'theme' || iconMode === 'custom';
        const cachedIcoPath = path.join(userDataPath, 'custom-shortcut.ico');

        let sourceIconBuffer;
        if (usesTint) {
            // The renderer renders the tinted mark; wrap the PNG into a real ICO
            // so Explorer, the taskbar and the desktop shortcut all show the
            // colour the user picked instead of the bundled gold one.
            if (pngBuffer && pngBuffer.length) {
                sourceIconBuffer = buildIcoFromPng(pngBuffer);
                try {
                    fs.mkdirSync(userDataPath, { recursive: true });
                    fs.writeFileSync(cachedIcoPath, sourceIconBuffer);
                } catch (err) {
                    console.warn('Failed to cache the tinted shortcut icon:', err.message);
                }
            } else if (fs.existsSync(cachedIcoPath)) {
                sourceIconBuffer = fs.readFileSync(cachedIcoPath);
            }
        }

        if (!sourceIconBuffer) {
            const sourceIconPath = getAppIconPath(normalizedIconType);
            if (!fs.existsSync(sourceIconPath)) {
                console.warn('Source ICO file not found:', sourceIconPath);
                return;
            }
            sourceIconBuffer = fs.readFileSync(sourceIconPath);
        }

        const iconHash = crypto.createHash('sha256').update(sourceIconBuffer).digest('hex').slice(0, 10);
        const iconBaseName = usesTint ? 'Tactile-custom' : (normalizedIconType === 'light' ? 'Tactile-light' : 'Tactile-bg');
        const managedIconFileName = `${iconBaseName}-${iconHash}.ico`;
        const destIconPath = path.join(userDataPath, managedIconFileName);
        const sharedIconPath = writeSharedShortcutIcon(sourceIconBuffer, managedIconFileName);

        // Keep shortcut icons outside app.asar so Windows can load them directly.
        fs.writeFileSync(destIconPath, sourceIconBuffer);

        const targets = getShortcutTargets();
        const now = new Date();
        let updatedCount = 0;

        targets.forEach((shortcutPath) => {
            if (!fs.existsSync(shortcutPath)) return;

            const shortcutIconPath = shouldUseSharedShortcutIcon(shortcutPath) && sharedIconPath
                ? sharedIconPath
                : destIconPath;

            if (writeShortcutIcon(shortcutPath, shortcutIconPath, now)) {
                updatedCount += 1;
            } else {
                console.warn(`Failed to update shortcut: ${shortcutPath}`);
            }
        });

        cleanupOldManagedIcons(userDataPath, destIconPath);
        if (updatedCount > 0) refreshExplorerIconCache();
    } catch (err) {
        console.error('Failed to update shortcut icons:', err);
    }
}

/**
 * Wrap a 256x256 PNG into a single-image ICO using the shared helper, so the
 * renderer's colour-tinted mark also becomes the shortcut icon.
 */

function writeSharedShortcutIcon(iconBuffer, iconFileName) {
    const sharedIconPath = getSharedShortcutIconPath(iconFileName);
    if (!sharedIconPath) return null;

    try {
        fs.mkdirSync(path.dirname(sharedIconPath), { recursive: true });
        fs.writeFileSync(sharedIconPath, iconBuffer);
        fs.utimesSync(sharedIconPath, new Date(), new Date());
        return sharedIconPath;
    } catch (err) {
        console.warn('Shared shortcut icon is not writable:', sharedIconPath, err.message);
        return fs.existsSync(sharedIconPath) ? sharedIconPath : null;
    }
}

function shouldUseSharedShortcutIcon(shortcutPath) {
    const normalizedShortcutPath = path.normalize(shortcutPath).toLowerCase();
    const sharedRoots = [];

    if (process.env.PUBLIC) {
        sharedRoots.push(path.normalize(path.join(process.env.PUBLIC, 'Desktop')).toLowerCase());
    }

    if (process.env.ProgramData) {
        sharedRoots.push(path.normalize(path.join(process.env.ProgramData, 'Microsoft/Windows/Start Menu/Programs')).toLowerCase());
    }

    return sharedRoots.some((rootPath) => normalizedShortcutPath.startsWith(`${rootPath}${path.sep}`) || normalizedShortcutPath === rootPath);
}

function writeShortcutIcon(shortcutPath, iconPath, timestamp) {
    let existingShortcut = null;
    try {
        existingShortcut = shell.readShortcutLink(shortcutPath);
    } catch (err) {
        // Not a readable shortcut; writeShortcutLink will report the failure.
    }

    const shortcutOptions = {
        icon: iconPath,
        iconIndex: 0
    };

    let updateSuccess = shell.writeShortcutLink(shortcutPath, 'update', shortcutOptions);
    if (existingShortcut && existingShortcut.target) {
        if (!updateSuccess) {
            updateSuccess = shell.writeShortcutLink(shortcutPath, 'replace', {
                ...existingShortcut,
                ...shortcutOptions
            });
        }
    }

    if (updateSuccess) {
        try {
            fs.utimesSync(shortcutPath, timestamp, timestamp);
        } catch (err) {
            console.warn('Failed to touch shortcut:', shortcutPath, err.message);
        }
    }

    return updateSuccess;
}

function getShortcutTargets() {
    const knownCandidates = [
        path.join(app.getPath('desktop'), 'Tactile.lnk'),
        path.join(app.getPath('appData'), 'Microsoft/Windows/Start Menu/Programs/Tactile.lnk'),
        path.join(app.getPath('appData'), 'Microsoft/Internet Explorer/Quick Launch/User Pinned/TaskBar/Tactile.lnk'),
        path.join(app.getPath('appData'), 'Microsoft/Windows/Start Menu/Programs/Tactile/Tactile.lnk')
    ];
    const searchRoots = [
        app.getPath('desktop'),
        path.join(app.getPath('appData'), 'Microsoft/Windows/Start Menu/Programs'),
        path.join(app.getPath('appData'), 'Microsoft/Internet Explorer/Quick Launch/User Pinned/TaskBar')
    ];

    if (process.env.PUBLIC) {
        knownCandidates.push(path.join(process.env.PUBLIC, 'Desktop/Tactile.lnk'));
        searchRoots.push(path.join(process.env.PUBLIC, 'Desktop'));
    }

    if (process.env.ProgramData) {
        const programDataPrograms = path.join(process.env.ProgramData, 'Microsoft/Windows/Start Menu/Programs');
        knownCandidates.push(path.join(programDataPrograms, 'Tactile.lnk'));
        knownCandidates.push(path.join(programDataPrograms, 'Tactile/Tactile.lnk'));
        searchRoots.push(programDataPrograms);
    }

    const discoveredCandidates = searchRoots.flatMap((root) => findTactileShortcuts(root, 2));
    return [...new Set([...knownCandidates, ...discoveredCandidates].map((shortcutPath) => path.normalize(shortcutPath)))];
}

function findTactileShortcuts(rootPath, maxDepth) {
    const results = [];
    if (!rootPath || !fs.existsSync(rootPath)) return results;

    const walk = (currentPath, depth) => {
        let entries = [];
        try {
            entries = fs.readdirSync(currentPath, { withFileTypes: true });
        } catch (err) {
            return;
        }

        entries.forEach((entry) => {
            const entryPath = path.join(currentPath, entry.name);
            if (entry.isDirectory()) {
                if (depth < maxDepth) walk(entryPath, depth + 1);
                return;
            }

            if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== '.lnk') return;
            if (isTactileShortcut(entryPath)) results.push(entryPath);
        });
    };

    walk(rootPath, 0);
    return results;
}

function isTactileShortcut(shortcutPath) {
    const shortcutName = path.basename(shortcutPath).toLowerCase();
    if (shortcutName === 'tactile.lnk') return true;

    try {
        const shortcut = shell.readShortcutLink(shortcutPath);
        return path.basename(shortcut.target || '').toLowerCase() === 'tactile.exe';
    } catch (err) {
        return false;
    }
}

function cleanupOldManagedIcons(userDataPath, activeIconPath) {
    try {
        fs.readdirSync(userDataPath)
            // Only versioned managed copies are removed; the tinted cache
            // (custom-shortcut.ico) and anything else the user keeps stay.
            .filter((fileName) => /^Tactile-(bg|light|custom)-[a-f0-9]{10}\.ico$/i.test(fileName))
            .map((fileName) => path.join(userDataPath, fileName))
            .filter((iconPath) => path.normalize(iconPath).toLowerCase() !== path.normalize(activeIconPath).toLowerCase())
            .forEach((iconPath) => fs.rmSync(iconPath, { force: true }));
    } catch (err) {
        console.warn('Failed to clean old shortcut icons:', err.message);
    }
}

function refreshExplorerIconCache() {
    const ie4uinit = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/ie4uinit.exe');
    if (!fs.existsSync(ie4uinit)) return;

    execFile(ie4uinit, ['-ClearIconCache'], { windowsHide: true }, () => {});
    execFile(ie4uinit, ['-show'], { windowsHide: true }, () => {});
}

ipcMain.handle('set-dynamic-app-icon', (event, pngDataUrl, iconType) => {
    if (!win || win.isDestroyed()) return false;
    try {
        if (typeof pngDataUrl !== 'string' || !pngDataUrl.startsWith('data:image/') || pngDataUrl.length > 8 * 1024 * 1024) {
            return false;
        }

        let image = nativeImage.createFromDataURL(pngDataUrl);
        if (image.isEmpty() && iconType) {
            image = nativeImage.createFromPath(getAppIconPath(iconType));
        }

        if (image.isEmpty()) return false;

        win.setIcon(image);
        if (iconType) {
            // The renderer sends the selected icon mode; "theme"/"custom" also
            // hand over the rendered PNG so the shortcut icon matches the tint.
            updateShortcutIcons(iconType, image.toPNG());
        }
        return true;
    } catch (err) {
        console.error('Failed to dynamically set app icon:', err);
        return false;
    }
});

ipcMain.handle('get-svg-data-uri', (event, iconType) => {
    try {
        const type = typeof iconType === 'string' ? iconType : '';
        const isLight = type.includes('light');
        const isSmall = type.includes('small');
        const fileName = isLight
            ? (isSmall ? '../public/Tactile-light-small.svg' : '../public/Tactile-light.svg')
            : (isSmall ? '../public/Tactile-bg-small.svg' : '../public/Tactile-bg.svg');
        const svgPath = path.join(__dirname, fileName);
        if (!fs.existsSync(svgPath)) return null;

        const svgContent = fs.readFileSync(svgPath, 'utf-8');
        return `data:image/svg+xml;base64,${Buffer.from(svgContent).toString('base64')}`;
    } catch (err) {
        console.error('Failed to read SVG:', err);
        return null;
    }
});

ipcMain.handle('db-get-profiles', () => db.getProfiles());

ipcMain.handle('db-get-profile-details', (event, id) => {
    const details = db.getProfileDetails(id);
    if (!details) return null;

    if (!details.sound_base64) {
        attachPreviewSound(details);
    }

    return details;
});

function attachPreviewSound(details) {
    const candidates = [];
    if (details.sound_file) candidates.push(details.sound_file);

    if (details.key_define_type === 'multi') {
        const firstDefine = Object.values(details.defines || {}).find((value) => typeof value === 'string' && value);
        if (firstDefine) candidates.push(firstDefine);
    }

    for (const relativePath of candidates) {
        const fullPath = resolveWithinPath(details.folder_path, relativePath);
        if (!fullPath || !fs.existsSync(fullPath)) continue;
        try {
            details.sound_base64 = fileToDataUri(fullPath);
            details.sound_format = getAudioExtension(fullPath);
            return details;
        } catch (err) {
            console.warn('Failed to read preview sound file:', fullPath, err.message);
        }
    }

    return details;
}

ipcMain.handle('db-delete-profile', (event, id) => {
    const deleted = db.deleteProfile(id);
    if (!deleted) return false;

    if (db.getSetting('selected_profile') === id) {
        const remaining = db.getProfiles();
        const nextId = remaining.length > 0 ? remaining[0].id : 'default';
        db.setSetting('selected_profile', nextId);
        if (nextId !== 'default') {
            loadProfileIntoMemory(nextId);
        } else {
            current_pack_data = null;
            sendToRenderer('load-pack-sounds', { type: 'multi', data: {}, sources: {} });
        }
    }

    return true;
});

ipcMain.handle('db-update-profile-order', (event, ids) => db.updateProfileOrder(ids));
ipcMain.handle('db-update-profile-details', (event, id, name, type, material, desc) => {
    return db.updateProfileDetails(id, name, type, material, desc);
});
ipcMain.handle('db-get-categories', () => db.getCategories());
ipcMain.handle('db-create-category', (event, name) => db.createCategory(name));

ipcMain.handle('db-delete-category', (event, id) => {
    const deleted = db.deleteCategory(id);
    if (!deleted) return false;

    const activeId = db.getSetting('selected_profile');
    const activeStillExists = db.getProfiles().some((profile) => profile.id === activeId);
    if (!activeStillExists) {
        const remaining = db.getProfiles();
        const nextId = remaining.length > 0 ? remaining[0].id : 'default';
        db.setSetting('selected_profile', nextId);
        if (nextId !== 'default') {
            loadProfileIntoMemory(nextId);
        } else {
            // Same teardown as db-delete-profile: without this the deleted
            // category's sounds stayed loaded in the hook and kept playing.
            current_pack_data = null;
            sendToRenderer('load-pack-sounds', { type: 'multi', data: {}, sources: {} });
        }
    }

    return true;
});

ipcMain.handle('db-update-category-order', (event, ids) => db.updateCategoryOrder(ids));
ipcMain.handle('db-rename-category', (event, id, name) => db.renameCategory(id, name));

ipcMain.handle('set-active-profile', (event, id) => {
    if (!db.getProfileRow(id)) return { success: false };
    db.setSetting('selected_profile', id);
    const success = loadProfileIntoMemory(id);
    if (success && integrationService) integrationService.notify('profile', { id });
    return { success };
});

ipcMain.handle('get-app-version', () => app.getVersion());

// ---------------------------------------------------------------------------
// Local assistant, integrations and publisher identity
// ---------------------------------------------------------------------------
function requireAiService() {
    if (!aiService) throw new Error('The assistant is not ready yet');
    return aiService;
}

function requireIntegrationService() {
    if (!integrationService) throw new Error('Integrations are not ready yet');
    return integrationService;
}

ipcMain.handle('ai-get-status', () => requireAiService().status());
ipcMain.handle('ai-toggle', (event, enabled) => requireAiService().toggle(enabled));
ipcMain.handle('ai-refresh', () => requireAiService().status());
ipcMain.handle('ai-list-models', async () => (await requireAiService().status()).catalog);
ipcMain.handle('ai-pull-model', (event, id) => requireAiService().pull(id));
ipcMain.handle('ai-delete-model', (event, id) => requireAiService().remove(id));
ipcMain.handle('ai-reindex', () => requireAiService().reindex());
ipcMain.handle('ai-ask', (event, question) => requireAiService().ask(question));
ipcMain.handle('ai-search-docs', (event, query, limit) => requireAiService().search(query, limit));
ipcMain.handle('ai-open-runtime', () => shell.openExternal('https://ollama.com/download'));

ipcMain.handle('integration-status', () => requireIntegrationService().status());
ipcMain.handle('integration-set-api', async (event, enabled, port) => {
    const normalizedEnabled = normalizeSetting('api_enabled', enabled);
    const normalizedPort = normalizeSetting('api_port', port);
    if (normalizedEnabled === null || normalizedPort === null) return { success: false };
    db.setSetting('api_enabled', normalizedEnabled);
    db.setSetting('api_port', normalizedPort);
    await requireIntegrationService().applyApiSetting();
    return { success: true, status: requireIntegrationService().status() };
});
ipcMain.handle('integration-install-mcp', () => requireIntegrationService().installMcp());
ipcMain.handle('integration-install-cli', () => requireIntegrationService().installCli());
ipcMain.handle('integration-open-config', (event, target) => {
    const status = requireIntegrationService().status();
    const file = target === 'cli' ? status.cli.path : status.mcp.configPath;
    try {
        shell.showItemInFolder(file);
        return { success: true, path: file };
    } catch (err) {
        return { success: false, error: err.message };
    }
});
ipcMain.handle('webhook-save', (event, url, secret, events) => {
    const normalizedUrl = normalizeSetting('webhook_url', url);
    const normalizedSecret = normalizeSetting('webhook_secret', secret);
    const normalizedEvents = normalizeSetting('webhook_events', events);
    if (normalizedUrl === null || normalizedSecret === null || normalizedEvents === null) {
        return { success: false };
    }
    // The secret is write only: it is never sent back to the renderer, so a
    // blank field means "keep the stored one" instead of "erase it". Removing
    // the endpoint clears the secret together with the URL.
    const storedSecret = db.getSetting('webhook_secret') || '';
    const nextSecret = normalizedUrl === '' ? '' : (normalizedSecret || storedSecret);
    db.setSetting('webhook_url', normalizedUrl);
    db.setSetting('webhook_secret', nextSecret);
    db.setSetting('webhook_events', normalizedEvents);
    return { success: true, status: requireIntegrationService().status().webhook };
});
ipcMain.handle('webhook-test', () => requireIntegrationService().testWebhook());

ipcMain.handle('brand-get-info', () => ({
    product: BRAND.product,
    company: BRAND.company,
    companyLegal: BRAND.companyLegal,
    copyright: BRAND.copyright,
    version: app.getVersion(),
    website: BRAND.website,
    productPage: BRAND.productPage,
    github: BRAND.github,
    sponsor: BRAND.sponsor,
    docs: BRAND.docs,
    storeUrl: BRAND.storeUrl,
    storeSigningIncluded: BRAND.storeSigningIncluded,
    emails: BRAND.emails,
    legal: BRAND.legal,
    social: BRAND.social
}));

// Select Folder/File Dialog API
ipcMain.handle('select-directory', async () => {
    try {
        const result = await dialog.showOpenDialog(win || undefined, {
            title: t('import.select_folder'),
            properties: ['openDirectory']
        });
        if (result.canceled) return null;
        return result.filePaths[0] || null;
    } catch (err) {
        console.error('Directory selection failed:', err);
        return null;
    }
});

ipcMain.handle('select-audio-file', async () => {
    try {
        const result = await dialog.showOpenDialog(win || undefined, {
            title: t('modal.choose_audio'),
            properties: ['openFile'],
            filters: [{ name: t('dialog.audio_files'), extensions: ['mp3', 'wav', 'ogg'] }]
        });
        if (result.canceled) return null;
        return result.filePaths[0] || null;
    } catch (err) {
        console.error('Audio file selection failed:', err);
        return null;
    }
});

ipcMain.handle('create-profile', async (event, name, type, material, description, soundPath) => {
    try {
        const safeName = sanitizeText(name, 120);
        if (!safeName) return { success: false, error: t('msg.enter_profile_name') };

        const safeType = sanitizeText(type, 120) || db.DEFAULT_SWITCH_TYPE;
        const safeMaterial = sanitizeText(material, 60) || db.DEFAULT_MATERIAL;
        const safeDescription = sanitizeText(description, 500);

        if (soundPath && (!isSupportedAudioFile(soundPath) || !fs.existsSync(soundPath))) {
            return { success: false, error: t('msg.unsupported_audio') };
        }

        const id = `custom-${Date.now()}`;
        const userDataPath = app.getPath('userData');
        const customProfilesDir = path.join(userDataPath, 'custom_profiles');
        fs.mkdirSync(customProfilesDir, { recursive: true });

        const profileFolder = path.join(customProfilesDir, id);
        fs.mkdirSync(profileFolder, { recursive: true });

        let copiedSoundFilename = null;
        let playType = 'multi';

        if (soundPath) {
            copiedSoundFilename = path.basename(soundPath);
            fs.copyFileSync(soundPath, path.join(profileFolder, copiedSoundFilename));
            playType = 'single';
        }

        const config = {
            id,
            name: safeName,
            type: safeType,
            material: safeMaterial,
            description: safeDescription || '',
            key_define_type: playType,
            sound: copiedSoundFilename,
            defines: {}
        };

        fs.writeFileSync(path.join(profileFolder, 'config.json'), JSON.stringify(config, null, 2));

        config.folder_path = profileFolder;
        db.insertProfile(config, true);

        return { success: true, profile: config };
    } catch (err) {
        console.error('Create profile failed:', err);
        return { success: false, error: t('msg.unexpected_error') };
    }
});

// A pack is imported by copying its audio files into the app's own library.
// Referencing the source folder would break as soon as the user moved or
// deleted it, and writing a generated config.json into that folder modified
// files Tactile does not own.
const MAX_IMPORTED_FILES = 4000;

function copyPackFolderIntoLibrary(sourceDir) {
    const packName = path.basename(sourceDir) || 'pack';
    const safeName = sanitizeText(packName, 60)
        .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-')
        .replace(/^[.\s]+|[.\s]+$/g, '') || 'pack';
    const destDir = path.join(app.getPath('userData'), 'custom_profiles', `${safeName}-${Date.now()}`);
    fs.mkdirSync(destDir, { recursive: true });

    let copied = 0;
    const walk = (dir, relative) => {
        if (copied >= MAX_IMPORTED_FILES) return;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (copied >= MAX_IMPORTED_FILES) return;
            // Hidden folders are system metadata, never part of a sound pack.
            if (entry.name.startsWith('.')) continue;
            const rel = relative ? path.join(relative, entry.name) : entry.name;
            const from = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                walk(from, rel);
                continue;
            }
            if (rel !== 'config.json' && !isSupportedAudioFile(entry.name)) continue;
            const to = path.join(destDir, rel);
            fs.mkdirSync(path.dirname(to), { recursive: true });
            fs.copyFileSync(from, to);
            copied += 1;
        }
    };

    try {
        walk(sourceDir, '');
    } catch (err) {
        fs.rmSync(destDir, { recursive: true, force: true });
        throw err;
    }
    return { destDir, copied };
}

ipcMain.handle('import-folder-pack', async (event, folderPath) => {
    try {
        if (typeof folderPath !== 'string' || !folderPath || !fs.existsSync(folderPath) || !fs.statSync(folderPath).isDirectory()) {
            return { success: false, error: t('msg.import_failed') };
        }

        const configPath = path.join(folderPath, 'config.json');
        let config = null;
        if (fs.existsSync(configPath)) {
            try {
                config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            } catch (err) {
                console.warn('Imported pack has an unreadable config.json:', err.message);
            }
        }
        if (!config || typeof config !== 'object') {
            config = {
                id: `custom-${Date.now()}`,
                name: sanitizeText(path.basename(folderPath), 120) || t('import.custom_pack_name'),
                key_define_type: 'multi',
                defines: {}
            };
        }

        const { destDir, copied } = copyPackFolderIntoLibrary(folderPath);
        if (copied === 0) {
            fs.rmSync(destDir, { recursive: true, force: true });
            return { success: false, error: t('msg.import_failed') };
        }

        config.id = typeof config.id === 'string' && config.id ? config.id : `custom-${Date.now()}`;
        config.name = sanitizeText(config.name, 120) || path.basename(folderPath);
        config.key_define_type = config.key_define_type === 'single' ? 'single' : 'multi';

        // Keep only definitions that survived the copy: a text file or a
        // missing sample would otherwise make a key silently dead.
        const sourceDefines = config.defines && typeof config.defines === 'object' ? config.defines : {};
        const defines = {};
        for (const [keycode, fileName] of Object.entries(sourceDefines)) {
            if (typeof fileName !== 'string' || !fileName || path.isAbsolute(fileName)) continue;
            if (fileName.includes('..')) continue;
            if (!fs.existsSync(path.join(destDir, fileName))) continue;
            defines[keycode] = fileName;
        }
        config.defines = defines;
        config.folder_path = destDir;

        const lname = config.name.toLowerCase();
        if (lname.includes('clicky') || lname.includes('blue')) {
            config.type = 'Clicky';
        } else if (lname.includes('tactile') || lname.includes('brown') || lname.includes('panda')) {
            config.type = 'Tactile';
        } else {
            config.type = db.DEFAULT_SWITCH_TYPE;
        }
        config.material = lname.includes('pbt') ? 'PBT' : (lname.includes('abs') ? 'ABS' : db.DEFAULT_MATERIAL);
        // Store an empty description: a translated one would be frozen into the
        // imported pack's config.json and would never follow a language change.
        // The renderer falls back to t('card.default_desc') when painting.
        config.description = '';

        fs.writeFileSync(path.join(destDir, 'config.json'), JSON.stringify(config, null, 2));
        db.insertProfile(config, true);
        return { success: true, profile: config };
    } catch (err) {
        console.error('Folder import failed:', err);
        return { success: false, error: t('msg.import_failed') };
    }
});

ipcMain.handle('import-mixed-zip-pack', async (event, targetProfileId, keycode, assignedFilePath) => {
    try {
        const profile = db.getProfileRow(targetProfileId);
        if (!profile) return { success: false, error: t('msg.profile_not_found') };

        if (typeof keycode !== 'string' || !/^[0-9]{1,6}(-up)?$/.test(keycode)) {
            return { success: false, error: t('msg.invalid_keycode') };
        }

        if (typeof assignedFilePath !== 'string' || !isSupportedAudioFile(assignedFilePath) || !fs.existsSync(assignedFilePath)) {
            return { success: false, error: t('msg.unsupported_audio') };
        }

        let destFileName = path.basename(assignedFilePath);
        let destPath = path.join(profile.folder_path, destFileName);
        if (fs.existsSync(destPath)) {
            destFileName = `${Date.now()}_${destFileName}`;
            destPath = path.join(profile.folder_path, destFileName);
        }
        fs.copyFileSync(assignedFilePath, destPath);

        const configPath = path.join(profile.folder_path, 'config.json');
        const config = fs.existsSync(configPath)
            ? JSON.parse(fs.readFileSync(configPath, 'utf8'))
            : { id: profile.id, name: profile.name, key_define_type: 'multi', defines: {} };

        if (!config.defines || typeof config.defines !== 'object') config.defines = {};
        config.defines[keycode] = destFileName;

        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
        config.folder_path = profile.folder_path;
        const storedId = db.insertProfile(config, Boolean(profile.is_custom));

        // Assigning a key to the pack that is currently loaded left the new
        // file out of memory: the key stayed silent until the user activated
        // the profile again. Reload the payload when it is the active profile.
        if (db.getSetting('selected_profile') === storedId) {
            loadProfileIntoMemory(storedId);
        }

        return { success: true };
    } catch (err) {
        console.error('Assign sound failed:', err);
        return { success: false, error: t('msg.unexpected_error') };
    }
});

// App Lifecycle
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
    app.quit();
} else {
    app.on('second-instance', (event, argv) => {
        pendingView = readRequestedView(argv);
        const hadWindow = Boolean(win && !win.isDestroyed());
        const windowReady = hadWindow && !win.webContents.isLoading();
        openWindow();
        // A freshly created window picks pendingView up in did-finish-load.
        // Sending here too would be dropped before the page exists.
        if (pendingView && windowReady) {
            sendToRenderer('navigate', pendingView);
            pendingView = null;
        }
    });

    app.on('before-quit', () => {
        app.isQuiting = true;
    });

    app.on('ready', initializeApp);

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow(true);
        } else {
            openWindow();
        }
    });

    app.on('will-quit', () => {
        stopHook();
        flushCloudSync();
        if (integrationService) integrationService.stopApi().catch(() => {});
        db.forceSaveDB();
        globalShortcut.unregisterAll();
    });

    app.on('window-all-closed', () => {
        if (process.platform !== 'darwin') app.quit();
    });
}
