import { useState } from 'react';
import { ExternalLink, Copy, Check, Plus, Pencil, Globe, Trash2 } from 'lucide-react';
import { Button, Dialog, DialogContent, DialogDescription, DialogTitle, Input } from '@insforge/ui';
import { Skeleton } from '@/components';
import DiscordIcon from '@/assets/logos/discord.svg?react';
import { useDeployments } from '../hooks/useDeployments';
import { useDeploymentSlug } from '../hooks/useDeploymentSlug';
import { useDeploymentMetadata } from '../hooks/useDeploymentMetadata';
import { useToast } from '@/lib/hooks/useToast';
import { isInsForgeCloudProject } from '@/lib/utils/utils';
import { useVercelCredentials } from '../hooks/useVercelCredentials';

// Extract slug from custom domain URL (e.g., "https://my-slug.insforge.site" -> "my-slug")
function extractSlugFromUrl(url: string | null): string {
  if (!url) {
    return '';
  }
  const match = url.match(/^https?:\/\/([^.]+)\.insforge\.site$/);
  return match?.[1] ?? '';
}

export default function DeploymentDomainsPage() {
  const [copiedDefault, setCopiedDefault] = useState(false);
  const [copiedCustom, setCopiedCustom] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [customSlug, setCustomSlug] = useState('');
  const [isOwnDomainDialogOpen, setIsOwnDomainDialogOpen] = useState(false);

  const { deployments, isLoadingDeployments } = useDeployments();
  const { updateSlug, isUpdating } = useDeploymentSlug();
  const { customDomainUrl, isLoading: isLoadingMetadata, invalidate } = useDeploymentMetadata();
  const { showToast } = useToast();

  const isCloud = isInsForgeCloudProject();
  const { credentials, setCredentials, clearCredentials, isSaving, isClearing } =
    useVercelCredentials();
  const [credentialsForm, setCredentialsForm] = useState({ token: '', teamId: '', projectId: '' });

  const handleSaveCredentials = async () => {
    if (!credentialsForm.token.trim()) {
      showToast('Vercel Token is required', 'error');
      return;
    }
    try {
      await setCredentials(credentialsForm);
      setCredentialsForm({ token: '', teamId: '', projectId: '' });
    } catch {
      // Error is handled by useVercelCredentials mutation onError hook
    }
  };

  // Get the latest READY deployment (the current production deployment)
  const latestReadyDeployment = deployments.find((d) => d.status === 'READY') ?? null;

  const defaultDomain = latestReadyDeployment?.url ?? null;
  const deploymentUrl = defaultDomain
    ? defaultDomain.startsWith('http')
      ? defaultDomain
      : `https://${defaultDomain}`
    : null;

  // Extract the slug from the custom domain URL
  const savedCustomSlug = extractSlugFromUrl(customDomainUrl);

  const handleCopyDefaultDomain = async () => {
    if (!defaultDomain) {
      return;
    }
    try {
      await navigator.clipboard.writeText(defaultDomain);
      setCopiedDefault(true);
      setTimeout(() => setCopiedDefault(false), 2000);
    } catch {
      showToast('Failed to copy to clipboard', 'error');
    }
  };

  const handleCopyCustomDomain = async () => {
    if (!customDomainUrl) {
      return;
    }
    try {
      await navigator.clipboard.writeText(customDomainUrl);
      setCopiedCustom(true);
      setTimeout(() => setCopiedCustom(false), 2000);
    } catch {
      showToast('Failed to copy to clipboard', 'error');
    }
  };

  const handleVisitDefault = () => {
    if (deploymentUrl) {
      window.open(deploymentUrl, '_blank', 'noopener,noreferrer');
    }
  };

  const handleVisitCustom = () => {
    if (customDomainUrl) {
      window.open(customDomainUrl, '_blank', 'noopener,noreferrer');
    }
  };

  const handleStartEditing = () => {
    setCustomSlug(savedCustomSlug);
    setIsEditing(true);
  };

  const handleCancel = () => {
    setIsEditing(false);
    setCustomSlug('');
  };

  const handleSave = async () => {
    const trimmedSlug = customSlug.trim() || null;

    // Validate slug format
    if (trimmedSlug) {
      if (trimmedSlug.length < 3) {
        showToast('Slug must be at least 3 characters', 'error');
        return;
      }
      if (trimmedSlug.length > 63) {
        showToast('Slug must be at most 63 characters', 'error');
        return;
      }
      if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(trimmedSlug)) {
        showToast(
          'Slug must be lowercase alphanumeric with hyphens, not starting or ending with hyphen',
          'error'
        );
        return;
      }
    }

    try {
      await updateSlug(trimmedSlug);
      // Invalidate metadata cache so the new slug is fetched
      invalidate();
      setIsEditing(false);
    } catch {
      // Error handling is done in the hook
    }
  };

  if (isLoadingDeployments || isLoadingMetadata) {
    return (
      <div className="h-full flex flex-col overflow-hidden bg-[rgb(var(--semantic-1))]">
        <div className="flex-1 min-h-0 overflow-auto p-6">
          <div className="w-full max-w-[1080px] mx-auto flex flex-col gap-6">
            <h1 className="text-xl font-semibold text-zinc-950 dark:text-white tracking-[-0.1px]">
              Domains
            </h1>
            <Skeleton className="h-[80px] w-full rounded-lg" />
            <Skeleton className="h-[48px] w-full rounded-lg" />
            <Skeleton className="h-[48px] w-full rounded-lg" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden bg-[rgb(var(--semantic-1))]">
      <div className="flex-1 min-h-0 overflow-auto p-6">
        <div className="w-full max-w-[1080px] mx-auto flex flex-col gap-6">
          {/* Title */}
          <h1 className="text-xl font-semibold text-zinc-950 dark:text-white tracking-[-0.1px]">
            Domains
          </h1>

          {/* Description */}
          <p className="text-sm text-muted-foreground dark:text-neutral-400 leading-5">
            The default domain is automatically generated by the system. You can also define a
            custom domain for your project.
            <br />
            Both domains can be used to access your deployed application.
          </p>

          {/* Domain Rows */}
          <div className="flex flex-col gap-4">
            {/* Vercel Credentials Section (Non-Cloud only) */}
            {!isCloud && (
              <div className="bg-[#1c1c1c] dark:bg-[#181818] rounded-lg p-5 flex flex-col gap-4 border border-zinc-200 dark:border-zinc-800">
                <div className="flex flex-col gap-1">
                  <h2 className="text-sm font-semibold text-zinc-900 dark:text-white">
                    Vercel credentials
                  </h2>
                  <span className="text-xs text-zinc-500">
                    Source: {credentials?.source || 'none'} (
                    {credentials?.configured ? 'configured' : 'not configured'})
                  </span>
                </div>

                {credentials?.source !== 'none' && (
                  <div className="flex items-center gap-2 bg-zinc-100 dark:bg-[#222] border border-zinc-200 dark:border-zinc-800 p-2 rounded-lg">
                    <div className="flex-1 grid grid-cols-3 gap-2">
                      <Input
                        readOnly
                        value={credentials?.details.teamId ?? ''}
                        className="h-9 bg-white dark:bg-[#1a1a1a] border-zinc-300 dark:border-zinc-800 text-xs text-zinc-500 truncate cursor-text"
                      />
                      <Input
                        readOnly
                        value={credentials?.details.projectId ?? ''}
                        className="h-9 bg-white dark:bg-[#1a1a1a] border-zinc-300 dark:border-zinc-800 text-xs text-zinc-500 truncate cursor-text"
                      />
                      <Input
                        readOnly
                        value="••••••••••••"
                        className="h-9 bg-white dark:bg-[#1a1a1a] border-zinc-300 dark:border-zinc-800 text-xs text-zinc-500 truncate cursor-text"
                      />
                    </div>
                    {credentials?.source === 'custom' && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9 hover:bg-zinc-200 dark:hover:bg-zinc-800 text-zinc-500"
                        onClick={() => void clearCredentials()}
                        disabled={isClearing}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                )}

                <div className="grid grid-cols-3 gap-2">
                  <Input
                    placeholder="Vercel Team ID"
                    value={credentialsForm.teamId}
                    onChange={(e) =>
                      setCredentialsForm({ ...credentialsForm, teamId: e.target.value })
                    }
                    className="h-9 bg-white dark:bg-[#1c1c1c] border-zinc-300 dark:border-zinc-800 text-xs"
                  />
                  <Input
                    placeholder="Vercel Project ID"
                    value={credentialsForm.projectId}
                    onChange={(e) =>
                      setCredentialsForm({ ...credentialsForm, projectId: e.target.value })
                    }
                    className="h-9 bg-white dark:bg-[#1c1c1c] border-zinc-300 dark:border-zinc-800 text-xs"
                  />
                  <Input
                    placeholder="Vercel Token"
                    type="password"
                    value={credentialsForm.token}
                    onChange={(e) =>
                      setCredentialsForm({ ...credentialsForm, token: e.target.value })
                    }
                    className="h-9 bg-white dark:bg-[#1c1c1c] border-zinc-300 dark:border-zinc-800 text-xs"
                  />
                </div>

                <div className="flex items-center justify-between text-zinc-500 text-[11px] leading-relaxed">
                  <div className="flex flex-col gap-0.5 max-w-[70%]">
                    <span>
                      In InsForge Cloud, deployments use cloud-managed credentials.
                      Self-hosted/local can deploy with custom credentials stored here.
                    </span>
                    <span className="text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1 mt-0.5">
                      💡 Project ID and Team ID are optional for new projects (Vercel will create
                      them automatically).
                    </span>
                  </div>
                  <Button
                    onClick={() => void handleSaveCredentials()}
                    disabled={isSaving}
                    className="bg-emerald-600 hover:bg-emerald-500 text-white h-8 px-4 rounded text-xs ml-4 font-medium"
                  >
                    {isSaving ? 'Saving...' : 'Save'}
                  </Button>
                </div>
              </div>
            )}

            {/* Default Domain Row */}
            <div className="bg-white dark:bg-[#333] rounded-lg h-12 flex items-center px-3">
              <div className="flex items-center gap-6">
                <span className="text-sm text-muted-foreground dark:text-neutral-400 w-[120px]">
                  Default Domain
                </span>
                {defaultDomain ? (
                  <div className="flex items-center gap-1">
                    <a
                      href={deploymentUrl ?? '#'}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[13px] text-zinc-950 dark:text-white underline hover:text-blue-600 dark:hover:text-blue-400"
                    >
                      {defaultDomain}
                    </a>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void handleCopyDefaultDomain()}
                      className="h-9 ml-2 px-3 gap-1 text-zinc-950 dark:text-white hover:bg-neutral-200 dark:hover:bg-neutral-700"
                    >
                      {copiedDefault ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                      <span className="text-[13px]">{copiedDefault ? 'Copied' : 'Copy'}</span>
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleVisitDefault}
                      className="h-9 px-3 gap-1 text-zinc-950 dark:text-white hover:bg-neutral-200 dark:hover:bg-neutral-700"
                    >
                      <ExternalLink className="w-3 h-3" />
                      <span className="text-[13px]">Visit</span>
                    </Button>
                  </div>
                ) : (
                  <span className="text-[13px] text-muted-foreground dark:text-neutral-500">
                    No deployment yet
                  </span>
                )}
              </div>
            </div>

            {/* Custom Domain Row */}
            <div className="bg-white dark:bg-[#333] rounded-lg h-12 flex items-center justify-between pl-3 pr-2">
              <div className="flex items-center gap-6">
                <span className="text-sm text-muted-foreground dark:text-neutral-400 w-[120px]">
                  Custom Domain
                </span>
                {isEditing ? (
                  <div className="flex items-center gap-1">
                    <span className="text-[13px] text-zinc-950 dark:text-white">https://</span>
                    <Input
                      value={customSlug}
                      onChange={(e) => setCustomSlug(e.target.value)}
                      placeholder=""
                      className="h-8 w-[200px]"
                    />
                    <span className="text-[13px] text-zinc-950 dark:text-white">
                      .insforge.site
                    </span>
                  </div>
                ) : savedCustomSlug ? (
                  <div className="flex items-center gap-1">
                    <a
                      href={customDomainUrl ?? '#'}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[13px] text-zinc-950 dark:text-white underline hover:text-blue-600 dark:hover:text-blue-400"
                    >
                      {customDomainUrl}
                    </a>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void handleCopyCustomDomain()}
                      className="h-9 ml-2 px-3 gap-1 text-zinc-950 dark:text-white hover:bg-neutral-200 dark:hover:bg-neutral-700"
                    >
                      {copiedCustom ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                      <span className="text-[13px]">{copiedCustom ? 'Copied' : 'Copy'}</span>
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleVisitCustom}
                      className="h-9 px-3 gap-1 text-zinc-950 dark:text-white hover:bg-neutral-200 dark:hover:bg-neutral-700"
                    >
                      <ExternalLink className="w-3 h-3" />
                      <span className="text-[13px]">Visit</span>
                    </Button>
                  </div>
                ) : null}
              </div>

              {isEditing ? (
                <div className="flex items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={handleCancel}
                    disabled={isUpdating}
                    className="h-9 w-20 bg-neutral-200 dark:bg-neutral-600 hover:bg-neutral-300 dark:hover:bg-neutral-500 text-zinc-950 dark:text-white"
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => void handleSave()}
                    disabled={!customSlug.trim() || isUpdating}
                    className="h-9 w-20 bg-zinc-950 text-white hover:bg-zinc-800 disabled:opacity-40 dark:bg-emerald-300 dark:text-zinc-950 dark:hover:bg-emerald-400"
                  >
                    {isUpdating ? 'Saving...' : 'Save'}
                  </Button>
                </div>
              ) : savedCustomSlug ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleStartEditing}
                  className="h-9 px-3 gap-1.5 bg-neutral-200 dark:bg-neutral-600 hover:bg-neutral-300 dark:hover:bg-neutral-500 text-zinc-950 dark:text-white"
                >
                  <Pencil className="w-4 h-4" />
                  <span className="text-sm font-medium">Edit</span>
                </Button>
              ) : (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleStartEditing}
                  className="h-9 px-3 gap-1.5 bg-neutral-200 dark:bg-neutral-600 hover:bg-neutral-300 dark:hover:bg-neutral-500 text-zinc-950 dark:text-white"
                >
                  <Plus className="w-4 h-4" />
                  <span className="text-sm font-medium">Create</span>
                </Button>
              )}
            </div>
          </div>

          {/* Add Your Own Domain */}
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setIsOwnDomainDialogOpen(true)}
            className="w-fit h-9 px-3 gap-1.5 bg-neutral-200 dark:bg-neutral-600 hover:bg-neutral-300 dark:hover:bg-neutral-500 text-zinc-950 dark:text-white"
          >
            <Globe className="w-4 h-4" />
            <span className="text-sm font-medium">Add your own domain</span>
          </Button>

          {/* Own Domain Dialog */}
          <Dialog open={isOwnDomainDialogOpen} onOpenChange={setIsOwnDomainDialogOpen}>
            <DialogContent>
              {/* Header */}
              <div className="flex items-center justify-between px-6 py-3 border-b border-neutral-200 dark:border-neutral-700">
                <DialogTitle className="text-lg font-semibold text-zinc-950 dark:text-white leading-7">
                  Add your own domain
                </DialogTitle>
              </div>
              <DialogDescription className="sr-only">
                Add a custom domain to your deployment
              </DialogDescription>

              {/* Body */}
              <div className="flex flex-col gap-4 p-6">
                <p className="text-sm text-neutral-600 dark:text-neutral-300 leading-relaxed">
                  Support for bringing your own domain is currently under development. In the
                  meantime, our team can help you set it up — just reach out on our{' '}
                  <a
                    href="https://discord.gg/DvBtaEc9Jz"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 align-middle"
                  >
                    <DiscordIcon className="w-4 h-4 text-indigo-500 dark:text-indigo-400" />
                    <span className="text-indigo-500 dark:text-indigo-400 font-medium">
                      Discord
                    </span>
                  </a>
                </p>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>
    </div>
  );
}
