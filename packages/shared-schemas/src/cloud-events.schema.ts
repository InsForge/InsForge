import { z } from 'zod';

export const appRouteChangeEventSchema = z.object({
  type: z.literal('APP_ROUTE_CHANGE'),
  path: z.string(),
});

export const authSuccessEventSchema = z.object({
  type: z.literal('AUTH_SUCCESS'),
});

export const authErrorEventSchema = z.object({
  type: z.literal('AUTH_ERROR'),
  message: z.string(),
});

export const mcpConnectionStatusEventSchema = z.object({
  type: z.literal('MCP_CONNECTION_STATUS'),
  connected: z.boolean(),
  toolName: z.string(),
  timestamp: z.union([z.number(), z.string()]),
});

export const showOnboardingOverlayEventSchema = z.object({
  type: z.literal('SHOW_ONBOARDING_OVERLAY'),
});

export const showSettingsOverlayEventSchema = z.object({
  type: z.literal('SHOW_SETTINGS_OVERLAY'),
});

export const onboardingSuccessSchema = z.object({
  type: z.literal('ONBOARDING_SUCCESS'),
});

export const navigateToUsageSchema = z.object({
  type: z.literal('NAVIGATE_TO_USAGE'),
});

export const showContactModalEventSchema = z.object({
  type: z.literal('SHOW_CONTACT_MODAL'),
});

export const showConnectOverlayEventSchema = z.object({
  type: z.literal('SHOW_CONNECT_OVERLAY'),
});

export const showPlanModalEventSchema = z.object({
  type: z.literal('SHOW_PLAN_MODAL'),
});

export const authorizationCodeEventSchema = z.object({
  type: z.literal('AUTHORIZATION_CODE'),
  code: z.string(),
});

export const routeChangeEventSchema = z.object({
  type: z.literal('ROUTE_CHANGE'),
  path: z.string(),
});

// Standard cloud project metadata request/response contract.
export const requestProjectInfoEventSchema = z.object({
  type: z.literal('REQUEST_PROJECT_INFO'),
});

export const projectInfoEventSchema = z.object({
  type: z.literal('PROJECT_INFO'),
  name: z.string(),
  instanceType: z.string(),
  region: z.string(),
  latestVersion: z.string().optional(),
});

export const requestInstanceInfoEventSchema = z.object({
  type: z.literal('REQUEST_INSTANCE_INFO'),
});

export const instanceInfoEventSchema = z.object({
  type: z.literal('INSTANCE_INFO'),
  currentInstanceType: z.string(),
  planName: z.string(),
  computeCredits: z.number(),
  currentOrgComputeCost: z.number(),
  instanceTypes: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      cpu: z.string(),
      ram: z.string(),
      pricePerHour: z.number(),
      pricePerMonth: z.number(),
    })
  ),
  projects: z.array(
    z.object({
      name: z.string(),
      instanceType: z.string(),
      monthlyCost: z.number(),
      isCurrent: z.boolean(),
      status: z.string(),
    })
  ),
});

export const requestInstanceTypeChangeEventSchema = z.object({
  type: z.literal('REQUEST_INSTANCE_TYPE_CHANGE'),
  instanceType: z.string(),
});

export const instanceTypeChangeResultEventSchema = z.object({
  type: z.literal('INSTANCE_TYPE_CHANGE_RESULT'),
  success: z.boolean(),
  instanceType: z.string().optional(),
  error: z.string().optional(),
});

export const cloudEventSchema = z.discriminatedUnion('type', [
  appRouteChangeEventSchema,
  authSuccessEventSchema,
  authErrorEventSchema,
  mcpConnectionStatusEventSchema,
  showOnboardingOverlayEventSchema,
  showSettingsOverlayEventSchema,
  onboardingSuccessSchema,
  navigateToUsageSchema,
  showContactModalEventSchema,
  showConnectOverlayEventSchema,
  showPlanModalEventSchema,
  authorizationCodeEventSchema,
  routeChangeEventSchema,
  requestProjectInfoEventSchema,
  projectInfoEventSchema,
  requestInstanceInfoEventSchema,
  instanceInfoEventSchema,
  requestInstanceTypeChangeEventSchema,
  instanceTypeChangeResultEventSchema,
]);

export type AppRouteChangeEvent = z.infer<typeof appRouteChangeEventSchema>;
export type AuthSuccessEvent = z.infer<typeof authSuccessEventSchema>;
export type AuthErrorEvent = z.infer<typeof authErrorEventSchema>;
export type McpConnectionStatusEvent = z.infer<typeof mcpConnectionStatusEventSchema>;
export type CloudEvent = z.infer<typeof cloudEventSchema>;
export type ShowOnboardingOverlayEvent = z.infer<typeof showOnboardingOverlayEventSchema>;
export type ShowSettingsOverlayEvent = z.infer<typeof showSettingsOverlayEventSchema>;
export type ShowContactModalEvent = z.infer<typeof showContactModalEventSchema>;
export type ShowConnectOverlayEvent = z.infer<typeof showConnectOverlayEventSchema>;
export type ShowPlanModalEvent = z.infer<typeof showPlanModalEventSchema>;
export type AuthorizationCodeEvent = z.infer<typeof authorizationCodeEventSchema>;
export type RouteChangeEvent = z.infer<typeof routeChangeEventSchema>;
export type RequestProjectInfoEvent = z.infer<typeof requestProjectInfoEventSchema>;
export type ProjectInfoEvent = z.infer<typeof projectInfoEventSchema>;
export type RequestInstanceInfoEvent = z.infer<typeof requestInstanceInfoEventSchema>;
export type InstanceInfoEvent = z.infer<typeof instanceInfoEventSchema>;
export type RequestInstanceTypeChangeEvent = z.infer<typeof requestInstanceTypeChangeEventSchema>;
export type InstanceTypeChangeResultEvent = z.infer<typeof instanceTypeChangeResultEventSchema>;
