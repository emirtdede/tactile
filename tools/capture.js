// Silent screenshot harness for the documentation set.
//
// Run with the local Electron binary:  node node_modules/electron/cli.js tools/capture.js
//
// It boots the real renderer (src/app.html + src/app.js + src/preload.js) against
// an in-memory stub of the preload bridge, so every view can be photographed
// without touching the user's database. Output: docs/screenshots/*.png
//
// Silent mode: the window is never shown, never focused and never maximised, and
// every capture happens inside one short session that closes the window as soon
// as the last frame is written. `webContents.capturePage()` reads the renderer's
// own surface (the same content PrintWindow returns), so nothing on screen
// flickers and no other application loses focus.
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'docs', 'screenshots');

const SETTINGS = {
    volume: '50',
    start_minimized: 'false',
    tray_icon: 'true',
    muted: 'false',
    theme: 'dark',
    theme_palette: 'obsidian',
    selected_profile: 'p1',
    language: 'en',
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
    cloud_provider: 'onedrive',
    cloud_folder: '',
    cloud_auto: 'true',
    cloud_last_sync: new Date(Date.now() - 3600_000).toISOString(),
    onboarding_done: 'true',
    ai_enabled: 'false',
    ai_model: '',
    ai_runtime: 'auto',
    ai_rag: 'true',
    webhook_url: '',
    webhook_events: 'profile,mute,sync'
};

const CATEGORIES = [
    { id: 'linear', name: 'Linear' },
    { id: 'tactile', name: 'Tactile' },
    { id: 'clicky', name: 'Clicky' }
];

const PROFILES = [
    { id: 'p1', name: 'Cream Linear', type: 'Linear', material: 'PBT', description: 'Deep muted thock with a soft bottom out.', is_custom: 0, sound_count: 32, is_active: 1 },
    { id: 'p2', name: 'Lubed Alpaca', type: 'Linear', material: 'PBT', description: 'Smooth and round, almost no scratch.', is_custom: 0, sound_count: 24, is_active: 0 },
    { id: 'p3', name: 'Holy Panda', type: 'Tactile', material: 'PBT', description: 'Sharp tactile bump with a crisp release.', is_custom: 0, sound_count: 18, is_active: 0 },
    { id: 'p4', name: 'Box Jade', type: 'Clicky', material: 'ABS', description: 'Loud, high pitched and very satisfying.', is_custom: 0, sound_count: 12, is_active: 0 }
];

const CLOUD_STATUS = {
    provider: 'onedrive',
    folder: '',
    root: 'C:\\Users\\you\\OneDrive',
    backupDir: 'C:\\Users\\you\\OneDrive\\Tactile',
    connected: true,
    available: true,
    detected: [
        { id: 'onedrive', path: 'C:\\Users\\you\\OneDrive' },
        { id: 'googledrive', path: null },
        { id: 'dropbox', path: null }
    ],
    lastSync: SETTINGS.cloud_last_sync,
    auto: true,
    hasBackup: true,
    exportedAt: SETTINGS.cloud_last_sync,
    source: 'sync',
    backups: 4,
    appVersion: '1.1.0'
};

const DIAGNOSTICS = {
    platform: 'win32',
    osRelease: '10.0.26100',
    arch: 'x64',
    version: '1.1.0',
    electron: '30.5.1',
    locale: 'en-US',
    language: 'en',
    dataDir: 'C:\\Users\\you\\AppData\\Roaming\\Tactile',
    logsDir: 'C:\\Users\\you\\AppData\\Roaming\\Tactile\\logs',
    hookOk: true,
    dbOk: true,
    trayOk: true,
    cloud: CLOUD_STATUS,
    memoryMB: 148
};

