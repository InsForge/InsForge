import { createHash } from 'node:crypto';
import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import { pack as tarPack } from 'tar-stream';
import { appConfig } from '@/infra/config/app.config.js';
import { dockerConfig, dockerBuild, dockerRequest } from '@/providers/compute/docker.client.js';
import { isCloudEnvironment } from '@/utils/environment.js';
import { AppError } from '@/utils/errors.js';
import logger from '@/utils/logger.js';
import { ERROR_CODES } from '@insforge/shared-schemas';
import type {
  CreateDeploymentInput,
  ProviderDeployment,
  SitesCapabilities,
  SitesProvider,
  SitesProviderName,
  UploadedFileRef,
} from './sites.provider.js';

/**
 * Labels every container this driver owns. Same reasoning as the compute driver: from
 * inside a container with the socket mounted, an unfiltered `docker ps` lists the whole
 * stack including Postgres, so every read and write is scoped to these.
 */
const LABEL_MANAGED = 'insforge.managed';
const LABEL_PROJECT = 'insforge.project';
const LABEL_SITE = 'insforge.site';
const LABEL_DEPLOYMENT = 'insforge.deployment';

/** The port nginx listens on inside the image. Not configurable: nothing else is in there. */
const SITE_PORT = 80;

/**
 * One site per instance in v1, so the container name is fixed per project rather than
 * derived from a site name that does not exist yet.
 */
const CONTAINER_PREFIX = 'insforge-site';

/**
 * Serve the uploaded files, and nothing else.
 *
 * `try_files ... /index.html` is what makes a client-side-routed app work: a request for
 * /dashboard/settings has no file behind it, and without this it 404s instead of loading
 * the app. Long cache lifetimes go on hashed asset filenames only — index.html must stay
 * revalidated or a deploy would not be visible until the browser cache expired.
 */
const NGINX_CONF = `server {
  listen ${SITE_PORT};
  server_name _;
  root /usr/share/nginx/html;
  index index.html;

  location / {
    try_files $uri $uri/ /index.html;
  }

  location ~* \\.(js|css|woff2?|png|jpe?g|gif|svg|ico|webp|avif)$ {
    expires 1y;
    add_header Cache-Control "public, immutable";
  }

  location = /index.html {
    add_header Cache-Control "no-cache";
  }
}
`;

const DOCKERFILE = `FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY site/ /usr/share/nginx/html/
`;

/** Docker's container states, mapped onto the deployment vocabulary the service records. */
function readyStateFor(status: string): string {
  switch (status) {
    case 'running':
      return 'READY';
    case 'created':
    case 'restarting':
      return 'BUILDING';
    case 'exited':
    case 'dead':
      return 'ERROR';
    case 'removing':
      return 'CANCELED';
    default:
      return 'BUILDING';
  }
}

/**
 * Host a site on the operator's own Docker daemon.
 *
 * Every deployment becomes an immutable image plus a container: start the new one, stop
 * the old one. That is what makes the switch atomic and rollback a matter of starting a
 * previous image, rather than writing files into a document root that is being served.
 *
 * InsForge publishes a port or advertises a hostname and stops there — TLS and routing
 * are the operator's gateway, exactly as documented for compute and the dashboard.
 */
export class DockerSitesProvider implements SitesProvider {
  readonly name: SitesProviderName = 'docker';

  private static instance: DockerSitesProvider;

  static getInstance(): DockerSitesProvider {
    if (!DockerSitesProvider.instance) {
      DockerSitesProvider.instance = new DockerSitesProvider();
    }
    return DockerSitesProvider.instance;
  }

  /**
   * A mounted socket is the operator's opt-in, and being on our infrastructure is
   * disqualifying regardless: running customer containers on shared hosts is a tenant
   * escape, so this fails closed rather than trusting a provider preference.
   */
  isConfigured(): boolean {
    if (isCloudEnvironment()) {
      return false;
    }
    return existsSync(dockerConfig().socketPath);
  }

