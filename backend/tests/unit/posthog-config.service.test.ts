import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  PostHogConfigService,
  POSTHOG_CONNECTION_SECRET,
  type StoredPosthogConnection,
} from '../../src/services/analytics/posthog-config.service.js';

vi.mock('../../src/utils/logger.js', () => ({
  default: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

const PERSONAL_KEY = 'phx_AaBbCcDdEeFfGgHhIiJjKkLlMmNn';

function connection(overrides: Partial<StoredPosthogConnection> = {}): StoredPosthogConnection {
  return {
    personalApiKey: PERSONAL_KEY,
    host: 'https://us.posthog.com',
    posthogProjectId: '12345',
    apiKey: 'phc_public',
    organizationName: 'Acme',
    projectName: 'Web',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeStore(initial: string | null = null) {
  const state = { value: initial, rows: [] as { key: string; id: string; isActive: boolean }[] };
  if (initial !== null) {
    state.rows.push({ key: POSTHOG_CONNECTION_SECRET, id: 'secret-1', isActive: true });
  }
  return {
    state,
    createSecret: vi.fn(async ({ key, value }: { key: string; value: string }) => {
      state.value = value;
      state.rows.push({ key, id: 'secret-1', isActive: true });
      return { id: 'secret-1' };
    }),
    getSecretByKey: vi.fn(async () => state.value),
    listSecrets: vi.fn(async () => state.rows.map((r) => ({ ...r, createdAt: 'now' })) as never),
    updateSecret: vi.fn(async (_id: string, input: { value?: string }) => {
      if (input.value !== undefined) state.value = input.value;
      return true;
    }),
    deleteReservedSecretByKey: vi.fn(async () => {
      const had = state.value !== null;
      state.value = null;
      state.rows.length = 0;
      return had;
    }),
  };
}

describe('PostHogConfigService', () => {
  let store: ReturnType<typeof makeStore>;
  let service: PostHogConfigService;

  beforeEach(() => {
    store = makeStore();
    service = new PostHogConfigService(store as never);
  });

  it('reports not-configured when nothing is stored', async () => {
    const config = await service.getConfig();
    expect(config.personalApiKey).toEqual({ configured: false, maskedKey: null });
    expect(config.host).toBeNull();
    expect(config.posthogProjectId).toBeNull();
  });

  it('stores the connection as a single reserved secret', async () => {
    await service.setConnection({
      personalApiKey: PERSONAL_KEY,
      host: 'https://eu.posthog.com',
      posthogProjectId: '999',
      apiKey: 'phc_pub',
      organizationName: 'Org',
      projectName: 'Proj',
    });

    expect(store.createSecret).toHaveBeenCalledTimes(1);
    const arg = store.createSecret.mock.calls[0][0] as { key: string; isReserved: boolean };
    expect(arg.key).toBe(POSTHOG_CONNECTION_SECRET);
    // Reserved keeps the row out of reach of the generic secrets routes, so the
    // credential can only be changed through connect/disconnect.
    expect(arg.isReserved).toBe(true);
  });

  it('never exposes the raw personal key through getConfig', async () => {
    await service.setConnection(connection());
    const config = await service.getConfig();

    expect(config.personalApiKey.configured).toBe(true);
    expect(config.personalApiKey.maskedKey).not.toContain('CcDdEeFfGgHhIiJjKkLl');
    expect(config.personalApiKey.maskedKey).toContain('••••');
    expect(JSON.stringify(config)).not.toContain(PERSONAL_KEY);
  });

  it('round-trips the connection metadata', async () => {
    await service.setConnection(connection());
    const config = await service.getConfig();

    expect(config.host).toBe('https://us.posthog.com');
    expect(config.posthogProjectId).toBe('12345');
    expect(config.projectName).toBe('Web');
    expect(config.organizationName).toBe('Acme');
  });

  it('takes over an existing row instead of creating a second one', async () => {
    await service.setConnection(connection());
    await service.setConnection(connection({ posthogProjectId: '54321' }));

    expect(store.createSecret).toHaveBeenCalledTimes(1);
    expect(store.updateSecret).toHaveBeenCalledTimes(1);
    // Clearing expiry matters: a stale expires_at makes getSecretByKey() stop
    // matching the row that was just written.
    expect(store.updateSecret.mock.calls[0][1]).toMatchObject({
      isActive: true,
      isReserved: true,
      expiresAt: null,
    });
    expect((await service.getConfig()).posthogProjectId).toBe('54321');
  });

  it('disconnect clears the connection and is idempotent', async () => {
    await service.setConnection(connection());
    await service.deleteConnection();
    expect((await service.getConfig()).personalApiKey.configured).toBe(false);

    await expect(service.deleteConnection()).resolves.toBeUndefined();
  });

  // The duplicate reaches this service as the AppError createSecret translates
  // 23505 into (code SECRET_ALREADY_EXISTS), not as the raw Postgres error.
  it('recovers a lost first-connect race by taking over the winning row', async () => {
    store.createSecret.mockImplementationOnce(async () => {
      // The concurrent winner's row appears between findSecret and createSecret.
      store.state.value = JSON.stringify(connection({ posthogProjectId: 'winner' }));
      store.state.rows.push({ key: POSTHOG_CONNECTION_SECRET, id: 'secret-1', isActive: true });
      const err = new Error('Secret already exists') as Error & { code: string };
      err.code = 'SECRET_ALREADY_EXISTS';
      throw err;
    });

    const config = await service.setConnection(connection({ posthogProjectId: 'loser' }));

    expect(store.updateSecret).toHaveBeenCalledTimes(1);
    expect(config.posthogProjectId).toBe('loser');
  });

  it('does not report success when the takeover update fails', async () => {
    store.createSecret.mockImplementationOnce(async () => {
      store.state.value = JSON.stringify(connection());
      store.state.rows.push({ key: POSTHOG_CONNECTION_SECRET, id: 'secret-1', isActive: true });
      const err = new Error('Secret already exists') as Error & { code: string };
      err.code = 'SECRET_ALREADY_EXISTS';
      throw err;
    });
    store.updateSecret.mockResolvedValueOnce(false);

    await expect(service.setConnection(connection())).rejects.toThrow(/Failed to update/);
  });

  it('rethrows non-duplicate create failures untouched', async () => {
    store.createSecret.mockRejectedValueOnce(new Error('connection refused'));

    await expect(service.setConnection(connection())).rejects.toThrow('connection refused');
    expect(store.updateSecret).not.toHaveBeenCalled();
  });

  it('disconnect throws when the row survives the delete', async () => {
    await service.setConnection(connection());
    store.deleteReservedSecretByKey.mockResolvedValueOnce(false);

    await expect(service.deleteConnection()).rejects.toThrow(/Failed to delete/);
  });

  it('treats an unparsable stored row as not connected', async () => {
    store = makeStore('not json at all');
    service = new PostHogConfigService(store as never);

    await expect(service.getConnection()).resolves.toBeNull();
  });

  it('treats a row missing required fields as not connected', async () => {
    store = makeStore(JSON.stringify({ personalApiKey: PERSONAL_KEY }));
    service = new PostHogConfigService(store as never);

    await expect(service.getConnection()).resolves.toBeNull();
  });

  it('serves reads from cache and re-reads after a write', async () => {
    store = makeStore(JSON.stringify(connection()));
    service = new PostHogConfigService(store as never);

    await service.getConnection();
    await service.getConnection();
    expect(store.getSecretByKey).toHaveBeenCalledTimes(1);

    await service.deleteConnection();
    await service.getConnection();
    expect(store.getSecretByKey).toHaveBeenCalledTimes(2);
  });
});
