import winston from 'winston';
import fs from 'fs';
import path from 'path';
import { appConfig } from '@/infra/config/app.config.js';
import { isCloudEnvironment } from '@/utils/environment.js';

const logsDir = appConfig.server.logsDir;

const transports: winston.transport[] = [new winston.transports.Console()];

export const VOLUME_OWNERSHIP_CHOWN =
  'docker run --rm -v <stack>_insforge-logs:/a -v <stack>_storage-data:/b alpine chown -R 1000:1000 /a /b';

// Error instances stringify to {} — flatten them so metadata like
// `logger.error('...', { error })` survives the trip to disk. Stacks follow
// the same production gate as winston.format.errors below.
const flattenErrors = (_key: string, value: unknown) =>
  value instanceof Error
    ? {
        message: value.message,
        ...(process.env.NODE_ENV !== 'production' ? { stack: value.stack } : {}),
      }
    : value;

export function createSelfHostFileTransport(options: {
  logsDir: string;
  vitest: boolean;
  exit: (code: number) => void;
}): winston.transports.FileTransportInstance | undefined {
  const { logsDir: dir, vitest, exit } = options;

  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.accessSync(dir, fs.constants.W_OK);
  } catch {
    process.stderr.write(`${VOLUME_OWNERSHIP_CHOWN}\n`);
    if (!vitest) {
      exit(1);
    }
    return undefined;
  }

  return new winston.transports.File({
    filename: path.join(dir, 'insforge.logs.jsonl'),
    // Rotate so the file cannot grow unbounded; LocalFileProvider only
    // reads the base file, which `tailable` keeps as the newest one.
    maxsize: 20 * 1024 * 1024,
    maxFiles: 2,
    tailable: true,
    format: winston.format.printf((info) => {
      const { timestamp, level, message, ...metadata } = info;
      return JSON.stringify(
        {
          id: `${Date.now()}-${Math.random()}`,
          timestamp,
          message,
          level,
          metadata,
        },
        flattenErrors
      );
    }),
  });
}

// The JSONL file feeds the self-hosted dashboard logs (LocalFileProvider).
// Cloud deployments ship stdout to CloudWatch via the awslogs driver and read
// logs back through CloudWatchProvider, so writing the file there would only
// grow the container filesystem with data nothing reads.
if (!isCloudEnvironment()) {
  const fileTransport = createSelfHostFileTransport({
    logsDir,
    vitest: Boolean(process.env.VITEST),
    exit: (c) => {
      process.exit(c);
    },
  });
  if (fileTransport) {
    transports.push(fileTransport);
  }
}

export const logger = winston.createLogger({
  level: appConfig.app.logLevel,
  format: winston.format.combine(
    winston.format.timestamp(),
    // Security: Only include error stack traces outside of production.
    // Stacks expose internal file paths and module structure that aid attackers
    // if logs are ever surfaced to a shared dashboard or logging service.
    winston.format.errors({ stack: process.env.NODE_ENV !== 'production' }),
    winston.format.json()
  ),
  transports,
});

export default logger;
