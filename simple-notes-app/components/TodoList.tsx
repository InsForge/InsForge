'use client';

import { useState, useEffect } from 'react';
import { todosService, Todo } from '@/lib/todos';

export default function TodoList() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [newTitle, setNewTitle] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    loadTodos();
  }, []);

  async function loadTodos() {
    try {
      setLoading(true);
      const data = await todosService.getTodos();
      setTodos(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load todos');
    } finally {
      setLoading(false);
    }
  }

  async function handleAddTodo(e: React.FormEvent) {
    e.preventDefault();
    if (!newTitle.trim()) return;

    try {
      const newTodo = await todosService.createTodo(newTitle, newDescription);
      setTodos([newTodo, ...todos]);
      setNewTitle('');
      setNewDescription('');
    } catch (err: any) {
      setError(err.message || 'Failed to add todo');
    }
  }

  async function handleToggleTodo(todo: Todo) {
    try {
      const updated = await todosService.updateTodo(todo.id, { 
        completed: !todo.completed 
      });
      setTodos(todos.map(t => t.id === todo.id ? updated : t));
    } catch (err: any) {
      setError(err.message || 'Failed to update todo');
    }
  }

  async function handleDeleteTodo(id: string) {
    try {
      await todosService.deleteTodo(id);
      setTodos(todos.filter(t => t.id !== id));
    } catch (err: any) {
      setError(err.message || 'Failed to delete todo');
    }
  }

  if (loading) {
    return <div className="text-center py-4">Loading todos...</div>;
  }

  return (
    <div className="w-full max-w-2xl mx-auto p-6">
      <h1 className="text-3xl font-bold mb-6">My Notes</h1>
      
      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
          {error}
        </div>
      )}

      <form onSubmit={handleAddTodo} className="mb-6 bg-white p-4 rounded-lg shadow">
        <input
          type="text"
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          placeholder="Note title..."
          className="w-full px-3 py-2 border border-gray-300 rounded-md mb-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <textarea
          value={newDescription}
          onChange={(e) => setNewDescription(e.target.value)}
          placeholder="Note description (optional)..."
          className="w-full px-3 py-2 border border-gray-300 rounded-md mb-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          rows={3}
        />
        <button
          type="submit"
          className="w-full py-2 px-4 bg-blue-500 text-white rounded-md hover:bg-blue-600"
        >
          Add Note
        </button>
      </form>

      <div className="space-y-2">
        {todos.length === 0 ? (
          <p className="text-gray-500 text-center py-8">No notes yet. Add your first note above!</p>
        ) : (
          todos.map((todo) => (
            <div
              key={todo.id}
              className="bg-white p-4 rounded-lg shadow flex items-start justify-between"
            >
              <div className="flex items-start flex-1">
                <input
                  type="checkbox"
                  checked={todo.completed}
                  onChange={() => handleToggleTodo(todo)}
                  className="mr-3 mt-1"
                />
                <div className="flex-1">
                  <h3 className={`font-semibold ${todo.completed ? 'line-through text-gray-500' : ''}`}>
                    {todo.title}
                  </h3>
                  {todo.description && (
                    <p className={`text-sm text-gray-600 mt-1 ${todo.completed ? 'line-through' : ''}`}>
                      {todo.description}
                    </p>
                  )}
                </div>
              </div>
              <button
                onClick={() => handleDeleteTodo(todo.id)}
                className="ml-4 text-red-500 hover:text-red-700"
              >
                Delete
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}