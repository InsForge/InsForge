import http from 'node:http';
import { appConfig } from '@/infra/config/app.config.js';

/**
 * Minimal Docker Engine API client over the unix socket.
 *
 * Deliberately dependency-free: node's `http` supports `socketPath` directly, and
 * the surface we need is a handful of endpoints. Adding a Docker SDK would pull a
 * large transitive tree in to save very little.
 *
 * The API is called unversioned (`/containers/...` rather than `/v1.43/...`) so
 * the daemon applies its own default version. Verified against Engine 25.0.16 and
 * 29.3.1.
 */

export class DockerHttpError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = 'DockerHttpError';
  }
}

export interface DockerRawResponse {
  status: number;
  body: Buffer;
}

/**
 * Docker settings with defaults applied.
 *
 * Optional-chained because config objects are routinely partial — test mocks
 * stub only the slice under test, and a deployment upgraded mid-release can read
 * a config built before this section existed. Reaching straight for
 * `appConfig.docker.socketPath` turns either case into an unrelated TypeError
 * deep inside provider selection; CloudComputeProvider already guards its own
 * slice the same way.
 */
export interface DockerConfig {
  socketPath: string;
  publicHost: string;
  domain: string;
  defaultIngress: string;
  bindAddress: string;
  isolateNetwork: boolean;
}

/**
 * Docker settings, read from the environment on every call.
 *
 * Environment-only, deliberately. Enabling this driver means mounting the socket in the
 * compose file, so anyone who can change these values is already editing that file —
 * a second, database-side source of truth would buy the ability to change without a
 * restart what they can set during the restart they already have to do.
 *
 * Read per call rather than captured once so a value is never stale relative to the
 * process's own configuration.
 */
export function dockerConfig(): DockerConfig {
  const c = appConfig.docker;
  return {
    socketPath: c?.socketPath ?? '/var/run/docker.sock',
    publicHost: c?.publicHost ?? '',
    domain: c?.domain ?? '',
    defaultIngress: c?.defaultIngress ?? 'none',
    bindAddress: c?.bindAddress || '127.0.0.1',
    isolateNetwork: c?.isolateNetwork ?? false,
  };
}

function socketPath(): string {
  return dockerConfig().socketPath;
}

/**
 * Issue one request and buffer the whole response.
 *
 * Returns raw bytes rather than parsed JSON because the logs endpoint returns a
 * binary framed stream, not JSON — see demuxDockerStream.
 */
export function dockerRequestRaw(
  method: string,
  path: string,
  options: {
    body?: unknown;
    /** Pre-encoded body (a build context tarball), sent as-is. */
    rawBody?: Buffer;
    contentType?: string;
    timeoutMs?: number;
  } = {}
): Promise<DockerRawResponse> {
  const payload =
    options.rawBody ??
    (options.body === undefined ? null : Buffer.from(JSON.stringify(options.body)));

  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        socketPath: socketPath(),
        path,
        method,
        headers: payload
          ? {
              'Content-Type': options.contentType ?? 'application/json',
              'Content-Length': payload.length,
            }
          : {},
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks) }));
        res.on('error', reject);
      }
    );

    // Time-box every call. The daemon is local so anything slow is a stall, and
    // the logs endpoint is polled live — a hung request must not pile up.
    req.setTimeout(options.timeoutMs ?? 30_000, () => {
      req.destroy(new Error(`Docker API request timed out: ${method} ${path}`));
    });
    req.on('error', reject);
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

/** Same, but parses JSON and throws DockerHttpError on non-2xx. */
export async function dockerRequest<T>(
  method: string,
  path: string,
  options: { body?: unknown; timeoutMs?: number } = {}
): Promise<T | undefined> {
  const res = await dockerRequestRaw(method, path, options);
  const text = res.body.toString('utf8');

  if (res.status < 200 || res.status >= 300) {
    // Docker error bodies are `{"message":"..."}`; fall back to the raw text.
    let message = text;
    try {
      const parsed = JSON.parse(text) as { message?: string };
      message = parsed.message ?? text;
    } catch {
      /* not JSON — use the raw body */
    }
    throw new DockerHttpError(res.status, `Docker API error (${res.status}): ${message}`);
  }

  return text ? (JSON.parse(text) as T) : undefined;
}

