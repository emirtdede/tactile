// Coordinates the four integration surfaces: local REST API, MCP server files,
// terminal CLI files and outbound webhooks. One service instance lives in the
// main process; every method returns plain data so IPC stays trivial.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createLocalApi } = require('./local-api');
const { createWebhookSender, isSupportedWebhookUrl, parseEvents } = require('./webhooks');

const SOURCE_ROOT = path.join(__dirname, '..');

function createIntegrationService({
    userDataPath,
    appVersion = '1.1.0',
    actions = {},
    getSetting,
    logger = console
}) {
    const apiFile = path.join(userDataPath, 'api.json');
    const tokenFile = path.join(userDataPath, 'api-token.txt');
    const cliDir = path.join(userDataPath, 'integrations', 'cli');
    const mcpDir = path.join(userDataPath, 'integrations', 'mcp');
    const webhooks = createWebhookSender({ logger });

    let api = null;
    let token = '';
    let lastWebhookStatus = null;

    function ensureToken() {
        if (token) return token;
        try {
            const existing = fs.readFileSync(tokenFile, 'utf8').trim();
            if (existing.length >= 24) {
                token = existing;
                return token;
            }
        } catch (err) {
            // First run: mint a new token below.
        }
        token = crypto.randomBytes(24).toString('hex');
        try {
            fs.mkdirSync(userDataPath, { recursive: true });
            fs.writeFileSync(tokenFile, token, { encoding: 'utf8', mode: 0o600 });
        } catch (err) {
            logger.warn('Could not persist the local API token:', err.message);
        }
        return token;
    }

    function writeApiFile(port) {
        try {
            fs.mkdirSync(userDataPath, { recursive: true });
            fs.writeFileSync(apiFile, JSON.stringify({
                port,
                token: ensureToken(),
                url: `http://127.0.0.1:${port}`,
                version: appVersion
            }, null, 2), { encoding: 'utf8', mode: 0o600 });
        } catch (err) {
            logger.warn('Could not write api.json:', err.message);
        }
    }

    function removeApiFile() {
        try {
            fs.rmSync(apiFile, { force: true });
        } catch (err) {
            // Nothing to clean.
        }
    }

    async function startApi(port) {
        if (api) return { running: true, port: api.port };
        const requestedPort = Number(port);
        const service = createLocalApi({
            // 0 is valid: it asks the OS for a free port, which keeps tests and
            // a second profile from colliding with a fixed number.
            port: Number.isFinite(requestedPort) && requestedPort >= 0 ? requestedPort : 18457,
            token: ensureToken(),
            actions,
            logger
        });
        const started = await service.start();
        api = service;
        writeApiFile(started.port);
        return { running: true, port: started.port };
    }

    async function stopApi() {
        if (!api) {
            removeApiFile();
            return { running: false };
        }
        await api.stop();
        api = null;
        removeApiFile();
        return { running: false };
    }

    async function applyApiSetting() {
        const enabled = getSetting('api_enabled') === 'true';
        if (!enabled) return stopApi();
        try {
            return await startApi(getSetting('api_port'));
        } catch (err) {
            logger.warn('Could not start the local API:', err.message);
            api = null;
            return { running: false, error: err.message };
        }
    }

    function mcpConfigPath() {
        return path.join(mcpDir, 'config.json');
    }

    function mcpServerPath() {
        return path.join(mcpDir, 'server.js');
    }

    function cliScriptPath() {
        return path.join(cliDir, 'tactile.js');
    }

    function cliLauncherPath() {
        return path.join(cliDir, process.platform === 'win32' ? 'tactile.cmd' : 'tactile');
    }

    /** Copies the MCP server and writes the client config snippet. */
    function installMcp() {
        fs.mkdirSync(mcpDir, { recursive: true });
        fs.copyFileSync(path.join(SOURCE_ROOT, 'mcp', 'server.js'), mcpServerPath());
        const config = {
            mcpServers: {
                tactile: {
                    command: 'node',
                    args: [mcpServerPath()],
                    env: { TACTILE_USER_DATA: userDataPath }
                }
            }
        };
        fs.writeFileSync(mcpConfigPath(), JSON.stringify(config, null, 2), 'utf8');
        return { installed: true, configPath: mcpConfigPath(), config };
    }

    /** Copies the CLI and writes a launcher that reuses the app binary. */
    function installCli() {
        fs.mkdirSync(cliDir, { recursive: true });
        fs.copyFileSync(path.join(SOURCE_ROOT, 'cli', 'tactile.js'), cliScriptPath());
        const execPath = process.execPath;
        if (process.platform === 'win32') {
            const launcher = [
                '@echo off',
                'setlocal',
                'set "ELECTRON_RUN_AS_NODE=1"',
                `"${execPath}" "${cliScriptPath()}" %*`,
                ''
            ].join('\r\n');
            fs.writeFileSync(cliLauncherPath(), launcher, 'utf8');
        } else {
            const launcher = [
                '#!/bin/sh',
                'ELECTRON_RUN_AS_NODE=1',
                'export ELECTRON_RUN_AS_NODE',
                `exec "${execPath}" "${cliScriptPath()}" "$@"`,
                ''
            ].join('\n');
            fs.writeFileSync(cliLauncherPath(), launcher, { encoding: 'utf8', mode: 0o755 });
        }
        return { installed: true, path: cliLauncherPath(), script: cliScriptPath() };
    }

    function mcpStatus() {
        const installed = fs.existsSync(mcpServerPath());
        let config = null;
        try {
            config = JSON.parse(fs.readFileSync(mcpConfigPath(), 'utf8'));
        } catch (err) {
            config = null;
        }
        return {
            installed,
            configPath: mcpConfigPath(),
            serverPath: mcpServerPath(),
            config: config || {
                mcpServers: {
                    tactile: {
                        command: 'node',
                        args: [mcpServerPath()],
                        env: { TACTILE_USER_DATA: userDataPath }
                    }
                }
            }
        };
    }

    function cliStatus() {
        return {
            installed: fs.existsSync(cliLauncherPath()),
            path: cliLauncherPath(),
            command: process.platform === 'win32' ? `"${cliLauncherPath()}"` : cliLauncherPath()
        };
    }

    function webhookStatus() {
        const url = getSetting('webhook_url') || '';
        return {
            configured: isSupportedWebhookUrl(url),
            url,
            events: parseEvents(getSetting('webhook_events') || ''),
            lastStatus: lastWebhookStatus
        };
    }

    function status() {
        return {
            api: {
                enabled: getSetting('api_enabled') === 'true',
                running: Boolean(api),
                port: api ? api.port : Number(getSetting('api_port')) || 18457,
                url: api ? `http://127.0.0.1:${api.port}` : '',
                token: ensureToken()
            },
            mcp: mcpStatus(),
            cli: cliStatus(),
            webhook: webhookStatus(),
            version: appVersion
        };
    }

    function notify(event, payload) {
        const url = getSetting('webhook_url') || '';
        const events = getSetting('webhook_events') || '';
        const secret = getSetting('webhook_secret') || '';
        if (!webhookStatus().configured) return false;
        return webhooks.emit({ url, secret, events, event, payload });
    }

    async function testWebhook() {
        const url = getSetting('webhook_url') || '';
        const secret = getSetting('webhook_secret') || '';
        const result = await webhooks.test({ url, secret });
        lastWebhookStatus = { at: new Date().toISOString(), ...result };
        return lastWebhookStatus;
    }

    return {
        applyApiSetting,
        startApi,
        stopApi,
        status,
        installMcp,
        installCli,
        notify,
        testWebhook,
        ensureToken,
        paths: { apiFile, tokenFile, cliDir, mcpDir }
    };
}

module.exports = { createIntegrationService };
