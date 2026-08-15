import express, { Router, Response, NextFunction } from 'express';
import { appConfig } from '@/infra/config/app.config.js';
import { isCloudEnvironment } from '@/utils/environment.js';
import { verifyAdmin, AuthRequest } from '@/api/middlewares/auth.js';
import { computeWriteLimiter, computeLogsRateLimiter } from '@/api/middlewares/rate-limiters.js';
import { ComputeServicesService } from '@/services/compute/services.service.js';
import { successResponse } from '@/utils/response.js';
import { AppError } from '@/utils/errors.js';
import {
  ERROR_CODES,
  createServiceSchema,
  updateServiceSchema,
  updateComputeConfigSchema,
} from '@insforge/shared-schemas';
import { ComputeConfigService } from '@/services/compute/compute-config.service.js';
import { AuditService } from '@/services/logs/audit.service.js';
import { dashboardEventService } from '@/services/dashboard/dashboard-event.service.js';
import logger from '@/utils/logger.js';

const router = Router();
const auditService = AuditService.getInstance();

function getProjectId(req: AuthRequest): string {
  // Cloud: projectId is set by verifyCloudBackend from the JWT claim
  // Self-hosted: fall back to the server-level PROJECT_ID env var
  return req.projectId || process.env.PROJECT_ID || 'default';
}

function bestEffortAudit(params: Parameters<typeof auditService.log>[0]) {
  auditService.log(params).catch((err) => {
    logger.error('Audit log failed (best-effort)', { error: err });
  });
}

function bestEffortBroadcast() {
  try {
    dashboardEventService.publishDataUpdate({ resource: 'compute_services' });
  } catch (err) {
    logger.error('Socket broadcast failed (best-effort)', { error: err });
  }
}

// Fly credentials, stored rather than read from the container's environment.
//
// Mounted before /:id so `config` is not matched as a service id. Separate from the
// service routes because it has to work when *no* provider is configured — which is
// exactly when someone needs it — and ComputeServicesService throws on construction
// in that state.
router.get('/config', verifyAdmin, async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    successResponse(res, await ComputeConfigService.getInstance().getConfig());
  } catch (error) {
    next(error);
  }
});

router.put(
  '/config',
  verifyAdmin,
  computeWriteLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      // Cloud-managed projects run compute through InsForge's own Fly account, so a
      // project admin storing their own token here would move their containers off the
      // control plane that bills and quotas them. The dashboard already hides this on
      // cloud; the API has to say no too, or the gate is decoration.
      if (isCloudEnvironment()) {
        throw new AppError(
          'Compute credentials are managed by InsForge on cloud projects.',
          403,
          ERROR_CODES.FORBIDDEN
        );
      }

      const validation = updateComputeConfigSchema.safeParse(req.body);
      if (!validation.success) {
        throw new AppError(
          validation.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '),
          400,
          ERROR_CODES.INVALID_INPUT
        );
      }

      const configService = ComputeConfigService.getInstance();
      try {
        await configService.updateConfig(validation.data);
      } finally {
        // In a finally, not after success: a save that wrote the token and failed on the
        // org has changed what the credentials are, so a registry built from the old
        // ones is stale either way.
        ComputeServicesService.resetForConfigChange();
      }

      successResponse(res, await configService.getConfig());

      bestEffortAudit({
        actor: req.hasApiKey ? 'api-key' : req.user?.id,
        action: 'UPDATE_COMPUTE_CONFIG',
        module: 'COMPUTE',
        // Never the values, and not even which of the two changed beyond the field
        // names — an audit row should not narrow a token.
        details: { fields: Object.keys(validation.data) },
        ip_address: req.ip,
      });
    } catch (error) {
      next(error);
    }
  }
);

// List services
router.get('/', verifyAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const svc = ComputeServicesService.getInstance();
    const services = await svc.listServices(getProjectId(req));
    successResponse(res, services);
  } catch (error) {
    next(error);
  }
});

// Get service
router.get('/:id', verifyAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const svc = ComputeServicesService.getInstance();
    const service = await svc.getService(req.params.id);

    if (service.projectId !== getProjectId(req)) {
      throw new AppError('Service not found', 404, ERROR_CODES.COMPUTE_SERVICE_NOT_FOUND);
    }

    successResponse(res, service);
  } catch (error) {
    next(error);
  }
});

