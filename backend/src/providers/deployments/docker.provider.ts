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

/** The port the site server listens on inside the image. Nothing else runs in there. */
const SITE_PORT = 80;

/**
 * One site per instance in v1, so the container name is fixed per project rather than
 * derived from a site name that does not exist yet.
 */
const CONTAINER_PREFIX = 'insforge-site';

/**
 * How many deployments stay on the host, the live one included. Three is two rollback
 * steps, which is what "undo the deploy I just made" needs without letting images
 * accumulate unbounded on a small VPS.
 */
const RETAINED_DEPLOYMENTS = 3;

/**
 * Serve the uploaded files, and nothing else.
 *
 * `try_files {path} /index.html` is what makes a client-side-routed app work: a request
 * for /dashboard/settings has no file behind it, and without this it 404s instead of
 * loading the app.
 *
 * Long cache lifetimes go on hashed asset filenames only. Everything else — `/`,
 * `/index.html`, and every client-side route — must stay revalidated or a deploy would
 * not be visible until the browser cache expired. Matched by *excluding* assets rather
 * than by naming `/index.html`: the matcher sees the requested path, so naming the file
 * left `/` itself with no cache header at all, which is the one URL everybody visits.
 *
 * Caddy rather than nginx for three measured reasons: compression is one directive
 * instead of a block nobody remembers to write (the nginx version shipped none, so every
 * asset went out uncompressed — a 26KB bundle went from 26,479 to 1,704 bytes once this
 * was on), the image is smaller, and `header` has no overlap with a separate expiry
 * directive — the nginx config emitted *two* Cache-Control headers, because `expires`
 * writes one and `add_header` appends another.
 *
 * zstd before gzip because Caddy offers encodings in the order listed here, and on the
 * same bundle zstd was 775 bytes against gzip's 1,704.
 */
const CADDYFILE = `:${SITE_PORT} {
	root * /srv
	encode zstd gzip
	@assets path_regexp \\.(js|css|woff2?|png|jpe?g|gif|svg|ico|webp|avif)$
	header @assets Cache-Control "public, max-age=31536000, immutable"
	@html not path_regexp \\.(js|css|woff2?|png|jpe?g|gif|svg|ico|webp|avif)$
	header @html Cache-Control "no-cache"
	try_files {path} /index.html
	file_server
}
`;

/** Serve what was uploaded, unchanged. No build step, so nothing can go wrong in one. */
const SERVE_ONLY_DOCKERFILE = `FROM caddy:alpine
COPY Caddyfile /etc/caddy/Caddyfile
COPY site/ /srv/
`;

/**
 * The image the build stage runs in. Pinned rather than configurable: a site that builds
 * against whatever the host happens to have is not reproducible, and this is the same
 * major the backend itself targets.
 */
const BUILD_IMAGE = 'node:22-alpine';

const DEFAULT_INSTALL_COMMAND = 'npm ci --no-audit --no-fund';
const DEFAULT_OUTPUT_DIRECTORIES = ['dist', 'build', 'out'];

/**
 * Reject anything that could break out of the line it is interpolated into.
 *
 * A build command is arbitrary shell by design — that is what a build is, and the caller
 * is a project admin. A *newline* is different: it would end the RUN instruction and let
 * the value append its own Dockerfile directives, which is a different privilege from
 * running a command in the build container.
 */
function assertSingleLine(value: string, field: string): string {
  if (/[\r\n]/.test(value)) {
    throw new AppError(`${field} must be a single line.`, 400, ERROR_CODES.INVALID_INPUT);
  }
  return value;
}

/** A relative path inside the uploaded tree. Absolute or climbing paths are refused. */
function assertRelativePath(value: string, field: string): string {
  const normalized = path.posix.normalize(assertSingleLine(value, field).replace(/\\/g, '/'));
  if (normalized.startsWith('/') || normalized === '..' || normalized.startsWith('../')) {
    throw new AppError(
      `${field} must be a path inside the uploaded files.`,
      400,
      ERROR_CODES.INVALID_INPUT
    );
  }
  return normalized.replace(/^\.\//, '').replace(/\/+$/, '');
}

/**
 * Build args have to be declared per stage to be visible, and they are recorded in the
 * image history — which is why the capability is `build-only` and not a secret store.
 */
function assertEnvKey(key: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
    throw new AppError(
      `"${key}" is not a usable environment variable name.`,
      400,
      ERROR_CODES.INVALID_INPUT
    );
  }
  return key;
}

