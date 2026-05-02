import { KeyRound } from 'lucide-react';

export default function EnvVarsEmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      <div className="w-12 h-12 rounded-full bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center mb-4">
        <KeyRound className="w-6 h-6 text-neutral-400" />
      </div>
      <h3 className="text-lg font-medium text-zinc-950 dark:text-white mb-2">
        No environment variables yet
      </h3>
      <p className="text-sm text-neutral-500 dark:text-neutral-400 max-w-md">
        Add environment variables to configure your deployment. These will be available to your
        application at runtime.
      </p>
    </div>
  );
}
