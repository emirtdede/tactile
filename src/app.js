// Tactile UI Logic

let profiles = [];
let audio_instances = {}; // sound_id -> Howl (multi) / { single: Howl }
let current_view = 'linear';
let active_profile_id = null;
let settings = {};
let categories = [];
let materials = ['PBT', 'ABS', 'Mixed'];
let active_preview_howl = null; // Currently playing preview sound instance

// Single-pack playback metadata (avoids reaching into Howler internals).
let single_has_sprites = false;
let single_sprite_ids = new Set();

// Guards against out-of-order async responses (preview / activation).
let preview_request_id = 0;
let activation_request_id = 0;

// Only register document-level listeners once.
let global_listeners_bound = false;

// Cached app version so the label can be repainted on language change.
let app_version = '';

// Last line of defence: a rejected promise anywhere in the renderer must be
// logged instead of disappearing silently (the settings helpers already handle
// their own failures, but a bug in an unmatched path would otherwise be
// invisible in production).
window.addEventListener('unhandledrejection', (event) => {
    console.error('Unhandled promise rejection:', event.reason);
});

function escapeHtml(value) {
    return String(value === null || value === undefined ? '' : value).replace(/[&<>"']/g, (character) => {
        switch (character) {
            case '&': return '&amp;';
            case '<': return '&lt;';
            case '>': return '&gt;';
            case '"': return '&quot;';
            default: return '&#39;';
        }
    });
}

/**
 * Persist a setting through the IPC bridge.
 *
 * Every settings write goes through this single helper so that a rejected
 * `invoke` can never surface as an unhandled promise rejection, and so the
 * user never sees a raw system error. Returns `true` on success, `false` on
 * failure (the caller can decide whether the UI needs to revert).
 */
async function persistSetting(key, value) {
    try {
        const result = await window.api.updateSetting(key, value);
        // The main process answers false when it rejected the value (an
        // unregisterable hotkey, an unknown key, a key it failed to normalise).
        return result !== false;
    } catch (err) {
        console.error(`Failed to persist setting "${key}":`, err);
        return false;
    }
}

function getVolume() {
    const input = document.getElementById('global-volume');
    const parsed = input ? Number.parseInt(input.value, 10) : 50;
    return Number.isFinite(parsed) ? Math.max(0, Math.min(100, parsed)) / 100 : 0.5;
}

// ─── Appearance helpers ──────────────────────────────────────────────────────

const DEFAULT_ACCENT = '#D4AF37';

function isValidHexColor(value) {
    return /^#[0-9a-fA-F]{6}$/.test(String(value || ''));
}

function normalizeHex(value) {
    return isValidHexColor(value) ? String(value).toUpperCase() : null;
}

function hexToRgb(hex) {
    const value = String(hex).replace('#', '');
    return {
        r: Number.parseInt(value.slice(0, 2), 16),
        g: Number.parseInt(value.slice(2, 4), 16),
        b: Number.parseInt(value.slice(4, 6), 16)
    };
}

function mixHex(hex, target, amount) {
    const from = hexToRgb(hex);
    const to = hexToRgb(target);
    const channel = (a, b) => Math.round(a + (b - a) * amount).toString(16).padStart(2, '0');
    return `#${channel(from.r, to.r)}${channel(from.g, to.g)}${channel(from.b, to.b)}`.toUpperCase();
}

