export type OAuthAdditionalParams = Record<string, string>;

export function appendAdditionalOAuthParams(
  url: URL,
  additionalParams?: OAuthAdditionalParams
): void {
  if (!additionalParams) {
    return;
  }

  Object.entries(additionalParams).forEach(([key, value]) => {
    if (!url.searchParams.has(key)) {
      url.searchParams.set(key, value);
    }
  });
}

export function appendAdditionalOAuthParamsToUrlString(
  urlString: string,
  additionalParams?: OAuthAdditionalParams
): string {
  if (!urlString || !additionalParams) {
    return urlString;
  }

  const url = new URL(urlString);
  appendAdditionalOAuthParams(url, additionalParams);
  return url.toString();
}