interface OwnedContainer {
  Id: string;
  State: string;
  Image?: string;
  Labels?: Record<string, string>;
}

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
   * `envVars: 'build-only'` — values are passed to the build as build args and baked into
   * the artifact. There is deliberately no read-back: they end up in the built files and
   * in image history, so calling this a store would misrepresent it.
   *
   * `rollback` is true because every deployment is its own image and container, and the
   * previous ones are kept: restoring means starting one again, not rebuilding it. It
   * stops being possible once retention removes that container, which is what
   * `rollbackTo` reports.
   *
   * `buildLogs` is true because the classic builder streams readable progress and it is
   * recorded with the deployment. Vercel reports false here — this driver is the first to
   * have them.
   *
   * `frameworkDetection: false` is the honest gap against Vercel: this driver serves what
   * it is given and does not infer how to produce it.
   */
  capabilities(): SitesCapabilities {
    const ingress = dockerConfig().defaultIngress === 'host' ? 'host' : 'port';
    return {
      envVars: 'build-only',
      customDomains: false,
      slug: false,
      rollback: true,
      buildLogs: true,
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

    const settings = options.projectSettings ?? {};
    const buildCommand = settings.buildCommand?.trim();

    // Two modes, and `outputDirectory` means a different thing in each. Serving mode: it
    // narrows the uploaded tree, because callers upload a whole tree today (Vercel builds
    // it) and publishing src/ as the website would be worse than refusing. Build mode: it
    // names where the build *writes*, so the whole tree has to reach the builder.
    const served = buildCommand ? files : this.selectServedFiles(files, settings.outputDirectory);

    if (!buildCommand) {
      this.assertNotASourceTree(served);
    }

    const dockerfile = buildCommand
      ? this.buildStageDockerfile({
          buildCommand,
          installCommand: settings.installCommand,
          outputDirectory: settings.outputDirectory,
          rootDirectory: settings.rootDirectory,
          envKeys: (options.envVars ?? []).map((envVar) => envVar.key),
        })
      : SERVE_ONLY_DOCKERFILE;

    const context = await this.buildContext(served, dockerfile);
    const digest = createHash('sha256').update(context).digest('hex').slice(0, 12);
    const imageTag = `insforge-site-${this.projectKey()}:${digest}`;

    const build = await dockerBuild({
      context,
      tag: imageTag,
      buildArgs: Object.fromEntries(
        (options.envVars ?? []).map((envVar) => [assertEnvKey(envVar.key), envVar.value])
      ),
    });
    if (!build.ok) {
      throw new AppError(
        build.error ?? 'Site image build failed.',
        502,
        ERROR_CODES.UPSTREAM_FAILURE
      );
    }

    const containerId = await this.runContainer(imageTag, digest);
    const retained = await this.pruneOwnResources(containerId);
    logger.info('Docker sites: deployed', {
      imageTag,
      containerId,
      files: files.length,
      ...retained,
    });

    return {
      id: containerId,
      url: await this.endpointUrl(containerId),
      state: 'running',
      readyState: 'READY',
      name: imageTag,
      createdAt: new Date(),
      buildLogs: build.logs,
    };
  }

  /**
   * Tar the staged files plus the two generated config files.
   *
   * Built in memory: the whole point of going through the socket is that no host path is
   * involved, so the daemon needs the context as bytes. `maxDeploymentTotalBytes` already
   * caps what a caller can have uploaded, which is what bounds this.
   */
  private async buildContext(files: UploadedFileRef[], dockerfile: string): Promise<Buffer> {
    const pack = tarPack();
    const chunks: Buffer[] = [];
    pack.on('data', (chunk: Buffer) => chunks.push(chunk));

    const done = new Promise<void>((resolve, reject) => {
      pack.on('end', resolve);
      pack.on('error', reject);
    });

    pack.entry({ name: 'Dockerfile' }, dockerfile);
    pack.entry({ name: 'Caddyfile' }, CADDYFILE);

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
   * Refuse to publish something that is plainly source rather than a built site.
   *
   * Without this, a tree uploaded for Vercel to build gets served verbatim: the browser
   * downloads package.json and a bare index.html that references /src/main.tsx. That
   * reads as a successful deploy of a broken site, which is harder to diagnose than a
   * refusal naming the two ways forward.
   */
  private assertNotASourceTree(files: UploadedFileRef[]): void {
    const names = files.map((file) => this.safeEntryName(file.file));
    const hasManifest = names.some((name) => name === 'package.json');
    const hasEntryPoint = names.some((name) => name === 'index.html');
    if (hasManifest && !hasEntryPoint) {
      throw new AppError(
        'These files look like a source tree, not a built site.',
        400,
        ERROR_CODES.DEPLOYMENT_INVALID_FILE,
        'Set a build command, or deploy the directory your build writes to.'
      );
    }
  }

  /**
   * A two-stage image: build the site with the caller's own commands, then serve only the
   * output. The build stage is discarded, so node_modules and the toolchain never reach
   * the image that runs.
   */
  private buildStageDockerfile(params: {
    buildCommand: string;
    installCommand?: string | null;
    outputDirectory?: string | null;
    rootDirectory?: string | null;
    envKeys: string[];
  }): string {
    const root = params.rootDirectory
      ? assertRelativePath(params.rootDirectory, 'rootDirectory')
      : '';
    const workdir = path.posix.join('/app', root);
    const install = assertSingleLine(
      params.installCommand?.trim() || DEFAULT_INSTALL_COMMAND,
      'installCommand'
    );
    const build = assertSingleLine(params.buildCommand, 'buildCommand');
    const output = params.outputDirectory
      ? assertRelativePath(params.outputDirectory, 'outputDirectory')
      : '';

    // Declared per stage or the daemon drops them; recorded in image history, which is
    // why this capability is build-only rather than a secret store.
    const args = [...new Set(params.envKeys.map(assertEnvKey))].map((key) => `ARG ${key}`);

    // Without an explicit output directory, take the first conventional one that exists.
    // Guessing *which* is fine — guessing that a build happened at all would not be.
    const outputExpr = output
      ? `${workdir}/${output}`
      : `$(for d in ${DEFAULT_OUTPUT_DIRECTORIES.join(' ')}; do [ -d "$d" ] && echo "${workdir}/$d" && break; done)`;

    return [
      `FROM ${BUILD_IMAGE} AS build`,
      `WORKDIR ${workdir}`,
      ...args,
      'COPY site/ /app/',
      `RUN ${install}`,
      `RUN ${build}`,
      // Resolved inside the build stage and copied to a fixed path, because COPY --from
      // cannot expand a shell expression.
      output
        ? `RUN cp -r ${outputExpr} /out`
        : `RUN out=${outputExpr}; [ -n "$out" ] || (echo "No build output found in ${DEFAULT_OUTPUT_DIRECTORIES.join(', ')}" && exit 1); cp -r "$out" /out`,
      '',
      'FROM caddy:alpine',
      'COPY Caddyfile /etc/caddy/Caddyfile',
      'COPY --from=build /out/ /srv/',
      '',
    ].join('\n');
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

  private async listOwnContainers(): Promise<OwnedContainer[]> {
    const filters = JSON.stringify({
      label: [
        `${LABEL_MANAGED}=true`,
        `${LABEL_PROJECT}=${this.projectKey()}`,
        `${LABEL_SITE}=default`,
      ],
    });
    return (
      (await dockerRequest<OwnedContainer[]>(
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

  /**
   * Make a previous deployment live again.
   *
   * Start it first, then stop everything else — same order as a deploy, so a reload during
   * a rollback reaches one of the two rather than nothing. No rebuild is involved: the
   * image is already there, which is the whole reason deployments are immutable images.
   */
  async rollbackTo(providerDeploymentId: string): Promise<ProviderDeployment> {
    const owned = await this.listOwnContainers();
    const target = owned.find((container) => container.Id === providerDeploymentId);
    if (!target) {
      // Retention removed it, or it belonged to another project. Either way there is
      // nothing to start, and saying so beats a Docker 404 the operator has to decode.
      throw new AppError(
        'That deployment is no longer on this host, so it cannot be restored.',
        404,
        ERROR_CODES.DEPLOYMENT_NOT_FOUND,
        'Deploy again — retention keeps only the most recent deployments.'
      );
    }

    await dockerRequest('POST', `/containers/${encodeURIComponent(target.Id)}/start`);
    for (const container of owned) {
      if (container.Id !== target.Id) {
        await dockerRequest('POST', `/containers/${container.Id}/stop?t=5`).catch(() => undefined);
      }
    }
    logger.info('Docker sites: rolled back', { containerId: target.Id });

    return this.getDeployment(target.Id);
  }

  /**
   * Keep the newest few deployments and remove the rest.
   *
   * Every deploy leaves behind a stopped container and an image, and nothing else reclaims
   * them — this is the boring maintenance that becomes "the disk filled up" on a 2GB VPS
   * six months from now. Retained rather than pruned to zero because those containers are
   * what rollback starts.
   *
   * What was removed is logged. A prune that quietly deletes the deployment someone was
   * about to roll back to reads as data loss.
   */
  private async pruneOwnResources(
    liveContainerId: string,
    keep = RETAINED_DEPLOYMENTS
  ): Promise<{ removedContainers: number; removedImages: number }> {
    const owned = await this.listOwnContainers();
    // Docker lists newest first; the live one is kept regardless of where it sorts.
    const removable = owned.filter((container) => container.Id !== liveContainerId).slice(keep - 1);

    let removedContainers = 0;
    const removedImages: string[] = [];
    for (const container of removable) {
      const image = container.Image;
      const gone = await dockerRequest('DELETE', `/containers/${container.Id}?force=true`)
        .then(() => true)
        .catch(() => false);
      if (!gone) {
        continue;
      }
      removedContainers++;
      if (image && image.startsWith(`insforge-site-${this.projectKey()}:`)) {
        // Only images this driver tagged for this project, and only after its container
        // is gone — Docker refuses an image still in use anyway.
        const imageRemoved = await dockerRequest('DELETE', `/images/${encodeURIComponent(image)}`)
          .then(() => true)
          .catch(() => false);
        if (imageRemoved) {
          removedImages.push(image);
        }
      }
    }

    if (removedContainers > 0) {
      logger.info('Docker sites: pruned old deployments', {
        keep,
        removedContainers,
        removedImages,
      });
    }
    return { removedContainers, removedImages: removedImages.length };
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