// WCAG 2.1 relative luminance and contrast ratio. Accent text must stay readable
// for every custom colour the user can pick, not only the two built-in themes.
function relativeLuminance(hex) {
    const { r, g, b } = hexToRgb(hex);
    const channel = (value) => {
        const c = value / 255;
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrastRatio(a, b) {
    const first = relativeLuminance(a);
    const second = relativeLuminance(b);
    const lighter = Math.max(first, second);
    const darker = Math.min(first, second);
    return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Returns `color` when it already reaches 4.5:1 on `background`, otherwise the
 * closest step toward black or white that does. Used only for text and icons,
 * while fills keep the user's exact colour.
 */
function accessibleAccent(color, background) {
    if (!isValidHexColor(color) || !isValidHexColor(background)) return color;
    if (contrastRatio(color, background) >= 4.5) return color.toUpperCase();

    const target = relativeLuminance(background) > 0.5 ? '#000000' : '#FFFFFF';
    let candidate = color;
    for (let step = 1; step <= 10; step += 1) {
        candidate = mixHex(color, target, step / 10);
        if (contrastRatio(candidate, background) >= 4.5) return candidate;
    }
    return candidate;
}

function prefersDarkScheme() {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function resolvedTheme(mode = settings.theme || 'system') {
    if (mode === 'light' || mode === 'dark') return mode;
    return prefersDarkScheme() ? 'dark' : 'light';
}

// Colour palettes shipped with themes.css. "custom" is the user's own accent.
const THEME_PALETTES = [
    'obsidian', 'slate', 'navy', 'blue', 'cyan', 'indigo', 'purple',
    'pink', 'red', 'orange', 'yellow', 'emerald', 'grass', 'lime', 'custom'
];
const DEFAULT_PALETTE = 'obsidian';

function currentPalette() {
    const stored = settings.theme_palette;
    if (THEME_PALETTES.includes(stored)) return stored;
    // Settings written before palettes existed only knew "custom".
    return settings.theme === 'custom' ? 'custom' : DEFAULT_PALETTE;
}

function accentColor() {
    if (currentPalette() === 'custom' && isValidHexColor(settings.custom_color)) {
        return settings.custom_color.toUpperCase();
    }
    return resolvedTheme() === 'light' ? '#B8860B' : DEFAULT_ACCENT;
}

function hexToRgba(hex, alpha) {
    const { r, g, b } = hexToRgb(hex);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const CUSTOM_THEME_PROPS = [
    '--accent', '--accent-hover', '--accent-text', '--accent-soft', '--accent-ring',
    '--accent-fg', '--canvas', '--surface', '--surface-subtle', '--surface-hover'
];

/**
 * Applies the interface appearance.
 *
 * `mode` is the light/dark preference (system, light, dark) or "custom", which
 * selects the custom palette without discarding the light/dark preference.
 */
function applyTheme(mode) {
    if (mode === 'custom') {
        settings.theme_palette = 'custom';
    } else if (mode === 'system' || mode === 'light' || mode === 'dark') {
        settings.theme = mode;
    }

    const resolved = resolvedTheme(settings.theme || 'system');
    const palette = currentPalette();
    const root = document.documentElement;
    const body = document.body;

    root.dataset.theme = palette;
    root.classList.toggle('dark', resolved === 'dark');
    root.classList.toggle('pp-high-contrast', settings.high_contrast === 'true');
    body.classList.toggle('light-theme', resolved === 'light');
    body.classList.toggle('custom-theme', palette === 'custom');
    body.classList.toggle('high-contrast', settings.high_contrast === 'true');
    body.classList.toggle('reduce-motion', settings.reduce_motion === 'true');

    try {
        localStorage.setItem('tactile.theme-palette', palette);
        localStorage.setItem('tactile.theme-dark', resolved === 'dark' ? 'true' : 'false');
    } catch (err) {
        console.warn('Failed to cache the theme for the next launch:', err);
    }

    if (palette === 'custom') {
        const accent = accentColor();
        const light = resolved === 'light';
        const baseTarget = light ? '#FFFFFF' : '#08080B';
        const canvas = mixHex(accent, baseTarget, light ? 0.95 : 0.92);
        const surface = mixHex(accent, baseTarget, light ? 0.975 : 0.945);

        root.style.setProperty('--accent', accent);
        root.style.setProperty('--accent-hover', mixHex(accent, '#FFFFFF', light ? 0.18 : 0.26));
        // Text and icons get a version that passes 4.5:1 on the generated
        // surface; the fill colour stays exactly what the user picked.
        root.style.setProperty('--accent-text', accessibleAccent(accent, canvas));
        root.style.setProperty('--accent-soft', hexToRgba(accent, light ? 0.12 : 0.16));
        root.style.setProperty('--accent-ring', hexToRgba(accent, 0.34));
        root.style.setProperty('--accent-fg', relativeLuminance(accent) > 0.55 ? '#09090B' : '#FFFFFF');
        root.style.setProperty('--canvas', canvas);
        root.style.setProperty('--surface', surface);
        root.style.setProperty('--surface-subtle', mixHex(accent, baseTarget, light ? 0.94 : 0.9));
        root.style.setProperty('--surface-hover', mixHex(accent, baseTarget, light ? 0.9 : 0.86));
    } else {
        CUSTOM_THEME_PROPS.forEach((property) => root.style.removeProperty(property));
    }

    updateThemeControls();

    window.api.setZoom(String(settings.zoom || '100')).catch((err) => {
        console.warn('Failed to apply interface zoom:', err);
    });
}

/** Reflects the active palette and light/dark preference in the settings UI. */
function updateThemeControls() {
    const palette = currentPalette();
    document.querySelectorAll('[data-palette]').forEach((button) => {
        const selected = button.dataset.palette === palette;
        button.classList.toggle('is-selected', selected);
        button.setAttribute('aria-pressed', selected ? 'true' : 'false');
    });

    const mode = settings.theme === 'light' || settings.theme === 'dark' ? settings.theme : 'system';
    document.querySelectorAll('[data-theme-mode]').forEach((button) => {
        const selected = button.dataset.themeMode === mode;
        button.classList.toggle('is-active', selected);
        button.setAttribute('aria-pressed', selected ? 'true' : 'false');
    });

    const customRow = document.getElementById('custom-color-row');
    if (customRow) customRow.hidden = palette !== 'custom';
}

/**
 * Re-tints the bundled SVG for "match theme" and custom colour, so the window,
 * taskbar and desktop shortcut all use the same mark as the interface.
 */
async function iconDataUri(mode) {
    const base = resolvedTheme(mode === 'light' || mode === 'dark' ? mode : settings.theme) === 'light'
        ? 'dark'
        : 'light';
    const uri = await window.api.getSvgDataUri(base);
    if (!uri) return null;
    if (mode !== 'theme' && mode !== 'custom') return uri;

    try {
        const svg = decodeURIComponent(escape(atob(uri.split(',')[1])));
        const accent = mode === 'custom' && isValidHexColor(settings.custom_color)
            ? settings.custom_color.toUpperCase()
            : accentColor();
        const tinted = svg.replace(/(fill|stroke)="(?!none|transparent|url\()[^"]*"/gi, `$1="${accent}"`);
        return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(tinted)))}`;
    } catch (err) {
        console.warn('Failed to tint the application icon:', err);
        return uri;
    }
}

// ─── Toasts ──────────────────────────────────────────────────────────────────

let toastTimer = null;

function showToast(message, kind = 'info') {
    const host = document.getElementById('toast-host');
    if (!host) return;
    host.innerHTML = '';
    const toast = document.createElement('div');
    toast.className = `toast toast-${kind}`;
    toast.textContent = message;
    host.appendChild(toast);
    void toast.offsetHeight;
    toast.classList.add('visible');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
        toastTimer = null;
        toast.classList.remove('visible');
        setTimeout(() => toast.remove(), 200);
    }, 2600);
}

function getUniqueHowls() {
    return [...new Set(Object.values(audio_instances).filter(Boolean))];
}

function unloadAllAudio() {
    getUniqueHowls().forEach((howl) => {
        try {
            howl.unload();
        } catch (err) {
            console.warn('Failed to unload audio instance:', err);
        }
    });
    audio_instances = {};
    single_has_sprites = false;
    single_sprite_ids = new Set();
}

function applyVolumeToAllAudio(volume) {
    getUniqueHowls().forEach((howl) => {
        try {
            howl.volume(volume);
        } catch (err) {
            // A Howl can be unloaded while the volume slider is dragged.
        }
    });
}

// Custom Dialog Promise wrappers

/**
 * Shared setup for the three custom dialogs.
 *
 * Each dialog re-used the same six DOM lookups and the same
 * add/remove-listener dance. One helper keeps them consistent: a caller only
 * decides what the buttons say and what each button resolves to.
 */
function prepareDialog({ title, message, showInput = false, showCancel = true, confirmLabel, cancelLabel }) {
    const overlay = document.getElementById('custom-dialog-overlay');
    document.getElementById('dialog-title-text').innerText = title;
    document.getElementById('dialog-body-message').innerText = message;
    document.getElementById('dialog-input-group').style.display = showInput ? 'block' : 'none';

    const cancelBtn = document.getElementById('dialog-cancel-btn');
    const confirmBtn = document.getElementById('dialog-confirm-btn');

    cancelBtn.style.display = showCancel ? 'inline-block' : 'none';
    cancelBtn.innerText = cancelLabel || t('dialog.cancel');
    confirmBtn.innerText = confirmLabel;

    return { overlay, cancelBtn, confirmBtn };
}

/**
 * Wire a dialog's buttons, close it on either choice and resolve once.
 * `onConfirm`/`onCancel` return the value to resolve with.
 */
function runDialog({ overlay, cancelBtn, confirmBtn }, onConfirm, onCancel) {
    const cleanup = () => {
        overlay.classList.remove('active');
        confirmBtn.removeEventListener('click', handleConfirm);
        cancelBtn.removeEventListener('click', handleCancel);
    };
    const handleConfirm = () => { cleanup(); onConfirm(); };
    const handleCancel = () => { cleanup(); onCancel(); };

    confirmBtn.addEventListener('click', handleConfirm);
    if (cancelBtn.style.display !== 'none') cancelBtn.addEventListener('click', handleCancel);
    overlay.classList.add('active');
}

function showCustomAlert(message, title = t('dialog.notification')) {
    return new Promise((resolve) => {
        const parts = prepareDialog({
            title,
            message,
            showCancel: false,
            confirmLabel: t('dialog.ok')
        });
        runDialog(parts, () => resolve(), () => resolve());
    });
}

function showCustomConfirm(message, title = t('dialog.confirm_action')) {
    return new Promise((resolve) => {
        const parts = prepareDialog({
            title,
            message,
            confirmLabel: t('dialog.confirm')
        });
        runDialog(parts, () => resolve(true), () => resolve(false));
    });
}

function showCustomPrompt(message, defaultValue = "", title = t('dialog.input_required')) {
    return new Promise((resolve) => {
        const inputField = document.getElementById('dialog-prompt-input');
        inputField.value = defaultValue;

        const parts = prepareDialog({
            title,
            message,
            showInput: true,
            confirmLabel: t('dialog.save')
        });
        runDialog(parts, () => resolve(inputField.value), () => resolve(null));
        inputField.focus();
    });
}

/**
 * Format-recovery prompt shown when the cloud folder holds a usable backup but
 * the local database is empty: restore it, or deliberately start fresh.
 */
function showRestorePrompt() {
    return new Promise((resolve) => {
        const parts = prepareDialog({
            title: t('cloud.restore_found_title'),
            message: t('cloud.restore_found_desc'),
            confirmLabel: t('cloud.restore_btn'),
            cancelLabel: t('cloud.fresh_btn')
        });
        runDialog(parts, () => resolve(true), () => resolve(false));
    });
}

// Helper to load and render dynamic materials filters
const ALL_MATERIALS = '__all__';

// The three seeded categories are stored with fixed English names so that
// profile.type keeps matching them in the database; only their label is
// translated. A user-created category is shown exactly as named.
const BUILTIN_CATEGORY_KEYS = {
    Linear: 'switch.linear',
    Tactile: 'switch.tactile',
    Clicky: 'switch.clicky'
};

function categoryLabel(name) {
    const key = BUILTIN_CATEGORY_KEYS[name];
    return key ? t(key) : name;
}

function refreshSidebarStats() {
    // Counters live on the About KPI strip now; kept as a hook for callers that
    // still refresh after a profile or category change.
}

function getActiveMaterialFilter() {
    const activeChip = document.querySelector('.filters .chip.active');
    const value = activeChip ? activeChip.getAttribute('data-material') : null;
    return value || ALL_MATERIALS;
}

function setActiveMaterialFilter(value) {
    document.querySelectorAll('.filters .chip').forEach((chip) => {
        chip.classList.toggle('active', chip.getAttribute('data-material') === value);
    });
}

function loadAndRenderMaterials(skipSelectSync = false) {
    const filtersContainer = document.querySelector('.filters');
    if (!filtersContainer) return;

    // Read the active filter by its stable data value, not by its translated label.
    const activeFilter = getActiveMaterialFilter();

    // Reset materials array to standard defaults, then append active ones
    materials = ['PBT', 'ABS', 'Mixed'];
    const uniqueFromProfiles = [...new Set(profiles.map(p => p.material).filter(Boolean))];
    uniqueFromProfiles.forEach(m => {
        if (!materials.includes(m)) {
            materials.push(m);
        }
    });

    filtersContainer.innerHTML = '';
    const allChip = document.createElement('button');
    allChip.className = 'chip';
    allChip.setAttribute('data-material', ALL_MATERIALS);
    allChip.innerText = t('filter.all');
    filtersContainer.appendChild(allChip);

    materials.forEach(mat => {
        const btn = document.createElement('button');
        btn.className = 'chip';
        btn.setAttribute('data-material', mat);
        btn.innerText = mat;
        filtersContainer.appendChild(btn);
    });

    // Restore the previous selection, falling back to "All".
    const stillExists = [...filtersContainer.querySelectorAll('.chip')]
        .some((chip) => chip.getAttribute('data-material') === activeFilter);
    setActiveMaterialFilter(stillExists ? activeFilter : ALL_MATERIALS);

    // One delegated listener on the container; chips are re-created on every
    // call, so per-chip listeners here used to pile up.
    if (!filtersContainer.dataset.bound) {
        filtersContainer.addEventListener('click', (event) => {
            const chip = event.target.closest('.chip');
            if (!chip) return;
            setActiveMaterialFilter(chip.getAttribute('data-material') || ALL_MATERIALS);
            renderProfiles(current_view);
        });
        filtersContainer.dataset.bound = 'true';
    }

    if (skipSelectSync) return;

    // Sync the selects options dynamically (options only, no event listeners)
    const rebuildSelectOptions = (selectId) => {
        const select = document.getElementById(selectId);
        if (!select) return;
        
        const currentVal = select.value;
        
        // Clear existing options and rebuild with current materials list
        select.innerHTML = '';
        
        materials.forEach(mat => {
            const opt = document.createElement('option');
            opt.value = mat;
            opt.innerText = mat;
            select.appendChild(opt);
        });
        
        const addOpt = document.createElement('option');
        addOpt.value = '__NEW__';
        addOpt.innerText = t('modal.add_new_material');
        select.appendChild(addOpt);
        
        if (currentVal && (materials.includes(currentVal) || currentVal === '__NEW__')) {
            select.value = currentVal;
        }
    };
    
    rebuildSelectOptions('select-new-profile-material');
    rebuildSelectOptions('select-edit-profile-material');
}

// Helper to populate and load sidebar categories
async function loadAndRenderCategories() {
    const categoriesListContainer = document.getElementById('dynamic-categories-list');
    const selectNewProfileType = document.getElementById('select-new-profile-type');
    const selectEditProfileType = document.getElementById('select-edit-profile-type');

    try {
        categories = await window.api.getCategories();
    } catch (err) {
        console.error('Failed to load categories:', err);
        categories = [];
    }
    
    // Render in sidebar
    categoriesListContainer.innerHTML = '';
    categories.forEach(cat => {
        const btn = document.createElement('button');
        btn.className = `nav-item ${current_view === cat.id ? 'active' : ''}`;
        btn.setAttribute('data-view', cat.id);
        btn.innerText = categoryLabel(cat.name);
        
        // Add right-click context menu listener
        btn.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            const ctxMenu = document.getElementById('custom-context-menu');
            if (!ctxMenu) return;
            ctxMenu.style.display = 'flex';
            ctxMenu.style.left = `${Math.min(e.clientX, Math.max(0, window.innerWidth - 170))}px`;
            ctxMenu.style.top = `${Math.min(e.clientY, Math.max(0, window.innerHeight - 90))}px`;
            
            // Bind context actions
            document.getElementById('context-rename-cat').onclick = async () => {
                ctxMenu.style.display = 'none';
                const newName = await showCustomPrompt(t('msg.rename_category'), cat.name, t('msg.rename_category_title'));
                if (newName && newName !== cat.name) {
                    try {
                        await window.api.renameCategory(cat.id, newName);
                        await loadAndRenderCategories();
                        profiles = await window.api.getProfiles();
                        renderProfiles(current_view);
                    } catch (err) {
                        console.error('Failed to rename category:', err);
                        await showCustomAlert(t('msg.operation_failed'));
                    }
                }
            };
            
            document.getElementById('context-delete-cat').onclick = async () => {
                ctxMenu.style.display = 'none';
                const confirmed = await showCustomConfirm(tf('msg.confirm_delete_category', cat.name), t('msg.delete_category_title'));
                if (!confirmed) return;

                try {
                    await window.api.deleteCategory(cat.id);
                    await loadAndRenderCategories();
                    profiles = await window.api.getProfiles();
                    if (!categories.some((item) => item.id === current_view)) {
                        current_view = categories.length > 0 ? categories[0].id : 'settings';
                    }
                    switchView(current_view);
                } catch (err) {
                    console.error('Failed to delete category:', err);
                    await showCustomAlert(t('msg.operation_failed'));
                }
            };
        });

        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            switchView(cat.id);
        });
        categoriesListContainer.appendChild(btn);
    });

    // Close context menu on general click. Registered once: this function
    // runs on every category change and used to leak a new listener each time.
    if (!global_listeners_bound) {
        document.addEventListener('click', () => {
            const ctxMenu = document.getElementById('custom-context-menu');
            if (ctxMenu) ctxMenu.style.display = 'none';
        });
        global_listeners_bound = true;
    }

    // Populate selects
    refreshSidebarStats();
    if (!selectNewProfileType || !selectEditProfileType) return;

    selectNewProfileType.innerHTML = '';
    selectEditProfileType.innerHTML = '';
    categories.forEach(cat => {
        const opt1 = document.createElement('option');
        opt1.value = cat.name; // Keep DB compatibility
        opt1.innerText = categoryLabel(cat.name);
        selectNewProfileType.appendChild(opt1);

        const opt2 = document.createElement('option');
        opt2.value = cat.name;
        opt2.innerText = categoryLabel(cat.name);
        selectEditProfileType.appendChild(opt2);
    });
}

document.addEventListener('DOMContentLoaded', async () => {
    // Window Controls
    // `minimize`/`maximize`/`close` are fire-and-forget (`ipcRenderer.send`),
    // so they return undefined and must not be chained with `.catch()`.
    document.getElementById('btn-min').addEventListener('click', () => window.api.minimize());
    document.getElementById('btn-max').addEventListener('click', () => window.api.maximize());
    document.getElementById('btn-close').addEventListener('click', () => window.api.close());

    // Sidebar: collapsible on desktop, slide-over drawer on narrow windows.
    const collapseBtn = document.getElementById('btn-sidebar-collapse');
    const navToggle = document.getElementById('btn-nav-toggle');
    const sidebar = document.getElementById('app-sidebar');
    const SIDEBAR_KEY = 'tactile.sidebar-collapsed';

    const setSidebarCollapsed = (collapsed) => {
        document.documentElement.classList.toggle('sidebar-collapsed', collapsed);
        if (collapseBtn) collapseBtn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
        try {
            localStorage.setItem(SIDEBAR_KEY, collapsed ? '1' : '0');
        } catch (err) {
            console.warn('Failed to remember sidebar state:', err);
        }
    };

    try {
        if (localStorage.getItem(SIDEBAR_KEY) === '1') setSidebarCollapsed(true);
    } catch (err) {
        console.warn('Failed to read sidebar state:', err);
    }

    if (collapseBtn) {
        collapseBtn.addEventListener('click', () => {
            setSidebarCollapsed(!document.documentElement.classList.contains('sidebar-collapsed'));
        });
    }

    if (navToggle) {
        navToggle.addEventListener('click', () => {
            const open = document.documentElement.classList.toggle('sidebar-mobile-open');
            navToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        });
    }

    if (sidebar) {
        sidebar.addEventListener('click', (event) => {
            if (event.target.closest('.nav-item') && window.matchMedia('(max-width: 899px)').matches) {
                document.documentElement.classList.remove('sidebar-mobile-open');
                if (navToggle) navToggle.setAttribute('aria-expanded', 'false');
            }
        });
    }

    // Keep the maximize/restore glyph in sync with the real window state.
    const maxButton = document.getElementById('btn-max');
    if (window.api.onWindowState) {
        window.api.onWindowState((maximized) => {
            if (maxButton) maxButton.setAttribute('data-maximized', maximized ? 'true' : 'false');
        });
    }

    // Delegated card actions (preview / activate / edit / add sound). The cards
    // are re-created on every render, so a single delegated listener on each
    // grid replaces per-card inline onclick handlers.
    ['profiles-grid', 'custom-grid'].forEach((gridId) => {
        const grid = document.getElementById(gridId);
        if (grid) grid.addEventListener('click', handleProfileGridClick);
    });

    // Audio Playback Listeners (Must be registered early to receive initial soundpack load events)
    window.api.onLoadPackSounds((soundData) => {
        unloadAllAudio();
        if (!soundData) return;

        const volume = getVolume();

        if (soundData.type === 'single') {
            if (!Array.isArray(soundData.src) || soundData.src.length === 0) {
                console.warn('Single pack has no playable source; skipping load.');
                return;
            }

            const sprite = soundData.sprite && typeof soundData.sprite === 'object' ? soundData.sprite : {};
            single_has_sprites = Object.keys(sprite).length > 0;
            single_sprite_ids = new Set(Object.keys(sprite));

            const howlOptions = {
                src: soundData.src,
                format: Array.isArray(soundData.format) ? soundData.format : undefined,
                volume,
                html5: false, // Web Audio API: zero latency and overlapping playback
                preload: true,
                onloaderror: (id, err) => {
                    console.error('Howler load error (single pack):', err);
                },
                onplayerror: (id, err) => {
                    console.error('Howler play error (single pack):', err);
                }
            };

            if (single_has_sprites) howlOptions.sprite = sprite;
            audio_instances.single = new Howl(howlOptions);
            return;
        }

        const data = soundData.data && typeof soundData.data === 'object' ? soundData.data : {};
        const sources = soundData.sources && typeof soundData.sources === 'object' ? soundData.sources : null;

        // Several keycodes usually share the same file. Create one Howl per
        // file instead of one per keycode: this used to build ~100 decoders
        // (and duplicate the base64 payload) for every pack switch.
        const fileHowls = new Map();

        for (const [soundId, entry] of Object.entries(data)) {
            const source = sources ? sources[entry] : entry;
            if (!source || !source.src) continue;

            const cacheKey = Array.isArray(source.src) ? source.src.join('|') : String(source.src);
            let howl = fileHowls.get(cacheKey);

            if (!howl) {
                howl = new Howl({
                    src: source.src,
                    format: source.format,
                    volume,
                    html5: false,
                    preload: true,
                    onloaderror: (id, err) => {
                        console.error('Howler load error (multi pack):', soundId, err);
                    }
                });
                fileHowls.set(cacheKey, howl);
            }

            audio_instances[soundId] = howl;
        }
    });

    window.api.onPlaySound((data) => {
        try {
            if (!data || !data.sound_id) return;
            const volume = getVolume();

            if (data.type === 'single') {
                const howl = audio_instances.single;
                if (!howl || howl.state() !== 'loaded') return;

                howl.volume(volume);

                if (single_has_sprites) {
                    if (single_sprite_ids.has(data.sound_id)) howl.play(data.sound_id);
                    return;
                }

                // Spriteless custom pack: play the whole file on keydown only.
                if (!String(data.sound_id).endsWith('-up')) howl.play();
                return;
            }

            const howl = audio_instances[data.sound_id];
            if (!howl) return;
            howl.volume(volume);
            howl.play();
        } catch (err) {
            console.error('Failed to play key sound:', err);
        }
    });

    // Load initial data
    try {
        settings = await window.api.getSettings();
        profiles = await window.api.getProfiles();
    } catch (err) {
        console.error('Failed to load initial application data:', err);
        settings = {};
        profiles = [];
        await showCustomAlert(t('msg.unexpected_error'));
    }

    settings = {
        volume: '50',
        tray_icon: 'true',
        start_minimized: 'false',
        theme: 'system',
        app_icon: 'theme',
        muted: 'false',
        language: '',
        tray_click_single: 'open',
        tray_click_double: 'none',
        shortcut_toggle_mute: 'Control+K',
        shortcut_quick_task: 'Control+Alt+N',
        selected_profile: 'default',
        close_behavior: 'tray',
        zoom: '100',
        high_contrast: 'false',
        reduce_motion: 'false',
        notifications: 'true',
        sound_feedback: 'true',
        custom_color: '#D4AF37',
        cloud_provider: 'none',
        cloud_folder: '',
        cloud_auto: 'true',
        cloud_last_sync: '',
        onboarding_done: 'false',
        ...settings
    };

    // Apply the saved language before applying dynamic translations. A stored
    // supported code wins; anything else (empty seed, legacy value) follows the
    // OS locale so a first launch is never stuck in a language the user cannot read.
    const savedLang = resolveLanguage(settings.language);
    settings.language = savedLang;
    setLang(savedLang);
    applyDocumentLanguage();
    applyTranslations();

    // The main process already loaded the selected profile's sounds before
    // the window finished loading. Calling setActiveProfile here would send
    // the whole payload a second time.
    active_profile_id = settings.selected_profile;
    if ((!active_profile_id || active_profile_id === 'default') && profiles.length > 0) {
        active_profile_id = profiles[0].id;
    }

    try {
        app_version = await window.api.getAppVersion();
    } catch (err) {
        console.warn('Failed to read app version:', err);
    }
    // The version label is built with tf(), not a data-i18n hook, so it has to be
    // repainted explicitly whenever the language changes.
    updateVersionLabel();

    // Apply Settings
    document.getElementById('global-volume').value = settings.volume;
    document.getElementById('setting-tray').checked = settings.tray_icon === 'true';
    document.getElementById('setting-startup').checked = settings.start_minimized === 'true'; // Map to start minimized / startup behavior
    
    // Mute UI Control & Synchronization
    const btnMute = document.getElementById('btn-toggle-mute');
    function updateMuteUI(isMuted) {
        if (isMuted) {
            stopActivePreview();
            btnMute.innerHTML = `
                <svg class="volume-svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
                    <line x1="23" y1="9" x2="17" y2="15"></line>
                    <line x1="17" y1="9" x2="23" y2="15"></line>
                </svg>
            `;
            btnMute.title = t('tray.unmute');
            btnMute.setAttribute('aria-label', t('tray.unmute'));
        } else {
            btnMute.innerHTML = `
                <svg class="volume-svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
                    <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path>
                </svg>
            `;
            btnMute.title = t('tray.mute');
            btnMute.setAttribute('aria-label', t('tray.mute'));
        }
        btnMute.setAttribute('aria-pressed', String(Boolean(isMuted)));
        const settingMute = document.getElementById('setting-mute');
        if (settingMute) {
            settingMute.checked = isMuted;
        }
    }

    const initialMuted = settings.muted === 'true';
    updateMuteUI(initialMuted);
    
    const langSelect = document.getElementById('setting-lang');
    if (langSelect) {
        // Endonyms come from src/locales/languages.js so the picker never needs
        // 73 hand-written <option> nodes and can never drift from the locale files.
        langSelect.innerHTML = '';
        for (const lang of getAvailableLanguages()) {
            const option = document.createElement('option');
            option.value = lang.code;
            option.textContent = lang.name;
            langSelect.appendChild(option);
        }
        langSelect.value = savedLang;
        langSelect.addEventListener('change', async (e) => {
            const nextLang = e.target.value;
            if (!isSupportedLang(nextLang)) return;
            setLang(nextLang);
            applyDocumentLanguage();
            await persistSetting('language', nextLang);
            applyTranslations();
            updateVersionLabel();
            
            // Re-render categories and profiles to update all textual filters and navigation
            await loadAndRenderCategories();
            loadAndRenderMaterials();
            renderProfiles(current_view);
            updateActiveProfileBadge();
            updateMuteUI(settings.muted === 'true');
            updateShortcutButtonLabel();
        });
    }

    // Theme Initial State & Synchronization
    applyTheme(settings.theme || 'system');

    const customColorRow = document.getElementById('custom-color-row');
    const customColorInput = document.getElementById('setting-custom-color');

    const syncCustomColorRow = () => {
        if (customColorRow) customColorRow.hidden = currentPalette() !== 'custom';
        if (customColorInput) customColorInput.value = settings.custom_color || DEFAULT_ACCENT;
    };
    syncCustomColorRow();
    updateThemeControls();

    document.querySelectorAll('[data-palette]').forEach((button) => {
        button.addEventListener('click', async () => {
            const palette = button.dataset.palette;
            settings.theme_palette = palette;
            applyTheme(settings.theme || 'system');
            await persistSetting('theme_palette', palette);
            await applyAppIcon(settings.app_icon || 'theme');
        });
    });

    document.querySelectorAll('[data-theme-mode]').forEach((button) => {
        button.addEventListener('click', async () => {
            applyTheme(button.dataset.themeMode);
            await persistSetting('theme', settings.theme || 'system');
            await applyAppIcon(settings.app_icon || 'theme');
        });
    });

    document.getElementById('btn-apply-color').addEventListener('click', async () => {
        const value = normalizeHex(customColorInput ? customColorInput.value : '');
        if (!value) {
            await showCustomAlert(t('settings.invalid_color'));
            return;
        }
        settings.custom_color = value;
        settings.theme_palette = 'custom';
        if (customColorInput) customColorInput.value = value;
        syncCustomColorRow();
        applyTheme('custom');
        await persistSetting('custom_color', value);
        await persistSetting('theme_palette', 'custom');
        await applyAppIcon(settings.app_icon || 'theme');
        showToast(t('toast.saved'));
    });

    const applyAppIcon = async (iconMode) => {
        try {
            const dataUri = await iconDataUri(iconMode);
            if (!dataUri) return;
            const pngDataUrl = await rasterizeSvgToPng(dataUri);
            // Pass the selected mode (not just the light/dark base): main needs
            // "custom" to know it should write the tinted shortcut icon.
            await window.api.setDynamicAppIcon(pngDataUrl, iconMode || 'theme');
        } catch (err) {
            console.error('Failed to apply app icon:', err);
        }
    };

    const appIconSelect = document.getElementById('setting-app-icon');
    if (appIconSelect) {
        appIconSelect.value = settings.app_icon || 'theme';
        appIconSelect.addEventListener('change', async (e) => {
            const nextIcon = e.target.value;
            settings.app_icon = nextIcon;
            await persistSetting('app_icon', nextIcon);
            await applyAppIcon(nextIcon);
        });
    }

    // Apply app icon on startup
    applyAppIcon(settings.app_icon || 'theme');
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        if ((settings.theme || 'system') === 'system') {
            applyTheme('system');
            applyAppIcon(settings.app_icon || 'theme');
        }
    });

    // Settings event listeners
    document.getElementById('global-volume').addEventListener('input', (e) => {
        window.api.updateSetting('volume', e.target.value)
            .catch((err) => console.error('Failed to persist volume:', err));
        const hVol = parseInt(e.target.value, 10) / 100;
        applyVolumeToAllAudio(hVol);
        setPreviewVolume(hVol);
    });

    document.getElementById('setting-tray').addEventListener('change', (e) => {
        window.api.updateSetting('tray_icon', e.target.checked ? 'true' : 'false')
            .catch((err) => console.error('Failed to persist tray icon setting:', err));
    });

    document.getElementById('setting-startup').addEventListener('change', (e) => {
        window.api.updateSetting('start_minimized', e.target.checked ? 'true' : 'false')
            .catch((err) => console.error('Failed to persist startup setting:', err));
    });

    document.getElementById('setting-mute').addEventListener('change', async (e) => {
        const nextMute = e.target.checked;
        settings.muted = nextMute ? 'true' : 'false';
        await persistSetting('muted', settings.muted);
        updateMuteUI(nextMute);
    });

    btnMute.addEventListener('click', async () => {
        const nextMute = settings.muted !== 'true';
        settings.muted = nextMute ? 'true' : 'false';
        await persistSetting('muted', settings.muted);
        updateMuteUI(nextMute);
    });

    // Listen for tray mute changes
    window.api.onMuteStatusChanged((muted) => {
        settings.muted = muted ? 'true' : 'false';
        updateMuteUI(muted);
    });

    window.api.onVolumeChanged((vol) => {
        settings.volume = vol.toString();
        document.getElementById('global-volume').value = vol;
        const hVol = vol / 100;
        applyVolumeToAllAudio(hVol);
        setPreviewVolume(hVol);
    });

    // Apply initial values for new settings
    const traySingleSelect = document.getElementById('setting-tray-single');
    const trayDoubleSelect = document.getElementById('setting-tray-double');
    const btnRecordShortcut = document.getElementById('btn-record-shortcut');
    const btnClearShortcut = document.getElementById('btn-clear-shortcut');

    if (traySingleSelect) traySingleSelect.value = settings.tray_click_single || 'open';
    if (trayDoubleSelect) trayDoubleSelect.value = settings.tray_click_double || 'none';
    
    const formatShortcutForUser = (shortcut) => {
        if (!shortcut) return '';
        // `CommandOrControl` must be replaced before `Control`: doing it the
        // other way round left the label showing "CommandOrCTRL".
        return shortcut
            .replace(/CommandOrControl/g, 'CTRL')
            .replace(/Control/g, 'CTRL')
            .replace(/Shift/g, 'SHIFT')
            .replace(/Alt/g, 'ALT')
            .replace(/Meta/g, 'META')
            .split('+')
            .join(' + ');
    };
    
    const updateShortcutButtonLabel = () => {
        const currentShortcut = settings.shortcut_toggle_mute || '';
        if (currentShortcut) {
            btnRecordShortcut.innerText = formatShortcutForUser(currentShortcut);
        } else {
            btnRecordShortcut.innerText = t('settings.shortcut_record_placeholder');
        }
    };
    updateShortcutButtonLabel();

    // Dropdowns change events
    if (traySingleSelect) {
        traySingleSelect.addEventListener('change', async (e) => {
            settings.tray_click_single = e.target.value;
            await persistSetting('tray_click_single', settings.tray_click_single);
        });
    }
    if (trayDoubleSelect) {
        trayDoubleSelect.addEventListener('change', async (e) => {
            settings.tray_click_double = e.target.value;
            await persistSetting('tray_click_double', settings.tray_click_double);
        });
    }

    // Shortcut recording logic
    let isRecordingShortcut = false;
    
    const handleShortcutKeyDown = async (event) => {
        event.preventDefault();
        event.stopPropagation();

        const key = event.key;

        // Escape cancels recording
        if (key === 'Escape') {
            stopRecording();
            return;
        }

        // If user presses only modifiers, wait for a normal key
        if (['Control', 'Shift', 'Alt', 'Meta'].includes(key)) {
            return;
        }

        // Build the shortcut string in Electron format
        const parts = [];
        if (event.ctrlKey) parts.push('Control');
        if (event.altKey) parts.push('Alt');
        if (event.shiftKey) parts.push('Shift');
        if (event.metaKey) parts.push('Meta');

        // A modifier-less hotkey would hijack a normal key across the whole OS
        // (the user could no longer type it anywhere). Reject it here so the
        // user gets immediate feedback instead of a silent failure in main.
        if (parts.length === 0) {
            await showCustomAlert(t('settings.shortcut_requires_modifier'));
            return;
        }

        // Map javascript key names to Electron globalShortcut key strings
        let electronKey = key.toUpperCase();
        if (key === ' ') electronKey = 'Space';
        if (key.startsWith('Arrow')) electronKey = key.substring(5); // ArrowUp -> Up, ArrowDown -> Down
        
        parts.push(electronKey);
        
        const shortcutString = parts.join('+');
        
        stopRecording();

        // Persist through the settings channel: the main process re-registers
        // every hotkey and answers false when the combination is already owned
        // by another application.
        const previous = settings.shortcut_toggle_mute || '';
        settings.shortcut_toggle_mute = shortcutString;
        const saved = await persistSetting('shortcut_toggle_mute', shortcutString);
        if (saved) {
            updateShortcutButtonLabel();
        } else {
            settings.shortcut_toggle_mute = previous;
            updateShortcutButtonLabel();
            await showCustomAlert(t('settings.shortcut_error'));
        }
    };

    function startRecording() {
        isRecordingShortcut = true;
        btnRecordShortcut.innerText = t('settings.shortcut_recording');
        btnRecordShortcut.classList.add('recording');
        window.addEventListener('keydown', handleShortcutKeyDown, true);
        // Leaving the window (alt-tab) while recording used to keep the capture
        // listener alive: every key in the app was swallowed until the user
        // came back and pressed Escape.
        window.addEventListener('blur', cancelRecording);
    }

    function stopRecording() {
        isRecordingShortcut = false;
        btnRecordShortcut.classList.remove('recording');
        window.removeEventListener('keydown', handleShortcutKeyDown, true);
        window.removeEventListener('blur', cancelRecording);
    }

    function cancelRecording() {
        if (!isRecordingShortcut) return;
        stopRecording();
        updateShortcutButtonLabel();
    }

    btnRecordShortcut.addEventListener('click', () => {
        if (isRecordingShortcut) {
            stopRecording();
            updateShortcutButtonLabel();
        } else {
            startRecording();
        }
    });

    btnClearShortcut.addEventListener('click', async () => {
        stopRecording();
        settings.shortcut_toggle_mute = '';
        await persistSetting('shortcut_toggle_mute', '');
        updateShortcutButtonLabel();
    });

    // Escape closes the dialog the user is looking at. Without this, every
    // modal (create/edit profile, categories, legal, message boxes) could only
    // be dismissed by aiming at a small ✕, and the shortcut recorder owns
    // Escape while it is active, so that case is skipped.
    const MODAL_CLOSE_BUTTONS = {
        'create-profile-modal': 'modal-create-close-x',
        'add-sound-modal': 'modal-add-close-x',
        'edit-profile-modal': 'modal-edit-close-x',
        'create-category-modal': 'modal-category-close-x',
        'legal-modal': 'modal-close-x',
        'manage-categories-modal': 'modal-manage-close-x'
    };

    document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape' || isRecordingShortcut) return;

        const openOverlays = [...document.querySelectorAll('.modal-overlay.active')];
        if (openOverlays.length === 0) {
            const ctxMenu = document.getElementById('custom-context-menu');
            if (ctxMenu) ctxMenu.style.display = 'none';
            return;
        }

        const overlay = openOverlays[openOverlays.length - 1];

        if (overlay.id === 'custom-dialog-overlay') {
            // A resolve must happen or the awaiting caller hangs forever.
            const cancelBtn = document.getElementById('dialog-cancel-btn');
            const confirmBtn = document.getElementById('dialog-confirm-btn');
            const target = cancelBtn && cancelBtn.style.display !== 'none' ? cancelBtn : confirmBtn;
            if (target) target.click();
            return;
        }

        const closeButtonId = MODAL_CLOSE_BUTTONS[overlay.id];
        const closeButton = closeButtonId ? document.getElementById(closeButtonId) : null;
        if (closeButton) closeButton.click();
    });

    // Navigation
    document.querySelectorAll('.rail-item').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.rail-item').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            // switchView() also resets the search box for every view change.
            switchView(btn.getAttribute('data-view'));
        });
    });

    // Search input listener
    const searchInput = document.getElementById('search-input');
    const btnClearSearch = document.getElementById('btn-clear-search');
    
    const updateSearchClearButton = () => {
        if (searchInput && btnClearSearch) {
            if (searchInput.value.trim() !== '') {
                btnClearSearch.style.display = 'flex';
            } else {
                btnClearSearch.style.display = 'none';
            }
        }
    };

    if (searchInput) {
        let searchRenderTimer = null;
        searchInput.addEventListener('input', () => {
            updateSearchClearButton();
            if (searchRenderTimer) clearTimeout(searchRenderTimer);
            searchRenderTimer = setTimeout(() => {
                searchRenderTimer = null;
                renderProfiles(current_view);
            }, 120);
        });
    }

    if (btnClearSearch && searchInput) {
        btnClearSearch.addEventListener('click', () => {
            searchInput.value = '';
            updateSearchClearButton();
            renderProfiles(current_view);
            searchInput.focus();
        });
    }

    // Material filter chips are wired once by loadAndRenderMaterials().

    // ─── Material Select: Show/Hide "New Material Name" input ───
    function bindMaterialSelectToggle(selectId, wrapId, inputId) {
        const sel = document.getElementById(selectId);
        if (!sel) return;

        // The hide animation is delayed by 300 ms. Without cancelling it, picking
        // "__NEW__" again within that window set display:block and the stale
        // timer then hid the field again, leaving an invisible input.
        let hideTimer = null;

        sel.addEventListener('change', () => {
            const wrap = document.getElementById(wrapId);
            const inp  = document.getElementById(inputId);

            if (hideTimer) {
                clearTimeout(hideTimer);
                hideTimer = null;
            }

            if (sel.value === '__NEW__') {
                if (wrap) {
                    wrap.style.display = 'block';
                    // Force reflow before animating
                    void wrap.offsetHeight;
                    wrap.style.maxHeight = '200px';
                    wrap.style.opacity = '1';
                    wrap.style.marginTop = '12px';
                }
                if (inp) setTimeout(() => inp.focus(), 60);
            } else {
                if (wrap) {
                    wrap.style.maxHeight = '0';
                    wrap.style.opacity = '0';
                    wrap.style.marginTop = '0';
                    hideTimer = setTimeout(() => {
                        hideTimer = null;
                        wrap.style.display = 'none';
                    }, 300);
                }
                if (inp) inp.value = '';
            }
        });
    }
    bindMaterialSelectToggle(
        'select-new-profile-material',
        'wrap-new-profile-material-new',
        'input-new-profile-material-new'
    );
    bindMaterialSelectToggle(
        'select-edit-profile-material',
        'wrap-edit-profile-material-new',
        'input-edit-profile-material-new'
    );

    // External Links
    document.getElementById('link-website').addEventListener('click', (e) => {
        e.preventDefault();
        window.api.openExternal('https://vellium.dev')
            .catch((err) => console.error('Failed to open website link:', err));
    });
    document.getElementById('link-website-meta').addEventListener('click', (e) => {
        e.preventDefault();
        window.api.openExternal('https://vellium.dev')
            .catch((err) => console.error('Failed to open website link:', err));
    });
    document.getElementById('btn-web-site').addEventListener('click', (e) => {
        e.preventDefault();
        window.api.openExternal('https://vellium.dev')
            .catch((err) => console.error('Failed to open website link:', err));
    });

    // Custom Pack Import
    const dropZone = document.getElementById('drop-zone');

    // Both the drop zone and the folder picker end with the same refresh. It
    // also rebuilds the material chips: an imported pack can introduce a
    // material that was not in the list yet.
    const handlePackImportResult = async (res) => {
        if (res && res.success) {
            const importedName = res.profile && res.profile.name ? res.profile.name : '';
            await showCustomAlert(`${t('msg.import_success')} ${importedName}`.trim());
            profiles = await window.api.getProfiles();
            loadAndRenderMaterials();
            renderProfiles(current_view);
            return;
        }

        const reason = res && res.error ? res.error : t('msg.operation_failed');
        await showCustomAlert(`${t('msg.import_failed')} ${reason}`);
    };
    
    // Drag & Drop Folder Import
    if (dropZone) {
        dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropZone.style.borderColor = 'var(--accent-gold)';
        });

        dropZone.addEventListener('dragleave', () => {
            dropZone.style.borderColor = 'var(--border-subtle)';
        });

        dropZone.addEventListener('drop', async (e) => {
            e.preventDefault();
            dropZone.style.borderColor = 'var(--border-subtle)';
            
            const files = e.dataTransfer.files;
            if (files.length > 0 && files[0].path) {
                try {
                    await handlePackImportResult(await window.api.importFolderPack(files[0].path));
                } catch (err) {
                    console.error('Folder drop import failed:', err);
                    await showCustomAlert(t('msg.import_failed'));
                }
            }
        });
    }

    // Select Folder via Dialog
    const btnSelectFolder = document.getElementById('btn-select-folder');
    if (btnSelectFolder) {
        btnSelectFolder.addEventListener('click', async () => {
            let folderPath = null;
            try {
                folderPath = await window.api.selectDirectory();
            } catch (err) {
                console.error('Failed to open the folder picker:', err);
                return;
            }
            if (!folderPath) return;

            try {
                await handlePackImportResult(await window.api.importFolderPack(folderPath));
            } catch (err) {
                console.error('Folder import failed:', err);
                await showCustomAlert(t('msg.import_failed'));
            }
        });
    }

    // Category Creation Modal
    const createCategoryModal = document.getElementById('create-category-modal');
    document.getElementById('btn-add-category').addEventListener('click', (e) => {
        e.stopPropagation();
        createCategoryModal.classList.add('active');
    });
    document.getElementById('modal-category-close-x').addEventListener('click', () => {
        createCategoryModal.classList.remove('active');
    });
    document.getElementById('modal-category-save-btn').addEventListener('click', async () => {
        const input = document.getElementById('input-new-category-name');
        const name = input.value.trim();
        if (!name) {
            await showCustomAlert(t('msg.enter_category_name'));
            return;
        }

        try {
            await window.api.createCategory(name);
            input.value = '';
            createCategoryModal.classList.remove('active');
            await loadAndRenderCategories();
        } catch (err) {
            console.error('Failed to create category:', err);
            await showCustomAlert(t('msg.operation_failed'));
        }
    });

    // Manage Categories Modal & Drag Reorder
    const manageCategoriesModal = document.getElementById('manage-categories-modal');
    const manageCategoriesList = document.getElementById('manage-categories-list');

    document.getElementById('btn-edit-categories').addEventListener('click', () => {
        renderManageCategories();
        manageCategoriesModal.classList.add('active');
    });

    document.getElementById('modal-manage-close-x').addEventListener('click', () => {
        manageCategoriesModal.classList.remove('active');
    });

    document.getElementById('modal-manage-ok-btn').addEventListener('click', () => {
        manageCategoriesModal.classList.remove('active');
    });

    const renderManageCategories = () => {
        manageCategoriesList.innerHTML = '';
        categories.forEach(cat => {
            const item = document.createElement('div');
            item.className = 'manage-cat-item';
            item.draggable = true;
            item.setAttribute('data-id', cat.id);
            item.style.cssText = `
                display: flex;
                align-items: center;
                justify-content: space-between;
                background: var(--bg-surface-hover);
                border: 1px solid var(--border-subtle);
                border-radius: var(--radius-md);
                padding: 10px 16px;
                cursor: grab;
                color: var(--text-primary);
                font-size: 13px;
                gap: 12px;
            `;
            item.innerHTML = `
                <span style="flex-grow: 1;">☰ ${escapeHtml(categoryLabel(cat.name))}</span>
                <div style="display: flex; align-items: center; gap: 8px;">
                    <button class="btn btn-rename-cat" title="${escapeHtml(t('context.rename'))}" aria-label="${escapeHtml(t('context.rename'))}" style="padding: 6px; font-size: 12px; flex: none; width: auto; background: transparent; border: none; color:(--accent-text); cursor: pointer; display: flex; align-items: center; justify-content: center;">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                            <path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4Z"></path>
                        </svg>
                    </button>
                    <button class="btn btn-delete-cat" title="${escapeHtml(t('context.delete'))}" aria-label="${escapeHtml(t('context.delete'))}" style="padding: 6px; font-size: 12px; flex: none; width: auto; background: transparent; border: none; color: #E81123; cursor: pointer; display: flex; align-items: center; justify-content: center;">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                            <polyline points="3 6 5 6 21 6"></polyline>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                            <line x1="10" y1="11" x2="10" y2="17"></line>
                            <line x1="14" y1="11" x2="14" y2="17"></line>
                        </svg>
                    </button>
                </div>
            `;

            // Bind click handlers inside Manage dialog
            item.querySelector('.btn-rename-cat').addEventListener('click', async (e) => {
                e.stopPropagation();
                const newName = await showCustomPrompt(t('msg.rename_category'), cat.name, t('msg.rename_category_title'));
                if (!newName || newName === cat.name) return;

                try {
                    await window.api.renameCategory(cat.id, newName);
                    await loadAndRenderCategories();
                    profiles = await window.api.getProfiles();
                    renderManageCategories();
                    renderProfiles(current_view);
                } catch (err) {
                    console.error('Failed to rename category:', err);
                    await showCustomAlert(t('msg.operation_failed'));
                }
            });

            item.querySelector('.btn-delete-cat').addEventListener('click', async (e) => {
                e.stopPropagation();
                const confirmed = await showCustomConfirm(tf('msg.confirm_delete_category', cat.name), t('msg.delete_category_title'));
                if (!confirmed) return;

                try {
                    await window.api.deleteCategory(cat.id);
                    await loadAndRenderCategories();
                    profiles = await window.api.getProfiles();
                    if (!categories.some((entry) => entry.id === current_view)) {
                        current_view = categories.length > 0 ? categories[0].id : 'settings';
                    }
                    renderManageCategories();
                    renderProfiles(current_view);
                    switchView(current_view);
                } catch (err) {
                    console.error('Failed to delete category:', err);
                    await showCustomAlert(t('msg.operation_failed'));
                }
            });
            // Bind Category Drag & Drop Events
            item.addEventListener('dragstart', (e) => {
                // If dragging was initiated on a button or inside a button, prevent dragging
                if (e.target.closest('button')) {
                    e.preventDefault();
                    return;
                }
                e.dataTransfer.setData('text/plain', cat.id);
                item.style.opacity = '0.5';
            });
            item.addEventListener('dragend', () => {
                item.style.opacity = '1';
            });
            item.addEventListener('dragover', (e) => {
                e.preventDefault();
            });
            item.addEventListener('drop', async (e) => {
                e.preventDefault();
                const draggedId = e.dataTransfer.getData('text/plain');
                if (draggedId && draggedId !== cat.id) {
                    const draggedIdx = categories.findIndex(x => x.id === draggedId);
                    let targetIdx = categories.findIndex(x => x.id === cat.id);
                    if (draggedIdx !== -1 && targetIdx !== -1) {
                        const temp = categories[draggedIdx];
                        categories.splice(draggedIdx, 1);
                        // Compensate for the index shift caused by the removal.
                        if (draggedIdx < targetIdx) targetIdx -= 1;
                        categories.splice(targetIdx, 0, temp);

                        // Save category order
                        try {
                            await window.api.updateCategoryOrder(categories.map((x) => x.id));
                            await loadAndRenderCategories();
                            renderManageCategories();
                        } catch (err) {
                            console.error('Failed to save category order:', err);
                            await showCustomAlert(t('msg.operation_failed'));
                        }
                    }
                }
            });

            manageCategoriesList.appendChild(item);
        });
    };

    // Custom Profile (List) Creation Modal Toggles
    const createProfileModal = document.getElementById('create-profile-modal');
    let selectedSoundPath = null;
    
    document.getElementById('btn-create-profile-modal').addEventListener('click', () => {
        createProfileModal.classList.add('active');
        resetCreateProfileForm();
    });

    const resetCreateProfileForm = () => {
        document.getElementById('input-new-profile-name').value = '';
        document.getElementById('input-new-profile-desc').value = '';
        document.getElementById('select-new-profile-material').value = materials[0] || 'PBT';
        const targetInput = document.getElementById('input-new-profile-material-new');
        if (targetInput) targetInput.value = '';
        const targetWrap = document.getElementById('wrap-new-profile-material-new');
        if (targetWrap) {
            targetWrap.style.maxHeight = '0';
            targetWrap.style.opacity = '0';
            targetWrap.style.marginTop = '0';
            targetWrap.style.display = 'none';
        }
        selectedSoundPath = null;
        const soundLabel = document.getElementById('label-selected-profile-sound');
        if (soundLabel) soundLabel.innerText = t('modal.no_sound_selected');
    };

    document.getElementById('btn-select-profile-sound').addEventListener('click', async () => {
        let filePath = null;
        try {
            filePath = await window.api.selectAudioFile();
        } catch (err) {
            console.error('Failed to open the audio file picker:', err);
            return;
        }
        if (filePath) {
            selectedSoundPath = filePath;
            const fileName = filePath.split(/[\\/]/).pop();
            document.getElementById('label-selected-profile-sound').innerText = fileName;
        }
    });

    document.getElementById('modal-create-close-x').addEventListener('click', () => {
        createProfileModal.classList.remove('active');
        resetCreateProfileForm();
    });

    document.getElementById('modal-create-save-btn').addEventListener('click', async () => {
        try {
            const name = document.getElementById('input-new-profile-name').value.trim();
            const type = document.getElementById('select-new-profile-type').value;
            let material = document.getElementById('select-new-profile-material').value;
            const desc = document.getElementById('input-new-profile-desc').value;

            if (!name) {
                await showCustomAlert(t('msg.enter_profile_name'));
                return;
            }

            if (material === '__NEW__') {
                const customInput = document.getElementById('input-new-profile-material-new');
                const customVal = customInput ? customInput.value.trim() : '';
                if (!customVal) {
                    await showCustomAlert(t('msg.enter_custom_material'));
                    return;
                }
                material = customVal;
                if (!materials.includes(material)) {
                    materials.push(material);
                    loadAndRenderMaterials();
                }
            }

            const res = await window.api.createProfile(name, type, material, desc, selectedSoundPath);
            
            if (res.success) {
                await showCustomAlert(`${t('msg.profile_created')} ${name}`);
                
                resetCreateProfileForm();
                createProfileModal.classList.remove('active');
                profiles = await window.api.getProfiles();
                loadAndRenderMaterials();
                renderProfiles(current_view);
            } else {
                await showCustomAlert(`${t('msg.profile_create_failed')} ${res.error || t('msg.operation_failed')}`);
            }
        } catch (err) {
            console.error('Failed to create profile:', err);
            await showCustomAlert(t('msg.unexpected_error'));
        }
    });

    // Add Sound (Remap Key) Modal Dialog Actions
    const addSoundModal = document.getElementById('add-sound-modal');
    const targetProfileIdInput = document.getElementById('input-add-sound-profile-id');
    const targetKeycodeInput = document.getElementById('input-add-sound-keycode');

    window.openAddSoundModal = (profileId) => {
        if (!profileId) return;
        targetProfileIdInput.value = profileId;
        addSoundModal.classList.add('active');
    };

    document.getElementById('modal-add-close-x').addEventListener('click', () => {
        addSoundModal.classList.remove('active');
    });

    document.getElementById('modal-add-select-btn').addEventListener('click', async () => {
        const profileId = targetProfileIdInput.value;
        const keycode = targetKeycodeInput.value.trim();
        if (!profileId || !keycode) {
            await showCustomAlert(t('msg.select_profile_keycode'));
            return;
        }

        if (!/^[0-9]{1,6}(-up)?$/.test(keycode)) {
            await showCustomAlert(t('msg.invalid_keycode'));
            return;
        }

        try {
            const filePath = await window.api.selectAudioFile();
            if (!filePath) return;

            const res = await window.api.importMixedZipPack(profileId, keycode, filePath);
            if (res.success) {
                await showCustomAlert(t('msg.audio_assigned'));
                addSoundModal.classList.remove('active');
                profiles = await window.api.getProfiles();
                renderProfiles(current_view);
            } else {
                await showCustomAlert(`${t('msg.assign_failed')} ${res.error || t('msg.operation_failed')}`);
            }
        } catch (err) {
            console.error('Failed to assign sound file:', err);
            await showCustomAlert(t('msg.unexpected_error'));
        }
    });

    // Edit Profile Modal Toggles & Actions
    const editProfileModal = document.getElementById('edit-profile-modal');
    const editProfileIdInput = document.getElementById('input-edit-profile-id');
    const editProfileNameInput = document.getElementById('input-edit-profile-name');
    const editProfileTypeSelect = document.getElementById('select-edit-profile-type');
    const editProfileMaterialSelect = document.getElementById('select-edit-profile-material');
    const editProfileDescInput = document.getElementById('input-edit-profile-desc');

    window.openEditProfileModal = async (profileId) => {
        try {
            const details = await window.api.getProfileDetails(profileId);
            if (!details) {
                await showCustomAlert(t('msg.profile_not_found'));
                return;
            }
            editProfileIdInput.value = details.id;
            editProfileNameInput.value = details.name;
            editProfileTypeSelect.value = details.type;
            editProfileMaterialSelect.value = details.material;
            editProfileDescInput.value = details.description || '';
            editProfileModal.classList.add('active');
        } catch (err) {
            console.error('Failed to open edit profile modal:', err);
            await showCustomAlert(t('msg.unexpected_error'));
        }
    };

    document.getElementById('modal-edit-close-x').addEventListener('click', () => {
        editProfileModal.classList.remove('active');
    });

    document.getElementById('modal-edit-save-btn').addEventListener('click', async () => {
        const id = editProfileIdInput.value;
        const name = editProfileNameInput.value;
        const type = editProfileTypeSelect.value;
        let material = editProfileMaterialSelect.value;
        const desc = editProfileDescInput.value;

        if (!name.trim()) {
            await showCustomAlert(t('msg.profile_name_empty'));
            return;
        }

        if (material === '__NEW__') {
            const customInput = document.getElementById('input-edit-profile-material-new');
            const customVal = customInput ? customInput.value.trim() : '';
            if (!customVal) {
                await showCustomAlert(t('msg.enter_custom_material'));
                return;
            }
            material = customVal;
        }

        try {
            await window.api.updateProfileDetails(id, name.trim(), type, material, desc);
        } catch (err) {
            console.error('Failed to update profile:', err);
            await showCustomAlert(t('msg.operation_failed'));
            return;
        }
        
        // Clean custom material input fields and reset state
        const targetWrap = document.getElementById('wrap-edit-profile-material-new');
        if (targetWrap) {
            targetWrap.style.maxHeight = '0';
            targetWrap.style.opacity = '0';
            targetWrap.style.marginTop = '0';
        }
        const targetInput = document.getElementById('input-edit-profile-material-new');
        if (targetInput) targetInput.value = '';

        editProfileModal.classList.remove('active');

        try {
            profiles = await window.api.getProfiles();
        } catch (err) {
            console.error('Failed to reload profiles after edit:', err);
        }
        loadAndRenderMaterials();
        renderProfiles(current_view);
        updateActiveProfileBadge();
    });

    document.getElementById('modal-edit-delete-btn').addEventListener('click', async () => {
        const id = editProfileIdInput.value;
        const name = editProfileNameInput.value;
        const confirmed = await showCustomConfirm(tf('msg.confirm_delete_profile', name));
        if (!confirmed) return;

        try {
            await window.api.deleteProfile(id);
            editProfileModal.classList.remove('active');
            profiles = await window.api.getProfiles();

            // The main process may have picked a replacement active profile.
            const nextSettings = await window.api.getSettings();
            active_profile_id = nextSettings.selected_profile;
            
            // Clear material option selectors and rebuild filters on delete
            document.getElementById('select-new-profile-material').innerHTML = '';
            document.getElementById('select-edit-profile-material').innerHTML = '';
            loadAndRenderMaterials();

            renderProfiles(current_view);
            updateActiveProfileBadge();
        } catch (err) {
            console.error('Failed to delete profile:', err);
            await showCustomAlert(t('msg.operation_failed'));
        }
    });

    // Legal Modal Toggles
    const legalModal = document.getElementById('legal-modal');
    const modalTitle = document.getElementById('modal-title-text');
    const modalBody = document.getElementById('modal-body-content');
    const modalLink = document.getElementById('modal-external-link');
    
    // One table instead of three near-identical branches (DRY). The link
    // handler always catches, so a failed open never becomes an unhandled
    // rejection.
    const LEGAL_PAGES = {
        terms: { title: 'legal.terms_title', body: 'legal.terms_body', slug: 'eula' },
        licenses: { title: 'legal.licenses_title', body: 'legal.licenses_body', slug: 'licenses' },
        privacy: { title: 'legal.privacy_title', body: 'legal.privacy_body', slug: 'privacy' }
    };

    const showLegalModal = (type) => {
        const page = LEGAL_PAGES[type] || LEGAL_PAGES.privacy;
        const url = `https://vellium.dev/${page.slug}`;

        modalTitle.innerText = t(page.title);
        modalLink.innerText = `vellium.dev/${page.slug}`;
        modalLink.onclick = (e) => {
            e.preventDefault();
            window.api.openExternal(url)
                .catch((err) => console.error('Failed to open legal page:', err));
        };
        // Legal bodies are trusted, locale-controlled translation strings.
        modalBody.innerHTML = t(page.body);

        legalModal.classList.add('active');
    };

    document.getElementById('modal-close-x').addEventListener('click', () => legalModal.classList.remove('active'));
    document.getElementById('modal-ok-btn').addEventListener('click', () => legalModal.classList.remove('active'));
    
    document.getElementById('link-privacy').addEventListener('click', (e) => {
        e.preventDefault(); showLegalModal('privacy');
    });
    document.getElementById('link-terms').addEventListener('click', (e) => {
        e.preventDefault(); showLegalModal('terms');
    });
    document.getElementById('link-licenses').addEventListener('click', (e) => {
        e.preventDefault(); showLegalModal('licenses');
    });



    // ─── v1.0.0 settings: window close, accessibility, feedback ─────────────

    const closeSelect = document.getElementById('setting-close-behavior');
    if (closeSelect) closeSelect.value = settings.close_behavior || 'tray';

    const zoomInput = document.getElementById('setting-zoom');
    const zoomValue = document.getElementById('zoom-value');
    const renderZoom = (value) => {
        const parsed = Math.max(80, Math.min(150, Number.parseInt(value, 10) || 100));
        settings.zoom = String(parsed);
        if (zoomInput) zoomInput.value = parsed;
        if (zoomValue) zoomValue.textContent = `${parsed}%`;
        window.api.setZoom(String(parsed)).catch((err) => console.warn('Failed to set zoom:', err));
        return parsed;
    };

    if (zoomInput) {
        renderZoom(settings.zoom || '100');
        zoomInput.addEventListener('input', (e) => renderZoom(e.target.value));
        zoomInput.addEventListener('change', async (e) => {
            await persistSetting('zoom', String(renderZoom(e.target.value)));
        });
    }

    document.getElementById('btn-zoom-reset').addEventListener('click', async () => {
        await persistSetting('zoom', String(renderZoom(100)));
        showToast(t('toast.saved'));
    });

    const bindToggle = (id, key, apply) => {
        const input = document.getElementById(id);
        if (!input) return;
        input.checked = settings[key] === 'true';
        input.addEventListener('change', async (e) => {
            settings[key] = e.target.checked ? 'true' : 'false';
            await persistSetting(key, settings[key]);
            if (apply) apply();
        });
    };

    bindToggle('setting-contrast', 'high_contrast', () => applyTheme(settings.theme));
    bindToggle('setting-motion', 'reduce_motion', () => applyTheme(settings.theme));
    bindToggle('setting-notify', 'notifications');
    bindToggle('setting-sound-feedback', 'sound_feedback');

    document.getElementById('btn-notify-test').addEventListener('click', async () => {
        await window.api.showNotification(t('notify.test_title'), t('notify.test_body'));
        showToast(t('toast.copied'));
    });

    if (closeSelect) {
        closeSelect.addEventListener('change', async (e) => {
            settings.close_behavior = e.target.value;
            await persistSetting('close_behavior', e.target.value);
            showToast(t('toast.saved'));
        });
    }

    // Quick-task shortcut recorder (Ctrl+Alt+N by default).
    const btnRecordLauncher = document.getElementById('btn-record-launcher');
    const btnClearLauncher = document.getElementById('btn-clear-launcher');
    let recordingLauncher = false;

    const updateLauncherLabel = () => {
        if (!btnRecordLauncher) return;
        btnRecordLauncher.innerText = settings.shortcut_quick_task
            ? formatShortcutForUser(settings.shortcut_quick_task)
            : t('settings.shortcut_record_placeholder');
    };

    const stopLauncherRecording = () => {
        recordingLauncher = false;
        if (btnRecordLauncher) btnRecordLauncher.classList.remove('recording');
        window.removeEventListener('keydown', handleLauncherKeyDown, true);
        window.removeEventListener('blur', cancelLauncherRecording);
    };

    function cancelLauncherRecording() {
        if (!recordingLauncher) return;
        stopLauncherRecording();
        updateLauncherLabel();
    }

    async function handleLauncherKeyDown(event) {
        event.preventDefault();
        event.stopPropagation();
        if (event.key === 'Escape') {
            stopLauncherRecording();
            updateLauncherLabel();
            return;
        }
        if (['Control', 'Shift', 'Alt', 'Meta'].includes(event.key)) return;

        const parts = [];
        if (event.ctrlKey) parts.push('Control');
        if (event.altKey) parts.push('Alt');
        if (event.shiftKey) parts.push('Shift');
        if (event.metaKey) parts.push('Meta');
        if (parts.length === 0) {
            await showCustomAlert(t('settings.shortcut_requires_modifier'));
            return;
        }
        let electronKey = event.key.toUpperCase();
        if (event.key === ' ') electronKey = 'Space';
        if (event.key.startsWith('Arrow')) electronKey = event.key.substring(5);
        parts.push(electronKey);
        const shortcut = parts.join('+');

        stopLauncherRecording();
        const previousQuickTask = settings.shortcut_quick_task || '';
        settings.shortcut_quick_task = shortcut;
        updateLauncherLabel();
        // Persisting re-registers both hotkeys; success also means the
        // combination was free and is now actually active.
        const saved = await persistSetting('shortcut_quick_task', shortcut);
        if (!saved) {
            settings.shortcut_quick_task = previousQuickTask;
            updateLauncherLabel();
            await showCustomAlert(t('settings.shortcut_error'));
        }
    }

    if (btnRecordLauncher) {
        updateLauncherLabel();
        btnRecordLauncher.addEventListener('click', () => {
            if (recordingLauncher) {
                stopLauncherRecording();
                updateLauncherLabel();
                return;
            }
            recordingLauncher = true;
            btnRecordLauncher.innerText = t('settings.shortcut_recording');
            btnRecordLauncher.classList.add('recording');
            window.addEventListener('keydown', handleLauncherKeyDown, true);
            window.addEventListener('blur', cancelLauncherRecording);
        });
    }

    if (btnClearLauncher) {
        btnClearLauncher.addEventListener('click', async () => {
            stopLauncherRecording();
            settings.shortcut_quick_task = '';
            await persistSetting('shortcut_quick_task', '');
            updateLauncherLabel();
        });
    }

    // ─── Settings section navigation ────────────────────────────────────────
    const sections = [...document.querySelectorAll('.settings-section')];
    const sectionLinks = [...document.querySelectorAll('.pp-split-nav-link[data-section]')];

    const activateSettingsSection = (name, scroll = true) => {
        sectionLinks.forEach((link) => {
            const selected = link.dataset.section === name;
            link.classList.toggle('is-active', selected);
            link.classList.toggle('active', selected);
        });
        if (!scroll) return;
        const target = document.getElementById(`settings-${name}`);
        if (target) target.scrollIntoView({ behavior: settings.reduce_motion === 'true' ? 'auto' : 'smooth', block: 'start' });
    };

    sectionLinks.forEach((link) => {
        link.addEventListener('click', () => activateSettingsSection(link.dataset.section));
    });

    // The scrolling element is the settings content pane, so the active link
    // follows the section that is crossing the top of that pane.
    const settingsScroll = document.getElementById('settings-pane');
    if (settingsScroll) {
        let spyFrame = 0;
        settingsScroll.addEventListener('scroll', () => {
            if (spyFrame) return;
            spyFrame = requestAnimationFrame(() => {
                spyFrame = 0;
                const top = settingsScroll.getBoundingClientRect().top + 32;
                let active = sections.length ? sections[0].dataset.section : 'general';
                for (const section of sections) {
                    if (section.getBoundingClientRect().top <= top) active = section.dataset.section;
                }
                sectionLinks.forEach((link) => {
                    const selected = link.dataset.section === active;
                    link.classList.toggle('is-active', selected);
                    link.classList.toggle('active', selected);
                });
            });
        }, { passive: true });
    }

    // ─── Sidebar stats ──────────────────────────────────────────────────────
    const updateSidebarStats = () => {
        // The redesign dropped the sidebar counters.
    };
    updateSidebarStats();

    // ─── Cloud backup card ──────────────────────────────────────────────────
    const cloudProvider = document.getElementById('cloud-provider');
    const cloudPath = document.getElementById('cloud-path');
    const cloudBadge = document.getElementById('cloud-badge');
    const cloudMeta = document.getElementById('cloud-meta');
    const cloudHint = document.getElementById('cloud-hint');
    const cloudAuto = document.getElementById('setting-cloud-auto');
    let cloudState = null;

    const formatSyncDate = (iso) => {
        if (!iso) return t('cloud.never');
        try {
            return new Date(iso).toLocaleString(currentLang || undefined);
        } catch (err) {
            return iso;
        }
    };

    const renderCloud = (status) => {
        if (!status) return;
        cloudState = status;
        if (cloudProvider) cloudProvider.value = status.provider || 'none';
        if (cloudPath) cloudPath.textContent = status.backupDir || '-';
        if (cloudBadge) {
            cloudBadge.textContent = status.connected ? t('cloud.connected') : t('cloud.disconnected');
            cloudBadge.classList.toggle('on', Boolean(status.connected));
        }
        if (cloudMeta) {
            const last = status.lastSync ? formatSyncDate(status.lastSync) : t('cloud.never');
            cloudMeta.textContent = `${tf('cloud.last_sync', last)} · ${tf('cloud.backups', status.backups || 0)}`;
        }
        if (cloudAuto) cloudAuto.checked = status.auto !== false;
        if (cloudHint) {
            // Only explain the fallback when a connection is actually set up
            // but its provider folder is missing.
            cloudHint.hidden = !status.connected || status.available !== false;
            cloudHint.textContent = status.connected && status.available === false
                ? t('cloud.fallback_note')
                : '';
        }

        const syncBtn = document.getElementById('btn-cloud-sync');
        const restoreBtn = document.getElementById('btn-cloud-restore');
        const disconnectBtn = document.getElementById('btn-cloud-disconnect');
        const openBtn = document.getElementById('btn-cloud-open');
        if (syncBtn) syncBtn.disabled = !status.connected;
        if (restoreBtn) restoreBtn.disabled = !status.hasBackup;
        if (disconnectBtn) disconnectBtn.disabled = !status.connected;
        if (openBtn) openBtn.disabled = false;
    };

    const refreshCloud = async () => {
        try {
            renderCloud(await window.api.getCloudStatus());
        } catch (err) {
            console.error('Failed to read cloud status:', err);
        }
    };
    await refreshCloud();

    if (cloudProvider) {
        cloudProvider.addEventListener('change', async (e) => {
            if (e.target.value === 'none') return;
            settings.cloud_provider = e.target.value;
            await persistSetting('cloud_provider', e.target.value);
            await refreshCloud();
        });
    }

    if (cloudAuto) {
        cloudAuto.addEventListener('change', async (e) => {
            settings.cloud_auto = e.target.checked ? 'true' : 'false';
            await persistSetting('cloud_auto', settings.cloud_auto);
        });
    }

    document.getElementById('btn-cloud-choose').addEventListener('click', async () => {
        const folder = await window.api.chooseCloudFolder();
        if (!folder) return;
        settings.cloud_folder = folder;
        settings.cloud_provider = 'custom';
        if (cloudProvider) cloudProvider.value = 'custom';
        await persistSetting('cloud_folder', folder);
        await persistSetting('cloud_provider', 'custom');
        await refreshCloud();
        showToast(t('toast.saved'));
    });

    document.getElementById('btn-cloud-connect').addEventListener('click', async () => {
        const provider = cloudProvider ? cloudProvider.value : 'none';
        if (provider === 'none') {
            await showCustomAlert(t('cloud.empty_local'));
            return;
        }
        let folder = settings.cloud_folder || '';
        if (provider === 'custom') {
            folder = await window.api.chooseCloudFolder();
            if (!folder) return;
        }
        const result = await window.api.connectCloud(provider, folder);
        renderCloud(result.status);
        if (result.success) {
            showToast(t('cloud.synced'));
        } else if (result.error === 'empty_local' || result.error === 'backup_found') {
            const restore = await showRestorePrompt();
            if (restore) {
                const restored = await window.api.restoreCloud();
                if (restored.success) {
                    showToast(t('cloud.restored'));
                    await reloadAfterRestore();
                } else {
                    await showCustomAlert(t('cloud.error'));
                }
            } else {
                // "Start fresh" is an explicit choice: replace the remote backup
                // with this device's data instead of leaving the card half set up.
                const synced = await window.api.syncCloud();
                if (synced.status) renderCloud(synced.status);
                showToast(synced.success ? t('cloud.synced') : t('cloud.error'));
            }
        } else {
            await showCustomAlert(t('cloud.error'));
        }
    });

    document.getElementById('btn-cloud-sync').addEventListener('click', async () => {
        const result = await window.api.syncCloud();
        if (result.status) renderCloud(result.status);
        if (result.success) showToast(t('cloud.synced'));
        else await showCustomAlert(result.error === 'empty_local' ? t('cloud.empty_local') : t('cloud.error'));
    });

    document.getElementById('btn-cloud-restore').addEventListener('click', async () => {
        const confirmed = await showCustomConfirm(t('cloud.restore_found_desc'), t('cloud.restore_found_title'));
        if (!confirmed) return;
        const result = await window.api.restoreCloud();
        if (result.success) {
            showToast(t('cloud.restored'));
            await reloadAfterRestore();
        } else {
            await showCustomAlert(t('cloud.error'));
        }
    });

    document.getElementById('btn-cloud-disconnect').addEventListener('click', async () => {
        const result = await window.api.disconnectCloud();
        renderCloud(result.status);
        showToast(t('toast.saved'));
    });

    document.getElementById('btn-cloud-open').addEventListener('click', async () => {
        await window.api.openCloudFolder();
    });

    document.getElementById('btn-quick-backup').addEventListener('click', async () => {
        if ((settings.cloud_provider || 'none') === 'none') {
            switchView('settings');
            activateSettingsSection('data');
            return;
        }
        const result = await window.api.syncCloud();
        if (result.status) renderCloud(result.status);
        if (result.success) showToast(t('toast.sync'));
        else showToast(t('toast.error'), 'error');
    });

    document.getElementById('btn-quick-import').addEventListener('click', () => switchView('custom'));

    // ─── Documentation ──────────────────────────────────────────────────────
    const DOCS_BASE = 'https://github.com/emirtdede/tactile/tree/main/docs';
    const DOCS_BLOB_BASE = 'https://github.com/emirtdede/tactile/blob/main/docs/';
    // Each guide renders as a card in the right-hand pane; the topic list on the
    // left scrolls to it. The file is the Markdown page that covers the topic.
    const DOC_FILES = {
        getting_started: 'FEATURES.md',
        profiles: 'FEATURES.md',
        shortcuts: 'FEATURES.md',
        sync: 'CLOUD_SYNC.md',
        assistant: 'AI.md',
        integrations: 'INTEGRATIONS.md',
        privacy: 'SECURITY.md'
    };
    const DOC_ORDER = ['getting_started', 'profiles', 'shortcuts', 'sync', 'assistant', 'integrations', 'privacy'];

    const openDoc = (key) => {
        const file = DOC_FILES[key] || DOC_FILES.getting_started;
        window.api.openExternal(`${DOCS_BLOB_BASE}${file}`)
            .catch((err) => console.error('Failed to open document:', err));
    };

    const docsPane = document.getElementById('docs-pane');
    const docSections = Array.from(document.querySelectorAll('.docs-section'));
    const highlightDoc = (key) => {
        document.querySelectorAll('.pp-split-nav-link[data-docs]').forEach((link) => {
            const selected = link.dataset.docs === key;
            link.classList.toggle('is-active', selected);
            link.classList.toggle('active', selected);
        });
    };
    const showDoc = (key, scroll) => {
        const active = DOC_FILES[key] ? key : 'getting_started';
        highlightDoc(active);
        const section = document.getElementById(`doc-sec-${active}`);
        if (!scroll || !section || !docsPane) return;
        const top = section.getBoundingClientRect().top - docsPane.getBoundingClientRect().top + docsPane.scrollTop - 8;
        docsPane.scrollTo({ top, behavior: settings.reduce_motion === 'true' ? 'auto' : 'smooth' });
    };

    document.querySelectorAll('[data-docs]').forEach((element) => {
        element.addEventListener('click', () => showDoc(element.dataset.docs, true));
    });

    // Double-clicking a guide opens the full Markdown page for that topic.
    docSections.forEach((section) => {
        section.addEventListener('dblclick', () => openDoc(section.id.replace('doc-sec-', '')));
    });

    // Keep the topic list in step with whatever the reader has scrolled to.
    if (docsPane && docSections.length) {
        docsPane.addEventListener('scroll', () => {
            const paneTop = docsPane.getBoundingClientRect().top;
            let current = DOC_ORDER[0];
            for (const section of docSections) {
                if (section.getBoundingClientRect().top - paneTop <= 80) {
                    current = section.id.replace('doc-sec-', '');
                }
            }
            highlightDoc(current);
        }, { passive: true });
    }

    showDoc('getting_started', false);

    document.getElementById('btn-docs-github').addEventListener('click', () => {
        window.api.openExternal(`${DOCS_BASE}`).catch((err) => console.error('Failed to open docs:', err));
    });

    // Instant filter: the topic list and the guide cards narrow together, so a
    // search always leaves the pane showing only what matched.
    const docsSearch = document.getElementById('docs-search');
    if (docsSearch) {
        const links = Array.from(document.querySelectorAll('.pp-split-nav-link[data-docs]'));
        const normalize = (value) => String(value).toLocaleLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        docsSearch.addEventListener('input', () => {
            const query = normalize(docsSearch.value.trim());
            for (const link of links) {
                const section = document.getElementById(`doc-sec-${link.dataset.docs}`);
                const haystack = normalize(`${link.textContent} ${section ? section.textContent : ''}`);
                const match = query.length === 0 || haystack.includes(query);
                link.hidden = !match;
                if (section) section.hidden = !match;
            }
        });
    }

    // ─── Diagnostics ────────────────────────────────────────────────────────
    let diagnosticsState = null;

    const renderDiagnostics = (data) => {
        diagnosticsState = data;
        const set = (id, value) => {
            const element = document.getElementById(id);
            if (element) element.textContent = value;
        };
        set('diag-os', `${data.platform === 'win32' ? 'Windows' : data.platform === 'darwin' ? 'macOS' : 'Linux'} ${data.osRelease} (${data.arch})`);
        set('diag-version', data.version);
        set('diag-app', `Tactile ${data.version} (Electron ${data.electron})`);
        set('diag-locale', `${data.locale}${data.language ? ` / ${data.language}` : ''}`);
        set('diag-data-dir', data.dataDir);

        const health = (element, ok) => {
            if (!element) return;
            element.textContent = ok ? t('diag.ok') : t('diag.warn');
            element.classList.toggle('warn', !ok);
        };
        health(document.getElementById('diag-db'), data.dbOk);
        health(document.getElementById('diag-hook'), data.hookOk);
        health(document.getElementById('diag-tray'), data.trayOk);
    };

    const diagnosticsText = () => {
        if (!diagnosticsState) return '';
        const d = diagnosticsState;
        return [
            'Tactile diagnostics',
            `Version: ${d.version}`,
            `Electron: ${d.electron}`,
            `Platform: ${d.platform} ${d.osRelease} (${d.arch})`,
            `Locale: ${d.locale}`,
            `Language: ${d.language}`,
            `Data folder: ${d.dataDir}`,
            `Database: ${d.dbOk ? 'ok' : 'failed'}`,
            `Keyboard hook: ${d.hookOk ? 'ok' : 'failed'}`,
            `Tray: ${d.trayOk ? 'ok' : 'failed'}`,
            `Cloud: ${d.cloud.provider} (${d.cloud.backupDir})`,
            `Memory: ${d.memoryMB} MB`
        ].join('\n');
    };

    const refreshDiagnostics = async () => {
        try {
            renderDiagnostics(await window.api.getDiagnostics());
        } catch (err) {
            console.error('Failed to collect diagnostics:', err);
        }
    };
    await refreshDiagnostics();

    document.getElementById('btn-diag-refresh').addEventListener('click', refreshDiagnostics);
    document.getElementById('btn-diag-copy').addEventListener('click', async () => {
        await window.api.copyText(diagnosticsText());
        showToast(t('diag.copied'));
    });
    document.getElementById('btn-diag-export').addEventListener('click', async () => {
        const result = await window.api.saveDiagnostics(diagnosticsText());
        if (result.success) showToast(t('diag.exported'));
    });
    document.getElementById('btn-diag-logs').addEventListener('click', () => window.api.openLogsFolder());
    document.getElementById('btn-diag-report').addEventListener('click', () => {
        window.api.openExternal('https://github.com/emirtdede/tactile/issues/new').catch((err) => console.error('Failed to open issues:', err));
    });

    // ─── Support and about links ────────────────────────────────────────────
    const GITHUB_URL = 'https://github.com/emirtdede/tactile';
    const SPONSOR_URL = 'https://github.com/sponsors/emirtdede';

    const openExternalSafe = (url) => window.api.openExternal(url)
        .catch((err) => console.error('Failed to open external link:', err));

    document.getElementById('btn-gh-repo').addEventListener('click', () => openExternalSafe(GITHUB_URL));
    document.getElementById('btn-sponsor').addEventListener('click', () => openExternalSafe(SPONSOR_URL));
    document.getElementById('btn-about-github').addEventListener('click', () => openExternalSafe(GITHUB_URL));
    document.getElementById('btn-about-sponsor').addEventListener('click', () => openExternalSafe(SPONSOR_URL));
    document.getElementById('btn-about-github-top').addEventListener('click', () => openExternalSafe(GITHUB_URL));
    document.getElementById('btn-about-sponsor-top').addEventListener('click', () => openExternalSafe(SPONSOR_URL));
    document.getElementById('btn-about-docs').addEventListener('click', () => switchView('docs'));
    document.getElementById('btn-support-issue').addEventListener('click', () => openExternalSafe(`${GITHUB_URL}/issues/new`));
    document.getElementById('btn-support-email').addEventListener('click', () => openExternalSafe('mailto:support@vellium.dev'));
    document.getElementById('btn-support-copy').addEventListener('click', async () => {
        await window.api.copyText(diagnosticsText());
        showToast(t('toast.copied'));
    });

    document.getElementById('btn-about-github').title = t('about.sponsor_desc');
    document.getElementById('btn-about-sponsor').title = t('about.sponsor_desc');
    document.getElementById('btn-web-site').title = t('about.website_desc');

    // ─── Updates ────────────────────────────────────────────────────────────
    const updatesMeta = document.getElementById('updates-meta');
    const updateInstall = document.getElementById('btn-update-install');
    const updateProgress = document.getElementById('update-progress');
    const updateProgressBar = document.getElementById('update-progress-bar');

    const setUpdateMeta = (text) => {
        if (updatesMeta) updatesMeta.textContent = text;
    };
    setUpdateMeta(tf('settings.updates_current', app_version || ''));

    const renderUpdateState = (state) => {
        if (!state) return;
        switch (state.state) {
            case 'checking':
                setUpdateMeta(t('settings.updates_checking'));
                break;
            case 'latest':
                setUpdateMeta(t('settings.updates_none'));
                break;
            case 'available':
                setUpdateMeta(tf('settings.updates_available', state.version || ''));
                if (updateInstall) updateInstall.hidden = false;
                break;
            case 'downloading':
                setUpdateMeta(tf('settings.updates_downloading', state.percent || 0));
                if (updateProgress) updateProgress.hidden = false;
                if (updateProgressBar) updateProgressBar.style.width = `${state.percent || 0}%`;
                break;
            case 'ready':
                setUpdateMeta(t('settings.updates_ready'));
                break;
            case 'store':
                setUpdateMeta(t('settings.updates_store'));
                break;
            case 'development':
                setUpdateMeta(tf('settings.updates_current', state.version || app_version || ''));
                break;
            case 'error':
                setUpdateMeta(t('settings.updates_error'));
                break;
            default:
                break;
        }
    };

    window.api.onUpdateStatus((state) => renderUpdateState(state));

    document.getElementById('btn-update-check').addEventListener('click', async () => {
        setUpdateMeta(t('settings.updates_checking'));
        const result = await window.api.checkForUpdates();
        if (result.state === 'store') renderUpdateState({ state: 'store' });
        else if (result.state === 'development' || result.state === 'unavailable') renderUpdateState({ state: 'development', version: result.version });
        else if (result.state === 'error') renderUpdateState({ state: 'error' });
    });

    if (updateInstall) {
        updateInstall.addEventListener('click', async () => {
            const result = await window.api.downloadUpdate();
            if (!result.success) renderUpdateState({ state: 'error' });
        });
    }

    // ─── Welcome wizard ─────────────────────────────────────────────────────
    const wizardOverlay = document.getElementById('wizard-overlay');
    const wizardSteps = ['language', 'theme', 'welcome', 'tour'];
    let wizardIndex = 0;
    let wizardTheme = settings.theme || 'system';

    const wizardLanguage = document.getElementById('wizard-language');
    if (wizardLanguage) {
        wizardLanguage.innerHTML = '';
        for (const lang of getAvailableLanguages()) {
            const option = document.createElement('option');
            option.value = lang.code;
            option.textContent = lang.name;
            wizardLanguage.appendChild(option);
        }
        wizardLanguage.value = savedLang;
        wizardLanguage.addEventListener('change', async (e) => {
            if (!isSupportedLang(e.target.value)) return;
            setLang(e.target.value);
            applyDocumentLanguage();
            applyTranslations();
            settings.language = e.target.value;
            updateVersionLabel();
            await persistSetting('language', e.target.value);
            updateWizard();
        });
    }

    const wizardProgress = document.getElementById('wizard-progress');
    const wizardStepCount = document.getElementById('wizard-step-count');
    const wizardNext = document.getElementById('wizard-next');
    const wizardBack = document.getElementById('wizard-back');

    const markWizardTheme = (choice) => {
        wizardTheme = choice;
        document.querySelectorAll('.theme-choice').forEach((button) => {
            button.classList.toggle('active', button.dataset.themeChoice === choice);
        });
        const row = document.getElementById('wizard-color-row');
        if (row) row.hidden = choice !== 'custom';
    };

    document.querySelectorAll('.theme-choice').forEach((button) => {
        button.addEventListener('click', () => markWizardTheme(button.dataset.themeChoice));
    });

    document.getElementById('btn-wizard-color').addEventListener('click', async () => {
        const input = document.getElementById('wizard-custom-color');
        const value = normalizeHex(input ? input.value : '');
        if (!value) {
            await showCustomAlert(t('settings.invalid_color'));
            return;
        }
        settings.custom_color = value;
        if (input) input.value = value;
        applyTheme('custom');
        // Persist immediately: choosing a colour and then closing the wizard
        // used to lose the pick on the next launch.
        await persistSetting('custom_color', value);
        showToast(t('toast.saved'));
    });

    const updateWizard = () => {
        const step = wizardSteps[wizardIndex];
        document.querySelectorAll('.wizard-step').forEach((section) => {
            section.classList.toggle('active', section.dataset.wizardStep === step);
        });
        if (wizardProgress) {
            wizardProgress.style.setProperty('--progress', `${((wizardIndex + 1) / wizardSteps.length) * 100}%`);
        }
        if (wizardStepCount) {
            wizardStepCount.textContent = tf('wizard.of', wizardIndex + 1, wizardSteps.length);
        }
        if (wizardBack) wizardBack.hidden = wizardIndex === 0;
        if (wizardNext) {
            wizardNext.textContent = wizardIndex === wizardSteps.length - 1
                ? t('wizard.start')
                : t('wizard.next');
        }
        markWizardTheme(wizardTheme);
    };

    const finishWizard = async () => {
        settings.onboarding_done = 'true';
        await persistSetting('onboarding_done', 'true');
        if (wizardOverlay) wizardOverlay.classList.remove('active');
    };

    if (wizardNext) {
        wizardNext.addEventListener('click', async () => {
            if (wizardIndex === 1) {
                // "Custom" is a palette, not a light/dark mode: keep the OS
                // preference and switch the accent instead.
                applyTheme(wizardTheme);
                await persistSetting(wizardTheme === 'custom' ? 'theme_palette' : 'theme', wizardTheme);
                await applyAppIcon(settings.app_icon || 'theme');
            }
            if (wizardIndex >= wizardSteps.length - 1) {
                await finishWizard();
                return;
            }
            wizardIndex += 1;
            updateWizard();
        });
    }

    if (wizardBack) {
        wizardBack.addEventListener('click', () => {
            wizardIndex = Math.max(0, wizardIndex - 1);
            updateWizard();
        });
    }

    document.getElementById('wizard-skip').addEventListener('click', finishWizard);

    // ─── Local assistant and integrations ───────────────────────────────────
    const aiEnabled = document.getElementById('setting-ai-enabled');
    const aiRag = document.getElementById('setting-ai-rag');
    const aiRuntimeState = document.getElementById('ai-runtime-state');
    const aiHardware = document.getElementById('ai-hardware');
    const aiBadge = document.getElementById('ai-badge');
    const aiModelList = document.getElementById('ai-model-list');
    const aiRagState = document.getElementById('ai-rag-state');
    const aiProgress = document.getElementById('ai-progress');
    const aiAnswer = document.getElementById('ai-answer');
    const aiSources = document.getElementById('ai-sources');
    let aiState = null;

    const renderAi = (state) => {
        if (!state) return;
        aiState = state;
        if (aiEnabled) aiEnabled.checked = state.enabled;
        if (aiRag) aiRag.checked = Boolean(state.rag && state.rag.enabled);
        if (aiBadge) {
            aiBadge.textContent = state.enabled ? t('ai.on') : t('ai.off');
            aiBadge.classList.toggle('on', state.enabled);
        }
        if (aiRuntimeState) {
            aiRuntimeState.textContent = state.runtime && state.runtime.running
                ? t('ai.runtime_running')
                : t('ai.runtime_missing');
        }
        if (aiHardware) {
            const hardware = state.hardware || {};
            aiHardware.textContent = `${hardware.cpu || '-'} / ${hardware.cores || 0} / ${hardware.memoryGB || 0} GB`;
        }
        if (aiRagState && state.rag) {
            aiRagState.textContent = state.rag.enabled
                ? tf('ai.rag_state', String(state.rag.documents), String(state.rag.chunks))
                : t('ai.rag_off');
        }
        if (aiModelList) {
            aiModelList.innerHTML = '';
            (state.catalog || []).forEach((model) => {
                const row = document.createElement('div');
                row.className = 'ai-model-row';

                const info = document.createElement('div');
                const name = document.createElement('strong');
                name.textContent = model.label;
                const meta = document.createElement('span');
                meta.className = 'ai-model-meta';
                meta.textContent = `${model.sizeGB} GB / ${model.minMemoryGB} GB RAM`;
                info.append(name, meta);
                if (model.id === state.recommended) {
                    const tag = document.createElement('span');
                    tag.className = 'ai-tag';
                    tag.textContent = t('ai.recommended');
                    info.appendChild(tag);
                }

                const actions = document.createElement('div');
                actions.className = 'ai-model-actions';
                if (model.installed) {
                    if (!model.embedding) {
                        const use = document.createElement('button');
                        use.className = model.id === state.model ? 'btn secondary' : 'btn primary';
                        use.textContent = model.id === state.model ? t('ai.model_active') : t('ai.model_use');
                        use.addEventListener('click', async () => {
                            await persistSetting('ai_model', model.id);
                            settings.ai_model = model.id;
                            renderAi(await window.api.refreshAi());
                        });
                        actions.appendChild(use);
                    }
                    const remove = document.createElement('button');
                    remove.className = 'btn secondary';
                    remove.textContent = t('ai.model_delete');
                    remove.addEventListener('click', async () => {
                        const confirmed = await showCustomConfirm(t('ai.model_delete_desc'), t('ai.model_delete'));
                        if (!confirmed) return;
                        await window.api.deleteAiModel(model.id);
                        renderAi(await window.api.refreshAi());
                        showToast(t('ai.model_deleted'));
                    });
                    actions.appendChild(remove);
                } else {
                    const download = document.createElement('button');
                    download.className = 'btn primary';
                    download.textContent = model.runnable ? t('ai.model_download') : t('ai.model_too_big');
                    download.disabled = !model.runnable;
                    download.addEventListener('click', async () => {
                        download.disabled = true;
                        download.textContent = t('ai.model_downloading');
                        if (aiProgress) {
                            aiProgress.hidden = false;
                            aiProgress.textContent = `${model.label} 0%`;
                        }
                        const result = await window.api.pullAiModel(model.id);
                        if (aiProgress) aiProgress.hidden = true;
                        if (!result.success) {
                            await showCustomAlert(t('ai.model_failed'));
                        } else {
                            showToast(t('ai.model_installed'));
                        }
                        renderAi(await window.api.refreshAi());
                    });
                    actions.appendChild(download);
                }

                row.append(info, actions);
                aiModelList.appendChild(row);
            });
        }
    };

    const refreshAi = async () => {
        try {
            renderAi(await window.api.refreshAi());
        } catch (err) {
            console.error('Failed to read assistant status:', err);
        }
    };

    if (aiEnabled) {
        aiEnabled.addEventListener('change', async () => {
            await persistSetting('ai_enabled', aiEnabled.checked ? 'true' : 'false');
            settings.ai_enabled = aiEnabled.checked ? 'true' : 'false';
            renderAi(await window.api.refreshAi());
        });
    }
    if (aiRag) {
        aiRag.addEventListener('change', async () => {
            await persistSetting('ai_rag', aiRag.checked ? 'true' : 'false');
            settings.ai_rag = aiRag.checked ? 'true' : 'false';
            renderAi(await window.api.refreshAi());
        });
    }
    const btnAiRuntime = document.getElementById('btn-ai-runtime');
    if (btnAiRuntime) btnAiRuntime.addEventListener('click', () => window.api.openAiRuntime());
    const btnAiRefresh = document.getElementById('btn-ai-refresh');
    if (btnAiRefresh) btnAiRefresh.addEventListener('click', () => refreshAi());
    const btnAiReindex = document.getElementById('btn-ai-reindex');
    if (btnAiReindex) {
        btnAiReindex.addEventListener('click', async () => {
            renderAi(await window.api.reindexAi());
            showToast(t('ai.reindexed'));
        });
    }
    const btnAiAsk = document.getElementById('btn-ai-ask');
    const aiQuestion = document.getElementById('ai-question');
    if (btnAiAsk && aiQuestion) {
        const ask = async () => {
            const question = aiQuestion.value.trim();
            if (!question) return;
            btnAiAsk.disabled = true;
            if (aiAnswer) {
                aiAnswer.hidden = false;
                aiAnswer.textContent = t('ai.thinking');
            }
            if (aiSources) aiSources.hidden = true;
            try {
                const result = await window.api.askAi(question);
                if (aiAnswer) aiAnswer.textContent = result.answer || t('ai.no_answer');
                if (aiSources && Array.isArray(result.sources) && result.sources.length) {
                    aiSources.hidden = false;
                    aiSources.innerHTML = '';
                    const title = document.createElement('strong');
                    title.textContent = t('ai.sources');
                    aiSources.appendChild(title);
                    result.sources.forEach((source) => {
                        const link = document.createElement('button');
                        link.className = 'doc-link';
                        link.textContent = source.heading ? `${source.title} / ${source.heading}` : source.title;
                        link.addEventListener('click', () => window.api.openExternal(source.url));
                        aiSources.appendChild(link);
                    });
                }
            } catch (err) {
                if (aiAnswer) aiAnswer.textContent = t('ai.no_answer');
            } finally {
                btnAiAsk.disabled = false;
            }
        };
        btnAiAsk.addEventListener('click', ask);
        aiQuestion.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') ask();
        });
    }
    window.api.onAiPullProgress((progress) => {
        if (!aiProgress || !progress) return;
        aiProgress.hidden = false;
        const percent = progress.total ? Math.round((progress.completed / progress.total) * 100) : 0;
        aiProgress.textContent = `${progress.model} ${percent}%`;
    });
    await refreshAi();

    const apiEnabled = document.getElementById('setting-api-enabled');
    const apiPort = document.getElementById('setting-api-port');
    const apiToken = document.getElementById('api-token');
    const apiBadge = document.getElementById('api-badge');
    const apiState = document.getElementById('api-state');
    const mcpBadge = document.getElementById('mcp-badge');
    const mcpState = document.getElementById('mcp-state');
    const cliBadge = document.getElementById('cli-badge');
    const cliState = document.getElementById('cli-state');
    const webhookUrl = document.getElementById('webhook-url');
    const webhookSecret = document.getElementById('webhook-secret');
    const webhookState = document.getElementById('webhook-state');

    const webhookEvents = () => [...document.querySelectorAll('[data-webhook-event]')]
        .filter((input) => input.checked)
        .map((input) => input.dataset.webhookEvent)
        .join(',');

    const renderIntegrations = (status) => {
        if (!status) return;
        const api = status.api || {};
        if (apiEnabled) apiEnabled.checked = Boolean(api.enabled);
        if (apiPort) apiPort.value = String(api.port || 18457);
        if (apiToken) apiToken.value = api.token || '';
        if (apiBadge) {
            apiBadge.textContent = api.running ? t('int.running') : t('int.stopped');
            apiBadge.classList.toggle('on', Boolean(api.running));
        }
        if (apiState) apiState.textContent = api.url || t('int.api_off');

        const mcp = status.mcp || {};
        if (mcpBadge) {
            mcpBadge.textContent = mcp.installed ? t('int.installed') : t('int.not_installed');
            mcpBadge.classList.toggle('on', Boolean(mcp.installed));
        }
        if (mcpState) mcpState.textContent = mcp.configPath || '';

        const cli = status.cli || {};
        if (cliBadge) {
            cliBadge.textContent = cli.installed ? t('int.installed') : t('int.not_installed');
            cliBadge.classList.toggle('on', Boolean(cli.installed));
        }
        if (cliState) cliState.textContent = cli.path || '';

        const webhook = status.webhook || {};
        if (webhookUrl) webhookUrl.value = webhook.url || '';
        if (webhookState) webhookState.textContent = webhook.configured ? t('int.webhook_ready') : t('int.webhook_off');
        const selected = new Set(webhook.events || []);
        document.querySelectorAll('[data-webhook-event]').forEach((input) => {
            input.checked = selected.has(input.dataset.webhookEvent);
        });
    };

    const refreshIntegrations = async () => {
        try {
            renderIntegrations(await window.api.getIntegrationStatus());
        } catch (err) {
            console.error('Failed to read integration status:', err);
        }
    };

    if (apiEnabled) {
        apiEnabled.addEventListener('change', async () => {
            const result = await window.api.setLocalApi(apiEnabled.checked, apiPort ? apiPort.value : '18457');
            if (result && result.status) renderIntegrations(result.status);
            showToast(t('toast.saved'));
        });
    }
    if (apiPort) {
        apiPort.addEventListener('change', async () => {
            if (!apiEnabled || !apiEnabled.checked) return;
            const result = await window.api.setLocalApi(true, apiPort.value);
            if (result && result.status) renderIntegrations(result.status);
        });
    }
    const btnApiCopy = document.getElementById('btn-api-copy');
    if (btnApiCopy) {
        btnApiCopy.addEventListener('click', async () => {
            if (!apiToken) return;
            await window.api.copyText(apiToken.value);
            showToast(t('int.copied'));
        });
    }
    const btnMcpInstall = document.getElementById('btn-mcp-install');
    if (btnMcpInstall) {
        btnMcpInstall.addEventListener('click', async () => {
            await window.api.installMcp();
            await refreshIntegrations();
            showToast(t('int.install_done'));
        });
    }
    const btnMcpOpen = document.getElementById('btn-mcp-open');
    if (btnMcpOpen) btnMcpOpen.addEventListener('click', () => window.api.openIntegrationConfig('mcp'));
    const btnCliInstall = document.getElementById('btn-cli-install');
    if (btnCliInstall) {
        btnCliInstall.addEventListener('click', async () => {
            await window.api.installCli();
            await refreshIntegrations();
            showToast(t('int.install_done'));
        });
    }
    const btnCliOpen = document.getElementById('btn-cli-open');
    if (btnCliOpen) btnCliOpen.addEventListener('click', () => window.api.openIntegrationConfig('cli'));
    const btnWebhookSave = document.getElementById('btn-webhook-save');
    if (btnWebhookSave) {
        btnWebhookSave.addEventListener('click', async () => {
            const inputSecret = webhookSecret ? webhookSecret.value : '';
            const result = await window.api.saveWebhook(
                webhookUrl ? webhookUrl.value : '',
                inputSecret || settings.webhook_secret || '',
                webhookEvents()
            );
            if (result && result.success) {
                if (inputSecret) settings.webhook_secret = inputSecret;
                showToast(t('int.saved'));
                await refreshIntegrations();
            } else {
                await showCustomAlert(t('int.failed'));
            }
        });
    }
    const btnWebhookTest = document.getElementById('btn-webhook-test');
    if (btnWebhookTest) {
        btnWebhookTest.addEventListener('click', async () => {
            const result = await window.api.testWebhook();
            if (webhookState) {
                webhookState.textContent = result && result.success
                    ? t('int.test_ok')
                    : t('int.test_failed');
            }
        });
    }
    await refreshIntegrations();

    const btnAboutSecurity = document.getElementById('btn-about-security');
    if (btnAboutSecurity) btnAboutSecurity.addEventListener('click', () => window.api.openExternal('https://vellium.dev/en/legal/security-disclosure'));
    const btnAboutKvkk = document.getElementById('btn-about-kvkk');
    if (btnAboutKvkk) btnAboutKvkk.addEventListener('click', () => window.api.openExternal('https://vellium.dev/en/legal/kvkk-notice'));

    if (settings.onboarding_done !== 'true' && wizardOverlay) {
        wizardIndex = 0;
        wizardOverlay.classList.add('active');
        updateWizard();
    }

    // ─── Restored settings ──────────────────────────────────────────────────
    async function reloadAfterRestore() {
        try {
            settings = await window.api.getSettings();
            profiles = await window.api.getProfiles();
        } catch (err) {
            console.error('Failed to reload restored data:', err);
        }
        applyTheme(settings.theme || 'system');
        if (themeSelect) themeSelect.value = settings.theme || 'system';
        syncCustomColorRow();
        await loadAndRenderCategories();
        loadAndRenderMaterials();
        renderProfiles(current_view);
        updateActiveProfileBadge();
        updateSidebarStats();
        await refreshCloud();
        await refreshDiagnostics();
        showToast(t('toast.restore'));
    }

    window.api.onSettingsRestored(() => {
        reloadAfterRestore().catch((err) => console.error('Failed to refresh restored state:', err));
    });

    // ─── Cross-navigation (tray, jump list, quick task) ─────────────────────
    window.api.onNavigate((view) => {
        if (!view) return;
        switchView(view);
        if (view === 'settings') activateSettingsSection('general', false);
        if (view === 'diagnostics') refreshDiagnostics();
    });

    document.getElementById('titlebar-context').textContent = t('nav.sounds');

    // Load initial categories
    await loadAndRenderCategories();
    updateSidebarStats();

    // Set initial view to first available category
    if (categories && categories.length > 0) {
        current_view = categories[0].id;
    }
    
    // Render initial materials filters & sync select tags
    loadAndRenderMaterials();

    // Render Initial View
    renderProfiles(current_view);
    updateActiveProfileBadge();
});

