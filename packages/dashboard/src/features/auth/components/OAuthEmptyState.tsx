import { Lock } from 'lucide-react';

export function OAuthEmptyState() {
  return (
    <div className="text-center flex flex-col items-center justify-center gap-3 text-zinc-500 py-8 rounded-[8px] bg-neutral-100 dark:bg-[#333333]">
      <Lock className="mx-auto h-10 w-10 text-neutral-400 dark:text-neutral-600" />
      <div className="flex flex-col items-center justify-center gap-1">
        <p className="text-sm font-medium text-zinc-900 dark:text-white">No Authentications Yet</p>
        <p className="text-xs text-neutral-600 dark:text-neutral-400 font-medium">
          Add your first authentication to get started
        </p>
      </div>
    </div>
  );
}
