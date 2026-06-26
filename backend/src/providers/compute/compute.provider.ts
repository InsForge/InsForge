export interface LaunchMachineParams {
  appId: string;
  /**
   * Image URL — image-mode (any registry) or source-mode (digest-pinned
   * registry.fly.io ref produced by the CLI's `flyctl deploy --build-only --push`).
   */
  image: string;
  port: number;
  cpu: string;
  memory: number;
  envVars: Record<string, string>;
  region: string;
  /**
   * Edge protocol. `'http'` (default) terminates TLS at the Fly anycast edge
   * and proxies HTTP/1.1+HTTP/2 to the container. `'tcp'` exposes the container's
   * port directly with empty handlers — for Redis, Postgres-protocol, and other
   * raw TCP services. Omitting the field is identical to `'http'`.
   */
  protocol?: 'http' | 'tcp';
}

export interface UpdateMachineParams {
  appId: string;
  machineId: string;
  /**
   * Image URL — same shape as LaunchMachineParams.image. For non-image
   * updates (port-only, env-only) pass the existing image URL.
   */
  image: string;
  port: number;
  cpu: string;
  memory: number;
  envVars: Record<string, string>;
  /**
   * Edge protocol — same semantics as LaunchMachineParams.protocol. Omit
   * for back-compat HTTP behavior.
   */
  protocol?: 'http' | 'tcp';
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

// A single container stdout/stderr line. `timestamp` is epoch milliseconds.
export interface ComputeLogLine {
  timestamp: number;
  message: string;
  instance?: string;
  region?: string;
}

// Result of fetching container logs. `nextToken` is an opaque forward cursor
// (Fly's `next_token`) for live tailing; null when nothing further is available.
export interface ComputeLogsResult {
  lines: ComputeLogLine[];
  nextToken: string | null;
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
  getEvents(
    appId: string,
    machineId: string,
    options?: { limit?: number }
  ): Promise<ComputeEvent[]>;
  getLogs(
    appId: string,
    machineId: string,
    options?: { limit?: number; nextToken?: string }
  ): Promise<ComputeLogsResult>;
  waitForState(
    appId: string,
    machineId: string,
    targetStates: string[],
    timeoutMs?: number
  ): Promise<string>;
}
