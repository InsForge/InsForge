import type { MouseEvent, ReactNode } from 'react';
import { LockKeyhole, Mail, Users, Circle, ExternalLink } from 'lucide-react';
import { Handle, Position } from '@xyflow/react';
import { useNavigate } from 'react-router-dom';
import { OAuthProvidersSchema } from '@insforge/shared-schemas';
import { oauthProviders } from '@/features/auth/helpers';

interface AuthNodeProps {
  data: {
    providers: OAuthProvidersSchema[];
    userCount?: number;
    isReferenced?: boolean; // Whether any tables have foreign keys to users.id
  };
}

export function AuthNode({ data }: AuthNodeProps) {
  const navigate = useNavigate();
  const { providers, isReferenced = false } = data;
  const enabledProviders = oauthProviders.filter((provider) => providers.includes(provider.id));
  const authMethods: Array<{ id: string; name: string; icon?: ReactNode }> = [
    { id: 'email', name: 'Email / Password', icon: <Mail /> },
    ...enabledProviders,
  ];
  const enabledCount = authMethods.length;

  const handleOpenAuthUsers = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    void navigate('/dashboard/authentication/users');
  };

  return (
    <div className="min-w-[280px] rounded-lg border border-[var(--alpha-8)] bg-card shadow-[0px_4px_4px_rgba(0,0,0,0.08)]">
      {/* Auth Header */}
      <div className="flex items-center justify-between gap-2 border-b border-[var(--alpha-8)] p-2">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded bg-sky-700">
            <LockKeyhole className="h-5 w-5 text-white" />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-medium text-zinc-900 dark:text-white">Authentication</h3>
            <p className="text-[13px] leading-[18px] text-zinc-600 dark:text-zinc-400">
              {enabledCount} method{enabledCount !== 1 ? 's' : ''} enabled
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={handleOpenAuthUsers}
          onMouseDown={(event) => event.stopPropagation()}
          className="flex h-7 w-7 items-center justify-center rounded text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-white/5 dark:hover:text-zinc-200"
          aria-label="Open authentication settings"
        >
          <ExternalLink className="h-4 w-4" />
        </button>
      </div>

      {/* Auth Providers */}
      <div className="space-y-2 border-b border-[var(--alpha-8)] px-2 py-3">
        {authMethods.map((method) => {
          return (
            <div
              key={method.id}
              className="flex h-8 min-h-8 items-center justify-between rounded bg-zinc-100 px-1.5 dark:bg-white/[0.04]"
            >
              <div className="flex items-center gap-2 px-1">
                <div className="flex h-5 w-5 items-center justify-center text-zinc-700 dark:text-zinc-200 [&>svg]:h-4 [&>svg]:w-4">
                  {method.icon}
                </div>
                <span className="text-[13px] leading-[18px] text-zinc-800 dark:text-white">
                  {method.name}
                </span>
              </div>
              <div className="rounded bg-green-700 px-2 py-0.5">
                <span className="text-xs font-medium leading-4 text-white">Enabled</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Users Section */}
      <div className="relative flex items-center justify-between p-3">
        {/* Target handle for auth.id references - positioned at right bottom corner */}
        <Handle
          type="target"
          position={Position.Right}
          id="id-target"
          className="!w-3 !h-3 !opacity-0 !border-0 !pointer-events-none"
          style={{
            right: 16,
            bottom: 16,
            top: 'auto',
            transform: 'none',
            pointerEvents: 'none',
          }}
          isConnectable={false}
        />

        <div className="flex items-center gap-2.5">
          <Users className="h-5 w-5 text-zinc-700 dark:text-zinc-400" />
          <span className="text-sm text-zinc-700 dark:text-zinc-400">Users</span>
        </div>
        <div className="flex items-center">
          {isReferenced ? (
            <div className="relative flex h-5 w-5 items-center justify-center">
              <Circle
                className="h-5 w-5 fill-none stroke-current text-zinc-900 dark:text-white"
                strokeWidth={1.5}
              />
              <div className="absolute h-2 w-2 rounded-full bg-zinc-900 dark:bg-white" />
            </div>
          ) : (
            <Circle className="h-5 w-5 fill-zinc-100 stroke-current text-zinc-400 dark:fill-neutral-800 dark:text-neutral-700" />
          )}
        </div>
      </div>
    </div>
  );
}
