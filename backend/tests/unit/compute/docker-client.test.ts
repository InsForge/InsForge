import { describe, it, expect, vi } from 'vitest';

vi.mock('@/infra/config/app.config.js', () => {
  const c = { docker: { socketPath: '/nonexistent/test.sock' } };
  return { config: c, appConfig: c };
});

import {
  demuxDockerStream,
  parseLogLine,
  parseBuildStream,
  dockerConfig,
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
