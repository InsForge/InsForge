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
  getLogs(appId: string, machineId: string, options?: { limit?: number }): Promise<ComputeEvent[]>;
  waitForState(
    appId: string,
    machineId: string,
    targetStates: string[],
    timeoutMs?: number,
  ): Promise<string>;
}
