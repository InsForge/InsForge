import { cn } from '../lib';
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
          'bg-semantic-1 border border-alpha-8 rounded p-3 w-full overflow-hidden text-foreground text-sm leading-6 break-all whitespace-pre-wrap',
          className
        )}
      >
        {/* Header row with label and copy button */}
        <div className="flex items-center justify-between mb-2">
          {label && (
            <div className="bg-alpha-8 rounded px-2 shrink-0 h-5 flex items-center">
              <span className="text-muted-foreground text-xs leading-5 font-medium">{label}</span>
            </div>
          )}
          {showCopy && (
            <CopyButton
              text={code}
              onCopy={onCopy}
              showText={false}
              className={cn(!label && 'ml-auto', buttonClassName)}
            />
          )}
        </div>
        {/* Code text */}
        <p>{code}</p>
      </div>
    );
  }

  // Default inline variant
  return (
    <div
      className={cn(
        'relative h-16 bg-semantic-1 border border-alpha-8 py-4 px-6 rounded-md flex items-center justify-between text-foreground font-mono text-sm break-all font-semibold',
        className
      )}
    >
      <div className="flex-1 max-w-4/5">
        <code>{code}</code>
      </div>
      {showCopy && (
        <CopyButton
          text={code}
          onCopy={onCopy}
          className={cn('absolute right-3.5 top-3.5', buttonClassName)}
        />
      )}
    </div>
  );
}
