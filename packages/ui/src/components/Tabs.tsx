import { createContext, useContext, type ReactNode } from 'react';
import { cn } from '../lib';

interface TabsContextValue {
  value: string;
  onValueChange: (value: string) => void;
}

const TabsContext = createContext<TabsContextValue | null>(null);

interface TabsProps<T extends string = string> {
  value: T;
  onValueChange: (value: T) => void;
  className?: string;
  children: ReactNode;
}

function Tabs<T extends string = string>({
  value,
  onValueChange,
  className,
  children,
}: TabsProps<T>) {
  return (
    <TabsContext.Provider
      value={{
        value,
        onValueChange: onValueChange as (value: string) => void,
      }}
    >
      <div
        className={cn(
          'flex items-center bg-alpha-4 border border-alpha-8 rounded overflow-hidden',
          className
        )}
      >
        {children}
      </div>
    </TabsContext.Provider>
  );
}

interface TabProps {
  value: string;
  className?: string;
  children: ReactNode;
}

function Tab({ value, className, children }: TabProps) {
  const context = useContext(TabsContext);
  if (!context) {
    throw new Error('Tab must be used within Tabs');
  }

  const isActive = context.value === value;

  return (
    <button
      type="button"
      onClick={() => context.onValueChange(value)}
      className={cn(
        'flex items-center justify-center gap-1 px-3 py-1.5 text-sm transition-colors',
        isActive ? 'bg-toast text-foreground' : 'text-muted-foreground hover:text-foreground',
        className
      )}
    >
      {children}
    </button>
  );
}

export { Tabs, Tab };
