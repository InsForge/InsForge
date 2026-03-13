import { useState } from 'react';
import { Trash2, Eye, EyeOff, Copy, Check } from 'lucide-react';
import { Button } from '@insforge/ui';
import { SecretSchema } from '@insforge/shared-schemas';
import { cn } from '@/lib/utils/utils';
import { formatDistance } from 'date-fns';
import { secretService } from '../services/secret.service';
import { useToast } from '@/lib/hooks/useToast';

interface SecretRowProps {
  secret: SecretSchema;
  onDelete: (secret: SecretSchema) => void;
  className?: string;
}

export function SecretRow({ secret, onDelete, className }: SecretRowProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [value, setValue] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const { showToast } = useToast();

  const handleToggleVisibility = async (e: React.MouseEvent) => {
    e.stopPropagation();

    if (!isVisible && value === null) {
      setIsLoading(true);
      try {
        const secretValue = await secretService.getSecretValue(secret.key);
        setValue(secretValue);
      } catch (error) {
        showToast('Failed to fetch secret value', 'error');
        console.error(error);
        return;
      } finally {
        setIsLoading(false);
      }
    }

    setIsVisible(!isVisible);
  };

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!value) {
      return;
    }

    try {
      await navigator.clipboard.writeText(value);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch (err) {
      showToast('Failed to copy to clipboard', 'error');
    }
  };

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDelete(secret);
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
        <div className="flex-1 min-w-0 h-12 flex items-center px-2.5 gap-2">
          <div className="flex-1 min-w-0 font-mono text-xs text-muted-foreground truncate">
            {isVisible ? (value ?? 'Loading...') : '••••••••••••••••'}
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={handleToggleVisibility}
              disabled={isLoading}
              className="size-7 p-1.5 text-muted-foreground hover:text-foreground hover:bg-[var(--alpha-8)]"
              title={isVisible ? 'Hide value' : 'Reveal value'}
            >
              {isLoading ? (
                <div className="size-3 animate-spin border-2 border-current border-t-transparent rounded-full" />
              ) : isVisible ? (
                <EyeOff className="size-4" />
              ) : (
                <Eye className="size-4" />
              )}
            </Button>
            {isVisible && value && (
              <Button
                variant="ghost"
                size="icon"
                onClick={handleCopy}
                className="size-7 p-1.5 text-muted-foreground hover:text-foreground hover:bg-[var(--alpha-8)]"
                title="Copy to clipboard"
              >
                {isCopied ? (
                  <Check className="size-4 text-emerald-500" />
                ) : (
                  <Copy className="size-4" />
                )}
              </Button>
            )}
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
