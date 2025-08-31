'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { insforge } from '@/lib/insforge';

interface User {
  id: string;
  email: string;
  name?: string;
  emailVerified?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  signUp: (email: string, password: string) => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkUser();
  }, []);

  async function checkUser() {
    try {
      // Just ask the SDK - it manages its own storage
      const { data, error } = await insforge.auth.getCurrentUser();
      
      if (data && !error) {
        setUser(data.user);
      }
    } catch (error) {
      console.error('Error checking user:', error);
    } finally {
      setLoading(false);
    }
  }

  async function signUp(email: string, password: string) {
    console.log('Signing up with:', email);
    
    const { data, error } = await insforge.auth.signUp({
      email,
      password
    });

    console.log('Signup response:', { data, error });

    if (error) {
      console.error('Signup error:', error);
      throw new Error(error.message || 'Failed to sign up');
    }

    if (data) {
      console.log('Signup successful, user:', data.user);
      // SDK already saved the session internally
      setUser(data.user);
    }
  }

  async function signIn(email: string, password: string) {
    const { data, error } = await insforge.auth.signInWithPassword({
      email,
      password
    });

    if (error) {
      throw new Error(error.message || 'Failed to sign in');
    }

    if (data) {
      // SDK already saved the session internally
      setUser(data.user);
    }
  }

  async function signOut() {
    await insforge.auth.signOut();
    // SDK clears its own storage
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, loading, signUp, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}