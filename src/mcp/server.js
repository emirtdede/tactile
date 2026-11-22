#!/usr/bin/env node
// Model Context Protocol server for Tactile.
//
// JSON-RPC 2.0 over stdio, so Claude Desktop, Cursor, Windsurf, Cline and any
// other MCP client can read the current sound state and drive Tactile without a
// second privileged channel. Every call is forwarded to the loopback REST API
// with the install's bearer token; this process never touches the database.
const fs = require('fs');
const os = require('os');
const path = require('path');

const PROTOCOL_VERSION = '2024-11-05';
const SERVER_INFO = { name: 'tactile-mcp', version: '1.1.0' };

const TOOLS = [
    {
        name: 'tactile_status',
        description: 'Read the Tactile runtime status: active sound profile, mute, volume, cloud backup and version.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false }
    },
    {
        name: 'tactile_list_profiles',
        description: 'List every sound profile with its category, material and whether it is active.',
        inputSchema: {
            type: 'object',
            properties: {
                category: { type: 'string', description: 'Optional category name filter, for example Linear.' }
            },
            additionalProperties: false
        }
    },
    {
        name: 'tactile_activate_profile',
        description: 'Activate a sound profile by id. Changes the sounds the keyboard plays immediately.',
        inputSchema: {
            type: 'object',
            properties: { id: { type: 'string', description: 'Profile id from tactile_list_profiles.' } },
            required: ['id'],
            additionalProperties: false
        }
    },
    {
        name: 'tactile_set_mute',
        description: 'Mute or unmute the keyboard sounds.',
        inputSchema: {
            type: 'object',
            properties: { muted: { type: 'boolean' } },
            required: ['muted'],
            additionalProperties: false
        }
    },
    {
        name: 'tactile_set_volume',
        description: 'Set the sound volume between 0 and 100.',
        inputSchema: {
            type: 'object',
            properties: { level: { type: 'integer', minimum: 0, maximum: 100 } },
            required: ['level'],
            additionalProperties: false
        }
    },
    {
        name: 'tactile_sync',
        description: 'Run a cloud backup sync now and report the resulting snapshot status.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false }
    },
    {
        name: 'tactile_search_docs',
        description: 'Search the bundled Tactile documentation and return the best matching sections.',
        inputSchema: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'Natural language question or keywords.' },
                limit: { type: 'integer', minimum: 1, maximum: 10, default: 5 }
            },
            required: ['query'],
            additionalProperties: false
        }
    },
    {
        name: 'tactile_ask',
        description: 'Ask the local documentation assistant a question. Requires the optional local AI model; returns an answer with sources.',
        inputSchema: {
            type: 'object',
            properties: { question: { type: 'string' } },
            required: ['question'],
            additionalProperties: false
        }
    }
];

function userDataDir() {
    if (process.env.TACTILE_USER_DATA) return process.env.TACTILE_USER_DATA;
    if (process.platform === 'win32') {
        return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Tactile');
    }
    if (process.platform === 'darwin') {
        return path.join(os.homedir(), 'Library', 'Application Support', 'Tactile');
    }
    return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'Tactile');
}

function readApiConfig() {
    const file = path.join(userDataDir(), 'api.json');
    const config = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!config || typeof config.port !== 'number' || typeof config.token !== 'string') {
        throw new Error('api.json is missing the port or token');
    }
    return config;
}

async function callApi(config, method, pathname, body) {
    const url = `http://127.0.0.1:${config.port}${pathname}`;
    const response = await fetch(url, {
        method,
        headers: {
            Authorization: `Bearer ${config.token}`,
            ...(body ? { 'Content-Type': 'application/json' } : {})
        },
        body: body ? JSON.stringify(body) : undefined
    });
    const json = await response.json().catch(() => null);
    if (!response.ok || !json || json.ok === false) {
        throw new Error((json && json.error) || `Local API responded ${response.status}`);
    }
    return json.data;
}

