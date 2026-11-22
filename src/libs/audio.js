'use strict';

/**
 * Audio helpers shared by the main process and the database layer.
 *
 * Everything in this module is side-effect free except `fileToDataUri`,
 * which keeps a small bounded cache so the same (large) sound file is not
 * base64 encoded over and over again on every profile switch or preview.
 */

const fs = require('fs');
const path = require('path');

const AUDIO_MIME_BY_EXT = {
    mp3: 'audio/mpeg',
    ogg: 'audio/ogg',
    oga: 'audio/ogg',
    wav: 'audio/wav',
    m4a: 'audio/mp4',
    mp4: 'audio/mp4',
    flac: 'audio/flac',
    aac: 'audio/aac',
    webm: 'audio/webm'
};

const SUPPORTED_AUDIO_EXTENSIONS = new Set(Object.keys(AUDIO_MIME_BY_EXT));

// Single packs can be several megabytes. Four entries keep memory bounded
// while still covering the active pack plus a previewed neighbour.
const MAX_CACHE_ENTRIES = 4;
const dataUriCache = new Map();

function getAudioExtension(filePath) {
    return path.extname(String(filePath || '')).toLowerCase().replace('.', '');
}

function getAudioMimeType(filePath) {
    return AUDIO_MIME_BY_EXT[getAudioExtension(filePath)] || 'audio/mpeg';
}

function isSupportedAudioFile(filePath) {
    return SUPPORTED_AUDIO_EXTENSIONS.has(getAudioExtension(filePath));
}

/**
 * Resolve `relativePath` inside `baseDir` and reject anything that escapes it.
 * Returns null when either side is missing, the path is absolute, or it
 * resolves outside of the base folder.
 */
function resolveWithinPath(baseDir, relativePath) {
    if (typeof baseDir !== 'string' || baseDir.trim() === '') return null;
    if (typeof relativePath !== 'string' || relativePath.trim() === '') return null;
    // Reject every absolute form regardless of the host platform: a Windows
    // drive path is still an escape attempt when the tests run on Linux, and a
    // NUL byte truncates the name inside fs calls.
    if (relativePath.includes('\0')) return null;
    if (path.isAbsolute(relativePath) || path.win32.isAbsolute(relativePath)) return null;

    const base = path.resolve(baseDir);
    // Pack manifests may be authored on Windows and then synced to macOS or
    // Linux. Treat both separators as separators so `..\..\x` is still caught
    // and portable pack folders resolve the same way everywhere.
    const portableRelative = relativePath.replace(/\\/g, '/');
    const target = path.resolve(base, portableRelative);

    // Windows paths are case-insensitive: a pack folder stored with different
    // casing must not make every sound look like a traversal attempt.
    const normalize = process.platform === 'win32'
        ? (value) => value.toLowerCase()
        : (value) => value;
    const normalizedBase = normalize(base);
    const normalizedTarget = normalize(target);

    if (normalizedTarget === normalizedBase) return null;
    if (!normalizedTarget.startsWith(normalizedBase + path.sep)) return null;
    return target;
}

/**
 * Expand a random range template such as "press/GENERIC_R{0-4}.mp3".
 * Templates without a range are returned unchanged.
 */
function expandRandomRange(template, random = Math.random) {
    if (typeof template !== 'string' || template.indexOf('{') === -1) return template;

    return template.replace(/\{(\d+)-(\d+)\}/g, (match, rawMin, rawMax) => {
        const min = Number(rawMin);
        const max = Number(rawMax);
        if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) return match;
        return String(Math.floor(random() * (max - min + 1)) + min);
    });
}

/**
 * Build the final keycode -> file map for a "multi" soundpack.
 *
 * v2 packs may rely on `sound` (fallback keydown) and `soundup` (fallback
 * keyup) templates instead of defining every single keycode. The previous
 * implementation ignored both fields, so every unmapped key played whichever
 * file happened to be first in `defines`.
 */
function resolveMultiDefines({ defines = {}, fallbackDown = null, fallbackUp = null, keycodes = [], random = Math.random } = {}) {
    const resolved = {};

    keycodes.forEach((keycode) => {
        const key = String(keycode);
        const down = Object.prototype.hasOwnProperty.call(defines, key) ? defines[key] : fallbackDown;
        if (typeof down === 'string' && down) {
            resolved[key] = expandRandomRange(down, random);
        }

        const upKey = `${key}-up`;
        const up = Object.prototype.hasOwnProperty.call(defines, upKey) ? defines[upKey] : fallbackUp;
        if (typeof up === 'string' && up) {
            resolved[upKey] = expandRandomRange(up, random);
        }
    });

    return resolved;
}

/**
 * Read an audio file as a data URI. Cached by path + mtime + size.
 */
function fileToDataUri(fullPath) {
    const stats = fs.statSync(fullPath);
    const cacheKey = `${fullPath}:${stats.mtimeMs}:${stats.size}`;

    const cached = dataUriCache.get(cacheKey);
    if (cached) {
        // Refresh recency.
        dataUriCache.delete(cacheKey);
        dataUriCache.set(cacheKey, cached);
        return cached;
    }

    for (const key of dataUriCache.keys()) {
        if (key.startsWith(`${fullPath}:`)) dataUriCache.delete(key);
    }

    const dataUri = `data:${getAudioMimeType(fullPath)};base64,${fs.readFileSync(fullPath).toString('base64')}`;
    dataUriCache.set(cacheKey, dataUri);

    while (dataUriCache.size > MAX_CACHE_ENTRIES) {
        dataUriCache.delete(dataUriCache.keys().next().value);
    }

    return dataUri;
}

function clearAudioCache() {
    dataUriCache.clear();
}

module.exports = {
    AUDIO_MIME_BY_EXT,
    SUPPORTED_AUDIO_EXTENSIONS,
    getAudioExtension,
    getAudioMimeType,
    isSupportedAudioFile,
    resolveWithinPath,
    expandRandomRange,
    resolveMultiDefines,
    fileToDataUri,
    clearAudioCache
};
