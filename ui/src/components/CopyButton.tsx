import { useState, useRef, useEffect } from 'react';
import { Copy, CheckCircle } from 'lucide-react';
import { Button } from './Button';
import { cn } from '../lib';

interface CopyButtonProps {
  text: string;
  onCopy?: (text: string) => void;
  className?: string;
  showText?: boolean;
  copiedText?: string;
  copyText?: string;
  disabled?: boolean;
}

export function CopyButton({
  text,
  onCopy,
  className,
  showText = true,
  copiedText = 'Copied',
  copyText = 'Copy',
  disabled = false,
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  return (
    <Button
      onClick={(e) => void handleCopy(e)}
      disabled={disabled}
      aria-label={!showText ? (copied ? copiedText : copyText) : undefined}
      className={cn(
        'h-8 px-3 gap-2 text-sm font-medium rounded',
        // Icon-only mode follows small icon action style from design
        !showText &&
          'h-5 w-5 min-w-0 p-0 rounded bg-transparent text-muted-foreground before:hidden hover:bg-transparent hover:text-foreground',
        // Text mode
        showText && !copied && 'bg-primary text-[rgb(var(--inverse))]',
        // Copied state
        !showText && copied && 'text-primary cursor-default hover:bg-transparent',
        showText &&
          copied &&
          'bg-primary text-[rgb(var(--inverse))] cursor-default hover:bg-primary',
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
