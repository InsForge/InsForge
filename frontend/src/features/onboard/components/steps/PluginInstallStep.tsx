import { useCallback } from 'react';
import VSCodeLogo from '@/assets/logos/vscode.svg?react';
import { cn } from '@/lib/utils/utils';

interface IDEOption {
  id: string;
  name: string;
  logo: React.ReactNode;
  installUrl: string;
}

const IDE_OPTIONS: IDEOption[] = [
  {
    id: 'vscode',
    name: 'VS Code',
    logo: <VSCodeLogo className="w-7 h-7" />,
    installUrl: 'vscode:extension/insforge.insforge',
  },
];

interface PluginInstallStepProps {
  showDescription?: boolean;
  cardClassName?: string;
  className?: string;
}

export function PluginInstallStep({
  showDescription,
  cardClassName,
  className,
}: PluginInstallStepProps) {
  const handleInstall = useCallback((ide: IDEOption) => {
    window.location.href = ide.installUrl;
  }, []);

  return (
    <div className={cn('flex flex-col gap-4', className)}>
      {showDescription && (
        <p className="dark:text-neutral-400 text-gray-500 text-sm leading-6">Select your IDE.</p>
      )}

      {/* IDE Grid */}
      <div className="grid grid-cols-4 gap-3">
        {IDE_OPTIONS.map((ide) => (
          <div
            key={ide.id}
            className={cn(
              'flex flex-col items-center gap-3 p-2 pt-3 dark:bg-[#262626] bg-neutral-200 rounded',
              cardClassName
            )}
          >
            {/* IDE Logo */}
            <div className="w-12 h-12 flex items-center justify-center">{ide.logo}</div>

            {/* IDE Name */}
            <span className="dark:text-white text-black text-sm font-medium leading-6">
              {ide.name}
            </span>

            {/* Install Button */}
            <button
              onClick={() => handleInstall(ide)}
              className="w-full h-8 px-3 rounded text-sm font-medium transition-colors dark:bg-neutral-700 bg-neutral-100 dark:text-white text-black hover:bg-white dark:hover:bg-neutral-600"
            >
              Install
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
