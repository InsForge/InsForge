import winston from 'winston';
import path from 'path';

const logsDir = process.env.LOGS_DIR || path.join(process.cwd(), 'logs');

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
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
