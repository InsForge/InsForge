import { describe, expect, it } from 'vitest';
import { normalizeEnvVarDrafts, parseDotEnvInput } from '#features/deployments/helpers';

describe('parseDotEnvInput', () => {
  it('parses dotenv lines with exports, quotes, and inline comments', () => {
    const result = parseDotEnvInput(`
      # ignored
      export API_KEY="secret value" # comment
      EMPTY=
      LOG_LEVEL=debug # comment
      INVALID_LINE
    `);

    expect(result.invalidLineNumbers).toEqual([6]);
    expect(result.drafts).toMatchObject([
      { key: 'API_KEY', value: 'secret value' },
      { key: 'EMPTY', value: '' },
      { key: 'LOG_LEVEL', value: 'debug' },
    ]);
  });
});

describe('normalizeEnvVarDrafts', () => {
  it('trims keys and drops fully empty drafts', () => {
    expect(
      normalizeEnvVarDrafts([
        { id: '1', key: ' API_KEY ', value: 'secret' },
        { id: '2', key: '   ', value: '' },
      ])
    ).toEqual([{ key: 'API_KEY', value: 'secret' }]);
  });
});
