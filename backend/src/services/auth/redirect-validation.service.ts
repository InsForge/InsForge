import { AppError } from '@/api/middlewares/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import logger from '@/utils/logger.js';
import type { AuthConfigSchema } from '@insforge/shared-schemas';

type RedirectConfig = {
  signInRedirectTo?: AuthConfigSchema['signInRedirectTo'];
  redirectUrlWhitelist?: AuthConfigSchema['redirectUrlWhitelist'] | null;
};

type NormalizedRedirectConfig = {
  signInRedirectTo: string | null;
  redirectUrlWhitelist: string[];
};

export class RedirectValidationService {
  static normalizeUrl(url: string, sourceLabel: string): string {
    try {
      return new URL(url).toString();
    } catch {
      throw new AppError(`${sourceLabel} must be a valid absolute URL`, 400, ERROR_CODES.INVALID_INPUT);
    }
  }

  static normalizeWhitelist(urls?: string[] | null): string[] {
    const normalizedUrls: string[] = [];
    const seen = new Set<string>();

    for (const url of urls ?? []) {
      const normalizedUrl = this.normalizeUrl(url, 'Redirect URL whitelist entry');
      if (!seen.has(normalizedUrl)) {
        seen.add(normalizedUrl);
        normalizedUrls.push(normalizedUrl);
      }
    }

    return normalizedUrls;
  }

  static validateAuthConfigOrThrow(config: RedirectConfig): NormalizedRedirectConfig {
    const normalizedWhitelist = this.normalizeWhitelist(config.redirectUrlWhitelist);
    const normalizedSignInRedirect = config.signInRedirectTo
      ? this.normalizeUrl(config.signInRedirectTo, 'Redirect URL After Sign In')
      : null;

    if (
      normalizedWhitelist.length > 0 &&
      normalizedSignInRedirect &&
      !normalizedWhitelist.includes(normalizedSignInRedirect)
    ) {
      throw new AppError(
        'Redirect URL After Sign In must also be included in the redirect URL whitelist',
        400,
        ERROR_CODES.INVALID_INPUT
      );
    }

    return {
      signInRedirectTo: normalizedSignInRedirect,
      redirectUrlWhitelist: normalizedWhitelist,
    };
  }

  static getValidatedConfiguredRedirect(
    config: RedirectConfig,
    sourceLabel: string = 'Redirect URL After Sign In'
  ): string | undefined {
    if (!config.signInRedirectTo) {
      return undefined;
    }

    return this.validateRedirectOrThrow(config, config.signInRedirectTo, sourceLabel);
  }

  static resolveOptionalRedirect(
    config: RedirectConfig,
    requestedRedirect: string | null | undefined,
    sourceLabel: string
  ): string | undefined {
    const validatedRequestedRedirect = requestedRedirect
      ? this.validateRedirectOrThrow(config, requestedRedirect, sourceLabel)
      : undefined;

    if (config.signInRedirectTo) {
      return this.validateRedirectOrThrow(config, config.signInRedirectTo, sourceLabel);
    }

    if (!validatedRequestedRedirect) {
      return undefined;
    }

    return validatedRequestedRedirect;
  }

  static resolveRequiredRedirect(
    config: RedirectConfig,
    requestedRedirect: string | null | undefined,
    sourceLabel: string
  ): string {
    const redirectUrl = this.resolveOptionalRedirect(config, requestedRedirect, sourceLabel);
    if (!redirectUrl) {
      throw new AppError(`${sourceLabel} is required`, 400, ERROR_CODES.INVALID_INPUT);
    }

    return redirectUrl;
  }

  static validateRedirectOrThrow(
    config: RedirectConfig,
    redirectUrl: string,
    sourceLabel: string
  ): string {
    const normalizedRedirect = this.normalizeUrl(redirectUrl, sourceLabel);
    const normalizedWhitelist = this.normalizeWhitelist(config.redirectUrlWhitelist);

    if (normalizedWhitelist.length === 0) {
      logger.warn('Redirect URL whitelist is empty; allowing redirect target for development', {
        redirectUrl: normalizedRedirect,
        source: sourceLabel,
      });
      return normalizedRedirect;
    }

    if (normalizedWhitelist.includes(normalizedRedirect)) {
      return normalizedRedirect;
    }

    throw new AppError(
      `${sourceLabel} is not allowed. Add it to the redirect URL whitelist in Auth Settings to continue.`,
      400,
      ERROR_CODES.INVALID_INPUT
    );
  }
}
