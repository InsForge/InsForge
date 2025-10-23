import crypto from 'crypto';

/**
 * Generate a UUID v4
 * @returns A UUID v4 string
 */
export function generateUUID(): string {
  return crypto.randomUUID();
}

/**
 * Generate a random numeric string of specified length
 * @param length - The length of the numeric string to generate
 * @returns A random string containing only digits (0-9)
 */
export function generateNumericCode(length: number): string {
  if (length <= 0) {
    throw new Error('Length must be greater than 0');
  }

  let code = '';
  for (let i = 0; i < length; i++) {
    code += crypto.randomInt(0, 10).toString();
  }

  return code;
}
