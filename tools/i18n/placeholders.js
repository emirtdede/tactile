// Flags placeholder problems the plain "same %s count" check misses:
//  - leftover __TOKEN__ markers from a translation pass
//  - %s glued to a neighbouring word on either side
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const LOC = path.join(ROOT, 'src', 'locales');
const languages = require(path.join(LOC, 'languages.js'));

// Scripts that do not separate words with spaces, plus languages whose grammar
// attaches case suffixes directly to a number, legitimately write "%s" next to
// a letter ("%s\u4ef6", "\ubc84\uc804 %s\uc774"). Only spaced-word languages are
// checked for a glued placeholder, which is the real "Version%sist" bug.
const NO_SPACE = new Set(['ja', 'zh-CN', 'zh-TW', 'th', 'km', 'lo', 'my', 'ko', 'az', 'te', 'uz']);

const rows = [];
for (const { code } of languages) {
    const dict = require(path.join(LOC, `${code}.js`));
    for (const [key, value] of Object.entries(dict)) {
        const text = String(value);
        if (/__[A-Za-z0-9_]{2,}__/.test(text)) rows.push(`${code}\t${key}\tTOKEN\t${text}`);
        if (!NO_SPACE.has(code) && /[\p{L}\d]%s|%s[\p{L}\d]/u.test(text)) rows.push(`${code}\t${key}\tGLUED\t${text}`);
    }
}
fs.writeFileSync(path.join(ROOT, 'i18n-placeholders.txt'), rows.join('\n') + '\n', 'utf8');
console.log(`issues: ${rows.length}`);
