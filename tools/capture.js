// Screenshot harness for the documentation set.
//
// Run with the local Electron binary:  node node_modules/electron/cli.js tools/capture.js
//
// It boots the real renderer (src/app.html + src/app.js + src/preload.js) against
// an in-memory stub of the preload bridge, so every view can be photographed
// without touching the user's database. Output: docs/screenshots/*.png
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'docs', 'screenshots');

const LANGUAGES = require(path.join(ROOT, 'src', 'locales', 'languages.js'));

const SETTINGS = {
    volume: '50',
    start_minimized: 'false',
    tray_icon: 'true',
    muted: 'false',
    theme: 'dark',
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
    onboarding_done: 'true'
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
    appVersion: '1.0.0'
};

const DIAGNOSTICS = {
    platform: 'win32',
    osRelease: '10.0.26100',
    arch: 'x64',
    version: '1.0.0',
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

    handle('check-for-updates', () => ({ supported: true, state: 'latest', version: '1.0.0' }));
    handle('download-update', () => ({ success: true }));
    handle('install-update', () => true);

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

    handle('get-app-version', () => '1.0.0');
    handle('register-shortcut', () => ({ success: true }));
    handle('unregister-shortcut', () => true);
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
    await wait(500);
}

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
    fs.mkdirSync(OUT, { recursive: true });
    registerStubs();

    const win = new BrowserWindow({
        width: 1360,
        height: 880,
        minWidth: 800,
        minHeight: 500,
        frame: false,
        show: true,
        backgroundColor: '#0B1118',
        webPreferences: {
            preload: path.join(ROOT, 'src', 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            // A hidden window throttles timers and CSS animations, which made
            // captures race the first paint.
            backgroundThrottling: false
        }
    });

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
    // A hidden BrowserWindow throttles CSS animations, so the fadeIn keyframes
    // would hold the views at opacity 0. Screenshots must be deterministic.
    await win.webContents.insertCSS('*, *::before, *::after { animation: none !important; transition: none !important; }');
    await wait(1200);

    await shoot(win, '01-sounds');

    await selectView(win, 'custom');
    await shoot(win, '02-import');

    await selectView(win, 'settings');
    await win.webContents.executeJavaScript("document.querySelector('.views-container').scrollTop = 0; true");
    await shoot(win, '03-settings-general');

    await win.webContents.executeJavaScript("document.getElementById('settings-data').scrollIntoView({block:'start'}); true");
    await wait(400);
    await shoot(win, '04-settings-backup');

    await selectView(win, 'docs');
    await shoot(win, '05-docs');

    await selectView(win, 'diagnostics');
    await shoot(win, '06-diagnostics');

    await selectView(win, 'about');
    await shoot(win, '07-about');

    // Onboarding: step 1 (language), then advance with the real Next button so
    // the wizard state machine is exercised exactly as a first-run user would.
    await win.webContents.executeJavaScript(`
        document.getElementById('wizard-overlay').classList.add('active');
        document.querySelectorAll('.wizard-step').forEach((step) => step.classList.toggle('active', step.dataset.wizardStep === 'language'));
        document.getElementById('wizard-back').hidden = true;
        document.getElementById('wizard-progress').style.setProperty('--progress', '25%');
        true
    `);
    await wait(400);
    await shoot(win, '08-onboarding-language');

    await win.webContents.executeJavaScript("document.getElementById('wizard-next').click(); true");
    await wait(400);
    await win.webContents.executeJavaScript("document.querySelector('[data-theme-choice=\"dark\"]').click(); true");
    await wait(200);
    await shoot(win, '09-onboarding-theme');

    await win.webContents.executeJavaScript("document.getElementById('wizard-next').click(); true");
    await wait(400);
    await shoot(win, '10-onboarding-welcome');

    await win.webContents.executeJavaScript("document.getElementById('wizard-next').click(); true");
    await wait(400);
    await shoot(win, '11-onboarding-tour');

    // Light theme variant of the library.
    await win.webContents.executeJavaScript(`
        document.getElementById('wizard-overlay').classList.remove('active');
        settings.theme = 'light';
        applyTheme('light');
        switchView('linear');
        true
    `);
    await wait(600);
    await shoot(win, '12-light-theme');

    // Back to dark, then the two surface that only appear on interaction:
    // the category context menu and the category manager dialog.
    await win.webContents.executeJavaScript(`
        settings.theme = 'dark';
        applyTheme('dark');
        switchView('linear');
        true
    `);
    await wait(500);
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
    await shoot(win, '13-category-menu');

    await win.webContents.executeJavaScript(`
        document.getElementById('btn-edit-categories').click();
        true
    `);
    await wait(400);
    await shoot(win, '14-manage-categories');

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

    win.destroy();
    app.quit();
}).catch((err) => {
    console.error(err);
    app.exit(1);
});

// Keep the reference so the linter does not flag an unused import in future edits.
void LANGUAGES;
