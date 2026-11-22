# Brand identity

Tactile is a Vellium product. The product name, the publisher and every public
link live in `src/branding.js`, and the About page, the installer, the README and
the docs all read from it.

## Naming

| Element | Value |
| --- | --- |
| Product | Tactile |
| Publisher | Vellium |
| Legal entity | Vellium Teknoloji Anonim Şirketi |
| Product line | A Vellium product |
| Copyright | Copyright (c) 2026 Vellium. All rights reserved. |
| License | MIT |

The executable, the Start menu shortcut, the tray tooltip, the window title and
the data folder all use the product name. The publisher name appears in About,
the file version information, the installer publisher field and the Store
package identity.

## Links

| Purpose | URL |
| --- | --- |
| Website | https://vellium.dev |
| Product page | https://vellium.dev/en/products/tactile |
| Repository | https://github.com/emirtdede/tactile |
| Issues | https://github.com/emirtdede/tactile/issues |
| Releases | https://github.com/emirtdede/tactile/releases |
| Sponsor | https://github.com/sponsors/emirtdede |
| Documentation | https://github.com/emirtdede/tactile/tree/main/docs |
| Security | https://vellium.dev/en/legal/security-disclosure |
| KVKK notice | https://vellium.dev/en/legal/kvkk-notice |

E-mail addresses use the `vellium.dev` domain:

- contact@vellium.dev
- support@vellium.dev
- privacy@vellium.dev
- legal@vellium.dev
- security@vellium.dev

## Surfaces

- About page: product line, publisher card, GitHub and Sponsor buttons, legal
  rows and the copyright footer.
- Second sidebar (About): GitHub, Sponsor and Documentation shortcuts.
- Title bar: product mark, product name, current view and the three Windows
  window controls (minimize, maximize, close).
- Installer: product name, publisher, install and uninstall branding from
  `build/installer.nsh`, including the setup wizard icon and the language picker.
- Store package: publisher display name `Vellium`, identity `TactileApp`.

## Rules

- No emoji anywhere in the interface, locales, installer or docs.
- No logo or language leakage: every locale file covers the same key set and
  the rendered page carries no English fallback text.
- One source of truth: a new link or e-mail address is added to
  `src/branding.js` first, then referenced from the UI.
- Brand names are not translated. Everything else is.

## Verification

`tools/tests/i18n.test.js` enforces the language and emoji rules, and the
consistency suite checks that the About surfaces still expose GitHub and Sponsor
actions. `tools/build-icons.js` produces the window, tray and installer icons
from the same source mark.
