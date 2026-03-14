import { describe, expect, it } from 'vitest';
import { RedirectValidationService } from '../../src/services/auth/redirect-validation.service';

describe('RedirectValidationService', () => {
  it('normalizes and deduplicates whitelist entries', () => {
    const config = RedirectValidationService.validateAuthConfigOrThrow({
      signInRedirectTo: 'https://app.example.com',
      redirectUrlWhitelist: ['https://app.example.com', 'https://app.example.com/'],
    });

    expect(config.signInRedirectTo).toBe('https://app.example.com/');
    expect(config.redirectUrlWhitelist).toEqual(['https://app.example.com/']);
  });

  it('requires signInRedirectTo to be included in the whitelist when configured', () => {
    expect(() =>
      RedirectValidationService.validateAuthConfigOrThrow({
        signInRedirectTo: 'https://app.example.com/dashboard',
        redirectUrlWhitelist: ['https://app.example.com/callback'],
      })
    ).toThrow('Redirect URL After Sign In must also be included');
  });

  it('allows redirects when the whitelist is empty', () => {
    expect(
      RedirectValidationService.resolveRequiredRedirect(
        {
          signInRedirectTo: null,
          redirectUrlWhitelist: [],
        },
        'https://app.example.com/callback',
        'OAuth redirect URI'
      )
    ).toBe('https://app.example.com/callback');
  });

  it('rejects redirects that are not in the whitelist', () => {
    expect(() =>
      RedirectValidationService.validateRedirectOrThrow(
        {
          signInRedirectTo: null,
          redirectUrlWhitelist: ['https://app.example.com/callback'],
        },
        'https://evil.example.com/callback',
        'OAuth redirect URI'
      )
    ).toThrow('OAuth redirect URI is not allowed');
  });

  it('prefers the configured sign-in redirect over the requested redirect', () => {
    expect(
      RedirectValidationService.resolveRequiredRedirect(
        {
          signInRedirectTo: 'https://app.example.com/dashboard',
          redirectUrlWhitelist: [
            'https://app.example.com/dashboard',
            'https://app.example.com/callback',
          ],
        },
        'https://app.example.com/callback',
        'OAuth redirect URI'
      )
    ).toBe('https://app.example.com/dashboard');
  });

  it('rejects an invalid requested redirect even when a configured sign-in redirect exists', () => {
    expect(() =>
      RedirectValidationService.resolveRequiredRedirect(
        {
          signInRedirectTo: 'https://app.example.com/dashboard',
          redirectUrlWhitelist: ['https://app.example.com/dashboard'],
        },
        'https://evil.example.com/callback',
        'OAuth redirect URI'
      )
    ).toThrow('OAuth redirect URI is not allowed');
  });
});
