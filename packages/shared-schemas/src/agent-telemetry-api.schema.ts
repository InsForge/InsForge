import { z } from 'zod';

export const recordAgentToolCallSchema = z.object({
  sessionId: z.string().min(1, 'Session ID is required'),
  agentId: z.string().optional(),
  toolName: z.string().min(1, 'Tool name is required'),
  durationMs: z.number().min(0, 'Duration must be non-negative'),
  status: z.enum(['success', 'error']),
  errorMessage: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const agentSessionMetricsSchema = z.object({
  sessionId: z.string(),
  agentId: z.string().optional(),
  totalToolCalls: z.number(),
  successfulToolCalls: z.number(),
  failedToolCalls: z.number(),
  avgDurationMs: z.number(),
  totalDurationMs: z.number(),
  lastActiveAt: z.string(),
});

export const agentTelemetryStatsResponseSchema = z.object({
  activeSessionsCount: z.number(),
  totalToolCallsRecorded: z.number(),
  overallSuccessRate: z.number(),
  averageToolLatencyMs: z.number(),
  topToolsUsed: z.array(
    z.object({
      toolName: z.string(),
      count: z.number(),
    })
  ),
  sessions: z.array(agentSessionMetricsSchema),
});

export type RecordAgentToolCallRequest = z.infer<typeof recordAgentToolCallSchema>;
export type AgentSessionMetrics = z.infer<typeof agentSessionMetricsSchema>;
export type AgentTelemetryStatsResponse = z.infer<typeof agentTelemetryStatsResponseSchema>;
