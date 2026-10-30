import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Eye, EyeOff, Settings } from 'lucide-react';
import {
  Button,
  Input,
  MenuDialog,
  MenuDialogBody,
  MenuDialogCloseButton,
  MenuDialogContent,
  MenuDialogFooter,
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
import type { ModelGatewayCredentialStatus } from '@insforge/shared-schemas';
import {
  useModelGatewayConfig,
  useUpdateModelGatewayConfig,
} from '#features/ai/hooks/useModelGatewayConfig';

interface ModelGatewaySettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface CredentialFieldProps {
  id: string;
  label: string;
  description: string;
  status: ModelGatewayCredentialStatus;
  value: string;
  onChange: (value: string) => void;
  revealed: boolean;
  onToggleReveal: () => void;
}

function CredentialField({
  id,
  label,
  description,
  status,
  value,
  onChange,
  revealed,
  onToggleReveal,
}: CredentialFieldProps) {
  const { t } = useTranslation('chrome');

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <label htmlFor={id} className="text-sm font-medium leading-5 text-foreground">
            {label}
          </label>
          <p className="mt-0.5 text-[12px] leading-4 text-muted-foreground">{description}</p>
        </div>
        {!status.configured ? (
          <span className="shrink-0 rounded bg-[var(--alpha-8)] px-2 py-1 text-[11px] leading-4 text-muted-foreground">
            {t('ai.settings.notConfigured', { defaultValue: 'Not configured' })}
          </span>
        ) : null}
      </div>
      <div className="relative">
        <Input
          id={id}
          type={revealed ? 'text' : 'password'}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={
            status.maskedKey ??
            t('ai.settings.pasteKey', { defaultValue: 'Paste an OpenRouter key' })
          }
          autoComplete="off"
          className="pr-10 font-mono"
        />
        <button
          type="button"
          aria-label={
            revealed
              ? t('ai.settings.hideKey', { defaultValue: 'Hide key' })
              : t('ai.settings.showKey', { defaultValue: 'Show key' })
          }
          onClick={onToggleReveal}
          className="absolute right-2 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:bg-[var(--alpha-8)] hover:text-foreground"
        >
          {revealed ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </div>
      {status.configured ? (
        <p className="text-[11px] leading-4 text-muted-foreground">
          {t('ai.settings.replaceHint', {
            defaultValue: 'Leave blank to keep the current encrypted value.',
          })}
        </p>
      ) : null}
    </div>
  );
}

export function ModelGatewaySettingsDialog({
  open,
  onOpenChange,
}: ModelGatewaySettingsDialogProps) {
  const { t } = useTranslation('chrome');
  const { data: config, isLoading, isError } = useModelGatewayConfig(open);
  const updateConfig = useUpdateModelGatewayConfig();
  const [apiKey, setApiKey] = useState('');
  const [managementKey, setManagementKey] = useState('');
  const [revealedField, setRevealedField] = useState<'api' | 'management' | null>(null);

  useEffect(() => {
    if (!open) {
      setApiKey('');
      setManagementKey('');
      setRevealedField(null);
    }
  }, [open]);

  const normalizedApiKey = apiKey.trim();
  const normalizedManagementKey = managementKey.trim();
  const canSave =
    !!config &&
    !updateConfig.isPending &&
    (normalizedApiKey.length > 0 || normalizedManagementKey.length > 0);

  const handleSave = async () => {
    if (!config || !canSave) {
      return;
    }

    try {
      await updateConfig.mutateAsync({
        ...(normalizedApiKey ? { apiKey: normalizedApiKey } : {}),
        ...(normalizedManagementKey ? { managementKey: normalizedManagementKey } : {}),
      });
      onOpenChange(false);
    } catch {
      // Mutation hook owns error feedback.
    }
  };

  return (
    <MenuDialog open={open} onOpenChange={onOpenChange}>
      <MenuDialogContent>
        <MenuDialogSideNav>
          <MenuDialogSideNavHeader>
            <MenuDialogSideNavTitle>
              {t('ai.settings.title', { defaultValue: 'Model Gateway Settings' })}
            </MenuDialogSideNavTitle>
          </MenuDialogSideNavHeader>
          <MenuDialogNav>
            <MenuDialogNavList>
              <MenuDialogNavItem icon={<Settings className="size-5" />} active={true}>
                {t('ai.settings.credentials', { defaultValue: 'Credentials' })}
              </MenuDialogNavItem>
            </MenuDialogNavList>
          </MenuDialogNav>
        </MenuDialogSideNav>

        <MenuDialogMain>
          <MenuDialogHeader>
            <MenuDialogTitle>
              {t('ai.settings.credentials', { defaultValue: 'Credentials' })}
            </MenuDialogTitle>
            <MenuDialogCloseButton className="ml-auto" />
          </MenuDialogHeader>

          <MenuDialogBody>
            {isLoading ? (
              <div className="flex min-h-[200px] items-center justify-center text-sm text-muted-foreground">
                {t('ai.settings.loading', { defaultValue: 'Loading configuration...' })}
              </div>
            ) : isError || !config ? (
              <div className="flex min-h-[200px] items-center justify-center text-sm text-muted-foreground">
                {t('ai.settings.loadFailed', { defaultValue: 'Unable to load configuration.' })}
              </div>
            ) : (
              <div className="flex flex-col gap-6">
                <CredentialField
                  id="openrouter-api-key"
                  label={t('ai.settings.apiKey', { defaultValue: 'OpenRouter API key' })}
                  description={t('ai.settings.apiKeyDescription', {
                    defaultValue: 'Used for chat, image, embedding, and other model requests.',
                  })}
                  status={config.apiKey}
                  value={apiKey}
                  onChange={setApiKey}
                  revealed={revealedField === 'api'}
                  onToggleReveal={() =>
                    setRevealedField((current) => (current === 'api' ? null : 'api'))
                  }
                />
                <div className="h-px bg-[var(--alpha-8)]" />
                <CredentialField
                  id="openrouter-management-key"
                  label={t('ai.settings.managementKey', {
                    defaultValue: 'OpenRouter management API key',
                  })}
                  description={t('ai.settings.managementKeyDescription', {
                    defaultValue:
                      'Used only for 30-day activity analytics. It cannot make model requests.',
                  })}
                  status={config.managementKey}
                  value={managementKey}
                  onChange={setManagementKey}
                  revealed={revealedField === 'management'}
                  onToggleReveal={() =>
                    setRevealedField((current) => (current === 'management' ? null : 'management'))
                  }
                />
              </div>
            )}
          </MenuDialogBody>

          <MenuDialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              {t('ai.settings.cancel', { defaultValue: 'Cancel' })}
            </Button>
            <Button type="button" onClick={() => void handleSave()} disabled={!canSave}>
              {updateConfig.isPending
                ? t('ai.settings.saving', { defaultValue: 'Saving...' })
                : t('ai.settings.save', { defaultValue: 'Save' })}
            </Button>
          </MenuDialogFooter>
        </MenuDialogMain>
      </MenuDialogContent>
    </MenuDialog>
  );
}
