const fs = require('fs');
const path = require('path');
const extract = require('extract-zip');

const zip = process.argv[2];
const dest = path.join(__dirname, '..', 'node_modules', 'electron', 'dist');

(async () => {
    fs.rmSync(dest, { recursive: true, force: true });
    fs.mkdirSync(dest, { recursive: true });
    await extract(zip, { dir: path.resolve(dest) });
    fs.writeFileSync(path.join(dest, 'version'), 'v30.5.1', 'utf8');
    fs.writeFileSync(path.join(__dirname, '..', 'node_modules', 'electron', 'path.txt'), 'electron.exe', 'utf8');
    console.log('extracted', fs.existsSync(path.join(dest, 'electron.exe')));
})().catch((err) => { console.error(err); process.exit(1); });
