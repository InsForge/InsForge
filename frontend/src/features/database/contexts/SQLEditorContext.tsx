import { createContext, useContext, useState, ReactNode } from 'react';

interface SQLEditorContextType {
  query: string;
  setQuery: (query: string) => void;
}

const SQLEditorContext = createContext<SQLEditorContextType | undefined>(undefined);

interface SQLEditorProviderProps {
  children: ReactNode;
}

export function SQLEditorProvider({ children }: SQLEditorProviderProps) {
  const [query, setQuery] = useState('');

  return (
    <SQLEditorContext.Provider value={{ query, setQuery }}>{children}</SQLEditorContext.Provider>
  );
}

export function useSQLEditorContext() {
  const context = useContext(SQLEditorContext);
  if (context === undefined) {
    throw new Error('useSQLEditorContext must be used within a SQLEditorProvider');
  }
  return context;
}