function switchView(view) {
    current_view = view;

    // Switching views always starts from an unfiltered list. Only the static
    // sidebar items cleared the search box; a category button left the old
    // query in place, so the new category looked empty (or half-filtered).
    const searchInput = document.getElementById('search-input');
    if (searchInput && searchInput.value !== '') {
        searchInput.value = '';
    }
    const btnClearSearch = document.getElementById('btn-clear-search');
    if (btnClearSearch) btnClearSearch.style.display = 'none';

    // Hide all views first
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    
    // Check if view matches any dynamic category id
    const isCategory = categories.some(cat => cat.id === view);
    
    if (isCategory) {
        document.getElementById('view-profiles').classList.add('active');
        renderProfiles(view);
    } else if (view === 'custom') {
        document.getElementById('view-custom').classList.add('active');
        renderProfiles('custom');
    } else {
        const targetView = document.getElementById(`view-${view}`);
        if (targetView) {
            targetView.classList.add('active');
        }
    }

    const baseView = isCategory ? 'profiles' : view;

    // Primary rail: profile categories all light up the library entry.
    document.querySelectorAll('.rail-item').forEach((button) => {
        button.classList.toggle('active', button.getAttribute('data-view') === baseView);
    });

    // Dynamic category list in the sidebar.
    document.querySelectorAll('.category-list .nav-item').forEach((button) => {
        button.classList.toggle('active', button.getAttribute('data-view') === view);
    });

    const contextKey = {
        profiles: 'nav.sound_profiles',
        custom: 'nav.import',
        settings: 'nav.settings',
        docs: 'nav.documents',
        diagnostics: 'nav.diagnostics',
        about: 'nav.about'
    }[baseView] || 'nav.sounds';
    const context = document.getElementById('titlebar-context');
    if (context) context.textContent = t(contextKey);

    const toolbar = document.getElementById('main-toolbar');
    if (toolbar) toolbar.hidden = !(baseView === 'profiles' || baseView === 'custom');
}

