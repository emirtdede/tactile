const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const LOC = path.join(ROOT, 'src', 'locales');
const en = require(path.join(LOC, 'en.js'));
const NEW = require(path.join(ROOT, 'tools', 'i18n', 'new-keys.js'));
const langs = require(path.join(LOC, 'languages.js'));

const BRANDS = /^(Microsoft OneDrive|Google Drive|Dropbox)$/;
const rows = [];
for (const { code } of langs) {
    if (code === 'en') continue;
    const d = require(path.join(LOC, `${code}.js`));
    for (const key of Object.keys(NEW)) {
        if (BRANDS.test(String(en[key]).trim())) continue;
        if (String(d[key]).trim() === String(en[key]).trim()) rows.push(`${code}\t${key}\t${en[key]}`);
    }
}
fs.writeFileSync(path.join(ROOT, 'i18n-identical.txt'), rows.join('\n') + '\n', 'utf8');
console.log('identical:', rows.length);
const byKey = {};
for (const r of rows) { const k = r.split('\t')[1]; byKey[k] = (byKey[k] || 0) + 1; }
console.log(Object.entries(byKey).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`${v} ${k}`).join('\n'));
