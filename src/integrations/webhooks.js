// Outbound webhooks for automation platforms (n8n, Zapier, Make, a custom
// endpoint). Delivery is best effort: a failing endpoint must never block the
// UI or the audio thread, so events are queued and retried in the background.
const crypto = require('crypto');

const VALID_EVENTS = ['profile', 'mute', 'volume', 'sync', 'restore'];
const MAX_QUEUE = 50;

/** Only http(s) endpoints are allowed; file: and shell handlers stay blocked. */
function isSupportedWebhookUrl(value) {
    try {
        const url = new URL(String(value));
        return url.protocol === 'https:' || url.protocol === 'http:';
    } catch (err) {
        return false;
    }
}

function signPayload(secret, timestamp, body) {
    return 'sha256=' + crypto
        .createHmac('sha256', String(secret || ''))
        .update(`${timestamp}.${body}`)
        .digest('hex');
}

function parseEvents(value) {
    const list = Array.isArray(value) ? value : String(value || '').split(',');
    return list
        .map((event) => String(event).trim().toLowerCase())
        .filter((event) => VALID_EVENTS.includes(event));
}

function createWebhookSender({ fetchImpl = globalThis.fetch, logger = console, timeoutMs = 6000 } = {}) {
    const queue = [];
    let draining = false;

    async function post({ url, secret, event, payload }) {
        const body = JSON.stringify({
            event,
            sentAt: new Date().toISOString(),
            product: 'Tactile',
            source: 'desktop',
            data: payload === undefined ? null : payload
        });
        const timestamp = Math.floor(Date.now() / 1000);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const response = await fetchImpl(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': 'Tactile-Webhook/1.1',
                    'X-Tactile-Event': event,
                    'X-Tactile-Timestamp': String(timestamp),
                    'X-Tactile-Signature': signPayload(secret, timestamp, body)
                },
                body,
                signal: controller.signal
            });
            return { success: response.ok, status: response.status };
        } catch (err) {
            return { success: false, status: 0, error: err && err.name === 'AbortError' ? 'timeout' : err.message };
        } finally {
            clearTimeout(timer);
        }
    }

    async function drain() {
        if (draining) return;
        draining = true;
        try {
            while (queue.length) {
                const job = queue.shift();
                const result = await post(job);
                if (!result.success) {
                    job.attempts += 1;
                    if (job.attempts < 3) {
                        // Back off without blocking: re-queue at the end.
                        queue.push(job);
                        await new Promise((resolve) => setTimeout(resolve, 1500 * job.attempts));
                    } else {
                        logger.warn('Webhook delivery failed:', job.event, result.error || result.status);
                    }
                }
            }
        } finally {
            draining = false;
        }
    }

    /** Queue an event. Returns false when webhooks are not configured. */
    function emit({ url, secret, events, event, payload }) {
        if (!isSupportedWebhookUrl(url)) return false;
        if (!parseEvents(events).includes(event)) return false;
        if (queue.length >= MAX_QUEUE) queue.shift();
        queue.push({ url, secret, event, payload, attempts: 0 });
        drain().catch((err) => logger.warn('Webhook queue error:', err.message));
        return true;
    }

    async function test({ url, secret }) {
        if (!isSupportedWebhookUrl(url)) return { success: false, error: 'invalid-url' };
        return post({ url, secret, event: 'profile', payload: { test: true } });
    }

    return { emit, test, pending: () => queue.length };
}

module.exports = { createWebhookSender, isSupportedWebhookUrl, signPayload, parseEvents, VALID_EVENTS };
