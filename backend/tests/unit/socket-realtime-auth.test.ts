import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import type { RealtimeAuthPayload, RealtimeAuthResponse } from '@insforge/shared-schemas';

const TEST_JWT_SECRET = 'test-secret-long-enough-for-signing-32chars';

vi.mock('@/utils/logger.js', () => ({
  default: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@/services/secrets/secret.service.js', () => ({
  SecretService: {
    getInstance: () => ({ verifyApiKey: vi.fn(), verifyAnonKey: vi.fn() }),
  },
}));

vi.mock('@/services/realtime/realtime-auth.service.js', () => ({
  RealtimeAuthService: {
    getInstance: () => ({ checkSubscribePermission: vi.fn() }),
  },
}));

vi.mock('@/services/realtime/realtime-message.service.js', () => ({
  RealtimeMessageService: {
    getInstance: () => ({ insertMessage: vi.fn() }),
  },
}));

vi.mock('@/services/realtime/realtime-presence.service.js', () => ({
  RealtimePresenceService: {
    getInstance: () => ({
      trackMember: vi.fn(),
      removeSocketFromRoom: vi.fn(),
      removeSocketFromAllRooms: vi.fn(() => []),
      clear: vi.fn(),
    }),
  },
}));

interface FakeSocket {
  id: string;
  data: { user?: { id: string; email?: string; role?: string } };
}

type AuthHandler = (
  socket: FakeSocket,
  payload: RealtimeAuthPayload,
  ack?: (response: RealtimeAuthResponse) => void
) => void;

async function loadHandler(): Promise<{ handleRealtimeAuth: AuthHandler; manager: object }> {
  vi.stubEnv('JWT_SECRET', TEST_JWT_SECRET);
  const { SocketManager } = await import('../../src/infra/socket/socket.manager');
  const manager = SocketManager.getInstance();
  const handleRealtimeAuth = (
    manager as unknown as { handleRealtimeAuth: AuthHandler }
  ).handleRealtimeAuth.bind(manager) as AuthHandler;
  return { handleRealtimeAuth, manager };
}

function userToken(sub: string, role = 'authenticated', expiresInSeconds = 900): string {
  return jwt.sign({ sub, email: `${sub}@example.com`, role }, TEST_JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: expiresInSeconds,
  });
}

function connectedSocket(userId = 'user-1'): FakeSocket {
  return {
    id: 'socket-1',
    data: { user: { id: userId, email: `${userId}@example.com`, role: 'authenticated' } },
  };
}

describe('SocketManager realtime:auth', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('accepts a refreshed token for the same subject and updates the socket claims', async () => {
    const { handleRealtimeAuth } = await loadHandler();
    const socket = connectedSocket('user-1');
    const ack = vi.fn();

    handleRealtimeAuth(socket, { token: userToken('user-1', 'project_admin') }, ack);

    expect(ack).toHaveBeenCalledWith({ ok: true });
    expect(socket.data.user).toEqual({
      id: 'user-1',
      email: 'user-1@example.com',
      role: 'project_admin',
    });
  });

  it('rejects a token for a different subject without touching the socket claims', async () => {
    const { handleRealtimeAuth } = await loadHandler();
    const socket = connectedSocket('user-1');
    const original = { ...socket.data.user };
    const ack = vi.fn();

    handleRealtimeAuth(socket, { token: userToken('user-2') }, ack);

    expect(ack).toHaveBeenCalledWith({
      ok: false,
      error: expect.objectContaining({ code: 'REALTIME_UNAUTHORIZED' }),
    });
    expect(socket.data.user).toEqual(original);
  });

  it('rejects an expired token', async () => {
    const { handleRealtimeAuth } = await loadHandler();
    const socket = connectedSocket('user-1');
    const ack = vi.fn();

    handleRealtimeAuth(socket, { token: userToken('user-1', 'authenticated', -10) }, ack);

    expect(ack).toHaveBeenCalledWith({
      ok: false,
      error: expect.objectContaining({ code: 'AUTH_INVALID_CREDENTIALS' }),
    });
  });

  it('rejects a malformed token', async () => {
    const { handleRealtimeAuth } = await loadHandler();
    const socket = connectedSocket('user-1');
    const ack = vi.fn();

    handleRealtimeAuth(socket, { token: 'not-a-jwt' }, ack);

    expect(ack).toHaveBeenCalledWith({
      ok: false,
      error: expect.objectContaining({ code: 'AUTH_INVALID_CREDENTIALS' }),
    });
  });
});
