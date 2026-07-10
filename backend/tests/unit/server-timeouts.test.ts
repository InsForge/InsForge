/**
 * server-timeouts.test.ts
 *
 * Unit tests for applyServerTimeouts(), which overrides Node's 5s default
 * keepAliveTimeout so long-interval keep-alive clients (e.g. scheduled
 * functions) do not reuse sockets the server has already closed.
 */

import { describe, it, expect } from 'vitest';
import { createServer, type Server } from 'http';
import { applyServerTimeouts } from '../../src/utils/server-timeouts';

function withServer(fn: (server: Server) => void) {
  const server = createServer();
  try {
    fn(server);
  } finally {
    server.close();
  }
}

describe('applyServerTimeouts', () => {
  it('sets keepAliveTimeout to the configured value', () => {
    withServer((server) => {
      applyServerTimeouts(server, 65000);
      expect(server.keepAliveTimeout).toBe(65000);
    });
  });

  it('keeps headersTimeout strictly above keepAliveTimeout', () => {
    withServer((server) => {
      applyServerTimeouts(server, 65000);
      expect(server.headersTimeout).toBeGreaterThan(server.keepAliveTimeout);
      expect(server.headersTimeout).toBe(66000);
    });
  });

  it('honors custom timeout values', () => {
    withServer((server) => {
      applyServerTimeouts(server, 120000);
      expect(server.keepAliveTimeout).toBe(120000);
      expect(server.headersTimeout).toBe(121000);
    });
  });

  it('overrides the Node default of 5000ms', () => {
    withServer((server) => {
      expect(server.keepAliveTimeout).toBe(5000);
      applyServerTimeouts(server, 65000);
      expect(server.keepAliveTimeout).not.toBe(5000);
    });
  });
});
