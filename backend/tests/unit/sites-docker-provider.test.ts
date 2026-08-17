import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { hostname, tmpdir } from 'node:os';
import path from 'node:path';
import { extract as tarExtract } from 'tar-stream';
import { Readable } from 'node:stream';
import { createServer } from 'node:net';

const staging = await mkdtemp(path.join(tmpdir(), 'insforge-sites-'));
// The readiness timeout, shortened for the one test that has to wait it out. At the real
// 60s that single test was 95% of this suite's runtime.
process.env.SITES_SERVER_READY_TIMEOUT_MS = '500';
process.env.SITES_SERVER_PROBE_INTERVAL_MS = '10';

const configMock = {
  cloud: { projectId: 'proj-1234567890ab', apiHost: 'https://cloud.test' },
  app: { jwtSecret: 's'.repeat(32), logLevel: 'error' },
  server: { logsDir: path.join(staging, 'logs') },
  deployments: { sitesDomain: '', sitesStagingDir: staging, sitesPort: 0 },
  docker: { socketPath: '/nonexistent/test.sock' },
};
vi.mock('@/infra/config/app.config.js', () => ({ config: configMock, appConfig: configMock }));

const dockerBuild = vi.fn();
const dockerRequest = vi.fn();
const dockerClientConfig = {
  socketPath: '/nonexistent/test.sock',
  publicHost: '',
  domain: '',
  defaultIngress: 'port',
  bindAddress: '127.0.0.1',
  isolateNetwork: false,
};
const dockerRequestRaw = vi.fn(async () => ({ status: 200, body: Buffer.alloc(0) }));
// Its own seam rather than a hand-rolled stream: the paging is the compute client's, tested
// there, and a partial mock cannot intercept a module's calls to itself anyway.
const dockerContainerLogs = vi.fn(async () => ({ lines: [], nextToken: null }));
vi.mock('@/providers/compute/docker.client.js', () => ({
  dockerContainerLogs: (...args: unknown[]) => dockerContainerLogs(...args),
  dockerConfig: () => dockerClientConfig,
  dockerBuild: (...args: unknown[]) => dockerBuild(...args),
  dockerRequest: (...args: unknown[]) => dockerRequest(...args),
  // The readiness probe and the log tail go through these, and leaving them out of the mock
  // made every server test wait out its timeout instead of failing on an assertion.
  dockerRequestRaw: (...args: unknown[]) => dockerRequestRaw(...args),
  demuxDockerStream: () => [],
}));
vi.mock('@/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { DockerSitesProvider } = await import('@/providers/deployments/docker.provider.js');

const savedProfile = process.env.AWS_INSTANCE_PROFILE_NAME;
const savedAppKey = process.env.APP_KEY;

/**
 * A real unix socket, because the driver checks for one rather than for any path: a
 * regular file at DOCKER_SOCKET_PATH would register the driver and then fail every call.
 */
const socketPath = path.join(staging, 'docker.sock');
const socketServer = createServer();
await new Promise<void>((resolve) => socketServer.listen(socketPath, resolve));

function mountSocket(): void {
  dockerClientConfig.socketPath = socketPath;
}

/** Entries inside the tar the driver handed to the builder, name -> contents. */
async function contextFiles(context: Buffer): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  const extract = tarExtract();
  extract.on('entry', (header, stream, next) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    stream.on('end', () => {
      files.set(header.name, Buffer.concat(chunks).toString('utf8'));
      next();
    });
    stream.resume();
  });
  await new Promise<void>((resolve, reject) => {
    extract.on('finish', resolve);
    extract.on('error', reject);
    Readable.from(context).pipe(extract);
  });
  return files;
}

async function contextEntries(context: Buffer): Promise<string[]> {
  return [...(await contextFiles(context)).keys()];
}

/** Entry headers from the tar the driver handed to the builder, name -> header. */
async function contextHeaders(context: Buffer): Promise<Map<string, { mtime?: Date }>> {
  const headers = new Map<string, { mtime?: Date }>();
  const extract = tarExtract();
  extract.on('entry', (header, stream, next) => {
    headers.set(header.name, { mtime: header.mtime });
    stream.on('end', () => next());
    stream.resume();
  });
  await new Promise<void>((resolve, reject) => {
    extract.on('finish', resolve);
    extract.on('error', reject);
    Readable.from(context).pipe(extract);
  });
  return headers;
}

/** The Dockerfile the driver generated for this call. */
async function generatedDockerfile(): Promise<string> {
  const context = dockerBuild.mock.calls[0][0].context as Buffer;
  return (await contextFiles(context)).get('Dockerfile') ?? '';
}

function okBuild() {
  dockerBuild.mockResolvedValue({ ok: true, logs: ['Step 1/3 : FROM caddy:alpine'] });
}

