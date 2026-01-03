import { Eye, EyeOff } from 'lucide-react';

interface ShowPasswordButtonProps {
  show: boolean;
  onToggle: () => void;
}

export function ShowPasswordButton({ show, onToggle }: ShowPasswordButtonProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex items-center gap-1 pl-1 pr-1.5 py-0.5 bg-gray-200 dark:bg-neutral-800 text-gray-500 dark:text-neutral-400 hover:bg-gray-300 dark:hover:bg-neutral-700 hover:text-gray-700 dark:hover:text-neutral-200 transition-colors text-xs font-medium rounded-md cursor-pointer"
      aria-pressed={show}
      aria-label={`${show ? 'Hide' : 'Show'} password`}
    >
      {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
      <span>{show ? 'Hide' : 'Show'} Password</span>
    </button>
  );
}