  /**
   * Every flag here is what this driver does *today*, not what it is planned to do.
   *
   * `envVars: 'none'` because only prebuilt output is accepted — there is no build of user
   * source for values to reach. `rollback` and `buildLogs` are false for the same reason
   * they are false for Vercel: nothing implements them yet. Each flips in the commit that
   * adds the behaviour, so a client is never told about a button that does nothing.
   *
   * `frameworkDetection: false` is the honest gap against Vercel: this driver serves what
   * it is given and does not infer how to produce it.
   */
  capabilities(): SitesCapabilities {
    const ingress = dockerConfig().defaultIngress === 'host' ? 'host' : 'port';
    return {
      envVars: 'none',
      customDomains: false,
      slug: false,
      rollback: false,
      buildLogs: false,
      frameworkDetection: false,
      ingressModes: ['port', 'host'],
      defaultIngress: ingress,
    };
  }

  // ---------------------------------------------------------------------------
  // Staging. Uploads are content-addressed by sha, which is also the protocol the
  // callers already speak, so a file that appears in two deployments is stored once.
  // ---------------------------------------------------------------------------

  private stagingDir(): string {
    return appConfig.deployments.sitesStagingDir;
  }

  private stagedPath(sha: string): string {
    // The sha is the filename, so a malformed one would escape the directory.
    if (!/^[a-f0-9]{40}$/.test(sha)) {
      throw new AppError(`Invalid file sha "${sha}".`, 400, ERROR_CODES.DEPLOYMENT_INVALID_FILE);
    }
    return path.join(this.stagingDir(), sha);
  }

  private async ensureStagingDir(): Promise<void> {
    await mkdir(this.stagingDir(), { recursive: true });
  }

  async uploadFile(fileContent: Buffer): Promise<string> {
    const sha = createHash('sha1').update(fileContent).digest('hex');
    await this.ensureStagingDir();
    await writeFile(this.stagedPath(sha), fileContent);
    return sha;
  }

  async uploadFileStream(input: {
    content: Readable;
    sha: string;
    size: number;
    signal?: AbortSignal;
  }): Promise<string> {
    await this.ensureStagingDir();
    const target = this.stagedPath(input.sha);
    // The caller's stream already verifies sha and size as it passes bytes through
    // (createValidatedFileStream), so a mismatch aborts the pipeline rather than
    // landing a corrupt file here.
    await pipeline(input.content, createWriteStream(target), { signal: input.signal });
    return input.sha;
  }

  async uploadFiles(files: Array<{ path: string; content: Buffer }>): Promise<UploadedFileRef[]> {
    await this.ensureStagingDir();
    const refs: UploadedFileRef[] = [];
    for (const file of files) {
      const sha = await this.uploadFile(file.content);
      refs.push({ file: file.path, sha, size: file.content.length });
    }
    return refs;
  }

  // ---------------------------------------------------------------------------
  // Deploy
  // ---------------------------------------------------------------------------

  async createDeployment(input: CreateDeploymentInput): Promise<ProviderDeployment> {
    return this.createDeploymentWithFiles(input.files ?? [], input);
  }

  async createDeploymentWithFiles(
    files: UploadedFileRef[],
    options: Omit<CreateDeploymentInput, 'files'> = {}
  ): Promise<ProviderDeployment> {
    if (files.length === 0) {
      throw new AppError(
        'A deployment needs at least one file.',
        400,
        ERROR_CODES.DEPLOYMENT_INVALID_FILE
      );
    }

    // Callers upload a whole tree today because Vercel builds it. This driver serves what
    // it is given, so without honouring outputDirectory it would publish src/ and
    // package.json as though they were the website.
    const served = this.selectServedFiles(files, options.projectSettings?.outputDirectory);
    const context = await this.buildContext(served);
    const digest = createHash('sha256').update(context).digest('hex').slice(0, 12);
    const imageTag = `insforge-site-${this.projectKey()}:${digest}`;

    const build = await dockerBuild({ context, tag: imageTag });
    if (!build.ok) {
      throw new AppError(
        build.error ?? 'Site image build failed.',
        502,
        ERROR_CODES.UPSTREAM_FAILURE
      );
    }

    const containerId = await this.runContainer(imageTag, digest);
    logger.info('Docker sites: deployed', { imageTag, containerId, files: files.length });

    return {
      id: containerId,
      url: await this.endpointUrl(containerId),
      state: 'running',
      readyState: 'READY',
      name: imageTag,
      createdAt: new Date(),
    };
  }