/** create -> start -> (stop previous) is the whole write path. */
function dockerHappyPath(previous: { Id: string }[] = []) {
  dockerRequest.mockImplementation((method: string, url: string) => {
    if (method === 'GET' && url.startsWith('/containers/json')) {
      return Promise.resolve(previous);
    }
    if (method === 'POST' && url.startsWith('/containers/create')) {
      return Promise.resolve({ Id: 'container-new' });
    }
    if (method === 'GET' && url.endsWith('/json')) {
      return Promise.resolve({
        NetworkSettings: { Ports: { '80/tcp': [{ HostPort: '49154' }] } },
      });
    }
    return Promise.resolve(undefined);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // The provider is a singleton and caches the project network on first resolve, so without
  // this the one test that resolves a network hands every later test a NetworkingConfig it
  // never asked for — and the suite silently depends on its own order.
  (DockerSitesProvider.getInstance() as unknown as { ownNetwork: string | null }).ownNetwork = null;
  // Namespaces containers, images and the advertised hostname. Per-instance, so two
  // InsForge deployments sharing one daemon cannot touch each other's site containers.
  process.env.APP_KEY = 'appkey01';
  dockerClientConfig.socketPath = '/nonexistent/test.sock';
  dockerClientConfig.defaultIngress = 'port';
  dockerClientConfig.publicHost = '';
  configMock.deployments.sitesDomain = '';
  // Restored like every other toggled field: the driver branches on this for both the
  // switch order and the port binding, so a test after the fixed-port one would silently
  // inherit stop-before-start.
  configMock.deployments.sitesPort = 0;
  delete process.env.AWS_INSTANCE_PROFILE_NAME;
});

afterAll(async () => {
  socketServer.close();
  if (savedAppKey === undefined) {
    delete process.env.APP_KEY;
  } else {
    process.env.APP_KEY = savedAppKey;
  }
  if (savedProfile === undefined) {
    delete process.env.AWS_INSTANCE_PROFILE_NAME;
  } else {
    process.env.AWS_INSTANCE_PROFILE_NAME = savedProfile;
  }
  await rm(staging, { recursive: true, force: true });
});

describe('DockerSitesProvider.isConfigured', () => {
  it('needs a socket', () => {
    const provider = DockerSitesProvider.getInstance();
    expect(provider.isConfigured()).toBe(false);

    mountSocket();
    expect(provider.isConfigured()).toBe(true);
  });

  // Hosting customer containers on shared infrastructure is a tenant escape, so a
  // reachable socket must not be enough on our own hardware.
  it('refuses on our infrastructure even with a socket', () => {
    mountSocket();
    process.env.AWS_INSTANCE_PROFILE_NAME = 'EC2-role';

    expect(DockerSitesProvider.getInstance().isConfigured()).toBe(false);
  });
});

describe('DockerSitesProvider uploads', () => {
  it('stages content addressed by its sha and reports it back', async () => {
    const provider = DockerSitesProvider.getInstance();

    const sha = await provider.uploadFile(Buffer.from('<h1>hi</h1>'));

    // sha1 of the content, which is the protocol the callers and the files table use.
    expect(sha).toMatch(/^[a-f0-9]{40}$/);
    const { readFile } = await import('node:fs/promises');
    await expect(readFile(path.join(staging, sha), 'utf8')).resolves.toBe('<h1>hi</h1>');
  });

  // The sha is the filename, so an unchecked one is a path traversal.
  it('refuses a sha that is not a sha', async () => {
    const provider = DockerSitesProvider.getInstance();

    await expect(
      provider.uploadFileStream({
        content: Readable.from('x'),
        sha: '../../etc/passwd',
        size: 1,
      })
    ).rejects.toThrow('Invalid file sha');
  });
});

describe('DockerSitesProvider.createDeploymentWithFiles', () => {
  it('builds a context of the site plus the generated config, then runs it', async () => {
    okBuild();
    dockerHappyPath();
    const provider = DockerSitesProvider.getInstance();
    const files = await provider.uploadFiles([
      { path: 'index.html', content: Buffer.from('<h1>a</h1>') },
      { path: 'assets/app.js', content: Buffer.from('console.log(1)') },
    ]);

    const deployment = await provider.createDeploymentWithFiles(files);

    const context = dockerBuild.mock.calls[0][0].context as Buffer;
    expect(await contextEntries(context)).toEqual([
      'Dockerfile',
      'Caddyfile',
      'site/index.html',
      'site/assets/app.js',
    ]);
    // The generated config is what makes a client-side-routed app work at all.
    const caddyfile = (await contextFiles(context)).get('Caddyfile') ?? '';
    // Both shapes: a directory index and a .html sibling before the SPA fallback, or
    // every subpage of a multi-page export answers with the home page.
    expect(caddyfile).toContain('try_files {path} {path}/index.html {path}.html /index.html');
    expect(caddyfile).toContain('encode zstd gzip');
    // Not `header /index.html`: that matches the requested path, so `/` — the URL
    // everybody actually visits — would carry no cache header at all.
    expect(caddyfile).toContain('@html not path_regexp');
    expect(caddyfile).toContain('header @html Cache-Control "no-cache"');
    expect(deployment.id).toBe('container-new');
    expect(deployment.readyState).toBe('READY');
  });

  // The new container answers before the old one stops, so a reload mid-deploy gets one
  // of the two rather than a connection refused.
  it('starts the new container before stopping the previous one', async () => {
    okBuild();
    dockerHappyPath([{ Id: 'container-old' }]);
    const provider = DockerSitesProvider.getInstance();
    const files = await provider.uploadFiles([
      { path: 'index.html', content: Buffer.from('<h1>b</h1>') },
    ]);

    await provider.createDeploymentWithFiles(files);

    const writes = dockerRequest.mock.calls
      .filter(([method]) => method === 'POST')
      .map(([, url]) => url as string);
    expect(writes[0]).toContain('/containers/create');
    expect(writes[1]).toBe('/containers/container-new/start');
    expect(writes[2]).toBe('/containers/container-old/stop?t=5');
  });

  it('removes a container that will not start rather than leaving it deployable', async () => {
    okBuild();
    dockerRequest.mockImplementation((method: string, url: string) => {
      if (method === 'GET' && url.startsWith('/containers/json')) {
        return Promise.resolve([]);
      }
      if (method === 'POST' && url.startsWith('/containers/create')) {
        return Promise.resolve({ Id: 'container-doomed' });
      }
      if (url.endsWith('/start')) {
        return Promise.reject(new Error('no such image'));
      }
      return Promise.resolve(undefined);
    });
    const provider = DockerSitesProvider.getInstance();
    const files = await provider.uploadFiles([
      { path: 'index.html', content: Buffer.from('<h1>c</h1>') },
    ]);

    await expect(provider.createDeploymentWithFiles(files)).rejects.toThrow('no such image');

    expect(dockerRequest).toHaveBeenCalledWith('DELETE', '/containers/container-doomed?force=true');
  });

  it('surfaces the builder’s own message when the build fails', async () => {
    dockerBuild.mockResolvedValue({ ok: false, error: 'COPY failed: no such file', logs: [] });
    dockerHappyPath();
    const provider = DockerSitesProvider.getInstance();
    const files = await provider.uploadFiles([
      { path: 'index.html', content: Buffer.from('<h1>d</h1>') },
    ]);

    await expect(provider.createDeploymentWithFiles(files)).rejects.toThrow(
      'COPY failed: no such file'
    );
    expect(dockerRequest).not.toHaveBeenCalledWith(
      'POST',
      expect.stringContaining('/containers/create'),
      expect.anything()
    );
  });

  // Callers upload a whole tree because Vercel builds it; without honouring this the
  // driver would publish src/ and package.json as though they were the website.
  it('narrows the tree to outputDirectory and strips the prefix', async () => {
    okBuild();
    dockerHappyPath();
    const provider = DockerSitesProvider.getInstance();
    const files = await provider.uploadFiles([
      { path: 'package.json', content: Buffer.from('{}') },
      { path: 'src/main.tsx', content: Buffer.from('render()') },
      { path: 'dist/index.html', content: Buffer.from('<h1>e</h1>') },
      { path: 'dist/assets/app.js', content: Buffer.from('console.log(2)') },
    ]);

    await provider.createDeploymentWithFiles(files, {
      projectSettings: { outputDirectory: 'dist' },
    });

    const context = dockerBuild.mock.calls[0][0].context as Buffer;
    expect(await contextEntries(context)).toEqual([
      'Dockerfile',
      'Caddyfile',
      'site/index.html',
      'site/assets/app.js',
    ]);
  });

  // A typo'd directory that quietly published the source would look like a successful
  // deploy of the wrong thing, which is worse than refusing.
  it('refuses when outputDirectory matches nothing', async () => {
    okBuild();
    dockerHappyPath();
    const provider = DockerSitesProvider.getInstance();
    const files = await provider.uploadFiles([
      { path: 'index.html', content: Buffer.from('<h1>f</h1>') },
    ]);

    await expect(
      provider.createDeploymentWithFiles(files, { projectSettings: { outputDirectory: 'buidl' } })
    ).rejects.toThrow('No uploaded files are under "buidl"');
    expect(dockerBuild).not.toHaveBeenCalled();
  });
});

describe('DockerSitesProvider endpoint', () => {
  it('reads back the ephemeral host port under port ingress', async () => {
    okBuild();
    dockerHappyPath();
    dockerClientConfig.publicHost = 'sites.example.com';
    const provider = DockerSitesProvider.getInstance();
    const files = await provider.uploadFiles([
      { path: 'index.html', content: Buffer.from('<h1>g</h1>') },
    ]);

    const deployment = await provider.createDeploymentWithFiles(files);

    expect(deployment.url).toBe('http://sites.example.com:49154');
  });

  // Guessing the host's address would hand out a URL that does not resolve.
  it('returns no url when no public host is configured', async () => {
    okBuild();
    dockerHappyPath();
    const provider = DockerSitesProvider.getInstance();
    const files = await provider.uploadFiles([
      { path: 'index.html', content: Buffer.from('<h1>h</h1>') },
    ]);

    expect((await provider.createDeploymentWithFiles(files)).url).toBeNull();
  });

  it('advertises the hostname under host ingress and leaves routing to the operator', async () => {
    okBuild();
    dockerHappyPath();
    dockerClientConfig.defaultIngress = 'host';
    configMock.deployments.sitesDomain = 'sites.example.com';
    const provider = DockerSitesProvider.getInstance();
    const files = await provider.uploadFiles([
      { path: 'index.html', content: Buffer.from('<h1>i</h1>') },
    ]);

    const deployment = await provider.createDeploymentWithFiles(files);

    expect(deployment.url).toBe('https://appkey01.sites.example.com');
  });
});

describe('DockerSitesProvider source builds', () => {
  it('generates a two-stage build that discards the toolchain', async () => {
    okBuild();
    dockerHappyPath();
    const provider = DockerSitesProvider.getInstance();
    const files = await provider.uploadFiles([
      { path: 'package.json', content: Buffer.from('{"name":"app"}') },
      { path: 'src/main.tsx', content: Buffer.from('render()') },
    ]);

    await provider.createDeploymentWithFiles(files, {
      projectSettings: { buildCommand: 'npm run build', outputDirectory: 'dist' },
    });

    const dockerfile = await generatedDockerfile();
    expect(dockerfile).toContain('FROM node:22-alpine AS build');
    expect(dockerfile).toContain('RUN npm ci --no-audit --no-fund');
    expect(dockerfile).toContain('RUN npm run build');
    // Serving stage starts from Caddy, so node_modules never reaches what runs.
    expect(dockerfile).toContain('FROM caddy:alpine');
    expect(dockerfile).toContain('COPY --from=build /out/ /srv/');
    // In build mode the whole tree has to reach the builder — outputDirectory names
    // where the build writes, it does not narrow the upload.
    expect(await contextEntries(dockerBuild.mock.calls[0][0].context as Buffer)).toContain(
      'site/src/main.tsx'
    );
  });

  it('honours a custom install command and root directory', async () => {
    okBuild();
    dockerHappyPath();
    const provider = DockerSitesProvider.getInstance();
    const files = await provider.uploadFiles([
      { path: 'apps/web/package.json', content: Buffer.from('{}') },
    ]);

    await provider.createDeploymentWithFiles(files, {
      projectSettings: {
        buildCommand: 'pnpm build',
        installCommand: 'pnpm install --frozen-lockfile',
        rootDirectory: 'apps/web',
        outputDirectory: 'dist',
      },
    });

    const dockerfile = await generatedDockerfile();
    expect(dockerfile).toContain('WORKDIR /app/apps/web');
    expect(dockerfile).toContain('RUN pnpm install --frozen-lockfile');
    expect(dockerfile).toContain('cp -r "/app/apps/web/dist" /out');
  });

  // Guessing which conventional directory holds the output is fine; guessing that a build
  // happened at all is not — hence a failure when none of them exists.
  it('falls back to the conventional output directories and fails loudly when none exists', async () => {
    okBuild();
    dockerHappyPath();
    const provider = DockerSitesProvider.getInstance();
    const files = await provider.uploadFiles([
      { path: 'package.json', content: Buffer.from('{}') },
    ]);

    await provider.createDeploymentWithFiles(files, {
      projectSettings: { buildCommand: 'npm run build' },
    });

    const dockerfile = await generatedDockerfile();
    expect(dockerfile).toContain('for d in dist build out');
    expect(dockerfile).toContain('exit 1');
  });

  // Values are declared per stage or the daemon drops them silently.
  it('passes env vars as declared build args', async () => {
    okBuild();
    dockerHappyPath();
    const provider = DockerSitesProvider.getInstance();
    const files = await provider.uploadFiles([
      { path: 'package.json', content: Buffer.from('{}') },
    ]);

    await provider.createDeploymentWithFiles(files, {
      projectSettings: { buildCommand: 'npm run build', outputDirectory: 'dist' },
      envVars: [
        { key: 'VITE_API_URL', value: 'https://api.example.com' },
        { key: 'VITE_FLAG', value: 'on' },
      ],
    });

    expect(await generatedDockerfile()).toContain('ARG VITE_API_URL\nARG VITE_FLAG');
    expect(dockerBuild.mock.calls[0][0].buildArgs).toEqual({
      VITE_API_URL: 'https://api.example.com',
      VITE_FLAG: 'on',
    });
  });

  // A newline would end the RUN instruction and let the value append its own Dockerfile
  // directives — a different privilege from running a command in the build container.
  it('refuses a build command that would inject Dockerfile directives', async () => {
    okBuild();
    dockerHappyPath();
    const provider = DockerSitesProvider.getInstance();
    const files = await provider.uploadFiles([
      { path: 'package.json', content: Buffer.from('{}') },
    ]);

    await expect(
      provider.createDeploymentWithFiles(files, {
        projectSettings: { buildCommand: 'npm run build\nUSER root\nRUN cat /etc/shadow' },
      })
    ).rejects.toThrow('must be a single line');
    expect(dockerBuild).not.toHaveBeenCalled();
  });

  it('refuses paths that climb out of the uploaded tree', async () => {
    okBuild();
    dockerHappyPath();
    const provider = DockerSitesProvider.getInstance();
    const files = await provider.uploadFiles([
      { path: 'package.json', content: Buffer.from('{}') },
    ]);

    await expect(
      provider.createDeploymentWithFiles(files, {
        projectSettings: { buildCommand: 'npm run build', rootDirectory: '../../etc' },
      })
    ).rejects.toThrow('must be a path inside the uploaded files');
  });

  it('refuses an env var name that is not one', async () => {
    okBuild();
    dockerHappyPath();
    const provider = DockerSitesProvider.getInstance();
    const files = await provider.uploadFiles([
      { path: 'package.json', content: Buffer.from('{}') },
    ]);

    await expect(
      provider.createDeploymentWithFiles(files, {
        projectSettings: { buildCommand: 'npm run build', outputDirectory: 'dist' },
        envVars: [{ key: 'BAD NAME; rm -rf /', value: 'x' }],
      })
    ).rejects.toThrow('not a usable environment variable name');
  });

  // Serving a source tree verbatim looks like a successful deploy of a broken site: the
  // browser downloads package.json and an index.html pointing at /src/main.tsx.
  it('refuses a source tree when no build command was given', async () => {
    okBuild();
    dockerHappyPath();
    const provider = DockerSitesProvider.getInstance();
    const files = await provider.uploadFiles([
      { path: 'package.json', content: Buffer.from('{}') },
      { path: 'src/main.tsx', content: Buffer.from('render()') },
    ]);

    await expect(provider.createDeploymentWithFiles(files)).rejects.toThrow(
      'look like a source tree'
    );
    expect(dockerBuild).not.toHaveBeenCalled();
  });

  // A built site that happens to ship its package.json is still a built site.
  it('serves a built tree that contains an index.html alongside a manifest', async () => {
    okBuild();
    dockerHappyPath();
    const provider = DockerSitesProvider.getInstance();
    const files = await provider.uploadFiles([
      { path: 'package.json', content: Buffer.from('{}') },
      { path: 'index.html', content: Buffer.from('<h1>built</h1>') },
    ]);

    await expect(provider.createDeploymentWithFiles(files)).resolves.toMatchObject({
      readyState: 'READY',
    });
  });
});

describe('DockerSitesProvider redeploying identical content', () => {
  // Retention keeps the previous containers, so a digest-only name collided with one that
  // still existed: Docker 409, the row recorded ERROR, and the operator saw a 500 for
  // "deploy again with no changes" — a plausible thing to do.
  it('creates a second container rather than colliding on the name', async () => {
    okBuild();
    dockerHappyPath();
    const provider = DockerSitesProvider.getInstance();
    const files = await provider.uploadFiles([
      { path: 'index.html', content: Buffer.from('<h1>same bytes</h1>') },
    ]);

    await provider.createDeploymentWithFiles(files);
    const firstCreate = dockerRequest.mock.calls.find(
      ([method, url]) => method === 'POST' && String(url).startsWith('/containers/create')
    )?.[1] as string;
    dockerRequest.mockClear();
    dockerBuild.mockClear();
    okBuild();
    dockerHappyPath();

    await provider.createDeploymentWithFiles(files);
    const secondCreate = dockerRequest.mock.calls.find(
      ([method, url]) => method === 'POST' && String(url).startsWith('/containers/create')
    )?.[1] as string;

    expect(firstCreate).not.toBe(secondCreate);
    // Same content, so the image tag is reused and the build is a cache hit.
    expect(dockerBuild.mock.calls[0][0].tag).toMatch(/^insforge-site-appkey01:[a-f0-9]{12}$/);
  });
});

describe('DockerSitesProvider rollback and retention', () => {
  /** Owned containers as Docker would list them, newest first. */
  // `State` matters, not just the ids: retention keeps stopped deployments, so recovery has
  // to tell "this was serving" from "this is a rollback target sitting there".
  function owned(ids: string[], image = 'insforge-site-appkey01:aaa', state = 'exited') {
    return ids.map((Id) => ({ Id, State: state, Image: image }));
  }

  // Rolling back to the deployment that is already live, or double-submitting a rollback.
  // Docker answers 304 to `start` on a running container; when that counted as an error the
  // recovery path stopped the target and had nothing to restart, so an operation that should
  // be a no-op took the site down.
  it('survives a rollback to the deployment that is already live', async () => {
    configMock.deployments.sitesPort = 7160;
    dockerRequest.mockImplementation((method: string, url: string) => {
      if (method === 'GET' && url.startsWith('/containers/json')) {
        return Promise.resolve([
          { Id: 'container-live', State: 'running', Image: 'insforge-site-appkey01:aaa' },
          { Id: 'container-old', State: 'exited', Image: 'insforge-site-appkey01:old' },
        ]);
      }
      if (url.endsWith('/json')) {
        return Promise.resolve({
          Id: 'container-live',
          Created: new Date().toISOString(),
          State: { Status: 'running' },
          Config: { Image: 'insforge-site-appkey01:aaa', Labels: {} },
          NetworkSettings: { Ports: { '80/tcp': [{ HostPort: '7160' }] } },
        });
      }
      // The real daemon returns 304 here, which dockerRequest now resolves as undefined.
      return Promise.resolve(undefined);
    });

    const restored = await DockerSitesProvider.getInstance().rollbackTo('container-live');

    expect(restored.readyState).toBe('READY');
    const stops = dockerRequest.mock.calls
      .filter(([method, url]) => method === 'POST' && String(url).includes('/stop'))
      .map(([, url]) => url as string);
    // The live container must not be among the things this stopped.
    expect(stops).not.toContain('/containers/container-live/stop?t=5');
  });

  it('starts the target and stops everything else', async () => {
    dockerRequest.mockImplementation((method: string, url: string) => {
      if (method === 'GET' && url.startsWith('/containers/json')) {
        return Promise.resolve([
          ...owned(['container-live'], undefined, 'running'),
          ...owned(['container-old']),
        ]);
      }
      if (url.endsWith('/json')) {
        return Promise.resolve({
          Id: 'container-old',
          Name: '/insforge-site',
          Created: '2026-08-13T00:00:00Z',
          State: { Status: 'running' },
          Config: { Image: 'insforge-site-appkey01:aaa' },
          NetworkSettings: { Ports: { '80/tcp': [{ HostPort: '49155' }] } },
        });
      }
      return Promise.resolve(undefined);
    });

    const restored = await DockerSitesProvider.getInstance().rollbackTo('container-old');

    const writes = dockerRequest.mock.calls
      .filter(([method]) => method === 'POST')
      .map(([, url]) => url as string);
    expect(writes[0]).toBe('/containers/container-old/start');
    expect(writes[1]).toBe('/containers/container-live/stop?t=5');
    expect(restored.readyState).toBe('READY');
  });

  // Retention removes old containers, so "roll back to that one" can genuinely be gone —
  // and a Docker 404 is not something an operator should have to decode.
  it('says the deployment is gone rather than surfacing a Docker 404', async () => {
    dockerRequest.mockImplementation((method: string, url: string) =>
      method === 'GET' && url.startsWith('/containers/json')
        ? Promise.resolve(owned(['container-live']))
        : Promise.resolve(undefined)
    );

    await expect(DockerSitesProvider.getInstance().rollbackTo('container-ancient')).rejects.toThrow(
      'no longer on this host'
    );
  });

  it('keeps the newest few deployments and removes the rest with their images', async () => {
    okBuild();
    let listed = 0;
    dockerRequest.mockImplementation((method: string, url: string) => {
      if (method === 'GET' && url.startsWith('/containers/json')) {
        listed++;
        // First call is the pre-deploy list; after the deploy the new one is included.
        return Promise.resolve(
          listed === 1
            ? owned(['c3', 'c2', 'c1'])
            : [
                { Id: 'container-new', State: 'running', Image: 'insforge-site-appkey01:new' },
                ...owned(['c3', 'c2', 'c1']),
              ]
        );
      }
      if (method === 'POST' && url.startsWith('/containers/create')) {
        return Promise.resolve({ Id: 'container-new' });
      }
      if (url.endsWith('/json')) {
        return Promise.resolve({ NetworkSettings: { Ports: { '80/tcp': [{ HostPort: '1' }] } } });
      }
      return Promise.resolve(undefined);
    });
    const provider = DockerSitesProvider.getInstance();
    const files = await provider.uploadFiles([
      { path: 'index.html', content: Buffer.from('<h1>retain</h1>') },
    ]);

    await provider.createDeploymentWithFiles(files);

    const deletes = dockerRequest.mock.calls
      .filter(([method]) => method === 'DELETE')
      .map(([, url]) => url as string);
    // Three stay on the host — the live one plus two rollback steps — so of c3/c2/c1 only
    // the oldest goes, together with the image it was running.
    expect(deletes).toEqual(['/containers/c1?force=true', '/images/insforge-site-appkey01%3Aaaa']);
  });

  // Removing an image this driver did not tag would reach outside what it owns.
  it('leaves images it did not tag alone', async () => {
    okBuild();
    let listed = 0;
    dockerRequest.mockImplementation((method: string, url: string) => {
      if (method === 'GET' && url.startsWith('/containers/json')) {
        listed++;
        return Promise.resolve(
          listed === 1
            ? owned(['c3', 'c2', 'c1'], 'caddy:alpine')
            : [
                { Id: 'container-new', State: 'running', Image: 'insforge-site-appkey01:new' },
                ...owned(['c3', 'c2', 'c1'], 'caddy:alpine'),
              ]
        );
      }
      if (method === 'POST' && url.startsWith('/containers/create')) {
        return Promise.resolve({ Id: 'container-new' });
      }
      if (url.endsWith('/json')) {
        return Promise.resolve({ NetworkSettings: { Ports: { '80/tcp': [{ HostPort: '1' }] } } });
      }
      return Promise.resolve(undefined);
    });
    const provider = DockerSitesProvider.getInstance();
    const files = await provider.uploadFiles([
      { path: 'index.html', content: Buffer.from('<h1>foreign</h1>') },
    ]);

    await provider.createDeploymentWithFiles(files);

    const deletes = dockerRequest.mock.calls
      .filter(([method]) => method === 'DELETE')
      .map(([, url]) => url as string);
    expect(deletes.filter((url) => url.startsWith('/images/'))).toEqual([]);
  });

  it('returns the builder output with the deployment', async () => {
    dockerBuild.mockResolvedValue({ ok: true, logs: ['Step 1/3 : FROM caddy:alpine', 'Step 2/3'] });
    dockerHappyPath();
    const provider = DockerSitesProvider.getInstance();
    const files = await provider.uploadFiles([
      { path: 'index.html', content: Buffer.from('<h1>logs</h1>') },
    ]);

    const deployment = await provider.createDeploymentWithFiles(files);

    expect(deployment.buildLogs).toEqual(['Step 1/3 : FROM caddy:alpine', 'Step 2/3']);
  });
});

describe('DockerSitesProvider input hardening', () => {
  // These land in WORKDIR and in a `RUN cp`, where a space is two shell words and `;` or
  // `$` is syntax. A directory name is not a place to accept shell.
  it.each(['my dist', 'dist; rm -rf /', 'dist$(whoami)', 'dist`id`'])(
    'refuses outputDirectory %j',
    async (dir) => {
      okBuild();
      dockerHappyPath();
      const provider = DockerSitesProvider.getInstance();
      const files = await provider.uploadFiles([
        { path: 'package.json', content: Buffer.from('{}') },
      ]);

      await expect(
        provider.createDeploymentWithFiles(files, {
          projectSettings: { buildCommand: 'npm run build', outputDirectory: dir },
        })
      ).rejects.toThrow('must be a plain relative path');
      expect(dockerBuild).not.toHaveBeenCalled();
    }
  );

  // The tag is an address. Two builds whose only difference is a baked value must not
  // share one, or the tag stops identifying what it names.
  it('gives a different image tag when only an env value changes', async () => {
    okBuild();
    dockerHappyPath();
    const provider = DockerSitesProvider.getInstance();
    const files = await provider.uploadFiles([
      { path: 'package.json', content: Buffer.from('{}') },
    ]);
    const settings = { buildCommand: 'npm run build', outputDirectory: 'dist' };

    await provider.createDeploymentWithFiles(files, {
      projectSettings: settings,
      envVars: [{ key: 'SITE_MESSAGE', value: 'first' }],
    });
    const firstTag = dockerBuild.mock.calls[0][0].tag as string;
    dockerBuild.mockClear();
    okBuild();

    await provider.createDeploymentWithFiles(files, {
      projectSettings: settings,
      envVars: [{ key: 'SITE_MESSAGE', value: 'second' }],
    });
    const secondTag = dockerBuild.mock.calls[0][0].tag as string;

    expect(firstTag).not.toBe(secondTag);
  });
});

describe('DockerSitesProvider stable address', () => {
  // A gateway config can then be one static line, with no label-discovery plugin and no
  // rewriting per deploy. Container names carry the digest, so the handle has to be an
  // alias rather than the name.
  it('gives the live container a stable alias on the project network', async () => {
    okBuild();
    dockerRequest.mockImplementation((method: string, url: string) => {
      if (method === 'GET' && url.startsWith('/containers/json')) {
        return Promise.resolve([]);
      }
      if (method === 'POST' && url.startsWith('/containers/create')) {
        return Promise.resolve({ Id: 'container-new' });
      }
      if (url.endsWith('/json')) {
        return Promise.resolve({
          NetworkSettings: {
            Networks: { bridge: {}, 'insforge_insforge-network': {} },
            Ports: { '80/tcp': [{ HostPort: '49200' }] },
          },
        });
      }
      return Promise.resolve(undefined);
    });
    const provider = DockerSitesProvider.getInstance();
    const files = await provider.uploadFiles([
      { path: 'index.html', content: Buffer.from('<h1>alias</h1>') },
    ]);

    await provider.createDeploymentWithFiles(files);

    const create = dockerRequest.mock.calls.find(
      ([method, url]) => method === 'POST' && String(url).startsWith('/containers/create')
    );
    const body = (create?.[2] as { body: Record<string, unknown> }).body;
    expect(body.NetworkingConfig).toEqual({
      EndpointsConfig: { 'insforge_insforge-network': { Aliases: ['insforge-site-appkey01'] } },
    });
  });

  // Two containers cannot bind one host port, so the overlap that makes deploys gapless
  // is impossible here — the operator trades ~870ms of downtime for an address that stops
  // changing. Which order runs is the whole difference.
  // The stop has to precede `start` — two containers cannot hold one host port — but not
  // `create`, which binds nothing. Stopping earlier widened the outage and, worse, put the
  // create outside the recovery path: a failure there left the site down with nothing
  // restarted.
  it('stops the old container between create and start when a fixed port is configured', async () => {
    okBuild();
    dockerHappyPath([{ Id: 'container-old' }]);
    configMock.deployments.sitesPort = 7134;
    const provider = DockerSitesProvider.getInstance();
    const files = await provider.uploadFiles([
      { path: 'index.html', content: Buffer.from('<h1>fixed</h1>') },
    ]);

    const deployment = await provider.createDeploymentWithFiles(files);

    const writes = dockerRequest.mock.calls
      .filter(([method]) => method === 'POST')
      .map(([, url]) => url as string);
    expect(writes[0]).toContain('/containers/create');
    expect(writes[1]).toBe('/containers/container-old/stop?t=5');
    expect(writes[2]).toBe('/containers/container-new/start');

    const create = dockerRequest.mock.calls.find(
      ([method, url]) => method === 'POST' && String(url).startsWith('/containers/create')
    );
    const body = (
      create?.[2] as {
        body: { HostConfig: { PortBindings: Record<string, [{ HostPort: string }]> } };
      }
    ).body;
    expect(body.HostConfig.PortBindings['80/tcp'][0].HostPort).toBe('7134');
    // Stable by definition, so nothing is read back from the daemon.
    expect(deployment.url).toBeNull();
  });
});

describe('DockerSitesProvider fixed-port failure paths', () => {
  // Two containers cannot hold one host port, so rollback under a fixed port has to stop
  // the live one first — starting the target while it is still bound just fails.
  it('stops the live container before starting the rollback target', async () => {
    configMock.deployments.sitesPort = 7134;
    dockerRequest.mockImplementation((method: string, url: string) => {
      if (method === 'GET' && url.startsWith('/containers/json')) {
        return Promise.resolve([
          { Id: 'container-live', State: 'running', Image: 'insforge-site-appkey01:new' },
          { Id: 'container-old', State: 'exited', Image: 'insforge-site-appkey01:old' },
        ]);
      }
      if (url.endsWith('/json')) {
        return Promise.resolve({
          Id: 'container-old',
          Name: '/insforge-site',
          Created: '2026-08-13T00:00:00Z',
          State: { Status: 'running', ExitCode: 0 },
          Config: { Image: 'insforge-site-appkey01:old' },
          NetworkSettings: { Ports: { '80/tcp': [{ HostPort: '7134' }] } },
        });
      }
      return Promise.resolve(undefined);
    });

    await DockerSitesProvider.getInstance().rollbackTo('container-old');

    const writes = dockerRequest.mock.calls
      .filter(([method]) => method === 'POST')
      .map(([, url]) => url as string);
    expect(writes[0]).toBe('/containers/container-live/stop?t=5');
    expect(writes[1]).toBe('/containers/container-old/start');
  });

  // The port was freed by stopping the old container, so a replacement that will not start
  // would otherwise leave nothing serving at all.
  it('restarts the previous deployment when the replacement fails to start', async () => {
    configMock.deployments.sitesPort = 7134;
    okBuild();
    dockerRequest.mockImplementation((method: string, url: string) => {
      if (method === 'GET' && url.startsWith('/containers/json')) {
        return Promise.resolve([{ Id: 'container-old', State: 'running', Image: 'x' }]);
      }
      if (method === 'POST' && url.startsWith('/containers/create')) {
        return Promise.resolve({ Id: 'container-doomed' });
      }
      if (url.endsWith('/containers/container-doomed/start')) {
        return Promise.reject(new Error('port is already allocated'));
      }
      return Promise.resolve(undefined);
    });
    const provider = DockerSitesProvider.getInstance();
    const files = await provider.uploadFiles([
      { path: 'index.html', content: Buffer.from('<h1>recover</h1>') },
    ]);

    await expect(provider.createDeploymentWithFiles(files)).rejects.toThrow(
      'port is already allocated'
    );

    const writes = dockerRequest.mock.calls
      .filter(([method]) => method === 'POST')
      .map(([, url]) => url as string);
    expect(writes).toContain('/containers/container-old/start');
  });

  // A deliberate stop is how this driver cancels, so reporting it as ERROR turned every
  // cancellation and every superseded deployment into a failure.
  it('reports a clean exit as CANCELED and a crash as ERROR', async () => {
    for (const [exitCode, expected] of [
      [0, 'CANCELED'],
      [137, 'ERROR'],
    ] as const) {
      dockerRequest.mockImplementation((method: string, url: string) =>
        Promise.resolve(
          // A container the driver can inspect is one the daemon lists for this project —
          // `getDeployment` checks ownership first, like every other id-taking method.
          method === 'GET' && url.startsWith('/containers/json')
            ? [{ Id: 'c1', State: 'exited' }]
            : {
                Id: 'c1',
                Name: '/insforge-site',
                Created: '2026-08-13T00:00:00Z',
                State: { Status: 'exited', ExitCode: exitCode },
                Config: { Image: 'insforge-site-appkey01:x' },
              }
        )
      );

      const deployment = await DockerSitesProvider.getInstance().getDeployment('c1');
      expect(deployment.readyState).toBe(expected);
    }
  });
});

describe('DockerSitesProvider server-rendered deployments', () => {
  /** create -> start -> probe(ok) -> stop previous. */
  function serverHappyPath(previous: { Id: string }[] = []) {
    dockerRequest.mockImplementation((method: string, url: string) => {
      if (method === 'GET' && url.startsWith('/containers/json')) {
        return Promise.resolve(previous);
      }
      if (method === 'POST' && url.startsWith('/containers/create')) {
        return Promise.resolve({ Id: 'server-new' });
      }
      if (method === 'POST' && url.includes('/exec')) {
        return Promise.resolve({ Id: 'exec-1' });
      }
      if (method === 'GET' && url.startsWith('/exec/')) {
        return Promise.resolve({ ExitCode: 0 });
      }
      if (url.endsWith('/json')) {
        return Promise.resolve({
          State: { Status: 'running' },
          NetworkSettings: { Ports: { '80/tcp': [{ HostPort: '49300' }] } },
        });
      }
      return Promise.resolve(undefined);
    });
  }

  const serverSettings = {
    buildCommand: 'npm run build',
    startCommand: 'node server.js',
    serverDirectory: '.next/standalone',
  };

  it('runs the app in Node instead of serving files from Caddy', async () => {
    okBuild();
    serverHappyPath();
    const provider = DockerSitesProvider.getInstance();
    const files = await provider.uploadFiles([
      { path: 'package.json', content: Buffer.from('{}') },
    ]);

    await provider.createDeploymentWithFiles(files, { projectSettings: serverSettings });

    const dockerfile = await generatedDockerfile();
    expect(dockerfile).toContain('FROM node:22-alpine AS build');
    // The runtime stage is Node, not Caddy: a server-rendered site is a process.
    expect(dockerfile).toContain('CMD node server.js');
    expect(dockerfile).not.toContain('FROM caddy:alpine');
    // Only the runnable directory crosses over, which is what keeps a standalone build small.
    expect(dockerfile).toContain('cp -r "/app/.next/standalone" /out');
    // A server bound to localhost inside a container is unreachable from the gateway.
    expect(dockerfile).toContain('ENV HOSTNAME=0.0.0.0');
    expect(dockerfile).toContain('ENV PORT=80');
  });

  // Values are read per request, so they have to be on the container, not only in the build.
  it('injects env vars into the container and caps its resources', async () => {
    okBuild();
    serverHappyPath();
    const provider = DockerSitesProvider.getInstance();
    const files = await provider.uploadFiles([
      { path: 'package.json', content: Buffer.from('{}') },
    ]);

    await provider.createDeploymentWithFiles(files, {
      projectSettings: serverSettings,
      envVars: [{ key: 'DATABASE_URL', value: 'postgres://x' }],
    });

    const create = dockerRequest.mock.calls.find(
      ([method, url]) => method === 'POST' && String(url).startsWith('/containers/create')
    );
    const body = (create?.[2] as { body: Record<string, unknown> }).body;
    expect(body.Env).toEqual(['DATABASE_URL=postgres://x']);
    const host = body.HostConfig as { Memory: number; NanoCpus: number };
    // Unbounded Node beside Postgres on a 2GB VPS OOMs the database first.
    expect(host.Memory).toBe(512 * 1024 * 1024);
    expect(host.NanoCpus).toBe(1e9);
  });

  it('leaves a static deployment without container env or ceilings', async () => {
    okBuild();
    dockerHappyPath();
    const provider = DockerSitesProvider.getInstance();
    const files = await provider.uploadFiles([
      { path: 'index.html', content: Buffer.from('<h1>static</h1>') },
    ]);

    await provider.createDeploymentWithFiles(files);

    const create = dockerRequest.mock.calls.find(
      ([method, url]) => method === 'POST' && String(url).startsWith('/containers/create')
    );
    const body = (create?.[2] as { body: Record<string, unknown> }).body;
    expect(body.Env).toBeUndefined();
    expect(body.HostConfig).not.toHaveProperty('Memory');
  });

  // Caddy answers the moment it starts; a Node server does not. Switching before it serves
  // would stop the old deployment and hand traffic to something that is not up.
  it('waits for the server to answer before the switch', async () => {
    okBuild();
    let probes = 0;
    dockerRequest.mockImplementation((method: string, url: string) => {
      if (method === 'GET' && url.startsWith('/containers/json')) {
        return Promise.resolve([{ Id: 'server-old', State: 'running', Image: 'x' }]);
      }
      if (method === 'POST' && url.startsWith('/containers/create')) {
        return Promise.resolve({ Id: 'server-new' });
      }
      if (method === 'POST' && url.includes('/exec')) {
        return Promise.resolve({ Id: 'exec-1' });
      }
      if (method === 'GET' && url.startsWith('/exec/')) {
        // Refused twice, then serving — the shape of a Node server starting up.
        probes++;
        return Promise.resolve({ ExitCode: probes >= 3 ? 0 : 1 });
      }
      if (url.endsWith('/json')) {
        return Promise.resolve({
          State: { Status: 'running' },
          NetworkSettings: { Ports: { '80/tcp': [{ HostPort: '49300' }] } },
        });
      }
      return Promise.resolve(undefined);
    });
    const provider = DockerSitesProvider.getInstance();
    const files = await provider.uploadFiles([
      { path: 'package.json', content: Buffer.from('{}') },
    ]);

    await provider.createDeploymentWithFiles(files, { projectSettings: serverSettings });

    expect(probes).toBeGreaterThanOrEqual(3);
    const writes = dockerRequest.mock.calls
      .filter(([method]) => method === 'POST')
      .map(([, url]) => url as string);
    // The old one is stopped only after the probe succeeded.
    const startIdx = writes.indexOf('/containers/server-new/start');
    const stopIdx = writes.indexOf('/containers/server-old/stop?t=5');
    // `.endsWith('/exec')`, not `includes('/exec/')`: the probe's exec *create* is
    // `/containers/<id>/exec`, and `/exec/<id>/start` goes through dockerRequestRaw. With
    // the wrong matcher this found no probe and both assertions passed on their fallbacks.
    const lastProbe = writes
      .map((u, i) => (u.endsWith('/exec') ? i : -1))
      .filter((i) => i >= 0)
      .pop();
    // Each index asserted present before it is compared: `indexOf` returns -1 for a call that
    // never happened, and -1 satisfies `toBeLessThan`, so an absent start used to pass.
    expect(lastProbe).toBeGreaterThanOrEqual(0);
    expect(startIdx).toBeGreaterThanOrEqual(0);
    expect(stopIdx).toBeGreaterThanOrEqual(0);
    expect(startIdx).toBeLessThan(lastProbe as number);
    expect(stopIdx).toBeGreaterThan(lastProbe as number);
  });

  // A crash-looping app must fail the deploy with its own output, not take the site down.
  it('fails with the container output when the server exits at once', async () => {
    okBuild();
    dockerRequest.mockImplementation((method: string, url: string) => {
      if (method === 'GET' && url.startsWith('/containers/json')) {
        return Promise.resolve([]);
      }
      if (method === 'POST' && url.startsWith('/containers/create')) {
        return Promise.resolve({ Id: 'server-doomed' });
      }
      if (url.endsWith('/json')) {
        return Promise.resolve({ State: { Status: 'exited', ExitCode: 1 } });
      }
      return Promise.resolve(undefined);
    });
    const provider = DockerSitesProvider.getInstance();
    const files = await provider.uploadFiles([
      { path: 'package.json', content: Buffer.from('{}') },
    ]);

    await expect(
      provider.createDeploymentWithFiles(files, { projectSettings: serverSettings })
    ).rejects.toThrow('exited before it started serving');
    // And it is removed rather than left looking deployable.
    expect(dockerRequest).toHaveBeenCalledWith('DELETE', '/containers/server-doomed?force=true');
  });

  // The readiness probe decides with grep, not with wget's exit code: busybox wget exits 1
  // for a 404 as much as for a dead port, so an app whose `/` answers 401 or 404 — an
  // API-only server, or one behind auth — used to fail its own deploy while serving fine.
  it('treats any HTTP response as serving', async () => {
    okBuild();
    serverHappyPath();
    const provider = DockerSitesProvider.getInstance();
    const files = await provider.uploadFiles([
      { path: 'package.json', content: Buffer.from('{}') },
    ]);

    await provider.createDeploymentWithFiles(files, { projectSettings: serverSettings });

    const exec = dockerRequest.mock.calls.find(
      ([method, url]) => method === 'POST' && String(url).includes('/exec')
    );
    const cmd = (exec?.[2] as { body: { Cmd: string[] } }).body.Cmd.join(' ');
    expect(cmd).toContain('wget -S');
    expect(cmd).toContain("grep -q 'HTTP/'");
  });

  // Retention runs after the new container is already serving, so a daemon that refuses the
  // list must not turn a live deployment into an ERROR row. The next deploy prunes anyway.
  it('still succeeds when the retention pass fails', async () => {
    okBuild();
    let listed = 0;
    dockerRequest.mockImplementation((method: string, url: string) => {
      if (method === 'GET' && url.startsWith('/containers/json')) {
        listed += 1;
        // The first list is the pre-deploy one; the second is retention's.
        return listed > 1
          ? Promise.reject(new Error('daemon refused the list'))
          : Promise.resolve([]);
      }
      if (method === 'POST' && url.startsWith('/containers/create')) {
        return Promise.resolve({ Id: 'container-new' });
      }
      if (url.endsWith('/json')) {
        return Promise.resolve({
          NetworkSettings: { Ports: { '80/tcp': [{ HostPort: '49155' }] } },
        });
      }
      return Promise.resolve(undefined);
    });
    const provider = DockerSitesProvider.getInstance();
    const files = await provider.uploadFiles([
      { path: 'index.html', content: Buffer.from('<h1>hi</h1>') },
    ]);

    const deployment = await provider.createDeploymentWithFiles(files);

    expect(deployment.id).toBe('container-new');
  });

  // Read back through the label, not the static default. A server on 3000 looked up as
  // `80/tcp` returns no port, so `url` came back null — and a sync or a rollback then wrote
  // that null over the address of a deployment that was serving perfectly well.
  it('reports the URL on the port the server actually listens on', async () => {
    dockerClientConfig.publicHost = 'sites.example.com';
    dockerRequest.mockImplementation((method: string, url: string) => {
      if (method === 'GET' && url.startsWith('/containers/json')) {
        return Promise.resolve([{ Id: 'server-live', State: 'running' }]);
      }
      if (url.endsWith('/json')) {
        return Promise.resolve({
          Id: 'server-live',
          Created: new Date().toISOString(),
          State: { Status: 'running' },
          Config: {
            Image: 'insforge-site-appkey01:abc',
            Labels: { 'insforge.site.server-port': '3000' },
          },
          NetworkSettings: {
            Ports: { '3000/tcp': [{ HostPort: '49444' }], '80/tcp': null },
          },
        });
      }
      return Promise.resolve(undefined);
    });

    const deployment = await DockerSitesProvider.getInstance().getDeployment('server-live');

    expect(deployment.url).toBe('http://sites.example.com:49444');
  });

  // The label is how every later operation knows this deployment is a server and where it
  // listens — rollback's readiness gate and the URL both read it. A container cannot be
  // asked "are you a server", and inferring it from an exposed port cannot tell Caddy on 80
  // from a Node app on 80.
  it('records the server port on the container', async () => {
    okBuild();
    serverHappyPath();
    const provider = DockerSitesProvider.getInstance();
    const files = await provider.uploadFiles([
      { path: 'package.json', content: Buffer.from('{}') },
    ]);

    await provider.createDeploymentWithFiles(files, {
      projectSettings: { ...serverSettings, serverPort: 3000 },
    });

    const create = dockerRequest.mock.calls.find(
      ([method, url]) => method === 'POST' && String(url).startsWith('/containers/create')
    );
    const labels = (create?.[2] as { body: { Labels: Record<string, string> } }).body.Labels;
    expect(labels['insforge.site.server-port']).toBe('3000');
  });

  // A static deployment must not carry it: the probe would then run against Caddy, and a
  // rollback would wait on something that was already answering.
  it('leaves the label off a static deployment', async () => {
    okBuild();
    serverHappyPath();
    const provider = DockerSitesProvider.getInstance();
    const files = await provider.uploadFiles([
      { path: 'index.html', content: Buffer.from('<h1>hi</h1>') },
    ]);

    await provider.createDeploymentWithFiles(files);

    const create = dockerRequest.mock.calls.find(
      ([method, url]) => method === 'POST' && String(url).startsWith('/containers/create')
    );
    const labels = (create?.[2] as { body: { Labels: Record<string, string> } }).body.Labels;
    expect(labels['insforge.site.server-port']).toBeUndefined();
  });

  // `previous` is every deployment still on the host, because retention keeps stopped ones
  // on purpose. Restarting all of them under a fixed port is a race whose winner may be a
  // superseded build — so recovery puts back only what was actually serving.
  it('restores only the container that was serving when a fixed-port deploy fails', async () => {
    okBuild();
    configMock.deployments.sitesPort = 7140;
    dockerRequest.mockImplementation((method: string, url: string) => {
      if (method === 'GET' && url.startsWith('/containers/json')) {
        return Promise.resolve([
          { Id: 'retained-old', State: 'exited', Image: 'insforge-site-appkey01:old' },
          { Id: 'was-live', State: 'running', Image: 'insforge-site-appkey01:live' },
        ]);
      }
      if (method === 'POST' && url.startsWith('/containers/create')) {
        return Promise.resolve({ Id: 'container-new' });
      }
      if (method === 'POST' && url.endsWith('/start')) {
        return url.includes('container-new')
          ? Promise.reject(new Error('port already allocated'))
          : Promise.resolve(undefined);
      }
      return Promise.resolve(undefined);
    });
    const provider = DockerSitesProvider.getInstance();
    const files = await provider.uploadFiles([
      { path: 'index.html', content: Buffer.from('<h1>hi</h1>') },
    ]);

    await expect(provider.createDeploymentWithFiles(files)).rejects.toThrow(
      'port already allocated'
    );

    const starts = dockerRequest.mock.calls
      .filter(([method, url]) => method === 'POST' && String(url).endsWith('/start'))
      .map(([, url]) => url as string);
    expect(starts).toContain('/containers/was-live/start');
    expect(starts).not.toContain('/containers/retained-old/start');
  });

  // `paused` holds the fixed port and `restarting` takes it back, so the stop loop covers
  // every other container — while the restore-after-failure loop still only touches what was
  // actually serving. Filtering both the same way left a paused container on the port.
  it('stops paused and restarting containers too, but restores only the one that was serving', async () => {
    configMock.deployments.sitesPort = 7150;
    dockerRequest.mockImplementation((method: string, url: string) => {
      if (method === 'GET' && url.startsWith('/containers/json')) {
        return Promise.resolve([
          { Id: 'target', State: 'exited' },
          { Id: 'was-live', State: 'running' },
          { Id: 'stuck-paused', State: 'paused' },
          { Id: 'flapping', State: 'restarting' },
        ]);
      }
      if (method === 'POST' && url.endsWith('/start')) {
        return url.includes('target')
          ? Promise.reject(new Error('port already allocated'))
          : Promise.resolve(undefined);
      }
      return Promise.resolve(undefined);
    });

    await expect(DockerSitesProvider.getInstance().rollbackTo('target')).rejects.toThrow(
      'port already allocated'
    );

    const writes = dockerRequest.mock.calls
      .filter(([method]) => method === 'POST')
      .map(([, url]) => url as string);
    expect(writes).toContain('/containers/stuck-paused/stop?t=5');
    expect(writes).toContain('/containers/flapping/stop?t=5');
    expect(writes).toContain('/containers/was-live/start');
    expect(writes).not.toContain('/containers/stuck-paused/start');
    expect(writes).not.toContain('/containers/flapping/start');
  });

  // A rollback target that never answers must not be left running: it shares the network
  // alias with the live deployment, so the gateway would round-robin into a broken build
  // behind a site that is otherwise fine.
  it('stops a rollback target that never starts serving', async () => {
    let probes = 0;
    dockerRequest.mockImplementation((method: string, url: string) => {
      if (method === 'GET' && url.startsWith('/containers/json')) {
        return Promise.resolve([
          { Id: 'server-old', State: 'exited', Labels: { 'insforge.site.server-port': '80' } },
          { Id: 'server-live', State: 'running', Labels: { 'insforge.site.server-port': '80' } },
        ]);
      }
      if (method === 'POST' && url.includes('/exec')) {
        probes += 1;
        return Promise.resolve({ Id: `exec-${probes}` });
      }
      if (method === 'GET' && url.startsWith('/exec/')) {
        return Promise.resolve({ ExitCode: 1 });
      }
      if (url.endsWith('/json')) {
        return Promise.resolve({ State: { Status: 'running' } });
      }
      return Promise.resolve(undefined);
    });

    await expect(DockerSitesProvider.getInstance().rollbackTo('server-old')).rejects.toThrow(
      /did not answer/
    );

    const writes = dockerRequest.mock.calls
      .filter(([method]) => method === 'POST')
      .map(([, url]) => url as string);
    expect(writes).toContain('/containers/server-old/stop?t=5');
    // And the live deployment was never touched, since nothing was stopped first.
    expect(writes).not.toContain('/containers/server-live/stop?t=5');
  });

  // Rolling back a server has the same problem a deploy does, and it was missed: "Docker
  // accepted start" is not "the site answers". Without the gate the live deployment is
  // stopped while the restored one is still booting — or crash-looping on config it no
  // longer has.
  it('waits for a restored server to answer before stopping the live one', async () => {
    dockerRequest.mockImplementation((method: string, url: string) => {
      if (method === 'GET' && url.startsWith('/containers/json')) {
        return Promise.resolve([
          // The label is what says "server" — a static rollback has none and skips the probe.
          { Id: 'server-old', State: 'exited', Labels: { 'insforge.site.server-port': '80' } },
          { Id: 'server-live', State: 'running', Labels: { 'insforge.site.server-port': '80' } },
        ]);
      }
      if (method === 'POST' && url.includes('/exec')) {
        return Promise.resolve({ Id: 'exec-1' });
      }
      if (method === 'GET' && url.startsWith('/exec/')) {
        return Promise.resolve({ ExitCode: 0 });
      }
      if (url.endsWith('/json')) {
        return Promise.resolve({
          Id: 'server-old',
          Created: new Date().toISOString(),
          State: { Status: 'running' },
          Config: { Image: 'insforge-site-appkey01:old', Labels: {} },
          NetworkSettings: { Ports: { '80/tcp': [{ HostPort: '49301' }] } },
        });
      }
      return Promise.resolve(undefined);
    });

    await DockerSitesProvider.getInstance().rollbackTo('server-old');

    const writes = dockerRequest.mock.calls
      .filter(([method]) => method === 'POST')
      .map(([, url]) => url as string);
    // `/containers/<id>/exec` — the exec *create*. The `/exec/<id>/start` call goes through
    // dockerRequestRaw, so it never appears in these calls at all.
    const lastProbe = writes
      .map((url, index) => (url.endsWith('/exec') ? index : -1))
      .filter((index) => index >= 0)
      .pop();
    expect(lastProbe).toBeGreaterThanOrEqual(0);
    expect(writes.indexOf('/containers/server-live/stop?t=5')).toBeGreaterThan(lastProbe ?? -1);
  });

  it('refuses a start command with no build command', async () => {
    okBuild();
    serverHappyPath();
    const provider = DockerSitesProvider.getInstance();
    const files = await provider.uploadFiles([
      { path: 'package.json', content: Buffer.from('{}') },
    ]);

    await expect(
      provider.createDeploymentWithFiles(files, {
        projectSettings: { startCommand: 'node server.js' },
      })
    ).rejects.toThrow('needs a build command as well as a start command');
    expect(dockerBuild).not.toHaveBeenCalled();
  });
});

describe('DockerSitesProvider.runtimeLogs', () => {
  beforeEach(() => {
    mountSocket();
    dockerContainerLogs.mockResolvedValue({
      lines: [{ timestamp: 1_700_000_000_000, message: 'ready on :80' }],
      nextToken: '1700000000.000000001',
    });
  });

  it('reads the deployment output through the shared client', async () => {
    dockerRequest.mockImplementation((method: string, url: string) =>
      Promise.resolve(
        method === 'GET' && url.startsWith('/containers/json') ? [{ Id: 'server-live' }] : undefined
      )
    );

    await expect(
      DockerSitesProvider.getInstance().runtimeLogs('server-live', { limit: 20 })
    ).resolves.toEqual({
      lines: [{ timestamp: 1_700_000_000_000, message: 'ready on :80' }],
      nextToken: '1700000000.000000001',
    });
    expect(dockerContainerLogs).toHaveBeenCalledWith('server-live', { limit: 20 });
  });

  // The image tag is a digest of the build context, and the driver's naming and its
  // identical-redeploy reasoning both assume that digest is content-addressed. tar-stream
  // stamps `mtime = new Date()` when a header omits it, so the same files tarred a second
  // apart produced different bytes and a different tag.
  it('stamps a fixed mtime so the context is reproducible', async () => {
    okBuild();
    dockerHappyPath();
    const provider = DockerSitesProvider.getInstance();
    const files = await provider.uploadFiles([
      { path: 'index.html', content: Buffer.from('<h1>hi</h1>') },
    ]);

    await provider.createDeploymentWithFiles(files);

    const headers = await contextHeaders(dockerBuild.mock.calls[0][0].context as Buffer);
    expect([...headers.values()].every((header) => header.mtime?.getTime() === 0)).toBe(true);
  });

  // Retention walks containers, so an image whose container never started is invisible to it:
  // every failed start leaked one image for good.
  it('removes the image when the container will not start', async () => {
    okBuild();
    dockerRequest.mockImplementation((method: string, url: string) => {
      if (method === 'GET' && url.startsWith('/containers/json')) {
        return Promise.resolve([]);
      }
      if (method === 'POST' && url.startsWith('/containers/create')) {
        return Promise.resolve({ Id: 'container-doomed' });
      }
      if (method === 'POST' && url.endsWith('/start')) {
        return Promise.reject(new Error('no space left on device'));
      }
      return Promise.resolve(undefined);
    });
    const provider = DockerSitesProvider.getInstance();
    const files = await provider.uploadFiles([
      { path: 'index.html', content: Buffer.from('<h1>hi</h1>') },
    ]);

    await expect(provider.createDeploymentWithFiles(files)).rejects.toThrow('no space left');

    const deletes = dockerRequest.mock.calls
      .filter(([method]) => method === 'DELETE')
      .map(([, url]) => url as string);
    expect(deletes.some((url) => url.startsWith('/images/insforge-site-appkey01'))).toBe(true);
  });

  // The same flag compute honours. A server-rendered deployment runs the developer's own code
  // and its whole npm tree; the project network carries Postgres and the backend.
  it('keeps the site off the project network when isolation is asked for', async () => {
    okBuild();
    dockerClientConfig.isolateNetwork = true;
    dockerRequest.mockImplementation((method: string, url: string) => {
      if (method === 'GET' && url.startsWith('/containers/json')) {
        return Promise.resolve([]);
      }
      if (method === 'POST' && url.startsWith('/containers/create')) {
        return Promise.resolve({ Id: 'container-new' });
      }
      // The backend's own container, which is where the project network comes from. Without
      // the isolation guard this is exactly what gets attached to the site.
      if (url.includes(hostname()) && url.endsWith('/json')) {
        return Promise.resolve({ NetworkSettings: { Networks: { insforge_default: {} } } });
      }
      if (url.endsWith('/json')) {
        return Promise.resolve({
          NetworkSettings: { Ports: { '80/tcp': [{ HostPort: '49160' }] } },
        });
      }
      return Promise.resolve(undefined);
    });
    const provider = DockerSitesProvider.getInstance();
    const files = await provider.uploadFiles([
      { path: 'index.html', content: Buffer.from('<h1>hi</h1>') },
    ]);

    await provider.createDeploymentWithFiles(files);

    const create = dockerRequest.mock.calls.find(
      ([method, url]) => method === 'POST' && String(url).startsWith('/containers/create')
    );
    expect(
      (create?.[2] as { body: Record<string, unknown> }).body.NetworkingConfig
    ).toBeUndefined();
    dockerClientConfig.isolateNetwork = false;
  });

  // A deployment id is a container id, and this was the last id-taking method without the
  // check — reachable with a caller-supplied string through the webhook path.
  it('refuses to inspect a container it does not own', async () => {
    dockerRequest.mockImplementation((method: string, url: string) =>
      Promise.resolve(
        method === 'GET' && url.startsWith('/containers/json')
          ? [{ Id: 'server-live', State: 'running' }]
          : undefined
      )
    );

    await expect(
      DockerSitesProvider.getInstance().getDeployment('insforge-postgres')
    ).rejects.toThrow('not on this host');
  });

  // A failed build is the normal failure of a source deploy, and its output is the only
  // thing that tells the developer why. `build.logs` is discarded with the call, and the
  // metadata write that records logs on success is never reached — so the tail travels in
  // the error message.
  it('carries the build output in the failure', async () => {
    dockerBuild.mockResolvedValue({
      ok: false,
      error: 'Docker build failed',
      logs: ['Step 3/6 : RUN npm run build', "src/app.tsx(3,7): error TS2322: Type 'number'"],
    });
    const provider = DockerSitesProvider.getInstance();
    const files = await provider.uploadFiles([
      { path: 'package.json', content: Buffer.from('{}') },
    ]);

    await expect(
      provider.createDeploymentWithFiles(files, {
        projectSettings: { buildCommand: 'npm run build' },
      })
    ).rejects.toThrow(/error TS2322/);
  });

  // Cancelling a deployment the switch already stopped is the common case — the daemon
  // answers 304, and when that counted as an error the caller got a 500 and the row was never
  // marked CANCELED.
  it('cancels a deployment that is already stopped', async () => {
    dockerRequest.mockImplementation((method: string, url: string) =>
      Promise.resolve(
        method === 'GET' && url.startsWith('/containers/json')
          ? [{ Id: 'container-old', State: 'exited' }]
          : undefined
      )
    );

    await expect(
      DockerSitesProvider.getInstance().cancelDeployment('container-old')
    ).resolves.toBeUndefined();
    expect(dockerRequest).toHaveBeenCalledWith('POST', '/containers/container-old/stop?t=5');
  });

  // Same reason as reading logs, worse consequence: an id that is not ours would stop a
  // neighbouring container on the shared daemon, and on a self-host that is Postgres.
  it('refuses to cancel a container it does not own', async () => {
    dockerRequest.mockImplementation((method: string, url: string) =>
      Promise.resolve(
        method === 'GET' && url.startsWith('/containers/json') ? [{ Id: 'server-live' }] : undefined
      )
    );

    await expect(
      DockerSitesProvider.getInstance().cancelDeployment('insforge-postgres')
    ).rejects.toThrow('not on this host');
    const stops = dockerRequest.mock.calls.filter(([, url]) => String(url).includes('/stop'));
    expect(stops).toHaveLength(0);
  });

  // A deployment id is a container id. Without this, a guessed id reads whatever else runs
  // on the daemon — on a self-host that means Postgres, and the credentials in its output.
  it('refuses a container it does not own', async () => {
    dockerRequest.mockImplementation((method: string, url: string) =>
      Promise.resolve(
        method === 'GET' && url.startsWith('/containers/json') ? [{ Id: 'server-live' }] : undefined
      )
    );

    await expect(
      DockerSitesProvider.getInstance().runtimeLogs('insforge-postgres')
    ).rejects.toThrow('not on this host');
    expect(dockerContainerLogs).not.toHaveBeenCalled();
  });
});
