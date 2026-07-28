import {
  AgentSessionMetrics,
  AgentTelemetryStatsResponse,
  RecordAgentToolCallRequest,
} from '@insforge/shared-schemas';

interface ToolCallRecord {
  sessionId: string;
  agentId?: string;
  toolName: string;
  durationMs: number;
  status: 'success' | 'error';
  errorMessage?: string;
  metadata?: Record<string, unknown>;
  timestamp: string;
  projectId: string;
}

export class AgentTelemetryService {
  private static instance: AgentTelemetryService;
  private records: ToolCallRecord[] = [];
  private readonly maxRecords = 5000;

  private constructor() {}

  public static getInstance(): AgentTelemetryService {
    if (!AgentTelemetryService.instance) {
      AgentTelemetryService.instance = new AgentTelemetryService();
    }
    return AgentTelemetryService.instance;
  }

  recordToolCall(input: RecordAgentToolCallRequest, projectId = 'default'): ToolCallRecord {
    const record: ToolCallRecord = {
      ...input,
      projectId,
      timestamp: new Date().toISOString(),
    };

    this.records.unshift(record);

    if (this.records.length > this.maxRecords) {
      this.records.pop();
    }

    return record;
  }

  getSessionMetrics(sessionId: string, projectId = 'default'): AgentSessionMetrics | null {
    const sessionRecords = this.records.filter(
      (r) => r.sessionId === sessionId && r.projectId === projectId
    );

    if (sessionRecords.length === 0) {
      return null;
    }

    const totalToolCalls = sessionRecords.length;
    const successfulToolCalls = sessionRecords.filter((r) => r.status === 'success').length;
    const failedToolCalls = totalToolCalls - successfulToolCalls;
    const totalDurationMs = sessionRecords.reduce((sum, r) => sum + r.durationMs, 0);
    const avgDurationMs = totalDurationMs / totalToolCalls;
    const lastActiveAt = sessionRecords[0].timestamp;
    const agentId = sessionRecords.find((r) => Boolean(r.agentId))?.agentId;

    return {
      sessionId,
      agentId,
      totalToolCalls,
      successfulToolCalls,
      failedToolCalls,
      avgDurationMs,
      totalDurationMs,
      lastActiveAt,
    };
  }

  getSystemAgentStats(projectId = 'default'): AgentTelemetryStatsResponse {
    const projectRecords = this.records.filter((r) => r.projectId === projectId);
    const sessionsMap = new Map<string, ToolCallRecord[]>();
    const toolCounts = new Map<string, number>();

    let totalDurationMs = 0;
    let totalSuccessCount = 0;

    for (const record of projectRecords) {
      totalDurationMs += record.durationMs;
      if (record.status === 'success') {
        totalSuccessCount++;
      }

      toolCounts.set(record.toolName, (toolCounts.get(record.toolName) || 0) + 1);

      if (!sessionsMap.has(record.sessionId)) {
        sessionsMap.set(record.sessionId, []);
      }
      sessionsMap.get(record.sessionId)?.push(record);
    }

    const sessions: AgentSessionMetrics[] = [];
    for (const [sessionId, recs] of sessionsMap.entries()) {
      const totalToolCalls = recs.length;
      const successfulToolCalls = recs.filter((r) => r.status === 'success').length;
      const failedToolCalls = totalToolCalls - successfulToolCalls;
      const sumDuration = recs.reduce((sum, r) => sum + r.durationMs, 0);
      const agentId = recs.find((r) => Boolean(r.agentId))?.agentId;

      sessions.push({
        sessionId,
        agentId,
        totalToolCalls,
        successfulToolCalls,
        failedToolCalls,
        avgDurationMs: sumDuration / totalToolCalls,
        totalDurationMs: sumDuration,
        lastActiveAt: recs[0].timestamp,
      });
    }

    const topToolsUsed = Array.from(toolCounts.entries())
      .map(([toolName, count]) => ({ toolName, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const totalRecords = projectRecords.length;

    return {
      activeSessionsCount: sessionsMap.size,
      totalToolCallsRecorded: totalRecords,
      overallSuccessRate: totalRecords > 0 ? (totalSuccessCount / totalRecords) * 100 : 100,
      averageToolLatencyMs: totalRecords > 0 ? totalDurationMs / totalRecords : 0,
      topToolsUsed,
      sessions,
    };
  }

  clearRecords(): void {
    this.records = [];
  }
}
