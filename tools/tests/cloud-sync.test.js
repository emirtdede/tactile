const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const cloudSync = require('../../src/cloud-sync');

const SQLITE_HEADER = Buffer.from('SQLite format 3\u0000', 'latin1');

function sqlitePayload(tag) {
    return Buffer.concat([SQLITE_HEADER, Buffer.from(String(tag))]).toString('base64');
}

function makeSnapshot(tag, exportedAt = '2026-11-22T10:00:00.000Z') {
    return cloudSync.buildSnapshot({
        database: sqlitePayload(tag),
        appVersion: '1.0.0',
        exportedAt
    });
}

function tempDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'tactile-cloud-'));
}

function dayName(offsetDays) {
    const now = new Date();
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offsetDays);
    const pad = (value) => String(value).padStart(2, '0');
    return `tactile-backup-${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}.json`;
}

test('provider detection prefers the documented environment variables in order', () => {
    const env = {
        OneDriveConsumer: 'C:/Users/me/OneDriveConsumer',
        OneDrive: 'C:/Users/me/OneDrive',
        OneDriveCommercial: 'C:/Users/me/OneDriveCommercial'
    };
    assert.deepStrictEqual(
        cloudSync.providerCandidates('onedrive', env, 'C:/Users/me').slice(0, 3),
        [env.OneDriveConsumer, env.OneDrive, env.OneDriveCommercial]
    );
    assert.strictEqual(cloudSync.providerCandidates('unknown', env, 'C:/Users/me').length, 0);
});

test('resolveSyncRoot uses a custom folder, then the provider root, then the fallback', () => {
    const root = tempDir();
    const custom = tempDir();
    try {
        assert.strictEqual(
            cloudSync.resolveSyncRoot({ provider: 'custom', folder: custom, fallback: root }),
            custom
        );
        assert.strictEqual(
            cloudSync.resolveSyncRoot({ provider: 'dropbox', folder: custom, fallback: root, env: { Dropbox: custom } }),
            custom
        );
        assert.strictEqual(
            cloudSync.resolveSyncRoot({ provider: 'onedrive', folder: '', fallback: root, env: {}, home: root }),
            root
        );
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
        fs.rmSync(custom, { recursive: true, force: true });
    }
});

test('a snapshot must carry a real SQLite payload', () => {
    assert.strictEqual(cloudSync.isValidSnapshot(makeSnapshot('first')), true);

    const wrongFormat = { ...makeSnapshot('first'), format: 'other' };
    assert.strictEqual(cloudSync.isValidSnapshot(wrongFormat), false);

    const wrongVersion = { ...makeSnapshot('first'), formatVersion: 99 };
    assert.strictEqual(cloudSync.isValidSnapshot(wrongVersion), false);

    const notSqlite = { ...makeSnapshot('first'), data: Buffer.from('this is not a database').toString('base64') };
    assert.strictEqual(cloudSync.isValidSnapshot(notSqlite), false);

    const empty = { ...makeSnapshot('first'), data: '' };
    assert.strictEqual(cloudSync.isValidSnapshot(empty), false);
});

test('writeSnapshot rotates sync to previous and refuses an invalid payload', () => {
    const dir = path.join(tempDir(), 'Tactile');
    try {
        cloudSync.writeSnapshot(dir, makeSnapshot('first'));
        assert.ok(fs.existsSync(path.join(dir, 'tactile-sync.json')));
        assert.ok(fs.existsSync(path.join(dir, dayName(0))));

        cloudSync.writeSnapshot(dir, makeSnapshot('second'));
        const previous = JSON.parse(fs.readFileSync(path.join(dir, 'tactile-previous.json'), 'utf8'));
        assert.strictEqual(previous.data, sqlitePayload('first'));

        assert.throws(
            () => cloudSync.writeSnapshot(dir, { ...makeSnapshot('bad'), data: 'bm90LWEtZGF0YWJhc2U=' }),
            /invalid backup snapshot/
        );
    } finally {
        fs.rmSync(path.dirname(dir), { recursive: true, force: true });
    }
});

test('recovery falls through a corrupt newest file to the previous snapshot', () => {
    const dir = path.join(tempDir(), 'Tactile');
    try {
        cloudSync.writeSnapshot(dir, makeSnapshot('first'));
        cloudSync.writeSnapshot(dir, makeSnapshot('second'));
        fs.writeFileSync(path.join(dir, 'tactile-sync.json'), '{ truncated');

        const chain = cloudSync.readRecoveryChain(dir);
        assert.ok(chain, 'a usable snapshot must be found');
        assert.strictEqual(chain.source, 'previous');
        assert.strictEqual(chain.snapshot.data, sqlitePayload('first'));
    } finally {
        fs.rmSync(path.dirname(dir), { recursive: true, force: true });
    }
});

test('backup rotation keeps exactly the 15 most recent calendar days', () => {
    const dir = tempDir();
    try {
        for (let offset = 0; offset < 25; offset += 1) {
            fs.writeFileSync(
                path.join(dir, dayName(-offset)),
                JSON.stringify(makeSnapshot(`day-${offset}`))
            );
        }

        cloudSync.rotateBackups(dir);
        const remaining = fs.readdirSync(dir).filter((name) => name.startsWith('tactile-backup-'));
        assert.strictEqual(remaining.length, cloudSync.KEEP_DAYS);
        assert.ok(remaining.includes(dayName(0)), 'today must survive');
        assert.ok(remaining.includes(dayName(-(cloudSync.KEEP_DAYS - 1))), 'the 15th day must survive');
        assert.ok(!remaining.includes(dayName(-cloudSync.KEEP_DAYS)), 'day 16 must be removed');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
