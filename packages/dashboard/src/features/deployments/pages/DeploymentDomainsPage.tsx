import { useRef, useState } from 'react';
import {
  ExternalLink,
  Copy,
  Check,
  Plus,
  Pencil,
  Globe,
  Trash2,
  RefreshCw,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { Button, Dialog, DialogContent, DialogDescription, DialogTitle, Input } from '@insforge/ui';
import { Skeleton } from '#components';
import { useDeployments } from '#features/deployments/hooks/useDeployments';
import { useDeploymentSlug } from '#features/deployments/hooks/useDeploymentSlug';
import { useDeploymentMetadata } from '#features/deployments/hooks/useDeploymentMetadata';
import { useCustomDomains } from '#features/deployments/hooks/useCustomDomains';
import { useToast } from '#lib/hooks/useToast';
import type { CustomDomain } from '#features/deployments/services/deployments.service';

/**
 * Extracts the slug portion from a custom insforge.site domain URL.
 * e.g. "https://my-slug.insforge.site" -> "my-slug"
 */
function extractSlugFromUrl(url: string | null): string {
  if (!url) {
    return '';
  }
  const match = url.match(/^https?:\/\/([^.]+)\.insforge\.site$/);
  return match?.[1] ?? '';
}

/**
 * Displays a colored badge indicating the verification status of a custom domain.
 */
function StatusBadge({ verified, misconfigured }: { verified: boolean; misconfigured: boolean }) {
  const tone = misconfigured
    ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
    : verified
      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
      : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400';

  const label = misconfigured
    ? 'Invalid configuration'
    : verified
      ? 'Verified'
      : 'Pending verification';

  return <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${tone}`}>{label}</span>;
}

/**
 * Small inline copy button used in DNS record tables.
 */
function CopyIconButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Keep this non-blocking inside the table UI.
    }
  };

  return (
    <button
      type="button"
      onClick={() => void handleCopy()}
      aria-label={`Copy ${label}`}
      title={`Copy ${label}`}
      className="inline-flex items-center justify-center rounded p-1 text-neutral-500 transition hover:bg-neutral-200 hover:text-zinc-950 dark:text-neutral-400 dark:hover:bg-neutral-700 dark:hover:text-white"
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

type DnsRecordRow = {
  type: string;
  name: string;
  value: string;
};

function getSubdomainLabel(domain: string, apexDomain: string): string {
  if (domain === apexDomain) {
    return '@';
  }

  const suffix = `.${apexDomain}`;
  return domain.endsWith(suffix) ? domain.slice(0, -suffix.length) : domain;
}

/**
 * Vercel-style table layout for DNS records.
 */
function RecordsTable({ rows }: { rows: DnsRecordRow[] }) {
  return (
    <div className="overflow-hidden rounded-xl border border-neutral-200 dark:border-neutral-700">
      <table className="w-full border-collapse text-left text-xs">
        <thead className="bg-neutral-50 dark:bg-neutral-800/80">
          <tr className="text-muted-foreground dark:text-neutral-400">
            <th className="px-4 py-3 font-medium">Type</th>
            <th className="px-4 py-3 font-medium">Name</th>
            <th className="px-4 py-3 font-medium">Value</th>
          </tr>
        </thead>
        <tbody className="bg-white dark:bg-[#2f2f2f]">
          {rows.map((row) => (
            <tr
              key={`${row.type}:${row.name}:${row.value}`}
              className="border-t border-neutral-200 text-zinc-950 dark:border-neutral-700 dark:text-white"
            >
              <td className="px-4 py-3 align-top font-medium">{row.type}</td>
              <td className="px-4 py-3 align-top">
                <div className="flex items-center gap-2">
                  <span className="font-mono">{row.name}</span>
                  <CopyIconButton value={row.name} label={`${row.type} record name`} />
                </div>
              </td>
              <td className="px-4 py-3 align-top">
                <div className="flex items-start gap-2">
                  <span className="font-mono break-all">{row.value}</span>
                  <CopyIconButton value={row.value} label={`${row.type} record value`} />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Renders the DNS records returned by Vercel for a domain that is not yet verified.
 */
function VerificationChallenges({ domain }: { domain: CustomDomain }) {
  const isApexDomain = domain.domain === domain.apexDomain;
  const rows: DnsRecordRow[] = [];

  if (!isApexDomain && domain.cnameTarget) {
    rows.push({
      type: 'CNAME',
      name: getSubdomainLabel(domain.domain, domain.apexDomain),
      value: domain.cnameTarget,
    });
  }

  if (isApexDomain && domain.aRecordValue) {
    rows.push({
      type: 'A',
      name: '@',
      value: domain.aRecordValue,
    });
  }

  rows.push(
    ...domain.verification.map((record) => ({
      type: record.type,
      name: record.domain,
      value: record.value,
    }))
  );

  return (
    <div className="mt-3 text-xs space-y-3">
      <p className="text-muted-foreground dark:text-neutral-400 font-medium">
        {domain.misconfigured
          ? 'Update the following DNS records with your domain provider, then click '
          : 'Add the following DNS records with your domain provider, then click '}
        <span className="font-semibold">Verify</span>.
      </p>

      {rows.length > 0 ? (
        <RecordsTable rows={rows} />
      ) : (
        <p className="text-muted-foreground dark:text-neutral-400">
          Vercel has not returned any DNS records for this domain yet.
        </p>
      )}

      <p className="text-muted-foreground dark:text-neutral-400">
        DNS changes can take time to propagate before verification succeeds.
      </p>
    </div>
  );
}

/**
 * A single row in the custom domains list showing the domain name, status badge,
 * and action buttons (Verify, Visit, Remove). Expands to show DNS instructions
 * when the domain is not yet verified.
 */
function CustomDomainRow({
  domain,
  onVerify,
  onRemove,
  isVerifying,
  isRemoving,
}: {
  domain: CustomDomain;
  onVerify: (d: string) => void;
  onRemove: (d: string) => void;
  isVerifying: boolean;
  isRemoving: boolean;
}) {
  const isReady = domain.verified && !domain.misconfigured;
  const [showVerification, setShowVerification] = useState(!isReady);
  const customDomainUrl = `https://${domain.domain}`;

  return (
    <div className="bg-white dark:bg-[#333] rounded-lg px-3 py-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 flex-wrap">
          {isReady ? (
            <a
              href={customDomainUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[13px] font-medium text-zinc-950 dark:text-white underline hover:text-blue-600 dark:hover:text-blue-400"
            >
              {customDomainUrl}
            </a>
          ) : (
            <span className="text-[13px] font-medium text-zinc-950 dark:text-white">
              {customDomainUrl}
            </span>
          )}
          <StatusBadge verified={domain.verified} misconfigured={domain.misconfigured} />
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {!isReady && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowVerification((v) => !v)}
              className="h-8 px-2 gap-1 text-zinc-950 dark:text-white hover:bg-neutral-200 dark:hover:bg-neutral-700"
            >
              {showVerification ? (
                <ChevronUp className="w-3.5 h-3.5" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5" />
              )}
              <span className="text-xs">Records</span>
            </Button>
          )}
          {!isReady && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => onVerify(domain.domain)}
              disabled={isVerifying}
              className="h-8 px-3 gap-1 text-xs bg-neutral-200 dark:bg-neutral-600 hover:bg-neutral-300 dark:hover:bg-neutral-500 text-zinc-950 dark:text-white"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isVerifying ? 'animate-spin' : ''}`} />
              {isVerifying ? 'Verifying...' : 'Verify'}
            </Button>
          )}
          {isReady && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => window.open(customDomainUrl, '_blank', 'noopener,noreferrer')}
              className="h-8 px-2 gap-1 text-zinc-950 dark:text-white hover:bg-neutral-200 dark:hover:bg-neutral-700"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span className="text-xs">Visit</span>
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onRemove(domain.domain)}
            disabled={isRemoving}
            aria-label={`Remove ${domain.domain}`}
            className="h-8 px-2 text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      {showVerification && !isReady && <VerificationChallenges domain={domain} />}
    </div>
  );
}

/**
 * Page for managing deployment domains.
 * Shows the auto-generated default domain, the insforge.site custom slug,
 * and user-owned custom domains with full DNS verification workflow.
 */
export default function DeploymentDomainsPage() {
  const [copiedDefault, setCopiedDefault] = useState(false);
  const [copiedCustom, setCopiedCustom] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [customSlug, setCustomSlug] = useState('');
  const [isAddDomainOpen, setIsAddDomainOpen] = useState(false);
  const [newDomain, setNewDomain] = useState('');
  const [domainError, setDomainError] = useState('');
  const isSubmittingAddDomainRef = useRef(false);

  const { deployments, isLoadingDeployments } = useDeployments();
  const { updateSlug, isUpdating } = useDeploymentSlug();
  const { customDomainUrl, isLoading: isLoadingMetadata, invalidate } = useDeploymentMetadata();
  const {
    domains,
    isLoading: isLoadingDomains,
    isError: isDomainsError,
    error: domainsError,
    refetchDomains,
    addDomain,
    isAdding,
    verifyDomain,
    isVerifying,
    verifyingDomain,
    removeDomain,
    isRemoving,
    removingDomain,
  } = useCustomDomains();
  const { showToast } = useToast();
  const RESERVED_HOSTED_DOMAIN_SUFFIX = '.insforge.site';

  const latestReadyDeployment = deployments.find((d) => d.status === 'READY') ?? null;
  const defaultDomain = latestReadyDeployment?.url ?? null;
  const deploymentUrl = defaultDomain
    ? defaultDomain.startsWith('http')
      ? defaultDomain
      : `https://${defaultDomain}`
    : null;

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
      invalidate();
      setIsEditing(false);
    } catch {
      // Error handling is done in the hook
    }
  };

  const DOMAIN_REGEX = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;

  const handleAddDomain = async () => {
    if (isAdding || isSubmittingAddDomainRef.current) {
      return;
    }

    const trimmed = newDomain.trim().toLowerCase();
    if (!trimmed) {
      return;
    }
    if (!DOMAIN_REGEX.test(trimmed)) {
      setDomainError('Invalid domain format (e.g. myapp.com or www.myapp.com)');
      return;
    }
    if (trimmed.endsWith(RESERVED_HOSTED_DOMAIN_SUFFIX)) {
      setDomainError('Domains ending with .insforge.site are reserved by InsForge');
      return;
    }
    setDomainError('');
    try {
      isSubmittingAddDomainRef.current = true;
      await addDomain(trimmed);
      setNewDomain('');
      setIsAddDomainOpen(false);
    } catch {
      // Error handling is done in the hook
    } finally {
      isSubmittingAddDomainRef.current = false;
    }
  };

  if (isLoadingDeployments || isLoadingMetadata || isLoadingDomains) {
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
                      onClick={() =>
                        deploymentUrl && window.open(deploymentUrl, '_blank', 'noopener,noreferrer')
                      }
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

            {/* Custom Slug Row */}
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
                      onClick={() =>
                        customDomainUrl &&
                        window.open(customDomainUrl, '_blank', 'noopener,noreferrer')
                      }
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

          {/* Custom (user-owned) Domains Section */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-zinc-950 dark:text-white">
                Your own domains
              </h2>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setIsAddDomainOpen(true)}
                className="h-9 px-3 gap-1.5 bg-neutral-200 dark:bg-neutral-600 hover:bg-neutral-300 dark:hover:bg-neutral-500 text-zinc-950 dark:text-white"
              >
                <Globe className="w-4 h-4" />
                <span className="text-sm font-medium">Add domain</span>
              </Button>
            </div>

            {isDomainsError ? (
              <div className="bg-white dark:bg-[#333] rounded-lg px-4 py-6 flex flex-col items-center gap-2 text-center">
                <p className="text-sm text-red-500">
                  {domainsError instanceof Error
                    ? domainsError.message
                    : 'Failed to load custom domains.'}
                </p>
                <Button variant="outline" size="sm" onClick={() => void refetchDomains()}>
                  Retry
                </Button>
              </div>
            ) : domains.length === 0 ? (
              <div className="bg-white dark:bg-[#333] rounded-lg px-4 py-6 flex flex-col items-center gap-2 text-center">
                <Globe className="w-8 h-8 text-muted-foreground dark:text-neutral-500" />
                <p className="text-sm text-muted-foreground dark:text-neutral-400">
                  No custom domains yet. Add your own domain to get started.
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {domains.map((d) => (
                  <CustomDomainRow
                    key={d.domain}
                    domain={d}
                    onVerify={(name) => void verifyDomain(name)}
                    onRemove={(name) => void removeDomain(name)}
                    isVerifying={isVerifying && verifyingDomain === d.domain}
                    isRemoving={isRemoving && removingDomain === d.domain}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Add Domain Dialog */}
          <Dialog
            open={isAddDomainOpen}
            onOpenChange={(open) => {
              setIsAddDomainOpen(open);
              if (!open) {
                setNewDomain('');
                setDomainError('');
              }
            }}
          >
            <DialogContent>
              <div className="flex items-center justify-between px-6 py-3 border-b border-neutral-200 dark:border-neutral-700">
                <DialogTitle className="text-lg font-semibold text-zinc-950 dark:text-white leading-7">
                  Add your own domain
                </DialogTitle>
              </div>
              <DialogDescription className="sr-only">
                Add a custom domain to your deployment
              </DialogDescription>

              <div className="flex flex-col gap-4 p-6">
                <p className="text-sm text-neutral-600 dark:text-neutral-300 leading-relaxed">
                  Enter the domain you own (e.g.{' '}
                  <span className="font-mono text-zinc-950 dark:text-white">myapp.com</span> or{' '}
                  <span className="font-mono text-zinc-950 dark:text-white">www.myapp.com</span>).
                  You will receive DNS configuration instructions after adding it.
                </p>

                <Input
                  value={newDomain}
                  onChange={(e) => {
                    setNewDomain(e.target.value);
                    setDomainError('');
                  }}
                  placeholder="myapp.com"
                  onKeyDown={(e) => {
                    if (
                      e.key === 'Enter' &&
                      newDomain.trim() &&
                      !isSubmittingAddDomainRef.current
                    ) {
                      void handleAddDomain();
                    }
                  }}
                  autoFocus
                />
                {domainError && <p className="text-xs text-red-500">{domainError}</p>}

                <div className="flex justify-end gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setIsAddDomainOpen(false);
                      setNewDomain('');
                      setDomainError('');
                    }}
                    disabled={isAdding}
                    className="h-9 px-4 bg-neutral-200 dark:bg-neutral-600 hover:bg-neutral-300 dark:hover:bg-neutral-500 text-zinc-950 dark:text-white"
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => void handleAddDomain()}
                    disabled={!newDomain.trim() || !!domainError || isAdding}
                    className="h-9 px-4 bg-zinc-950 text-white hover:bg-zinc-800 disabled:opacity-40 dark:bg-emerald-300 dark:text-zinc-950 dark:hover:bg-emerald-400"
                  >
                    {isAdding ? 'Adding...' : 'Add Domain'}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>
    </div>
  );
}
