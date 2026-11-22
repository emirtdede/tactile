// Documentation corpus for the assistant and for the CLI/MCP search tools.
//
// The Markdown files in docs/ are the source of truth. They are packaged with
// the app, so the index can be rebuilt offline and stays in sync with what the
// user reads in the Documentation view.
const fs = require('fs');
const path = require('path');

const DOC_ORDER = [
    'FEATURES.md',
    'CLOUD_SYNC.md',
    'UPDATES.md',
    'LOCALIZATION.md',
    'SECURITY.md',
    'DEVELOPMENT.md',
    'TESTING.md',
    'DEPLOYMENT.md',
    'ARCHITECTURE.md',
    'TECHNICAL_DEBT.md',
    'ROADMAP.md',
    'RISKS.md'
];

/** Short in-app articles that are not part of the release docs. */
const IN_APP_GUIDE = `# Keyboard sounds

Tactile plays a mechanical keyboard sound for every key press. Open Sound Library,
pick a profile and press Set Active. The Preview button plays a sample without
changing the active profile.

# Categories and materials

Profiles are grouped into categories such as Linear, Tactile and Clicky. The
material filter narrows the list to PBT or ABS. Create a category from the
Categories block in the second sidebar; rename or delete it from the same menu.

# Importing sounds

Import Sounds accepts a folder of audio files or a mixed pack. Use New Sound to
map individual keys. Everything you import is copied into the app data folder, so
the original files can be moved or deleted afterwards.

# Volume, mute and hotkeys

The speaker icon in the toolbar sets the volume. Control K toggles mute by
default and Control Alt N opens the import screen from anywhere. Both hotkeys can
be changed in Settings > Shortcuts; clearing a hotkey disables it.

# Themes and icons

Settings > Appearance offers System, Light, Dark and a custom hex colour. The
app icon can follow the theme, force the light or dark mark, or use the custom
colour. The choice applies to the window, taskbar, tray and desktop shortcut.

# Accessibility

Interface zoom scales the app from 80 to 150 percent. High contrast strengthens
borders and secondary text. Reduce motion removes animations. All controls are
reachable with the keyboard and every dialog closes with Escape.

# Cloud backup

Settings > Data and backup connects OneDrive, Google Drive, Dropbox or any folder.
Snapshots are written atomically to a Tactile folder, previous snapshots are kept
for 15 days, and restore asks before replacing local data. An empty device never
overwrites a usable backup.

# Updates

Settings > Updates checks GitHub releases. Downloads use delta packages when
available. Microsoft Store installs update through the Store instead.

# Diagnostics and support

Diagnostics shows database, keyboard hook, tray and cloud state plus versions and
memory use. Copy report or Save report produce a support-ready text file. Logs
open straight from the page.

# Local AI assistant

The assistant is optional and off by default. Install Ollama, pick a model that
fits your memory, then enable the assistant. Models download only when you ask,
and you can delete them at any time. All inference stays on this computer.

# Integrations

Integrations offers a loopback REST API, outbound webhooks, an MCP server for AI
coding agents, and a terminal CLI. Each one is off until you enable it and each
one uses a token or signature generated on this machine.
`;

/**
 * Reads the shipped Markdown documentation plus the in-app guide.
 * @param {string} docsDir absolute path to the docs folder
 */
function loadDocuments(docsDir) {
    const documents = [{
        id: 'guide',
        title: 'Tactile quick guide',
        text: IN_APP_GUIDE,
        url: 'https://github.com/emirtdede/tactile/tree/main/docs'
    }];

    let files = [];
    try {
        files = fs.readdirSync(docsDir).filter((fileName) => fileName.toLowerCase().endsWith('.md'));
    } catch (err) {
        files = [];
    }

    const ordered = DOC_ORDER.filter((fileName) => files.includes(fileName));
    const rest = files.filter((fileName) => !ordered.includes(fileName) && fileName !== 'README.md').sort();
    for (const fileName of [...ordered, ...rest]) {
        try {
            const text = fs.readFileSync(path.join(docsDir, fileName), 'utf8');
            documents.push({
                id: fileName.replace(/\.md$/i, '').toLowerCase(),
                title: fileName.replace(/\.md$/i, ''),
                text,
                url: `https://github.com/emirtdede/tactile/blob/main/docs/${fileName}`
            });
        } catch (err) {
            // A missing or unreadable document must not break the index.
        }
    }
    return documents;
}

module.exports = { loadDocuments, IN_APP_GUIDE, DOC_ORDER };
