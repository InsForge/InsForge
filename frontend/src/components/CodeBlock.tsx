import { cn } from '@/lib/utils/utils';
import { CopyButton } from './CopyButton';

interface CodeBlockProps {
  code: string;
  className?: string;
  showCopy?: boolean;
  onCopy?: (code: string) => void;
}

export function CodeBlock({ code, className, showCopy = true, onCopy }: CodeBlockProps) {
  return (
    <div
      className={cn(
        'bg-slate-50 py-4 px-6 flex items-center justify-between text-zinc-950 font-mono text-sm break-all font-semibold',
        className
      )}
    >
      <div className="flex-1 max-w-4/5">
        <code>{code}</code>
      </div>
      {showCopy && <CopyButton text={code} onCopy={onCopy} />}
    </div>
  );
}
