# Compute Cloud Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a cloud-mode path for OSS compute services where the cloud backend holds a single Fly.io token, creates Fly apps/machines on behalf of projects, and stores the project↔Fly mapping so per-project usage can be queried later (usage-tracking implementation deferred per spec §6).

**Architecture:** Two-repo change.
- **OSS** (`insforge-compute-cloud-provider` worktree, branch `feat/compute-cloud-provider`): adds a `CloudComputeProvider` that proxies the existing `ComputeProvider` interface to cloud backend over JWT-signed HTTPS. A factory in `ComputeServicesService` selects `FlyProvider` (own token, existing) or `CloudComputeProvider` (cloud-mode) based on env.
- **Cloud** (`insforge-cloud-backend-compute-services` worktree, branch `feat/compute-services`): adds a `compute_services` table, a `FlyClient` (thin Machines API wrapper), a `compute.service.ts` (DB ownership + Fly orchestration with `metadata.project_id` tagging), and routes mounted under `/projects/v1/:projectId/compute/*` (matching existing cloud auth conventions).

**Tech Stack:** TypeScript 5.x, Node 22, Express, vitest (OSS), jest (cloud), pg (cloud direct SQL), `jsonwebtoken`, native `fetch`, Fly Machines API (`https://api.machines.dev/v1`).

**Spec:** `docs/superpowers/specs/2026-04-18-compute-cloud-provider-design.md`

**Worktrees:**
- OSS: `/Users/gary/projects/insforge-repo/insforge-compute-cloud-provider`
- Cloud: `/Users/gary/projects/insforge-repo/insforge-cloud-backend-compute-services`

---

## Execution order

Do cloud first (Tasks 1–8), OSS second (Tasks 9–12). The OSS provider's tests mock the cloud HTTP contract, so the contract has to exist first.

---

## File Structure

### Cloud worktree (`insforge-cloud-backend-compute-services`)

| Path | Responsibility |
|---|---|
| `migrations/052_create-compute-services.sql` | Create `compute_services` table |
| `src/models/compute-service.model.ts` | TypeScript types + CreateDto/UpdateDto for the row |
| `src/services/compute/fly-client.ts` | Thin Fly Machines API wrapper (createApp, launchMachine, stop/start/destroy, status, events) |
| `src/services/compute/fly-client.test.ts` | Unit tests (mocked fetch) |
| `src/services/compute/compute.service.ts` | DB ownership + Fly orchestration; sets `metadata.project_id` on every machine |
| `src/services/compute/compute.service.test.ts` | Unit tests (mocked FlyClient, real test pg) |
| `src/routes/compute.routes.ts` | Express routes mounted at `/projects/v1/:projectId/compute/*`; JWT-auth via existing middleware |
| `src/test/compute/compute.routes.test.ts` | Route-level tests (supertest, mocked service) |
| `src/test/compute/compute.live.integration.test.ts` | Live Fly probe (gated on `FLY_API_TOKEN` env, skipped otherwise) |
| `src/config/app.config.ts` (modify) | Add `compute: { flyToken, flyOrg, computeDomain }` |
| `src/app.ts` (modify) | Mount compute routes |
| `src/container.ts` (modify) | Wire ComputeService DI |
| `.env.example` (modify) | Document `FLY_API_TOKEN`, `FLY_ORG`, `COMPUTE_DOMAIN` |

### OSS worktree (`insforge-compute-cloud-provider`)

