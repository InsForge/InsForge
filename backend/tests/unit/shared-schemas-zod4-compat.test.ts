import { describe, expect, it } from 'vitest';
import {
  computeMetadataSchema,
  createScheduleRequestSchema,
  createUserRequestSchema,
  oAuthInitRequestSchema,
  updateAuthConfigRequestSchema,
  updateCustomOAuthConfigRequestSchema,
  updateOAuthConfigRequestSchema,
  upsertSmtpConfigRequestSchema,
} from '@insforge/shared-schemas';

// Pins the behaviour of the shared schemas that had to be rewritten for zod 4
// (required_error, union errorMap, one-argument z.record, enum-keyed z.record,
// zod 3's "Required" message for missing auth fields),
// so it stays identical to what zod 3 produced.
describe('shared schemas ported to zod 4', () => {
  const codeChallenge = 'a'.repeat(43);

  it('keeps the "Redirect URI is required" message only for a missing redirect_uri', () => {
    const missing = oAuthInitRequestSchema.safeParse({ code_challenge: codeChallenge });
    expect(missing.success).toBe(false);
    expect(missing.error?.issues[0]).toMatchObject({
      path: ['redirect_uri'],
      message: 'Redirect URI is required',
    });

    const wrongType = oAuthInitRequestSchema.safeParse({
      redirect_uri: 123,
      code_challenge: codeChallenge,
    });
    expect(wrongType.success).toBe(false);
    expect(wrongType.error?.issues[0].message).not.toBe('Redirect URI is required');

    expect(
      oAuthInitRequestSchema.safeParse({ redirect_uri: 'not a url', code_challenge: codeChallenge })
        .success
    ).toBe(false);
  });

  it('keeps zod 3\'s "Required" for missing auth fields but not for wrong types', () => {
    const missing = createUserRequestSchema.safeParse({});
    expect(missing.success).toBe(false);
    expect(missing.error?.issues.map((i) => [i.path.join('.'), i.message])).toEqual([
      ['email', 'Required'],
      ['password', 'Required'],
    ]);

    const wrongType = createUserRequestSchema.safeParse({ email: 1, password: 2 });
    expect(wrongType.success).toBe(false);
    expect(wrongType.error?.issues.map((i) => i.message)).not.toContain('Required');
  });

  it('reports the SMTP port allow-list message for invalid and missing ports', () => {
    for (const body of [{ enabled: false, port: 26 }, { enabled: false }]) {
      const result = upsertSmtpConfigRequestSchema.safeParse(body);
      expect(result.success).toBe(false);
      expect(result.error?.issues).toContainEqual(
        expect.objectContaining({
          path: ['port'],
          message: 'Port must be one of: 25, 465, 587, 2525',
        })
      );
    }
    expect(upsertSmtpConfigRequestSchema.safeParse({ enabled: false, port: 587 }).success).toBe(
      true
    );
  });

  it('still validates record values after the explicit string-key rewrite', () => {
    const base = {
      name: 'nightly',
      cronSchedule: '*/5 * * * *',
      functionUrl: 'https://functions.example.com/run',
      httpMethod: 'POST' as const,
    };
    expect(createScheduleRequestSchema.safeParse({ ...base, headers: { a: 1 } }).success).toBe(
      false
    );
    expect(
      createScheduleRequestSchema.safeParse({
        ...base,
        headers: { Authorization: 'Bearer ${{secrets.TOKEN}}' },
        body: { nested: { values: [1, 2] } },
      }).success
    ).toBe(true);
  });

  it('accepts compute metadata that lists only the active providers', () => {
    const capabilities = {
      scaleToZero: false,
      regions: false,
      ingressModes: ['port'],
      sourceBuild: 'context-upload',
      deployTokenIssuance: false,
    };
    expect(
      computeMetadataSchema.safeParse({
        defaultProvider: 'docker',
        providers: { docker: capabilities },
      }).success
    ).toBe(true);
    expect(
      computeMetadataSchema.safeParse({
        defaultProvider: 'docker',
        providers: { aws: capabilities },
      }).success
    ).toBe(false);
  });

  it('does not inject defaults into partial update bodies', () => {
    expect(updateAuthConfigRequestSchema.parse({})).toEqual({});
    expect(updateOAuthConfigRequestSchema.parse({})).toEqual({});
    expect(updateCustomOAuthConfigRequestSchema.parse({})).toEqual({});
  });
});
