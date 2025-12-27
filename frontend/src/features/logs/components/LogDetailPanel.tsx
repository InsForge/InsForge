import { X } from 'lucide-react';
import type { LogSchema } from '@insforge/shared-schemas';

interface LogDetailPanelProps {
  log: LogSchema | null;
  onClose: () => void;
}

export function LogDetailPanel({ log, onClose }: LogDetailPanelProps) {
  if (!log) {
    return null;
  }

  // Format the log body as pretty JSON
  const formattedContent = JSON.stringify(log.body, null, 2);

  return (
    <div className="flex flex-col h-full bg-gray-100 dark:bg-neutral-700 border border-gray-300 dark:border-neutral-600 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-300 dark:border-neutral-600">
        <p className="text-sm text-gray-600 dark:text-neutral-300 font-normal leading-6">
          Log Content
        </p>
        <button
          onClick={onClose}
          className="p-1 hover:bg-gray-200 dark:hover:bg-neutral-600 rounded transition-colors"
          aria-label="Close panel"
        >
          <X className="w-4 h-4 text-gray-500 dark:text-neutral-400" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-3">
        <pre className="text-sm text-gray-900 dark:text-white font-normal leading-6 whitespace-pre-wrap break-all font-mono">
          {formattedContent}
        </pre>
      </div>
    </div>
  );
}
