import { useState } from 'react';
import { X } from 'lucide-react';

export function ConnectionSuccessBanner() {
  const [isVisible, setIsVisible] = useState(true);

  const handleClose = () => {
    setIsVisible(false);
  };

  if (!isVisible) {
    return null;
  }

  return (
    <div className="relative w-full bg-zinc-50 dark:bg-[#333333] border-l-3 border-neutral-600 dark:border-emerald-300 rounded-[8px] py-6 px-8">
      <div className="flex flex-col items-start gap-3">
        <p className="text-xl font-semibold text-zinc-950 dark:text-white">
          Connected successfully!
        </p>
        <p className="text-sm text-neutral-600 dark:text-neutral-100">
          InsForge is running in the background — now head to your coding agent and create real
          products.
        </p>
      </div>
      <button
        onClick={handleClose}
        className="flex-shrink-0 absolute right-6 top-0 bottom-0"
        aria-label="Close banner"
      >
        <X className="w-5 h-5 text-neutral-600 dark:text-neutral-400" />
      </button>
    </div>
  );
}
