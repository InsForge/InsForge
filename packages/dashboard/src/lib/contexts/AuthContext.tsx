import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { loginService } from '../../features/login/services/login.service';
import { useDashboardHost } from '../config/DashboardHostContext';
import { apiClient } from '../api/client';
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
  const [user, setUser] = useState<UserSchema | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);
  const queryClient = useQueryClient();
  const cloudAuthenticationRef = useRef<Promise<UserSchema | null> | null>(null);

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
      queryClient.invalidateQueries({ queryKey: ['tables'] }),
      queryClient.invalidateQueries({ queryKey: ['mcp-usage'] }),
    ]);
  }, [queryClient]);

  const applyAuthenticatedUser = useCallback(
    async (nextUser: UserSchema): Promise<void> => {
      setUser(nextUser);
      setIsAuthenticated(true);
      await invalidateAuthQueries();
    },
    [invalidateAuthQueries]
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
    if (host.mode !== 'cloud-hosting') {
      return null;
    }

    if (!cloudAuthenticationRef.current) {
      cloudAuthenticationRef.current = (async () => {
        try {
          setError(null);
          const code = await host.getAuthorizationCode();
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
  }, [exchangeAuthorizationCode, host]);

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
    const handleRefreshAccessToken = (): Promise<boolean> => {
      if (host.mode === 'cloud-hosting') {
        return authenticateCloudSession().then((authenticatedUser) => authenticatedUser !== null);
      }

      return loginService.refreshAccessToken();
    };

    apiClient.setRefreshAccessTokenHandler(handleRefreshAccessToken);
    return () => {
      apiClient.setRefreshAccessTokenHandler(undefined);
    };
  }, [authenticateCloudSession, host.mode]);

  const checkAuthStatus = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      if (host.mode === 'cloud-hosting' && !apiClient.getAccessToken()) {
        return await authenticateCloudSession();
      }

      const currentUser = await loginService.getCurrentUser();
      if (!currentUser && host.mode === 'cloud-hosting') {
        return await authenticateCloudSession();
      }

      setUser(currentUser);
      setIsAuthenticated(!!currentUser);
      return currentUser;
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
  }, [authenticateCloudSession, host.mode]);

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
