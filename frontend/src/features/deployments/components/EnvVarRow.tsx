import { useState } from 'react';
import { Eye, EyeOff, MoreVertical, Pencil, Trash2, Loader2 } from 'lucide-react';
import { Button } from '@/components/radix/Button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components';
import type { DeploymentEnvVar } from '@insforge/shared-schemas';
import { cn, formatTime } from '@/lib/utils/utils';
import { deploymentsService } from '../services/deployments.service';

interface EnvVarRowProps {
  envVar: DeploymentEnvVar;
  onEdit: (envVar: DeploymentEnvVar) => void;
  onDelete: (envVar: DeploymentEnvVar) => void;
  className?: string;
}

export function EnvVarRow({ envVar, onEdit, onDelete, className }: EnvVarRowProps) {
  const [isValueVisible, setIsValueVisible] = useState(false);
  const [fetchedValue, setFetchedValue] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleToggleValue = async () => {
    if (isValueVisible) {
      setIsValueVisible(false);
      return;
    }

    // If we already have the value cached, just show it
    if (fetchedValue !== null) {
      setIsValueVisible(true);
      return;
    }

    // Fetch the value from the API
    setIsLoading(true);
    setError(null);
    try {
      const data = await deploymentsService.getEnvVar(envVar.id);
      setFetchedValue(data.value);
      setIsValueVisible(true);
    } catch {
      setError('Failed to fetch value');
    } finally {
      setIsLoading(false);
    }
  };

  const handleEditClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onEdit(envVar);
  };

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDelete(envVar);
  };

  const maskedValue = '••••••••••••••';
  const displayValue = isValueVisible && fetchedValue !== null ? fetchedValue : maskedValue;

  const updatedAtText = envVar.updatedAt
    ? formatTime(new Date(envVar.updatedAt).toISOString())
    : 'N/A';

  return (
    <div
      className={cn(
        'group h-12 px-3 bg-white hover:bg-neutral-100 dark:bg-[#333333] dark:hover:bg-neutral-700 rounded-lg border border-neutral-200 dark:border-neutral-700 transition-all',
        className
      )}
    >
      <div className="grid grid-cols-12 h-full items-center">
        {/* Key Column */}
        <div className="col-span-4 min-w-0 px-3 py-1.5">
          <p className="text-sm text-zinc-950 dark:text-white truncate" title={envVar.key}>
            {envVar.key}
          </p>
        </div>

        {/* Value Column with Eye Toggle */}
        <div className="col-span-4 min-w-0 px-3 py-1.5 flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void handleToggleValue()}
            disabled={isLoading}
            className="h-6 w-6 p-1 text-neutral-500 dark:text-neutral-400 hover:text-black dark:hover:text-white hover:bg-neutral-200 dark:hover:bg-neutral-600 shrink-0"
            title={isValueVisible ? 'Hide value' : 'Show value'}
          >
            {isLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : isValueVisible ? (
              <EyeOff className="w-4 h-4" />
            ) : (
              <Eye className="w-4 h-4" />
            )}
          </Button>
          <span
            className={cn(
              'text-[13px] truncate',
              error
                ? 'text-red-500 dark:text-red-400'
                : isValueVisible && fetchedValue !== null
                  ? 'text-zinc-950 dark:text-white font-mono'
                  : 'text-neutral-400 dark:text-neutral-500'
            )}
            title={
              error
                ? error
                : isValueVisible && fetchedValue !== null
                  ? fetchedValue
                  : 'Click eye icon to reveal'
            }
          >
            {error || displayValue}
          </span>
        </div>

        {/* Updated At Column */}
        <div className="col-span-3 px-3 py-1.5">
          <span className="text-[13px] text-zinc-950 dark:text-white truncate">
            {updatedAtText}
          </span>
        </div>

        {/* Actions Column */}
        <div className="col-span-1 flex justify-end px-1.5 py-1.5">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-1.5 text-neutral-500 dark:text-neutral-400 hover:text-black dark:hover:text-white hover:bg-neutral-200 dark:hover:bg-neutral-600"
              >
                <MoreVertical className="w-5 h-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={handleEditClick}>
                <Pencil className="h-4 w-4 mr-2" />
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={handleDeleteClick}
                className="text-red-600 dark:text-red-400"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
}
