'use strict';

/**
 * Local-folder cloud backup for Tactile.
 *
 * The app never talks to a cloud API and never asks for an account. It writes a
 * single JSON snapshot into a folder that an existing sync client (OneDrive,
 * Google Drive, Dropbox, or any user-chosen folder) already mirrors.
 *
 * Snapshot layout inside <provider root>/Tactile:
 *   tactile-sync.json                  newest good snapshot
 *   tactile-previous.json              the snapshot replaced by the last sync
 *   tactile-backup-YYYY-MM-DD.json     one rollover per day, 15 kept
 *
 * Writes are atomic: a temporary file is renamed over the target, with a
 * copy fallback for Windows clients that briefly lock the destination.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const APP_FOLDER = 'Tactile';
const SYNC_FILE = 'tactile-sync.json';
const PREVIOUS_FILE = 'tactile-previous.json';
const BACKUP_PREFIX = 'tactile-backup-';
const FORMAT = 'tactile-backup';
const FORMAT_VERSION = 1;
const KEEP_DAYS = 15;

const PROVIDERS = ['onedrive', 'googledrive', 'dropbox', 'custom'];

// Every snapshot payload is a serialized SQLite database; checking the magic
// header catches a truncated or replaced file before restoreDatabase sees it.
const SQLITE_HEADER = Buffer.from('SQLite format 3\u0000', 'latin1');

function providerCandidates(provider, env = process.env, home = os.homedir()) {
    switch (provider) {
        case 'onedrive':
            return [
                env.OneDriveConsumer,
                env.OneDrive,
                env.OneDriveCommercial,
                path.join(home, 'OneDrive')
            ].filter(Boolean);
        case 'googledrive':
            return [
                env.GoogleDrive,
                path.join(home, 'Google Drive'),
                path.join(home, 'GoogleDrive')
            ].filter(Boolean);
        case 'dropbox':
            return [env.Dropbox, path.join(home, 'Dropbox')].filter(Boolean);
        default:
            return [];
    }
}

function isDirectory(candidate) {
    try {
        return Boolean(candidate) && fs.statSync(candidate).isDirectory();
    } catch (err) {
        return false;
    }
}

/**
 * Returns the first existing root folder for a provider, or null when the
 * client is not installed / has never been signed in on this computer.
 */
function resolveProviderRoot(provider, env = process.env, home = os.homedir()) {
    if (!PROVIDERS.includes(provider) || provider === 'custom') return null;
    for (const candidate of providerCandidates(provider, env, home)) {
        if (isDirectory(candidate)) return candidate;
    }
    return null;
}

function detectProviders(env = process.env, home = os.homedir()) {
    return ['onedrive', 'googledrive', 'dropbox'].map((id) => ({
        id,
        path: resolveProviderRoot(id, env, home)
    }));
}

/**
 * Chooses the sync root. A custom folder is used as-is (the user picked it),
 * otherwise the provider default is used, and finally the app data folder so
 * backup still works on machines without any cloud client.
 */
function resolveSyncRoot({ provider, folder, fallback, env, home }) {
    if (provider === 'custom' && isDirectory(folder)) return folder;
    const root = resolveProviderRoot(provider, env, home);
    if (root) return root;
    return fallback;
}

function backupDirectory(root) {
    return path.join(root, APP_FOLDER);
}

function ensureDirectory(dir) {
    fs.mkdirSync(dir, { recursive: true });
}