/**
 * Outcome of a `POST /build`.
 *
 * `failed` is not derived from the HTTP status: a build that fails still returns
 * **200**, with the error appended to the response body as plain JSON. Measured
 * against Engine 29.3.1 using a Dockerfile containing `RUN exit 7`:
 *
 *   {"error":"process \"/bin/sh -c exit 7\" did not complete successfully: exit code: 7",
 *    "errorDetail":{"message":"…"}}
 *
 * An implementation that trusts the status code proceeds to start a container
 * from a tag that was never produced.
 */
export interface DockerBuildResult {
  ok: boolean;
  error: string | null;
  /** Human-readable progress, when the builder produces any. See parseBuildStream. */
  logs: string[];
}

/**
 * Parse the newline-delimited JSON stream that `POST /build` returns.
 *
 * The two builders report progress in completely different shapes, both measured:
 *
 *   classic (`version=1`) → {"stream":"Step 1/3 : FROM alpine"}  — readable
 *   BuildKit (`version=2`) → {"id":"moby.buildkit.trace","aux":"<base64 protobuf>"}
 *
 * We build with the classic builder (see dockerBuild for why), so the readable form
 * is what actually arrives. The BuildKit branch is kept because it costs three lines
 * and means a future switch back — once the session or buildx path exists — degrades
 * to coarse progress instead of reporting an empty log: `aux` frames are counted, not
 * decoded, since rendering them would require protobuf and the
 * `moby.buildkit.v1.StatusResponse` schema.
 *
 * Failure detection is builder-independent: the error arrives as plain JSON at the
 * tail either way, which is why it needs none of the above.
 */
export function parseBuildStream(body: string): DockerBuildResult {
  const logs: string[] = [];
  let error: string | null = null;
  let auxFrames = 0;

  for (const line of body.split('\n')) {
    if (!line.trim()) {
      continue;
    }
    let frame: {
      stream?: string;
      error?: string;
      errorDetail?: { message?: string };
      aux?: string;
    };
    try {
      frame = JSON.parse(line) as typeof frame;
    } catch {
      // A partial trailing line on a truncated stream — not worth failing over.
      continue;
    }
    if (frame.error || frame.errorDetail?.message) {
      error = frame.errorDetail?.message ?? frame.error ?? 'Build failed';
      continue;
    }
    if (typeof frame.stream === 'string') {
      const text = frame.stream.replace(/\n$/, '');
      if (text.trim()) {
        logs.push(text);
      }
      continue;
    }
    if (frame.aux) {
      auxFrames++;
    }
  }

  if (!logs.length && auxFrames) {
    logs.push(`(BuildKit reported ${auxFrames} progress frames; per-step detail not decoded)`);
  }

  return { ok: error === null, error, logs };
}

/**
 * Stream a build context tarball to the daemon and build it.
 *
 * The body is a tar archive, which is the endpoint's native input — so a caller
 * that already has a tar can pipe straight through with no intermediate storage.
 *
 * A note for whoever produces that tar on macOS: files there carry a
 * `com.apple.provenance` extended attribute, and when bsdtar embeds it the Linux
 * daemon rejects the whole context with `lsetxattr /Dockerfile: xattr
 * "com.apple.provenance": operation not supported`.
 *
 * Observed once against Engine 29.3.1 and not reproducible on demand — whether
 * bsdtar writes the attribute into the archive varies, so this is a real failure
 * with an environment-dependent trigger rather than something every Mac hits.
 * Producing the tar with `--no-xattrs` (or `COPYFILE_DISABLE=1`) costs nothing and
 * removes the possibility; buildFromContext also recognises the error and says so.
 */
