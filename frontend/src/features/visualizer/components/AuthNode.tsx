import { Lock, FormInput, Users, Circle } from 'lucide-react';
import { Handle, Position } from '@xyflow/react';
import { OAuthProvidersSchema } from '@insforge/shared-schemas';
import { cn } from '@/lib/utils/utils';
import { useOAuthConfig } from '@/features/auth/hooks/useOAuthConfig';
import { oauthProviders } from '@/features/auth/helpers';

interface AuthNodeProps {
  data: {
    providers: OAuthProvidersSchema[];
    userCount?: number;
    isReferenced?: boolean; // Whether any tables have foreign keys to users.id
  };
}

export function AuthNode({ data }: AuthNodeProps) {
  const { providers, userCount, isReferenced = false } = data;
  const { isProviderConfigured } = useOAuthConfig();

  const enabledCount = providers.length + 1;

  return (
    <div className="bg-white dark:bg-neutral-900 rounded-lg border border-gray-300 dark:border-[#363636] min-w-[280px] shadow-sm">
      {/* Auth Header */}
      <div className="flex items-center justify-between p-2 border-b border-gray-200 dark:border-neutral-800">
        <div className="flex items-center gap-2">
          <div className="flex items-center justify-center w-11 h-11 bg-lime-300 rounded p-1.5">
            <Lock className="w-5 h-5 text-neutral-900" />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-medium text-zinc-950 dark:text-white">Authentication</h3>
            <p className="text-xs text-zinc-600 dark:text-neutral-300">
              {enabledCount} provider{enabledCount !== 1 ? 's' : ''} enabled
            </p>
          </div>
        </div>
        {/* <div className="p-1.5">
          <ExternalLink className="w-4 h-4 text-neutral-400" />
        </div> */}
      </div>

      {/* Auth Providers */}
      <div className="p-2 space-y-2 border-b border-gray-200 dark:border-neutral-800">
        {/* Email/Password */}
        <div className="flex items-center justify-between p-2.5 bg-gray-100 dark:bg-neutral-800 rounded">
          <div className="flex items-center gap-2.5">
            <FormInput className="w-5 h-5 text-zinc-700 dark:text-neutral-300" />
            <span className="text-sm text-zinc-700 dark:text-neutral-300">Email/Password</span>
          </div>
          <div className="px-1.5 py-0.5 bg-lime-200 rounded flex items-center">
            <span className="text-xs font-medium text-lime-900">Enabled</span>
          </div>
        </div>

        {/* OAuth Providers */}
        {oauthProviders.map((provider) => {
          const isEnabled = isProviderConfigured(provider.id);
          return (
            <div
              key={provider.id}
              className="flex items-center justify-between p-2.5 bg-gray-100 dark:bg-neutral-800 rounded"
            >
              <div className="flex items-center gap-2.5">
                <div className="w-5 h-5 flex items-center justify-center [&>svg]:w-5 [&>svg]:h-5">
                  {provider.icon}
                </div>
                <span className="text-sm text-zinc-700 dark:text-neutral-300">{provider.name}</span>
              </div>
              <div
                className={cn(
                  'px-1.5 py-0.5 rounded flex items-center',
                  isEnabled
                    ? 'bg-lime-200 text-lime-900'
                    : 'bg-gray-200 dark:bg-neutral-700 text-gray-600 dark:text-neutral-300'
                )}
              >
                <span className="text-xs font-medium">{isEnabled ? 'Enabled' : 'Disabled'}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Users Section */}
      <div className="flex items-center justify-between p-3 border-t border-gray-300 dark:border-neutral-700 relative">
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
          <Users className="w-5 h-5 text-zinc-700 dark:text-neutral-300" />
          <span className="text-sm text-zinc-700 dark:text-neutral-300">Users</span>
          <span className="text-xs text-zinc-500 dark:text-neutral-400">{userCount ?? 0}</span>
        </div>
        <div className="flex items-center">
          {isReferenced ? (
            <div className="w-5 h-5 flex items-center justify-center relative">
              <Circle
                className="w-5 h-5 text-zinc-950 dark:text-white fill-none stroke-current"
                strokeWidth={1.5}
              />
              <div className="w-2 h-2 bg-zinc-950 dark:bg-white rounded-full absolute" />
            </div>
          ) : (
            <Circle className="w-5 h-5 text-gray-400 dark:text-neutral-700 fill-gray-100 dark:fill-neutral-800 stroke-current" />
          )}
        </div>
      </div>
    </div>
  );
}
