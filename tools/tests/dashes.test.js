// Fails if any source file contains an em dash (U+2014), en dash (U+2013) or
// horizontal bar (U+2015). Run: node tools/tests/dashes.test.js (node:test).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const SKIP = new Set(['node_modules', 'dist', '.git', 'audio', 'screenshots']);

function walk(dir, out) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (SKIP.has(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, out);
        else if (/\.(js|json|md|html|css|yml|yaml|nsh|txt)$/.test(entry.name)) out.push(full);
    }
    return out;
}

test('no file uses an em dash, en dash or horizontal bar', () => {
    const offenders = [];
    for (const file of walk(ROOT, [])) {
        const text = fs.readFileSync(file, 'utf8');
        const lines = text.split(/\r?\n/);
        lines.forEach((line, index) => {
            if (/[\u2013\u2014\u2015]/.test(line)) {
                offenders.push(`${path.relative(ROOT, file)}:${index + 1}: ${line.trim().slice(0, 80)}`);
            }
        });
    }
    assert.deepStrictEqual(offenders, []);
});
