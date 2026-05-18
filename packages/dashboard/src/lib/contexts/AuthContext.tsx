import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useLocation } from 'react-router-dom';
import { loginService } from '#features/login/services/login.service';
import { useDashboardHost } from '#lib/config/DashboardHostContext';
import { apiClient } from '#lib/api/client';
import { getCurrentDistinctId, identifyUser } from '#lib/analytics/posthog';
import type { UserSchema } from '@insforge/shared-schemas';

interface AuthContextType {
  user: UserSchema | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  loginWithPassword: (email: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
  refreshAuth: () => Promise<void>;
  error: Error | null;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

interface AuthProviderProps {
  children: React.ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const host = useDashboardHost();
  const isCloudHosting = host.mode === 'cloud-hosting';
  const getAuthorizationCode = isCloudHosting ? host.getAuthorizationCode : null;
  const onRequestUserInfo = isCloudHosting ? host.onRequestUserInfo : undefined;
  const location = useLocation();
  const [user, setUser] = useState<UserSchema | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);
  const queryClient = useQueryClient();
  const cloudAuthenticationRef = useRef<Promise<UserSchema | null> | null>(null);
  const shouldAttemptCloudAuthentication =
    isCloudHosting && !location.pathname.startsWith('/dashboard/login');
  const shouldUseAuthorizationCodeRefresh =
    isCloudHosting && host.useAuthorizationCodeRefresh === true;

  // Drop all user-scoped query data. Called whenever the authenticated user
  // identity actually changes (login / logout / auth error) so the next user
  // never sees the previous user's cached tables, api keys, users, or
  // mcp-usage records. Critical now that `useMetadata` uses `gcTime: Infinity`
  // — without explicit removal, stale tenant-scoped data could persist across
  // sessions in the same browser tab.
  //
  // `cancelQueries` is called before `removeQueries` so any in-flight requests
  // (issued under the previous identity's auth token) are aborted via the
  // AbortSignal each queryFn forwards. Without the cancel, an in-flight fetch
  // could resolve after removal and have its response race against the new
  // user's freshly-mounted query.
  const removeAuthScopedQueries = useCallback(() => {
    const keys: QueryKey[] = [
      ['apiKey'],
      ['metadata'],
      ['users'],
      ['database', 'tables'],
      ['mcp-usage'],
    ];
    for (const queryKey of keys) {
      void queryClient.cancelQueries({ queryKey });
      queryClient.removeQueries({ queryKey });
    }
  }, [queryClient]);

  // Tracks the currently authenticated user id so `applyAuthenticatedUser`
  // can tell a same-user token refresh apart from a real identity switch and
  // only drop cached data in the latter case. Initial value `null` means
  // "no prior session"; first login transitions null → userId without
  // wiping (the cache is already empty).
  const previousUserIdRef = useRef<string | null>(null);

  const handleAuthError = useCallback(() => {
    setUser(null);
    setIsAuthenticated(false);
    previousUserIdRef.current = null;
    removeAuthScopedQueries();
  }, [removeAuthScopedQueries]);

  useEffect(() => {
    loginService.setAuthErrorHandler(handleAuthError);
    return () => {
      loginService.setAuthErrorHandler(undefined);
    };
  }, [handleAuthError]);

  const performPostHogIdentify = useCallback(async (): Promise<void> => {
    if (!onRequestUserInfo) {
      return;
    }
    try {
      const cloudUser = await onRequestUserInfo();
      // Skip identify + /decide wait if posthog-js is already identified as
      // this user (common on F5 refresh or same-session re-mount): calling
      // posthog.identify with the same id is a no-op, so the counter-based
      // wait would hit its 5s timeout for nothing.
      if (getCurrentDistinctId() === cloudUser.userId) {
        return;
      }
      await identifyUser(cloudUser.userId, {
        email: cloudUser.email,
        name: cloudUser.name,
      });
    } catch (err) {
      console.warn('[PostHog] Failed to identify cloud user', err);
    }
  }, [onRequestUserInfo]);

  const applyAuthenticatedUser = useCallback(
    async (nextUser: UserSchema): Promise<void> => {
      await performPostHogIdentify();
      // Drop the previous user's cached data BEFORE switching identity, but
      // ONLY when identity actually changes. Same-user token refresh (cloud
      // authorization-code re-exchange after a 401) must NOT wipe the cache,
      // otherwise the dashboard flashes empty/skeleton state on every refresh.
      // First login from a fresh session has previousUserIdRef.current === null,
      // so `null !== nextUser.id` and the wipe runs — but the cache is already
      // empty, so it's a harmless no-op.
      if (previousUserIdRef.current !== nextUser.id) {
        removeAuthScopedQueries();
      }
      previousUserIdRef.current = nextUser.id;
      setUser(nextUser);
      setIsAuthenticated(true);
    },
    [performPostHogIdentify, removeAuthScopedQueries]
  );

  const exchangeAuthorizationCode = useCallback(
    async (code: string): Promise<UserSchema> => {
      try {
        setError(null);
        const result = await loginService.loginWithAuthorizationCode(code);
        await applyAuthenticatedUser(result.user);
        return result.user;
      } catch (err) {
        setError(err instanceof Error ? err : new Error('Authorization code exchange failed'));
        throw err;
      }
    },
    [applyAuthenticatedUser]
  );

  const authenticateCloudSession = useCallback(async (): Promise<UserSchema | null> => {
    if (!shouldAttemptCloudAuthentication || !getAuthorizationCode) {
      return null;
    }

    if (!cloudAuthenticationRef.current) {
      cloudAuthenticationRef.current = (async () => {
        try {
          setError(null);
          const code = await getAuthorizationCode();
          return await exchangeAuthorizationCode(code);
        } catch (err) {
          setUser(null);
          setIsAuthenticated(false);
          setError(err instanceof Error ? err : new Error('Authorization code exchange failed'));
          return null;
        } finally {
          cloudAuthenticationRef.current = null;
        }
      })();
    }

    return cloudAuthenticationRef.current;
  }, [exchangeAuthorizationCode, getAuthorizationCode, shouldAttemptCloudAuthentication]);

  const loginWithPassword = useCallback(
    async (email: string, password: string): Promise<boolean> => {
      try {
        setError(null);
        const result = await loginService.loginWithPassword(email, password);
        await applyAuthenticatedUser(result.user);
        return true;
      } catch (err) {
        setError(err instanceof Error ? err : new Error('Login failed'));
        return false;
      }
    },
    [applyAuthenticatedUser]
  );

  // Access token refresh handler
  useEffect(() => {
    const handleRefreshAccessToken = async (): Promise<boolean> => {
      const refreshed = await loginService.refreshAccessToken();
      if (refreshed) {
        return true;
      }

      if (shouldUseAuthorizationCodeRefresh) {
        const authenticatedUser = await authenticateCloudSession();
        return authenticatedUser !== null;
      }

      return false;
    };

    apiClient.setRefreshAccessTokenHandler(handleRefreshAccessToken);
    return () => {
      apiClient.setRefreshAccessTokenHandler(undefined);
    };
  }, [authenticateCloudSession, shouldUseAuthorizationCodeRefresh]);

  const checkAuthStatus = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      const currentUser = await loginService.getCurrentUser();
      if (currentUser) {
        // Route through applyAuthenticatedUser so previousUserIdRef stays in
        // sync. Otherwise a session hydrated here as user A, followed later
        // by an auth-code re-exchange that switches to user B, would skip the
        // cache wipe (ref still null) and leak A's tenant-scoped queries to B.
        await applyAuthenticatedUser(currentUser);
        return currentUser;
      }

      setUser(null);
      setIsAuthenticated(false);

      if (shouldAttemptCloudAuthentication) {
        return await authenticateCloudSession();
      }

      return null;
    } catch (err) {
      setUser(null);
      setIsAuthenticated(false);
      if (err instanceof Error && !err.message.includes('401')) {
        setError(err);
      }
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [applyAuthenticatedUser, authenticateCloudSession, shouldAttemptCloudAuthentication]);

  const logout = useCallback(async () => {
    await loginService.logout();
    setUser(null);
    setIsAuthenticated(false);
    setError(null);
    previousUserIdRef.current = null;
    removeAuthScopedQueries();
  }, [removeAuthScopedQueries]);

  const refreshAuth = useCallback(async () => {
    await checkAuthStatus();
  }, [checkAuthStatus]);

  // Run the initial auth check exactly once on mount. We intentionally do NOT
  // re-run when `checkAuthStatus` changes identity: host callback refs from
  // cloud-hosting parents flip on every parent render, which would otherwise
  // re-fire this effect, flipping `isLoading` true and unmounting the entire
  // authenticated subtree (and along with it the React Query observers that
  // keep dashboard caches alive).
  const initialCheckRanRef = useRef(false);
  useEffect(() => {
    if (initialCheckRanRef.current) {
      return;
    }
    initialCheckRanRef.current = true;
    void checkAuthStatus();
  }, [checkAuthStatus]);

  const value: AuthContextType = {
    user,
    isAuthenticated,
    isLoading,
    loginWithPassword,
    logout,
    refreshAuth,
    error,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
