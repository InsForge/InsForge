'use client';

import { useAuth } from '@/contexts/AuthContext';
import AuthForm from '@/components/AuthForm';
import TodoList from '@/components/TodoList';

export default function Home() {
  const { user, loading, signOut } = useAuth();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-lg">Loading...</div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <AuthForm />
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8">
      <header className="flex justify-between items-center mb-8 px-6">
        <div>
          <h1 className="text-2xl font-bold">Welcome, {user.email}</h1>
          <p className="text-gray-600">Manage your notes below</p>
        </div>
        <button
          onClick={signOut}
          className="px-4 py-2 bg-red-500 text-white rounded-md hover:bg-red-600"
        >
          Sign Out
        </button>
      </header>
      
      <TodoList />
    </div>
  );
}