| Path | Responsibility |
|---|---|
| `backend/src/providers/compute/compute.provider.ts` | Extracted `ComputeProvider` interface (currently implicit via FlyProvider's shape) |
| `backend/src/providers/compute/cloud.provider.ts` | `CloudComputeProvider` implementing `ComputeProvider`, JWT-signed calls to cloud |
| `backend/tests/unit/compute/cloud-provider.test.ts` | Unit tests (mocked fetch, JWT inspection) |
| `backend/src/services/compute/services.service.ts` (modify) | Add `selectComputeProvider()` factory |
| `backend/tests/unit/compute/services-service.test.ts` (modify) | Factory tests covering all three branches |
| `backend/src/infra/config/app.config.ts` (modify) | Add `cloud.computeEnabled` |
| `backend/src/types/error-constants.ts` (modify) | Add `COMPUTE_NOT_CONFIGURED`, `COMPUTE_CLOUD_UNAVAILABLE` |
| `.env.example` (modify) | Document `CLOUD_COMPUTE_ENABLED` |

---

## CLOUD WORKTREE TASKS

> **Working directory for tasks 1–8:** `/Users/gary/projects/insforge-repo/insforge-cloud-backend-compute-services`

### Task 1: Database migration

**Files:**
- Create: `migrations/052_create-compute-services.sql`

- [ ] **Step 1: Write the migration**

Create `migrations/052_create-compute-services.sql` with exactly this content:

```sql
-- Compute Services: per-project Fly.io app/machine ownership.
-- Stores enough metadata for future per-project usage attribution
-- (cpu_tier + memory_mb + created_at + destroyed_at) without schema change.
-- See docs/superpowers/specs/2026-04-18-compute-cloud-provider-design.md §3.2.

CREATE TABLE compute_services (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      text NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  name            text NOT NULL,
  fly_app_name    text NOT NULL UNIQUE,
  fly_machine_id  text,
  region          text NOT NULL,
  cpu_tier        text NOT NULL,
  memory_mb       int  NOT NULL,
  image           text NOT NULL,
  port            int  NOT NULL DEFAULT 8080,
  env_vars        jsonb NOT NULL DEFAULT '{}'::jsonb,
  status          text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  destroyed_at    timestamptz,

  UNIQUE (project_id, name)
);

CREATE INDEX idx_compute_services_project_active
  ON compute_services(project_id) WHERE destroyed_at IS NULL;
CREATE INDEX idx_compute_services_fly_app
  ON compute_services(fly_app_name);
CREATE INDEX idx_compute_services_machine
  ON compute_services(fly_machine_id) WHERE fly_machine_id IS NOT NULL;
```

- [ ] **Step 2: Apply against test DB to verify it parses**

Run: `psql "$DATABASE_URL" -f migrations/052_create-compute-services.sql && psql "$DATABASE_URL" -c '\d compute_services'`

Expected: prints the table schema with all columns and three indexes.

- [ ] **Step 3: Roll back so the test DB is clean for migration runner**

Run: `psql "$DATABASE_URL" -c 'DROP TABLE compute_services CASCADE;'`

Expected: `DROP TABLE`.

- [ ] **Step 4: Commit**

```bash
git add migrations/052_create-compute-services.sql
git commit -m "feat(compute): add compute_services table

Stores ownership of per-project Fly.io apps/machines so the cloud
backend can manage compute on behalf of projects without each
project needing its own Fly account. Schema includes cpu_tier and
memory_mb so future usage attribution can derive cost without
migration. See spec 2026-04-18-compute-cloud-provider-design.md §3.2."
```

---

### Task 2: Compute service model

**Files:**
- Create: `src/models/compute-service.model.ts`

- [ ] **Step 1: Write the model file**

Create `src/models/compute-service.model.ts`:

```typescript
export type ComputeServiceStatus = 'created' | 'started' | 'stopped';

export interface ComputeService {
  id: string;
  project_id: string;
  name: string;
  fly_app_name: string;
  fly_machine_id: string | null;
  region: string;
  cpu_tier: string;
  memory_mb: number;
  image: string;
  port: number;
  env_vars: Record<string, string>;
  status: ComputeServiceStatus;
  created_at: Date;
  updated_at: Date;
  destroyed_at: Date | null;
}

export interface CreateComputeServiceDto {
  project_id: string;
  name: string;
  region: string;
  cpu_tier: string;
  memory_mb: number;
  image: string;
  port?: number;
  env_vars?: Record<string, string>;
}

export interface UpdateComputeServiceDto {
  fly_machine_id?: string;
  status?: ComputeServiceStatus;
  image?: string;
  cpu_tier?: string;
  memory_mb?: number;
  env_vars?: Record<string, string>;
  destroyed_at?: Date;
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit src/models/compute-service.model.ts`

Expected: no output (success).

- [ ] **Step 3: Commit**

```bash
git add src/models/compute-service.model.ts
git commit -m "feat(compute): add compute service model types"
```

---

### Task 3: FlyClient — write the failing test

**Files:**
- Create: `src/services/compute/fly-client.test.ts`

- [ ] **Step 1: Write a failing test for createApp**

Create `src/services/compute/fly-client.test.ts`:

```typescript
import { FlyClient } from './fly-client';

describe('FlyClient', () => {
  const TOKEN = 'test-token';
  const ORG = 'test-org';

  beforeEach(() => {
    global.fetch = jest.fn();
  });

  describe('createApp', () => {
    it('POSTs to /v1/apps with org_slug and app_name', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        text: async () => '',
      });

      const client = new FlyClient({ token: TOKEN, org: ORG });
      const result = await client.createApp({ name: 'ifc-abc-test', network: 'ifc-abc-test' });

      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.machines.dev/v1/apps',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: `Bearer ${TOKEN}`,
            'Content-Type': 'application/json',
          }),
          body: JSON.stringify({
            app_name: 'ifc-abc-test',
            org_slug: ORG,
            network: 'ifc-abc-test',
          }),
        })
      );
      expect(result).toEqual({ appId: 'ifc-abc-test' });
    });

    it('throws on non-2xx response', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 422,
        text: async () => '{"error":"name taken"}',
      });

      const client = new FlyClient({ token: TOKEN, org: ORG });
      await expect(
        client.createApp({ name: 'taken', network: 'taken' })
      ).rejects.toThrow(/Fly API error \(422\)/);
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest src/services/compute/fly-client.test.ts`

Expected: FAIL — `Cannot find module './fly-client'`.

---

### Task 4: FlyClient — minimal implementation to pass

**Files:**
- Create: `src/services/compute/fly-client.ts`

- [ ] **Step 1: Implement enough for createApp tests to pass**

Create `src/services/compute/fly-client.ts`:

```typescript
const FLY_API_BASE = 'https://api.machines.dev/v1';

export interface FlyClientOptions {
  token: string;
  org: string;
}

export class FlyClient {
  constructor(private readonly opts: FlyClientOptions) {}

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.opts.token}`,
      'Content-Type': 'application/json',
    };
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T | undefined> {
    const response = await fetch(`${FLY_API_BASE}${path}`, {
      ...init,
      headers: { ...this.headers(), ...init.headers },
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Fly API error (${response.status}): ${body}`);
    }
    const text = await response.text();
    if (!text) return undefined;
    return JSON.parse(text) as T;
  }

  private async requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
    const result = await this.request<T>(path, init);
    if (result === undefined) {
      throw new Error(`Fly API returned empty body for ${init.method ?? 'GET'} ${path}`);
    }
    return result;
  }

  async createApp(params: { name: string; network: string }): Promise<{ appId: string }> {
    await this.request('/apps', {
      method: 'POST',
      body: JSON.stringify({
        app_name: params.name,
        org_slug: this.opts.org,
        network: params.network,
      }),
    });
    return { appId: params.name };
  }
}
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `npx jest src/services/compute/fly-client.test.ts`

Expected: 2 passing tests.

- [ ] **Step 3: Commit**

```bash
git add src/services/compute/fly-client.ts src/services/compute/fly-client.test.ts
git commit -m "feat(compute): add FlyClient with createApp"
```

---

### Task 5: FlyClient — add the rest of the lifecycle methods

This task adds destroyApp, launchMachine (with metadata.project_id), startMachine/stopMachine/destroyMachine/listMachines/getMachineStatus/getEvents/waitForState, and a `mapCpuTier` helper. Drives all of them via tests first.

**Files:**
- Modify: `src/services/compute/fly-client.test.ts`
- Modify: `src/services/compute/fly-client.ts`

- [ ] **Step 1: Append failing tests for the remaining methods**

Append to `src/services/compute/fly-client.test.ts`:

```typescript
  describe('destroyApp', () => {
    it('DELETEs /v1/apps/:id', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({ ok: true, text: async () => '' });
      const client = new FlyClient({ token: TOKEN, org: ORG });
      await client.destroyApp('myapp');
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.machines.dev/v1/apps/myapp',
        expect.objectContaining({ method: 'DELETE' })
      );
    });
  });

  describe('launchMachine', () => {
    it('POSTs config with metadata.project_id and tier mapping', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        text: async () => JSON.stringify({ id: 'machine-123' }),
      });
      const client = new FlyClient({ token: TOKEN, org: ORG });
      const result = await client.launchMachine({
        appId: 'myapp',
        image: 'flyio/hellofly:latest',
        port: 8080,
        cpu: 'shared-1x',
        memory: 256,
        envVars: { K: 'V' },
        region: 'iad',
        metadata: { project_id: 'p-1', insforge_service_id: 's-1' },
      });

      expect(result).toEqual({ machineId: 'machine-123' });
      const call = (global.fetch as jest.Mock).mock.calls[0];
      expect(call[0]).toBe('https://api.machines.dev/v1/apps/myapp/machines');
      const body = JSON.parse(call[1].body);
      expect(body.region).toBe('iad');
      expect(body.config.image).toBe('flyio/hellofly:latest');
      expect(body.config.guest).toEqual({ cpu_kind: 'shared', cpus: 1, memory_mb: 256 });
      expect(body.config.env).toEqual({ K: 'V' });
      expect(body.config.metadata).toEqual({ project_id: 'p-1', insforge_service_id: 's-1' });
      expect(body.config.services[0].internal_port).toBe(8080);
    });
  });

  describe('start/stop/destroy/status/list/events', () => {
    it('startMachine POSTs /machines/:id/start', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({ ok: true, text: async () => '' });
      const client = new FlyClient({ token: TOKEN, org: ORG });
      await client.startMachine('app', 'mid');
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.machines.dev/v1/apps/app/machines/mid/start',
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('stopMachine POSTs /machines/:id/stop', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({ ok: true, text: async () => '' });
      const client = new FlyClient({ token: TOKEN, org: ORG });
      await client.stopMachine('app', 'mid');
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.machines.dev/v1/apps/app/machines/mid/stop',
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('destroyMachine DELETEs /machines/:id', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({ ok: true, text: async () => '' });
      const client = new FlyClient({ token: TOKEN, org: ORG });
      await client.destroyMachine('app', 'mid');
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.machines.dev/v1/apps/app/machines/mid',
        expect.objectContaining({ method: 'DELETE' })
      );
    });

    it('getMachineStatus returns parsed state', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        text: async () => JSON.stringify({ state: 'started' }),
      });
      const client = new FlyClient({ token: TOKEN, org: ORG });
      const result = await client.getMachineStatus('app', 'mid');
      expect(result).toEqual({ state: 'started' });
    });

    it('listMachines returns array', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        text: async () =>
          JSON.stringify([{ id: 'm1', state: 'started', region: 'iad' }]),
      });
      const client = new FlyClient({ token: TOKEN, org: ORG });
      const result = await client.listMachines('app');
      expect(result).toEqual([{ id: 'm1', state: 'started', region: 'iad' }]);
    });

    it('getEvents returns mapped event list', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        text: async () =>
          JSON.stringify([
            { type: 'start', status: 'started', source: 'user', timestamp: 1700000000000 },
          ]),
      });
      const client = new FlyClient({ token: TOKEN, org: ORG });
      const result = await client.getEvents('app', 'mid', { limit: 5 });
      expect(result).toEqual([
        { timestamp: 1700000000000, message: '[user] start: started' },
      ]);
    });
  });

  describe('mapCpuTier', () => {
    it('maps known tiers and falls back to shared-1x for unknown', () => {
      const client = new FlyClient({ token: TOKEN, org: ORG });
      // mapCpuTier is private; verify via launchMachine instead
      // (covered above in the metadata test); add an explicit unknown-tier check:
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        text: async () => JSON.stringify({ id: 'm1' }),
      });
      return client
        .launchMachine({
          appId: 'a', image: 'i', port: 80, cpu: 'unknown-tier' as string,
          memory: 128, envVars: {}, region: 'iad', metadata: {},
        })
        .then(() => {
          const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
          expect(body.config.guest).toEqual({ cpu_kind: 'shared', cpus: 1, memory_mb: 128 });
        });
    });
  });
});
```

- [ ] **Step 2: Run tests to verify failures**

Run: `npx jest src/services/compute/fly-client.test.ts`

Expected: original 2 tests still pass; new tests fail with `client.<method> is not a function`.

- [ ] **Step 3: Implement remaining methods**

Replace `src/services/compute/fly-client.ts` with:

```typescript
const FLY_API_BASE = 'https://api.machines.dev/v1';

