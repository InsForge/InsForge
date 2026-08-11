import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@insforge/ui';
import { INGRESS_MODES } from '#features/compute/constants';
import { useComputeConfig, useUpdateComputeConfig } from '#features/compute/hooks/useComputeConfig';

/**
 * Operational settings for the Docker driver.
 *
 * Only the ones that take effect without a restart: these are read through
 * `dockerConfig()` on every launch, so a saved value applies to the next container.
 * The build-context ceiling is excluded because express captures it when the module
 * loads, and COMPUTE_BIND_ADDRESS because deciding whether a container port is
 * reachable from the internet belongs behind host access, not a dashboard session.
 *
 * Fields are seeded from what is in force, so an edit is a change to the current value
 * rather than a blank slate that would clear it.
 */
export function DockerSettingsForm() {
  const { t } = useTranslation('chrome');
  const { data: config, isLoading } = useComputeConfig();
  const update = useUpdateComputeConfig();

  const [defaultIngress, setDefaultIngress] = useState('none');
  const [publicHost, setPublicHost] = useState('');
  const [domain, setDomain] = useState('');
  const [socketPath, setSocketPath] = useState('');

  // Seeded once the current values arrive.
  useEffect(() => {
    if (!config) {
      return;
    }
    setDefaultIngress(config.settings.defaultIngress ?? 'none');
    setPublicHost(config.settings.publicHost ?? '');
    setDomain(config.settings.domain ?? '');
    setSocketPath(config.settings.socketPath ?? '');
  }, [config]);

  const dirty =
    config !== undefined &&
    (defaultIngress !== (config.settings.defaultIngress ?? 'none') ||
      publicHost !== (config.settings.publicHost ?? '') ||
      domain !== (config.settings.domain ?? '') ||
      socketPath !== (config.settings.socketPath ?? ''));

  const handleSave = async () => {
    await update.mutateAsync({
      defaultIngress: defaultIngress as 'none' | 'port' | 'host',
      // An empty host field is a real setting — "advertise no URL" — so it is sent as
      // an empty string. The socket has no such reading: there is no "no socket", so
      // blank means clear the override and use the environment again.
      publicHost,
      domain,
      socketPath: socketPath.trim() ? socketPath.trim() : null,
    });
  };

  if (isLoading) {
    return (
      <p className="text-sm leading-6 text-muted-foreground">
        {t('compute.settingsLoading', { defaultValue: 'Loading settings…' })}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Field
        htmlFor="docker-default-ingress"
        label={t('compute.settingDefaultIngress', { defaultValue: 'Default ingress' })}
        hint={t('compute.settingDefaultIngressHint', {
          defaultValue: 'Reachability for services that do not choose their own.',
        })}
      >
        <Select value={defaultIngress} onValueChange={setDefaultIngress}>
          <SelectTrigger id="docker-default-ingress" className="px-1.5">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {INGRESS_MODES.map((mode) => (
              <SelectItem key={mode.value} value={mode.value}>
                {t(`compute.ingressModes.${mode.value}`, { defaultValue: mode.label })}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Field
        htmlFor="docker-public-host"
        label={t('compute.settingPublicHost', { defaultValue: 'Public host' })}
        hint={t('compute.settingPublicHostHint', {
          defaultValue:
            'Address that published-port URLs are built from. Leave empty to advertise no URL rather than one that may not resolve.',
        })}
      >
        <Input
          id="docker-public-host"
          value={publicHost}
          onChange={(event) => setPublicHost(event.target.value)}
          placeholder="localhost"
          autoComplete="off"
          className="font-mono"
        />
      </Field>

      <Field
        htmlFor="docker-domain"
        label={t('compute.settingDomain', { defaultValue: 'Base domain' })}
        hint={t('compute.settingDomainHint', {
          defaultValue: 'Used to build hostnames for `host` ingress, routed by your own gateway.',
        })}
      >
        <Input
          id="docker-domain"
          value={domain}
          onChange={(event) => setDomain(event.target.value)}
          placeholder="apps.example.com"
          autoComplete="off"
          className="font-mono"
        />
      </Field>

      <Field
        htmlFor="docker-socket-path"
        label={t('compute.settingSocketPath', { defaultValue: 'Docker socket' })}
        hint={t('compute.settingSocketPathHint', {
          defaultValue:
            'For rootless Docker or Podman. Only takes effect if the socket is mounted there — the mount itself is a compose change.',
        })}
      >
        <Input
          id="docker-socket-path"
          value={socketPath}
          onChange={(event) => setSocketPath(event.target.value)}
          placeholder="/var/run/docker.sock"
          autoComplete="off"
          className="font-mono"
        />
      </Field>

      <div className="flex items-center justify-between gap-4">
        <p className="text-[11px] leading-4 text-muted-foreground">
          {t('compute.settingsApplyHint', {
            defaultValue: 'Applies to containers created from now on.',
          })}
        </p>
        <Button
          type="button"
          onClick={() => void handleSave()}
          disabled={!dirty || update.isPending}
        >
          {update.isPending
            ? t('compute.configSaving', { defaultValue: 'Saving…' })
            : t('compute.configSave', { defaultValue: 'Save' })}
        </Button>
      </div>
    </div>
  );
}

function Field({
  htmlFor,
  label,
  hint,
  children,
}: {
  htmlFor: string;
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2.5">
      <div>
        <label htmlFor={htmlFor} className="text-sm font-medium leading-5 text-foreground">
          {label}
        </label>
        <p className="mt-0.5 text-[12px] leading-4 text-muted-foreground">{hint}</p>
      </div>
      {children}
    </div>
  );
}
