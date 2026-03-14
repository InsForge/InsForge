import { useState } from 'react';
import { Trash2, Eye, EyeOff, Copy, Check } from 'lucide-react';
import { Button } from '@insforge/ui';
import { SecretSchema } from '@insforge/shared-schemas';
import { cn } from '@/lib/utils/utils';
import { formatDistance } from 'date-fns';
import { secretService } from '@/features/functions/services/secret.service';
import { useToast } from '@/lib/hooks/useToast';

interface SecretRowProps {
  secret: SecretSchema;
  onDelete: (secret: SecretSchema) => void;
  className?: string;
}

export function SecretRow({ secret, onDelete, className }: SecretRowProps) {
  const [isRevealed, setIsRevealed] = useState(false);
  const [realValue, setRealValue] = useState<string | null>(null);
  const [isLoadingValue, setIsLoadingValue] = useState(false);
  const [hasCopied, setHasCopied] = useState(false);
  const { showToast } = useToast();

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDelete(secret);
  };

  const toggleReveal = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isRevealed) {
      setIsRevealed(false);
      return;
    }

    if (realValue !== null) {
      setIsRevealed(true);
      return;
    }

    try {
      setIsLoadingValue(true);
      const data = await secretService.getSecret(secret.key);
      setRealValue(data.value);
      setIsRevealed(true);
    } catch (error) {
      console.error('Failed to fetch secret value:', error);
      showToast('Failed to fetch secret value', 'error');
    } finally {
      setIsLoadingValue(false);
    }
  };

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!realValue) return;

    try {
      await navigator.clipboard.writeText(realValue);
      setHasCopied(true);
      setTimeout(() => setHasCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy text: ', error);
      showToast('Failed to copy text', 'error');
    }
  };

  return (
    <div className={cn('group rounded border border-[var(--alpha-8)] bg-card', className)}>
      <div className="flex items-center pl-1.5 rounded hover:bg-[var(--alpha-8)] transition-colors">
        {/* Name Column */}
        <div className="flex-1 min-w-0 h-12 flex items-center px-2.5">
          <p className="text-sm text-foreground truncate" title={secret.key}>
            {secret.key}
          </p>
        </div>

        {/* Value Column */}
        <div className="flex-1 min-w-0 h-12 flex items-center gap-2 px-2.5">
          <div className="flex-1 min-w-0 flex items-center h-full">
            <span className="text-sm font-mono text-muted-foreground truncate">
              {isLoadingValue ? 'Loading...' : isRevealed ? realValue : '••••••••'}
            </span>
          </div>
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleReveal}
              disabled={isLoadingValue}
              className="size-7 p-1 text-muted-foreground hover:text-foreground hover:bg-[var(--alpha-8)]"
              title={isRevealed ? 'Hide value' : 'Show value'}
            >
              {isRevealed ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleCopy}
              disabled={!realValue}
              className={cn(
                "size-7 p-1 text-muted-foreground hover:text-foreground hover:bg-[var(--alpha-8)]",
                !realValue && "invisible" // Hide if we haven't fetched the value yet
              )}
              title="Copy value"
            >
              {hasCopied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
            </Button>
          </div>
        </div>

        {/* Updated at Column */}
        <div className="flex-1 min-w-0 h-12 flex items-center px-2.5">
          <span className="text-sm text-foreground truncate">
            {secret.updatedAt
              ? formatDistance(new Date(secret.updatedAt), new Date(), { addSuffix: true })
              : 'Never'}
          </span>
        </div>

        {/* Delete Button Column */}
        <div className="w-12 h-12 flex items-center justify-end px-2.5">
          {!secret.isReserved && (
            <Button
              variant="ghost"
              size="icon"
              onClick={handleDeleteClick}
              className="size-8 p-1.5 text-muted-foreground hover:text-foreground hover:bg-[var(--alpha-8)] opacity-0 group-hover:opacity-100 transition-opacity"
              title="Delete secret"
            >
              <Trash2 className="w-5 h-5" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
