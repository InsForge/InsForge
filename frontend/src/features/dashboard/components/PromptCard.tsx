import { ChevronRight, LayoutGrid } from 'lucide-react';

interface PromptCardProps {
  title: string;
  onClick?: () => void;
}

export function PromptCard({ title, onClick }: PromptCardProps) {
  return (
    <button
      onClick={onClick}
      className="bg-card border border-border rounded px-6 py-4 flex items-center gap-3 hover:bg-bg-secondary hover:border-border-hover transition-all group"
    >
      <LayoutGrid className="w-6 h-6 text-text dark:text-secondary-emerald shrink-0" />
      <p className="flex-1 text-base  font-normal leading-6 text-left truncate">{title}</p>
      <ChevronRight className="w-5 h-5 text-text dark:text-dark-mode-icon shrink-0 group-hover:translate-x-0.5 transition-transform" />
    </button>
  );
}