  /**
   * Tar the staged files plus the two generated config files.
   *
   * Built in memory: the whole point of going through the socket is that no host path is
   * involved, so the daemon needs the context as bytes. `maxDeploymentTotalBytes` already
   * caps what a caller can have uploaded, which is what bounds this.
   */
  private async buildContext(files: UploadedFileRef[]): Promise<Buffer> {
    const pack = tarPack();
    const chunks: Buffer[] = [];
    pack.on('data', (chunk: Buffer) => chunks.push(chunk));

    const done = new Promise<void>((resolve, reject) => {
      pack.on('end', resolve);
      pack.on('error', reject);
    });

    pack.entry({ name: 'Dockerfile' }, DOCKERFILE);
    pack.entry({ name: 'nginx.conf' }, NGINX_CONF);

    for (const file of files) {
      const staged = this.stagedPath(file.sha);
      if (!existsSync(staged)) {
        throw new AppError(
          `File ${file.file} was never uploaded (sha ${file.sha}).`,
          400,
          ERROR_CODES.DEPLOYMENT_INVALID_FILE
        );
      }
      const content = await readFile(staged);
      const { size } = await stat(staged);
      // Under site/ so the Dockerfile can COPY the tree without the config files.
      // Leading slashes and .. are stripped: the manifest is caller-supplied, and a
      // path that climbed out would write into the image root.
      pack.entry({ name: path.posix.join('site', this.safeEntryName(file.file)), size }, content);
    }

    pack.finalize();
    await done;
    return Buffer.concat(chunks);
  }

  /**
   * Narrow an uploaded tree to the directory that holds the built output.
   *
   * Refuses rather than falling back to the whole tree when the directory is empty: a
   * typo'd `outputDirectory` would otherwise publish the source, which looks like a
   * successful deploy of the wrong thing — the worst outcome to guess at.
   */
  private selectServedFiles(
    files: UploadedFileRef[],
    outputDirectory?: string | null
  ): UploadedFileRef[] {
    if (!outputDirectory) {
      return files;
    }
    const prefix = `${this.safeEntryName(outputDirectory).replace(/\/+$/, '')}/`;
    const selected = files
      .filter((file) => this.safeEntryName(file.file).startsWith(prefix))
      .map((file) => ({ ...file, file: this.safeEntryName(file.file).slice(prefix.length) }));

    if (selected.length === 0) {
      throw new AppError(
        `No uploaded files are under "${outputDirectory}".`,
        400,
        ERROR_CODES.DEPLOYMENT_INVALID_FILE,
        'Build the site first, then deploy the directory the build wrote to.'
      );
    }
    return selected;
  }

  private safeEntryName(name: string): string {
    const normalized = path.posix.normalize(name.replace(/\\/g, '/')).replace(/^(\.\.(\/|$))+/, '');
    const trimmed = normalized.replace(/^\/+/, '');
    if (!trimmed || trimmed === '.') {
      throw new AppError(`Invalid file path "${name}".`, 400, ERROR_CODES.DEPLOYMENT_INVALID_FILE);
    }
    return trimmed;
  }

  private projectKey(): string {
    const projectId = appConfig.cloud?.projectId;
    // Same shape as the compute driver's key: short, stable, and safe in an image tag.
    return (projectId && projectId !== 'local' ? projectId : 'local').slice(0, 12);
  }

