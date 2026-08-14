import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/infra/config/app.config.js', () => {
  const c = { docker: { socketPath: '/nonexistent/test.sock' } };
  return { config: c, appConfig: c };
});

// The transport is a parameter, so the paging logic is testable without mocking this module
// into itself — which cannot work, since a module's internal calls bind to its own real
// exports.
const mockRaw = vi.fn();

import {
  demuxDockerStream,
  parseLogLine,
  parseBuildStream,
  dockerConfig,
  dockerContainerLogs,
} from '@/providers/compute/docker.client.js';

/**
 * Builds a Docker multiplexed frame: 1-byte stream type, 3 zero bytes, then a
 * 4-byte big-endian payload length. Byte layout verified against Engine 29.3.1 —
 * a real stdout frame started `0100 0000 0000 0026` for a 38-byte payload.
 */
function frame(text: string, stream: 1 | 2 = 1): Buffer {
  const payload = Buffer.from(text, 'utf8');
  const header = Buffer.alloc(8);
  header[0] = stream;
  header.writeUInt32BE(payload.length, 4);
  return Buffer.concat([header, payload]);
}

describe('demuxDockerStream', () => {
  it('strips the 8-byte header that would otherwise prefix every line', () => {
    const buf = frame('2026-08-06T22:51:32.781160549Z line-1\n');
    const out = demuxDockerStream(buf);

    expect(out).toHaveLength(1);
    expect(out[0].stream).toBe('stdout');
    expect(out[0].text).toBe('2026-08-06T22:51:32.781160549Z line-1\n');
    // The failure mode this guards against: leaking header bytes into the text.
    // Written as an escape rather than a literal control character so an editor
    // or formatter cannot silently eat it and make the assertion vacuous.
    expect(out[0].text).not.toContain('\x01');
    expect(out[0].text.charCodeAt(0)).toBe('2'.charCodeAt(0));
  });

  it('reads consecutive frames and distinguishes stdout from stderr', () => {
    const buf = Buffer.concat([frame('one\n', 1), frame('two\n', 2), frame('three\n', 1)]);
    expect(demuxDockerStream(buf).map((f) => [f.stream, f.text.trim()])).toEqual([
      ['stdout', 'one'],
      ['stderr', 'two'],
      ['stdout', 'three'],
    ]);
  });

  // The response is a snapshot of a live stream, so it can end mid-frame.
  // Dropping the partial tail beats throwing away the whole batch.
  it('ignores a truncated trailing frame', () => {
    const buf = Buffer.concat([frame('complete\n'), frame('cut off here\n').subarray(0, 11)]);
    const out = demuxDockerStream(buf);
    expect(out).toHaveLength(1);
    expect(out[0].text.trim()).toBe('complete');
  });

  it('returns nothing for an empty body', () => {
    expect(demuxDockerStream(Buffer.alloc(0))).toEqual([]);
  });
});

describe('parseLogLine', () => {
  it('splits the RFC3339Nano prefix from the message', () => {
    const parsed = parseLogLine('2026-08-06T22:51:32.781160549Z hello world');
    expect(parsed?.message).toBe('hello world');
    expect(parsed?.ms).toBe(Date.parse('2026-08-06T22:51:32.781Z'));
  });

  // Full nanosecond precision is what makes the forward cursor correct: `since`
  // only accepts integer seconds, so ms-truncated timestamps would collapse
  // distinct lines inside one millisecond and re-deliver or drop them.
  it('preserves nanoseconds that Date.parse would truncate', () => {
    const a = parseLogLine('2026-08-06T22:51:32.781160549Z first');
    const b = parseLogLine('2026-08-06T22:51:32.781160550Z second');
    expect(a!.nanos).toBe(1786056692781160549n);
    expect(b!.nanos - a!.nanos).toBe(1n);
    // Both round to the same millisecond — hence the separate nanos field.
    expect(a!.ms).toBe(b!.ms);
  });

  it('handles a timestamp with no fractional part', () => {
    const parsed = parseLogLine('2026-08-06T22:51:32Z plain');
    expect(parsed?.nanos).toBe(1786056692000000000n);
    expect(parsed?.message).toBe('plain');
  });

  it('keeps spaces inside the message and strips only the trailing newline', () => {
    expect(parseLogLine('2026-08-06T22:51:32.000000000Z a b  c\n')?.message).toBe('a b  c');
  });

  it('returns null for a line with no timestamp rather than fabricating one', () => {
    expect(parseLogLine('no-timestamp-here')).toBeNull();
    expect(parseLogLine('')).toBeNull();
  });
});

