// Applies the last known palette and light/dark preference before the first
// paint so the window never flashes the default theme while settings load.
// app.js refreshes both values from the database a moment later.
(function bootTheme() {
    var palette = 'obsidian';
    var dark = null;
    try {
        palette = localStorage.getItem('tactile.theme-palette') || 'obsidian';
        dark = localStorage.getItem('tactile.theme-dark');
    } catch (err) {
        // localStorage can be unavailable under a locked profile; the defaults
        // above keep the window usable.
    }
    if (dark === null) {
        dark = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'true' : 'false';
    }
    document.documentElement.dataset.theme = palette;
    document.documentElement.classList.toggle('dark', dark === 'true');
})();
