import { cloudEventSchema, CloudEvent } from '@insforge/shared-schemas';

export function postMessageToParent(evt: CloudEvent, targetOrigin: string = '*') {
  if (typeof window === 'undefined') {
    return;
  }
  if (window.parent !== window) {
    window.parent.postMessage(evt, targetOrigin);
  }
}

/**
 * Parses and validates an unknown value as a CloudEvent.
 * @param value - The value to validate
 * @returns A discriminated union: { ok: true; data: CloudEvent } on success, { ok: false } on failure
 */
export function parseCloudEvent(value: unknown): { ok: true; data: CloudEvent } | { ok: false } {
  const parsed = cloudEventSchema.safeParse(value);
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false };
}
