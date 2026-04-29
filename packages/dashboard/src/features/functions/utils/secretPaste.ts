export function parseEnvAssignment(input: string): { key: string; value: string } | null {
  const text = input.replace(/\r\n/g, '\n').trim();
  if (!text.includes('=')) {
    return null;
  }

  // Minimum viable behavior: if multiple lines are pasted, use the first non-empty line.
  const firstLine = text
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!firstLine || !firstLine.includes('=')) {
    return null;
  }

  const eqIndex = firstLine.indexOf('=');
  const key = firstLine.slice(0, eqIndex).trim();
  let value = firstLine.slice(eqIndex + 1).trim();

  if (!key || !value) {
    return null;
  }

  // Strip outer matching quotes only.
  if (
    (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
    (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
  ) {
    value = value.slice(1, -1);
  }

  return { key, value };
}
