import { beforeEach, describe, expect, it } from 'vitest';
import { AgentTelemetryService } from '../../src/services/telemetry/agent-telemetry.service.js';

describe('AgentTelemetryService', () => {
  let service: AgentTelemetryService;

  beforeEach(() => {
    service = AgentTelemetryService.getInstance();
    service.clearRecords();
  });

  it('records agent tool calls accurately for a specific project scope', () => {
    const record = service.recordToolCall(
      {
        sessionId: 'session-123',
        agentId: 'agent-alpha',
        toolName: 'execute_sql',
        durationMs: 150,
        status: 'success',
      },
      'proj-alpha'
    );

    expect(record.sessionId).toBe('session-123');
    expect(record.status).toBe('success');

    const session = service.getSessionMetrics('session-123', 'proj-alpha');
    expect(session).not.toBeNull();
    expect(session?.totalToolCalls).toBe(1);
    expect(session?.successfulToolCalls).toBe(1);
    expect(session?.avgDurationMs).toBe(150);
  });

  it('isolates session telemetry between different project scopes', () => {
    service.recordToolCall(
      {
        sessionId: 'shared-session-id',
        toolName: 'create_table',
        durationMs: 100,
        status: 'success',
      },
      'proj-1'
    );

    service.recordToolCall(
      {
        sessionId: 'shared-session-id',
        toolName: 'deploy_function',
        durationMs: 300,
        status: 'error',
      },
      'proj-2'
    );

    const proj1Session = service.getSessionMetrics('shared-session-id', 'proj-1');
    const proj2Session = service.getSessionMetrics('shared-session-id', 'proj-2');

    expect(proj1Session?.totalToolCalls).toBe(1);
    expect(proj1Session?.successfulToolCalls).toBe(1);

    expect(proj2Session?.totalToolCalls).toBe(1);
    expect(proj2Session?.failedToolCalls).toBe(1);

    const proj1Stats = service.getSystemAgentStats('proj-1');
    const proj2Stats = service.getSystemAgentStats('proj-2');

    expect(proj1Stats.totalToolCallsRecorded).toBe(1);
    expect(proj2Stats.totalToolCallsRecorded).toBe(1);
  });

  it('returns null for unknown session metrics', () => {
    const metrics = service.getSessionMetrics('non-existent', 'proj-1');
    expect(metrics).toBeNull();
  });
});
