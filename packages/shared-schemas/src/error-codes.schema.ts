import { z } from 'zod';

// Canonical error codes shared across backend, SDK, CLI, MCP, and tooling.
// Keep the public string values stable.

const authErrorCodes = [
  'AUTH_INVALID_EMAIL',
  'AUTH_WEAK_PASSWORD',
  'AUTH_INVALID_CREDENTIALS',
  'AUTH_INVALID_API_KEY',
  'AUTH_EMAIL_EXISTS',
  'AUTH_USER_NOT_FOUND',
  'AUTH_OAUTH_CONFIG_ALREADY_EXISTS',
  'AUTH_OAUTH_CONFIG_ERROR',
  'AUTH_OAUTH_CONFIG_NOT_FOUND',
  'AUTH_UNSUPPORTED_PROVIDER',
  'AUTH_TOKEN_EXPIRED',
  'AUTH_UNAUTHORIZED',
  'AUTH_NEED_VERIFICATION',
  'AUTH_SIGNUP_DISABLED',
] as const;

const databaseErrorCodes = [
  'DATABASE_INVALID_PARAMETER',
  'DATABASE_VALIDATION_ERROR',
  'DATABASE_CONSTRAINT_VIOLATION',
  'DATABASE_NOT_FOUND',
  'DATABASE_DUPLICATE',
  'DATABASE_MIGRATION_ALREADY_EXISTS',
  'DATABASE_PERMISSION_DENIED',
  'DATABASE_INTERNAL_ERROR',
  'DATABASE_FORBIDDEN',
] as const;

const storageErrorCodes = [
  'STORAGE_ALREADY_EXISTS',
  'STORAGE_INVALID_PARAMETER',
  'STORAGE_INVALID_FILE_TYPE',
  'STORAGE_INSUFFICIENT_QUOTA',
  'STORAGE_NOT_FOUND',
  'STORAGE_PERMISSION_DENIED',
  'S3_ACCESS_KEY_LIMIT_EXCEEDED',
  'S3_ACCESS_KEY_NOT_FOUND',
  'S3_PROTOCOL_UNAVAILABLE',
] as const;

const realtimeErrorCodes = [
  'REALTIME_CHANNEL_NOT_FOUND',
  'REALTIME_CONNECTION_FAILED',
  'REALTIME_INVALID_CHANNEL_REQUEST',
  'REALTIME_INVALID_CHANNEL_PATTERN',
  'REALTIME_INVALID_EVENT',
  'REALTIME_NOT_SUBSCRIBED',
  'REALTIME_UNAUTHORIZED',
] as const;

const aiErrorCodes = ['AI_INVALID_API_KEY', 'AI_INVALID_MODEL', 'AI_UPSTREAM_UNAVAILABLE'] as const;

const analyticsErrorCodes = ['ANALYTICS_NOT_CONNECTED', 'ANALYTICS_UNAVAILABLE'] as const;

const logsErrorCodes = ['LOGS_AWS_NOT_CONFIGURED', 'LOG_NOT_FOUND'] as const;

const computeErrorCodes = [
  'COMPUTE_CLOUD_UNAVAILABLE',
  'COMPUTE_NOT_CONFIGURED',
  'COMPUTE_PROVIDER_ERROR',
  'COMPUTE_SERVICE_NOT_FOUND',
  'COMPUTE_SERVICE_NOT_CONFIGURED',
  'COMPUTE_SERVICE_DEPLOY_FAILED',
  'COMPUTE_SERVICE_ALREADY_EXISTS',
  'COMPUTE_SERVICE_START_FAILED',
  'COMPUTE_SERVICE_STOP_FAILED',
  'COMPUTE_SERVICE_DELETE_FAILED',
  'COMPUTE_REGION_CHANGE_NOT_SUPPORTED',
  'COMPUTE_QUOTA_EXCEEDED',
] as const;

const billingErrorCodes = ['BILLING_INSUFFICIENT_BALANCE'] as const;

const emailErrorCodes = [
  'EMAIL_SMTP_CONNECTION_FAILED',
  'EMAIL_SMTP_SEND_FAILED',
  'EMAIL_TEMPLATE_NOT_FOUND',
] as const;

const deploymentErrorCodes = [
  'DEPLOYMENT_ALREADY_EXISTS',
  'DEPLOYMENT_INVALID_FILE',
  'DEPLOYMENT_NOT_FOUND',
  'DEPLOYMENT_UPLOAD_CANCELED',
  'DOMAIN_ALREADY_EXISTS',
  'DOMAIN_INVALID',
  'DOMAIN_NOT_FOUND',
  'ENVIRONMENT_VARIABLE_NOT_FOUND',
] as const;

const docsErrorCodes = ['DOCS_NOT_FOUND'] as const;

const functionErrorCodes = [
  'FUNCTION_ALREADY_EXISTS',
  'FUNCTION_DEPLOYMENT_NOT_FOUND',
  'FUNCTION_NOT_FOUND',
] as const;

const scheduleErrorCodes = ['SCHEDULE_INVALID_CRON', 'SCHEDULE_NOT_FOUND'] as const;

const paymentErrorCodes = [
  'PAYMENT_CHECKOUT_ALREADY_EXISTS',
  'PAYMENT_CONFIG_INVALID',
  'PAYMENT_CONFIG_NOT_FOUND',
  'PAYMENT_NOT_FOUND',
  'PAYMENT_METHOD_DECLINED',
  'PAYMENT_PRICE_NOT_FOUND',
  'PAYMENT_PRODUCT_NOT_FOUND',
] as const;

const secretErrorCodes = ['SECRET_ALREADY_EXISTS', 'SECRET_NOT_FOUND'] as const;

const generalErrorCodes = [
  'MISSING_FIELD',
  'ALREADY_EXISTS',
  'INVALID_INPUT',
  'NOT_FOUND',
  'UNKNOWN_ERROR',
  'INTERNAL_ERROR',
  'TOO_MANY_REQUESTS',
  'FORBIDDEN',
  'RATE_LIMITED',
  'NOT_IMPLEMENTED',
  'UPSTREAM_FAILURE',
] as const;

const errorCodeValues = [
  ...authErrorCodes,
  ...databaseErrorCodes,
  ...storageErrorCodes,
  ...realtimeErrorCodes,
  ...aiErrorCodes,
  ...analyticsErrorCodes,
  ...logsErrorCodes,
  ...computeErrorCodes,
  ...billingErrorCodes,
  ...emailErrorCodes,
  ...deploymentErrorCodes,
  ...docsErrorCodes,
  ...functionErrorCodes,
  ...scheduleErrorCodes,
  ...paymentErrorCodes,
  ...secretErrorCodes,
  ...generalErrorCodes,
] as const;

export const errorCodeSchema = z.enum(errorCodeValues);

export type ErrorCode = z.infer<typeof errorCodeSchema>;

export const ERROR_CODES = errorCodeSchema.enum;
