import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { hostname } from 'node:os';
import { cpuTierToCores } from '@insforge/shared-schemas';
import { isCloudEnvironment } from '@/utils/environment.js';
import logger from '@/utils/logger.js';
import {
  MachineGoneError,
  translateMachineGone,
  type ComputeProvider,
  type ComputeCapabilities,
  type ComputeEvent,
  type ComputeLogLine,
  type ComputeLogsResult,
  type LaunchMachineParams,
  type MachineSummary,
  type UpdateMachineParams,
} from './compute.provider.js';
import {
  DockerHttpError,
  dockerBuild,
  demuxDockerStream,
  dockerConfig,
  dockerRequest,
  dockerRequestRaw,
  parseLogLine,
} from './docker.client.js';

/** Labels every managed container carries. Scoping reads and writes to these is
 * not defensive politeness — it is the difference between stopping a service and
 * stopping Postgres. Measured on a real host: from inside a container with the
 * socket mounted, an unfiltered `docker ps` lists the whole stack, including the
 * backend itself. */
const LABEL_MANAGED = 'insforge.managed';
const LABEL_PROJECT = 'insforge.project';
const LABEL_SERVICE = 'insforge.service';
// Hash of the immutable part of the spec, so an update can tell an in-place
// resize from a change that requires recreating the container.
const LABEL_SPEC = 'insforge.spec';

type ContainerInspect = {
  Id: string;
  Name: string;
  State: { Status: string; ExitCode: number; Running: boolean };
  Config: { Image: string; Labels?: Record<string, string> };
  HostConfig?: { NanoCpus?: number; Memory?: number };
  NetworkSettings: {
    Ports?: Record<string, { HostIp: string; HostPort: string }[] | null>;
    Networks?: Record<string, unknown>;
  };
};

export type DockerIngress = 'none' | 'port' | 'host';

/** Service names are DNS-safe, but a filter built by concatenation should not assume it. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * True when this backend belongs to a cloud-managed project.
 *
 * Both signals are checked because they answer slightly different questions and
 * either one being true is disqualifying: `isCloudEnvironment()` asks "am I
 * running on InsForge Cloud infrastructure", while a configured cloud compute
 * pair asks "is this project's control plane elsewhere". A guard that protects
 * tenant isolation should fail closed on either.
 */
export class DockerProvider implements ComputeProvider {
  private static instance: DockerProvider;

  static getInstance(): DockerProvider {
    if (!DockerProvider.instance) {
      DockerProvider.instance = new DockerProvider();
    }
    return DockerProvider.instance;
  }

  readonly name = 'docker' as const;

  /**
   * Docker has no scale-to-zero equivalent (waking a stopped container on an
   * inbound request needs a proxy in front, which is Phase 4), and one daemon is
   * one place — so `regions` is false and the service normalizes the field.
   *
   * Note there is deliberately no `privileged` capability: this driver never
   * emits a privileged HostConfig at all. It constructs the container spec itself
   * from a fixed set of fields and never forwards a caller-supplied HostConfig,
   * which is what makes a leaked API key unable to obtain host control through
   * container creation — there is no field in which `Privileged` or `Binds` could
   * be smuggled, so there is nothing to declare.
   */
  readonly capabilities: ComputeCapabilities = {
    scaleToZero: false,
    regions: false,
    // All three are available on one host. `none` leads because most compute
    // takes no inbound traffic at all.
    ingressModes: ['none', 'port', 'host'],
    sourceBuild: 'context-upload',
    deployTokenIssuance: false,
  };

  private ownNetwork: string | null | undefined;

