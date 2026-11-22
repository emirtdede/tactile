// Loopback-only REST API used by the CLI, the MCP server and scripted
// automation. It is off by default, binds to 127.0.0.1, and every request must
// carry the per-install bearer token. No CORS headers are sent, so a random web
// page cannot read responses even if it guesses the port.
const http = require('http');
const crypto = require('crypto');

const MAX_BODY_BYTES = 64 * 1024;
const RATE_WINDOW_MS = 1000;
const RATE_LIMIT = 40;

function timingSafeEqual(a, b) {
    const left = Buffer.from(String(a));
    const right = Buffer.from(String(b));
    if (left.length !== right.length) return false;
    return crypto.timingSafeEqual(left, right);
}

/**
 * @param {object} options
 * @param {number} options.port  requested port, 0 picks a free one
 * @param {string} options.token bearer token (required)
 * @param {object} options.actions { status, profiles, activateProfile, setMuted, setVolume, sync, ask, search }
 */
function createLocalApi({ port = 18457, token = '', actions = {}, logger = console } = {}) {
    if (!token || token.length < 24) {
        throw new Error('A local API token of at least 24 characters is required');
    }

    let server = null;
    let listeningPort = null;
    let requestCount = 0;
    let windowStarted = Date.now();

    function json(res, status, payload) {
        const body = JSON.stringify(payload);
        res.writeHead(status, {
            'Content-Type': 'application/json; charset=utf-8',
            'Content-Length': Buffer.byteLength(body),
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff'
        });
        res.end(body);
    }

    function readBody(req) {
        return new Promise((resolve, reject) => {
            let size = 0;
            const chunks = [];
            req.on('data', (chunk) => {
                size += chunk.length;
                if (size > MAX_BODY_BYTES) {
                    reject(Object.assign(new Error('payload-too-large'), { status: 413 }));
                    req.destroy();
                    return;
                }
                chunks.push(chunk);
            });
            req.on('end', () => {
                const raw = Buffer.concat(chunks).toString('utf8');
                if (!raw) return resolve({});
                try {
                    resolve(JSON.parse(raw));
                } catch (err) {
                    reject(Object.assign(new Error('invalid-json'), { status: 400 }));
                }
            });
            req.on('error', reject);
        });
    }

    async function route(req, url) {
        const method = req.method || 'GET';
        const pathname = url.pathname.replace(/\/+$/, '') || '/';

        if (method === 'GET' && pathname === '/v1/status') return actions.status ? actions.status() : {};
        if (method === 'GET' && pathname === '/v1/profiles') return actions.profiles ? actions.profiles() : [];

        if (method === 'POST' && pathname === '/v1/profiles/activate') {
            const body = await readBody(req);
            if (!body || typeof body.id !== 'string') {
                throw Object.assign(new Error('id-required'), { status: 400 });
            }
            return actions.activateProfile ? actions.activateProfile(body.id) : { success: false };
        }

        if (method === 'POST' && pathname === '/v1/mute') {
            const body = await readBody(req);
            if (typeof body.muted !== 'boolean') {
                throw Object.assign(new Error('muted-required'), { status: 400 });
            }
            return actions.setMuted ? actions.setMuted(body.muted) : { success: false };
        }

        if (method === 'POST' && pathname === '/v1/volume') {
            const body = await readBody(req);
            const level = Number(body.level);
            if (!Number.isFinite(level) || level < 0 || level > 100) {
                throw Object.assign(new Error('level-out-of-range'), { status: 400 });
            }
            return actions.setVolume ? actions.setVolume(Math.round(level)) : { success: false };
        }

        if (method === 'POST' && pathname === '/v1/sync') {
            return actions.sync ? actions.sync() : { success: false };
        }

        if (method === 'POST' && pathname === '/v1/ask') {
            const body = await readBody(req);
            if (!body || typeof body.question !== 'string' || body.question.length > 2000) {
                throw Object.assign(new Error('question-required'), { status: 400 });
            }
            return actions.ask ? actions.ask(body.question) : { answer: '', sources: [] };
        }

        if (method === 'GET' && pathname === '/v1/docs/search') {
            const query = (url.searchParams.get('q') || '').slice(0, 300);
            return actions.search ? actions.search(query) : [];
        }

        throw Object.assign(new Error('not-found'), { status: 404 });
    }

    async function handle(req, res) {
        // Rate limit before parsing anything, so a local loop cannot starve the
        // app's own IPC.
        const now = Date.now();
        if (now - windowStarted > RATE_WINDOW_MS) {
            windowStarted = now;
            requestCount = 0;
        }
        requestCount += 1;
        if (requestCount > RATE_LIMIT) return json(res, 429, { error: 'rate-limited' });

        const auth = req.headers.authorization || '';
        const provided = auth.startsWith('Bearer ') ? auth.slice(7) : '';
        if (!provided || !timingSafeEqual(provided, token)) {
            return json(res, 401, { error: 'unauthorized' });
        }

        let url;
        try {
            url = new URL(req.url || '/', `http://127.0.0.1:${listeningPort || port}`);
        } catch (err) {
            return json(res, 400, { error: 'bad-request' });
        }

        try {
            const result = await route(req, url);
            return json(res, 200, { ok: true, data: result });
        } catch (err) {
            const status = err && err.status ? err.status : 500;
            if (status >= 500) logger.warn('Local API error:', err.message);
            return json(res, status, { ok: false, error: err.message || 'request-failed' });
        }
    }

    function start() {
        return new Promise((resolve, reject) => {
            server = http.createServer((req, res) => {
                handle(req, res).catch((err) => {
                    logger.warn('Local API handler error:', err.message);
                    if (!res.headersSent) json(res, 500, { ok: false, error: 'internal-error' });
                });
            });
            server.once('error', reject);
            server.listen(port, '127.0.0.1', () => {
                listeningPort = server.address().port;
                resolve({ port: listeningPort });
            });
        });
    }

    function stop() {
        return new Promise((resolve) => {
            if (!server) return resolve();
            server.close(() => {
                server = null;
                listeningPort = null;
                resolve();
            });
        });
    }

    return {
        start,
        stop,
        get port() { return listeningPort; }
    };
}

module.exports = { createLocalApi, timingSafeEqual };
