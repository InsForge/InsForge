import { useState, useRef, useEffect } from 'react';
import { Copy, CheckCircle } from 'lucide-react';
import { Button } from '@/components/radix/Button';
import { cn } from '@/lib/utils/utils';

interface CopyButtonProps {
  text: string;
  onCopy?: (text: string) => void;
  className?: string;
  variant?: 'primary' | 'secondary';
  showText?: boolean;
  copiedText?: string;
  copyText?: string;
  disabled?: boolean;
}

export function CopyButton({
  text,
  onCopy,
  className,
  variant = 'primary',
  showText = true,
  copiedText = 'Copied',
  copyText = 'Copy',
  disabled = false,
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  const handleCopy = async (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (disabled) {
      return;
    }

    try {
      await navigator.clipboard.writeText(text);

      // Clear existing timer if any
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }

      setCopied(true);

      // Set new timer
      timerRef.current = setTimeout(() => {
        setCopied(false);
        timerRef.current = null;
      }, 3000);

      if (onCopy) {
        onCopy(text);
      }
    } catch (error) {
      // Failed to copy text
      console.error(error);
    }
  };

  const isPrimary = variant === 'primary';

  return (
    <Button
      onClick={(e) => void handleCopy(e)}
      disabled={disabled}
      className={cn(
        'h-8 px-3 gap-2 text-sm font-medium rounded transition-colors',
        // Icon-only mode (when showText is false)
        !showText && 'w-8 px-0 justify-center',
        // Primary variant (black/emerald)
        isPrimary && !copied && 'bg-black text-white hover:bg-gray-800',
        isPrimary && !copied && 'dark:bg-emerald-300 dark:text-black dark:hover:bg-emerald-400',
        // Secondary variant (light gray/neutral)
        !isPrimary &&
          !copied &&
          'bg-gray-100 text-gray-900 hover:bg-gray-200 dark:bg-neutral-700 dark:text-white dark:hover:bg-neutral-600',
        // Copied state (same for both variants) - stone-600
        copied && 'bg-stone-600 text-white cursor-default hover:bg-stone-600',
        copied && 'dark:bg-stone-600 dark:text-white dark:hover:bg-stone-600',
        className
      )}
    >
      {copied ? (
        <>
          <CheckCircle className="w-4 h-4" />
          {showText && <span>{copiedText}</span>}
        </>
      ) : (
        <>
          <Copy className="w-4 h-4" />
          {showText && <span>{copyText}</span>}
        </>
      )}
    </Button>
  );
}
