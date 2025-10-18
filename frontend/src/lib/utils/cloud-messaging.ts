import { cloudEventSchema, CloudEvent } from '@insforge/shared-schemas';

export function postMessageToParent(
  evt: CloudEvent,
  targetOrigin: string = getDefaultTargetOrigin()
) {
  if (typeof window === 'undefined') {
    return;
  }
  if (window.parent !== window) {
    window.parent.postMessage(evt, targetOrigin);
  }
}

export function parseCloudEvent(value: unknown): { ok: true; data: CloudEvent } | { ok: false } {
  const parsed = cloudEventSchema.safeParse(value);
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false };
}

function getDefaultTargetOrigin(): string {
  return import.meta?.env?.VITE_CLOUD_ORIGIN ?? '*';
}