const AI_STATUS = {
    enabled: false,
    model: '',
    runtime: { url: 'http://127.0.0.1:11434', running: false, installed: false },
    hardware: { cpu: '12th Gen Intel Core i7', cores: 16, memoryGB: 32, tier: 'ultra', tierIndex: 3 },
    recommended: 'qwen2.5:7b',
    catalog: [
        { id: 'qwen2.5:0.5b', label: 'Qwen 2.5 0.5B', sizeGB: 0.4, minMemoryGB: 4, minTier: 'low', description: 'Fastest option.', recommendedFor: 'low', installed: false, runnable: true, embedding: false },
        { id: 'qwen2.5:1.5b', label: 'Qwen 2.5 1.5B', sizeGB: 1.0, minMemoryGB: 8, minTier: 'medium', description: 'Balanced.', recommendedFor: 'medium', installed: false, runnable: true, embedding: false },
        { id: 'qwen2.5:3b', label: 'Qwen 2.5 3B', sizeGB: 1.9, minMemoryGB: 12, minTier: 'high', description: 'Best all-round.', recommendedFor: 'high', installed: false, runnable: true, embedding: false },
        { id: 'qwen2.5:7b', label: 'Qwen 2.5 7B', sizeGB: 4.7, minMemoryGB: 16, minTier: 'high', description: 'Highest quality.', recommendedFor: 'ultra', installed: false, runnable: true, embedding: false },
        { id: 'nomic-embed-text', label: 'Nomic Embed Text', sizeGB: 0.27, minMemoryGB: 4, minTier: 'low', description: 'Embeddings.', recommendedFor: 'low', installed: false, runnable: true, embedding: true }
    ],
    installed: [],
    rag: { enabled: true, documents: 21, chunks: 168, builtAt: '2026-11-22T09:00:00.000Z' }
};

function handle(channel, fn) {
    ipcMain.handle(channel, (event, ...args) => fn(...args));
}

