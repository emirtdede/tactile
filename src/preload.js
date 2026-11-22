const { contextBridge, ipcRenderer } = require('electron');

/**
 * Sandboxed preload: only contextBridge + ipcRenderer are available.
 * Every privileged operation is forwarded to a validated IPC handler in main.
 */
contextBridge.exposeInMainWorld('api', {
    // Window Controls
    minimize: () => ipcRenderer.send('window-control', 'minimize'),
    maximize: () => ipcRenderer.send('window-control', 'maximize'),
    close: () => ipcRenderer.send('window-control', 'close'),

    // App API
    openExternal: (url) => ipcRenderer.invoke('open-external', url),
    setZoom: (percent) => ipcRenderer.invoke('set-zoom', percent),
    showNotification: (title, body) => ipcRenderer.invoke('show-notification', title, body),
    copyText: (text) => ipcRenderer.invoke('copy-text', text),
    getDiagnostics: () => ipcRenderer.invoke('get-diagnostics'),
    saveDiagnostics: (content) => ipcRenderer.invoke('save-diagnostics', content),
    openLogsFolder: () => ipcRenderer.invoke('open-logs-folder'),

    // Cloud backup and restore
    getCloudStatus: () => ipcRenderer.invoke('cloud-get-status'),
    chooseCloudFolder: () => ipcRenderer.invoke('cloud-choose-folder'),
    connectCloud: (provider, folder) => ipcRenderer.invoke('cloud-connect', provider, folder),
    disconnectCloud: () => ipcRenderer.invoke('cloud-disconnect'),
    syncCloud: () => ipcRenderer.invoke('cloud-sync'),
    restoreCloud: () => ipcRenderer.invoke('cloud-restore'),
    openCloudFolder: () => ipcRenderer.invoke('cloud-open-folder'),

    // Updates
    checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
    downloadUpdate: () => ipcRenderer.invoke('download-update'),
    onUpdateStatus: (callback) => {
        ipcRenderer.removeAllListeners('update-status');
        ipcRenderer.on('update-status', (event, data) => callback(data));
    },

    // DB Queries
    getSettings: () => ipcRenderer.invoke('db-get-settings'),
    updateSetting: (key, value) => ipcRenderer.invoke('db-update-setting', key, value),
    getProfiles: () => ipcRenderer.invoke('db-get-profiles'),
    getProfileDetails: (id) => ipcRenderer.invoke('db-get-profile-details', id),
    setActiveProfile: (id) => ipcRenderer.invoke('set-active-profile', id),
    deleteProfile: (id) => ipcRenderer.invoke('db-delete-profile', id),
    updateProfileOrder: (ids) => ipcRenderer.invoke('db-update-profile-order', ids),
    updateProfileDetails: (id, name, type, material, desc) => ipcRenderer.invoke('db-update-profile-details', id, name, type, material, desc),
    getCategories: () => ipcRenderer.invoke('db-get-categories'),
    createCategory: (name) => ipcRenderer.invoke('db-create-category', name),
    deleteCategory: (id) => ipcRenderer.invoke('db-delete-category', id),
    updateCategoryOrder: (ids) => ipcRenderer.invoke('db-update-category-order', ids),
    renameCategory: (id, name) => ipcRenderer.invoke('db-rename-category', id, name),

    // Custom Pack Import API
    selectDirectory: () => ipcRenderer.invoke('select-directory'),
    selectAudioFile: () => ipcRenderer.invoke('select-audio-file'),
    importFolderPack: (folderPath) => ipcRenderer.invoke('import-folder-pack', folderPath),
    importMixedZipPack: (targetProfileId, keycode, assignedFilePath) => ipcRenderer.invoke('import-mixed-zip-pack', targetProfileId, keycode, assignedFilePath),
    createProfile: (name, type, material, description, soundPath) => ipcRenderer.invoke('create-profile', name, type, material, description, soundPath),

    // Playback and UI Events from Main
    onLoadPackSounds: (callback) => {
        ipcRenderer.removeAllListeners('load-pack-sounds');
        ipcRenderer.on('load-pack-sounds', (event, data) => callback(data));
    },
    onPlaySound: (callback) => {
        ipcRenderer.removeAllListeners('play-sound');
        ipcRenderer.on('play-sound', (event, data) => callback(data));
    },
    onMuteStatusChanged: (callback) => {
        ipcRenderer.removeAllListeners('mute-status-changed');
        ipcRenderer.on('mute-status-changed', (event, muted) => callback(muted));
    },
    onVolumeChanged: (callback) => {
        ipcRenderer.removeAllListeners('volume-changed');
        ipcRenderer.on('volume-changed', (event, vol) => callback(vol));
    },
    onNavigate: (callback) => {
        ipcRenderer.removeAllListeners('navigate');
        ipcRenderer.on('navigate', (event, view) => callback(view));
    },
    onSettingsRestored: (callback) => {
        ipcRenderer.removeAllListeners('settings-restored');
        ipcRenderer.on('settings-restored', () => callback());
    },

    // System Integration
    platform: process.platform,
    getAppVersion: () => ipcRenderer.invoke('get-app-version'),
    setDynamicAppIcon: (pngDataUrl, iconType) => ipcRenderer.invoke('set-dynamic-app-icon', pngDataUrl, iconType),
    getSvgDataUri: (iconType) => ipcRenderer.invoke('get-svg-data-uri', iconType)
});
