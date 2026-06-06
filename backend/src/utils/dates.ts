export function toISOString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

export function toISOStringOrNull(value: Date | string | null): string | null {
  if (!value) {
    return null;
  }

  return toISOString(value);
}
