import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from '@/components';

import { MoreHorizontal, Pencil, Trash2, DollarSign } from 'lucide-react';
import {
  //   formatTokenCount,
  getModalityIcon,
  ModelOption,
} from '../helpers';
import { cn } from '@/lib/utils/utils';

interface AIModelCardProps {
  config: ModelOption;
  onEdit?: (id: string) => void;
  onDelete?: (id: string) => void;
  mode?: 'configured' | 'selectable';
  isSelected?: boolean;
  onSelect?: () => void;
  isDisabled?: boolean;
}

export function AIModelCard({
  config,
  onEdit,
  onDelete,
  mode = 'configured',
  isSelected = false,
  onSelect,
  isDisabled = false,
}: AIModelCardProps) {
  const isSelectableMode = mode === 'selectable';

  const handleCardClick = () => {
    if (isSelectableMode && !isDisabled && onSelect) {
      onSelect();
    }
  };

  return (
    <TooltipProvider>
      <div
        className={cn(
          'relative py-5 px-4 bg-white dark:bg-[#333333] rounded-[8px] transition-all duration-200',
          isSelectableMode && !isDisabled && 'cursor-pointer',
          isSelectableMode && isSelected
            ? 'border-2 border-zinc-700 dark:border-emerald-300'
            : 'border-2 border-neutral-200 dark:border-neutral-700',
          isSelectableMode &&
            !isDisabled &&
            !isSelected &&
            'hover:shadow-md hover:bg-neutral-100 dark:hover:bg-neutral-700',
          isDisabled && 'opacity-50 cursor-not-allowed'
        )}
        onClick={handleCardClick}
      >
        {/* Configured mode: More button */}
        {mode === 'configured' && onEdit && onDelete && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 p-1 hover:bg-neutral-200 dark:hover:bg-neutral-700 absolute top-3 right-3"
              >
                <MoreHorizontal className="h-4 w-4 text-neutral-500 dark:text-neutral-400" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                className="flex flex-row gap-3 px-3 py-2 cursor-pointer"
                onClick={() => onEdit(config.id)}
              >
                <Pencil className="w-4 h-4" /> System Prompt
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => onDelete(config.id)}
                className="text-red-600 dark:text-red-400 flex flex-row gap-3 px-3 py-2 cursor-pointer"
              >
                <Trash2 className="w-4 h-4" /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {/* Selectable mode: Added badge */}
        {isSelectableMode && isDisabled && (
          <div className="absolute top-3 right-3 px-2 py-1 text-xs font-medium text-neutral-500 dark:text-neutral-400 bg-neutral-100 dark:bg-neutral-800 rounded">
            Added
          </div>
        )}

        {/* Header with logo */}
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            {/* Provider Logo */}
            <Tooltip key={config.providerName}>
              <TooltipTrigger asChild>
                <div className="w-10 h-10">
                  {config.logo ? (
                    <config.logo className="w-10 h-10 dark:text-white" />
                  ) : (
                    <div className="w-10 h-10 bg-gray-500 rounded flex items-center justify-center text-white text-sm font-bold">
                      {config.providerName.charAt(0).toUpperCase()}
                    </div>
                  )}
                </div>
              </TooltipTrigger>
              <TooltipContent side="top" sideOffset={8}>
                <p className="capitalize">{config.providerName}</p>
              </TooltipContent>
            </Tooltip>

            {/* Model Info */}
            <p
              className="font-medium text-sm text-zinc-950 dark:text-zinc-50 max-h-10 line-clamp-2"
              title={config.modelName ? config.modelName : config.providerName}
            >
              {config.modelName ? config.modelName : config.providerName}
            </p>
            {(!isSelectableMode || (isSelectableMode && isDisabled)) && <div className="w-6" />}
          </div>
        </div>

        <div className="h-px bg-neutral-200 dark:bg-neutral-700 my-3" />

        {/* Modality indicators - use config modalities directly */}
        <div className="flex flex-col gap-3 items-stretch">
          <div className="flex items-center justify-between">
            <span className="text-black dark:text-white">Input</span>
            <div className="flex items-center gap-2">
              {config.inputModality.map((modality) => {
                const IconComponent = getModalityIcon(modality);
                return (
                  <Tooltip key={modality}>
                    <TooltipTrigger asChild>
                      <IconComponent className="w-5 h-5 text-neutral-500 hover:text-black dark:text-neutral-400 dark:hover:text-white transition-colors duration-200" />
                    </TooltipTrigger>
                    <TooltipContent side="top" sideOffset={8}>
                      <p className="capitalize">{modality}</p>
                    </TooltipContent>
                  </Tooltip>
                );
              })}
            </div>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-black dark:text-white">Output</span>
            <div className="flex items-center gap-2">
              {config.outputModality.map((modality) => {
                const IconComponent = getModalityIcon(modality);
                return (
                  <Tooltip key={modality}>
                    <TooltipTrigger asChild>
                      <IconComponent className="w-5 h-5 text-neutral-500 hover:text-black dark:text-neutral-400 dark:hover:text-white transition-colors duration-200" />
                    </TooltipTrigger>
                    <TooltipContent side="top" sideOffset={8}>
                      <p className="capitalize">{modality}</p>
                    </TooltipContent>
                  </Tooltip>
                );
              })}
            </div>
          </div>

          {isSelectableMode ? (
            <div className="flex items-center justify-between">
              <span className="text-black dark:text-white">Credit Usage</span>
              <div className="flex items-center">
                {typeof config.priceLevel === 'number' && config.priceLevel > 0 ? (
                  Array.from({ length: config.priceLevel }).map((_, i) => (
                    <div key={i} className="w-5 h-5 flex items-center justify-center">
                      <DollarSign className="w-4 h-4 text-neutral-500 dark:text-neutral-400" />
                    </div>
                  ))
                ) : (
                  <span className="text-sm text-neutral-500 dark:text-neutral-400">Free</span>
                )}
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between text-sm text-black dark:text-white">
              <span>Requests</span>
              <span>{config.usageStats?.totalRequests || 0}</span>
            </div>
          )}
        </div>
      </div>
    </TooltipProvider>
  );
}
