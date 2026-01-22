import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { loginService } from '@/features/login/services/login.service';
import type { UserSchema } from '@insforge/shared-schemas';

interface AuthContextType {
  user: UserSchema | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  loginWithPassword: (email: string, password: string) => Promise<boolean>;
  loginWithAuthorizationCode: (token: string) => Promise<boolean>;
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

  const invalidateAuthQueries = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['apiKey'] }),
      queryClient.invalidateQueries({ queryKey: ['metadata'] }),
      queryClient.invalidateQueries({ queryKey: ['users'] }),
      queryClient.invalidateQueries({ queryKey: ['tables'] }),
      queryClient.invalidateQueries({ queryKey: ['mcp-usage'] }),
    ]);
  }, [queryClient]);

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
