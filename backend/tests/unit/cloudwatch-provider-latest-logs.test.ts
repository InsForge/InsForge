import { describe, it, expect, vi } from 'vitest';
import {
  DescribeLogStreamsCommand,
  GetLogEventsCommand,
  type OutputLogEvent,
} from '@aws-sdk/client-cloudwatch-logs';
import { CloudWatchProvider } from '../../src/providers/logs/cloudwatch.provider';

vi.mock('../../src/utils/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const NOW = Date.parse('2026-10-11T09:00:00.000Z');
const STREAM = 'p-us-east-2-insforge-vector';

// Serves GetLogEvents like CloudWatch with startFromHead=false: each page is the newest events before
// the token, oldest first, at most `pageSize` long; at the stream's start the token sent comes back.
function providerWith(streams: Record<string, OutputLogEvent[]>, pageSize = Infinity) {
  const getCalls: Array<{ logStreamName?: string; limit?: number; startFromHead?: boolean }> = [];
  const send = vi.fn(async (cmd: unknown) => {
    if (cmd instanceof DescribeLogStreamsCommand) {
      return { logStreams: Object.keys(streams).map((logStreamName) => ({ logStreamName })) };
    }
    if (cmd instanceof GetLogEventsCommand) {
      const { logStreamName = '', limit = 10000, startFromHead, nextToken } = cmd.input;
      getCalls.push({ logStreamName, limit, startFromHead });
      const all = streams[logStreamName] ?? [];
      const end = nextToken ? Number(nextToken.slice(2)) : all.length;
      const start = Math.max(0, end - Math.min(limit, pageSize));
      const nextBackwardToken = start === end && nextToken ? nextToken : `b/${start}`;
      return { events: all.slice(start, end), nextBackwardToken };
    }
    throw new Error(`unexpected command ${String(cmd)}`);
  });
  const provider = new CloudWatchProvider();
  Object.assign(provider, { cwClient: { send }, cwLogGroup: '/insforge/test' });
  return { provider, getCalls };
}

function event(timestamp: number, message = `at ${timestamp}`): OutputLogEvent {
  return { timestamp, message: JSON.stringify({ level: 'info', message }) };
}

const times = (logs: Array<{ timestamp: string }>) => logs.map((l) => Date.parse(l.timestamp));

describe('CloudWatchProvider.getLogsBySource latest logs', () => {
  it('returns the newest events of a busy stream in one newest-first read', async () => {
    const events = Array.from({ length: 80000 }, (_, i) => event(NOW - (80000 - i) * 1000));

    const { provider, getCalls } = providerWith({ [STREAM]: events });
    const result = await provider.getLogsBySource('insforge.logs', 100);

    expect(times(result.logs)).toEqual(events.slice(-100).map((e) => e.timestamp));
    expect(getCalls).toEqual([{ logStreamName: STREAM, limit: 100, startFromHead: false }]);
  });

  it('keeps paging backward when CloudWatch returns short pages', async () => {
    const events = Array.from({ length: 500 }, (_, i) => event(NOW - (500 - i) * 1000));

    const { provider } = providerWith({ [STREAM]: events }, 120);
    const result = await provider.getLogsBySource('insforge.logs', 200);

    expect(times(result.logs)).toEqual(events.slice(-200).map((e) => e.timestamp));
  });

  it('stops at the start of a stream once CloudWatch repeats the token', async () => {
    const { provider, getCalls } = providerWith({ [STREAM]: [event(NOW)] });
    const result = await provider.getLogsBySource('insforge.logs', 100);

    expect(times(result.logs)).toEqual([NOW]);
    expect(getCalls).toHaveLength(2);
  });

  it('gives up on a stream after five empty pages with fresh tokens', async () => {
    const { provider } = providerWith({ [STREAM]: [] });
    let token = 0;
    const send = vi.fn(async (cmd: unknown) =>
      cmd instanceof DescribeLogStreamsCommand
        ? { logStreams: [{ logStreamName: STREAM }] }
        : { events: [], nextBackwardToken: `t${token++}` }
    );
    Object.assign(provider, { cwClient: { send } });

    const result = await provider.getLogsBySource('insforge.logs', 100);

    expect(result.logs).toEqual([]);
    expect(token).toBe(5);
  });

  it('merges matching streams in time order and keeps the newest overall', async () => {
    const { provider } = providerWith({
      'old-host-insforge-vector': [event(NOW - 4000), event(NOW - 2000)],
      [STREAM]: [event(NOW - 3000), event(NOW - 1000)],
      'p-us-east-2-postgres-vector': [event(NOW)],
    });
    const result = await provider.getLogsBySource('insforge.logs', 3);

    expect(times(result.logs)).toEqual([NOW - 3000, NOW - 2000, NOW - 1000]);
  });

  it('gives lines that share a millisecond distinct ids, within and across streams', async () => {
    const { provider } = providerWith({
      [STREAM]: [event(NOW, 'secret check'), event(NOW, 'HTTP Request')],
      'old-host-insforge-vector': [event(NOW, 'other host')],
    });
    const result = await provider.getLogsBySource('insforge.logs', 100);

    expect(new Set(result.logs.map((l) => l.id)).size).toBe(3);
  });

  it('clamps limit to what GetLogEvents accepts', async () => {
    const { provider, getCalls } = providerWith({ [STREAM]: [event(NOW)] });

    await provider.getLogsBySource('insforge.logs', 0);
    const defaulted = getCalls.splice(0).map((c) => c.limit);
    await provider.getLogsBySource('insforge.logs', 50000);
    const capped = getCalls.map((c) => c.limit);

    expect(new Set(defaulted)).toEqual(new Set([100]));
    expect(new Set(capped)).toEqual(new Set([10000]));
  });
});
