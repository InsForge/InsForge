/**
 * server-timeouts.test.ts
 *
 * Unit tests for applyServerTimeouts(), which overrides Node's 5s default
 * keepAliveTimeout so long-interval keep-alive clients (e.g. scheduled
 * functions) do not reuse sockets the server has already closed.
 */

import { describe, it, expect } from 'vitest';
import { createServer } from 'http';
import { applyServerTimeouts } from '../../src/utils/server-timeouts';

describe('applyServerTimeouts', () => {
  it('sets keepAliveTimeout to the configured value', () => {
    const server = createServer();
    applyServerTimeouts(server, 65000);
    expect(server.keepAliveTimeout).toBe(65000);
  });

  it('keeps headersTimeout strictly above keepAliveTimeout', () => {
    const server = createServer();
    applyServerTimeouts(server, 65000);
    expect(server.headersTimeout).toBeGreaterThan(server.keepAliveTimeout);
    expect(server.headersTimeout).toBe(66000);
  });

  it('honors custom timeout values', () => {
    const server = createServer();
    applyServerTimeouts(server, 120000);
    expect(server.keepAliveTimeout).toBe(120000);
    expect(server.headersTimeout).toBe(121000);
  });

  it('raises keepAliveTimeout above the Node default', () => {
    const server = createServer();
    const nodeDefault = server.keepAliveTimeout;
    applyServerTimeouts(server, nodeDefault + 60000);
    expect(server.keepAliveTimeout).toBe(nodeDefault + 60000);
    expect(server.keepAliveTimeout).toBeGreaterThan(nodeDefault);
  });
});