// Create service
router.post(
  '/',
  verifyAdmin,
  computeWriteLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const validation = createServiceSchema.safeParse(req.body);
      if (!validation.success) {
        throw new AppError(
          validation.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '),
          400,
          ERROR_CODES.INVALID_INPUT,
          'Please check the request body, it must conform with the CreateServiceRequest schema.'
        );
      }

      const svc = ComputeServicesService.getInstance();
      const projectId = getProjectId(req);
      const service = await svc.createService({ ...validation.data, projectId });

      successResponse(res, service, 201);

      bestEffortAudit({
        actor: req.hasApiKey ? 'api-key' : req.user?.id,
        action: 'CREATE_COMPUTE_SERVICE',
        module: 'COMPUTE',
        details: { serviceName: validation.data.name, projectId },
        ip_address: req.ip,
      });
      bestEffortBroadcast();
    } catch (error) {
      next(error);
    }
  }
);

// Prepare for deploy (create DB record + Fly app, no machine)
router.post(
  '/deploy',
  verifyAdmin,
  computeWriteLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const validation = createServiceSchema.safeParse(req.body);
      if (!validation.success) {
        throw new AppError(
          validation.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '),
          400,
          ERROR_CODES.INVALID_INPUT,
          'Please check the request body, it must conform with the CreateServiceRequest schema.'
        );
      }

      const svc = ComputeServicesService.getInstance();
      const projectId = getProjectId(req);
      const service = await svc.prepareForDeploy({ ...validation.data, projectId });

      successResponse(res, service, 201);

      bestEffortAudit({
        actor: req.hasApiKey ? 'api-key' : req.user?.id,
        action: 'PREPARE_COMPUTE_DEPLOY',
        module: 'COMPUTE',
        details: { serviceName: validation.data.name, projectId },
        ip_address: req.ip,
      });
    } catch (error) {
      next(error);
    }
  }
);

