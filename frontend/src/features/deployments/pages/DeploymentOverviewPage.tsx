import { useState } from 'react';
import { ExternalLink, Copy, Check } from 'lucide-react';
import { Button, Skeleton } from '@/components';
import { useDeployments } from '../hooks/useDeployments';
import { useDeploymentMetadata } from '../hooks/useDeploymentMetadata';
import { formatTime } from '@/lib/utils/utils';

const statusColors: Record<string, string> = {
  WAITING: 'bg-yellow-600',
  UPLOADING: 'bg-blue-600',
  QUEUED: 'bg-purple-600',
  BUILDING: 'bg-sky-600',
  READY: 'bg-green-700',
  ERROR: 'bg-red-600',
  CANCELED: 'bg-gray-500',
};

const DEPLOY_PROMPT = 'Deploy my app to InsForge';

export default function DeploymentOverviewPage() {
  const [copied, setCopied] = useState(false);
  const { deployments, isLoadingDeployments } = useDeployments();
  const { customDomainUrl } = useDeploymentMetadata();

  // Get the latest READY deployment (the current production deployment)
  const latestReadyDeployment = deployments.find((d) => d.status === 'READY') ?? null;

  const handleCopyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(DEPLOY_PROMPT);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  if (isLoadingDeployments) {
    return (
      <div className="h-full flex flex-col overflow-hidden">
        <div className="flex-1 min-h-0 overflow-auto p-6">
          <div className="w-full max-w-[1080px] mx-auto flex flex-col gap-6">
            <h1 className="text-xl font-semibold text-zinc-950 dark:text-white">Overview</h1>
            <Skeleton className="h-[352px] w-full rounded-lg" />
          </div>
        </div>
      </div>
    );
  }

  // Empty state when no deployments exist
  if (!latestReadyDeployment) {
    return (
      <div className="h-full flex flex-col overflow-hidden">
        <div className="flex-1 min-h-0 overflow-auto p-6">
          <div className="w-full max-w-[1080px] mx-auto flex flex-col gap-6">
            <h1 className="text-xl font-semibold text-zinc-950 dark:text-white">Overview</h1>

            <div className="bg-neutral-100 dark:bg-[#333] rounded-lg p-6">
              <div className="flex flex-col gap-6">
                <h2 className="text-xl font-semibold text-zinc-950 dark:text-white">
                  No Deployments Yet
                </h2>

                <div className="flex flex-col gap-3">
                  <p className="text-sm text-muted-foreground dark:text-neutral-400">
                    Send the prompt below to your connected AI agent to deploy your project for the
                    first time.
                  </p>

                  {/* Prompt Box */}
                  <div className="bg-neutral-200 dark:bg-[#171717] rounded-lg p-3 flex flex-col gap-2">
                    <div className="flex items-start">
                      <span className="bg-neutral-300 dark:bg-neutral-700 text-zinc-950 dark:text-neutral-50 text-xs px-2 py-0.5 rounded">
                        prompt
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <p className="text-sm text-zinc-950 dark:text-white">{DEPLOY_PROMPT}</p>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => void handleCopyPrompt()}
                        className="bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700"
                      >
                        {copied ? (
                          <Check className="w-4 h-4 mr-2" />
                        ) : (
                          <Copy className="w-4 h-4 mr-2" />
                        )}
                        {copied ? 'Copied' : 'Copy'}
                      </Button>
                    </div>
                  </div>

                  <p className="text-sm text-muted-foreground dark:text-neutral-400">
                    You can also deploy using your own workflow.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const statusColor = statusColors[latestReadyDeployment.status] || 'bg-gray-500';
  const deploymentUrl = latestReadyDeployment.url
    ? latestReadyDeployment.url.startsWith('http')
      ? latestReadyDeployment.url
      : `https://${latestReadyDeployment.url}`
    : null;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex-1 min-h-0 overflow-auto p-6">
        <div className="w-full max-w-[1080px] mx-auto flex flex-col gap-6">
          <h1 className="text-xl font-semibold text-zinc-950 dark:text-white">Overview</h1>

          <div className="bg-neutral-100 dark:bg-[#333] rounded-lg p-6">
            <div className="flex gap-9">
              {/* Preview Image */}
              <div className="shrink-0 w-[405px] h-[304px] bg-neutral-200 dark:bg-[#f8f8f7] rounded overflow-hidden">
                {deploymentUrl ? (
                  <div className="w-full h-full relative">
                    <iframe
                      src={deploymentUrl}
                      title="Deployment Preview"
                      className="absolute top-0 left-0 w-[1215px] h-[912px] origin-top-left scale-[0.333] border-0 pointer-events-none"
                      sandbox="allow-scripts allow-same-origin"
                      loading="lazy"
                    />
                  </div>
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-muted-foreground text-sm">
                    No preview available
                  </div>
                )}
              </div>

              {/* Metadata Grid */}
              <div className="flex-1 flex flex-col gap-6 justify-center">
                {/* ID - Full width */}
                <div className="flex flex-col">
                  <p className="text-sm text-muted-foreground dark:text-neutral-400 leading-6">
                    ID
                  </p>
                  <p className="text-sm text-zinc-950 dark:text-white font-mono">
                    {latestReadyDeployment.id}
                  </p>
                </div>

                {/* Two column row: Status & Provider */}
                <div className="grid grid-cols-2 gap-x-9">
                  {/* Status */}
                  <div className="flex flex-col">
                    <p className="text-sm text-muted-foreground dark:text-neutral-400 leading-6">
                      Status
                    </p>
                    <div>
                      <span
                        className={`inline-flex items-center justify-center h-5 px-2 rounded text-xs font-medium text-white ${statusColor}`}
                      >
                        {latestReadyDeployment.status === 'READY'
                          ? 'Ready'
                          : latestReadyDeployment.status}
                      </span>
                    </div>
                  </div>

                  {/* Provider */}
                  <div className="flex flex-col">
                    <p className="text-sm text-muted-foreground dark:text-neutral-400 leading-6">
                      Provider
                    </p>
                    <p className="text-sm text-zinc-950 dark:text-white capitalize">
                      {latestReadyDeployment.provider}
                    </p>
                  </div>
                </div>

                {/* Created at - single item */}
                <div className="flex flex-col">
                  <p className="text-sm text-muted-foreground dark:text-neutral-400 leading-6">
                    Created at
                  </p>
                  <p className="text-sm text-zinc-950 dark:text-white">
                    {formatTime(latestReadyDeployment.createdAt)}
                  </p>
                </div>

                {/* Domains - Full width */}
                <div className="flex flex-col gap-1">
                  <p className="text-sm text-muted-foreground dark:text-neutral-400 leading-6">
                    Domains
                  </p>
                  <div className="flex flex-col gap-1">
                    {customDomainUrl && (
                      <a
                        href={customDomainUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-zinc-950 dark:text-white hover:text-blue-600 dark:hover:text-blue-400 flex items-center gap-1"
                      >
                        {customDomainUrl}
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                    {deploymentUrl ? (
                      <a
                        href={deploymentUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-zinc-950 dark:text-white hover:text-blue-600 dark:hover:text-blue-400 flex items-center gap-1"
                      >
                        {latestReadyDeployment.url}
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    ) : (
                      <p className="text-sm text-zinc-950 dark:text-white">—</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
