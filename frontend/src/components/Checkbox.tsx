import CheckedIcon from '@/assets/icons/checkbox_checked.svg';
import UndeterminedIcon from '@/assets/icons/checkbox_undetermined.svg';
import { cn } from '@/lib/utils/utils';

// Checkbox component with custom design
interface CheckboxProps {
  checked: boolean;
  indeterminate?: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
  tabIndex?: number;
}

export default function Checkbox({
  checked,
  indeterminate = false,
  onChange,
  disabled = false,
  className,
  tabIndex,
}: CheckboxProps) {
  const showIcon = checked || indeterminate;
  const iconSrc = indeterminate ? UndeterminedIcon : CheckedIcon;
  const iconAlt = indeterminate ? 'Indeterminate' : 'Checked';

  return (
    <div className="w-full h-full flex items-center justify-center">
      <div className="relative grid place-items-center">
        {/* Native checkbox (visually hidden but accessible) */}
        <input
          type="checkbox"
          className={cn(
            'w-4 h-4 bg-white rounded appearance-none border border-zinc-200 shadow-[0px_2px_1px_0px_rgba(0,0,0,0.1)] cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 row-start-1 col-start-1 disabled:cursor-not-allowed disabled:opacity-50',
            className
          )}
          checked={indeterminate ? false : checked}
          onChange={(e) => onChange(e.target.checked)}
          tabIndex={tabIndex}
          disabled={disabled}
        />

        {/* Overlay icon */}
        {showIcon && (
          <img
            src={iconSrc}
            alt={iconAlt}
            className={`pointer-events-none mx-auto w-4 h-4 bg-white rounded row-start-1 col-start-1 ${disabled ? 'opacity-50' : ''}`}
          />
        )}
      </div>
    </div>
  );
}
