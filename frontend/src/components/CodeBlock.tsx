import { cn } from '@/lib/utils/utils';
import { CopyButton } from './CopyButton';

interface CodeBlockProps {
  code: string;
  className?: string;
  showCopy?: boolean;
  onCopy?: (code: string) => void;
  buttonClassName?: string;
  /** Optional label displayed in header - enables compact variant */
  label?: string;
  /** Variant style: 'default' for inline code, 'compact' for labeled blocks */
  variant?: 'default' | 'compact';
}

export function CodeBlock({
  code,
  className,
  showCopy = true,
  onCopy,
  buttonClassName,
  label,
  variant = 'default',
}: CodeBlockProps) {
  // Use compact variant when label is provided
  const isCompact = variant === 'compact' || !!label;

  if (isCompact) {
    return (
      <div
        className={cn(
          'bg-gray-100 dark:bg-neutral-900 rounded p-3 w-full overflow-hidden',
          className
        )}
      >
        {/* Header row with label and copy button */}
        <div className="flex items-center justify-between mb-2">
          {label && (
            <div className="bg-white dark:bg-neutral-700 rounded px-2 shrink-0 h-5 flex item-center`">
              <span className="text-gray-900 dark:text-neutral-50 text-xs leading-5">{label}</span>
            </div>
          )}
          {showCopy && (
            <CopyButton
              text={code}
              onCopy={onCopy}
              showText={false}
              className={cn(
                'h-6 w-6 p-1 bg-white dark:bg-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-600 border-none rounded-md shadow-sm min-w-0 shrink-0 text-black dark:text-white',
                !label && 'ml-auto',
                buttonClassName
              )}
            />
          )}
        </div>
        {/* Code text */}
        <p className="text-gray-900 dark:text-neutral-300 text-sm leading-6 break-all whitespace-pre-wrap">
          {code}
        </p>
      </div>
    );
  }

  // Default inline variant
  return (
    <div
      className={cn(
        'relative h-16 bg-slate-50 dark:bg-neutral-800 py-4 px-6 rounded-md flex items-center justify-between text-zinc-950 dark:text-neutral-300 font-mono text-sm break-all font-semibold',
        className
      )}
    >
      <div className="flex-1 max-w-4/5">
        <code>{code}</code>
      </div>
      {showCopy && (
        <CopyButton
          variant="primary"
          text={code}
          onCopy={onCopy}
          className={cn('absolute right-3.5 top-3.5 h-9 pl-2', buttonClassName)}
        />
      )}
    </div>
  );
}