function renderProfiles(type = current_view) {
    let container = document.getElementById('profiles-grid');
    if (type === 'custom') {
        container = document.getElementById('custom-grid');
    }
    
    if (!container) return;
    container.innerHTML = '';

    const isCustomView = type === 'custom';

    // A category's id is the slug of the name it had when it was created. After
    // renameCategory() the id keeps its old slug while every profile's `type`
    // gets the new name, so comparing against the id made the whole view go
    // blank. Match on the category's current name instead.
    const viewCategory = categories.find((entry) => entry.id === type);
    const viewType = viewCategory ? viewCategory.name : type;

    // Read the active material filter from its stable data value.
    const activeMaterial = getActiveMaterialFilter();
    const isAllFilter = activeMaterial === ALL_MATERIALS;
    
    // Read search query
    const searchInputEl = document.getElementById('search-input');
    const query = searchInputEl ? searchInputEl.value.trim().toLowerCase() : '';
    
    // Render profile card matching either is_custom or matching normalized string of type
    const filtered = profiles.filter(p => {
        // Apply search query filter (searches in name, description, material, and switch type)
        if (query) {
            const nameMatch = (p.name || '').toLowerCase().includes(query);
            const descMatch = (p.description || '').toLowerCase().includes(query);
            const matMatch = (p.material || '').toLowerCase().includes(query);
            const typeMatch = (p.type || '').toLowerCase().includes(query);
            if (!nameMatch && !descMatch && !matMatch && !typeMatch) {
                return false;
            }
        }

        // Apply material filter
        if (!isAllFilter) {
            const pMat = (p.material || '').toUpperCase();
            if (pMat !== activeMaterial.toUpperCase()) return false;
        }

        if (isCustomView) return p.is_custom;
        const normalizedType = String(p.type || '').toLowerCase().replace(/[^a-z0-9]/g, '-');
        const normalizedView = String(viewType || '').toLowerCase().replace(/[^a-z0-9]/g, '-');
        return normalizedType === normalizedView;
    });

    filtered.forEach(p => {
        const isActive = p.id === active_profile_id;
        const card = document.createElement('div');
        card.className = `card ${isActive ? 'active' : ''}`;
        card.draggable = true;
        card.setAttribute('data-id', p.id);
        
        // Add drag & drop event listeners to handle custom profile list ordering
        card.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('text/plain', p.id);
            card.style.opacity = '0.5';
        });
        card.addEventListener('dragend', () => {
            card.style.opacity = '1';
        });
        card.addEventListener('dragover', (e) => {
            e.preventDefault();
        });
        card.addEventListener('drop', async (e) => {
            e.preventDefault();
            const draggedId = e.dataTransfer.getData('text/plain');
            if (!draggedId || draggedId === p.id) return;

            // Reorder profiles
            const draggedIdx = profiles.findIndex(x => x.id === draggedId);
            let targetIdx = profiles.findIndex(x => x.id === p.id);
            if (draggedIdx === -1 || targetIdx === -1) return;

            const temp = profiles[draggedIdx];
            profiles.splice(draggedIdx, 1);
            // Removing the dragged item shifts every later index down by one.
            // Without this adjustment the item lands one slot too far right.
            if (draggedIdx < targetIdx) targetIdx -= 1;
            profiles.splice(targetIdx, 0, temp);

            try {
                await window.api.updateProfileOrder(profiles.map(x => x.id));
            } catch (err) {
                console.error('Failed to save profile order:', err);
            }
            renderProfiles(type);
        });

        const addSoundButton = isCustomView
            ? `<button class="btn" data-action="add-sound">${escapeHtml(t('modal.add_sound_title'))}</button>`
            : '';

        card.innerHTML = `
            <div class="card-header" style="position: relative;">
                <div class="card-title">${escapeHtml(p.name)}</div>
                <div style="display: flex; align-items: center; gap: 8px;">
                    <div class="card-type">${escapeHtml(p.material || '')}</div>
                    <button class="btn-edit-profile" data-action="edit" title="${escapeHtml(t('modal.edit_title'))}" aria-label="${escapeHtml(t('modal.edit_title'))}" style="background:transparent; border:none; cursor:pointer; color:(--accent-text); display:flex; align-items:center; justify-content:center; padding: 2px;">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                            <path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4Z"></path>
                        </svg>
                    </button>
                </div>
            </div>
            <div class="card-desc">${escapeHtml(p.description || t('card.default_desc'))}</div>
            <div class="card-actions">
                <button class="btn" data-action="preview">${escapeHtml(t('btn.preview'))}</button>
                <button class="btn ${isActive ? 'primary' : ''}" data-action="activate">
                    ${escapeHtml(isActive ? t('btn.active') : t('btn.set_active'))}
                </button>
                ${addSoundButton}
            </div>
        `;
        container.appendChild(card);
    });

    if (filtered.length === 0) {
        const emptyState = document.createElement('p');
        emptyState.style.color = 'var(--text-secondary)';
        emptyState.style.gridColumn = '1/-1';
        emptyState.innerText = t('profiles.empty');
        container.appendChild(emptyState);
    }
}