function atomicWrite(file, content) {
    const tmp = `${file}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, content, 'utf8');
    try {
        fs.renameSync(tmp, file);
    } catch (err) {
        if (err.code !== 'EBUSY' && err.code !== 'EPERM' && err.code !== 'EACCES') {
            try { fs.unlinkSync(tmp); } catch (cleanupErr) { /* best effort */ }
            throw err;
        }
        // A sync client briefly holds the destination open. Copying over it is
        // not atomic, but it keeps the last good cloud copy intact.
        fs.copyFileSync(tmp, file);
        try { fs.unlinkSync(tmp); } catch (cleanupErr) { /* best effort */ }
    }
}

function dayStamp(date = new Date()) {
    const pad = (value) => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function emptySnapshot() {
    return {
        format: FORMAT,
        formatVersion: FORMAT_VERSION,
        appVersion: '',
        exportedAt: '',
        data: ''
    };
}

function buildSnapshot({ database, appVersion, exportedAt = new Date().toISOString() }) {
    return {
        format: FORMAT,
        formatVersion: FORMAT_VERSION,
        appVersion: String(appVersion || ''),
        exportedAt,
        data: String(database || '')
    };
}

function isValidSnapshot(value) {
    if (!value || typeof value !== 'object') return false;
    if (value.format !== FORMAT) return false;
    if (value.formatVersion !== FORMAT_VERSION) return false;
    if (typeof value.data !== 'string' || value.data.length === 0) return false;
    try {
        const payload = Buffer.from(value.data, 'base64');
        if (payload.length < SQLITE_HEADER.length) return false;
        return payload.subarray(0, SQLITE_HEADER.length).equals(SQLITE_HEADER);
    } catch (err) {
        return false;
    }
}

function readJson(file) {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
        return null;
    }
}

function listBackups(dir) {
    try {
        return fs.readdirSync(dir)
            .filter((name) => name.startsWith(BACKUP_PREFIX) && name.endsWith('.json'))
            .sort()
            .reverse();
    } catch (err) {
        return [];
    }
}

function rotateBackups(dir, now = new Date()) {
    // Compare calendar days, not wall-clock times: otherwise the boundary day
    // (still a full 24h short of the cutoff at midnight) is deleted early.
    const keepFrom = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (KEEP_DAYS - 1));
    for (const name of listBackups(dir)) {
        const match = /^tactile-backup-(\d{4})-(\d{2})-(\d{2})\.json$/.exec(name);
        if (!match) continue;
        const stamp = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
        if (stamp < keepFrom) {
            try { fs.unlinkSync(path.join(dir, name)); } catch (err) { /* best effort */ }
        }
    }
}

/**
 * Reads the newest usable snapshot: sync, then previous, then daily backups
 * from newest to oldest. Returns { snapshot, source, file } or null.
 */
function readRecoveryChain(dir) {
    const candidates = [];
    if (fs.existsSync(dir)) {
        candidates.push({ file: path.join(dir, SYNC_FILE), source: 'sync' });
        candidates.push({ file: path.join(dir, PREVIOUS_FILE), source: 'previous' });
        for (const name of listBackups(dir)) {
            candidates.push({ file: path.join(dir, name), source: 'backup' });
        }
    }

    for (const candidate of candidates) {
        if (!fs.existsSync(candidate.file)) continue;
        const snapshot = readJson(candidate.file);
        if (isValidSnapshot(snapshot)) {
            return { snapshot, source: candidate.source, file: candidate.file };
        }
    }
    return null;
}

function writeSnapshot(dir, snapshot, now = new Date()) {
    ensureDirectory(dir);

    if (!isValidSnapshot(snapshot)) {
        throw new Error('Refusing to write an invalid backup snapshot');
    }

    const syncPath = path.join(dir, SYNC_FILE);
    const previousPath = path.join(dir, PREVIOUS_FILE);

    const current = readJson(syncPath);
    if (isValidSnapshot(current)) {
        atomicWrite(previousPath, JSON.stringify(current));
    }

    atomicWrite(syncPath, JSON.stringify(snapshot));

    const backupPath = path.join(dir, `${BACKUP_PREFIX}${dayStamp(now)}.json`);
    if (!fs.existsSync(backupPath)) {
        atomicWrite(backupPath, JSON.stringify(snapshot));
    }

    rotateBackups(dir, now);
    return { file: syncPath, backup: fs.existsSync(backupPath) };
}

function readStatus(dir) {
    const chain = readRecoveryChain(dir);
    const backups = listBackups(dir).length;
    if (!chain) {
        return { hasBackup: false, exportedAt: null, source: null, backups, appVersion: null };
    }
    return {
        hasBackup: true,
        exportedAt: chain.snapshot.exportedAt || null,
        appVersion: chain.snapshot.appVersion || null,
        source: chain.source,
        backups
    };
}

module.exports = {
    APP_FOLDER,
    BACKUP_PREFIX,
    FORMAT,
    FORMAT_VERSION,
    KEEP_DAYS,
    PROVIDERS,
    backupDirectory,
    buildSnapshot,
    detectProviders,
    emptySnapshot,
    isValidSnapshot,
    listBackups,
    providerCandidates,
    readRecoveryChain,
    readStatus,
    resolveProviderRoot,
    resolveSyncRoot,
    rotateBackups,
    writeSnapshot
};
