import { cn } from '@/lib/utils/utils';

export type InstallMethod = 'terminal' | 'extension';

export interface InstallMethodTab {
  id: InstallMethod;
  label: string;
}

interface InstallMethodTabsProps {
  tabs: InstallMethodTab[];
  value: InstallMethod;
  onChange: (value: InstallMethod) => void;
  className?: string;
}

export function InstallMethodTabs({ tabs, value, onChange, className }: InstallMethodTabsProps) {
  return (
    <div className={cn('flex dark:bg-neutral-800 bg-neutral-200 rounded-lg p-1', className)}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={cn(
            'flex-1 h-9 py-1 px-3 flex items-center justify-center gap-1 rounded text-sm leading-5 transition-colors',
            value === tab.id
              ? 'dark:bg-neutral-700 bg-neutral-100 dark:text-white text-black'
              : 'dark:text-neutral-400 text-gray-500 dark:hover:text-white hover:text-black'
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

// Default tab configurations
export const DEFAULT_OVERLAY_TABS: InstallMethodTab[] = [
  { id: 'terminal', label: 'Terminal Install' },
  { id: 'extension', label: 'VSCode Extension' },
];

export const DEFAULT_MODAL_TABS: InstallMethodTab[] = [
  { id: 'terminal', label: 'Terminal Install' },
  { id: 'extension', label: 'VSCode Extension' },
];
