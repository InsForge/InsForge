export interface Schedule {
  id: string;
  name: string;
  cronSchedule: string;
  functionUrl: string;
  httpMethod: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  cronJobId: string | null;
  createdAt: string;
  updatedAt: string;
  lastExecutedAt: string | null;
  isActive: boolean;
  nextRun: string | null;
}

export interface ScheduleRow extends Schedule {
  // DataGrid expects values to be converted to primitive values (string/number/boolean/null)
  // or complex cells like arrays of key/value maps for certain cell types. Narrow the index
  // signature to those acceptable shapes instead of `any`.
  [key: string]: string | number | boolean | null | Array<{ [key: string]: string }>;
}

export type HttpMethod = Schedule['httpMethod'];
