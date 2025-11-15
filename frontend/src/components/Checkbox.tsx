import { cn } from '@/lib/utils/utils';
import { useTheme } from '@/lib/contexts/ThemeContext';
import CheckboxCheckedIcon from '@/assets/icons/checkbox_checked.svg?react';
import CheckboxUndeterminedIcon from '@/assets/icons/checkbox_undetermined.svg?react';

// Checkbox component with custom design
interface CheckboxProps {
  checked: boolean;
  indeterminate?: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
  tabIndex?: number;
}

export function Checkbox({
  checked,
  indeterminate = false,
  onChange,
  disabled = false,
  className,
  tabIndex,
}: CheckboxProps) {
  const { resolvedTheme } = useTheme();
  const showIcon = checked || indeterminate;

  return (
    <div className="relative grid place-items-center">
      {/* Native checkbox (visually hidden but accessible) */}
      <input
        type="checkbox"
        className={cn(
          'w-4 h-4 bg-white dark:bg-neutral-700 rounded appearance-none border border-zinc-200 dark:border-neutral-600 shadow-[0px_2px_1px_0px_rgba(0,0,0,0.1)] cursor-pointer row-start-1 col-start-1 disabled:cursor-not-allowed disabled:opacity-50',
          className
        )}
        checked={indeterminate ? false : checked}
        onChange={(e) => onChange(e.target.checked)}
        tabIndex={tabIndex}
        disabled={disabled}
      />

      {/* Overlay icon with dynamic background and text color */}
      {showIcon && (
        <div
          className={cn(
            'mx-auto w-4 h-4 rounded row-start-1 col-start-1 pointer-events-none',
            resolvedTheme === 'light' ? 'bg-black text-white' : 'bg-emerald-300 text-black'
          )}
        >
          {indeterminate ? (
            <CheckboxUndeterminedIcon className="w-full h-full" />
          ) : (
            <CheckboxCheckedIcon className="w-full h-full" />
          )}
        </div>
      )}
    </div>
  );
}