export interface FlyClientOptions {
  token: string;
  org: string;
}

export interface LaunchMachineParams {
  appId: string;
  image: string;
  port: number;
  cpu: string;
  memory: number;
  envVars: Record<string, string>;
  region: string;
  metadata: Record<string, string>;
}

export interface FlyMachineSummary {
  id: string;
  state: string;
  region: string;
}

export interface FlyEvent {
  timestamp: number;
  message: string;
}

export class FlyClient {
  constructor(private readonly opts: FlyClientOptions) {}

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.opts.token}`,
      'Content-Type': 'application/json',
    };
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T | undefined> {
    const response = await fetch(`${FLY_API_BASE}${path}`, {
      ...init,
      headers: { ...this.headers(), ...init.headers },
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Fly API error (${response.status}): ${body}`);
    }
    const text = await response.text();
    if (!text) return undefined;
    return JSON.parse(text) as T;
  }

  private async requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
    const result = await this.request<T>(path, init);
    if (result === undefined) {
      throw new Error(`Fly API returned empty body for ${init.method ?? 'GET'} ${path}`);
    }
    return result;
  }

  async createApp(params: { name: string; network: string }): Promise<{ appId: string }> {
    await this.request('/apps', {
      method: 'POST',
      body: JSON.stringify({
        app_name: params.name,
        org_slug: this.opts.org,
        network: params.network,
      }),
    });
    return { appId: params.name };
  }

  async destroyApp(appId: string): Promise<void> {
    await this.request(`/apps/${appId}`, { method: 'DELETE' });
  }

  async launchMachine(params: LaunchMachineParams): Promise<{ machineId: string }> {
    const guest = this.mapCpuTier(params.cpu, params.memory);
    const result = await this.requestJson<{ id: string }>(
      `/apps/${params.appId}/machines`,
      {
        method: 'POST',
        body: JSON.stringify({
          config: {
            image: params.image,
            guest,
            env: params.envVars,
            metadata: params.metadata,
            services: [
              {
                ports: [
                  { port: 443, handlers: ['tls', 'http'] },
                  { port: 80, handlers: ['http'] },
                ],
                internal_port: params.port,
                protocol: 'tcp',
              },
            ],
          },
          region: params.region,
        }),
      }
    );
    return { machineId: result.id };
  }

  async startMachine(appId: string, machineId: string): Promise<void> {
    await this.request(`/apps/${appId}/machines/${machineId}/start`, { method: 'POST' });
  }

  async stopMachine(appId: string, machineId: string): Promise<void> {
    await this.request(`/apps/${appId}/machines/${machineId}/stop`, { method: 'POST' });
  }

  async destroyMachine(appId: string, machineId: string): Promise<void> {
    await this.request(`/apps/${appId}/machines/${machineId}`, { method: 'DELETE' });
  }

  async getMachineStatus(appId: string, machineId: string): Promise<{ state: string }> {
    return this.requestJson<{ state: string }>(`/apps/${appId}/machines/${machineId}`);
  }

  async listMachines(appId: string): Promise<FlyMachineSummary[]> {
    const result = await this.request<FlyMachineSummary[]>(`/apps/${appId}/machines`);
    return result ?? [];
  }

  async getEvents(
    appId: string,
    machineId: string,
    options?: { limit?: number }
  ): Promise<FlyEvent[]> {
    const events = await this.request<
      { type: string; status: string; source: string; timestamp: number }[]
    >(`/apps/${appId}/machines/${machineId}/events`);
    const mapped = (events ?? []).map((e) => ({
      timestamp: e.timestamp,
      message: `[${e.source}] ${e.type}: ${e.status}`,
    }));
    return mapped.slice(0, options?.limit ?? 100);
  }

  async waitForState(
    appId: string,
    machineId: string,
    targetStates: string[],
    timeoutMs = 60_000
  ): Promise<string> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const { state } = await this.getMachineStatus(appId, machineId);
        if (targetStates.includes(state)) return state;
      } catch {
        // transient — keep polling
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    throw new Error(
      `Machine did not reach state [${targetStates.join(',')}] within ${timeoutMs}ms`
    );
  }

  private mapCpuTier(
    cpu: string,
    memory: number
  ): { cpu_kind: string; cpus: number; memory_mb: number } {
    const tiers: Record<string, { cpu_kind: string; cpus: number }> = {
      'shared-1x': { cpu_kind: 'shared', cpus: 1 },
      'shared-2x': { cpu_kind: 'shared', cpus: 2 },
      'performance-1x': { cpu_kind: 'performance', cpus: 1 },
      'performance-2x': { cpu_kind: 'performance', cpus: 2 },
      'performance-4x': { cpu_kind: 'performance', cpus: 4 },
    };
    const tier = tiers[cpu] ?? tiers['shared-1x'];
    return { ...tier, memory_mb: memory };
  }
}
```

- [ ] **Step 4: Run tests to verify all pass**

Run: `npx jest src/services/compute/fly-client.test.ts`

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/services/compute/fly-client.ts src/services/compute/fly-client.test.ts
git commit -m "feat(compute): complete FlyClient lifecycle methods

Adds destroy/launch/start/stop/status/list/events/waitForState plus
the shared/performance tier mapping. launchMachine sets
metadata.project_id on every machine — required for ownership
recovery and Prometheus filtering per spec §3.3."
```

---

### Task 6: Compute service config

**Files:**
- Modify: `src/config/app.config.ts`
- Modify: `.env.example`

- [ ] **Step 1: Read the existing config file to find the right insertion point**

Read: `src/config/app.config.ts`. Locate the existing `appConfig` object and identify the closing brace.

- [ ] **Step 2: Add compute config section**

In `src/config/app.config.ts`, add inside the `appConfig` export object (alphabetical placement before existing sections):

```typescript
  compute: {
    flyToken: process.env.FLY_API_TOKEN || '',
    flyOrg: process.env.FLY_ORG || '',
    domain: process.env.COMPUTE_DOMAIN || 'compute.insforge.dev',
  },
```

- [ ] **Step 3: Append documentation to .env.example**

Append to `.env.example`:

```
# ─── Compute Services ─────────────────────────────────────────────────
# Cloud-mode compute provider for InsForge projects.
# Token must be a Fly.io org-scoped token: `fly tokens create org`.
# Token is shared across ALL projects — protect carefully.
FLY_API_TOKEN=
FLY_ORG=
COMPUTE_DOMAIN=compute.insforge.dev
```

