// Prints translation coverage for every language in the registry.
// Run: node tools/i18n-status.js
const path = require('path');

const LOC = path.join(__dirname, '..', 'src', 'locales');
const languages = require(path.join(LOC, 'languages.js'));
const english = require(path.join(LOC, 'en.js'));
const englishKeys = Object.keys(english);

let complete = 0;
let partial = 0;
let missing = 0;

for (const { code } of languages) {
    const dict = require(path.join(LOC, `${code}.js`));
    const keys = Object.keys(dict);
    const absent = englishKeys.filter((key) => !(key in dict));
    const blank = englishKeys.filter((key) => key in dict && String(dict[key]).trim() === '');
    if (absent.length === 0 && blank.length === 0) {
        complete++;
    } else if (keys.length === 0) {
        missing++;
        console.log(`${code}: missing (${absent.length} keys)`);
    } else {
        partial++;
        console.log(`${code}: ${absent.length} absent, ${blank.length} blank`);
    }
}

console.log(`languages: ${languages.length} declared, ${complete} complete, ${missing} missing, ${partial} partial`);
if (complete !== languages.length) process.exitCode = 1;
