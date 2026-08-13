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

/** Any existing file passes the probe — existsSync is all the driver checks. */
function mountSocket(): void {
  dockerClientConfig.socketPath = process.execPath;
}

/** Entry names inside the tar the driver handed to the builder. */
async function contextEntries(context: Buffer): Promise<string[]> {
  const names: string[] = [];
  const extract = tarExtract();
  extract.on('entry', (header, stream, next) => {
    names.push(header.name);
    stream.on('end', next);
    stream.resume();
  });
  await new Promise<void>((resolve, reject) => {
    extract.on('finish', resolve);
    extract.on('error', reject);
    Readable.from(context).pipe(extract);
  });
  return names;
}

function okBuild() {
  dockerBuild.mockResolvedValue({ ok: true, logs: ['Step 1/3 : FROM nginx:alpine'] });
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
  dockerClientConfig.socketPath = '/nonexistent/test.sock';
  dockerClientConfig.defaultIngress = 'port';
  dockerClientConfig.publicHost = '';
  configMock.deployments.sitesDomain = '';
  delete process.env.AWS_INSTANCE_PROFILE_NAME;
});

afterAll(async () => {
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
      'nginx.conf',
      'site/index.html',
      'site/assets/app.js',
    ]);
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
      'nginx.conf',
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

    expect(deployment.url).toBe('https://proj-1234567.sites.example.com');
  });
});
