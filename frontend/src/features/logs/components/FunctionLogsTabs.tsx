import { cn } from '@/lib/utils/utils';

export type FunctionLogType = 'runtime' | 'build';

export interface FunctionLogTab {
  id: FunctionLogType;
  label: string;
}

interface FunctionLogsTabsProps {
  value: FunctionLogType;
  onChange: (value: FunctionLogType) => void;
  className?: string;
}

const FUNCTION_LOG_TABS: FunctionLogTab[] = [
  { id: 'runtime', label: 'Runtime Logs' },
  { id: 'build', label: 'Build Logs' },
];

export function FunctionLogsTabs({ value, onChange, className }: FunctionLogsTabsProps) {
  return (
    <div className={cn('flex dark:bg-neutral-700 bg-neutral-200 rounded-lg p-1', className)}>
      {FUNCTION_LOG_TABS.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={cn(
            'h-8 py-1 px-4 flex items-center justify-center rounded text-sm leading-5 transition-colors',
            value === tab.id
              ? 'dark:bg-neutral-600 bg-white dark:text-white text-black shadow-sm'
              : 'dark:text-neutral-400 text-gray-500 dark:hover:text-white hover:text-black'
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
