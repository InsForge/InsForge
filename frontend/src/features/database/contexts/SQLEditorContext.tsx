import { createContext, useContext, useState, ReactNode, useEffect, useRef } from 'react';

export interface SQLTab {
  id: string;
  name: string;
  query: string;
}

interface SQLEditorContextType {
  tabs: SQLTab[];
  activeTabId: string;
  activeTab: SQLTab | undefined;
  addTab: (initialQuery?: string, initialName?: string) => void;
  removeTab: (tabId: string) => void;
  setActiveTab: (tabId: string) => void;
  updateTabQuery: (tabId: string, query: string) => void;
  updateTabName: (tabId: string, name: string) => void;
}

const SQLEditorContext = createContext<SQLEditorContextType | undefined>(undefined);

interface SQLEditorProviderProps {
  children: ReactNode;
}

const STORAGE_KEY = 'sql-editor-tabs';
const ACTIVE_TAB_KEY = 'sql-editor-active-tab';
const DEBOUNCE_DELAY = 500; // Save after 500ms of inactivity

let tabCounter = 1;

// Load tabs from localStorage
function loadTabsFromStorage(): SQLTab[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const tabs = JSON.parse(stored) as SQLTab[];
      // Update tabCounter to be higher than any existing tab number
      tabs.forEach((tab) => {
        const match = tab.name.match(/Query (\d+)/);
        if (match) {
          const num = parseInt(match[1], 10);
          if (num >= tabCounter) {
            tabCounter = num;
          }
        }
      });
      return tabs.length > 0 ? tabs : getDefaultTabs();
    }
  } catch (error) {
    console.error('Failed to load tabs from localStorage:', error);
  }
  return getDefaultTabs();
}

function getDefaultTabs(): SQLTab[] {
  return [
    {
      id: 'tab-1',
      name: 'Query 1',
      query: '',
    },
  ];
}

function loadActiveTabFromStorage(): string {
  try {
    const stored = localStorage.getItem(ACTIVE_TAB_KEY);
    return stored || 'tab-1';
  } catch (error) {
    console.error('Failed to load active tab from localStorage:', error);
    return 'tab-1';
  }
}

export function SQLEditorProvider({ children }: SQLEditorProviderProps) {
  const [tabs, setTabs] = useState<SQLTab[]>(loadTabsFromStorage);
  const [activeTabId, setActiveTabId] = useState(loadActiveTabFromStorage);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const tabsRef = useRef<SQLTab[]>(tabs);

  const activeTab = tabs.find((tab) => tab.id === activeTabId);

  // Debounced save to localStorage
  const debouncedSave = (tabsToSave: SQLTab[]) => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    saveTimeoutRef.current = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(tabsToSave));
      } catch (error) {
        console.error('Failed to save tabs to localStorage:', error);
      }
    }, DEBOUNCE_DELAY);
  };

  // Save active tab immediately (no debounce needed for this)
  useEffect(() => {
    try {
      localStorage.setItem(ACTIVE_TAB_KEY, activeTabId);
    } catch (error) {
      console.error('Failed to save active tab to localStorage:', error);
    }
  }, [activeTabId]);

  // Debounced save for tabs changes
  useEffect(() => {
    // Keep ref in sync with latest tabs
    tabsRef.current = tabs;
    debouncedSave(tabs);
    // Cleanup timeout on unmount and flush pending save
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        // Flush the pending save to avoid data loss
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(tabsRef.current));
        } catch (error) {
          console.error('Failed to save tabs to localStorage:', error);
        }
      }
    };
  }, [tabs]);

  const addTab = (initialQuery?: string, initialName?: string) => {
    tabCounter++;
    const newTab: SQLTab = {
      id: `tab-${Date.now()}`,
      name: initialName || `Query ${tabCounter}`,
      query: initialQuery || '',
    };
    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(newTab.id);
  };

  const removeTab = (tabId: string) => {
    setTabs((prev) => {
      const newTabs = prev.filter((tab) => tab.id !== tabId);
      // Don't allow removing the last tab
      if (newTabs.length === 0) {
        return prev;
      }
      // If we're removing the active tab, switch to the first remaining tab
      if (tabId === activeTabId) {
        setActiveTabId(newTabs[0].id);
      }
      return newTabs;
    });
  };

  const setActiveTab = (tabId: string) => {
    setActiveTabId(tabId);
  };

  const updateTabQuery = (tabId: string, query: string) => {
    setTabs((prev) => prev.map((tab) => (tab.id === tabId ? { ...tab, query } : tab)));
  };

  const updateTabName = (tabId: string, name: string) => {
    setTabs((prev) => prev.map((tab) => (tab.id === tabId ? { ...tab, name } : tab)));
  };

  return (
    <SQLEditorContext.Provider
      value={{
        tabs,
        activeTabId,
        activeTab,
        addTab,
        removeTab,
        setActiveTab,
        updateTabQuery,
        updateTabName,
      }}
    >
      {children}
    </SQLEditorContext.Provider>
  );
}

export function useSQLEditorContext() {
  const context = useContext(SQLEditorContext);
  if (context === undefined) {
    throw new Error('useSQLEditorContext must be used within a SQLEditorProvider');
  }
  return context;
}
