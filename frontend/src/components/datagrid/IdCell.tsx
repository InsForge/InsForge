import { useState } from 'react';
import { Button } from '@/components/radix/Button';
import { Check, Copy } from 'lucide-react';

function IdCell({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(String(value));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Copy failed silently
    }
  };

  return (
    <div className="w-full h-full flex items-center justify-between group">
      <span className="text-sm truncate" title={String(value)}>
        {value}
      </span>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 w-7 p-1 bg-white dark:bg-neutral-700 opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={(e) => {
          handleCopy(e).catch(() => {
            // Handle copy error silently
          });
        }}
      >
        {copied ? (
          <Check className="h-5 w-5 text-green-600 dark:text-green-400" />
        ) : (
          <Copy className="h-5 w-5 text-black dark:text-white" />
        )}
      </Button>
    </div>
  );
}

export default IdCell;
