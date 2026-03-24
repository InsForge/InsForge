type RedirectSession = {
  accessToken: string;
  csrfToken?: string | null;
  user: {
    id: string;
    email: string;
    profile?: {
      name?: string | null;
    } | null;
  };
};

export function buildSessionRedirectUrl(
  redirectUrl: string,
  session: RedirectSession,
  origin = window.location.origin
): string {
  const finalUrl = new URL(redirectUrl, origin);
  finalUrl.searchParams.set('access_token', session.accessToken);
  finalUrl.searchParams.set('user_id', session.user.id);
  finalUrl.searchParams.set('email', session.user.email);
  finalUrl.searchParams.set('name', String(session.user.profile?.name ?? ''));

  if (session.csrfToken) {
    finalUrl.searchParams.set('csrf_token', session.csrfToken);
  }

  return finalUrl.toString();
}
