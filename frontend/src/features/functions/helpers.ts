/**
 * Normalize headers to Record<string, string> format.
 * Handles JSON strings, objects, or null values.
 */
export const normalizeHeaders = (h: unknown): Record<string, string> | undefined => {
  if (h === null) {
    return undefined;
  }
  if (typeof h === 'string') {
    try {
      const parsed = JSON.parse(h);
      if (parsed && typeof parsed === 'object') {
        return Object.fromEntries(Object.entries(parsed).map(([k, v]) => [k, String(v)]));
      }
      return undefined;
    } catch {
      return undefined;
    }
  }
  if (typeof h === 'object') {
    return Object.fromEntries(
      Object.entries(h as Record<string, unknown>).map(([k, v]) => [k, String(v)])
    );
  }
  return undefined;
};