// Issue a Fly deploy token for the CLI (cloud-managed mode only).
// Used so `compute deploy` can run flyctl without the user holding
// their own FLY_API_TOKEN.
router.post(
  '/:id/deploy-token',
  verifyAdmin,
  computeWriteLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const svc = ComputeServicesService.getInstance();
      const existing = await svc.getService(req.params.id);

      if (existing.projectId !== getProjectId(req)) {
        throw new AppError('Service not found', 404, ERROR_CODES.COMPUTE_SERVICE_NOT_FOUND);
      }

      const tokenResult = await svc.issueDeployTokenForService(req.params.id);
      successResponse(res, tokenResult);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * `dockerfile` names a path *inside* the uploaded context. The daemon resolves it
 * against the context root and rejects an escape on its own, but its error is
 * opaque — reject the obvious shapes here so the developer gets something to act
 * on instead of a build failure from the bottom of the stack.
 */
function parseDockerfileParam(raw: unknown): string | undefined {
  if (raw === undefined) {
    return undefined;
  }
  const reject = (why: string): never => {
    throw new AppError(
      `Invalid \`dockerfile\`: ${why}. It must be a path relative to the root of the uploaded context, e.g. "docker/Dockerfile".`,
      400,
      ERROR_CODES.INVALID_INPUT
    );
  };
  if (typeof raw !== 'string' || raw.length === 0) {
    return reject('expected a single non-empty string');
  }
  if (raw.length > 255) {
    return reject('longer than 255 characters');
  }
  if (raw.startsWith('/') || /^[A-Za-z]:/.test(raw)) {
    return reject('absolute paths are not allowed');
  }
  if (raw.split(/[\\/]/).includes('..')) {
    return reject('`..` cannot be used to leave the context');
  }
  return raw;
}

/** Set by the gate below so the handler can hand the slot back when it is done. */
type BuildRequest = AuthRequest & { releaseBuildSlot?: () => void; buildStarted?: boolean };

/**
 * No bytes for this long means the client has stalled rather than being slow.
 * Resets on every chunk, so a legitimately slow upload is never penalised — only a
 * connection that stops making progress while holding the only build slot.
 * Configurable for the same reason the size ceiling is: the operator knows their
 * network, and a hard-coded value is either too tight for someone or too loose.
 */
function uploadIdleTimeoutMs(): number {
  return appConfig.docker.buildUploadIdleTimeoutMs;
}

/**
 * Admit one build at a time, deciding *before* `express.raw` buffers a body.
 *
 * The driver already caps concurrent builds at one, but it only finds out once
 * express holds the entire tarball in memory, so N simultaneous uploads cost N
 * contexts regardless of the cap. On the hosts this targets — a t4g.nano has
 * ~418MB usable — that is the difference between a clear 429 and an OOM.
 *
 * The slot is held across the build, not just the upload, because an upload that
 * cannot be built is worth rejecting at the door rather than buffering and then
 * failing. That makes releasing it the delicate part, with two distinct cases:
 *
 *   - aborted before the handler took over — nothing is building, so the socket
 *     closing must release it, or the endpoint wedges permanently;
 *   - aborted after the handler took over — the build carries on regardless of the
 *     client, so the socket closing must *not* release it, or a disconnect lets a
 *     second context in alongside the running build.
 *
 * Hence `buildStarted`: the handler claims ownership and releases in its own
 * `finally`, and until it does, the close handler owns the release.
 */
let buildSlotTaken = false;
function oneBuildAtATime(req: BuildRequest, res: Response, next: NextFunction) {
  if (buildSlotTaken) {
    // Discard the incoming tarball instead of buffering it — that is the whole
    // point of rejecting here. It still has to be drained: a response sent while
    // the request body sits unread stalls the connection until the client gives
    // up, which turns a fast 429 into a hang.
    req.resume();
    next(
      new AppError(
        'Another build is already in progress. Retry when it finishes.',
        429,
        ERROR_CODES.TOO_MANY_REQUESTS
      )
    );
    return;
  }

  buildSlotTaken = true;
  let idle: NodeJS.Timeout | undefined;
  let released = false;
  const release = () => {
    if (released) {
      return;
    }
    released = true;
    if (idle) {
      clearTimeout(idle);
    }
    buildSlotTaken = false;
  };
  req.releaseBuildSlot = release;

  // Bound how long a client can sit on the slot without sending anything.
  const armIdleTimer = () => {
    if (idle) {
      clearTimeout(idle);
    }
    idle = setTimeout(() => {
      logger.warn('Compute build upload stalled; releasing the build slot', {
        serviceId: req.params.id,
        idleMs: uploadIdleTimeoutMs(),
      });
      release();
      req.destroy();
    }, uploadIdleTimeoutMs());
  };
  armIdleTimer();
  req.on('data', armIdleTimer);
  req.once('end', () => {
    if (idle) {
      clearTimeout(idle);
      idle = undefined;
    }
  });

  res.once('close', () => {
    // Only ours to release while no build has started — see the note above.
    if (!req.buildStarted) {
      release();
    }
  });
  next();
}

/**
 * `express.raw` rejects an over-limit body with `entity.too.large`, which the shared
 * error middleware does not recognise — it would surface as a 500, telling an
 * operator who set the limit that the server broke. Translate it where the limit is
 * known so the message can name it.
 */
const rawTarBody = express.raw({
  type: 'application/x-tar',
  limit: appConfig.docker.buildMaxContextSize,
});
function parseTarBody(req: AuthRequest, res: Response, next: NextFunction) {
  rawTarBody(req, res, (err?: unknown) => {
    if (err && (err as { type?: string }).type === 'entity.too.large') {
      next(
        new AppError(
          `Build context is larger than the ${appConfig.docker.buildMaxContextSize} limit. Shrink it with a .dockerignore, or raise COMPUTE_BUILD_MAX_CONTEXT.`,
          413,
          ERROR_CODES.INVALID_INPUT
        )
      );
      return;
    }
    next(err);
  });
}

// Build an uploaded context and deploy the result.
//
// The body is the build context tarball itself, which is what Docker's build
// endpoint natively consumes, so it is forwarded as-is. Pair with POST /deploy,
// which reserves the name first.
//
// A note for whoever builds the tarball: archive it with `tar --no-xattrs` (or
// COPYFILE_DISABLE=1) on macOS. Extended attributes the Linux daemon cannot apply
// make it reject the whole context; the error is recognised and explained, but not
// producing them is simpler.
router.post(
  '/:id/build',
  verifyAdmin,
  computeWriteLimiter,
  oneBuildAtATime,
  parseTarBody,
  async (req: BuildRequest, res: Response, next: NextFunction) => {
    // Take ownership of the build slot: from here the build outlives the client,
    // so a disconnect must not hand the slot to someone else.
    req.buildStarted = true;
    const releaseBuildSlot = req.releaseBuildSlot ?? (() => {});
    try {
      const svc = ComputeServicesService.getInstance();
      const existing = await svc.getService(req.params.id);

      if (existing.projectId !== getProjectId(req)) {
        throw new AppError('Service not found', 404, ERROR_CODES.COMPUTE_SERVICE_NOT_FOUND);
      }

      if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        throw new AppError(
          'Build context must be a non-empty tar archive sent as application/x-tar.',
          400,
          ERROR_CODES.INVALID_INPUT
        );
      }

      const dockerfile = parseDockerfileParam(req.query.dockerfile);
      const result = await svc.buildAndDeploy(req.params.id, req.body, { dockerfile });

      successResponse(res, {
        service: result.service,
        imageTag: result.imageTag,
        logs: result.logs,
      });

      bestEffortAudit({
        actor: req.hasApiKey ? 'api-key' : req.user?.id,
        action: 'BUILD_COMPUTE_SERVICE',
        module: 'COMPUTE',
        details: {
          serviceId: req.params.id,
          serviceName: existing.name,
          imageTag: result.imageTag,
          contextBytes: req.body.length,
        },
        ip_address: req.ip,
      });
      bestEffortBroadcast();
    } catch (error) {
      next(error);
    } finally {
      releaseBuildSlot();
    }
  }
);