- [ ] **Step 4: Verify compile**

Run: `npx tsc --noEmit`

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/config/app.config.ts .env.example
git commit -m "feat(compute): add compute config (FLY_API_TOKEN, FLY_ORG, COMPUTE_DOMAIN)"
```

---

### Task 7: ComputeService — Fly-level methods on top of the ownership row

The cloud-side ComputeService mirrors the OSS `ComputeProvider` interface 1:1. Each method delegates to FlyClient AND maintains the `compute_services` ownership row. All methods take `projectId` as the first arg and verify scoping; cross-project access returns `null`.

**Files:**
- Create: `src/services/compute/compute.service.ts`
- Create: `src/services/compute/compute.service.test.ts`

**Method signatures:**

```typescript
class ComputeService {
  constructor(pool: Pool, fly: FlyClient);

  // Lifecycle (matches OSS ComputeProvider)
  createApp(projectId: string, params: { name: string; network: string }):
    Promise<{ appId: string; serviceId: string }>;
  destroyApp(projectId: string, appId: string): Promise<void>;
  launchMachine(projectId: string, params: LaunchMachineParams):
    Promise<{ machineId: string }>;
  updateMachine(projectId: string, params: UpdateMachineParams): Promise<void>;
  startMachine(projectId: string, appId: string, machineId: string): Promise<void>;
  stopMachine(projectId: string, appId: string, machineId: string): Promise<void>;
  destroyMachine(projectId: string, appId: string, machineId: string): Promise<void>;

  // Read
  listMachines(projectId: string, appId: string): Promise<MachineSummary[]>;
  getMachineStatus(projectId: string, appId: string, machineId: string):
    Promise<{ state: string }>;
  getEvents(projectId: string, appId: string, machineId: string,
            options?: { limit?: number }): Promise<FlyEvent[]>;
}
```

**Row state machine (driven by these methods):**

| Method | Row effect |
|---|---|
| `createApp` | INSERT row: `status='created'`, `fly_machine_id=null`, ownership recorded |
| `launchMachine` | UPDATE matching row by `fly_app_name`: set `fly_machine_id`, `status='started'`, machine `metadata.project_id` set on Fly |
| `startMachine` / `stopMachine` | UPDATE row: `status='started'`/`'stopped'` |
| `destroyMachine` | UPDATE row: `fly_machine_id=null`, `status='stopped'` |
| `destroyApp` | UPDATE row: `destroyed_at=now()` |

**Project-scoping invariant** (every method that touches an existing app/machine):
```sql
SELECT id FROM compute_services
 WHERE project_id = $1
   AND fly_app_name = $2
   AND destroyed_at IS NULL
```
If no row → return `null` (route returns 404). NEVER call Fly without this check passing.

**TDD sequence (one method at a time, same shape as Tasks 3-5):**

For each method below, follow the cycle: **(1) write the failing test → (2) run to fail → (3) implement → (4) run to pass → (5) commit a focused message**.

- [ ] **Step 1: createApp**
  - Test: insert row with status='created', return `appId` + `serviceId`. Quota check (5 active per project) throws `ComputeQuotaExceededError`.
  - Impl: Quota check → INSERT → call `fly.createApp({name, network})` → return.
  - On Fly failure: DELETE row + rethrow.

- [ ] **Step 2: launchMachine**
  - Test: must find row by `fly_app_name`, must inject `metadata.project_id` and `metadata.insforge_service_id`. Cross-project access returns null.
  - Impl: scope-check via SELECT; call `fly.launchMachine({...params, metadata: {project_id, insforge_service_id}})`; UPDATE row with machine_id + status.

- [ ] **Step 3: startMachine + stopMachine**
  - Test: scope-check, call Fly, update row status.
  - Impl: SELECT scope-check → fly call → UPDATE status.

- [ ] **Step 4: destroyMachine + destroyApp**
  - Test: destroyMachine nulls `fly_machine_id` + sets `status='stopped'`. destroyApp sets `destroyed_at`. Both swallow Fly errors (orphan logged, row updates anyway).
  - Impl: scope-check → fly call (try/catch) → UPDATE.

- [ ] **Step 5: getMachineStatus + listMachines + getEvents (read passthroughs)**
  - Test: scope-check, return Fly response. Cross-project returns `null` / empty.
  - Impl: SELECT scope-check → return Fly result.

- [ ] **Step 6: updateMachine**
  - Test: scope-check, call Fly, optionally UPDATE row's `image`/`cpu_tier`/`memory_mb`/`env_vars`.
  - Impl: scope-check → fly call → UPDATE row.

**Test scaffolding (apply to every test):**

```typescript
import { Pool } from 'pg';
import { ComputeService } from './compute.service';
import { FlyClient } from './fly-client';

const flyMock: jest.Mocked<FlyClient> = {
  createApp: jest.fn(), destroyApp: jest.fn(),
  launchMachine: jest.fn(), updateMachine: jest.fn(),
  startMachine: jest.fn(), stopMachine: jest.fn(),
  destroyMachine: jest.fn(), getMachineStatus: jest.fn(),
  listMachines: jest.fn(), getEvents: jest.fn(), waitForState: jest.fn(),
} as unknown as jest.Mocked<FlyClient>;

const PROJECT_ID = '11111111-1111-1111-1111-111111111111';
const OTHER_PROJECT = '22222222-2222-2222-2222-222222222222';

async function freshSchema(pool: Pool) {
  await pool.query('TRUNCATE compute_services RESTART IDENTITY CASCADE');
  await pool.query(
    `INSERT INTO projects (id, name) VALUES ($1, 'p1') ON CONFLICT (id) DO NOTHING`,
    [PROJECT_ID]);
  await pool.query(
    `INSERT INTO projects (id, name) VALUES ($1, 'p2') ON CONFLICT (id) DO NOTHING`,
    [OTHER_PROJECT]);
}

describe('ComputeService', () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  let service: ComputeService;
  beforeAll(async () => { /* run migration if compute_services missing */ });
  beforeEach(async () => { jest.clearAllMocks(); await freshSchema(pool);
                           service = new ComputeService(pool, flyMock); });
  afterAll(() => pool.end());
  // ...one describe block per Step 1-6 above
});
```

**Reference impl skeleton (createApp + launchMachine; the rest follow the same pattern):**

```typescript
import { Pool } from 'pg';
import {
  ComputeService as ComputeServiceRow,
} from '../../models/compute-service.model';
import { FlyClient, LaunchMachineParams } from './fly-client';

const MAX_ACTIVE_SERVICES_PER_PROJECT = 5;

export class ComputeQuotaExceededError extends Error {
  readonly code = 'COMPUTE_QUOTA_EXCEEDED';
}

export class ComputeService {
  constructor(private pool: Pool, private fly: FlyClient) {}