function registerStubs() {
    ipcMain.on('window-control', () => {});

    handle('open-external', () => true);
    handle('set-zoom', (percent) => percent);
    handle('show-notification', () => true);
    handle('copy-text', () => true);
    handle('get-diagnostics', () => DIAGNOSTICS);
    handle('save-diagnostics', () => ({ success: true }));
    handle('open-logs-folder', () => ({ success: true }));

    handle('cloud-get-status', () => CLOUD_STATUS);
    handle('cloud-choose-folder', () => 'C:\\Users\\you\\OneDrive');
    handle('cloud-connect', () => ({ success: true, status: CLOUD_STATUS }));
    handle('cloud-disconnect', () => ({ success: true, status: CLOUD_STATUS }));
    handle('cloud-sync', () => ({ success: true, status: CLOUD_STATUS }));
    handle('cloud-restore', () => ({ success: true, status: CLOUD_STATUS }));
    handle('cloud-open-folder', () => ({ success: true }));

    handle('check-for-updates', () => ({ supported: true, state: 'latest', version: '1.1.0' }));
    handle('download-update', () => ({ success: true }));

    handle('ai-get-status', () => AI_STATUS);
    handle('ai-toggle', (enabled) => ({ ...AI_STATUS, enabled }));
    handle('ai-refresh', () => AI_STATUS);
    handle('ai-list-models', () => AI_STATUS.catalog);
    handle('ai-pull-model', () => ({ success: true }));
    handle('ai-delete-model', () => ({ success: true }));
    handle('ai-reindex', () => AI_STATUS);
    handle('ai-ask', () => ({ answer: '', sources: [] }));
    handle('ai-search-docs', () => []);
    handle('ai-open-runtime', () => true);

    handle('integration-status', () => ({
        api: {
            enabled: false,
            running: false,
            port: 18457,
            url: '',
            token: '7f3d1c0b9a5e4d2c8b6a1f0e9d7c5b3a2e4f6a8b'
        },
        mcp: {
            installed: false,
            configPath: 'C:\\Users\\you\\AppData\\Roaming\\Tactile\\integrations\\mcp\\config.json',
            serverPath: 'C:\\Users\\you\\AppData\\Roaming\\Tactile\\integrations\\mcp\\server.js'
        },
        cli: {
            installed: false,
            path: 'C:\\Users\\you\\AppData\\Roaming\\Tactile\\integrations\\cli\\tactile.cmd',
            command: '"C:\\Users\\you\\AppData\\Roaming\\Tactile\\integrations\\cli\\tactile.cmd"'
        },
        webhook: { configured: false, url: '', events: ['profile', 'mute', 'sync'], lastStatus: null },
        version: '1.1.0'
    }));
    handle('integration-set-api', () => ({ success: true }));
    handle('integration-install-mcp', () => ({ installed: true }));
    handle('webhook-save', () => ({ success: true }));
    handle('webhook-test', () => ({ success: true, status: 200 }));
    handle('integration-open-config', () => ({ success: true }));
    handle('integration-install-cli', () => ({ installed: true }));

    handle('db-get-settings', () => SETTINGS);
    handle('db-update-setting', (key, value) => {
        SETTINGS[key] = value;
        return true;
    });
    handle('db-get-profiles', () => PROFILES);
    handle('db-get-profile-details', (id) => ({ profile: PROFILES.find((p) => p.id === id), sounds: [] }));
    handle('set-active-profile', (id) => {
        SETTINGS.selected_profile = id;
        return { success: true };
    });
    handle('db-delete-profile', () => true);
    handle('db-update-profile-order', () => true);
    handle('db-update-profile-details', () => true);
    handle('db-get-categories', () => CATEGORIES);
    handle('db-create-category', () => true);
    handle('db-delete-category', () => true);
    handle('db-update-category-order', () => true);
    handle('db-rename-category', () => true);

    handle('select-directory', () => null);
    handle('select-audio-file', () => null);
    handle('import-folder-pack', () => ({ success: false }));
    handle('import-mixed-zip-pack', () => ({ success: false }));
    handle('create-profile', () => ({ success: false }));

    handle('get-app-version', () => '1.1.0');
    handle('brand-get-info', () => ({
        product: 'Tactile',
        company: 'Vellium',
        companyLegal: 'Vellium Teknoloji Anonim Sirketi',
        copyright: 'Copyright (c) 2026 Vellium. All rights reserved.',
        version: '1.1.0',
        website: 'https://vellium.dev',
        productPage: 'https://vellium.dev/en/products/tactile',
        github: 'https://github.com/emirtdede/tactile',
        sponsor: 'https://github.com/sponsors/emirtdede',
        docs: 'https://github.com/emirtdede/tactile/tree/main/docs',
        storeUrl: 'https://apps.microsoft.com/detail/9NQJTP1BKP5R',
        storeSigningIncluded: false,
        emails: {},
        legal: {},
        social: {}
    }));
    handle('set-dynamic-app-icon', () => true);
    handle('get-svg-data-uri', () => null);
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function shoot(win, name) {
    const image = await win.webContents.capturePage();
    fs.writeFileSync(path.join(OUT, `${name}.png`), image.toPNG());
    console.log('captured', name);
}

async function selectView(win, view) {
    await win.webContents.executeJavaScript(`switchView(${JSON.stringify(view)}); true`);
    await wait(450);
}

// Scrolls to a settings section and photographs it. Sections are optional so an
// older build can still produce the rest of the set.
async function shootSection(win, id, name) {
    const found = await win.webContents.executeJavaScript(`
        (() => {
            const section = document.getElementById(${JSON.stringify(id)});
            if (!section) return false;
            section.scrollIntoView({ block: 'start' });
            return true;
        })()
    `);
    if (!found) {
        console.log('skipped', name, '(section not present)');
        return false;
    }
    await wait(350);
    await shoot(win, name);
    return true;
}

// Keep the process alive on a hidden window: Chromium would otherwise stop
// painting and `capturePage()` would return an empty frame.
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.disableHardwareAcceleration();

app.whenReady().then(async () => {
    const startedAt = Date.now();
    fs.mkdirSync(OUT, { recursive: true });
    registerStubs();

    const win = new BrowserWindow({
        width: 1360,
        height: 880,
        minWidth: 800,
        minHeight: 500,
        frame: false,
        // Silent capture: no visible window, no taskbar entry, no focus steal.
        show: false,
        focusable: false,
        skipTaskbar: true,
        paintWhenInitiallyHidden: true,
        backgroundColor: '#0B1118',
        webPreferences: {
            preload: path.join(ROOT, 'src', 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            backgroundThrottling: false
        }
    });

    win.webContents.setBackgroundThrottling(false);

    const errors = [];
    win.webContents.on('console-message', (event, level, message, line, sourceId) => {
        const entry = `[${level}] ${message} (${sourceId}:${line})`;
        console.log(entry);
        errors.push(entry);
    });
    win.webContents.on('preload-error', (event, preloadPath, error) => {
        errors.push(`preload-error ${preloadPath} ${error && error.stack}`);
    });

    await win.loadFile(path.join(ROOT, 'src', 'app.html'));
    // Paint the real surface without ever showing it: a zero-opacity window is
    // composited normally (so text and images are all there), yet it is
    // invisible and `showInactive()` never takes focus from the user.
    win.setOpacity(0);
    win.showInactive();
    // Deterministic frames: the fade-in keyframes would hold a hidden view at
    // opacity 0 while the capture runs.
    await win.webContents.insertCSS('*, *::before, *::after { animation: none !important; transition: none !important; }');
    await wait(1400);

    await shoot(win, '01-sounds');

    // Collapsed rail: the sidebar keeps icons, the brand mark and the footer
    // actions, and persists the choice through localStorage.
    await win.webContents.executeJavaScript("document.getElementById('btn-sidebar-collapse').click(); true");
    await wait(350);
    await shoot(win, '18-sidebar-collapsed');
    await win.webContents.executeJavaScript("document.getElementById('btn-sidebar-collapse').click(); true");
    await wait(350);

    await selectView(win, 'custom');
    await shoot(win, '02-import');

    await selectView(win, 'settings');
    await win.webContents.executeJavaScript("document.querySelector('.views-container').scrollTop = 0; true");
    await shoot(win, '03-settings-general');

    await shootSection(win, 'settings-data', '04-settings-backup');
    await shootSection(win, 'settings-ai', '05-settings-ai');
    await shootSection(win, 'settings-integrations', '06-settings-integrations');
    await shootSection(win, 'settings-appearance', '17-settings-appearance');

    await selectView(win, 'docs');
    await shoot(win, '07-docs');

    await selectView(win, 'diagnostics');
    await shoot(win, '08-diagnostics');

    await selectView(win, 'about');
    await shoot(win, '09-about');

    // Onboarding: step 1 (language), then advance with the real Next button so
    // the wizard state machine is exercised exactly as a first-run user would.
    await win.webContents.executeJavaScript(`
        document.getElementById('wizard-overlay').classList.add('active');
        document.querySelectorAll('.wizard-step').forEach((step) => step.classList.toggle('active', step.dataset.wizardStep === 'language'));
        document.getElementById('wizard-back').hidden = true;
        document.getElementById('wizard-progress').style.setProperty('--progress', '25%');
        true
    `);
    await wait(350);
    await shoot(win, '10-onboarding-language');

    await win.webContents.executeJavaScript("document.getElementById('wizard-next').click(); true");
    await wait(350);
    await win.webContents.executeJavaScript("document.querySelector('[data-theme-choice=\"dark\"]').click(); true");
    await wait(200);
    await shoot(win, '11-onboarding-theme');

    await win.webContents.executeJavaScript("document.getElementById('wizard-next').click(); true");
    await wait(350);
    await shoot(win, '12-onboarding-welcome');

    await win.webContents.executeJavaScript("document.getElementById('wizard-next').click(); true");
    await wait(350);
    await shoot(win, '13-onboarding-tour');

    // Light theme variant of the library.
    await win.webContents.executeJavaScript(`
        document.getElementById('wizard-overlay').classList.remove('active');
        settings.theme = 'light';
        applyTheme('light');
        switchView('linear');
        true
    `);
    await wait(550);
    await shoot(win, '14-light-theme');

    // Back to dark, then the two surfaces that only appear on interaction:
    // the category context menu and the category manager dialog.
    await win.webContents.executeJavaScript(`
        settings.theme = 'dark';
        applyTheme('dark');
        switchView('linear');
        true
    `);
    await wait(450);
    await win.webContents.executeJavaScript(`
        const target = document.querySelector('#dynamic-categories-list .nav-item');
        const rect = target.getBoundingClientRect();
        target.dispatchEvent(new MouseEvent('contextmenu', {
            bubbles: true,
            cancelable: true,
            clientX: Math.round(rect.left + 40),
            clientY: Math.round(rect.bottom - 8)
        }));
        true
    `);
    await wait(250);
    await shoot(win, '15-category-menu');

    await win.webContents.executeJavaScript(`
        document.getElementById('btn-edit-categories').click();
        true
    `);
    await wait(350);
    await shoot(win, '16-manage-categories');

    await win.webContents.executeJavaScript(`
        document.getElementById('modal-manage-close-x').click();
        document.getElementById('custom-context-menu').style.display = 'none';
        true
    `);

    if (errors.length) {
        fs.writeFileSync(path.join(OUT, 'console-errors.txt'), errors.join('\n'), 'utf8');
        console.log(`renderer errors: ${errors.length}`);
    } else {
        console.log('renderer errors: 0');
    }

    console.log(`capture session: ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
    // Close immediately: the window must not linger on the user's desktop.
    win.destroy();
    app.quit();
}).catch((err) => {
    console.error(err);
    app.exit(1);
});
