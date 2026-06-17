import type { CatalogPrice } from '#features/payments/types/catalog';

/** Medium date + short time, e.g. "Jan 15, 2025, 3:30 PM". Falls back to the
 *  raw value for an unparseable date and "-" for a null/empty input. */
export function formatDateTime(value: string | null): string {
  if (!value) {
    return '-';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

export function formatLastSynced(value: string | null): string {
  return value ? formatDateTime(value) : 'Never';
}

/** The currency's minor-unit exponent (e.g. 2 for USD, 0 for JPY). */
export function getCurrencyFractionDigits(currency: string): number {
  return (
    new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency.toUpperCase(),
      currencyDisplay: 'code',
    }).resolvedOptions().maximumFractionDigits ?? 2
  );
}

/** Format a minor-unit integer amount in its currency, e.g. 1999 USD -> "USD 19.99". */
export function formatCurrencyAmount(amount: number | null, currency: string | null): string {
  if (amount === null || !currency) {
    return '-';
  }

  const normalizedCurrency = currency.toUpperCase();
  const fractionDigits = getCurrencyFractionDigits(normalizedCurrency);

  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: normalizedCurrency,
    currencyDisplay: 'code',
  }).format(amount / 10 ** fractionDigits);
}

/** Format a catalog price's unit amount, returning "Custom" when it has none. */
export function formatPriceAmount(price: CatalogPrice): string {
  const rawAmount =
    price.unitAmount ?? (price.unitAmountDecimal ? Number(price.unitAmountDecimal) : null);

  if (rawAmount === null || Number.isNaN(rawAmount)) {
    return 'Custom';
  }

  const currency = price.currency.toUpperCase();
  const fractionDigits = getCurrencyFractionDigits(currency);

  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    currencyDisplay: 'code',
  }).format(rawAmount / 10 ** fractionDigits);
}
