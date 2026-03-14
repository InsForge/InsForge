import { useEffect, useState } from 'react';
import type { GetPublicAuthConfigResponse } from '@insforge/shared-schemas';
import { getBackendUrl } from './utils';

const normalizeRedirectUrl = (url: string, sourceLabel: string) => {
  try {
    return new URL(url).toString();
  } catch {
    throw new Error(`${sourceLabel} must be a valid absolute URL.`);
  }
};

const normalizeWhitelist = (whitelist?: string[]) => {
  const seen = new Set<string>();
  const normalizedUrls: string[] = [];

  for (const url of whitelist ?? []) {
    const normalizedUrl = normalizeRedirectUrl(url, 'Redirect URL whitelist entry');
    if (!seen.has(normalizedUrl)) {
      seen.add(normalizedUrl);
      normalizedUrls.push(normalizedUrl);
    }
  }

  return normalizedUrls;
};

const fetchPublicAuthConfig = async (): Promise<GetPublicAuthConfigResponse> => {
  const response = await fetch(`${getBackendUrl()}/api/auth/public-config`);
  if (!response.ok) {
    throw new Error('Failed to load authentication configuration.');
  }

  return response.json() as Promise<GetPublicAuthConfigResponse>;
};

export function useValidatedRedirectTarget(rawRedirect: string | null, sourceLabel: string) {
  const [validatedRedirect, setValidatedRedirect] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(Boolean(rawRedirect));

  useEffect(() => {
    let isCancelled = false;

    if (!rawRedirect) {
      setValidatedRedirect(null);
      setValidationError(null);
      setIsLoading(false);
      return undefined;
    }

    setIsLoading(true);

    void fetchPublicAuthConfig()
      .then((config) => {
        const normalizedRedirect = normalizeRedirectUrl(rawRedirect, sourceLabel);
        const whitelist = normalizeWhitelist(config.redirectUrlWhitelist);

        if (!isCancelled) {
          if (whitelist.length === 0 || whitelist.includes(normalizedRedirect)) {
            setValidatedRedirect(normalizedRedirect);
            setValidationError(null);
          } else {
            setValidatedRedirect(null);
            setValidationError(
              `${sourceLabel} is not allowed. Add it to the redirect URL whitelist in Auth Settings to continue.`
            );
          }
        }
      })
      .catch((error: unknown) => {
        if (!isCancelled) {
          setValidatedRedirect(null);
          setValidationError(
            error instanceof Error ? error.message : `Failed to validate ${sourceLabel}.`
          );
        }
      })
      .finally(() => {
        if (!isCancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [rawRedirect, sourceLabel]);

  return {
    validatedRedirect,
    validationError,
    isLoading,
  };
}