// Update service
router.patch(
  '/:id',
  verifyAdmin,
  computeWriteLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const validation = updateServiceSchema.safeParse(req.body);
      if (!validation.success) {
        throw new AppError(
          validation.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '),
          400,
          ERROR_CODES.INVALID_INPUT,
          'Please check the request body, it must conform with the UpdateServiceRequest schema.'
        );
      }

      const svc = ComputeServicesService.getInstance();
      const existing = await svc.getService(req.params.id);

      if (existing.projectId !== getProjectId(req)) {
        throw new AppError('Service not found', 404, ERROR_CODES.COMPUTE_SERVICE_NOT_FOUND);
      }

      const service = await svc.updateService(req.params.id, validation.data);

      successResponse(res, service);

      // Redact envVars — only log the key names, never secret values
      const auditDetails: Record<string, unknown> = {
        serviceId: req.params.id,
        changes: Object.keys(validation.data),
      };
      if ('envVars' in validation.data) {
        auditDetails.envVarsUpdated = true;
      }
      if ('envVarsPatch' in validation.data && validation.data.envVarsPatch) {
        // Log only the *keys* touched so an audit reader knows which secrets
        // rotated, never the values.
        auditDetails.envVarsPatch = {
          setKeys: Object.keys(validation.data.envVarsPatch.set ?? {}),
          unsetKeys: validation.data.envVarsPatch.unset ?? [],
        };
      }

      bestEffortAudit({
        actor: req.hasApiKey ? 'api-key' : req.user?.id,
        action: 'UPDATE_COMPUTE_SERVICE',
        module: 'COMPUTE',
        details: auditDetails,
        ip_address: req.ip,
      });
      bestEffortBroadcast();
    } catch (error) {
      next(error);
    }
  }
);

