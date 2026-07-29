import { CronExpressionParser } from 'cron-parser';
import { ERROR_CODES } from '@insforge/shared-schemas';
import { AppError } from '@/utils/errors.js';

// Cron expressions are evaluated in UTC so the cadence is stable regardless
// of the host timezone.
const CRON_TZ = 'UTC';

export function assertValidBackupCron(cronSchedule: string): void {
  // pg_cron-style sub-minute intervals ("30 seconds") and 6-field expressions
  // are rejected: backups are heavyweight and scheduled at minute granularity.
  const fields = cronSchedule.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new AppError(
      'cronSchedule must be a standard 5-field cron expression (minute, hour, day of month, month, day of week).',
      400,
      ERROR_CODES.INVALID_INPUT
    );
  }

  // Backups may run at most once per hour. Cron fires at minute granularity,
  // so two fires land inside the same hour exactly when the minute field
  // matches more than one minute — a single literal minute value is both
  // necessary and sufficient for a >= 1 hour gap.
  if (!/^\d+$/.test(fields[0])) {
    throw new AppError(
      'Scheduled backups can run at most once per hour: the minute field must be a single value (e.g. "30 2 * * *").',
      400,
      ERROR_CODES.INVALID_INPUT
    );
  }

  try {
    CronExpressionParser.parse(cronSchedule, { tz: CRON_TZ });
  } catch {
    throw new AppError(
      'cronSchedule is not a valid cron expression.',
      400,
      ERROR_CODES.INVALID_INPUT
    );
  }
}

export function computeNextBackupAt(cronSchedule: string, now: Date = new Date()): string | null {
  try {
    return CronExpressionParser.parse(cronSchedule, { currentDate: now, tz: CRON_TZ })
      .next()
      .toISOString();
  } catch {
    return null;
  }
}

/**
 * A scheduled backup is due when the most recent cron fire time is newer than
 * both the last scheduled attempt and the schedule anchor. The anchor moves
 * only when scheduling itself is (re)configured (enabled or cron changed), so
 * the cadence starts counting from that moment — without it, enabling a
 * daily-midnight schedule at 3pm would fire immediately for the fire time
 * that predates enablement. Catch-up after downtime still works: a fire
 * missed while the server was off stays newer than the last attempt, so the
 * next evaluation runs it.
 */
export function isScheduledBackupDue(args: {
  cronSchedule: string;
  now: Date;
  lastAttemptAt: Date | null;
  scheduleAnchorAt: Date | null;
}): boolean {
  const { cronSchedule, now, lastAttemptAt, scheduleAnchorAt } = args;

  let lastFire: Date;
  try {
    lastFire = CronExpressionParser.parse(cronSchedule, { currentDate: now, tz: CRON_TZ })
      .prev()
      .toDate();
  } catch {
    return false;
  }

  const floorMs = Math.max(lastAttemptAt?.getTime() ?? 0, scheduleAnchorAt?.getTime() ?? 0);
  return lastFire.getTime() > floorMs;
}
