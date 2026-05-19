import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

describe('FunctionService cloud secret behavior', () => {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const functionServicePath = path.resolve(currentDir, '../../src/services/functions/function.service.ts');
  const functionServiceSource = fs.readFileSync(functionServicePath, 'utf8');

  it('only rewrites INSFORGE_INTERNAL_URL in cloud environments', () => {
    expect(functionServiceSource).toContain('isCloudEnvironment() && baseUrlValue');
    expect(functionServiceSource).toContain("secretMap['INSFORGE_INTERNAL_URL'] = baseUrlValue");
  });
});