  async createApp(
    projectId: string,
    params: { name: string; network: string }
  ): Promise<{ appId: string; serviceId: string }> {
    // Quota
    const { rows: [{ n }] } = await this.pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM compute_services
        WHERE project_id = $1 AND destroyed_at IS NULL`,
      [projectId]
    );
    if (n >= MAX_ACTIVE_SERVICES_PER_PROJECT) {
      throw new ComputeQuotaExceededError(
        `Project ${projectId} has reached ${MAX_ACTIVE_SERVICES_PER_PROJECT} active services`
      );
    }
    // Insert ownership row first; rollback if Fly call fails
    const flyAppName = params.name; // OSS already passes the prefixed app name
    const inserted = await this.pool.query<ComputeServiceRow>(
      `INSERT INTO compute_services
         (project_id, name, fly_app_name, region, cpu_tier, memory_mb, image, status)
       VALUES ($1, $2, $3, 'unknown', 'unknown', 0, 'unknown', 'created')
       RETURNING *`,
      [projectId, params.name, flyAppName]
    );
    const row = inserted.rows[0];
    try {
      await this.fly.createApp({ name: flyAppName, network: params.network });
    } catch (err) {
      await this.pool.query(`DELETE FROM compute_services WHERE id = $1`, [row.id]);
      throw err;
    }
    return { appId: flyAppName, serviceId: row.id };
  }

  private async findScoped(projectId: string, appId: string) {
    const r = await this.pool.query<ComputeServiceRow>(
      `SELECT * FROM compute_services
        WHERE project_id = $1 AND fly_app_name = $2 AND destroyed_at IS NULL`,
      [projectId, appId]
    );
    return r.rows[0] ?? null;
  }

  async launchMachine(
    projectId: string,
    params: LaunchMachineParams
  ): Promise<{ machineId: string } | null> {
    const row = await this.findScoped(projectId, params.appId);
    if (!row) return null;
    const { machineId } = await this.fly.launchMachine({
      ...params,
      metadata: { project_id: projectId, insforge_service_id: row.id },
    });
    await this.pool.query(
      `UPDATE compute_services
          SET fly_machine_id = $1, status = 'started',
              region = $2, cpu_tier = $3, memory_mb = $4, image = $5,
              port = $6, env_vars = $7::jsonb, updated_at = now()
        WHERE id = $8`,
      [machineId, params.region, params.cpu, params.memory,
       params.image, params.port, JSON.stringify(params.envVars), row.id]
    );
    return { machineId };
  }

  // startMachine, stopMachine, destroyMachine, destroyApp,
  // getMachineStatus, listMachines, getEvents, updateMachine —
  // all follow: findScoped → fly.X → optional UPDATE → return
}
```

> **Note on row schema:** `region`, `cpu_tier`, `memory_mb`, `image` are `NOT NULL` in the migration but get filled by `launchMachine`. The `createApp` insert above uses `'unknown'`/`0` placeholders. Decision: drop `NOT NULL` from those four columns in the migration (Task 1) — they're meaningful only after `launchMachine`. Update Task 1's migration if not already done.

- [ ] **Step 7: Run all ComputeService tests pass + commit**

Run: `DATABASE_URL=$(grep DATABASE_URL .env | cut -d= -f2-) npx jest src/services/compute/compute.service.test.ts`

Expected: every method tested, all green.

Commit:
```bash
git add src/services/compute/compute.service.ts src/services/compute/compute.service.test.ts
git commit -m "feat(compute): add ComputeService Fly-level methods over ownership row

Mirrors OSS ComputeProvider interface 1:1. Every machine launch
sets metadata.project_id (recovery channel per spec §3.3). All
methods scope by project_id; cross-project returns null. Quota
of 5 active services per project."
```

---

### Task 7b: Adjust migration NOT NULL constraints

If the placeholder approach in Task 7 was used, relax the migration so `region`, `cpu_tier`, `memory_mb`, `image` are nullable until `launchMachine` fills them.

**Files:**
- Modify: `migrations/052_create-compute-services.sql`

- [ ] **Step 1: Drop NOT NULL on the four columns that aren't known until launchMachine**

Edit `migrations/052_create-compute-services.sql` so these lines are:
```sql
  region          text,
  cpu_tier        text,
  memory_mb       int,
  image           text,
```

- [ ] **Step 2: Re-apply migration to verify and amend Task 1's commit**

```bash
psql "$DATABASE_URL" -c 'DROP TABLE compute_services CASCADE;'
psql "$DATABASE_URL" -f migrations/052_create-compute-services.sql
git add migrations/052_create-compute-services.sql
git commit -m "fix(compute): allow null region/cpu_tier/memory_mb/image until launchMachine"
```

---

### Task 8: Routes + DI + live integration test

Routes mirror Fly-level methods 1:1 — each is a thin pass-through to `ComputeService`. JWT-signed via existing `sign` header convention; `req.params.projectId` MUST equal `jwt.sub`.

**Files:**
- Create: `src/routes/compute.routes.ts`
- Create: `src/test/compute/compute.routes.test.ts`
- Create: `src/test/compute/compute.live.integration.test.ts`
- Modify: `src/app.ts`
- Modify: `src/container.ts`

**Route table (mounted at `/projects/v1/:projectId/compute`):**

| Method | Path | Service call |
|---|---|---|
| POST | `/apps` | `createApp(projectId, body)` → 201 |
| DELETE | `/apps/:appId` | `destroyApp(projectId, appId)` → 204 |
| POST | `/machines` | `launchMachine(projectId, body)` → 201 / 404 if app not in project |
| PATCH | `/machines/:machineId` | `updateMachine(projectId, {appId, machineId, ...body})` → 200 / 404 |
| GET | `/machines?appId=...` | `listMachines(projectId, appId)` → 200 / 404 |
| GET | `/machines/:machineId?appId=...` | `getMachineStatus(projectId, appId, machineId)` → 200 / 404 |
| GET | `/machines/:machineId/events?appId=...` | `getEvents(projectId, appId, machineId, opts)` → 200 / 404 |
| POST | `/machines/:machineId/start` | `startMachine(projectId, appId, machineId)` (appId in body) → 204 |
| POST | `/machines/:machineId/stop` | `stopMachine(projectId, appId, machineId)` → 204 |
| DELETE | `/machines/:machineId` | `destroyMachine(projectId, appId, machineId)` (appId in body) → 204 |

> **Why appId is needed for machine ops:** Fly machines are scoped by app. ComputeService uses `(projectId, appId)` to scope-check. The OSS `CloudComputeProvider` already has both in scope when calling these methods (provider methods take `(appId, machineId)`).

**Auth middleware (re-used pattern from `project.routes.ts`):**

```typescript
function requireProjectAuth(req, res, next) {
  const sign = req.header('sign');
  if (!sign) return res.status(401).json({ error: 'Missing sign header' });
  const secret = process.env.JWT_SECRET;
  let claims: { sub: string };
  try { claims = jwt.verify(sign, secret!) as any; }
  catch { return res.status(401).json({ error: 'Invalid sign token' }); }
  if (claims.sub !== req.params.projectId)
    return res.status(403).json({ error: 'project_id mismatch' });
  next();
}
```

**TDD sequence:**

- [ ] **Step 1: Write failing tests covering auth (401 missing sign, 403 mismatched sub) + happy path for each route**

Use supertest with a mocked `ComputeService`. One `describe` per route. Verify the call args (especially `projectId` being the URL param, never trusting body).

- [ ] **Step 2: Run to fail**

Run: `npx jest src/test/compute/compute.routes.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `compute.routes.ts`**

Skeleton (each route is ~5 lines after the auth middleware):

```typescript
import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { ComputeService, ComputeQuotaExceededError } from
  '../services/compute/compute.service';

export function computeRoutes(service: ComputeService): Router {
  const router = Router({ mergeParams: true });
  const base = '/:projectId/compute';

  router.use(`${base}`, requireProjectAuth);

  router.post(`${base}/apps`, async (req, res) => {
    try {
      const created = await service.createApp(req.params.projectId, {
        name: req.body.name, network: req.body.network ?? req.body.name,
      });
      res.status(201).json(created);
    } catch (e) {
      if (e instanceof ComputeQuotaExceededError) {
        return res.status(403).json({ code: e.code, error: e.message });
      }
      throw e;
    }
  });

  router.delete(`${base}/apps/:appId`, async (req, res) => {
    await service.destroyApp(req.params.projectId, req.params.appId);
    res.sendStatus(204);
  });

  router.post(`${base}/machines`, async (req, res) => {
    const result = await service.launchMachine(req.params.projectId, req.body);
    if (!result) return res.sendStatus(404);
    res.status(201).json(result);
  });

  // PATCH /machines/:machineId, GET /machines, GET /machines/:machineId,
  // GET /machines/:machineId/events, POST /machines/:machineId/start,
  // POST /machines/:machineId/stop, DELETE /machines/:machineId
  // — all follow the same pass-through-with-null-check pattern.

  return router;
}
```

- [ ] **Step 4: Run to pass**

Run: `npx jest src/test/compute/compute.routes.test.ts`

Expected: all tests green.

- [ ] **Step 5: Wire DI + mount routes**

In `src/container.ts`:
```typescript
import { ComputeService } from './services/compute/compute.service';
import { FlyClient } from './services/compute/fly-client';
const flyClient = new FlyClient({
  token: appConfig.compute.flyToken,
  org: appConfig.compute.flyOrg,
});
const computeService = new ComputeService(pool, flyClient);
// add to exports
```

In `src/app.ts`:
```typescript
import { computeRoutes } from './routes/compute.routes';
app.use('/projects/v1', computeRoutes(container.computeService));
```

- [ ] **Step 6: Live integration test**

Create `src/test/compute/compute.live.integration.test.ts` (skipped unless `FLY_API_TOKEN` + `FLY_ORG` set):

```typescript
import { Pool } from 'pg';
import { ComputeService } from '../../services/compute/compute.service';
import { FlyClient } from '../../services/compute/fly-client';

const RUN_LIVE = !!process.env.FLY_API_TOKEN && !!process.env.FLY_ORG;
const maybe = RUN_LIVE ? describe : describe.skip;

const PROJECT_ID = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

maybe('ComputeService [live]', () => {
  jest.setTimeout(180_000);
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  let service: ComputeService;
  let appId: string | null = null;
  let machineId: string | null = null;

  beforeAll(async () => {
    await pool.query(
      `INSERT INTO projects (id, name) VALUES ($1, 'live') ON CONFLICT DO NOTHING`,
      [PROJECT_ID]);
    service = new ComputeService(pool, new FlyClient({
      token: process.env.FLY_API_TOKEN!,
      org: process.env.FLY_ORG!,
    }));
  });

  afterAll(async () => {
    if (machineId && appId) {
      try { await service.destroyMachine(PROJECT_ID, appId, machineId); } catch {}
    }
    if (appId) {
      try { await service.destroyApp(PROJECT_ID, appId); } catch {}
    }
    await pool.end();
  });

  it('createApp → launchMachine → stop → start → destroy lifecycle', async () => {
    const name = `ifc-live-${Date.now().toString(36)}`;
    const created = await service.createApp(PROJECT_ID, { name, network: name });
    appId = created.appId;
    const launched = await service.launchMachine(PROJECT_ID, {
      appId: appId!,
      image: 'flyio/hellofly:latest',
      port: 8080, cpu: 'shared-1x', memory: 256,
      envVars: { TEST: 'live' }, region: 'iad',
      metadata: {}, // service injects project_id + insforge_service_id
    });
    machineId = launched!.machineId;

    await service.stopMachine(PROJECT_ID, appId!, machineId!);
    await service.startMachine(PROJECT_ID, appId!, machineId!);
    await service.destroyMachine(PROJECT_ID, appId!, machineId!);
    machineId = null;
    await service.destroyApp(PROJECT_ID, appId!);
    appId = null;
  });
});
```

- [ ] **Step 7: Commit**

```bash
git add src/routes/compute.routes.ts src/test/compute/ src/app.ts src/container.ts
git commit -m "feat(compute): add Fly-level cloud routes + live integration test

Routes mirror OSS ComputeProvider interface 1:1
(/apps, /apps/:id, /machines, /machines/:id, etc.) so the OSS
CloudComputeProvider can be a clean forwarder. JWT-signed via
existing 'sign' header. Live integration test gated on
FLY_API_TOKEN env."
```

---
### Task 9: Extract ComputeProvider interface

**Files:**
- Create: `backend/src/providers/compute/compute.provider.ts`
- Modify: `backend/src/providers/compute/fly.provider.ts`

- [ ] **Step 1: Read existing fly.provider.ts to enumerate the public surface**

Read: `backend/src/providers/compute/fly.provider.ts`. Note every public method signature.

- [ ] **Step 2: Create the interface file**

Create `backend/src/providers/compute/compute.provider.ts`:

```typescript
export interface LaunchMachineParams {
  appId: string;
  image: string;
  port: number;
  cpu: string;
  memory: number;
  envVars: Record<string, string>;
  region: string;
}

export interface UpdateMachineParams {
  appId: string;
  machineId: string;
  image: string;
  port: number;
  cpu: string;
  memory: number;
  envVars: Record<string, string>;
}

export interface MachineSummary {
  id: string;
  state: string;
  region: string;
}

export interface ComputeEvent {
  timestamp: number;
  message: string;
}

export interface ComputeProvider {
  isConfigured(): boolean;
  createApp(params: { name: string; network: string; org: string }): Promise<{ appId: string }>;
  destroyApp(appId: string): Promise<void>;
  launchMachine(params: LaunchMachineParams): Promise<{ machineId: string }>;
  updateMachine(params: UpdateMachineParams): Promise<void>;
  stopMachine(appId: string, machineId: string): Promise<void>;
  startMachine(appId: string, machineId: string): Promise<void>;
  destroyMachine(appId: string, machineId: string): Promise<void>;
  listMachines(appId: string): Promise<MachineSummary[]>;
  getMachineStatus(appId: string, machineId: string): Promise<{ state: string }>;
  getLogs(
    appId: string,
    machineId: string,
    options?: { limit?: number }
  ): Promise<ComputeEvent[]>;
  waitForState(
    appId: string,
    machineId: string,
    targetStates: string[],
    timeoutMs?: number
  ): Promise<string>;
}
```

- [ ] **Step 3: Make FlyProvider implement the interface**

In `backend/src/providers/compute/fly.provider.ts`, add the import and `implements`:

```typescript
import type { ComputeProvider } from './compute.provider.js';
// ...
export class FlyProvider implements ComputeProvider {
```

- [ ] **Step 4: Verify compile**

Run: `cd backend && npx tsc --noEmit`

Expected: no errors.

- [ ] **Step 5: Run existing FlyProvider tests to confirm no regression**

Run: `cd backend && npx vitest run tests/unit/compute/fly-provider.test.ts`

Expected: all existing tests still pass.

- [ ] **Step 6: Commit**

```bash
git add backend/src/providers/compute/compute.provider.ts backend/src/providers/compute/fly.provider.ts
git commit -m "refactor(compute): extract ComputeProvider interface

Shared shape for FlyProvider (existing self-host) and
CloudComputeProvider (added next). No behavior change."
```

---

### Task 10: CloudComputeProvider — TDD

**Files:**
- Create: `backend/tests/unit/compute/cloud-provider.test.ts`
- Create: `backend/src/providers/compute/cloud.provider.ts`

- [ ] **Step 1: Write a failing test for createApp**

Create `backend/tests/unit/compute/cloud-provider.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import jwt from 'jsonwebtoken';

vi.mock('@/infra/config/app.config.js', () => ({
  config: {
    cloud: { apiHost: 'https://cloud.test', projectId: 'proj-1', computeEnabled: true },
    app: { jwtSecret: 'secret-1' },
  },
}));

import { CloudComputeProvider } from '@/providers/compute/cloud.provider.js';

describe('CloudComputeProvider', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  it('createApp POSTs with sign header containing JWT { sub: project_id }', async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ appId: 'ifc-proj-test' }),
    });