function handleProfileGridClick(event) {
    const button = event.target.closest('[data-action]');
    if (!button) return;

    const card = button.closest('.card');
    const id = card ? card.getAttribute('data-id') : null;
    if (!id) return;

    const action = button.getAttribute('data-action');
    if (action === 'edit') {
        window.openEditProfileModal(id).catch((err) => console.error('Failed to open edit modal:', err));
    } else if (action === 'preview') {
        previewProfile(id).catch((err) => console.error('Failed to preview profile:', err));
    } else if (action === 'activate') {
        setActiveProfile(id).catch((err) => console.error('Failed to activate profile:', err));
    } else if (action === 'add-sound') {
        // Synchronous: just opens the modal, no promise to await.
        window.openAddSoundModal(id);
    }
}

function stopActivePreview() {
    if (!active_preview_howl) return;
    try {
        active_preview_howl.stop();
        active_preview_howl.unload();
    } catch (err) {
        // The instance may already be unloaded.
    }
    active_preview_howl = null;
}

function setPreviewVolume(volume) {
    if (!active_preview_howl) return;
    try {
        active_preview_howl.volume(volume);
    } catch (err) {
        // The preview may have ended between the check and the call.
    }
}

async function setActiveProfile(id) {
    stopActivePreview();

    const requestId = ++activation_request_id;
    const previousId = active_profile_id;
    active_profile_id = id;

    let result;
    try {
        result = await window.api.setActiveProfile(id);
    } catch (err) {
        console.error('Failed to activate profile:', err);
        result = { success: false };
    }

    // A newer activation won the race; don't touch the UI.
    if (requestId !== activation_request_id) return;

    if (!result || !result.success) {
        active_profile_id = previousId;
        await showCustomAlert(t('msg.profile_activate_failed'));
        return;
    }

    // Update card states in-place without re-rendering (preserves scroll position)
    document.querySelectorAll('.card[data-id]').forEach(card => {
        const isActive = card.getAttribute('data-id') === id;
        card.classList.toggle('active', isActive);

        // The activate button is addressed by its data-action, not by index.
        const activateBtn = card.querySelector('[data-action="activate"]');
        if (activateBtn) {
            activateBtn.classList.toggle('primary', isActive);
            activateBtn.innerText = isActive ? t('btn.active') : t('btn.set_active');
        }
    });

    updateActiveProfileBadge();

    const active = profiles.find((profile) => profile.id === id);
    if (active && settings.notifications !== 'false') {
        window.api.showNotification(t('notify.profile_title'), tf('notify.profile_body', active.name))
            .catch((err) => console.warn('Failed to show profile notification:', err));
    }
    if (settings.sound_feedback !== 'false') {
        try {
            const context = new (window.AudioContext || window.webkitAudioContext)();
            const oscillator = context.createOscillator();
            const gain = context.createGain();
            oscillator.type = 'sine';
            oscillator.frequency.value = 660;
            gain.gain.value = 0.04;
            oscillator.connect(gain);
            gain.connect(context.destination);
            oscillator.start();
            oscillator.stop(context.currentTime + 0.07);
            oscillator.onended = () => context.close().catch(() => {});
        } catch (err) {
            // Audio feedback is decorative; never block activation.
        }
    }
}

