import winston from 'winston';
import path from 'path';

const logsDir = process.env.LOGS_DIR || path.join(process.cwd(), 'logs');

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    // Security: Only include error stack traces outside of production.
    // Stacks expose internal file paths and module structure that aid attackers
    // if logs are ever surfaced to a shared dashboard or logging service.
    winston.format.errors({ stack: process.env.NODE_ENV !== 'production' }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({
      filename: path.join(logsDir, 'insforge.logs.jsonl'),
      format: winston.format.printf((info) => {
        const { timestamp, level, message, ...metadata } = info;
        return JSON.stringify({
          id: `${Date.now()}-${Math.random()}`,
          timestamp,
          message,
          level,
          metadata,
        });
      }),
    }),
  ],
});

export default logger;
