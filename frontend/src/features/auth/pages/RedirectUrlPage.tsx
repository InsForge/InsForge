import { useEffect, useState } from 'react';
import { Button, Input } from '@insforge/ui';
import { useAuthConfig } from '@/features/auth/hooks/useAuthConfig';

export default function RedirectUrlPage() {
  const { config, isLoading, isUpdating, updateConfig } = useAuthConfig();
  const [redirectUrl, setRedirectUrl] = useState('');
  const [isDirty, setIsDirty] = useState(false);

  useEffect(() => {
    if (config) {
      setRedirectUrl(config.signInRedirectTo ?? '');
      setIsDirty(false);
    }
  }, [config]);

  const handleSave = () => {
    updateConfig(
      {
        requireEmailVerification: config?.requireEmailVerification ?? false,
        passwordMinLength: config?.passwordMinLength ?? 6,
        requireNumber: config?.requireNumber ?? false,
        requireLowercase: config?.requireLowercase ?? false,
        requireUppercase: config?.requireUppercase ?? false,
        requireSpecialChar: config?.requireSpecialChar ?? false,
        verifyEmailMethod: config?.verifyEmailMethod ?? 'code',
        resetPasswordMethod: config?.resetPasswordMethod ?? 'code',
        signInRedirectTo: redirectUrl.trim() || null,
      },
      { onSuccess: () => setIsDirty(false) }
    );
  };

  if (isLoading) {
    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-surface">
        <div className="flex flex-1 items-center justify-center">
          <div className="text-sm text-muted-foreground">Loading configuration...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-surface">
      <div className="shrink-0 px-6 pb-6 pt-10 sm:px-10">
        <div className="mx-auto w-full max-w-[1024px]">
          <h1 className="text-2xl font-medium leading-8 text-foreground">Redirect URL</h1>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 sm:px-10">
        <div className="mx-auto w-full max-w-[1024px]">
          <div className="rounded-xl border border-border bg-card p-6">
            <div className="mb-4">
              <p className="text-sm font-medium text-foreground">Sign-in redirect URL</p>
              <p className="font-content mt-1 text-sm text-muted-foreground">
                URL to redirect users after a successful sign in. Leave empty to use the default
                behavior.
              </p>
            </div>
            <Input
              type="url"
              placeholder="https://yourapp.com/dashboard"
              value={redirectUrl}
              onChange={(e) => {
                setRedirectUrl(e.target.value);
                setIsDirty(true);
              }}
            />
            <div className="mt-4 flex justify-end">
              <Button
                onClick={handleSave}
                disabled={!isDirty || isUpdating}
              >
                {isUpdating ? 'Saving...' : 'Save changes'}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
