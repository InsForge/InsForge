import { createContext, useContext, type ReactNode } from 'react';
import { cn } from '../lib';

interface ToggleNavContextValue {
  value: string;
  onValueChange: (value: string) => void;
}

const ToggleNavContext = createContext<ToggleNavContextValue | null>(null);

interface ToggleNavProps<T extends string = string> {
  value: T;
  onValueChange: (value: T) => void;
  className?: string;
  children: ReactNode;
}

function ToggleNav<T extends string = string>({
  value,
  onValueChange,
  className,
  children,
}: ToggleNavProps<T>) {
  return (
    <ToggleNavContext.Provider
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
    </ToggleNavContext.Provider>
  );
}

interface ToggleNavItemProps {
  value: string;
  className?: string;
  children: ReactNode;
}

function ToggleNavItem({ value, className, children }: ToggleNavItemProps) {
  const context = useContext(ToggleNavContext);
  if (!context) throw new Error('ToggleNavItem must be used within ToggleNav');

  const isActive = context.value === value;

  return (
    <button
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

export { ToggleNav, ToggleNavItem };
