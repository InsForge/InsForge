import { cn } from '@/lib/utils/utils';
import { CopyButton } from './CopyButton';

interface CodeBlockProps {
  code: string;
  className?: string;
  showCopy?: boolean;
  onCopy?: (code: string) => void;
  buttonClassName?: string;
}

export function CodeBlock({
  code,
  className,
  showCopy = true,
  onCopy,
  buttonClassName,
}: CodeBlockProps) {
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
          className={`${buttonClassName} absolute right-3.5 top-3.5 h-9 pl-2`}
        />
      )}
    </div>
  );
}