// Delete service
router.delete(
  '/:id',
  verifyAdmin,
  computeWriteLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const svc = ComputeServicesService.getInstance();
      const existing = await svc.getService(req.params.id);

      if (existing.projectId !== getProjectId(req)) {
        throw new AppError('Service not found', 404, ERROR_CODES.COMPUTE_SERVICE_NOT_FOUND);
      }

      // Returns a snapshot of the deleted row (incl. encrypted env blob) so the
      // audit log retains enough state to reconstruct the service if the delete
      // turns out to have been a mistake. Today the row + Fly app are gone the
      // moment this returns; the audit entry is the only paper trail.
      const snapshot = await svc.deleteService(req.params.id);

      successResponse(res, { message: 'Service deleted' });

      bestEffortAudit({
        actor: req.hasApiKey ? 'api-key' : req.user?.id,
        action: 'DELETE_COMPUTE_SERVICE',
        module: 'COMPUTE',
        details: {
          serviceId: req.params.id,
          serviceName: existing.name,
          snapshot,
        },
        ip_address: req.ip,
      });
      bestEffortBroadcast();
    } catch (error) {
      next(error);
    }
  }
);

// Stop service
router.post(
  '/:id/stop',
  verifyAdmin,
  computeWriteLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const svc = ComputeServicesService.getInstance();
      const existing = await svc.getService(req.params.id);

      if (existing.projectId !== getProjectId(req)) {
        throw new AppError('Service not found', 404, ERROR_CODES.COMPUTE_SERVICE_NOT_FOUND);
      }

      const service = await svc.stopService(req.params.id);

      successResponse(res, service);

      bestEffortAudit({
        actor: req.hasApiKey ? 'api-key' : req.user?.id,
        action: 'STOP_COMPUTE_SERVICE',
        module: 'COMPUTE',
        details: { serviceId: req.params.id, serviceName: existing.name },
        ip_address: req.ip,
      });
      bestEffortBroadcast();
    } catch (error) {
      next(error);
    }
  }
);

// Start service
router.post(
  '/:id/start',
  verifyAdmin,
  computeWriteLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const svc = ComputeServicesService.getInstance();
      const existing = await svc.getService(req.params.id);

      if (existing.projectId !== getProjectId(req)) {
        throw new AppError('Service not found', 404, ERROR_CODES.COMPUTE_SERVICE_NOT_FOUND);
      }

      const service = await svc.startService(req.params.id);

      successResponse(res, service);

      bestEffortAudit({
        actor: req.hasApiKey ? 'api-key' : req.user?.id,
        action: 'START_COMPUTE_SERVICE',
        module: 'COMPUTE',
        details: { serviceId: req.params.id, serviceName: existing.name },
        ip_address: req.ip,
      });
      bestEffortBroadcast();
    } catch (error) {
      next(error);
    }
  }
);

// Get service lifecycle events (start/stop/exit/restart from Fly machine events).
// Not container stdout/stderr — that's separate roadmap work; see spec
// 2026-04-07-compute-dashboard-ux-design.md for the rationale.
router.get(
  '/:id/events',
  verifyAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const svc = ComputeServicesService.getInstance();
      const existing = await svc.getService(req.params.id);

      if (existing.projectId !== getProjectId(req)) {
        throw new AppError('Service not found', 404, ERROR_CODES.COMPUTE_SERVICE_NOT_FOUND);
      }

      const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 1000);
      const events = await svc.getServiceEvents(req.params.id, { limit });

      successResponse(res, events);
    } catch (error) {
      next(error);
    }
  }
);

// Get container stdout/stderr ("application logs") from Fly's logs API.
// Backfills from Fly's ~7-day retention; pass `next_token` (returned in the
// response) to page forward for live tailing. Rate-limited because the
// dashboard polls this every ~2s while live.
router.get(
  '/:id/logs',
  verifyAdmin,
  computeLogsRateLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const svc = ComputeServicesService.getInstance();
      const existing = await svc.getService(req.params.id);

      if (existing.projectId !== getProjectId(req)) {
        throw new AppError('Service not found', 404, ERROR_CODES.COMPUTE_SERVICE_NOT_FOUND);
      }

      const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 1000);
      const nextToken = typeof req.query.next_token === 'string' ? req.query.next_token : undefined;
      const logs = await svc.getServiceLogs(req.params.id, { limit, nextToken });

      successResponse(res, logs);
    } catch (error) {
      next(error);
    }
  }
);

export { router as servicesRouter };
