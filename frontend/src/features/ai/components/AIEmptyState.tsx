import React from 'react';
import { Sparkles } from 'lucide-react';

interface AIEmptyStateProps {
  title: string;
  description?: string;
}

const AIEmptyState: React.FC<AIEmptyStateProps> = ({ title, description }) => {
  return (
    <div className="flex flex-col items-center justify-center py-8 text-center gap-3 rounded-[8px] bg-neutral-100 dark:bg-[#333333]">
      <Sparkles size={40} className="text-neutral-400 dark:text-neutral-600" />
      <div className="flex flex-col items-center justify-center gap-1">
        <p className="text-sm font-medium text-zinc-950 dark:text-white">{title}</p>
        {description && (
          <p className="text-neutral-500 dark:text-neutral-400 text-xs max-w-md">{description}</p>
        )}
      </div>
    </div>
  );
};

export default AIEmptyState;
