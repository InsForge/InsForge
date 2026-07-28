import { beforeEach, describe, expect, it } from 'vitest';
import { AgentTelemetryService } from '../../src/services/telemetry/agent-telemetry.service.js';

describe('AgentTelemetryService', () => {
  let service: AgentTelemetryService;

  beforeEach(() => {
    service = AgentTelemetryService.getInstance();
    service.clearRecords();
  });

  it('records agent tool calls accurately', () => {
    const record = service.recordToolCall({
      sessionId: 'session-123',
      agentId: 'agent-alpha',
      toolName: 'execute_sql',
      durationMs: 150,
      status: 'success',
    });

    expect(record.sessionId).toBe('session-123');
    expect(record.status).toBe('success');

    const session = service.getSessionMetrics('session-123');
    expect(session).not.toBeNull();
    expect(session?.totalToolCalls).toBe(1);
    expect(session?.successfulToolCalls).toBe(1);
    expect(session?.avgDurationMs).toBe(150);
  });

  it('aggregates system-wide telemetry statistics across multiple sessions', () => {
    service.recordToolCall({
      sessionId: 'session-1',
      toolName: 'create_table',
      durationMs: 200,
      status: 'success',
    });

    service.recordToolCall({
      sessionId: 'session-1',
      toolName: 'deploy_function',
      durationMs: 400,
      status: 'error',
      errorMessage: 'Build failed',
    });

    service.recordToolCall({
      sessionId: 'session-2',
      toolName: 'create_table',
      durationMs: 100,
      status: 'success',
    });

    const stats = service.getSystemAgentStats();

    expect(stats.activeSessionsCount).toBe(2);
    expect(stats.totalToolCallsRecorded).toBe(3);
    expect(stats.overallSuccessRate).toBeCloseTo(66.66, 1);
    expect(stats.averageToolLatencyMs).toBe(233.33333333333334);
    expect(stats.topToolsUsed[0].toolName).toBe('create_table');
    expect(stats.topToolsUsed[0].count).toBe(2);
  });

  it('returns null for unknown session metrics', () => {
    const metrics = service.getSessionMetrics('non-existent');
    expect(metrics).toBeNull();
  });
});
