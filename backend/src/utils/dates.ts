export function toISOString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

export function toISOStringOrNull(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  return toISOString(value);
}