    const provider = CloudComputeProvider.getInstance();
    const result = await provider.createApp({
      name: 'test', network: 'test', org: 'unused-in-cloud-mode',
    });

    const call = (global.fetch as any).mock.calls[0];
    expect(call[0]).toBe('https://cloud.test/projects/v1/proj-1/compute/apps');
    const headers = call[1].headers;
    const decoded = jwt.verify(headers.sign, 'secret-1') as { sub: string };
    expect(decoded.sub).toBe('proj-1');
    expect(result.appId).toBe('ifc-proj-test');
  });

  it('throws COMPUTE_CLOUD_UNAVAILABLE on network error', async () => {
    (global.fetch as any).mockRejectedValue(new Error('ECONNREFUSED'));
    const provider = CloudComputeProvider.getInstance();
    await expect(provider.createApp({ name: 't', network: 't', org: 'o' }))
      .rejects.toThrow(/COMPUTE_CLOUD_UNAVAILABLE/);
  });

  it('throws when cloud returns non-2xx with body', async () => {
    (global.fetch as any).mockResolvedValue({
      ok: false, status: 403,
      text: async () => '{"code":"COMPUTE_QUOTA_EXCEEDED","error":"limit reached"}',
    });
    const provider = CloudComputeProvider.getInstance();
    await expect(provider.createApp({ name: 't', network: 't', org: 'o' }))
      .rejects.toThrow(/limit reached|COMPUTE_QUOTA_EXCEEDED/);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && npx vitest run tests/unit/compute/cloud-provider.test.ts`

Expected: FAIL — `Cannot find module '@/providers/compute/cloud.provider.js'`.

- [ ] **Step 3: Implement CloudComputeProvider**

Create `backend/src/providers/compute/cloud.provider.ts`:

```typescript
import jwt from 'jsonwebtoken';
import { config } from '@/infra/config/app.config.js';
import { AppError } from '@/api/middlewares/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import type {
  ComputeProvider,
  LaunchMachineParams,
  UpdateMachineParams,
  MachineSummary,
  ComputeEvent,
} from './compute.provider.js';

export class CloudComputeProvider implements ComputeProvider {
  private static instance: CloudComputeProvider;

  static getInstance(): CloudComputeProvider {
    if (!CloudComputeProvider.instance) {
      CloudComputeProvider.instance = new CloudComputeProvider();
    }
    return CloudComputeProvider.instance;
  }

  isConfigured(): boolean {
    return (
      config.cloud.computeEnabled &&
      !!config.cloud.projectId &&
      config.cloud.projectId !== 'local' &&
      !!config.app.jwtSecret
    );
  }

  private signToken(): string {
    if (!this.isConfigured()) {
      throw new AppError(
        'Cloud compute not configured (need PROJECT_ID, JWT_SECRET, CLOUD_COMPUTE_ENABLED)',
        500,
        ERROR_CODES.COMPUTE_NOT_CONFIGURED,
      );
    }
    return jwt.sign({ sub: config.cloud.projectId }, config.app.jwtSecret, {
      expiresIn: '10m',
    });
  }

  private url(path: string): string {
    return `${config.cloud.apiHost}/projects/v1/${config.cloud.projectId}/compute${path}`;
  }

  private async call<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T | undefined> {
    let response: Response;
    try {
      response = await fetch(this.url(path), {
        method,
        headers: {
          sign: this.signToken(),
          'Content-Type': 'application/json',
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      throw new AppError(
        `COMPUTE_CLOUD_UNAVAILABLE: ${(err as Error).message}`,
        503,
        ERROR_CODES.COMPUTE_CLOUD_UNAVAILABLE,
        {
          nextActions: [
            'Check CLOUD_API_HOST is reachable',
            'Verify cloud backend health',
          ],
        }
      );
    }
    const text = await response.text();
    if (!response.ok) {
      throw new AppError(
        text || `Cloud compute error (${response.status})`,
        response.status,
        ERROR_CODES.COMPUTE_PROVIDER_ERROR
      );
    }
    return text ? (JSON.parse(text) as T) : undefined;
  }

  async createApp(params: { name: string; network: string; org: string }) {
    const result = await this.call<{ appId: string; serviceId: string }>('POST', '/apps', {
      name: params.name,
      network: params.network,
    });
    return { appId: result?.appId ?? params.name };
  }

  async destroyApp(appId: string): Promise<void> {
    await this.call('DELETE', `/apps/${appId}`);
  }

  async launchMachine(params: LaunchMachineParams): Promise<{ machineId: string }> {
    const result = await this.call<{ machineId: string }>('POST', '/machines', params);
    return { machineId: result!.machineId };
  }

  async updateMachine(params: UpdateMachineParams): Promise<void> {
    // appId travels in body so cloud can scope-check before calling Fly
    await this.call('PATCH', `/machines/${params.machineId}`, params);
  }

  async stopMachine(appId: string, machineId: string): Promise<void> {
    await this.call('POST', `/machines/${machineId}/stop`, { appId });
  }

  async startMachine(appId: string, machineId: string): Promise<void> {
    await this.call('POST', `/machines/${machineId}/start`, { appId });
  }

  async destroyMachine(appId: string, machineId: string): Promise<void> {
    // appId in body since DELETE bodies are accepted by our cloud (Express allows it)
    await this.call('DELETE', `/machines/${machineId}`, { appId });
  }

  async listMachines(appId: string): Promise<MachineSummary[]> {
    return (await this.call<MachineSummary[]>('GET', `/machines?appId=${encodeURIComponent(appId)}`)) ?? [];
  }

  async getMachineStatus(
    appId: string,
    machineId: string
  ): Promise<{ state: string }> {
    return (await this.call<{ state: string }>(
      'GET', `/machines/${machineId}?appId=${encodeURIComponent(appId)}`))!;
  }

  async getLogs(
    appId: string,
    machineId: string,
    options?: { limit?: number }
  ): Promise<ComputeEvent[]> {
    const qs = `?appId=${encodeURIComponent(appId)}` +
               (options?.limit ? `&limit=${options.limit}` : '');
    return (await this.call<ComputeEvent[]>('GET', `/machines/${machineId}/events${qs}`)) ?? [];
  }

  async waitForState(
    appId: string,
    machineId: string,
    targetStates: string[],
    timeoutMs = 60_000
  ): Promise<string> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const { state } = await this.getMachineStatus(appId, machineId);
      if (targetStates.includes(state)) return state;
      await new Promise((r) => setTimeout(r, 1500));
    }
    throw new AppError(
      `Machine ${machineId} did not reach ${targetStates.join('|')} within ${timeoutMs}ms`,
      504,
      ERROR_CODES.COMPUTE_PROVIDER_ERROR
    );
  }
}
```

- [ ] **Step 4: Run tests pass**

Run: `cd backend && npx vitest run tests/unit/compute/cloud-provider.test.ts`

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/providers/compute/cloud.provider.ts backend/tests/unit/compute/cloud-provider.test.ts
git commit -m "feat(compute): add CloudComputeProvider

Implements ComputeProvider interface by JWT-signing requests to the
cloud backend's /projects/v1/<pid>/compute/* endpoints. Mirrors the
existing CloudDatabaseProvider auth pattern (sign header, jwt.sub =
projectId). All errors surface AppError with COMPUTE_* codes so the
existing nextActions UX continues to work."
```

---

### Task 11: Add config + error codes

**Files:**
- Modify: `backend/src/infra/config/app.config.ts`
- Modify: `backend/src/types/error-constants.ts`
- Modify: `.env.example`

- [ ] **Step 1: Add `cloud.computeEnabled` to AppConfig**

In `backend/src/infra/config/app.config.ts`, find the `cloud` section in both `AppConfig` and `config`. Add:

In the `cloud` interface block (alphabetical):
```typescript
    computeEnabled: boolean;
```

In the `config.cloud` literal (alphabetical):
```typescript
    computeEnabled: process.env.CLOUD_COMPUTE_ENABLED === 'true',
```

- [ ] **Step 2: Add error codes**

In `backend/src/types/error-constants.ts`, find the `ERROR_CODES` const. Add (alphabetical within the COMPUTE_ section):

```typescript
  COMPUTE_NOT_CONFIGURED: 'COMPUTE_NOT_CONFIGURED',
  COMPUTE_CLOUD_UNAVAILABLE: 'COMPUTE_CLOUD_UNAVAILABLE',
  COMPUTE_PROVIDER_ERROR: 'COMPUTE_PROVIDER_ERROR',
```

(Skip any that already exist — check first.)

- [ ] **Step 3: Document the env var**

In `.env.example`, locate the `# ─── Compute Services (Fly.io) ──` section. Append:

```
# Cloud-mode compute: route compute service operations through the InsForge
# cloud backend instead of calling Fly directly. Self-host users with their
# own FLY_API_TOKEN should leave this unset.
CLOUD_COMPUTE_ENABLED=false
```

- [ ] **Step 4: Verify compile**

Run: `cd backend && npx tsc --noEmit`

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add backend/src/infra/config/app.config.ts backend/src/types/error-constants.ts .env.example
git commit -m "feat(compute): add CLOUD_COMPUTE_ENABLED config + error codes"
```

---

### Task 12: Wire factory into ComputeServicesService

**Files:**
- Modify: `backend/src/services/compute/services.service.ts`
- Modify: `backend/tests/unit/compute/services-service.test.ts`

- [ ] **Step 1: Read services.service.ts to find current FlyProvider usage**

Read: `backend/src/services/compute/services.service.ts`. Note all references to `FlyProvider.getInstance()` — these become factory calls.

- [ ] **Step 2: Write the factory test (will fail)**

Append to `backend/tests/unit/compute/services-service.test.ts`:

```typescript
describe('selectComputeProvider factory', () => {
  it('returns FlyProvider when FLY_API_TOKEN is set', async () => {
    vi.doMock('@/infra/config/app.config.js', () => ({
      config: {
        fly: { apiToken: 'tok', org: 'o', enabled: true, domain: 'd' },
        cloud: { computeEnabled: false, projectId: 'local', apiHost: '' },
        app: { jwtSecret: 'x' },
      },
    }));
    const { selectComputeProvider } = await import('@/services/compute/services.service.js');
    const { FlyProvider } = await import('@/providers/compute/fly.provider.js');
    expect(selectComputeProvider()).toBe(FlyProvider.getInstance());
  });

  it('returns CloudComputeProvider when cloud is enabled and no FLY_API_TOKEN', async () => {
    vi.doMock('@/infra/config/app.config.js', () => ({
      config: {
        fly: { apiToken: '', org: '', enabled: false, domain: '' },
        cloud: { computeEnabled: true, projectId: 'p', apiHost: 'https://x' },
        app: { jwtSecret: 'x' },
      },
    }));
    const { selectComputeProvider } = await import('@/services/compute/services.service.js');
    const { CloudComputeProvider } = await import('@/providers/compute/cloud.provider.js');
    expect(selectComputeProvider()).toBe(CloudComputeProvider.getInstance());
  });

  it('throws COMPUTE_NOT_CONFIGURED when neither is set', async () => {
    vi.doMock('@/infra/config/app.config.js', () => ({
      config: {
        fly: { apiToken: '', org: '', enabled: false, domain: '' },
        cloud: { computeEnabled: false, projectId: 'local', apiHost: '' },
        app: { jwtSecret: 'x' },
      },
    }));
    const { selectComputeProvider } = await import('@/services/compute/services.service.js');
    expect(() => selectComputeProvider()).toThrow(/COMPUTE_NOT_CONFIGURED/);
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `cd backend && npx vitest run tests/unit/compute/services-service.test.ts -t selectComputeProvider`

Expected: 3 tests fail — `selectComputeProvider is not exported`.

- [ ] **Step 4: Add the factory + use it inside the service**

In `backend/src/services/compute/services.service.ts`:

(a) Add imports:
```typescript
import { CloudComputeProvider } from '@/providers/compute/cloud.provider.js';
import type { ComputeProvider } from '@/providers/compute/compute.provider.js';
import { AppError } from '@/api/middlewares/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
```

(b) Add the exported factory above the class:
```typescript
export function selectComputeProvider(): ComputeProvider {
  if (config.fly.apiToken) {
    return FlyProvider.getInstance();
  }
  if (config.cloud.computeEnabled) {
    return CloudComputeProvider.getInstance();
  }
  throw new AppError(
    'Compute services not configured. Set FLY_API_TOKEN for self-host, ' +
      'or enable CLOUD_COMPUTE_ENABLED to use cloud-managed compute.',
    503,
    ERROR_CODES.COMPUTE_NOT_CONFIGURED,
    {
      nextActions: [
        'Self-hosted: set FLY_API_TOKEN in .env (see .env.example)',
        'Cloud: set CLOUD_COMPUTE_ENABLED=true and verify PROJECT_ID is set',
      ],
    }
  );
}
```

(c) Replace every `FlyProvider.getInstance()` inside the class with a single `private readonly compute: ComputeProvider` field initialized once in the constructor (or via lazy getter):
```typescript
private readonly compute: ComputeProvider = selectComputeProvider();
```

Then update method bodies to use `this.compute.<method>(...)` instead of `FlyProvider.getInstance().<method>(...)`.

- [ ] **Step 5: Run all compute tests pass**

Run: `cd backend && npx vitest run tests/unit/compute/`

Expected: all tests pass (existing + new).

- [ ] **Step 6: Run full backend typecheck**

Run: `cd backend && npx tsc --noEmit`

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add backend/src/services/compute/services.service.ts backend/tests/unit/compute/services-service.test.ts
git commit -m "feat(compute): add selectComputeProvider factory

Picks FlyProvider when FLY_API_TOKEN is set (self-host, unchanged),
CloudComputeProvider when CLOUD_COMPUTE_ENABLED=true, throws
COMPUTE_NOT_CONFIGURED otherwise. Self-host behavior is unchanged
from the current branch."
```

---

## Verification

After all 12 tasks:

- [ ] **Cloud worktree:** `cd /Users/gary/projects/insforge-repo/insforge-cloud-backend-compute-services && npx jest src/services/compute src/test/compute` — all green.
- [ ] **OSS worktree:** `cd /Users/gary/projects/insforge-repo/insforge-compute-cloud-provider && cd backend && npx vitest run tests/unit/compute/` — all green.
- [ ] **Cloud worktree typecheck:** `cd /Users/gary/projects/insforge-repo/insforge-cloud-backend-compute-services && npx tsc --noEmit` — no errors.
- [ ] **OSS worktree typecheck:** `cd /Users/gary/projects/insforge-repo/insforge-compute-cloud-provider && npm run typecheck` — no errors.
- [ ] **Live integration test (manual):** in the cloud worktree with `FLY_API_TOKEN` + `FLY_ORG` + `DATABASE_URL` set, run `npx jest src/test/compute/compute.live.integration.test.ts`. Should create → cycle → destroy a real Fly machine.
- [ ] **End-to-end manual smoke** (after both PRs merged): in an OSS instance with `CLOUD_COMPUTE_ENABLED=true` + a valid cloud `PROJECT_ID`, hit `POST /api/compute/services` and verify the service appears in the cloud DB row.

## Out of scope (per spec §9)

- Usage tracking (`compute_usage_hourly` table, hourly Prometheus scrape job, cost translation) — designed in spec §6, deferred to follow-up PR.
- Reconciliation job for Fly orphans — deferred.
- Webhooks — Fly Extensions Program only.
- Bandwidth attribution.
- Per-project quota overrides.