export async function dockerBuild(params: {
  context: Buffer;
  tag: string;
  dockerfile?: string;
  buildArgs?: Record<string, string>;
  timeoutMs?: number;
}): Promise<DockerBuildResult> {
  const query = new URLSearchParams({
    t: params.tag,
    dockerfile: params.dockerfile ?? 'Dockerfile',
    // **Classic builder, not BuildKit.** An earlier round chose BuildKit
    // (`version=2`) on the strength of its caching, having checked only its
    // progress format and error reporting. That comparison missed the thing that
    // decides it: measured on a fresh host with the base image absent,
    //
    //   version=2 → {"error":"nginx:alpine: no active sessions"}
    //   version=1 → builds, having pulled the base image itself
    //
    // BuildKit resolves `FROM` through the gRPC session that `docker build`
    // establishes over `/session`; a plain POST has no session, so it cannot pull
    // base images at all. It only appeared to work earlier because the test host
    // already had them cached — the same blind spot that hid the missing
    // container-create pull.
    //
    // The classic builder also happens to emit readable
    // `{"stream":"Step 1/3 : FROM alpine"}` progress, so switching improves build
    // logs rather than costing them.
    //
    // The cost is real: Docker has signalled the classic builder for removal. The
    // durable fixes are to implement the BuildKit session, or to shell out to
    // `docker buildx` and parse its output. Both are more than v1 needs, and both
    // are recorded as follow-ups rather than guessed at now.
    version: '1',
    // Remove intermediate containers so a long-lived host does not accumulate them.
    rm: '1',
  });
  if (params.buildArgs && Object.keys(params.buildArgs).length) {
    query.set('buildargs', JSON.stringify(params.buildArgs));
  }

  const res = await dockerRequestRaw('POST', `/build?${query.toString()}`, {
    rawBody: params.context,
    contentType: 'application/x-tar',
    // Builds are minutes, not seconds — the default request timeout would kill
    // any real one.
    timeoutMs: params.timeoutMs ?? 15 * 60_000,
  });

  const body = res.body.toString('utf8');
  if (res.status < 200 || res.status >= 300) {
    // A pre-stream rejection (bad context, unknown parameter) does use the status.
    return {
      ok: false,
      error: `Docker build rejected (${res.status}): ${body.slice(0, 500)}`,
      logs: [],
    };
  }
  return parseBuildStream(body);
}

/**
 * Split a Docker multiplexed stream into its frame payloads.
 *
 * For a container created without a TTY, `GET /containers/{id}/logs` returns
 * frames rather than plain text. Measured against Engine 29.3.1:
 *
 *   0100 0000 0000 0026  32303236 2d30382d ...
 *   ^^                   ^^^^^^^^^^^^^^^^^ payload ("<RFC3339Nano> line\n")
 *   |  \_ 3 bytes zero   \_ 4-byte big-endian payload length (0x26 = 38)
 *   \_ stream type: 1 = stdout, 2 = stderr
 *
 * Skipping this step yields lines prefixed with `^A^@^@^@^@^@^@&`, which is the
 * single most likely way this code silently produces garbage.
 *
 * Truncated trailing frames are ignored rather than throwing: the response is a
 * snapshot of a live stream and may end mid-frame.
 */
export function demuxDockerStream(buf: Buffer): { stream: 'stdout' | 'stderr'; text: string }[] {
  const out: { stream: 'stdout' | 'stderr'; text: string }[] = [];
  let offset = 0;

  while (offset + 8 <= buf.length) {
    const type = buf[offset];
    const length = buf.readUInt32BE(offset + 4);
    const start = offset + 8;
    const end = start + length;
    if (end > buf.length) {
      break;
    }
    out.push({
      stream: type === 2 ? 'stderr' : 'stdout',
      text: buf.subarray(start, end).toString('utf8'),
    });
    offset = end;
  }

  return out;
}

/**
 * Parse Docker's `timestamps=1` RFC3339Nano prefix.
 *
 * Both precisions are needed and for different reasons. `ms` populates the
 * response shape (epoch milliseconds, matching the Fly provider). `nanos` is the
 * forward cursor: the `since` query parameter only accepts **integer seconds**,
 * so second granularity cannot be the dedup key — 50 lines inside one second
 * would be re-fetched on every poll, and dropping by second would discard the
 * genuinely new ones. See DockerProvider.getLogs.
 */
export function parseLogLine(text: string): { ms: number; nanos: bigint; message: string } | null {
  const space = text.indexOf(' ');
  if (space === -1) {
    return null;
  }
  const ts = text.slice(0, space);
  const message = text.slice(space + 1).replace(/\n$/, '');

  const ms = Date.parse(ts);
  if (Number.isNaN(ms)) {
    return null;
  }

  // Recover full nanosecond precision, which Date.parse truncates to ms.
  const dot = ts.indexOf('.');
  let nanos: bigint;
  if (dot === -1) {
    nanos = BigInt(Math.trunc(ms / 1000)) * 1_000_000_000n;
  } else {
    const secs = BigInt(Math.trunc(Date.parse(`${ts.slice(0, dot)}Z`) / 1000));
    const frac = ts.slice(dot + 1).replace(/[^0-9]/g, '');
    nanos = secs * 1_000_000_000n + BigInt(frac.padEnd(9, '0').slice(0, 9));
  }

  return { ms, nanos, message };
}
