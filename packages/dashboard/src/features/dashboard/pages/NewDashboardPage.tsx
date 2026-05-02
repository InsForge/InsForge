import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge, Button, CopyButton } from '@insforge/ui';
import { Skeleton } from '#components';
import {
  Braces,
  Check,
  Database,
  ExternalLink,
  HardDrive,
  User,
  Sparkles,
  Rocket,
} from 'lucide-react';
import StepUserIcon from '#assets/icons/step_user.svg?react';
import StepUploadIcon from '#assets/icons/step_upload.svg?react';
import { useMetadata, useApiKey, useProjectId } from '#lib/hooks/useMetadata';
import { useIsCloudHostingMode } from '#lib/config/DashboardHostContext';
import { useCloudProjectInfo } from '#lib/hooks/useCloudProjectInfo';
import { useMcpUsage } from '#features/logs/hooks/useMcpUsage';
import { getBackendUrl, isInsForgeCloudProject } from '#lib/utils/utils';
import { useUsers } from '#features/auth';
import { useAIUsageSummary } from '#features/ai/hooks/useAIUsage';
import { useDeploymentMetadata } from '#features/deployments/hooks/useDeploymentMetadata';
import { NewCLISection } from '#features/dashboard/components/connect/NewCLISection';
import { MCPSection } from '#features/dashboard/components/connect';
import stepBgDecoration from '#assets/images/step_bg_decoration.svg';

// --- Prompt Stepper Data ---

interface PromptStep {
  id: number;
  title: string;
  prompt: string;
  icon: React.ReactNode;
  navigateTo?: { label: string; path: string };
}

const PROMPT_STEPS: PromptStep[] = [
  {
    id: 1,
    title: 'Add sample data',
    prompt: 'Use InsForge Skills to create a table in InsForge backend and add some sample data.',
    icon: <Database className="size-12 text-[rgb(var(--disabled))]" />,
    navigateTo: { label: 'Go to Database', path: '/dashboard/database/tables' },
  },
  {
    id: 2,
    title: 'Sign up your first user',
    prompt:
      'Use InsForge Skills to add user authentication to this app using InsForge Auth.\n\nUsers should be able to:\n1. Sign up / Sign in with Email\n2. Add Google OAuth\n3. Sign out\n\nAlso update the database and access control so each record belongs to a user:\n1. Add a `user_id` column to the relevant table(s)\n2. Set `user_id` automatically when a new record is created\n3. Restrict reads and writes so users can only access their own data\n4. Add the required row level security policies for this\n\nUpdate the app UI and backend logic so authentication is fully wired up and only signed in users can create and view their own records.',
    icon: <StepUserIcon className="size-12 text-[rgb(var(--disabled))]" />,
    navigateTo: { label: 'Go to User', path: '/dashboard/authentication/users' },
  },
  {
    id: 3,
    title: 'Upload a file',
    prompt:
      'Use InsForge Skills to add file upload to this app.\nUsers should be able to upload a file and attach it to a record.\nShow the uploaded file in the UI.\nUse InsForge Storage for file uploads.',
    icon: <StepUploadIcon className="size-12 text-[rgb(var(--disabled))]" />,
    navigateTo: { label: 'Go to Storage', path: '/dashboard/storage' },
  },
  {
    id: 4,
    title: 'Add LLM feature',
    prompt:
      'Use InsForge Skills to add an AI feature to this app using the InsForge AI Gateway.\nUsers should be able to type natural language and have the AI generate a useful response automatically.',
    icon: <Sparkles className="size-12 text-[rgb(var(--disabled))]" />,
    navigateTo: { label: 'Go to Model Gateway', path: '/dashboard/ai' },
  },
  {
    id: 5,
    title: 'Deploy your app',
    prompt:
      'Use InsForge Skills to deploy this app on InsForge, after deploying, share the live URL.',
    icon: <Rocket className="size-12 text-[rgb(var(--disabled))]" />,
    navigateTo: { label: 'Go to Deployment', path: '/dashboard/deployments' },
  },
];

const getStepperDismissKey = (projectId?: string) =>
  `insforge-prompt-stepper-dismissed-${projectId || 'default'}`;

// --- Sub-components ---

interface MetricCardProps {
  label: string;
  value: string;
  subValueLeft?: string;
  subValueRight?: string;
  icon: React.ReactNode;
  onNavigate?: () => void;
}

