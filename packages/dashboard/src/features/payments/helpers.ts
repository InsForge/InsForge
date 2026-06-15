import type { PaymentEnvironment } from '@insforge/shared-schemas';

export const ENVIRONMENTS: PaymentEnvironment[] = ['test', 'live'];

export function createEmptyEnvironmentValues(): Record<PaymentEnvironment, string> {
  return { test: '', live: '' };
}

/**
 * Re-applies freshly saved values to the editable inputs without clobbering
 * edits the user has already started. A field is hydrated only when it's empty
 * or still equal to the previously saved value (i.e. untouched).
 */
export function hydrateEnvironmentValues(
  current: Record<PaymentEnvironment, string>,
  previousSaved: Record<PaymentEnvironment, string>,
  nextSaved: Record<PaymentEnvironment, string>
): Record<PaymentEnvironment, string> {
  let changed = false;
  const next = { ...current };

  for (const environment of ENVIRONMENTS) {
    const canHydrate =
      current[environment] === '' || current[environment] === previousSaved[environment];
    if (canHydrate && current[environment] !== nextSaved[environment]) {
      next[environment] = nextSaved[environment];
      changed = true;
    }
  }

  return changed ? next : current;
}
