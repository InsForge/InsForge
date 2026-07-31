import { dashboardEventSchema, type DashboardEvent } from '@insforge/shared-schemas';
import { apiClient } from '#lib/api/client';

function parseEventBlock(block: string): DashboardEvent | null {
  const data = block
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n');

  if (!data) {
    return null;
  }

  try {
    const result = dashboardEventSchema.safeParse(JSON.parse(data));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

export async function consumeDashboardEventStream(
  response: Response,
  onEvent: (event: DashboardEvent) => void,
  onActivity?: () => void
): Promise<void> {
  if (!response.body) {
    throw new Error('Dashboard event stream did not include a response body');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      // Any received bytes count as liveness, including heartbeat comments
      // that never surface as events.
      onActivity?.();
      buffer += decoder.decode(value, { stream: !done });

      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = blocks.pop() ?? '';
      for (const block of blocks) {
        const event = parseEventBlock(block);
        if (event) {
          onEvent(event);
        }
      }

      if (done) {
        const event = parseEventBlock(buffer);
        if (event) {
          onEvent(event);
        }
        return;
      }
    }
  } finally {
    // Release the connection when the loop exits abnormally (abort, handler
    // throw); a no-op after the stream already ended.
    await reader.cancel().catch(() => undefined);
  }
}

export async function connectDashboardEventStream(
  signal: AbortSignal,
  onEvent: (event: DashboardEvent) => void,
  onActivity?: () => void
): Promise<void> {
  const response = await apiClient.requestStream('/dashboard/events', {
    headers: { Accept: 'text/event-stream' },
    signal,
  });
  await consumeDashboardEventStream(response, onEvent, onActivity);
}
