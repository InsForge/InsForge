export interface Todo {
  id: string;
  title: string;
  description?: string;
  completed: boolean;
  user_id: string;
  created_at: string;
  updated_at: string;
}

import { insforge } from './insforge';

export const todosService = {
  async getTodos(): Promise<Todo[]> {
    // Get session from SDK
    const { data: sessionData } = await insforge.auth.getSession();
    if (!sessionData?.session) throw new Error('User not authenticated');
    
    const token = sessionData.session.accessToken;
    const userId = sessionData.session.user.id;
    
    const response = await fetch(`http://localhost:7130/api/database/records/todos?user_id=eq.${userId}&order=created_at.desc`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to fetch todos');
    }
    
    return await response.json();
  },

  async createTodo(title: string, description?: string): Promise<Todo> {
    // Get session from SDK
    const { data: sessionData } = await insforge.auth.getSession();
    if (!sessionData?.session) throw new Error('User not authenticated');
    
    const token = sessionData.session.accessToken;
    const userId = sessionData.session.user.id;
    
    const response = await fetch('http://localhost:7130/api/database/records/todos', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify([{
        title,
        description,
        user_id: userId,
        completed: false
      }])
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to create todo');
    }
    
    const data = await response.json();
    return data[0];
  },

  async updateTodo(id: string, updates: Partial<Pick<Todo, 'title' | 'description' | 'completed'>>): Promise<Todo> {
    // Get session from SDK
    const { data: sessionData } = await insforge.auth.getSession();
    if (!sessionData?.session) throw new Error('User not authenticated');
    
    const token = sessionData.session.accessToken;
    
    const response = await fetch(`http://localhost:7130/api/database/records/todos?id=eq.${id}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify(updates)
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to update todo');
    }
    
    const data = await response.json();
    return data[0];
  },

  async deleteTodo(id: string): Promise<void> {
    // Get session from SDK
    const { data: sessionData } = await insforge.auth.getSession();
    if (!sessionData?.session) throw new Error('User not authenticated');
    
    const token = sessionData.session.accessToken;
    
    const response = await fetch(`http://localhost:7130/api/database/records/todos?id=eq.${id}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to delete todo');
    }
  }
};