describe('parseBuildStream', () => {
  // The failure mode that matters: a failed build still returns HTTP 200, with the
  // error appended to the body. Trusting the status code means starting a
  // container from a tag that was never produced.
  it('reports failure from the stream body, not the status code', () => {
    const body = [
      '{"stream":"Step 1/2 : FROM alpine"}',
      '{"stream":"Step 2/2 : RUN exit 7"}',
      '{"error":"process \\"/bin/sh -c exit 7\\" did not complete successfully: exit code: 7",' +
        '"errorDetail":{"message":"process \\"/bin/sh -c exit 7\\" did not complete successfully: exit code: 7"}}',
    ].join('\n');

    const result = parseBuildStream(body);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('exit code: 7');
  });

  it('collects readable progress from the classic builder', () => {
    const body = [
      '{"stream":"Step 1/3 : FROM alpine"}',
      '{"stream":"\\n"}',
      '{"stream":" ---\\u003e 28bd5fe8b56d\\n"}',
      '{"stream":"Successfully built abc123\\n"}',
    ].join('\n');

    const result = parseBuildStream(body);
    expect(result.ok).toBe(true);
    expect(result.error).toBeNull();
    expect(result.logs).toContain('Step 1/3 : FROM alpine');
    expect(result.logs).toContain('Successfully built abc123');
    // Blank frames are dropped rather than padding the log with empty lines.
    expect(result.logs.every((l) => l.trim().length > 0)).toBe(true);
  });

  // BuildKit's progress is base64 protobuf, which we deliberately do not decode.
  // Counting the frames keeps the response honest without the dependency.
  it('summarises BuildKit aux frames instead of decoding them', () => {
    const body = [
      '{"id":"moby.buildkit.trace","aux":"Cm8KR3NoYTI1Njo5NWUx"}',
      '{"id":"moby.buildkit.trace","aux":"Cn0KR3NoYTI1Njo5NWUx"}',
    ].join('\n');

    const result = parseBuildStream(body);
    expect(result.ok).toBe(true);
    expect(result.logs).toHaveLength(1);
    expect(result.logs[0]).toContain('2 progress frames');
  });

  it('succeeds on an empty stream rather than inventing a failure', () => {
    expect(parseBuildStream('')).toEqual({ ok: true, error: null, logs: [] });
  });

  it('ignores a truncated trailing line', () => {
    const body = '{"stream":"Step 1/1 : FROM alpine"}\n{"stream":"partial';
    const result = parseBuildStream(body);
    expect(result.ok).toBe(true);
    expect(result.logs).toEqual(['Step 1/1 : FROM alpine']);
  });
});

describe('dockerConfig', () => {
  // Config objects are routinely partial (test mocks stub one slice), and
  // reaching straight for appConfig.docker.socketPath turned that into an
  // unrelated TypeError inside provider selection.
  it('applies documented defaults for fields the config omits', () => {
    const c = dockerConfig();
    expect(c.socketPath).toBe('/nonexistent/test.sock');
    expect(c.defaultIngress).toBe('none');
    expect(c.bindAddress).toBe('127.0.0.1');
    expect(c.isolateNetwork).toBe(false);
    expect(c.publicHost).toBe('');
  });
});

