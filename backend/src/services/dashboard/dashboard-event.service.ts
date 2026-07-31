import type {
  DashboardDataUpdateEvent,
  DashboardEvent,
  DashboardMcpConnectedEvent,
} from '@insforge/shared-schemas';

type DashboardEventListener = (event: DashboardEvent) => void;

export class DashboardEventService {
  private static instance: DashboardEventService;
  private readonly listeners = new Set<DashboardEventListener>();

  private constructor() {}

  static getInstance(): DashboardEventService {
    if (!DashboardEventService.instance) {
      DashboardEventService.instance = new DashboardEventService();
    }
    return DashboardEventService.instance;
  }

  subscribe(listener: DashboardEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  publishDataUpdate(event: Omit<DashboardDataUpdateEvent, 'type'>): void {
    this.publish({ type: 'data-update', ...event });
  }

  publishMcpConnected(event: Omit<DashboardMcpConnectedEvent, 'type'>): void {
    this.publish({ type: 'mcp-connected', ...event });
  }

  private publish(event: DashboardEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}

export const dashboardEventService = DashboardEventService.getInstance();