async function runTool(name, args = {}) {
    const config = readApiConfig();
    switch (name) {
        case 'tactile_status':
            return callApi(config, 'GET', '/v1/status');
        case 'tactile_list_profiles': {
            const profiles = await callApi(config, 'GET', '/v1/profiles');
            if (!args.category) return profiles;
            return profiles.filter((profile) => String(profile.type).toLowerCase() === String(args.category).toLowerCase());
        }
        case 'tactile_activate_profile':
            return callApi(config, 'POST', '/v1/profiles/activate', { id: args.id });
        case 'tactile_set_mute':
            return callApi(config, 'POST', '/v1/mute', { muted: Boolean(args.muted) });
        case 'tactile_set_volume':
            return callApi(config, 'POST', '/v1/volume', { level: Number(args.level) });
        case 'tactile_sync':
            return callApi(config, 'POST', '/v1/sync');
        case 'tactile_search_docs':
            return callApi(config, 'GET', `/v1/docs/search?q=${encodeURIComponent(args.query || '')}`);
        case 'tactile_ask':
            return callApi(config, 'POST', '/v1/ask', { question: args.question });
        default:
            throw new Error(`Unknown tool: ${name}`);
    }
}

function send(message) {
    process.stdout.write(JSON.stringify(message) + '\n');
}

async function handleRequest(request) {
    const { id, method, params } = request;
    const reply = (result) => send({ jsonrpc: '2.0', id, result });
    const fail = (code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });

    if (method === 'initialize') {
        return reply({
            protocolVersion: PROTOCOL_VERSION,
            capabilities: { tools: {}, resources: {} },
            serverInfo: SERVER_INFO,
            instructions: 'Tactile plays mechanical keyboard sounds. Use tactile_status first, then list profiles before activating one.'
        });
    }
    if (method === 'ping') return reply({});
    if (method === 'tools/list') return reply({ tools: TOOLS });
    if (method === 'resources/list') {
        return reply({
            resources: [{
                uri: 'tactile://docs/index',
                name: 'Tactile documentation index',
                description: 'Feature, cloud sync, update, integration and troubleshooting documentation.',
                mimeType: 'text/markdown'
            }]
        });
    }
    if (method === 'resources/read') {
        const uri = params && params.uri;
        if (uri !== 'tactile://docs/index') return fail(-32602, 'Unknown resource');
        try {
            const docs = await callApi(readApiConfig(), 'GET', '/v1/docs/search?q=index');
            const text = (docs || []).map((hit) => `# ${hit.title}\n${hit.text}`).join('\n\n');
            return reply({ contents: [{ uri, mimeType: 'text/markdown', text: text || 'No documents indexed.' }] });
        } catch (err) {
            return fail(-32603, err.message);
        }
    }
    if (method === 'tools/call') {
        const name = params && params.name;
        if (!TOOLS.some((tool) => tool.name === name)) return fail(-32602, `Unknown tool: ${name}`);
        try {
            const result = await runTool(name, (params && params.arguments) || {});
            return reply({ content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] });
        } catch (err) {
            return reply({ content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true });
        }
    }
    return fail(-32601, `Method not found: ${method}`);
}

function start() {
    let buffer = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
        buffer += chunk;
        let newline = buffer.indexOf('\n');
        while (newline !== -1) {
            const line = buffer.slice(0, newline).trim();
            buffer = buffer.slice(newline + 1);
            newline = buffer.indexOf('\n');
            if (!line) continue;
            let request;
            try {
                request = JSON.parse(line);
            } catch (err) {
                send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
                continue;
            }
            // Notifications carry no id and need no response.
            if (request && request.method && request.id !== undefined) {
                handleRequest(request).catch((err) => {
                    send({ jsonrpc: '2.0', id: request.id, error: { code: -32603, message: err.message } });
                });
            }
        }
    });
}

if (require.main === module) start();

module.exports = { TOOLS, readApiConfig, runTool, userDataDir, PROTOCOL_VERSION };
