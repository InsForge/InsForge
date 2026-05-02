import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'react-router-dom';
import { loginService } from '#features/login/services/login.service';
import { databaseTableQueryKeys } from '#features/database/queryKeys';
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

  const handleAuthError = useCallback(() => {
    setUser(null);
    setIsAuthenticated(false);
  }, []);

  useEffect(() => {
    loginService.setAuthErrorHandler(handleAuthError);
    return () => {
      loginService.setAuthErrorHandler(undefined);
    };
  }, [handleAuthError]);

  const invalidateAuthQueries = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['apiKey'] }),
      queryClient.invalidateQueries({ queryKey: ['metadata'] }),
      queryClient.invalidateQueries({ queryKey: ['users'] }),
      queryClient.invalidateQueries({ queryKey: databaseTableQueryKeys.list }),
      queryClient.invalidateQueries({ queryKey: ['mcp-usage'] }),
    ]);
  }, [queryClient]);

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
      setUser(nextUser);
      setIsAuthenticated(true);
      await invalidateAuthQueries();
    },
    [invalidateAuthQueries, performPostHogIdentify]
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
        await performPostHogIdentify();
        setUser(currentUser);
        setIsAuthenticated(true);
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
  }, [authenticateCloudSession, performPostHogIdentify, shouldAttemptCloudAuthentication]);

  const logout = useCallback(async () => {
    await loginService.logout();
    setUser(null);
    setIsAuthenticated(false);
    setError(null);
  }, []);

  const refreshAuth = useCallback(async () => {
    await checkAuthStatus();
  }, [checkAuthStatus]);

  useEffect(() => {
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