  /**
   * Start the new container, then stop the previous one.
   *
   * This order is the atomic switch: the new site is already answering before the old one
   * stops, so a reload during a deploy gets one of the two rather than a connection
   * refused. The old container is kept, not removed — that is what rollback starts.
   */
  private async runContainer(imageTag: string, digest: string): Promise<string> {
    const previous = await this.listOwnContainers();
    const name = `${CONTAINER_PREFIX}-${this.projectKey()}-${digest}`;
    // Published under both ingress modes: `host` needs somewhere for the operator's
    // gateway to proxy to, so only the address we advertise differs.
    const exposed = `${SITE_PORT}/tcp`;

    const created = await dockerRequest<{ Id: string; Warnings?: string[] }>(
      'POST',
      `/containers/create?name=${encodeURIComponent(name)}`,
      {
        body: {
          Image: imageTag,
          Labels: {
            [LABEL_MANAGED]: 'true',
            [LABEL_PROJECT]: this.projectKey(),
            [LABEL_SITE]: 'default',
            [LABEL_DEPLOYMENT]: digest,
          },
          ExposedPorts: { [exposed]: {} },
          HostConfig: {
            RestartPolicy: { Name: 'unless-stopped' },
            // Loopback by default, like compute: publishing to 0.0.0.0 on a reachable
            // host is a deliberate choice, not something a default should make.
            PortBindings: {
              [exposed]: [{ HostIp: dockerConfig().bindAddress, HostPort: '' }],
            },
          },
        },
      }
    );
    if (!created?.Id) {
      throw new AppError(
        `Docker returned no container id for ${name}.`,
        502,
        ERROR_CODES.UPSTREAM_FAILURE
      );
    }

    try {
      await dockerRequest('POST', `/containers/${created.Id}/start`);
    } catch (error) {
      // A container that will not start must not be left behind looking deployable.
      await dockerRequest('DELETE', `/containers/${created.Id}?force=true`).catch(() => undefined);
      throw error;
    }

    for (const container of previous) {
      await dockerRequest('POST', `/containers/${container.Id}/stop?t=5`).catch(() => undefined);
    }

    return created.Id;
  }

  private async listOwnContainers(): Promise<
    { Id: string; State: string; Labels?: Record<string, string> }[]
  > {
    const filters = JSON.stringify({
      label: [
        `${LABEL_MANAGED}=true`,
        `${LABEL_PROJECT}=${this.projectKey()}`,
        `${LABEL_SITE}=default`,
      ],
    });
    return (
      (await dockerRequest<{ Id: string; State: string; Labels?: Record<string, string> }[]>(
        'GET',
        `/containers/json?all=true&filters=${encodeURIComponent(filters)}`
      )) ?? []
    );
  }

  async getDeployment(providerDeploymentId: string): Promise<ProviderDeployment> {
    const inspected = await dockerRequest<{
      Id: string;
      Name: string;
      Created: string;
      State: { Status: string; Error?: string };
      Config: { Image: string };
      NetworkSettings?: { Ports?: Record<string, { HostPort: string }[] | null> };
    }>('GET', `/containers/${encodeURIComponent(providerDeploymentId)}/json`);

    if (!inspected) {
      throw new AppError('Deployment not found.', 404, ERROR_CODES.DEPLOYMENT_NOT_FOUND);
    }

    const status = inspected.State.Status;
    return {
      id: inspected.Id,
      url: await this.endpointUrl(inspected.Id, inspected),
      state: status,
      readyState: readyStateFor(status),
      name: inspected.Config.Image,
      createdAt: new Date(inspected.Created),
      ...(inspected.State.Error ? { error: { code: status, message: inspected.State.Error } } : {}),
    };
  }

  /** Stopping is the cancel: the image stays, so the deployment can be started again. */
  async cancelDeployment(providerDeploymentId: string): Promise<void> {
    await dockerRequest('POST', `/containers/${encodeURIComponent(providerDeploymentId)}/stop?t=5`);
  }

  /**
   * Where the site answers.
   *
   * Under `port` ingress the daemon assigns an ephemeral host port, so the address does
   * not exist until the container is running — hence reading it back from inspect. With
   * no public host configured we return null rather than guessing an address that would
   * not resolve.
   */
  private async endpointUrl(
    containerId: string,
    inspected?: { NetworkSettings?: { Ports?: Record<string, { HostPort: string }[] | null> } }
  ): Promise<string | null> {
    const config = dockerConfig();
    const domain = appConfig.deployments.sitesDomain;

    if (this.capabilities().defaultIngress === 'host') {
      return domain ? `https://${this.projectKey()}.${domain}` : null;
    }

    if (!config.publicHost) {
      return null;
    }
    // Reuse the caller's inspect when it has one: the read path already fetched this.
    const details =
      inspected ??
      (await dockerRequest<{
        NetworkSettings: { Ports: Record<string, { HostPort: string }[] | null> };
      }>('GET', `/containers/${encodeURIComponent(containerId)}/json`));
    const port = details?.NetworkSettings?.Ports?.[`${SITE_PORT}/tcp`]?.[0]?.HostPort;
    return port ? `http://${config.publicHost}:${port}` : null;
  }
}
