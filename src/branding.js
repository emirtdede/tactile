// Single source of truth for the product and publisher identity.
//
// Tactile is a Vellium product. Every link, e-mail address and legal reference
// in the app, the installer, the README and the docs comes from here (or from
// the mirror in src/app.js, which tools/tests/branding.test.js keeps in sync),
// so a change never leaves one surface on an old domain.
const BRAND = {
    product: 'Tactile',
    productSlug: 'tactile',
    tagline: 'Mechanical keyboard sounds that make typing a pleasure.',
    version: '1.1.0',

    company: 'Vellium',
    companyLegal: 'Vellium Teknoloji Anonim Şirketi',
    copyright: 'Copyright (c) 2026 Vellium. All rights reserved.',

    website: 'https://vellium.dev',
    productPage: 'https://vellium.dev/en/products/tactile',
    storeUrl: 'https://apps.microsoft.com/detail/9NQJTP1BKP5R',
    storeSigningIncluded: false,

    github: 'https://github.com/emirtdede/tactile',
    issues: 'https://github.com/emirtdede/tactile/issues',
    releases: 'https://github.com/emirtdede/tactile/releases',
    sponsor: 'https://github.com/sponsors/emirtdede',
    funding: 'https://vellium.dev/sponsor',
    docs: 'https://github.com/emirtdede/tactile/tree/main/docs',
    security: 'https://vellium.dev/en/legal/security-disclosure',

    emails: {
        contact: 'contact@vellium.dev',
        support: 'support@vellium.dev',
        privacy: 'privacy@vellium.dev',
        legal: 'legal@vellium.dev',
        security: 'security@vellium.dev'
    },

    legal: {
        company: 'https://vellium.dev/en/legal/company-information',
        privacy: 'https://vellium.dev/en/legal/privacy',
        terms: 'https://vellium.dev/en/legal/terms',
        support: 'https://vellium.dev/en/legal/support',
        security: 'https://vellium.dev/en/legal/security-disclosure',
        kvkk: 'https://vellium.dev/en/legal/kvkk-notice'
    },

    social: {
        githubOrg: 'https://github.com/VelliumHQ',
        linkedin: 'https://www.linkedin.com/company/vellium/',
        x: 'https://x.com/VelliumDev',
        discord: 'https://discord.gg/ur9KBZBEdj'
    }
};

module.exports = BRAND;
