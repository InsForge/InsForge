import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { extract as tarExtract } from 'tar-stream';
import { Readable } from 'node:stream';

const staging = await mkdtemp(path.join(tmpdir(), 'insforge-sites-'));

const configMock = {
  cloud: { projectId: 'proj-1234567890ab', apiHost: 'https://cloud.test' },
  app: { jwtSecret: 's'.repeat(32), logLevel: 'error' },
  server: { logsDir: path.join(staging, 'logs') },
  deployments: { sitesDomain: '', sitesStagingDir: staging },
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
vi.mock('@/providers/compute/docker.client.js', () => ({
  dockerConfig: () => dockerClientConfig,
  dockerBuild: (...args: unknown[]) => dockerBuild(...args),
  dockerRequest: (...args: unknown[]) => dockerRequest(...args),
}));
vi.mock('@/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { DockerSitesProvider } = await import('@/providers/deployments/docker.provider.js');

const savedProfile = process.env.AWS_INSTANCE_PROFILE_NAME;
const savedAppKey = process.env.APP_KEY;

/** Any existing file passes the probe — existsSync is all the driver checks. */
function mountSocket(): void {
  dockerClientConfig.socketPath = process.execPath;
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
  // Namespaces containers, images and the advertised hostname. Per-instance, so two
  // InsForge deployments sharing one daemon cannot touch each other's site containers.
  process.env.APP_KEY = 'appkey01';
  dockerClientConfig.socketPath = '/nonexistent/test.sock';
  dockerClientConfig.defaultIngress = 'port';
  dockerClientConfig.publicHost = '';
  configMock.deployments.sitesDomain = '';
  delete process.env.AWS_INSTANCE_PROFILE_NAME;
});

afterAll(async () => {
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
    expect(caddyfile).toContain('try_files {path} /index.html');
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
    // Serving stage starts from nginx, so node_modules never reaches what runs.
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
  function owned(ids: string[], image = 'insforge-site-appkey01:aaa') {
    return ids.map((Id) => ({ Id, State: 'exited', Image: image }));
  }

  it('starts the target and stops everything else', async () => {
    dockerRequest.mockImplementation((method: string, url: string) => {
      if (method === 'GET' && url.startsWith('/containers/json')) {
        return Promise.resolve(owned(['container-live', 'container-old']));
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
