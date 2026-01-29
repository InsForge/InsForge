import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { loginService } from '@/features/login/services/login.service';
import { partnershipService } from '@/features/login/services/partnership.service';
import { apiClient } from '@/lib/api/client';
import { postMessageToParent } from '@/lib/utils/cloudMessaging';
import { isInsForgeCloudProject, isIframe } from '@/lib/utils/utils';
import type { UserSchema } from '@insforge/shared-schemas';

const CLOUD_AUTH_TIMEOUT = 30000;

interface AuthContextType {
  user: UserSchema | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  loginWithPassword: (email: string, password: string) => Promise<boolean>;
  loginWithAuthorizationCode: (code: string) => Promise<boolean>;
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
  const [user, setUser] = useState<UserSchema | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);
  const queryClient = useQueryClient();

  // Ref for pending refresh request (resolves when AUTHORIZATION_CODE is received)
  const pendingRefreshRef = useRef<{
    resolve: (success: boolean) => void;
    timeoutId: ReturnType<typeof setTimeout>;
  } | null>(null);

  // Ref to track if auth is in progress (prevents duplicate AUTHORIZATION_CODE processing)
  const authInProgressRef = useRef<boolean>(false);

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

  const loginWithAuthorizationCode = useCallback(
    async (code: string): Promise<boolean> => {
      try {
        setError(null);
        const result = await loginService.loginWithAuthorizationCode(code);
        setUser(result.user);
        setIsAuthenticated(true);
        await invalidateAuthQueries();
        return true;
      } catch (err) {
        setError(err instanceof Error ? err : new Error('Authorization code exchange failed'));
        return false;
      }
    },
    [invalidateAuthQueries]
  );

  // Handle AUTHORIZATION_CODE from parent window
  const handleAuthorizationCode = useCallback(
    async (code: string, origin: string) => {
      // Skip if auth is in progress (deduplication)
      // Skip if already authenticated, unless there's a pending refresh request
      if (authInProgressRef.current || (isAuthenticated && !pendingRefreshRef.current)) {
        return;
      }
      authInProgressRef.current = true;

      try {
        const success = await loginWithAuthorizationCode(code);

        // Resolve pending refresh if any
        if (pendingRefreshRef.current) {
          clearTimeout(pendingRefreshRef.current.timeoutId);
          pendingRefreshRef.current.resolve(success);
          pendingRefreshRef.current = null;
        }

        // Notify parent
        if (success) {
          postMessageToParent({ type: 'AUTH_SUCCESS' }, origin);
        } else {
          postMessageToParent(
            { type: 'AUTH_ERROR', message: 'Authorization code validation failed' },
            origin
          );
        }
      } finally {
        authInProgressRef.current = false;
      }
    },
    [isAuthenticated, loginWithAuthorizationCode]
  );

  // Persistent AUTHORIZATION_CODE listener for cloud projects
  useEffect(() => {
    if (!isInsForgeCloudProject()) {
      return;
    }

    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type !== 'AUTHORIZATION_CODE' || !event.data?.code) {
        return;
      }

      // Validate origin - allow insforge.dev, *.insforge.dev, localhost (dev), and partner domains
      const isInsforgeOrigin =
        event.origin.endsWith('.insforge.dev') || event.origin === 'https://insforge.dev';

      if (isInsforgeOrigin) {
        void handleAuthorizationCode(event.data.code, event.origin);
      } else {
        // Check partner origins asynchronously
        void partnershipService.fetchConfig().then((config) => {
          if (config?.partner_sites?.includes(event.origin)) {
            void handleAuthorizationCode(event.data.code, event.origin);
          }
        });
      }
    };

    window.addEventListener('message', handleMessage);
    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, [handleAuthorizationCode]);

  // Access token refresh handler
  useEffect(() => {
    const handleRefreshAccessToken = (): Promise<boolean> => {
      if (isIframe()) {
        // In iframe: request new auth code from parent, persistent listener will handle it
        return new Promise<boolean>((resolve) => {
          pendingRefreshRef.current = {
            resolve: (success: boolean) => {
              pendingRefreshRef.current = null;
              resolve(success);
            },
            timeoutId: setTimeout(() => {
              pendingRefreshRef.current = null;
              resolve(false);
            }, CLOUD_AUTH_TIMEOUT),
          };
          postMessageToParent({ type: 'REQUEST_AUTHORIZATION_CODE' });
        });
      } else {
        // Not in iframe: use cookie-based refresh
        return loginService.refreshAccessToken();
      }
    };

    apiClient.setRefreshAccessTokenHandler(handleRefreshAccessToken);
    return () => {
      apiClient.setRefreshAccessTokenHandler(undefined);
      // Clear any pending refresh timeout
      if (pendingRefreshRef.current) {
        clearTimeout(pendingRefreshRef.current.timeoutId);
        pendingRefreshRef.current = null;
      }
    };
  }, []);

  const checkAuthStatus = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      const currentUser = await loginService.getCurrentUser();
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
  }, []);

  const loginWithPassword = useCallback(
    async (email: string, password: string): Promise<boolean> => {
      try {
        setError(null);
        const result = await loginService.loginWithPassword(email, password);
        setUser(result.user);
        setIsAuthenticated(true);
        await invalidateAuthQueries();
        return true;
      } catch (err) {
        setError(err instanceof Error ? err : new Error('Login failed'));
        return false;
      }
    },
    [invalidateAuthQueries]
  );

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
    loginWithAuthorizationCode,
    logout,
    refreshAuth,
    error,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
