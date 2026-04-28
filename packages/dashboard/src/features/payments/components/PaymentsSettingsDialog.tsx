import { useState } from 'react';
import type { ReactNode } from 'react';
import { CheckCircle2, Eye, EyeOff, Loader2, Settings } from 'lucide-react';
import {
  Button,
  MenuDialog,
  MenuDialogBody,
  MenuDialogCloseButton,
  MenuDialogContent,
  MenuDialogHeader,
  MenuDialogMain,
  MenuDialogNav,
  MenuDialogNavItem,
  MenuDialogNavList,
  MenuDialogSideNav,
  MenuDialogSideNavHeader,
  MenuDialogSideNavTitle,
  MenuDialogTitle,
} from '@insforge/ui';
import { usePaymentsConfig } from '../hooks/usePaymentsConfig';
import type { StripeEnvironment, StripeKeyConfig } from '@insforge/shared-schemas';

const ENVIRONMENTS: StripeEnvironment[] = ['test', 'live'];

const KEY_PREFIX_BY_ENVIRONMENT: Record<StripeEnvironment, string> = {
  test: 'sk_test_',
  live: 'sk_live_',
};

interface PaymentsSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface SettingRowProps {
  label: string;
  description?: ReactNode;
  children: ReactNode;
}

function SettingRow({ label, description, children }: SettingRowProps) {
  return (
    <div className="flex w-full items-start gap-6">
      <div className="w-[240px] shrink-0">
        <div className="py-1.5">
          <p className="text-sm leading-5 text-foreground">{label}</p>
        </div>
        {description && (
          <div className="pt-1 pb-2 text-[13px] leading-[18px] text-muted-foreground">
            {description}
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function KeyStatusBadge({ config }: { config?: StripeKeyConfig }) {
  if (!config?.hasKey) {
    return (
      <span className="inline-flex items-center rounded-full border border-[var(--alpha-8)] bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
        Not configured
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/20 px-2 py-0.5 text-xs font-medium text-primary">
      <CheckCircle2 className="h-3 w-3" />
      Configured
    </span>
  );
}

interface EnvironmentKeySectionProps {
  environment: StripeEnvironment;
  config?: StripeKeyConfig;
  inputValue: string;
  showKey: boolean;
  error?: string;
  isBusy: boolean;
  onInputChange: (value: string) => void;
  onToggleShowKey: () => void;
  onSave: () => void;
  onRemove: () => void;
}

function EnvironmentKeySection({
  environment,
  config,
  inputValue,
  showKey,
  error,
  isBusy,
  onInputChange,
  onToggleShowKey,
  onSave,
  onRemove,
}: EnvironmentKeySectionProps) {
  const expectedPrefix = KEY_PREFIX_BY_ENVIRONMENT[environment];
  const environmentLabel = environment === 'test' ? 'Test mode' : 'Live mode';

  return (
    <SettingRow
      label={environmentLabel}
      description={
        <>
          Use a Stripe secret key that starts with{' '}
          <span className="font-mono text-foreground">{expectedPrefix}</span>.
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <KeyStatusBadge config={config} />
          {config?.maskedKey && (
            <span className="font-mono text-xs text-muted-foreground">{config.maskedKey}</span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <input
              type={showKey ? 'text' : 'password'}
              value={inputValue}
              onChange={(event) => onInputChange(event.target.value)}
              placeholder={`${expectedPrefix}...`}
              disabled={isBusy}
              className="h-9 w-full rounded border border-[var(--alpha-8)] bg-background px-3 pr-10 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
            />
            <button
              type="button"
              onClick={onToggleShowKey}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label={showKey ? 'Hide key' : 'Show key'}
              disabled={isBusy}
            >
              {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>

          <Button
            type="button"
            size="lg"
            onClick={onSave}
            disabled={isBusy || !inputValue.trim()}
            className="h-9 shrink-0"
          >
            {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Save
          </Button>
        </div>

        {error && <p className="text-xs text-destructive">{error}</p>}

        {config?.hasKey && (
          <div className="flex items-center justify-between gap-3 rounded border border-[var(--alpha-8)] bg-muted/40 p-3">
            <p className="text-xs leading-5 text-muted-foreground">
              Remove this Stripe key from InsForge's secret store.
            </p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onRemove}
              disabled={isBusy}
              className="shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              Remove
            </Button>
          </div>
        )}
      </div>
    </SettingRow>
  );
}

export function PaymentsSettingsDialog({ open, onOpenChange }: PaymentsSettingsDialogProps) {
  const { keys, isLoading, error, saveKey, removeKey } = usePaymentsConfig();
  const [keyInputs, setKeyInputs] = useState<Record<StripeEnvironment, string>>({
    test: '',
    live: '',
  });
  const [visibleKeys, setVisibleKeys] = useState<Record<StripeEnvironment, boolean>>({
    test: false,
    live: false,
  });
  const [errors, setErrors] = useState<Partial<Record<StripeEnvironment, string>>>({});

  const isBusy = saveKey.isPending || removeKey.isPending;
  const canClose = !isBusy;

  const handleOpenChange = (nextOpen: boolean) => {
    if (!canClose) {
      return;
    }

    if (!nextOpen) {
      setKeyInputs({ test: '', live: '' });
      setVisibleKeys({ test: false, live: false });
      setErrors({});
      saveKey.reset();
      removeKey.reset();
    }

    onOpenChange(nextOpen);
  };

  const handleSave = async (environment: StripeEnvironment) => {
    const secretKey = keyInputs[environment].trim();
    const expectedPrefix = KEY_PREFIX_BY_ENVIRONMENT[environment];

    if (!secretKey) {
      setErrors((current) => ({ ...current, [environment]: 'Please enter a Stripe secret key.' }));
      return;
    }

    if (!secretKey.startsWith(expectedPrefix)) {
      setErrors((current) => ({
        ...current,
        [environment]: `The ${environment} key must start with ${expectedPrefix}.`,
      }));
      return;
    }

    setErrors((current) => ({ ...current, [environment]: undefined }));

    try {
      await saveKey.mutateAsync({ environment, secretKey });
      setKeyInputs((current) => ({ ...current, [environment]: '' }));
    } catch (err) {
      setErrors((current) => ({
        ...current,
        [environment]: err instanceof Error ? err.message : 'Failed to save Stripe key.',
      }));
    }
  };

  const handleRemove = async (environment: StripeEnvironment) => {
    setErrors((current) => ({ ...current, [environment]: undefined }));

    try {
      await removeKey.mutateAsync(environment);
    } catch (err) {
      setErrors((current) => ({
        ...current,
        [environment]: err instanceof Error ? err.message : 'Failed to remove Stripe key.',
      }));
    }
  };

  return (
    <MenuDialog open={open} onOpenChange={handleOpenChange}>
      <MenuDialogContent>
        <MenuDialogSideNav>
          <MenuDialogSideNavHeader>
            <MenuDialogSideNavTitle>Payments Settings</MenuDialogSideNavTitle>
          </MenuDialogSideNavHeader>
          <MenuDialogNav>
            <MenuDialogNavList>
              <MenuDialogNavItem icon={<Settings className="h-5 w-5" />} active={true}>
                Stripe Keys
              </MenuDialogNavItem>
            </MenuDialogNavList>
          </MenuDialogNav>
        </MenuDialogSideNav>

        <MenuDialogMain>
          <MenuDialogHeader>
            <MenuDialogTitle>Stripe Keys</MenuDialogTitle>
            <MenuDialogCloseButton className="ml-auto" />
          </MenuDialogHeader>

          <MenuDialogBody>
            <div className="flex flex-col gap-6">
              <div>
                <p className="text-sm leading-6 text-muted-foreground">
                  Configure the Stripe secret keys InsForge uses to sync products and prices. The
                  test key is for implementation and validation; the live key is used only when you
                  intentionally sync production catalog data.
                </p>
              </div>

              {isLoading && !error ? (
                <div className="flex min-h-[120px] items-center justify-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading Stripe key configuration...
                </div>
              ) : error ? (
                <div className="rounded border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
                  Failed to load Stripe key configuration. Close the dialog and try again.
                </div>
              ) : (
                ENVIRONMENTS.map((environment) => (
                  <EnvironmentKeySection
                    key={environment}
                    environment={environment}
                    config={keys.find((key) => key.environment === environment)}
                    inputValue={keyInputs[environment]}
                    showKey={visibleKeys[environment]}
                    error={errors[environment]}
                    isBusy={isBusy}
                    onInputChange={(value) =>
                      setKeyInputs((current) => ({ ...current, [environment]: value }))
                    }
                    onToggleShowKey={() =>
                      setVisibleKeys((current) => ({
                        ...current,
                        [environment]: !current[environment],
                      }))
                    }
                    onSave={() => void handleSave(environment)}
                    onRemove={() => void handleRemove(environment)}
                  />
                ))
              )}
            </div>
          </MenuDialogBody>
        </MenuDialogMain>
      </MenuDialogContent>
    </MenuDialog>
  );
}
