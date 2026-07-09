import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { MarketplaceCatalog, SecretSchema } from '@insforge/shared-schemas';

const { mockSecretService, mockGetCatalog, mockResolve4, mockResolve6 } = vi.hoisted(() => ({
  mockSecretService: {
    listSecrets: vi.fn(),
    createSecret: vi.fn(),
    updateSecret: vi.fn(),
  },
  mockGetCatalog: vi.fn(),
  mockResolve4: vi.fn(),
  mockResolve6: vi.fn(),
}));

vi.mock('../../src/services/secrets/secret.service', () => ({
  SecretService: {
    getInstance: () => mockSecretService,
  },
}));

vi.mock('../../src/services/marketplace/catalog.service', () => ({
  MarketplaceCatalogService: {
    getInstance: () => ({ getCatalog: mockGetCatalog }),
  },
}));

vi.mock('../../src/services/email/smtp-config.service', () => ({
  isPrivateIp: (ip: string) =>
    ip.startsWith('127.') || ip.startsWith('10.') || ip.startsWith('192.168.'),
}));

vi.mock('dns/promises', () => ({
  default: {
    resolve4: mockResolve4,
    resolve6: mockResolve6,
  },
}));

import { MarketplaceService } from '../../src/services/marketplace/marketplace.service';
import { AppError } from '../../src/utils/errors';

const CATALOG: MarketplaceCatalog = {
  version: 1,
  plugins: [
    {
      slug: 'resend',
      name: 'Resend',
      publisher: 'Resend',
      category: 'Messaging',
      description: 'Email',
      actions: [],
      install: {
        type: 'secret',
        secretName: 'RESEND_API_KEY',
        placeholder: 're_...',
        validation: { url: 'https://api.resend.com/domains', method: 'GET' },
      },
    },
    {
      slug: 'no-validation',
      name: 'No Validation',
      publisher: 'Acme',
      category: 'Data',
      description: 'Key stored without a provider check',
      actions: [],
      install: {
        type: 'secret',
        secretName: 'ACME_KEY',
        placeholder: 'ak_...',
      },
    },
  ],
};

function secret(overrides: Partial<SecretSchema>): SecretSchema {
  return {
    id: 'secret-1',
    key: 'RESEND_API_KEY',
    isActive: true,
    isReserved: false,
    lastUsedAt: null,
    expiresAt: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('MarketplaceService', () => {
  const service = MarketplaceService.getInstance();
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    mockGetCatalog.mockResolvedValue(CATALOG);
    mockSecretService.listSecrets.mockResolvedValue([]);
    mockSecretService.createSecret.mockResolvedValue({ id: 'new-secret' });
    mockSecretService.updateSecret.mockResolvedValue(true);
    mockResolve4.mockResolvedValue(['76.76.21.21']);
    mockResolve6.mockResolvedValue([]);
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('listPlugins', () => {
    it('marks plugins installed when an active secret with their name exists', async () => {
      mockSecretService.listSecrets.mockResolvedValue([secret({})]);

      const plugins = await service.listPlugins();

      expect(plugins.find((p) => p.slug === 'resend')?.installed).toBe(true);
      expect(plugins.find((p) => p.slug === 'no-validation')?.installed).toBe(false);
    });

    it('treats inactive secrets as not installed', async () => {
      mockSecretService.listSecrets.mockResolvedValue([secret({ isActive: false })]);

      const plugins = await service.listPlugins();

      expect(plugins.find((p) => p.slug === 'resend')?.installed).toBe(false);
    });
  });

  describe('installPlugin', () => {
    it('validates the key against the provider and creates the secret', async () => {
      await service.installPlugin('resend', 're_valid');

      expect(fetchMock).toHaveBeenCalledWith(
        new URL('https://api.resend.com/domains'),
        expect.objectContaining({
          method: 'GET',
          headers: { Authorization: 'Bearer re_valid' },
          redirect: 'error',
        })
      );
      expect(mockSecretService.createSecret).toHaveBeenCalledWith({
        key: 'RESEND_API_KEY',
        value: 're_valid',
      });
    });

    it.each([400, 401, 403])(
      'rejects an invalid key (%i) without touching secrets',
      async (status) => {
        fetchMock.mockResolvedValue(new Response(null, { status }));

        await expect(service.installPlugin('resend', 're_bad')).rejects.toMatchObject({
          statusCode: 400,
          message: 'Invalid Resend API key',
        });
        expect(mockSecretService.createSecret).not.toHaveBeenCalled();
        expect(mockSecretService.updateSecret).not.toHaveBeenCalled();
      }
    );

    it('maps provider outages to a 502 error', async () => {
      fetchMock.mockRejectedValue(new Error('socket hang up'));

      await expect(service.installPlugin('resend', 're_key')).rejects.toMatchObject({
        statusCode: 502,
      });
    });

    it('maps unexpected provider statuses to a 502 error', async () => {
      fetchMock.mockResolvedValue(new Response(null, { status: 500 }));

      await expect(service.installPlugin('resend', 're_key')).rejects.toMatchObject({
        statusCode: 502,
      });
    });

    it('skips provider validation when the plugin has no validation spec', async () => {
      await service.installPlugin('no-validation', 'ak_123');

      expect(fetchMock).not.toHaveBeenCalled();
      expect(mockSecretService.createSecret).toHaveBeenCalledWith({
        key: 'ACME_KEY',
        value: 'ak_123',
      });
    });

    it('updates the existing secret in place when one exists', async () => {
      mockSecretService.listSecrets.mockResolvedValue([secret({ isActive: false })]);

      await service.installPlugin('resend', 're_new');

      expect(mockSecretService.updateSecret).toHaveBeenCalledWith('secret-1', {
        value: 're_new',
        isActive: true,
      });
      expect(mockSecretService.createSecret).not.toHaveBeenCalled();
    });

    it('refuses to overwrite a reserved secret', async () => {
      mockSecretService.listSecrets.mockResolvedValue([secret({ isReserved: true })]);

      await expect(service.installPlugin('resend', 're_key')).rejects.toMatchObject({
        statusCode: 403,
      });
    });

    it('rejects validation endpoints that resolve to a private address', async () => {
      mockResolve4.mockResolvedValue(['127.0.0.1']);

      await expect(service.installPlugin('resend', 're_key')).rejects.toMatchObject({
        statusCode: 400,
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('404s for an unknown plugin slug', async () => {
      await expect(service.installPlugin('unknown', 'key')).rejects.toMatchObject({
        statusCode: 404,
      });
    });
  });

  describe('uninstallPlugin', () => {
    it('deactivates the plugin secret', async () => {
      mockSecretService.listSecrets.mockResolvedValue([secret({})]);

      await service.uninstallPlugin('resend');

      expect(mockSecretService.updateSecret).toHaveBeenCalledWith('secret-1', {
        isActive: false,
      });
    });

    it('404s when the plugin is not installed', async () => {
      await expect(service.uninstallPlugin('resend')).rejects.toBeInstanceOf(AppError);
      await expect(service.uninstallPlugin('resend')).rejects.toMatchObject({
        statusCode: 404,
      });
    });
  });
});
