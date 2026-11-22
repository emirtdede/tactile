#!/usr/bin/env node
// Terminal client for Tactile.
//
//   tactile status
//   tactile profiles [--json]
//   tactile activate <profile-id>
//   tactile mute [on|off]
//   tactile volume <0-100>
//   tactile sync
//   tactile docs <query>
//   tactile ask "<question>"
//
// The CLI talks to the loopback REST API that the running app exposes when
// "Local API" is enabled in Settings > Integrations. It reads the port and
// token from api.json in the app data folder, so no credentials live in the
// script and nothing needs administrator rights.
const fs = require('fs');
const os = require('os');
const path = require('path');

const stdout = (...parts) => process.stdout.write(parts.join(' ') + '\n');

const USAGE = `Tactile CLI

Usage:
  tactile status                 Show active profile, mute, volume and backup state
  tactile profiles               List sound profiles
  tactile activate <id>          Activate a profile
  tactile mute [on|off]          Mute or unmute
  tactile volume <0-100>         Set the volume
  tactile sync                   Run a cloud backup now
  tactile docs <query>           Search the documentation
  tactile ask "<question>"       Ask the local documentation assistant

Options:
  --json                         Print raw JSON instead of a table
`;

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

function readConfig() {
    const file = path.join(userDataDir(), 'api.json');
    if (!fs.existsSync(file)) {
        throw new Error('The local API is not enabled. Open Tactile > Settings > Integrations and turn on Local API.');
    }
    const config = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!config || typeof config.port !== 'number' || typeof config.token !== 'string') {
        throw new Error('api.json is invalid. Toggle the Local API setting off and on again.');
    }
    return config;
}

async function request(config, method, pathname, body) {
    const response = await fetch(`http://127.0.0.1:${config.port}${pathname}`, {
        method,
        headers: {
            Authorization: `Bearer ${config.token}`,
            ...(body ? { 'Content-Type': 'application/json' } : {})
        },
        body: body ? JSON.stringify(body) : undefined
    });
    const json = await response.json().catch(() => null);
    if (!response.ok || !json || json.ok === false) {
        throw new Error((json && json.error) || `Request failed with ${response.status}`);
    }
    return json.data;
}

function printProfiles(profiles) {
    if (!Array.isArray(profiles) || profiles.length === 0) {
        stdout('No profiles found.');
        return;
    }
    const rows = profiles.map((profile) => [
        String(profile.id),
        String(profile.name),
        String(profile.type || ''),
        String(profile.material || ''),
        profile.is_active ? 'active' : ''
    ]);
    const header = ['ID', 'NAME', 'CATEGORY', 'MATERIAL', 'STATE'];
    const widths = header.map((title, index) => Math.max(title.length, ...rows.map((row) => row[index].length)));
    const line = (cells) => cells.map((cell, index) => cell.padEnd(widths[index])).join('  ');
    stdout(line(header));
    stdout(widths.map((width) => '-'.repeat(width)).join('  '));
    rows.forEach((row) => stdout(line(row)));
}

async function main(argv) {
    const json = argv.includes('--json');
    const args = argv.filter((arg) => arg !== '--json');
    const command = (args[0] || 'status').toLowerCase();
    if (['help', '--help', '-h'].includes(command)) {
        stdout(USAGE);
        return 0;
    }

    const config = readConfig();
    let result;

    switch (command) {
        case 'status':
            result = await request(config, 'GET', '/v1/status');
            break;
        case 'profiles':
            result = await request(config, 'GET', '/v1/profiles');
            break;
        case 'activate': {
            if (!args[1]) throw new Error('Missing profile id. Run: tactile profiles');
            result = await request(config, 'POST', '/v1/profiles/activate', { id: args[1] });
            break;
        }
        case 'mute': {
            const desired = (args[1] || 'on').toLowerCase();
            if (!['on', 'off', 'true', 'false'].includes(desired)) {
                throw new Error('Use: tactile mute on  or  tactile mute off');
            }
            result = await request(config, 'POST', '/v1/mute', { muted: desired === 'on' || desired === 'true' });
            break;
        }
        case 'volume': {
            const level = Number(args[1]);
            if (!Number.isFinite(level) || level < 0 || level > 100) {
                throw new Error('Volume must be a number between 0 and 100.');
            }
            result = await request(config, 'POST', '/v1/volume', { level });
            break;
        }
        case 'sync':
            result = await request(config, 'POST', '/v1/sync');
            break;
        case 'docs': {
            const query = args.slice(1).join(' ');
            if (!query) throw new Error('Missing search text. Run: tactile docs cloud sync');
            result = await request(config, 'GET', `/v1/docs/search?q=${encodeURIComponent(query)}`);
            break;
        }
        case 'ask': {
            const question = args.slice(1).join(' ');
            if (!question) throw new Error('Missing question. Run: tactile ask "how do I enable cloud sync"');
            result = await request(config, 'POST', '/v1/ask', { question });
            break;
        }
        default:
            console.error(`Unknown command: ${command}`);
            console.error(USAGE);
            return 2;
    }

    if (json) {
        stdout(JSON.stringify(result, null, 2));
        return 0;
    }

    if (command === 'profiles') {
        printProfiles(result);
    } else if (command === 'status') {
        stdout(`Version:  ${result.version}`);
        stdout(`Profile:  ${result.profile ? result.profile.name : 'none'}`);
        stdout(`Muted:    ${result.muted ? 'yes' : 'no'}`);
        stdout(`Volume:   ${result.volume}`);
        stdout(`Cloud:    ${result.cloud && result.cloud.connected ? 'connected' : 'not connected'}`);
    } else if (command === 'docs') {
        (result || []).forEach((hit, index) => {
            const entry = hit.entry || hit;
            stdout(`${index + 1}. ${entry.title}${entry.heading ? ' / ' + entry.heading : ''}`);
            stdout(`   ${String(entry.text).replace(/\s+/g, ' ').slice(0, 160)}...`);
        });
    } else if (command === 'ask') {
        stdout(result.answer || 'No answer available.');
        if (Array.isArray(result.sources) && result.sources.length) {
            stdout('\nSources:');
            result.sources.forEach((source) => stdout(`- ${source.title}${source.heading ? ' / ' + source.heading : ''}`));
        }
    } else {
        stdout('OK');
    }
    return 0;
}

if (require.main === module) {
    main(process.argv.slice(2))
        .then((code) => process.exit(code))
        .catch((err) => {
            console.error(err.message);
            process.exit(1);
        });
}

module.exports = { userDataDir, readConfig, main };
