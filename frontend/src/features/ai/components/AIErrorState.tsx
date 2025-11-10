import React from 'react';
import { AlertCircle } from 'lucide-react';

interface AIErrorStateProps {
  message: string;
}

const AIErrorState: React.FC<AIErrorStateProps> = ({ message }) => {
  return (
    <div className="flex flex-col items-center justify-center py-8 text-center gap-3 rounded-[8px] bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/30">
      <AlertCircle size={40} className="text-red-500 dark:text-red-400" />
      <div className="flex flex-col items-center justify-center gap-1">
        <p className="text-sm font-medium text-zinc-950 dark:text-white">Configuration Error</p>
        <p className="text-red-600 dark:text-red-400 text-xs max-w-md">{message}</p>
      </div>
    </div>
  );
};

export default AIErrorState;
