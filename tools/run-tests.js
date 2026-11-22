// Runs every contract and unit test in tools/tests with the built-in runner.
// Passing the directory itself to `node --test` is not portable across Node
// versions, so the files are resolved here and handed over explicitly.
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const testsDir = path.join(__dirname, 'tests');
const files = fs
    .readdirSync(testsDir)
    .filter((fileName) => fileName.endsWith('.test.js'))
    .sort()
    .map((fileName) => path.join(testsDir, fileName));

if (files.length === 0) {
    console.error('No test files found in tools/tests');
    process.exit(1);
}

const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
process.exit(result.status === null ? 1 : result.status);
