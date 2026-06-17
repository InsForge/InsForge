import { useCallback, useRef, useState } from 'react';
import type { PaymentEnvironment } from '@insforge/shared-schemas';
import { createEmptyEnvironmentValues, hydrateEnvironmentValues } from '#features/payments/helpers';

export interface EnvironmentValueInputs {
  /** Current editable value per environment. */
  values: Record<PaymentEnvironment, string>;
  setValue: (environment: PaymentEnvironment, value: string) => void;
  /**
   * Pull in the latest saved values on dialog open, preserving any untouched
   * edits. Tracks the previously seen saved values internally.
   */
  hydrateFromSaved: (nextSaved: Record<PaymentEnvironment, string>) => void;
  clear: (environment: PaymentEnvironment) => void;
  reset: () => void;
}

/**
 * Manages one set of per-environment text inputs (test + live) backing a
 * provider key field. Stripe uses a single instance for its secret key;
 * Razorpay uses two (key id + key secret). Encapsulates the hydrate-on-open
 * bookkeeping that both providers previously duplicated.
 */
export function useEnvironmentValueInputs(): EnvironmentValueInputs {
  const [values, setValues] = useState<Record<PaymentEnvironment, string>>(
    createEmptyEnvironmentValues
  );
  const previousSaved = useRef<Record<PaymentEnvironment, string>>(createEmptyEnvironmentValues());

  const setValue = useCallback((environment: PaymentEnvironment, value: string) => {
    setValues((current) => ({ ...current, [environment]: value }));
  }, []);

  const hydrateFromSaved = useCallback((nextSaved: Record<PaymentEnvironment, string>) => {
    setValues((current) => hydrateEnvironmentValues(current, previousSaved.current, nextSaved));
    previousSaved.current = nextSaved;
  }, []);

  const clear = useCallback((environment: PaymentEnvironment) => {
    setValues((current) => ({ ...current, [environment]: '' }));
  }, []);

  const reset = useCallback(() => {
    setValues(createEmptyEnvironmentValues());
    previousSaved.current = createEmptyEnvironmentValues();
  }, []);

  return { values, setValue, hydrateFromSaved, clear, reset };
}
