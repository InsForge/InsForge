import { useState } from 'react';
import { Copy } from 'lucide-react';
import { Button } from '@/components/radix/Button';
import { cn } from '@/lib/utils/utils';
import CheckedIcon from '@/assets/icons/checked.svg';

interface CopyButtonProps {
  text: string;
  onCopy?: (text: string) => void;
  className?: string;
  variant?: 'ghost' | 'outline' | 'default';
  size?: 'sm' | 'default' | 'lg' | 'icon';
  showText?: boolean;
  copiedText?: string;
  copyText?: string;
  disabled?: boolean;
}

export function CopyButton({
  text,
  onCopy,
  className,
  variant = 'ghost',
  size = 'sm',
  showText = true,
  copiedText = 'Copied',
  copyText = 'Copy',
  disabled = false,
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (disabled) {
      return;
    }

    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);

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
      variant={variant}
      size={size}
      onClick={() => void handleCopy()}
      disabled={disabled}
      className={cn(
        'px-3 w-fit h-8 rounded-md bg-zinc-50 hover:bg-bg-gray-hover border-border-gray border shadow gap-1.5 transition-all duration-200',
        copied && 'bg-transparent cursor-default shadow-none border-none hover:bg-transparent',
        className
      )}
    >
      {copied ? (
        <img src={CheckedIcon} alt="Checked" className="w-4 h-4" />
      ) : (
        <Copy className="w-4 h-4 text-zinc-950" />
      )}
      {showText && (
        <span className="font-medium text-sm text-zinc-950">{copied ? copiedText : copyText}</span>
      )}
    </Button>
  );
}
