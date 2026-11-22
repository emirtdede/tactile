'use strict';

/**
 * Integration guarantees:
 *  - the local API needs a token, binds to loopback and rejects bad input
 *  - webhooks only accept http(s), sign every body and filter event names
 *  - the MCP and CLI installers write self-contained files into user data
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const { createLocalApi } = require(path.join(ROOT, 'src', 'integrations', 'local-api'));
const { createWebhookSender, isSupportedWebhookUrl, signPayload, parseEvents, VALID_EVENTS } = require(path.join(ROOT, 'src', 'integrations', 'webhooks'));
const { createIntegrationService } = require(path.join(ROOT, 'src', 'integrations', 'service'));

const TOKEN = 'a'.repeat(48);

function makeSettings(initial) {
    const values = { ...initial };
    return {
        getSetting: (key) => (key in values ? values[key] : null),
        values
    };
}

test('the local API refuses to start without a strong token', async () => {
    assert.throws(() => createLocalApi({ token: 'short' }), /at least 24/);
    const api = createLocalApi({ token: TOKEN });
    await api.stop();
});

test('the local API authenticates, validates input and answers on loopback', async () => {
    const calls = [];
    const api = createLocalApi({
        port: 0,
        token: TOKEN,
        actions: {
            status: () => ({ version: '1.1.0' }),
            profiles: () => [{ id: 'p1' }],
            setVolume: (level) => {
                calls.push(level);
                return { success: true, level };
            },
            setMuted: (muted) => ({ success: true, muted })
        },
        logger: { warn() {} }
    });
    const { port } = await api.start();
    const base = `http://127.0.0.1:${port}`;
    const headers = { Authorization: `Bearer ${TOKEN}` };

    try {
        const anonymous = await fetch(`${base}/v1/status`);
        assert.strictEqual(anonymous.status, 401);

        const status = await fetch(`${base}/v1/status`, { headers });
        assert.strictEqual(status.status, 200);
        assert.deepStrictEqual((await status.json()).data, { version: '1.1.0' });

        const badVolume = await fetch(`${base}/v1/volume`, {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({ level: 500 })
        });
        assert.strictEqual(badVolume.status, 400);

        const volume = await fetch(`${base}/v1/volume`, {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({ level: 42 })
        });
        assert.strictEqual(volume.status, 200);
        assert.deepStrictEqual(calls, [42]);

        const missing = await fetch(`${base}/v1/nope`, { headers });
        assert.strictEqual(missing.status, 404);
    } finally {
        await api.stop();
    }
});

test('webhook URLs and event names are filtered', () => {
    assert.strictEqual(isSupportedWebhookUrl('https://example.com/hook'), true);
    assert.strictEqual(isSupportedWebhookUrl('http://localhost:5678/webhook'), true);
    assert.strictEqual(isSupportedWebhookUrl('file:///etc/passwd'), false);
    assert.strictEqual(isSupportedWebhookUrl('javascript:alert(1)'), false);
    assert.deepStrictEqual(parseEvents('profile, MUTE, unknown'), ['profile', 'mute']);
    assert.deepStrictEqual(parseEvents(['sync', 'restore']), ['sync', 'restore']);
    assert.deepStrictEqual(parseEvents(''), []);
    assert.ok(VALID_EVENTS.includes('volume'));
});

test('every webhook body is signed with the shared secret', async () => {
    const captured = [];
    const sender = createWebhookSender({
        logger: { warn() {} },
        fetchImpl: async (url, options) => {
            captured.push({ url, options });
            return { ok: true, status: 200 };
        }
    });

    const queued = sender.emit({
        url: 'https://example.com/hook',
        secret: 'shh',
        events: 'profile,sync',
        event: 'profile',
        payload: { id: 'p1' }
    });
    assert.strictEqual(queued, true);
    await new Promise((resolve) => setTimeout(resolve, 50));

    assert.strictEqual(captured.length, 1);
    const { options } = captured[0];
    assert.strictEqual(options.headers['X-Tactile-Event'], 'profile');
    const expected = signPayload('shh', Number(options.headers['X-Tactile-Timestamp']), options.body);
    assert.strictEqual(options.headers['X-Tactile-Signature'], expected);

    assert.strictEqual(sender.emit({ url: 'file:///x', events: 'profile', event: 'profile' }), false);
    assert.strictEqual(sender.emit({ url: 'https://example.com', events: 'mute', event: 'profile' }), false);
});

test('the MCP and CLI installers write files into the user data folder', () => {
    const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'tactile-int-'));
    const { getSetting } = makeSettings({ api_enabled: 'false', api_port: '18457', webhook_url: '' });
    const service = createIntegrationService({
        userDataPath,
        appVersion: '1.1.0',
        getSetting,
        logger: { warn() {} }
    });

    try {
        const mcp = service.installMcp();
        assert.strictEqual(mcp.installed, true);
        assert.ok(fs.existsSync(mcp.configPath));
        const config = JSON.parse(fs.readFileSync(mcp.configPath, 'utf8'));
        assert.ok(config.mcpServers.tactile);
        assert.strictEqual(config.mcpServers.tactile.env.TACTILE_USER_DATA, userDataPath);

        const cli = service.installCli();
        assert.strictEqual(cli.installed, true);
        assert.ok(fs.existsSync(cli.path));
        assert.ok(fs.existsSync(cli.script));

        const status = service.status();
        assert.strictEqual(status.mcp.installed, true);
        assert.strictEqual(status.cli.installed, true);
        assert.strictEqual(status.api.enabled, false);
        assert.strictEqual(status.api.token.length >= 24, true);
        assert.strictEqual(status.webhook.configured, false);
    } finally {
        fs.rmSync(userDataPath, { recursive: true, force: true });
    }
});

test('the API setting starts and stops the server and writes api.json', async () => {
    const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'tactile-api-'));
    const { getSetting, values } = makeSettings({ api_enabled: 'true', api_port: '0', webhook_url: '' });
    const service = createIntegrationService({
        userDataPath,
        getSetting,
        actions: { status: () => ({ ok: true }) },
        logger: { warn() {} }
    });

    try {
        const started = await service.applyApiSetting();
        assert.strictEqual(started.running, true);
        const file = path.join(userDataPath, 'api.json');
        assert.ok(fs.existsSync(file));
        const config = JSON.parse(fs.readFileSync(file, 'utf8'));
        assert.strictEqual(config.token, service.ensureToken());
        assert.ok(config.port > 0);

        values.api_enabled = 'false';
        const stopped = await service.applyApiSetting();
        assert.strictEqual(stopped.running, false);
        assert.strictEqual(fs.existsSync(file), false);
    } finally {
        await service.stopApi();
        fs.rmSync(userDataPath, { recursive: true, force: true });
    }
});