describe('dockerContainerLogs', () => {
  // Call indexes are asserted below, so the transport cannot carry calls in from the test
  // before — which is exactly what made two of these fail once they moved here.
  beforeEach(() => {
    mockRaw.mockReset();
  });

  it('demuxes frames and returns a nanosecond watermark as the cursor', async () => {
    mockRaw.mockResolvedValueOnce({
      status: 200,
      body: Buffer.concat([
        frame('2026-08-06T22:51:32.781160549Z line-1\n'),
        frame('2026-08-06T22:51:33.785353049Z line-2\n'),
      ]),
    });

    const result = await dockerContainerLogs('container-abc', undefined, mockRaw);

    expect(result.lines).toEqual([
      { timestamp: Date.parse('2026-08-06T22:51:32.781Z'), message: 'line-1' },
      { timestamp: Date.parse('2026-08-06T22:51:33.785Z'), message: 'line-2' },
    ]);
    // Cursor carries full nanosecond precision, not the millisecond timestamp.
    expect(result.nextToken).toBe('1786056693785353049');
  });

  // `since` accepts integer seconds only and is inclusive, so the boundary
  // second is always re-delivered. Dedup therefore has to happen against the
  // nanosecond watermark — filtering by second would drop genuinely new lines
  // that share a second with the previous batch.
  it('floors the cursor to seconds on the wire but dedupes by nanosecond', async () => {
    mockRaw.mockResolvedValueOnce({
      status: 200,
      body: Buffer.concat([
        frame('2026-08-06T22:51:33.100000000Z already-seen\n'),
        frame('2026-08-06T22:51:33.200000000Z also-seen\n'),
        frame('2026-08-06T22:51:33.300000000Z brand-new\n'),
      ]),
    });

    const result = await dockerContainerLogs(
      'container-abc',
      {
        nextToken: '1786056693200000000', // the .2 line
      },
      mockRaw
    );

    // Same second as the watermark, but later — must survive.
    expect(result.lines.map((l) => l.message)).toEqual(['brand-new']);
    expect(result.nextToken).toBe('1786056693300000000');

    const url = mockRaw.mock.calls[0][1] as string;
    expect(url).toContain('since=1786056693');
    expect(url).toContain('timestamps=1');
  });

  it('treats an unreadable cursor as absent rather than failing the request', async () => {
    mockRaw.mockResolvedValueOnce({
      status: 200,
      body: frame('2026-08-06T22:51:32.000000000Z hello\n'),
    });
    const result = await dockerContainerLogs('container-abc', { nextToken: 'garbage' }, mockRaw);
    expect(result.lines.map((l) => l.message)).toEqual(['hello']);
    expect(mockRaw.mock.calls[0][1]).not.toContain('since=');
  });

  it('returns a null cursor when there is nothing to page from', async () => {
    mockRaw.mockResolvedValueOnce({ status: 200, body: Buffer.alloc(0) });
    const result = await dockerContainerLogs('container-abc', undefined, mockRaw);
    expect(result).toEqual({ lines: [], nextToken: null });
  });

  // `tail` keeps the newest N. Pairing it with `since` would return the newest
  // N of the backlog and then advance the cursor past everything older, which
  // no later request could reach — the middle of the backlog would be gone.
  it('asks for a tail on the first page but not when resuming from a cursor', async () => {
    mockRaw.mockResolvedValueOnce({ status: 200, body: Buffer.alloc(0) });
    await dockerContainerLogs('container-abc', { limit: 50 }, mockRaw);
    expect(mockRaw.mock.calls[0][1]).toContain('tail=50');

    mockRaw.mockResolvedValueOnce({ status: 200, body: Buffer.alloc(0) });
    await dockerContainerLogs(
      'container-abc',
      {
        limit: 50,
        nextToken: '1786056693200000000',
      },
      mockRaw
    );
    const resumed = mockRaw.mock.calls[1][1] as string;
    expect(resumed).toContain('since=1786056693');
    expect(resumed).not.toContain('tail=');
  });

  // `tail` is an integer on the wire. The compute route clamps its query value with
  // Math.min/max, which leaves a decimal intact, and `tail=5.7` makes the daemon reject
  // the whole request — so the page a caller asked for would come back as a 502.
  it('floors the limit, because tail does not take a decimal', async () => {
    mockRaw.mockResolvedValueOnce({ status: 200, body: Buffer.alloc(0) });
    await dockerContainerLogs('container-abc', { limit: 5.7 }, mockRaw);
    // The exact parameter value, not a substring: `tail=5` is a prefix of `tail=5.7`, so
    // toContain passed with the floor removed — the first version of this test proved
    // nothing.
    const url = new URL(`http://d${mockRaw.mock.calls[0][1] as string}`);
    expect(url.searchParams.get('tail')).toBe('5');
  });

  /**
   * Mock what the daemon would actually send for a given request, so the mock
   * cannot assert a shape the real thing never produces: `tail=N` returns the
   * *newest* N, and `since` alone returns everything after that second.
   */
  function daemonLogs(lines: { nanos: string; message: string }[]) {
    return (_method: string, url: string) => {
      const params = new URLSearchParams(url.split('?')[1] ?? '');
      let out = lines;
      const since = params.get('since');
      if (since !== null) {
        out = out.filter((l) => BigInt(l.nanos) / 1_000_000_000n >= BigInt(since));
      }
      const tail = params.get('tail');
      if (tail !== null) {
        out = out.slice(-Number(tail));
      }
      const iso = (nanos: string) => {
        const ns = BigInt(nanos);
        const ms = new Date(Number(ns / 1_000_000n)).toISOString().replace('Z', '');
        return `${ms.slice(0, 19)}.${String(ns % 1_000_000_000n).padStart(9, '0')}Z`;
      };
      return Promise.resolve({
        status: 200,
        body: Buffer.concat(out.map((l) => frame(`${iso(l.nanos)} ${l.message}\n`))),
      });
    };
  }

  // One second apart, so every `since` boundary lands on a distinct line.
  const FIVE_LINES = Array.from({ length: 5 }, (_, i) => ({
    nanos: String(1786056700000000000n + BigInt(i) * 1_000_000_000n),
    message: `line-${i}`,
  }));

  // First page asks for `tail`, so the daemon hands back the newest `limit` —
  // "most recent logs" is what a caller with no cursor wants.
  it('returns the newest lines on a first page, per `tail` semantics', async () => {
    mockRaw.mockImplementationOnce(daemonLogs(FIVE_LINES));

    const first = await dockerContainerLogs('container-abc', { limit: 2 }, mockRaw);

    expect(first.lines.map((l) => l.message)).toEqual(['line-3', 'line-4']);
    expect(first.nextToken).toBe(FIVE_LINES[4].nanos);
  });

  // Resuming sends no `tail`, so the daemon returns the whole backlog and the
  // trimming happens here. This is the only path where more lines arrive than
  // were asked for, and the property under test is that paging reaches them all
  // rather than jumping to the newest.
  it('pages through a backlog larger than `limit` without skipping lines', async () => {
    const seen: string[] = [];
    let token: string | null = null;

    // Start from before the first line so the whole backlog is "new".
    token = String(BigInt(FIVE_LINES[0].nanos) - 1_000_000_000n);
    for (let page = 0; page < 3; page++) {
      mockRaw.mockImplementationOnce(daemonLogs(FIVE_LINES));
      const res = await dockerContainerLogs(
        'container-abc',
        {
          limit: 2,
          nextToken: token as string,
        },
        mockRaw
      );
      seen.push(...res.lines.map((l) => l.message));
      token = res.nextToken;
    }

    // Every line, in order, once — the failure this guards against is pages of
    // ['line-3','line-4'] repeating while 0-2 are never delivered.
    expect(seen).toEqual(['line-0', 'line-1', 'line-2', 'line-3', 'line-4']);
  });
});
