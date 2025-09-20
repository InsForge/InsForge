import React, { useState } from 'react';
import { MoreHorizontal, Copy, Check } from 'lucide-react';
import { Button } from '@/components/radix/Button';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/radix/Tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/radix/DropdownMenu';
import { Type, Image } from 'lucide-react';
import {
  generateAIIntegrationPrompt,
  formatTokenCount,
  getProviderDisplayName,
  getProviderLogo,
} from '../helpers';
import { AIConfigurationWithUsageSchema } from '@insforge/shared-schemas';

interface AIModelCardProps {
  config: AIConfigurationWithUsageSchema;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
}

export function AIModelCard({ config, onEdit, onDelete }: AIModelCardProps) {
  const [isCopied, setIsCopied] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // Extract provider info
  const companyId = config.modelId.split('/')[0];
  const providerName = getProviderDisplayName(companyId);
  const providerLogo = getProviderLogo(companyId);

  // Get model name from modelId
  const modelName = config.modelId.split('/')[1] || config.modelId;

  // Get modality icons
  const getModalityIcon = (modality: string) => {
    return modality === 'text' ? Type : Image;
  };

  // Get input/output modalities from model architecture (if available)
  // For now, we'll show both text and image as supported
  const inputModalities = ['text', 'image'];
  const outputModalities = ['text', 'image'];

  // Handle copy prompt
  const handleCopyPrompt = async () => {
    setIsLoading(true);
    try {
      const prompt = await generateAIIntegrationPrompt(config);
      await navigator.clipboard.writeText(prompt);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy prompt:', error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <TooltipProvider>
      <div className="relative py-5 px-4 bg-white dark:bg-[#333333] rounded-[8px] border border-neutral-200 dark:border-neutral-700 transition-all duration-200">
      {/* More button */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 p-1 hover:bg-gray-100 dark:hover:bg-neutral-700 absolute top-3 right-3"
          >
            <MoreHorizontal className="h-4 w-4 text-gray-500 dark:text-neutral-400" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => onEdit(config.id)}>Edit</DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => onDelete(config.id)}
            className="text-red-600 dark:text-red-400"
          >
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Header with logo */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          {/* Provider Logo */}
          <div className="w-10 h-10">
            {typeof providerLogo === 'string' ? (
              <div className="w-8 h-8 bg-gray-500 rounded flex items-center justify-center text-white text-sm font-bold">
                {providerLogo}
              </div>
            ) : (
              React.createElement(providerLogo, { className: 'w-10 h-10' })
            )}
          </div>

          {/* Model Info */}
          <div>
            <p
              className="font-medium text-sm text-zinc-950 dark:text-zinc-50 line-clamp-1 max-w-3/4"
              title={modelName}
            >
              {modelName}
            </p>
            <p className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
              {providerName}
            </p>
          </div>
        </div>
      </div>

      <div className="h-[1px] bg-neutral-200 dark:bg-neutral-700 my-3" />

      {/* Modality indicators */}
      <div className="flex flex-col gap-3 items-stretch mb-5">
        <div className="flex items-center justify-between">
          <span className="text-black dark:text-white">Input</span>
           <div className="flex items-center gap-2">
             {inputModalities.map((modality) => {
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
             {outputModalities.map((modality) => {
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

        <div className="flex items-center justify-between text-sm text-black dark:text-white">
          <span>Token Usage</span>
          <span>{config.usageStats ? formatTokenCount(config.usageStats.totalTokens) : '0'}</span>
        </div>

        <div className="flex items-center justify-between text-sm text-black dark:text-white">
          <span>Requests</span>
          <span>{config.usageStats?.totalRequests || 0}</span>
        </div>
      </div>

      {/* Copy Prompt Button */}
      <Button
        onClick={handleCopyPrompt}
        disabled={isLoading}
        className="w-full h-9 bg-emerald-300 hover:bg-emerald-400 text-black font-medium rounded-lg transition-colors duration-200"
      >
        {isLoading ? (
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            <span>Copying...</span>
          </div>
        ) : isCopied ? (
          <div className="flex items-center gap-2">
            <Check className="w-4 h-4" />
            <span>Copied!</span>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Copy className="w-4 h-4" />
            <span>Copy Prompt</span>
          </div>
        )}
      </Button>
      </div>
    </TooltipProvider>
  );
}