function MetricCard({
  label,
  value,
  subValueLeft,
  subValueRight,
  icon,
  onNavigate,
}: MetricCardProps) {
  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded border border-[var(--alpha-8)] bg-card">
      <div className="flex h-[120px] flex-col p-4">
        {/* Header row */}
        <div className="flex h-[22px] items-center gap-1.5">
          <div className="flex h-5 w-5 shrink-0 items-center justify-center text-muted-foreground">
            {icon}
          </div>
          <p className="flex-1 text-[13px] leading-[22px] text-muted-foreground">{label}</p>
          {onNavigate && (
            <button
              type="button"
              onClick={onNavigate}
              aria-label={`Open ${label}`}
              className="flex shrink-0 items-center justify-center text-muted-foreground hover:text-foreground"
            >
              <ExternalLink className="h-5 w-5" />
            </button>
          )}
        </div>

        {/* Value row — pinned 60px from top (matching Figma y=76 - padding=16) */}
        <div className="mt-[38px] flex items-baseline justify-between">
          <div className="flex items-baseline gap-1">
            <p className="text-[20px] font-medium leading-7 text-foreground">{value}</p>
            {subValueLeft && (
              <span className="text-[13px] leading-[22px] text-muted-foreground">
                {subValueLeft}
              </span>
            )}
          </div>
          {subValueRight && (
            <span className="text-[13px] leading-[22px] text-muted-foreground">
              {subValueRight}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// --- Prompt display (renders numbered lines as an ordered list) ---

function PromptDisplay({ text }: { text: string }) {
  const lines = text.split('\n');

  type Block =
    | { type: 'text'; content: string }
    | { type: 'list'; items: string[] }
    | { type: 'spacer' };
  const result: Block[] = [];

  for (const line of lines) {
    const numberedMatch = line.match(/^\d+\.\s+(.+)/);
    const bulletMatch = line.match(/^-\s+(.+)/);

    if (numberedMatch || bulletMatch) {
      const item = numberedMatch?.[1] ?? bulletMatch?.[1] ?? '';
      const last = result[result.length - 1];
      if (last && last.type === 'list') {
        last.items.push(item);
      } else {
        result.push({ type: 'list', items: [item] });
      }
    } else if (line.trim() === '') {
      result.push({ type: 'spacer' as const });
    } else {
      result.push({ type: 'text', content: line });
    }
  }

  return (
    <div className="text-sm leading-6 text-foreground">
      {result.map((block, i) =>
        block.type === 'spacer' ? (
          <div key={i} className="h-2" />
        ) : block.type === 'text' ? (
          <p key={i}>{block.content}</p>
        ) : (
          <ol key={i} className="list-decimal pl-5">
            {block.items.map((item, j) => (
              <li key={j}>{item}</li>
            ))}
          </ol>
        )
      )}
    </div>
  );
}

// --- Step circle (simple outline, green when active/completed, gray otherwise) ---

function StepCircle({ completed, active }: { completed: boolean; active: boolean }) {
  if (completed) {
    return (
      <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-primary">
        <Check className="h-3 w-3 text-primary" />
      </div>
    );
  }

  return (
    <div
      className={`h-5 w-5 shrink-0 rounded-full border-2 ${
        active ? 'border-primary' : 'border-muted-foreground/40'
      }`}
    />
  );
}

// --- Prompt Stepper ---

interface PromptStepperProps {
  onDismiss: () => void;
  completedSteps: boolean[];
  showDismiss?: boolean;
}

function PromptStepper({ onDismiss, completedSteps, showDismiss = false }: PromptStepperProps) {
  const navigate = useNavigate();
  const [activeStep, setActiveStep] = useState(0);
  const currentStep = PROMPT_STEPS[activeStep];
  const allCompleted = completedSteps.every(Boolean);

  return (
    <div className="flex flex-col gap-6 rounded-lg border border-[var(--alpha-8)] bg-card p-6">
      {/* Header */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <p className="text-[20px] font-medium leading-7 text-foreground">Next Step</p>
          {allCompleted ? (
            <Button
              type="button"
              size="sm"
              onClick={onDismiss}
              className="rounded bg-primary text-sm font-medium text-[rgb(var(--inverse))] hover:bg-primary/90"
            >
              Close
            </Button>
          ) : showDismiss ? (
            <Button
              type="button"
              size="sm"
              onClick={onDismiss}
              className="rounded border border-[var(--alpha-8)] bg-card text-sm font-medium text-muted-foreground hover:text-foreground"
            >
              Dismiss
            </Button>
          ) : null}
        </div>
        <p className="text-[13px] leading-[18px] text-muted-foreground">
          Copy and Paste prompt to your agent to start building
        </p>
      </div>

      {/* Stepper content - inner bordered container */}
      <div className="flex overflow-hidden rounded border border-[var(--alpha-8)]">
        {/* Step list (left) */}
        <div className="flex w-1/2 max-w-[440px] shrink-0 flex-col border-r border-[var(--alpha-8)]">
          {PROMPT_STEPS.map((step, index) => {
            const isActive = index === activeStep;
            const isCompleted = completedSteps[index];
            return (
              <button
                key={step.id}
                type="button"
                onClick={() => setActiveStep(index)}
                className={`flex flex-col gap-2 border-b border-[var(--alpha-8)] p-4 text-left transition-colors last:border-b-0 ${
                  isActive ? 'bg-toast' : 'hover:bg-[var(--alpha-4)]'
                }`}
              >
                <div className="flex items-center gap-1">
                  <StepCircle completed={!!isCompleted} active={isActive} />
                  <span
                    className={`text-sm leading-5 ${isActive ? 'text-primary' : 'text-muted-foreground'}`}
                  >
                    Step {step.id}
                  </span>
                </div>
                <p
                  className={`text-base leading-7 text-foreground ${isCompleted ? 'line-through' : ''}`}
                >
                  {step.title}
                </p>
              </button>
            );
          })}
        </div>

        {/* Step detail (right) */}
        <div className="relative flex flex-1 flex-col items-start self-stretch overflow-hidden bg-toast p-6">
          <div className="relative z-10 flex max-w-[640px] flex-col items-start gap-3">
            {/* Icon */}
            <div className="h-12 w-12">{currentStep.icon}</div>

            {/* Title */}
            <p className="text-[20px] font-medium leading-7 text-foreground">{currentStep.title}</p>

            {/* Prompt text */}
            <PromptDisplay text={currentStep.prompt} />

            {/* Action buttons */}
            <div className="flex items-center gap-2">
              <CopyButton
                text={currentStep.prompt}
                showText
                copyText="Copy Prompt"
                copiedText="Copied!"
                className="h-9 rounded bg-primary px-2 text-sm font-medium text-[rgb(var(--inverse))] hover:bg-primary/90"
              />
              {currentStep.navigateTo && (
                <Button
                  type="button"
                  size="sm"
                  onClick={() => {
                    if (currentStep.navigateTo) {
                      void navigate(currentStep.navigateTo.path);
                    }
                  }}
                  className="h-9 rounded border border-[var(--alpha-8)] bg-transparent px-3 text-sm font-medium text-foreground hover:bg-[var(--alpha-4)]"
                >
                  {currentStep.navigateTo.label}
                </Button>
              )}
            </div>
          </div>

          {/* Decorative background graphic */}
          <img
            src={stepBgDecoration}
            alt=""
            className="pointer-events-none absolute bottom-0 right-0 w-[80%] max-w-[600px] opacity-[0.06]"
          />
        </div>
      </div>
    </div>
  );
}

function NewDashboardLoadingState() {
  return (
    <main className="h-full min-h-0 min-w-0 overflow-y-auto bg-semantic-0">
      <div className="mx-auto flex w-full flex-col gap-6 px-10 py-8">
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-5 w-16 rounded" />
          <Skeleton className="h-6 w-20 rounded-full" />
        </div>
        <div className="grid grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[120px] rounded" />
          ))}
        </div>
        <Skeleton className="h-[360px] rounded" />
      </div>
    </main>
  );
}

// --- Main Page ---

export default function NewDashboardPage() {
  const navigate = useNavigate();
  const isCloudHostingMode = useIsCloudHostingMode();
  const isCloudProject = isInsForgeCloudProject();
  const canShowCli = isCloudProject && isCloudHostingMode;
  const {
    metadata,
    tables,
    storage,
    isLoading: isMetadataLoading,
    error: metadataError,
  } = useMetadata();
  const { projectInfo, isLoading: isProjectInfoLoading } = useCloudProjectInfo();
  const { totalUsers } = useUsers();
  const { hasCompletedOnboarding, isLoading: isMcpUsageLoading } = useMcpUsage();
  const { apiKey, isLoading: isApiKeyLoading } = useApiKey();
  const { data: aiUsageSummary, isLoading: isAIUsageLoading } = useAIUsageSummary();
  const { currentDeploymentId, isLoading: isDeploymentLoading } = useDeploymentMetadata();
  const { projectId } = useProjectId();
  const stepperDismissKey = getStepperDismissKey(projectId ?? undefined);

  const [isStepperDismissed, setIsStepperDismissed] = useState(false);

  useEffect(() => {
    if (!projectId) {
      return;
    }
    try {
      const dismissed = localStorage.getItem(stepperDismissKey) === 'true';
      setIsStepperDismissed(dismissed);
    } catch {
      // ignore
    }
  }, [projectId, stepperDismissKey]);

  const shouldShowLoadingState =
    isMetadataLoading ||
    isMcpUsageLoading ||
    isAIUsageLoading ||
    isDeploymentLoading ||
    (isCloudProject && isProjectInfoLoading);

  const projectName = isCloudProject
    ? projectInfo.name || 'My InsForge Project'
    : 'My InsForge Project';
  const instanceType = projectInfo.instanceType?.toUpperCase();
  const showInstanceTypeBadge = isCloudProject && !!instanceType;
  const agentConnected = hasCompletedOnboarding;

  const projectHealth = useMemo(() => {
    if (metadataError) {
      return 'Issue';
    }
    if (isMetadataLoading) {
      return 'Loading...';
    }
    return 'Healthy';
  }, [isMetadataLoading, metadataError]);

  const isHealthy = projectHealth === 'Healthy';

  const tableCount = tables?.length ?? 0;
  const databaseSize = (metadata?.database.totalSizeInGB ?? 0).toFixed(2);
  const storageSize = (storage?.totalSizeInGB ?? 0).toFixed(2);
  const bucketCount = storage?.buckets?.length ?? 0;
  const functionCount = metadata?.functions.length ?? 0;

  // --- Step completion detection (real-time via socket → React Query invalidation) ---
  const completedSteps = useMemo(
    () => [
      // Step 1: Add sample data — at least one user table has rows
      (tables ?? []).some((t) => t.recordCount > 0),
      // Step 2: Sign up first user — totalUsers already excludes admin & anon
      (totalUsers ?? 0) >= 1,
      // Step 3: Upload a file — at least one storage bucket exists
      (storage?.buckets?.length ?? 0) > 0,
      // Step 4: Add LLM feature — AI gateway has been used
      (aiUsageSummary?.totalRequests ?? 0) > 0,
      // Step 5: Deploy your app — a deployment exists
      !!currentDeploymentId,
    ],
    [tables, totalUsers, storage, aiUsageSummary, currentDeploymentId]
  );

  const handleDismissStepper = useCallback(() => {
    setIsStepperDismissed(true);
    try {
      localStorage.setItem(stepperDismissKey, 'true');
    } catch {
      // ignore
    }
  }, [stepperDismissKey]);

  const displayApiKey = isApiKeyLoading ? 'ik_' + '*'.repeat(32) : apiKey || '';
  const appUrl = getBackendUrl();

  if (shouldShowLoadingState) {
    return <NewDashboardLoadingState />;
  }

  return (
    <main className="h-full min-h-0 min-w-0 overflow-y-auto bg-semantic-0">
      <div className="flex w-full flex-col gap-12 px-10 py-8">
        {/* Project Header */}
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-normal leading-8 text-foreground">{projectName}</h1>
          {showInstanceTypeBadge && (
            <Badge
              variant="default"
              className="rounded bg-[var(--alpha-8)] px-1 py-0.5 text-xs font-medium uppercase text-muted-foreground"
            >
              {instanceType}
            </Badge>
          )}
          {/* Health badge */}
          <div className="flex items-center rounded-full bg-toast px-2 py-1">
            <div
              className={`mr-1.5 h-2 w-2 rounded-full ${isHealthy ? 'bg-emerald-400' : 'bg-amber-400'}`}
            />
            <span className="text-xs font-medium text-foreground">{projectHealth}</span>
          </div>
        </div>

        {/* Get Started - CLI or MCP onboarding */}
        {canShowCli ? (
          <NewCLISection />
        ) : (
          <MCPSection apiKey={displayApiKey} appUrl={appUrl} isLoading={isApiKeyLoading} />
        )}

        {/* Metric Cards - 120px height, 4 cols, 12px gap */}
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <MetricCard
            label="User"
            value={String(totalUsers ?? 0)}
            icon={<User className="h-5 w-5" />}
            onNavigate={() => void navigate('/dashboard/authentication/users')}
          />
          <MetricCard
            label="Database"
            value={`${tableCount}`}
            subValueLeft={tableCount === 1 ? 'Table' : 'Tables'}
            subValueRight={`${databaseSize} GB`}
            icon={<Database className="h-5 w-5" />}
            onNavigate={() => void navigate('/dashboard/database/tables')}
          />
          <MetricCard
            label="Storage"
            value={`${bucketCount}`}
            subValueLeft={bucketCount === 1 ? 'Bucket' : 'Buckets'}
            subValueRight={`${storageSize} GB`}
            icon={<HardDrive className="h-5 w-5" />}
            onNavigate={() => void navigate('/dashboard/storage')}
          />
          <MetricCard
            label="Edge Functions"
            value={String(functionCount)}
            subValueLeft={functionCount === 1 ? 'Function' : 'Functions'}
            icon={<Braces className="h-5 w-5" />}
            onNavigate={() => void navigate('/dashboard/functions/list')}
          />
        </div>

        {/* Next Step - Prompt Stepper */}
        {!isStepperDismissed && (
          <PromptStepper
            onDismiss={handleDismissStepper}
            completedSteps={completedSteps}
            showDismiss={agentConnected}
          />
        )}
      </div>
    </main>
  );
}
