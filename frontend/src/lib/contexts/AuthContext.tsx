import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { authService } from '@/features/auth/services/auth.service';
import { apiClient } from '@/lib/api/client';

interface User {
  id: string;
  email: string;
  name?: string;
  created_at: string;
  updated_at: string;
}

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<boolean>;
  logout: () => void;
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
  const [user, setUser] = useState<User | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);
  const queryClient = useQueryClient();

  const handleAuthError = useCallback(() => {
    setUser(null);
    setIsAuthenticated(false);
  }, []);

  // Set up auth error handler
  useEffect(() => {
    apiClient.setAuthErrorHandler(handleAuthError);
    return () => {
      apiClient.setAuthErrorHandler(undefined);
    };
  }, [handleAuthError]);

  const checkAuthStatus = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const currentUser = await authService.getCurrentUser();
      setUser(currentUser);
      setIsAuthenticated(true);
      return currentUser;
    } catch (err) {
      setUser(null);
      setIsAuthenticated(false);
      if (err instanceof Error && !err.message.includes('401')) {
        setError(err);
      }
      apiClient.clearToken();
      return null;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const login = useCallback(
    async (email: string, password: string): Promise<boolean> => {
      try {
        setError(null);
        await authService.login(email, password);
        const currentUser = await checkAuthStatus();
        if (currentUser) {
          // Invalidate queries that depend on authentication
          void queryClient.invalidateQueries({ queryKey: ['apiKey'] });
          void queryClient.invalidateQueries({ queryKey: ['metadata'] });
          void queryClient.invalidateQueries({ queryKey: ['users'] });
          void queryClient.invalidateQueries({ queryKey: ['tables'] });
          return true;
        }
        return false;
      } catch (err) {
        setError(err instanceof Error ? err : new Error('Login failed'));
        return false;
      }
    },
    [checkAuthStatus, queryClient]
  );

  const logout = useCallback(() => {
    void authService.logout();
    setUser(null);
    setIsAuthenticated(false);
    setError(null);
  }, []);

  const refreshAuth = useCallback(async () => {
    await checkAuthStatus();
  }, [checkAuthStatus]);

  // Check auth status on mount
  useEffect(() => {
    void checkAuthStatus();
  }, [checkAuthStatus]);

  // Removed periodic auth refresh - it was causing unnecessary unmounts
  // Auth status is checked naturally when API calls are made

  const value: AuthContextType = {
    user,
    isAuthenticated,
    isLoading,
    login,
    logout,
    refreshAuth,
    error,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
