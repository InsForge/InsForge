import { describe, expect, test } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('Storage routes', () => {
  const storageRoutesSource = readFileSync(
    resolve(__dirname, '../../src/api/routes/storage/index.routes.ts'),
    'utf-8'
  );

  test('allows public bucket download strategy requests through conditional auth', () => {
    expect(storageRoutesSource).toContain(
      "req.method === 'POST' && req.originalUrl.split('?')[0].endsWith('/download-strategy')"
    );
  });

  test('download strategy route captures nested object keys', () => {
    expect(storageRoutesSource).toMatch(
      /router\.post\(\s*'\/buckets\/:bucketName\/objects\/\*\/download-strategy'\s*,\s*conditionalAuth\s*,/
    );
    expect(storageRoutesSource).toContain(
      'const objectKey = req.params[0]; // Everything between objects and download-strategy'
    );
  });
});