  /**
   * Presence of a reachable socket is the operator's opt-in: they add the mount
   * to their compose file, and the driver appears. Kept synchronous to match the
   * interface — real reachability is proven by preflight().
   *
   * **Self-host only, enforced here rather than assumed.** This driver's entire
   * safety argument is that the operator and the developer deploying containers
   * are the same principal — whoever runs the box could already SSH into it. On a
   * cloud-managed project that is false: the operator is InsForge and the
   * developer is a customer, so letting a customer create containers on the host
   * is a tenant escape, and even an unprivileged container consumes shared
   * capacity and can reach the internal network.
   *
   * Cloud does not mount the socket today, so this would be unreachable in
   * practice — but "unreachable because nobody mounted it" is a deployment
   * accident away from being wrong, and the failure would be silent.
   *
   * The signal is `AWS_INSTANCE_PROFILE_NAME`, which cloud provisioning always sets:
   * the user-data script writes it unconditionally and every instance is launched with
   * an IAM instance profile. PROJECT_ID is deliberately *not* part of this test.
   * `.env.example` ships the variable, every compose file passes it through, and
   * `getProjectId()` documents it as the self-hosted way to scope services — so a
   * self-hoster setting it is expected, and reading it as "cloud" refused to register
   * this driver on their own machine with nothing in the UI to explain why. A
   * cloud-proxied deployment with no instance profile would slip past this, which our
   * provisioning does not produce; that is the accepted trade rather than an oversight.
   */
  isConfigured(): boolean {
    if (isCloudEnvironment()) {
      return false;
    }
    return existsSync(dockerConfig().socketPath);
  }

  /**
   * Prove the socket actually answers, and report what we are talking to.
   *
   * Called at startup so a misconfigured mount fails with something actionable
   * instead of 500-ing on the operator's first deploy. Also surfaces the
   * platform facts that decide whether this host is supported at all (rootless
   * mode, OS type).
   */
  async preflight(): Promise<{ version: string; os: string; rootless: boolean }> {
    const version = await dockerRequest<{ Version: string; Os: string }>('GET', '/version');
    const info = await dockerRequest<{ SecurityOptions?: string[] }>('GET', '/info');
    if (!version?.Version) {
      throw new Error('Docker /version returned no version');
    }
    const rootless = (info?.SecurityOptions ?? []).some((o) => o.includes('rootless'));
    return { version: version.Version, os: version.Os ?? 'unknown', rootless };
  }

  // ---------------------------------------------------------------- naming ---

  /**
   * Container name. Namespaced by APP_KEY because one host commonly runs several
   * InsForge projects (the docs describe exactly that), and two projects both
   * deploying a service called `api` would otherwise collide on one daemon.
   */
  resolveAppName(params: { name: string; projectId: string }): string {
    return `insforge-${this.projectKey()}-${params.name}`;
  }

  /**
   * Always null: ingress is per-service, and this synchronous signature has no
   * way to know which mode a given service asked for. launchMachine and
   * updateMachine return the authoritative URL, which the service persists.
   */
  endpointUrl(_appId: string): string | null {
    return null;
  }

  private projectKey(): string {
    return process.env.APP_KEY || 'local';
  }

  /**
   * The operator's deployment-wide default, read per call because it is a stored
   * setting they can change without restarting.
   */
  defaultIngress(): DockerIngress {
    return this.ingressFor();
  }

  /**
   * Ingress for one call: the service's own choice, else the operator's
   * deployment-wide default, else private-only.
   */
  private ingressFor(requested?: string): DockerIngress {
    const v = requested ?? dockerConfig().defaultIngress;
    return v === 'port' || v === 'host' ? v : 'none';
  }

  // ------------------------------------------------------------ app-scoped ---

  /**
   * No-op beyond ensuring the project network exists. Docker has no "app"
   * grouping above the container, so the app id is the container name and the
   * container itself is created by launchMachine.
   */
  async createApp(_params: { name: string }): Promise<{ appId: string }> {
    await this.resolveNetwork();
    return { appId: _params.name };
  }

  /**
   * Nothing to destroy: the container is removed by destroyMachine, and the
   * network is shared with the rest of the project's stack so it must outlive
   * any one service.
   */
  async destroyApp(_appId: string): Promise<void> {
    return Promise.resolve();
  }

  // -------------------------------------------------------------- networking ---

