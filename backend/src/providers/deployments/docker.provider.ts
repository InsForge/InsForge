import { createHash, randomBytes } from 'node:crypto';
import { createWriteStream, existsSync, statSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { hostname } from 'node:os';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import { pack as tarPack } from 'tar-stream';
import { appConfig } from '@/infra/config/app.config.js';
import {
  DockerHttpError,
  demuxDockerStream,
  dockerBuild,
  dockerConfig,
  dockerContainerLogs,
  dockerRequest,
  dockerRequestRaw,
} from '@/providers/compute/docker.client.js';
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
/**
 * The port a server container listens on, recorded because later operations need to know
 * two things a container cannot otherwise tell us: that this deployment is a server at all
 * — a static one is Caddy and answers instantly — and where to reach it. Rollback has to
 * wait for a server before stopping the live one, and the URL has to name the right port.
 * Absent on a static deployment, and on any container built before this label existed.
 */
const LABEL_SERVER_PORT = 'insforge.site.server-port';

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
 * The `try_files` chain is ordered so both shapes of site work, and it was measured on a
 * live deploy rather than reasoned about:
 *
 *   {path}              an exact file — assets, and any page requested with its extension
 *   {path}/index.html   a directory index, which is how Next export, Astro and Hugo emit
 *                       nested routes when trailingSlash is on
 *   {path}.html         the sibling file the same tools emit when it is off
 *   /index.html         the SPA fallback: a client-side route has no file at all, and
 *                       without this /dashboard/settings would 404 instead of loading
 *
 * The first version stopped after `{path} /index.html`, so every subpage of a multi-page
 * static export answered 200 with the *home page* — silently the wrong content, which is
 * worse than a 404.
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
	try_files {path} {path}/index.html {path}.html /index.html
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

/**
 * Where a server-rendered deployment listens inside its container.
 *
 * The same port a static site is served on, deliberately: the shipped gateway config targets
 * `insforge-site-<key>:80`, so a server on 3000 would leave that one static line pointing at
 * nothing — and the advertised URL reads a published port by number too. The app is told
 * which port to use through `PORT`, which every framework that documents a port respects.
 * Overridable for an operator who publishes the port directly, who then owns their own
 * gateway config anyway.
 */
const DEFAULT_SERVER_PORT = SITE_PORT;

/**
 * Ceilings for a server container.
 *
 * Not optional: the median self-host is a 2GB VPS running Postgres, PostgREST and Deno
 * beside this, and an unbounded Node process there OOMs the database before itself. Generous
 * enough for a Next server, and overridable per deployment.
 */
const DEFAULT_SERVER_MEMORY_MB = 512;
const DEFAULT_SERVER_CPUS = 1;

/** How long a freshly started server gets to answer before the deploy is called a failure. */
const SERVER_READY_TIMEOUT_MS = 60_000;
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

/**
 * A relative path inside the uploaded tree. Absolute or climbing paths are refused, and so
 * is anything outside a plain filename charset: these land in `WORKDIR` and in a `RUN cp`,
 * where a space becomes two shell words and a `;` or `$` becomes syntax. Quoting the copy
 * covers the space case, but a directory name is not a place to accept shell either way.
 */
function assertRelativePath(value: string, field: string): string {
  const normalized = path.posix.normalize(assertSingleLine(value, field).replace(/\\/g, '/'));
  if (normalized.startsWith('/') || normalized === '..' || normalized.startsWith('../')) {
    throw new AppError(
      `${field} must be a path inside the uploaded files.`,
      400,
      ERROR_CODES.INVALID_INPUT
    );
  }
  const trimmed = normalized.replace(/^\.\//, '').replace(/\/+$/, '');
  if (!/^[A-Za-z0-9._][A-Za-z0-9._/-]*$/.test(trimmed)) {
    throw new AppError(
      `${field} must be a plain relative path (letters, digits, dot, dash, underscore, slash).`,
      400,
      ERROR_CODES.INVALID_INPUT
    );
  }
  return trimmed;
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

/** What a deployment's container needs beyond its image: a server has a port, env and limits. */
interface RuntimeSpec {
  /** Set only for a server-rendered deployment; static sites are served on SITE_PORT. */
  serverPort?: number;
  envVars?: Array<{ key: string; value: string }>;
  memoryMb?: number;
  cpus?: number;
}

/** The port inside the container, which differs only when a server was told to use another. */
function containerPortFor(settings: {
  startCommand?: string | null;
  serverPort?: number | null;
}): number {
  return settings.startCommand?.trim() ? (settings.serverPort ?? DEFAULT_SERVER_PORT) : SITE_PORT;
}

/** The server port recorded on a container, or null for a static deployment. */
function serverPortOf(container: { Labels?: Record<string, string> }): number | null {
  const raw = container.Labels?.[LABEL_SERVER_PORT];
  if (!raw) {
    return null;
  }
  const port = Number.parseInt(raw, 10);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : null;
}

interface OwnedContainer {
  Id: string;
  State: string;
  Image?: string;
  Labels?: Record<string, string>;
}

/**
 * Docker's container states, mapped onto the deployment vocabulary the service records.
 *
 * A clean exit is how this driver *cancels* — `cancelDeployment` stops the container, and
 * a superseded deployment is stopped too — so reporting every `exited` as ERROR turned
 * every cancellation and every previous deployment into a failure. The exit code is what
 * separates the two.
 */
function readyStateFor(status: string, exitCode?: number): string {
  switch (status) {
    case 'running':
      return 'READY';
    case 'created':
    case 'restarting':
      return 'BUILDING';
    case 'exited':
      return exitCode === 0 ? 'CANCELED' : 'ERROR';
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

  /**
   * Serializes the switch — deploy and rollback both.
   *
   * Each one lists the containers it is replacing before creating its own, so two at once
   * snapshot the same list and neither sees the other: under ephemeral ports both end up
   * behind the stable alias, and under a fixed port the second fails on the binding. A
   * promise chain is the same tool the compute driver uses to cap concurrent builds, and it
   * covers what a self-host actually runs — one backend process against one daemon.
   */
  private switchQueue: Promise<unknown> = Promise.resolve();

  private serialize<T>(work: () => Promise<T>): Promise<T> {
    const next = this.switchQueue.then(work, work);
    // Keep the chain alive when a deploy fails: an unhandled rejection here would also
    // reject every switch queued behind it.
    this.switchQueue = next.catch(() => undefined);
    return next;
  }

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
    // A socket, not merely a path: a regular file at DOCKER_SOCKET_PATH would otherwise
    // register the driver and fail on every request instead of never registering.
    try {
      return statSync(dockerConfig().socketPath).isSocket();
    } catch {
      return false;
    }
  }

  /**
   * Every flag here is what this driver does *today*, not what it is planned to do.
   *
   * `envVars: 'runtime'` — a server-rendered deployment reads them from `process.env` on
   * every request, so they are injected as container environment and held (encrypted) for
   * the next deploy. They are *also* passed as build args, because a build usually needs
   * the same values; that half is baked into the artifact and into image history, which is
   * why a secret belongs in a variable the build does not touch.
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
      envVars: 'runtime',
      customDomains: false,
      slug: false,
      rollback: true,
      buildLogs: true,
      // Whatever the container wrote: the app's own output for a server, Caddy's startup and
      // errors for a static site. No access log there on purpose — one line per request into
      // an unrotated container log fills a small VPS.
      runtimeLogs: true,
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
    const target = this.stagedPath(sha);
    const scratch = `${target}.${randomBytes(6).toString('hex')}.part`;
    // Same reason as the streaming path: a reader must never see a half-written blob.
    await writeFile(scratch, fileContent);
    await rename(scratch, target);
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
    // Write beside the final name and rename on success.
    //
    // The caller's stream verifies sha and size as bytes pass through, so a mismatch or a
    // client disconnect aborts mid-write — and writing straight to the final path would
    // leave a truncated file there. Nothing downstream would notice: buildContext only
    // checks that the path exists, so the next deploy would tar corrupt bytes under a sha
    // that claims otherwise. A rename is atomic on the same filesystem, so a reader either
    // sees no file or sees a complete one. The suffix is random because two uploads of the
    // same sha can overlap.
    const scratch = `${target}.${randomBytes(6).toString('hex')}.part`;
    try {
      await pipeline(input.content, createWriteStream(scratch), { signal: input.signal });
      await rename(scratch, target);
    } catch (error) {
      await rm(scratch, { force: true });
      throw error;
    }
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

    const startCommand = settings.startCommand?.trim();
    if (startCommand && !buildCommand) {
      // A server has to be built before it can be started, and "upload a running app" is
      // not a thing. Refused rather than silently starting whatever was uploaded.
      throw new AppError(
        'A server-rendered deployment needs a build command as well as a start command.',
        400,
        ERROR_CODES.INVALID_INPUT
      );
    }

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
          startCommand: settings.startCommand,
          serverDirectory: settings.serverDirectory,
          serverPort: settings.serverPort,
          envKeys: (options.envVars ?? []).map((envVar) => envVar.key),
        })
      : SERVE_ONLY_DOCKERFILE;

    const context = await this.buildContext(served, dockerfile);
    // Env values join the digest because they are baked into the artifact: without them
    // two builds whose only difference is a value would share one tag, so the tag would
    // stop identifying what it names. (Docker does rebuild in that case — a declared ARG's
    // value is part of the cache key for the instructions after it, measured on the
    // classic builder — so this is about identity, not staleness.)
    const digest = createHash('sha256')
      .update(context)
      .update(
        (options.envVars ?? [])
          .map((envVar) => `${envVar.key}=${envVar.value}`)
          .sort()
          .join('\u0000')
      )
      .digest('hex')
      .slice(0, 12);
    const imageTag = `insforge-site-${this.projectKey()}:${digest}`;

    const build = await dockerBuild({
      context,
      tag: imageTag,
      buildArgs: Object.fromEntries(
        (options.envVars ?? []).map((envVar) => [assertEnvKey(envVar.key), envVar.value])
      ),
    });
    if (!build.ok) {
      // The tail of the build goes into the message, because that is the only channel the
      // caller gets on a failure: `build.logs` is discarded with the rest of this call, and
      // the metadata write that records logs on success is never reached. Without it the
      // operator is told "build failed" and nothing else.
      const tail = build.logs?.length ? `\n\n${build.logs.slice(-20).join('\n')}` : '';
      throw new AppError(
        `${build.error ?? 'Site image build failed.'}${tail}`,
        502,
        ERROR_CODES.UPSTREAM_FAILURE,
        'Check the build command and the build output above.'
      );
    }

    const containerId = await this.runContainer(imageTag, digest, {
      serverPort: startCommand ? (settings.serverPort ?? DEFAULT_SERVER_PORT) : undefined,
      envVars: options.envVars,
    });
    // Housekeeping, after the site is already serving. A failure here — the daemon
    // refusing a list, an image still referenced — must not reject a deployment that is
    // live: the caller would record it as ERROR while the new container answers requests,
    // and the next deploy prunes anyway.
    const retained = await this.pruneOwnResources(containerId).catch((error: unknown) => {
      logger.warn('Docker sites: retention pass failed; the deployment is live regardless', {
        error: error instanceof Error ? error.message : String(error),
      });
      return { removedContainers: 0, removedImages: 0 };
    });
    const sweptBlobs = await this.sweepStaging();
    logger.info('Docker sites: deployed', {
      imageTag,
      containerId,
      files: files.length,
      ...retained,
      sweptBlobs,
    });

    return {
      id: containerId,
      url: await this.endpointUrl(containerId, undefined, containerPortFor(settings)),
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
   * A two-stage image whose second stage depends on what is being deployed.
   *
   * Static: the build output is copied into Caddy and the toolchain is discarded.
   * Server: the app is copied into `node:22-alpine` and started, because a server-rendered
   * site is a process, not a directory. `startCommand` decides which — declared, since a
   * Dockerfile's `FROM` cannot branch on what the build produced.
   */
  private buildStageDockerfile(params: {
    buildCommand: string;
    installCommand?: string | null;
    outputDirectory?: string | null;
    rootDirectory?: string | null;
    startCommand?: string | null;
    serverDirectory?: string | null;
    serverPort?: number | null;
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

    const start = params.startCommand?.trim()
      ? assertSingleLine(params.startCommand.trim(), 'startCommand')
      : '';

    const buildStage = [
      `FROM ${BUILD_IMAGE} AS build`,
      `WORKDIR ${workdir}`,
      ...args,
      'COPY site/ /app/',
      `RUN ${install}`,
      `RUN ${build}`,
    ];

    if (!start) {
      // Static: only the built output crosses into the serving stage, so node_modules and
      // the toolchain never reach the image that runs.
      return [
        ...buildStage,
        // Resolved inside the build stage and copied to a fixed path, because COPY --from
        // cannot expand a shell expression.
        output
          ? `RUN cp -r "${outputExpr}" /out`
          : `RUN out=${outputExpr}; [ -n "$out" ] || { echo "No build output found in ${DEFAULT_OUTPUT_DIRECTORIES.join(', ')}"; exit 1; }; cp -r "$out" /out`,
        '',
        'FROM caddy:alpine',
        'COPY Caddyfile /etc/caddy/Caddyfile',
        'COPY --from=build /out/ /srv/',
        '',
      ].join('\n');
    }

    // Server: the app is a process, so the runtime stage is Node and the whole runnable
    // directory crosses over. `serverDirectory` is what keeps that from meaning "and all of
    // node_modules" — a Next app built with output: 'standalone' points at `.next/standalone`.
    const serverDir = params.serverDirectory
      ? assertRelativePath(params.serverDirectory, 'serverDirectory')
      : '';
    const port = params.serverPort ?? DEFAULT_SERVER_PORT;
    const runtimeSource = serverDir ? `${workdir}/${serverDir}` : workdir;

    return [
      ...buildStage,
      `RUN cp -r "${runtimeSource}" /out`,
      '',
      `FROM ${BUILD_IMAGE}`,
      'WORKDIR /app',
      'COPY --from=build /out/ ./',
      // The values are supplied per deployment as container env; these are the two a Node
      // server needs regardless, and HOSTNAME matters because a server bound to localhost
      // inside a container is unreachable from the gateway.
      'ENV NODE_ENV=production',
      `ENV PORT=${port}`,
      'ENV HOSTNAME=0.0.0.0',
      `EXPOSE ${port}`,
      `CMD ${start}`,
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

  /**
   * Namespace for labels, container names and image tags.
   *
   * `APP_KEY`, the same key the Docker compute driver uses, and deliberately not
   * `PROJECT_ID`: a self-host usually has no project id, so every instance collapsed to
   * `local` — and two InsForge instances sharing one daemon would list, stop and prune
   * each other's site containers. APP_KEY is per-instance and generated at setup.
   */
  private projectKey(): string {
    // Not truncated. The shipped gateway config targets `insforge-site-{$APP_KEY}`, so any
    // clipping here would silently stop the alias from matching the upstream — a failure
    // Caddy accepts at load and can never recover from. The compute driver does not clip
    // either, and Docker's own limits on names, labels and tags are far above any APP_KEY.
    return process.env.APP_KEY || 'local';
  }

  /**
   * The project's compose network, found by inspecting our own container.
   *
   * Compose namespaces networks per project (`myproj_insforge-network`), so it cannot be
   * guessed, and Docker sets the container hostname to the short container id — which is
   * the handle on ourselves. Without a network the site still runs and still publishes a
   * port; it just has no stable DNS name for a gateway to point at.
   *
   * Not cached on failure: a daemon blip during the first deploy would otherwise pin
   * `null` for the process lifetime and leave every later container off the network — the
   * exact thing this lookup exists to prevent. Same reasoning as the compute driver.
   */
  private async resolveNetwork(): Promise<string | null> {
    if (this.ownNetwork) {
      return this.ownNetwork;
    }
    try {
      const self = await dockerRequest<{
        NetworkSettings?: { Networks?: Record<string, unknown> };
      }>('GET', `/containers/${encodeURIComponent(hostname())}/json`);
      const names = Object.keys(self?.NetworkSettings?.Networks ?? {}).filter(
        (name) => !['bridge', 'host', 'none'].includes(name)
      );
      this.ownNetwork = names[0] ?? null;
      return this.ownNetwork;
    } catch (error) {
      // Not fatal: the backend may not be in a container at all (local dev against a host
      // daemon). The site lands on the default bridge and keeps its published port.
      logger.warn('Docker sites: own-container inspect failed; no stable alias', {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  private ownNetwork: string | null = null;

  /**
   * The DNS name a gateway points at, stable across deploys.
   *
   * Container *names* change every deploy — they carry the digest so redeploys do not
   * collide — so the handle has to be an alias instead.
   */
  private stableAlias(): string {
    return `${CONTAINER_PREFIX}-${this.projectKey()}`;
  }

  /**
   * Start the new container, then stop the previous one.
   *
   * This order is the atomic switch: the new site is already answering before the old one
   * stops, so a reload during a deploy gets one of the two rather than a connection
   * refused. The old container is kept, not removed — that is what rollback starts.
   */
  private async runContainer(
    imageTag: string,
    digest: string,
    runtime: RuntimeSpec = {}
  ): Promise<string> {
    return this.serialize(() => this.runContainerExclusively(imageTag, digest, runtime));
  }

  private async runContainerExclusively(
    imageTag: string,
    digest: string,
    runtime: RuntimeSpec
  ): Promise<string> {
    const previous = await this.listOwnContainers();
    // Retention keeps stopped containers on purpose, so `previous` is not "the live site" —
    // it is every deployment still on the host. Recovery must put back only what was
    // running: starting them all under a fixed port is a race whose winner might be a
    // superseded deployment, and the loser fails on the port anyway.
    const wasRunning = previous.filter((container) => container.State === 'running');
    const network = await this.resolveNetwork();
    const fixedPort = appConfig.deployments.sitesPort;
    // One boolean, used twice: deciding the order with `=== 0` in one place and `> 0` in
    // the other let an unset value fall through both branches, so nothing stopped the old
    // container at all.
    const stopBeforeStarting = fixedPort > 0;

    // Not the digest alone. Retention keeps previous containers on purpose, so
    // redeploying byte-identical content — "re-run the deploy, nothing changed" — would
    // ask Docker for a name that still exists and get a 409. The suffix makes each
    // attempt its own container, which the deployments table needs anyway:
    // `provider_deployment_id` is UNIQUE, so two rows cannot share one container.
    //
    // Random rather than a timestamp: two deploys inside the same millisecond would
    // collide again, which is a race a clock cannot fix and a test found immediately.
    const name = `${CONTAINER_PREFIX}-${this.projectKey()}-${digest}-${randomBytes(3).toString('hex')}`;
    // A server listens where it was told to; a static site is always Caddy on SITE_PORT.
    const containerPort = runtime.serverPort ?? SITE_PORT;
    // Published under both ingress modes: `host` needs somewhere for the operator's
    // gateway to proxy to, so only the address we advertise differs.
    const exposed = `${containerPort}/tcp`;

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
            ...(runtime.serverPort ? { [LABEL_SERVER_PORT]: String(runtime.serverPort) } : {}),
          },
          ExposedPorts: { [exposed]: {} },
          // Only a server reads these at request time. A static image has nothing to read
          // them with, so passing them would just put values in an inspect output.
          ...(runtime.serverPort && runtime.envVars?.length
            ? { Env: runtime.envVars.map((envVar) => `${envVar.key}=${envVar.value}`) }
            : {}),
          HostConfig: {
            RestartPolicy: { Name: 'unless-stopped' },
            // Ceilings, and not optional for a server: the median self-host is a 2GB VPS
            // running Postgres beside this, where an unbounded Node process OOMs the
            // database before itself. A static Caddy container needs no ceiling worth
            // setting.
            ...(runtime.serverPort
              ? {
                  Memory: (runtime.memoryMb ?? DEFAULT_SERVER_MEMORY_MB) * 1024 * 1024,
                  NanoCpus: Math.round((runtime.cpus ?? DEFAULT_SERVER_CPUS) * 1e9),
                }
              : {}),
            // Loopback by default, like compute: publishing to 0.0.0.0 on a reachable
            // host is a deliberate choice, not something a default should make.
            PortBindings: {
              [exposed]: [
                {
                  HostIp: dockerConfig().bindAddress,
                  HostPort: fixedPort > 0 ? String(fixedPort) : '',
                },
              ],
            },
          },
          ...(network
            ? {
                NetworkingConfig: {
                  EndpointsConfig: {
                    // A stable name on the project network, so a gateway config can be one
                    // static line — `reverse_proxy insforge-site-<key>:80` — with no label
                    // discovery plugin and no rewriting on each deploy. The alias is shared
                    // for the moment both containers run, which round-robins between two
                    // healthy versions rather than opening an error window; the old
                    // container's DNS entry disappears when it stops.
                    [network]: { Aliases: [this.stableAlias()] },
                  },
                },
              }
            : {}),
        },
      }
    );
    if (!created?.Id) {
      // Nothing was stopped yet — the stop moved inside the try below — so there is nothing
      // to put back here.
      throw new AppError(
        `Docker returned no container id for ${name}.`,
        502,
        ERROR_CODES.UPSTREAM_FAILURE
      );
    }

    try {
      // With a fixed host port the switch cannot overlap — two containers cannot bind the
      // same port — so the old one goes down first. Measured cost: ~870ms of refused
      // connections. Without it the new container binds an ephemeral port while the old one
      // still serves, which is gapless but changes the address every deploy. The operator
      // picks by setting SITES_PORT, and a gateway in front makes the whole question moot.
      //
      // Deliberately here rather than before `create`: creating a container binds no port,
      // so stopping earlier only widened the outage — and a create that failed (missing
      // image, name collision, disk full) fell outside the recovery below and left the site
      // down with nothing restarted.
      if (stopBeforeStarting) {
        for (const container of previous) {
          await dockerRequest('POST', `/containers/${container.Id}/stop?t=5`).catch(
            () => undefined
          );
        }
      }
      await dockerRequest('POST', `/containers/${created.Id}/start`);
      if (runtime.serverPort) {
        // A Caddy container answers the moment it starts; a Node server takes seconds and
        // crash-loops on a missing variable or a bad build. Switching before it serves
        // would stop the old deployment and hand traffic to something that is not up.
        await this.waitUntilServing(created.Id, runtime.serverPort);
      }
    } catch (error) {
      // A container that will not start must not be left behind looking deployable.
      await dockerRequest('DELETE', `/containers/${created.Id}?force=true`).catch(() => undefined);
      if (stopBeforeStarting) {
        // Under a fixed port the previous deployment was already stopped to free the port,
        // so failing here would leave the site down until someone noticed. Put it back —
        // only the ones that were serving, not every retained deployment.
        for (const container of wasRunning) {
          await dockerRequest('POST', `/containers/${container.Id}/start`).catch(() => undefined);
        }
        logger.warn('Docker sites: replacement failed; restarted the previous deployment', {
          restored: wasRunning.map((container) => container.Id),
        });
      }
      throw error;
    }

    if (!stopBeforeStarting) {
      // Started before stopping, which is the gapless order. With a fixed port the stops
      // already happened above.
      for (const container of previous) {
        await dockerRequest('POST', `/containers/${container.Id}/stop?t=5`).catch(() => undefined);
      }
    }

    return created.Id;
  }

  /**
   * Wait for a server container to answer, or fail the deploy.
   *
   * Asked from inside the container rather than through the published port: under `host`
   * ingress there may be no host port at all, and a request from the daemon's network
   * proves the thing a gateway will actually reach. Any HTTP status counts — a 404 from a
   * server that is listening is still a server that is up; what fails is a connection
   * refused, or a container that exited.
   */
  private async waitUntilServing(containerId: string, port: number): Promise<void> {
    const deadline = Date.now() + SERVER_READY_TIMEOUT_MS;
    let lastReason = 'no attempt completed';

    while (Date.now() < deadline) {
      const inspected = await dockerRequest<{
        State: { Status: string; ExitCode?: number; Error?: string };
      }>('GET', `/containers/${encodeURIComponent(containerId)}/json`).catch(() => undefined);
      const status = inspected?.State?.Status;
      if (status === 'exited' || status === 'dead') {
        const logs = await this.tailLogs(containerId, 20);
        throw new AppError(
          `The server exited before it started serving.\n\n${logs}`,
          502,
          ERROR_CODES.UPSTREAM_FAILURE,
          'Check the start command and the environment variables the app needs.'
        );
      }

      const probe = await this.execProbe(containerId, port);
      if (probe.ok) {
        logger.info('Docker sites: server is serving', { containerId, port });
        return;
      }
      lastReason = probe.reason;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    const logs = await this.tailLogs(containerId, 20);
    throw new AppError(
      `The server did not answer on port ${port} within ${SERVER_READY_TIMEOUT_MS / 1000}s ` +
        `(${lastReason}).\n\n${logs}`,
      504,
      ERROR_CODES.UPSTREAM_FAILURE,
      'Make sure the app listens on the PORT it is given and binds 0.0.0.0, not localhost.'
    );
  }

  /**
   * One HTTP attempt from inside the container, via exec.
   *
   * `wget` rather than a host-side fetch because the container may publish no host port,
   * and node:alpine ships busybox wget. Exit code 0 means it got a response.
   */
  private async execProbe(
    containerId: string,
    port: number
  ): Promise<{ ok: boolean; reason: string }> {
    try {
      const created = await dockerRequest<{ Id: string }>(
        'POST',
        `/containers/${encodeURIComponent(containerId)}/exec`,
        {
          body: {
            AttachStdout: true,
            AttachStderr: true,
            // `-S` prints the response line, and grep is what decides: any `HTTP/` at all
            // means something answered, while a refused connection prints "can't connect"
            // and nothing else. Exit code alone could not tell those apart — busybox wget
            // exits 1 for a 404 as well as for a dead port — so an app whose `/` is a 404,
            // a 401 or a 500 used to fail its own deploy despite being up.
            Cmd: [
              'sh',
              '-c',
              `wget -S -T 2 -O /dev/null http://127.0.0.1:${port}/ 2>&1 | grep -q 'HTTP/'`,
            ],
          },
        }
      );
      if (!created?.Id) {
        return { ok: false, reason: 'could not exec a probe' };
      }
      await dockerRequestRaw('POST', `/exec/${created.Id}/start`, {
        body: { Detach: false, Tty: false },
      });
      const result = await dockerRequest<{ ExitCode: number | null }>(
        'GET',
        `/exec/${created.Id}/json`
      );
      // 0 now means "a response arrived", whatever its status, because grep decided that
      // rather than wget's own exit code.
      return result?.ExitCode === 0
        ? { ok: true, reason: 'ok' }
        : { ok: false, reason: `probe exit ${result?.ExitCode ?? 'unknown'}` };
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : 'probe failed' };
    }
  }

  /** The tail of a container's output, for an error message that can be acted on. */
  private async tailLogs(containerId: string, lines: number): Promise<string> {
    try {
      const raw = await dockerRequestRaw(
        'GET',
        `/containers/${encodeURIComponent(containerId)}/logs?stdout=true&stderr=true&tail=${lines}`
      );
      const text = demuxDockerStream(raw.body)
        .map((frame) => frame.text)
        .join('')
        .trim();
      return text ? `Last ${lines} lines:\n${text}` : '(the container produced no output)';
    } catch {
      return '(could not read the container output)';
    }
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
    const inspected = await this.inspectContainer(providerDeploymentId);

    const status = inspected.State.Status;
    return {
      id: inspected.Id,
      // The container's own port, not the static default: a server on 3000 would otherwise
      // be looked up as `80/tcp`, come back null, and a sync or rollback would erase the
      // URL of a deployment that is serving perfectly well.
      url: await this.endpointUrl(
        inspected.Id,
        inspected,
        serverPortOf({ Labels: inspected.Config.Labels }) ?? SITE_PORT
      ),
      state: status,
      readyState: readyStateFor(status, inspected.State.ExitCode),
      name: inspected.Config.Image,
      createdAt: new Date(inspected.Created),
      ...(inspected.State.Error ? { error: { code: status, message: inspected.State.Error } } : {}),
    };
  }

  /**
   * Inspect, with Docker's 404 turned into a deployment that is gone.
   *
   * Retention removes containers while their rows stay, so syncing an old row is the normal
   * way to reach a container that no longer exists. `dockerRequest` throws
   * `DockerHttpError` there — never returns undefined — so the old `if (!inspected)` guard
   * was unreachable and the caller reported a 500 INTERNAL_ERROR for an ordinary
   * "pruned by retention".
   */
  private async inspectContainer(providerDeploymentId: string): Promise<{
    Id: string;
    Name: string;
    Created: string;
    State: { Status: string; Error?: string; ExitCode?: number };
    Config: { Image: string; Labels?: Record<string, string> };
    NetworkSettings?: { Ports?: Record<string, { HostPort: string }[] | null> };
  }> {
    const inspected = await dockerRequest<{
      Id: string;
      Name: string;
      Created: string;
      State: { Status: string; Error?: string; ExitCode?: number };
      Config: { Image: string; Labels?: Record<string, string> };
      NetworkSettings?: { Ports?: Record<string, { HostPort: string }[] | null> };
    }>('GET', `/containers/${encodeURIComponent(providerDeploymentId)}/json`).catch(
      (error: unknown) => {
        if (error instanceof DockerHttpError && error.status === 404) {
          throw new AppError(
            'That deployment is no longer on this host.',
            404,
            ERROR_CODES.DEPLOYMENT_NOT_FOUND,
            'Retention keeps only the most recent deployments; deploy again to get a new one.'
          );
        }
        throw error;
      }
    );

    if (!inspected) {
      throw new AppError('Deployment not found.', 404, ERROR_CODES.DEPLOYMENT_NOT_FOUND);
    }
    return inspected;
  }

  /**
   * Make a previous deployment live again.
   *
   * Start it first, then stop everything else — same order as a deploy, so a reload during
   * a rollback reaches one of the two rather than nothing. No rebuild is involved: the
   * image is already there, which is the whole reason deployments are immutable images.
   */
  async rollbackTo(providerDeploymentId: string): Promise<ProviderDeployment> {
    return this.serialize(() => this.rollbackToExclusively(providerDeploymentId));
  }

  private async rollbackToExclusively(providerDeploymentId: string): Promise<ProviderDeployment> {
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

    const others = owned.filter((container) => container.Id !== target.Id);
    // Two different sets, and conflating them is a bug either way. *Stopping* has to cover
    // every other container: `paused` still holds the fixed port and `restarting` will take
    // it back. *Restoring* after a failure may only touch what was actually serving, or a
    // superseded deployment races the live one for the port.
    const othersRunning = others.filter((container) => container.State === 'running');
    const fixedPort = appConfig.deployments.sitesPort;

    // A server takes seconds to answer and can crash-loop on config it no longer has, so
    // "Docker accepted start" is not "the site is back". Static rollbacks skip this: Caddy
    // serves as soon as it starts, and the label is absent there.
    const serverPort = serverPortOf(target);

    if (fixedPort > 0) {
      // Two containers cannot hold one host port, so starting the target first would just
      // fail. Stop the live one, then bring the target up — and put the live one back if
      // the target will not start, rather than leaving nothing serving.
      for (const container of others) {
        await dockerRequest('POST', `/containers/${container.Id}/stop?t=5`).catch(() => undefined);
      }
      try {
        await dockerRequest('POST', `/containers/${encodeURIComponent(target.Id)}/start`);
        if (serverPort) {
          await this.waitUntilServing(target.Id, serverPort);
        }
      } catch (error) {
        // The target holds the port and may be crash-looping; stop it before handing the
        // port back, or the restart below loses the race to it.
        await dockerRequest('POST', `/containers/${encodeURIComponent(target.Id)}/stop?t=5`).catch(
          () => undefined
        );
        for (const container of othersRunning) {
          await dockerRequest('POST', `/containers/${container.Id}/start`).catch(() => undefined);
        }
        throw error;
      }
    } else {
      await dockerRequest('POST', `/containers/${encodeURIComponent(target.Id)}/start`);
      if (serverPort) {
        // Nothing has been stopped yet, so a target that will not serve leaves the current
        // deployment untouched — the rollback simply fails. But it must not be left running:
        // it shares the network alias, so the gateway would round-robin into a broken
        // deployment behind a site that is otherwise fine.
        try {
          await this.waitUntilServing(target.Id, serverPort);
        } catch (error) {
          await dockerRequest(
            'POST',
            `/containers/${encodeURIComponent(target.Id)}/stop?t=5`
          ).catch(() => undefined);
          throw error;
        }
      }
      for (const container of others) {
        await dockerRequest('POST', `/containers/${container.Id}/stop?t=5`).catch(() => undefined);
      }
    }
    logger.info('Docker sites: rolled back', { containerId: target.Id });

    return this.getDeployment(target.Id);
  }

  /**
   * Delete staged blobs older than a day.
   *
   * Staging only bridges upload and build: once an image exists the bytes live in it, and
   * rollback starts an image rather than re-tarring. Nothing else reclaimed them, so every
   * deployment left its files behind for good — including the files of builds that failed,
   * which is the case most likely to repeat. A day is long enough that an upload waiting on
   * a slow client is never swept out from under the build that follows it.
   */
  private async sweepStaging(maxAgeMs = 24 * 60 * 60 * 1000): Promise<number> {
    const dir = this.stagingDir();
    let swept = 0;
    try {
      const entries = await readdir(dir);
      const cutoff = Date.now() - maxAgeMs;
      for (const entry of entries) {
        const full = path.join(dir, entry);
        try {
          const info = await stat(full);
          if (info.isFile() && info.mtimeMs < cutoff) {
            await rm(full, { force: true });
            swept++;
          }
        } catch {
          // Raced with another sweep or another deploy. Nothing to do.
        }
      }
    } catch {
      // No staging directory yet, which is the state before the first upload.
      return 0;
    }
    if (swept > 0) {
      logger.info('Docker sites: swept staged files', { swept, dir });
    }
    return swept;
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

  /**
   * A page of the deployment's own output.
   *
   * Ownership is checked first: a deployment id is a container id, and a caller who guessed
   * another container's id would otherwise read a neighbouring stack's logs — which on a
   * shared daemon means Postgres.
   */
  async runtimeLogs(
    providerDeploymentId: string,
    options?: { limit?: number; nextToken?: string }
  ): Promise<{ lines: Array<{ timestamp: number; message: string }>; nextToken: string | null }> {
    await this.assertOwnContainer(providerDeploymentId);
    return dockerContainerLogs(providerDeploymentId, options);
  }

  /** Refuse an id this project's labels do not cover. */
  private async assertOwnContainer(containerId: string): Promise<void> {
    const owned = await this.listOwnContainers();
    if (!owned.some((container) => container.Id === containerId)) {
      throw new AppError(
        'That deployment is not on this host.',
        404,
        ERROR_CODES.DEPLOYMENT_NOT_FOUND
      );
    }
  }

  /**
   * Stopping is the cancel: the image stays, so the deployment can be started again.
   *
   * Ownership checked first, for the same reason `runtimeLogs` checks it — a deployment id
   * is a container id, and an id that is not ours would stop a neighbouring container on
   * the shared daemon. Reading the wrong logs is a leak; stopping the wrong container takes
   * the database down.
   */
  async cancelDeployment(providerDeploymentId: string): Promise<void> {
    await this.assertOwnContainer(providerDeploymentId);
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
    inspected?: { NetworkSettings?: { Ports?: Record<string, { HostPort: string }[] | null> } },
    containerPort: number = SITE_PORT
  ): Promise<string | null> {
    const config = dockerConfig();
    const domain = appConfig.deployments.sitesDomain;

    if (this.capabilities().defaultIngress === 'host') {
      return domain ? `https://${this.projectKey()}.${domain}` : null;
    }

    if (!config.publicHost) {
      return null;
    }
    // A fixed port is stable by definition, so there is nothing to read back.
    const fixedPort = appConfig.deployments.sitesPort;
    if (fixedPort > 0) {
      return `http://${config.publicHost}:${fixedPort}`;
    }
    // Reuse the caller's inspect when it has one: the read path already fetched this.
    const details =
      inspected ??
      (await dockerRequest<{
        NetworkSettings: { Ports: Record<string, { HostPort: string }[] | null> };
      }>('GET', `/containers/${encodeURIComponent(containerId)}/json`));
    const port = details?.NetworkSettings?.Ports?.[`${containerPort}/tcp`]?.[0]?.HostPort;
    return port ? `http://${config.publicHost}:${port}` : null;
  }
}
