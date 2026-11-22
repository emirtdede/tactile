'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const {
    getAudioExtension,
    getAudioMimeType,
    isSupportedAudioFile,
    resolveWithinPath,
    expandRandomRange,
    resolveMultiDefines
} = require('../../src/libs/audio');

test('audio extension and mime detection', () => {
    assert.strictEqual(getAudioExtension('C:\\sounds\\press.MP3'), 'mp3');
    assert.strictEqual(getAudioMimeType('sound.ogg'), 'audio/ogg');
    assert.strictEqual(getAudioMimeType('sound.WAV'), 'audio/wav');
    assert.strictEqual(getAudioMimeType('unknown.xyz'), 'audio/mpeg');
    assert.strictEqual(isSupportedAudioFile('space.wav'), true);
    assert.strictEqual(isSupportedAudioFile('readme.txt'), false);
});

test('resolveWithinPath blocks traversal and absolute paths', () => {
    const base = path.resolve('/sounds/pack');

    assert.strictEqual(resolveWithinPath(base, 'press/SPACE.mp3'), path.join(base, 'press/SPACE.mp3'));
    assert.strictEqual(resolveWithinPath(base, '../secret.mp3'), null);
    assert.strictEqual(resolveWithinPath(base, 'press/../../secret.mp3'), null);
    assert.strictEqual(resolveWithinPath(base, 'C:\\Windows\\win.ini'), null);
    assert.strictEqual(resolveWithinPath(base, ''), null);
    assert.strictEqual(resolveWithinPath(base, null), null);
});

test('expandRandomRange replaces ranges and respects bounds', () => {
    assert.strictEqual(expandRandomRange('press/GENERIC_R{0-4}.mp3', () => 0), 'press/GENERIC_R0.mp3');
    assert.strictEqual(expandRandomRange('press/GENERIC_R{0-4}.mp3', () => 0.99), 'press/GENERIC_R4.mp3');
    assert.strictEqual(expandRandomRange('plain/SPACE.mp3', () => 0.5), 'plain/SPACE.mp3');
    assert.strictEqual(expandRandomRange('bad/{4-2}.mp3', () => 0.5), 'bad/{4-2}.mp3');
});

test('resolveMultiDefines applies explicit, fallback and keyup mappings', () => {
    const resolved = resolveMultiDefines({
        defines: {
            14: 'press/BACKSPACE.mp3',
            '14-up': 'release/BACKSPACE.mp3'
        },
        fallbackDown: 'press/GENERIC_R{0-4}.mp3',
        fallbackUp: 'release/GENERIC.mp3',
        keycodes: ['14', '57'],
        random: () => 0
    });

    assert.strictEqual(resolved['14'], 'press/BACKSPACE.mp3');
    assert.strictEqual(resolved['14-up'], 'release/BACKSPACE.mp3');
    assert.strictEqual(resolved['57'], 'press/GENERIC_R0.mp3');
    assert.strictEqual(resolved['57-up'], 'release/GENERIC.mp3');
    assert.strictEqual(resolved['99'], undefined);
});

test('resolveMultiDefines omits missing sounds instead of inventing them', () => {
    const resolved = resolveMultiDefines({
        defines: {},
        fallbackDown: null,
        fallbackUp: null,
        keycodes: ['14', '57']
    });

    assert.deepStrictEqual(resolved, {});
});