  /**
   * The project's own compose network, discovered by inspecting our own
   * container.
   *
   * Compose namespaces networks per project (`myproj_insforge-network`), so the
   * name cannot be guessed. Docker sets the container hostname to the short
   * container id by default, which gives us a handle on ourselves.
   *
   * Attaching by default is deliberate: the product promise is that containers
   * sit next to the project's database and storage, and forcing them out to the
   * public URL costs a TLS handshake plus a round trip and depends on the
   * operator's firewall allowing it — measured on EC2, a closed security group
   * turns that path into a silent hang rather than an error.
   */
  private async resolveNetwork(): Promise<string | null> {
    if (this.ownNetwork !== undefined) {
      return this.ownNetwork;
    }
    if (dockerConfig().isolateNetwork) {
      this.ownNetwork = null;
      return null;
    }
    try {
      const self = await dockerRequest<ContainerInspect>(
        'GET',
        `/containers/${encodeURIComponent(hostname())}/json`
      );
      const names = Object.keys(self?.NetworkSettings?.Networks ?? {}).filter(
        (n) => !['bridge', 'host', 'none'].includes(n)
      );
      this.ownNetwork = names[0] ?? null;
      if (!this.ownNetwork) {
        logger.warn(
          'Docker compute: could not identify the project network; containers will use the default bridge ' +
            'and will not resolve `postgres`/`postgrest` by name.'
        );
      }
    } catch (error) {
      // Not fatal — the backend may not be running in a container at all (local
      // dev against a host daemon). Containers land on the default bridge.
      //
      // Deliberately not cached. A daemon blip during the first launch would
      // otherwise pin `null` for the rest of the process lifetime and detach
      // every later container from the project network — the one failure mode
      // this lookup exists to prevent. Retrying costs one inspect per launch,
      // which is also the steady state when we genuinely aren't containerized.
      logger.warn('Docker compute: own-container inspect failed; using the default bridge', {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
    return this.ownNetwork;
  }

  // ---------------------------------------------------------------- ownership ---

  /**
   * Verify a container is ours before touching it.
   *
   * Every machine-scoped call addresses a container by id, and a stale or wrong
   * id could name Postgres or a co-tenant project's container. Docker offers no
   * way to scope a call by label, so the check has to be explicit — one inspect
   * per operation against a local socket, which is cheap next to the cost of
   * being wrong.
   */
  private async assertOwned(containerId: string): Promise<ContainerInspect> {
    const c = await dockerRequest<ContainerInspect>(
      'GET',
      `/containers/${encodeURIComponent(containerId)}/json`
    );
    if (!c) {
      throw new DockerHttpError(404, `Container ${containerId} not found`);
    }
    const labels = c.Config?.Labels ?? {};
    if (labels[LABEL_MANAGED] !== 'true' || labels[LABEL_PROJECT] !== this.projectKey()) {
      // Deliberately reported as gone rather than forbidden: from this project's
      // point of view the container it is asking about does not exist, and
      // saying "that belongs to someone else" would confirm what is running on
      // the host.
      throw new MachineGoneError(c.Name ?? containerId, containerId);
    }
    return c;
  }

  private machineScoped<T>(appId: string, containerId: string, fn: () => Promise<T>): Promise<T> {
    return translateMachineGone(
      appId,
      containerId,
      (err) => err instanceof DockerHttpError && err.status === 404,
      fn
    );
  }

  // ------------------------------------------------------------- lifecycle ---

  async launchMachine(
    params: LaunchMachineParams
  ): Promise<{ machineId: string; endpointUrl: string | null }> {
    // Must precede create — see ensureImage.
    await this.ensureImage(params.image, params.appId);

    const network = await this.resolveNetwork();
    const ingress = this.ingressFor(params.ingress);

    const exposed = `${params.port}/tcp`;
    const body: Record<string, unknown> = {
      Image: params.image,
      Labels: {
        [LABEL_MANAGED]: 'true',
        [LABEL_PROJECT]: this.projectKey(),
        [LABEL_SERVICE]: params.appId,
        [LABEL_SPEC]: this.specHash(params),
      },
      Env: Object.entries(params.envVars ?? {}).map(([k, v]) => `${k}=${v}`),
      ExposedPorts: { [exposed]: {} },
      HostConfig: {
        // Survives a host reboot. Measured: a container with this policy was
        // running again seconds after a real EC2 reboot; one without stayed
        // exited.
        RestartPolicy: { Name: 'unless-stopped' },
        NanoCpus: Math.round(cpuTierToCores(params.cpu) * 1e9),
        Memory: params.memory * 1024 * 1024,
        // Empty HostPort lets the daemon assign an ephemeral one, which avoids
        // an allocation race with anything else on the host. Read back from
        // inspect below.
        //
        // Note the bind address: Docker's own default publishes on 0.0.0.0 *and*
        // [::] (measured), i.e. the whole internet on a reachable host. We
        // default to loopback so exposure is a deliberate choice.
        PortBindings:
          ingress === 'none'
            ? {}
            : { [exposed]: [{ HostIp: dockerConfig().bindAddress, HostPort: '' }] },
      },
    };
    if (network) {
      body.NetworkingConfig = { EndpointsConfig: { [network]: {} } };
    }

    const created = await dockerRequest<{ Id: string; Warnings?: string[] }>(
      'POST',
      `/containers/create?name=${encodeURIComponent(params.appId)}`,
      { body }
    );
    if (!created?.Id) {
      throw new Error(`Docker container create returned no id for ${params.appId}`);
    }
    if (created.Warnings?.length) {
      logger.warn('Docker container created with warnings', {
        name: params.appId,
        warnings: created.Warnings,
      });
    }

    try {
      await dockerRequest('POST', `/containers/${created.Id}/start`);
    } catch (error) {
      // A container that will not start is worse than no container: it would sit
      // in the table looking deployable. Remove it and surface the real reason.
      await dockerRequest('DELETE', `/containers/${created.Id}?force=true`).catch(() => undefined);
      throw error;
    }

    // Resolved here rather than by the caller: under `port` ingress the daemon
    // assigns an ephemeral host port, so the address does not exist until now.
    return {
      machineId: created.Id,
      endpointUrl: await this.resolvePublishedUrl(created.Id, params.port, ingress),
    };
  }

  /**
   * Bring the container to the requested state.
   *
   * Docker can change CPU and memory on a running container, but **not** its
   * image, ports, or environment. Applying only the in-place fields and ignoring
   * the rest would make `compute deploy --image newer:tag` report success while
   * the old image keeps running and the database records the new one — silent,
   * and the worst possible failure for a deploy command. So anything outside
   * cpu/memory forces a recreate.
   *
   * Which case applies is decided by comparing a hash of the immutable part of
   * the spec, stored on the container as a label. Comparing fields directly is
   * unreliable for env: `Config.Env` also carries the image's own defaults, and
   * a *removed* variable is invisible when you only check that the requested
   * ones are present. The hash covers removals exactly.
   */
  async updateMachine(
    params: UpdateMachineParams
  ): Promise<{ machineId?: string; endpointUrl?: string | null }> {
    return this.machineScoped(params.appId, params.machineId, async () => {
      const current = await this.assertOwned(params.machineId);
      const desired = this.specHash(params);

      if (current.Config?.Labels?.[LABEL_SPEC] === desired) {
        await dockerRequest('POST', `/containers/${encodeURIComponent(params.machineId)}/update`, {
          body: {
            NanoCpus: Math.round(cpuTierToCores(params.cpu) * 1e9),
            Memory: params.memory * 1024 * 1024,
          },
        });
        return {};
      }

      // Recreate under the same name. Stop and remove first because the name is
      // taken; if creating the replacement then fails, the row is left pointing
      // at a removed container, which the existing MachineGoneError healing turns
      // into a clean relaunch on the next request.
      const name = (current.Name ?? '').replace(/^\//, '') || params.appId;
      await dockerRequest('POST', `/containers/${encodeURIComponent(params.machineId)}/stop`).catch(
        () => undefined
      );
      await dockerRequest(
        'DELETE',
        `/containers/${encodeURIComponent(params.machineId)}?force=true`
      );

      const launched = await this.launchMachine({
        appId: name,
        image: params.image,
        port: params.port,
        cpu: params.cpu,
        memory: params.memory,
        envVars: params.envVars,
        region: 'local',
        ingress: params.ingress,
        protocol: params.protocol,
        scaleToZero: params.scaleToZero,
      });
      logger.info('Docker compute: recreated container to apply a spec change', {
        name,
        previous: params.machineId.slice(0, 12),
        replacement: launched.machineId.slice(0, 12),
      });
      // The replacement's published port is newly assigned, so the URL has to
      // travel with the new id.
      return { machineId: launched.machineId, endpointUrl: launched.endpointUrl };
    });
  }

  /**
   * Hash of the parts of a container spec that cannot be changed in place.
   *
   * cpu and memory are deliberately excluded — they are updatable, so including
   * them would force a pointless recreate on a resize.
   */
  private specHash(params: {
    image: string;
    port: number;
    envVars?: Record<string, string>;
    ingress?: string;
  }): string {
    const env = Object.entries(params.envVars ?? {})
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([k, v]) => `${k}=${v}`);
    return createHash('sha256')
      .update(
        JSON.stringify({
          image: params.image,
          port: params.port,
          env,
          ingress: this.ingressFor(params.ingress),
        })
      )
      .digest('hex')
      .slice(0, 16);
  }

  async stopMachine(appId: string, machineId: string): Promise<void> {
    await this.machineScoped(appId, machineId, async () => {
      await this.assertOwned(machineId);
      await dockerRequest('POST', `/containers/${encodeURIComponent(machineId)}/stop`);
    });
  }

  async startMachine(appId: string, machineId: string): Promise<void> {
    await this.machineScoped(appId, machineId, async () => {
      await this.assertOwned(machineId);
      await dockerRequest('POST', `/containers/${encodeURIComponent(machineId)}/start`);
    });
  }

  async destroyMachine(appId: string, machineId: string): Promise<void> {
    await this.machineScoped(appId, machineId, async () => {
      await this.assertOwned(machineId);
      // force=true so a running container goes in one call, mirroring the Fly
      // provider (which needs it to avoid a 412).
      await dockerRequest('DELETE', `/containers/${encodeURIComponent(machineId)}?force=true`);
    });
  }

  async listMachines(appId: string): Promise<MachineSummary[]> {
    const filters = encodeURIComponent(
      JSON.stringify({
        label: [`${LABEL_MANAGED}=true`, `${LABEL_PROJECT}=${this.projectKey()}`],
        // Anchored. Docker treats a name filter as an unanchored regex over the
        // container's names, so a bare `api` would also match `api-v2` — and since a
        // container name carries a leading slash, the anchors have to allow for it.
        // The service label below is the exact-match check; the name filter only
        // narrows the scan.
        name: [`^/?${escapeRegExp(appId)}$`],
      })
    );
    const list =
      (await dockerRequest<{ Id: string; State: string; Names?: string[] }[]>(
        'GET',
        `/containers/json?all=true&filters=${filters}`
      )) ?? [];
    return (
      list
        // Belt and braces: the filter is the daemon's job, but a mismatch here would
        // report someone else's container as this service's instance.
        .filter((c) => (c.Names ?? []).some((n) => n.replace(/^\//, '') === appId))
        .map((c) => ({ id: c.Id, state: this.mapState(c.State), region: 'local' }))
    );
  }

  async getMachineStatus(appId: string, machineId: string): Promise<{ state: string }> {
    const c = await this.machineScoped(appId, machineId, () => this.assertOwned(machineId));
    return { state: this.mapState(c.State.Status) };
  }

  /**
   * Docker's container states, mapped onto the existing service enum.
   *
   * `exited` maps to `stopped`, never `failed`, regardless of exit code. Measured
   * across a real host reboot: containers that shut down cleanly reported
   * `Exited (0)` while ones the host killed reported `Exited (137)` (SIGKILL).
   * Treating a non-zero exit as failure would therefore mark a chunk of services
   * failed after every reboot. Genuine crash detail belongs in events and logs,
   * which report it accurately.
   */
  private mapState(status: string): string {
    switch (status) {
      case 'running':
      case 'restarting':
        return 'running';
      case 'created':
        return 'creating';
      case 'removing':
        return 'destroying';
      case 'dead':
        return 'failed';
      case 'paused':
      case 'exited':
      default:
        return 'stopped';
    }
  }

  async waitForState(
    appId: string,
    machineId: string,
    targetStates: string[],
    timeoutMs = 30_000
  ): Promise<string> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const { state } = await this.getMachineStatus(appId, machineId);
        if (targetStates.includes(state)) {
          return state;
        }
      } catch (error) {
        // Definitive gone — polling will not bring it back.
        if (error instanceof MachineGoneError) {
          throw error;
        }
        logger.warn('Transient error polling container state, retrying', { appId, machineId });
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    throw new Error(
      `Container did not reach state [${targetStates.join(',')}] within ${timeoutMs}ms`
    );
  }

  /**
   * Pull the image unless the daemon already has it.
   *
   * `POST /containers/create` does **not** pull. `docker run` makes it look as if it
   * does by catching the 404 and pulling first, but the API leaves that to the
   * caller — so on a host that has never seen the image, create fails with
   * `No such image: <ref>`. That is the state of every fresh self-hosted box on its
   * first deploy, and it survived several rounds of testing because the test scripts
   * pulled the image themselves beforehand.
   *
   * `/images/create` behaves like `/build`: newline-delimited JSON, and failure is
   * reported **inside the body with HTTP 200**, so the status code alone is not
   * enough here either.
   *
   * Lives on the provider rather than in the client because deciding *when* to pull
   * and what to log is policy; the client stays transport. (It also keeps the call
   * mockable — a client function calling its own sibling export bypasses module
   * mocks.)
   *
   * Private registries need credentials in `X-Registry-Auth`, which is not wired up:
   * pulls are anonymous, so a private image fails with the registry's own error
   * rather than a confusing local one.
   */
  private async ensureImage(ref: string, serviceName: string): Promise<void> {
    // Cheap existence check first — re-pulling on every launch would add seconds to
    // each deploy and hammer the registry.
    const probe = await dockerRequestRaw('GET', `/images/${encodeURIComponent(ref)}/json`);
    if (probe.status >= 200 && probe.status < 300) {
      return;
    }

    const res = await dockerRequestRaw(
      'POST',
      `/images/create?fromImage=${encodeURIComponent(ref)}`,
      {
        // A multi-hundred-megabyte pull over a slow link is minutes, not seconds; the
        // default request timeout would abort a legitimate first deploy.
        timeoutMs: 10 * 60_000,
      }
    );
    const body = res.body.toString('utf8');
    if (res.status < 200 || res.status >= 300) {
      throw new DockerHttpError(
        res.status,
        `Docker image pull failed (${res.status}): ${body.slice(0, 500)}`
      );
    }
    for (const line of body.split('\n')) {
      if (!line.trim()) {
        continue;
      }
      type PullFrame = { error?: string; errorDetail?: { message?: string } };
      let frame: PullFrame;
      try {
        frame = JSON.parse(line) as PullFrame;
      } catch {
        continue; // partial trailing line
      }
      const err = frame.errorDetail?.message ?? frame.error;
      if (err) {
        throw new Error(`Docker image pull failed: ${err}`);
      }
    }
    logger.info('Docker compute: pulled an image the host did not have', {
      image: ref,
      service: serviceName,
    });
  }

  // ------------------------------------------------------------ source build ---

  /**
   * Build an image from an uploaded context and return the tag to deploy.
   *
   * Concurrency is capped because a build saturates CPU and disk: two arriving at
   * once on a small VPS is the difference between a slow deploy and an OOM. The
   * limit is a simple in-process gate, which is sufficient because a self-hosted
   * deployment is a single backend process.
   */
  async buildFromContext(params: {
    serviceName: string;
    context: Buffer;
    dockerfile?: string;
    buildArgs?: Record<string, string>;
  }): Promise<{ imageTag: string; logs: string[] }> {
    if (DockerProvider.activeBuilds >= DockerProvider.MAX_CONCURRENT_BUILDS) {
      throw new Error(
        `Too many builds already running (${DockerProvider.MAX_CONCURRENT_BUILDS}). Retry when one finishes.`
      );
    }

    // Tag carries a digest of the uploaded context, which makes it unique per
    // deploy and gives prune a stable ordering. Note it is NOT content-addressed
    // by *source*: tar embeds mtimes, so re-tarring identical files yields
    // different bytes and therefore a different tag. That is fine — BuildKit's
    // layer cache is what makes an unchanged rebuild fast, and distinct tags keep
    // consecutive deploys distinguishable.
    const digest = createHash('sha256').update(params.context).digest('hex').slice(0, 12);
    const imageTag = `insforge-${this.projectKey()}/${params.serviceName}:${digest}`;

    DockerProvider.activeBuilds++;
    try {
      const result = await dockerBuild({
        context: params.context,
        tag: imageTag,
        dockerfile: params.dockerfile,
        buildArgs: params.buildArgs,
      });
      if (!result.ok) {
        // Surface the builder's own message: "no such file", "exit code 1" and
        // friends are what the developer needs, not a generic failure.
        const message = result.error ?? 'Build failed';
        if (/xattr|lsetxattr/i.test(message)) {
          // Baffling on its own — the context was tarred with extended attributes
          // the Linux daemon cannot apply. Name the fix instead of leaving the
          // developer to search for it.
          throw new Error(
            `${message}\n\nThe build context was archived with extended attributes that the daemon ` +
              'cannot apply (common when tarring on macOS). Re-create the archive with `tar --no-xattrs` ' +
              'or set COPYFILE_DISABLE=1.'
          );
        }
        throw new Error(message);
      }
      logger.info('Docker compute: built an image from source', {
        service: params.serviceName,
        imageTag,
      });
      return { imageTag, logs: result.logs };
    } finally {
      DockerProvider.activeBuilds--;
    }
  }

  private static activeBuilds = 0;
  /**
   * One build at a time. Raising this trades deploy latency for the risk of
   * exhausting a small host — the median self-hosted box is a 2GB VPS.
   */
  private static readonly MAX_CONCURRENT_BUILDS = 1;

  /**
   * Delete images we built for a service beyond the newest `keep`.
   *
   * Every source deploy produces a new image, and nothing else reclaims them. This
   * is the boring maintenance that turns into "the disk filled up" on someone's
   * VPS six months from now, so it runs after each successful build rather than
   * waiting for a retention policy nobody configures.
   *
   * Only images tagged by this project for this service are considered, and any
   * still referenced by a container is skipped — Docker refuses those anyway, and
   * a rollback to the previous tag should keep working.
   */
  async pruneServiceImages(serviceName: string, keep = 2): Promise<{ removed: number }> {
    const prefix = `insforge-${this.projectKey()}/${serviceName}:`;
    const images =
      (await dockerRequest<{ Id: string; RepoTags: string[] | null; Created: number }[]>(
        'GET',
        '/images/json'
      )) ?? [];

    const ours = images
      .filter((i) => (i.RepoTags ?? []).some((t) => t.startsWith(prefix)))
      .sort((a, b) => b.Created - a.Created);

    let removed = 0;
    for (const image of ours.slice(keep)) {
      const tag = (image.RepoTags ?? []).find((t) => t.startsWith(prefix));
      if (!tag) {
        continue;
      }
      try {
        await dockerRequest('DELETE', `/images/${encodeURIComponent(tag)}`);
        removed++;
      } catch (error) {
        // In use by a container, or already gone. Neither is worth failing a
        // deploy over.
        logger.info('Docker compute: kept an image that could not be removed', {
          tag,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }
    if (removed) {
      logger.info('Docker compute: pruned old service images', { serviceName, removed });
    }
    return { removed };
  }

  // ------------------------------------------------------------------ reads ---

  /**
   * Container lifecycle events, the counterpart to Fly's machine events.
   *
   * `until` is mandatory in practice: without it Docker's /events endpoint
   * streams and the request never completes.
   */
  async getEvents(
    appId: string,
    machineId: string,
    options?: { limit?: number }
  ): Promise<ComputeEvent[]> {
    await this.machineScoped(appId, machineId, () => this.assertOwned(machineId));

    const until = Math.floor(Date.now() / 1000);
    const since = until - 24 * 60 * 60;
    const filters = encodeURIComponent(
      JSON.stringify({ container: [machineId], type: ['container'] })
    );
    const res = await dockerRequestRaw(
      'GET',
      `/events?since=${since}&until=${until}&filters=${filters}`
    );

    // /events emits newline-delimited JSON objects, not a JSON array.
    const events: ComputeEvent[] = [];
    for (const line of res.body.toString('utf8').split('\n')) {
      if (!line.trim()) {
        continue;
      }
      try {
        const e = JSON.parse(line) as { Action?: string; Type?: string; time?: number };
        events.push({
          timestamp: (e.time ?? 0) * 1000,
          message: `[${e.Type ?? 'container'}] ${e.Action ?? 'unknown'}`,
        });
      } catch {
        /* skip an unparseable line rather than lose the whole response */
      }
    }

    const limit = options?.limit ?? 100;
    return events.slice(-limit);
  }

  /**
   * Container stdout/stderr.
   *
   * Two measured constraints shape this, and both are easy to get wrong:
   *
   *  1. The response is a multiplexed binary stream, not text — see
   *     demuxDockerStream.
   *  2. `since` accepts **integer seconds only** (RFC3339Nano is rejected with a
   *     `strconv.ParseInt` error) and is **inclusive**. So the cursor is
   *     two-part: `nextToken` carries a nanosecond watermark, the request floors
   *     it to seconds, and lines at or before the watermark are dropped. Using
   *     seconds as the dedup key instead would discard genuinely new lines that
   *     happen to share a second with the previous batch.
   */
  async getLogs(
    appId: string,
    machineId: string,
    options?: { limit?: number; nextToken?: string }
  ): Promise<ComputeLogsResult> {
    await this.machineScoped(appId, machineId, () => this.assertOwned(machineId));

    const limit = options?.limit ?? 100;
    const watermark = options?.nextToken ? this.parseWatermark(options.nextToken) : null;

    const params = new URLSearchParams({
      stdout: '1',
      stderr: '1',
      timestamps: '1',
    });
    if (watermark === null) {
      // First page: no cursor to be consistent with, so ask for the newest
      // `limit` lines instead of the whole retained history.
      params.set('tail', String(limit));
    } else {
      // Floor to whole seconds — the only precision the parameter accepts.
      params.set('since', String(watermark / 1_000_000_000n));
      // No `tail` when resuming. `tail` keeps the *newest* N, so pairing it with
      // `since` drops the middle of a backlog: 500 lines since the cursor with
      // tail=100 returns the newest 100 and the cursor then advances past the
      // other 400, which no later request can reach. Taking everything since the
      // cursor and returning the oldest `limit` (below) makes the next page
      // resume exactly where this one stopped, so a paging caller sees them all.
      // The response is then only as large as what the container logged since
      // the last poll.
    }

    const res = await dockerRequestRaw(
      'GET',
      `/containers/${encodeURIComponent(machineId)}/logs?${params.toString()}`,
      { timeoutMs: 15_000 }
    );
    if (res.status < 200 || res.status >= 300) {
      throw new DockerHttpError(
        res.status,
        `Docker logs error (${res.status}): ${res.body.toString('utf8')}`
      );
    }

    const entries: { line: ComputeLogLine; nanos: bigint }[] = [];
    for (const frame of demuxDockerStream(res.body)) {
      for (const raw of frame.text.split('\n')) {
        if (!raw.trim()) {
          continue;
        }
        const parsed = parseLogLine(raw);
        if (!parsed) {
          continue;
        }
        // Inclusive `since` re-delivers everything in the boundary second.
        if (watermark !== null && parsed.nanos <= watermark) {
          continue;
        }
        entries.push({
          line: { timestamp: parsed.ms, message: parsed.message },
          nanos: parsed.nanos,
        });
      }
    }

    // Docker emits oldest-first, so trimming the tail keeps the oldest `limit`
    // and leaves the remainder for the next page. The cursor is taken from what
    // is actually returned — never from a line that got trimmed.
    const page = entries.length > limit ? entries.slice(0, limit) : entries;
    let highest = watermark;
    for (const entry of page) {
      if (highest === null || entry.nanos > highest) {
        highest = entry.nanos;
      }
    }
    return {
      lines: page.map((entry) => entry.line),
      nextToken: highest === null ? null : highest.toString(),
    };
  }

  private parseWatermark(token: string): bigint | null {
    try {
      return BigInt(token);
    } catch {
      // A cursor we cannot read is treated as absent — better to re-deliver a
      // window than to fail the request.
      return null;
    }
  }

  /**
   * Host port the daemon assigned, for building the endpoint URL after launch.
   * Returns null under `none` ingress, where nothing is published.
   */
  async resolvePublishedUrl(
    machineId: string,
    containerPort: number,
    requestedIngress?: string
  ): Promise<string | null> {
    const ingress = this.ingressFor(requestedIngress);
    if (ingress === 'none') {
      return null;
    }
    if (ingress === 'host' && dockerConfig().domain) {
      // Hostname routing does not depend on the published port at all — the
      // operator's gateway maps the name onto the container.
      const c = await dockerRequest<ContainerInspect>(
        'GET',
        `/containers/${encodeURIComponent(machineId)}/json`
      );
      const svc = c?.Config?.Labels?.[LABEL_SERVICE];
      return svc ? `https://${svc}.${dockerConfig().domain}` : null;
    }
    const c = await dockerRequest<ContainerInspect>(
      'GET',
      `/containers/${encodeURIComponent(machineId)}/json`
    );
    const binding = c?.NetworkSettings?.Ports?.[`${containerPort}/tcp`]?.[0];
    if (!binding?.HostPort) {
      return null;
    }
    const host = dockerConfig().publicHost;
    if (!host) {
      logger.warn(
        'Docker compute: port ingress is enabled but COMPUTE_PUBLIC_HOST is unset, so no endpoint URL ' +
          `can be advertised. The container is published on port ${binding.HostPort}.`
      );
      return null;
    }
    return `http://${host}:${binding.HostPort}`;
  }
}
