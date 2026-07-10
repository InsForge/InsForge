import type { Server } from 'http';

/**
 * Node's default keepAliveTimeout is 5 seconds, so callers that reuse idle
 * sockets on a longer interval (e.g. scheduled functions hitting PostgREST
 * through the backend) can race the server-side close and stall until their
 * own client timeout fires. headersTimeout must stay above keepAliveTimeout
 * so a request that starts on a socket about to idle out is not cut off
 * while its headers are still being read.
 */
export function applyServerTimeouts(server: Server, keepAliveTimeoutMs: number): void {
  server.keepAliveTimeout = keepAliveTimeoutMs;
  server.headersTimeout = keepAliveTimeoutMs + 1000;
}
