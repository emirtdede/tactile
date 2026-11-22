'use strict';

/**
 * Brand contract:
 *  - the product stays Tactile, the developer and publisher is Vellium
 *  - every public link and address comes from one module
 *  - the renderer mirror, the installer and the docs never drift
 *  - no emoji reaches a brand surface
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const BRAND = require(path.join(ROOT, 'src', 'branding'));

const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2190}-\u{21FF}\u{2600}-\u{27BF}\u{FE0F}\u{2B00}-\u{2BFF}]/u;

test('the product name stays Tactile and the publisher is Vellium', () => {
    const pkg = require(path.join(ROOT, 'package.json'));
    assert.strictEqual(BRAND.product, 'Tactile');
    assert.strictEqual(BRAND.productSlug, 'tactile');
    assert.strictEqual(pkg.productName, 'Tactile');
    assert.strictEqual(pkg.name, 'tactile');
    assert.strictEqual(BRAND.company, 'Vellium');
    assert.ok(/Vellium/.test(BRAND.companyLegal));
    assert.strictEqual(pkg.build.appId, 'dev.vellium.tactile');
});

test('the declared brand version matches the package version', () => {
    const pkg = require(path.join(ROOT, 'package.json'));
    assert.strictEqual(BRAND.version, pkg.version);
});

test('every link is https and lives on the vellium or GitHub domains', () => {
    const links = [];
    const walk = (value) => {
        if (typeof value === 'string') {
            if (/^https?:/.test(value)) links.push(value);
            return;
        }
        if (value && typeof value === 'object') Object.values(value).forEach(walk);
    };
    walk(BRAND);
    assert.ok(links.length >= 10);
    for (const link of links) {
        assert.ok(link.startsWith('https://'), `${link} must use https`);
        assert.ok(/^https:\/\/([a-z0-9-]+\.)*(vellium\.dev|github\.com|githubusercontent\.com|linkedin\.com|x\.com|discord\.gg|apps\.microsoft\.com)($|[/?#])/.test(link), `${link} is not a known brand host`);
    }
    for (const address of Object.values(BRAND.emails)) {
        assert.ok(/^[a-z]+@vellium\.dev$/.test(address), `${address} must be a vellium.dev address`);
    }
});

test('the renderer mirrors the canonical GitHub and sponsor links', () => {
    const app = read('src/app.js');
    assert.ok(app.includes(`'${BRAND.github}'`), 'src/app.js must open the canonical repository');
    assert.ok(app.includes(`'${BRAND.sponsor}'`), 'src/app.js must open the canonical sponsor page');
    assert.ok(app.includes(BRAND.docs), 'src/app.js must link the canonical docs tree');
    assert.ok(app.includes(`'${BRAND.legal.security}'`), 'the About page must use the canonical security link');
    assert.ok(app.includes(`'${BRAND.legal.kvkk}'`), 'the About page must use the canonical KVKK link');
});

test('the About page carries the product line and no old domain', () => {
    const html = read('src/app.html');
    assert.ok(/data-i18n="brand\.product_line"/.test(html), 'the product line key must be rendered');
    assert.ok(html.includes('data-i18n="about.security"'));
    assert.ok(html.includes('data-i18n="about.kvkk"'));
    for (const file of ['src/app.html', 'src/app.js', 'src/main.js', 'src/preload.js']) {
        assert.ok(!/tecton/i.test(read(file)), `${file} must not mention the old working name`);
    }
});

test('the installer publishes the same identity as the app', () => {
    const nsh = read('build/installer.nsh');
    assert.ok(nsh.includes(`"Publisher" "${BRAND.companyLegal}"`), 'installer publisher must match branding.js');
    assert.ok(nsh.includes(`"URLInfoAbout" "${BRAND.website}"`));
    assert.ok(nsh.includes(`"URLUpdateInfo" "${BRAND.productPage}"`));
    assert.ok(nsh.includes(`"Contact" "${BRAND.emails.support}"`));
    assert.ok(nsh.includes(`"Comments" "${BRAND.product} - A ${BRAND.company} product (${BRAND.website})"`));
    assert.ok(!/apps\.microsoft\.com/.test(nsh), 'the Store certificate is deliberately out of the installer');
});

test('brand surfaces contain no emoji', () => {
    for (const file of ['src/branding.js', 'build/installer.nsh', 'docs/BRANDING.md']) {
        const text = read(file);
        assert.ok(!EMOJI.test(text), `${file} must not contain emoji`);
    }
});
