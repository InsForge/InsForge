import { ChevronRight, LayoutGrid } from 'lucide-react';

interface PromptCardProps {
  title: string;
  onClick?: () => void;
}

export function PromptCard({ title, onClick }: PromptCardProps) {
  return (
    <button
      onClick={onClick}
      className="bg-white dark:bg-[#363636] border border-gray-200 dark:border-[#414141] rounded px-6 py-4 flex items-center gap-3 hover:bg-gray-50 hover:border-gray-300 dark:hover:bg-neutral-700 dark:hover:border-[#525252] transition-all group"
    >
      <LayoutGrid className="w-6 h-6 text-zinc-700 dark:text-emerald-400 shrink-0" />
      <p className="flex-1 text-base text-gray-900 dark:text-white font-normal leading-6 text-left truncate">
        {title}
      </p>
      <ChevronRight className="w-5 h-5 text-gray-400 dark:text-neutral-400 shrink-0 group-hover:translate-x-0.5 transition-transform" />
    </button>
  );
}
