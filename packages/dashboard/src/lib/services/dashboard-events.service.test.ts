import { describe, expect, it, vi } from 'vitest';
import { consumeDashboardEventStream } from './dashboard-events.service';

function streamResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
  return new Response(stream);
}

describe('dashboard event stream parser', () => {
  it('parses fragmented and batched SSE frames while ignoring heartbeats', async () => {
    const onEvent = vi.fn();
    const onActivity = vi.fn();
    const response = streamResponse([
      'data: {"type":"rea',
      'dy"}\n\n: keepalive\n\ndata: {"type":"data-update","resource":"users"}\n\n',
    ]);

    await consumeDashboardEventStream(response, onEvent, onActivity);

    expect(onEvent.mock.calls).toEqual([
      [{ type: 'ready' }],
      [{ type: 'data-update', resource: 'users' }],
    ]);
    // Liveness is reported per read, including heartbeat-only chunks.
    expect(onActivity.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('ignores malformed or contract-invalid messages without ending the stream', async () => {
    const onEvent = vi.fn();
    const response = streamResponse([
      'data: not-json\n\ndata: {"type":"unknown"}\n\ndata: {"type":"ready"}\n\n',
    ]);

    await consumeDashboardEventStream(response, onEvent);

    expect(onEvent).toHaveBeenCalledOnce();
    expect(onEvent).toHaveBeenCalledWith({ type: 'ready' });
  });
});
