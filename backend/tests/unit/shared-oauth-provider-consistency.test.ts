/**
 * #2051 hardened the shared OAuth callback but updated seven of the eight providers
 * that post to it, leaving X on the pre-hardening init query (#2053). These assert the
 * sets instead of X specifically, so a provider added to the shared callback without
 * the bound init query, or left off the shared-key list, fails here.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { sharedKeyOAuthProviders, isSharedKeyOAuthProvider } from '@insforge/shared-schemas';

const providerDir = resolve(__dirname, '../../src/providers/oauth');

const providerSources = readdirSync(providerDir)
  .filter((file) => file.endsWith('.provider.ts'))
  .filter((file) => !['base.provider.ts', 'custom.provider.ts'].includes(file))
  .map((file) => ({
    provider: file.replace('.provider.ts', ''),
    source: readFileSync(resolve(providerDir, file), 'utf-8'),
  }));

const providersMatching = (predicate: (source: string) => boolean): string[] =>
  providerSources
    .filter(({ source }) => predicate(source))
    .map(({ provider }) => provider)
    .sort();

const expectedSharedProviders = [...sharedKeyOAuthProviders].sort();

describe('shared OAuth provider consistency', () => {
  it('reads every first-party provider', () => {
    expect(providerSources.length).toBeGreaterThanOrEqual(expectedSharedProviders.length);
  });

  it('limits the shared callback to providers on the shared-key list', () => {
    expect(providersMatching((source) => source.includes('shared/callback'))).toEqual(
      expectedSharedProviders
    );
  });

  it('sends the project-bound init query from every shared-key provider', () => {
    expect(providersMatching((source) => source.includes('buildSharedOAuthInitQuery'))).toEqual(
      expectedSharedProviders
    );
  });

  it('implements handleSharedCallback only on shared-key providers', () => {
    expect(providersMatching((source) => source.includes('handleSharedCallback('))).toEqual(
      expectedSharedProviders
    );
  });

  it('keeps X off the shared-key list', () => {
    expect(isSharedKeyOAuthProvider('x')).toBe(false);
    expect(isSharedKeyOAuthProvider('google')).toBe(true);
  });

  it('routes shared callbacks in AuthService for exactly the shared-key providers', () => {
    const authServiceSource = readFileSync(
      resolve(__dirname, '../../src/services/auth/auth.service.ts'),
      'utf-8'
    );
    const sharedCallbackSwitch = authServiceSource.slice(
      authServiceSource.indexOf('async handleSharedCallback(')
    );
    const routed = [
      ...sharedCallbackSwitch
        .slice(0, sharedCallbackSwitch.indexOf('default:'))
        .matchAll(/case '([a-z]+)':/g),
    ]
      .map((match) => match[1])
      .sort();

    expect(routed).toEqual(expectedSharedProviders);
  });
});
