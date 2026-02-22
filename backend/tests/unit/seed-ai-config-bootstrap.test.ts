import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

function getSeedDefaultAIConfigsBody(seedSource: string): string {
  const match = seedSource.match(
    /async function seedDefaultAIConfigs\(\): Promise<void> \{([\s\S]*?)\n\}/
  );
  expect(match, 'seedDefaultAIConfigs function not found in seed.ts').not.toBeNull();
  return match![1];
}

describe('seedDefaultAIConfigs regression', () => {
  it('uses hasAnyConfig() instead of findAll() so inactive configs are also treated as existing', () => {
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    const seedPath = path.resolve(currentDir, '../../src/utils/seed.ts');

    expect(fs.existsSync(seedPath), `seed.ts not found at: ${seedPath}`).toBe(true);

    const seedSource = fs.readFileSync(seedPath, 'utf8');
    const body = getSeedDefaultAIConfigsBody(seedSource);

    expect(body).toMatch(/hasAnyConfig\s*\(\s*\)/);
    expect(body).not.toMatch(/findAll\s*\(\s*\)/);
  });
});
