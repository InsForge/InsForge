import type { MarketplaceCatalog } from '@insforge/shared-schemas';

// Bundled fallback catalog, used when MARKETPLACE_CATALOG_URL is unset or the
// hosted marketplace.json is unreachable/invalid. Also the initial content to
// provision to S3 — keep it valid against marketplaceCatalogSchema.
export const DEFAULT_MARKETPLACE_CATALOG: MarketplaceCatalog = {
  version: 1,
  plugins: [
    {
      slug: 'resend',
      name: 'Resend',
      publisher: 'Resend',
      category: 'Messaging',
      description: 'Send transactional email from functions with domains and templates.',
      actions: [
        'Validate your key with Resend',
        'Store RESEND_API_KEY as an encrypted secret',
        'Expose it to edge functions as an env var',
      ],
      iconUrl: 'https://cdn.simpleicons.org/resend',
      install: {
        type: 'secret',
        secretName: 'RESEND_API_KEY',
        placeholder: 're_...',
        // Resend send-only restricted keys 401 on /domains and are rejected;
        // full-access keys are required to install.
        validation: {
          url: 'https://api.resend.com/domains',
          method: 'GET',
        },
      },
      docsUrl: 'https://resend.com/docs/api-reference/introduction',
    },
  ],
};
