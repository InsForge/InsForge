import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MarketplaceCatalog } from '@insforge/shared-schemas';

const { mockConfig } = vi.hoisted(() => ({
  mockConfig: {
    marketplace: { catalogUrl: '' },
  },
}));

vi.mock('../../src/infra/config/app.config', () => ({
  appConfig: mockConfig,
}));

vi.mock('../../src/utils/logger', () => ({
  default: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

import { MarketplaceCatalogService } from '../../src/services/marketplace/catalog.service';
import { DEFAULT_MARKETPLACE_CATALOG } from '../../src/services/marketplace/default-catalog';

const REMOTE_CATALOG: MarketplaceCatalog = {
  version: 2,
  plugins: [
    {
      slug: 'remote-plugin',
      name: 'Remote Plugin',
      publisher: 'Remote',
      category: 'Data',
      description: 'From the hosted catalog',
      actions: ['Store REMOTE_KEY as an encrypted secret'],
      install: {
        type: 'secret',
        secretName: 'REMOTE_KEY',
        placeholder: 'rk_...',
      },
    },
  ],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('MarketplaceCatalogService', () => {
  const service = MarketplaceCatalogService.getInstance();
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    service.clearCache();
    mockConfig.marketplace.catalogUrl = 'https://assets.example.com/marketplace.json';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('returns the bundled catalog without fetching when no URL is configured', async () => {
    mockConfig.marketplace.catalogUrl = '';

    const catalog = await service.getCatalog();

    expect(catalog).toEqual(DEFAULT_MARKETPLACE_CATALOG);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('serves a valid remote catalog and caches it', async () => {
    fetchMock.mockResolvedValue(jsonResponse(REMOTE_CATALOG));

    const first = await service.getCatalog();
    const second = await service.getCatalog();

    expect(first).toEqual(REMOTE_CATALOG);
    expect(second).toEqual(REMOTE_CATALOG);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refetches after the cache TTL expires', async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue(jsonResponse(REMOTE_CATALOG));

    await service.getCatalog();
    vi.advanceTimersByTime(6 * 60 * 1000);
    await service.getCatalog();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('falls back to the bundled catalog on network failure', async () => {
    fetchMock.mockRejectedValue(new Error('connect ECONNREFUSED'));

    const catalog = await service.getCatalog();

    expect(catalog).toEqual(DEFAULT_MARKETPLACE_CATALOG);
  });

  it('falls back to the bundled catalog on a non-2xx response', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, 503));

    const catalog = await service.getCatalog();

    expect(catalog).toEqual(DEFAULT_MARKETPLACE_CATALOG);
  });

  it('falls back to the bundled catalog when the payload fails schema validation', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ version: 1, plugins: [{ slug: 'broken' }] })
    );

    const catalog = await service.getCatalog();

    expect(catalog).toEqual(DEFAULT_MARKETPLACE_CATALOG);
  });

  it('does not retry an unreachable catalog URL within the TTL', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));

    const first = await service.getCatalog();
    const second = await service.getCatalog();

    expect(first).toEqual(DEFAULT_MARKETPLACE_CATALOG);
    expect(second).toEqual(DEFAULT_MARKETPLACE_CATALOG);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('serves the last cached catalog when a refetch fails', async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValueOnce(jsonResponse(REMOTE_CATALOG));

    await service.getCatalog();
    vi.advanceTimersByTime(6 * 60 * 1000);
    fetchMock.mockRejectedValueOnce(new Error('offline'));

    const catalog = await service.getCatalog();

    expect(catalog).toEqual(REMOTE_CATALOG);
  });
});
