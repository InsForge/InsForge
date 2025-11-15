import type { Schedule as SharedSchedule } from '@insforge/shared-schemas';

// Reuse the Schedule type inferred from the shared Zod schema to keep
// frontend and backend shape definitions consistent.
export type Schedule = SharedSchedule;

export interface ScheduleRow extends Schedule {
  // DataGrid expects values to be converted to primitive values (string/number/boolean/null)
  // or complex cells like arrays of key/value maps for certain cell types.
  [key: string]:
    | string
    | number
    | boolean
    | null
    | undefined
    | Record<string, unknown>
    | Array<{ [key: string]: string }>;
}

export type HttpMethod = Schedule['httpMethod'];
