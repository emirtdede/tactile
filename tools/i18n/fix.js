// Targeted cleanup after the bulk translation pass:
//  - re-translate %s strings with a placeholder token (the public endpoint
//    sometimes echoes mixed-language input verbatim)
//  - replace values that came back untranslated for a handful of locales
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const LOC = path.join(ROOT, 'src', 'locales');

const PLACEHOLDER_KEYS = [
    'settings.updates_current',
    'settings.updates_available',
    'settings.updates_downloading',
    'cloud.last_sync',
    'cloud.backups',
    'wizard.of',
    'notify.profile_body',
    'notify.update_body',
    'tray.status_active'
];
const RETRANSLATE = {
    hi: PLACEHOLDER_KEYS,
    sr: PLACEHOLDER_KEYS,
    'zh-CN': ['wizard.of']
};

const FIXES = {
    fil: {
        'settings.updates_downloading': 'Nagda-download ng update: %s porsiyento'
    },
    af: {
        'settings.zoom_title': 'Koppelvlakzoom',
        'settings.launcher_title': 'Vinnige taak',
        'settings.launcher_desc': 'Maak Tactile op die Invoer-klanke-skerm van enige plek oop.',
        'diag.tray': 'Stelselbalk'
    },
    bs: {
        'nav.sounds': 'Biblioteka zvukova',
        'cloud.folder': 'Mapa za rezervne kopije'
    },
    da: {
        'nav.support': 'Støtte',
        'support.title': 'Støtte',
        'sidebar.cloud': 'Skysikkerhedskopi',
        'settings.zoom_title': 'Grænsefladezoom'
    },
    es: {
        'settings.updates_ready': 'El instalador se iniciará ahora. Tactile se cerrará.',
        'toast.error': 'Algo salió mal. Inténtalo de nuevo.'
    },
    fil: {
        'nav.sounds': 'Aklatan ng Tunog',
        'nav.workspace': 'Lugar ng Trabaho',
        'sidebar.cloud': 'Panagipon sa ulap',
        'cloud.provider': 'Tagapagbigay',
        'diag.os': 'Sistema ng pagpapatakbo',
        'diag.tray': 'Sistema ng tray',
        'about.publisher': 'Tagapaglathala',
        'about.github': 'Repositoryo sa GitHub',
        'settings.updates_downloading': 'Binababa ang bagong bersyon: %s porsiyento',
        'about.made_with': 'Ginawa gamit ang Electron at malayang programa.'
    },
    my: {
        'about.made_with': 'Electron နှင့် အခမဲ့ ဆော့ဖ်ဝဲလ်ဖြင့် တည်ဆောက်ထားသည်။'
    },
    nl: {
        'cloud.provider': 'Aanbieder',
        'tray.open': 'Tactile openen',
        'about.made_with': 'Gebouwd met Electron en vrije software.'
    },
    fr: {
        'about.publisher': 'Éditeur',
        'support.title': 'Assistance'
    },
    ha: {
        'sidebar.categories': 'Rukunoni',
        'sidebar.categories_count': 'Rukunoni',
        'diag.db': 'Rijistar bayanai'
    },
    ky: {
        'nav.workspace': 'Иштөө аймагы'
    },
    nb: {
        'sidebar.cloud': 'Skysikkerhetskopi'
    },
    de: {
        'support.title': 'Unterstützung'
    },
    it: {
        'cloud.provider': 'Fornitore'
    },
    sv: {
        'nav.support': 'Stöd',
        'support.title': 'Stöd',
        'sidebar.cloud': 'Molnsäkerhetskopiering'
    }
};

function esc(value) {
    return "'" + String(value)
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/\r?\n/g, '\\n') + "'";
}

function serialize(code, dict) {
    const body = Object.entries(dict)
        .map(([k, v]) => `        ${esc(k)}: ${esc(v)}`)
        .join(',\n');
    const bracket = code.includes('-') ? `['${code}']` : `.${code}`;
    return `(function (root) {
    const dict = {
${body}
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = dict;
    if (typeof window !== 'undefined') {
        window.TACTILE_LOCALES = window.TACTILE_LOCALES || {};
        window.TACTILE_LOCALES${bracket} = dict;
    }
})(typeof globalThis !== 'undefined' ? globalThis : this);
`;
}

async function apiTranslate(text, code) {
    const url = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&dt=t'
        + `&tl=${encodeURIComponent(code)}&q=${encodeURIComponent(text)}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    return (json[0] || []).map((seg) => seg[0]).join('');
}

async function translateWithToken(value, code) {
    const parts = value.split('%s');
    const token = '__VALUE__';
    const joined = parts.join(` ${token} `);
    const translated = await apiTranslate(joined, code);
    return translated.replace(/\s*__value__\s*/gi, '%s').replace(/\s{2,}/g, ' ').trim();
}

async function main() {
    const en = require(path.join(LOC, 'en.js'));
    for (const [code, keys] of Object.entries(RETRANSLATE)) {
        const file = path.join(LOC, `${code}.js`);
        delete require.cache[require.resolve(file)];
        const dict = require(file);
        for (const key of keys) {
            dict[key] = await translateWithToken(en[key], code);
            await new Promise((r) => setTimeout(r, 150));
        }
        fs.writeFileSync(file, serialize(code, dict), 'utf8');
        console.log(`${code}: retranslated ${keys.length}`);
    }

    for (const [code, pairs] of Object.entries(FIXES)) {
        const file = path.join(LOC, `${code}.js`);
        delete require.cache[require.resolve(file)];
        const dict = require(file);
        Object.assign(dict, pairs);
        fs.writeFileSync(file, serialize(code, dict), 'utf8');
        console.log(`${code}: fixed ${Object.keys(pairs).length}`);
    }
}

main().catch((err) => { console.error(err); process.exit(1); });