function updateActiveProfileBadge() {
    const active = profiles.find(p => p.id === active_profile_id);
    const badge = document.getElementById('active-profile-name');
    badge.innerText = active ? active.name : t('toolbar.no_profile');
    badge.title = active ? tf('tray.status_active', active.name) : t('toolbar.no_profile');
}

function updateVersionLabel() {
    const el = document.getElementById('app-version-display');
    if (el) el.innerText = app_version ? tf('about.version', app_version) : '';
    const rail = document.getElementById('rail-version');
    if (rail) rail.textContent = app_version ? `v${app_version}` : '';
    const kpi = document.getElementById('about-kpi-version');
    if (kpi) kpi.textContent = app_version ? `v${app_version}` : '-';
}

async function previewProfile(id) {
    // Stop any currently playing preview
    stopActivePreview();

    const requestId = ++preview_request_id;

    let details;
    try {
        details = await window.api.getProfileDetails(id);
    } catch (err) {
        console.error('Failed to load profile details for preview:', err);
        await showCustomAlert(t('msg.preview_failed'));
        return;
    }

    // A newer preview request (or the user stopped it) supersedes this one.
    if (requestId !== preview_request_id || !details) return;

    // Play a preview sound using Web Audio API (CORS-free via Base64 sent from Main Process)
    const playType = details.key_define_type === 'multi' ? 'multi' : 'single';
    const volume = getVolume();
    const srcPath = details.sound_base64;

    if (!srcPath) {
        console.error('Preview failed: no sound payload was provided by the main process.');
        await showCustomAlert(t('msg.preview_failed'));
        return;
    }

    // Declared before `options` so the error callbacks below never touch a
    // binding that is still in its temporal dead zone if Howler reports a
    // failure synchronously.
    let previewHowl = null;

    const options = {
        src: [srcPath],
        volume,
        html5: false, // Safe with Web Audio since we are using a Base64 data URI
        preload: true,
        onloaderror: (soundId, err) => {
            console.error('Preview load error:', err);
            releasePreview(previewHowl);
        },
        onplayerror: (soundId, err) => {
            console.error('Preview play error:', err);
            releasePreview(previewHowl);
        }
    };

    let spriteId = null;

    if (playType === 'single') {
        if (details.sound_format) options.format = [details.sound_format];

        const defines = details.defines && typeof details.defines === 'object' ? details.defines : {};
        const sprite = {};
        for (const [key, value] of Object.entries(defines)) {
            if (Array.isArray(value) && value.length >= 2) {
                sprite[key] = [value[0], value[1]];
            }
        }

        if (Object.keys(sprite).length > 0) {
            options.sprite = sprite;
            spriteId = sprite['57'] ? '57' : Object.keys(sprite)[0];
        }
    }

    previewHowl = new Howl(options);
    active_preview_howl = previewHowl;

    previewHowl.once('load', () => {
        if (requestId !== preview_request_id) {
            releasePreview(previewHowl);
            return;
        }
        // A spriteless pack plays the whole file; a sprite pack plays one sample.
        if (spriteId) previewHowl.play(spriteId);
        else previewHowl.play();
    });

    previewHowl.once('end', () => {
        releasePreview(previewHowl);
    });
}

function releasePreview(howl) {
    if (!howl) return;
    try {
        howl.unload();
    } catch (err) {
        // Already unloaded.
    }
    if (active_preview_howl === howl) active_preview_howl = null;
}

function rasterizeSvgToPng(svgUrl, size = 256) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = size;
            canvas.height = size;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, size, size);
            resolve(canvas.toDataURL('image/png'));
        };
        img.onerror = (e) => reject(new Error("Failed to load SVG for rasterization: " + svgUrl));
        img.src = svgUrl;
    });
}
