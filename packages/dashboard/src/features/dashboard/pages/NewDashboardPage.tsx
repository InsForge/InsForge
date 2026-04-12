import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge, Button, CopyButton } from '@insforge/ui';
import { Skeleton } from '../../../components';
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
import StepUserIcon from '../../../assets/icons/step_user.svg?react';
import StepUploadIcon from '../../../assets/icons/step_upload.svg?react';
import { useMetadata, useApiKey } from '../../../lib/hooks/useMetadata';
import { useIsCloudHostingMode } from '../../../lib/config/DashboardHostContext';
import { useCloudProjectInfo } from '../../../lib/hooks/useCloudProjectInfo';
import { useMcpUsage } from '../../logs/hooks/useMcpUsage';
import { getBackendUrl, isInsForgeCloudProject } from '../../../lib/utils/utils';
import { useUsers } from '../../auth';
import { useAIUsageSummary } from '../../ai/hooks/useAIUsage';
import { useDeploymentMetadata } from '../../deployments/hooks/useDeploymentMetadata';
import { NewCLISection } from '../components/connect/NewCLISection';
import { MCPSection } from '../components/connect';
import stepBgDecoration from '../../../assets/images/step_bg_decoration.svg';

// --- Prompt Stepper Data ---

interface PromptStep {
  id: number;
  title: string;
  prompt: string;
  icon: React.ReactNode;
}

const PROMPT_STEPS: PromptStep[] = [
  {
    id: 1,
    title: 'Add sample data',
    prompt:
      'Add 4 todo items to the todo table:\n\n1. Add sign in for users\n2. Add file upload\n3. Use AI to turn text into tasks\n4. Deploy your app',
    icon: <Database className="size-6 text-muted-foreground" />,
  },
  {
    id: 2,
    title: 'Sign up your first user',
    prompt:
      'Add sign in for users to this app.\nUsers should be able to:\n1. Sign up\n2. Sign in\n3. Sign out',
    icon: <StepUserIcon className="size-6 text-muted-foreground" />,
  },
  {
    id: 3,
    title: 'Upload a file',
    prompt:
      'Add file upload to this app.\nUsers should be able to upload a file and attach it to a task.\nShow the uploaded file in the task UI.\nUse InsForge Storage for file uploads.',
    icon: <StepUploadIcon className="size-6 text-muted-foreground" />,
  },
  {
    id: 4,
    title: 'Add LLM feature',
    prompt:
      'Add an AI feature to this todo app that turns text into tasks.\nUsers should be able to type natural language and have the app create one or more todo items automatically.',
    icon: <Sparkles className="size-6 text-muted-foreground" />,
  },
  {
    id: 5,
    title: 'Deploy your app',
    prompt: 'Deploy this app on InsForge, after deploying, share the live URL.',
    icon: <Rocket className="size-6 text-muted-foreground" />,
  },
];

const STEPPER_DISMISS_KEY = 'insforge-prompt-stepper-dismissed';

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
    <div className="flex min-w-0 flex-1 flex-col justify-between overflow-hidden rounded border border-[var(--alpha-8)] bg-card">
      <div className="flex flex-1 flex-col justify-between p-4">
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
              className="flex shrink-0 items-center justify-center text-muted-foreground hover:text-foreground"
            >
              <ExternalLink className="h-5 w-5" />
            </button>
          )}
        </div>

        {/* Value row */}
        <div className="flex items-baseline justify-between">
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
  const lines = text.split('\n').filter((l) => l.trim() !== '');
  const introLines: string[] = [];
  const listItems: string[] = [];

  for (const line of lines) {
    const match = line.match(/^\d+\.\s+(.+)/);
    if (match) {
      listItems.push(match[1]);
    } else if (line.match(/^-\s+(.+)/)) {
      listItems.push(line.replace(/^-\s+/, ''));
    } else {
      introLines.push(line);
    }
  }

  return (
    <div className="text-sm leading-6 text-foreground">
      {introLines.map((line, i) => (
        <p key={i}>{line}</p>
      ))}
      {listItems.length > 0 && (
        <ol className="list-decimal pl-5">
          {listItems.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ol>
      )}
    </div>
  );
}

// --- Step circle (simple outline, green when active/completed, gray otherwise) ---

function StepCircle({ completed, active }: { completed: boolean; active: boolean }) {
  if (completed) {
    return (
      <div
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${active ? 'border-primary' : 'border-muted-foreground/40'}`}
      >
        <Check className={`h-3 w-3 ${active ? 'text-primary' : 'text-muted-foreground/40'}`} />
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
                  isActive ? 'bg-[var(--special-toast,#323232)]' : 'hover:bg-[var(--alpha-4)]'
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
                <p className="text-base leading-7 text-foreground">{step.title}</p>
              </button>
            );
          })}
        </div>

        {/* Step detail (right) */}
        <div className="relative flex flex-1 flex-col items-start self-stretch overflow-hidden bg-[var(--special-toast,#323232)] p-6">
          <div className="relative z-10 flex max-w-[480px] flex-col items-start gap-3">
            {/* Icon */}
            <div className="h-12 w-12">{currentStep.icon}</div>

            {/* Title */}
            <p className="text-[20px] font-medium leading-7 text-foreground">{currentStep.title}</p>

            {/* Prompt text */}
            <PromptDisplay text={currentStep.prompt} />

            {/* Copy Prompt button */}
            <CopyButton
              text={currentStep.prompt}
              showText
              copyText="Copy Prompt"
              copiedText="Copied!"
              className={
                completedSteps[activeStep]
                  ? 'h-9 rounded border border-[var(--alpha-8)] bg-transparent px-2 text-sm font-medium text-foreground hover:bg-[var(--alpha-4)]'
                  : 'h-9 rounded bg-primary px-2 text-sm font-medium text-[rgb(var(--inverse))] hover:bg-primary/90'
              }
            />
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
  const { data: aiUsageSummary } = useAIUsageSummary();
  const { currentDeploymentId } = useDeploymentMetadata();

  const [isStepperDismissed, setIsStepperDismissed] = useState(() => {
    try {
      return localStorage.getItem(STEPPER_DISMISS_KEY) === 'true';
    } catch {
      return false;
    }
  });

  const shouldShowLoadingState =
    isMetadataLoading || isMcpUsageLoading || (isCloudProject && isProjectInfoLoading);

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
      // Step 1: Add sample data — todo table has records
      (tables?.find((t) => t.tableName === 'todo')?.recordCount ?? 0) > 0,
      // Step 2: Sign up first user — totalUsers already excludes admin & anon
      (totalUsers ?? 0) >= 1,
      // Step 3: Upload a file — todo-attachments bucket has files
      (storage?.buckets?.find((b) => b.name === 'todo-attachments')?.objectCount ?? 0) > 0,
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
      localStorage.setItem(STEPPER_DISMISS_KEY, 'true');
    } catch {
      // ignore
    }
  }, []);

  const displayApiKey = isApiKeyLoading ? 'ik_' + '*'.repeat(32) : apiKey || '';
  const appUrl = getBackendUrl();

  if (shouldShowLoadingState) {
    return <NewDashboardLoadingState />;
  }

  return (
    <main className="h-full min-h-0 min-w-0 overflow-y-auto bg-semantic-0">
      <div className="flex w-full flex-col gap-6 px-10 py-8">
        {/* Project Header */}
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-medium leading-8 text-foreground">{projectName}</h1>
          {showInstanceTypeBadge && (
            <Badge
              variant="default"
              className="rounded bg-[var(--alpha-8)] px-1 py-0.5 text-xs font-medium uppercase text-muted-foreground"
            >
              {instanceType}
            </Badge>
          )}
          {/* Health badge */}
          <div className="flex items-center overflow-hidden rounded-full bg-[var(--special-toast,#323232)]">
            <div className="flex items-center gap-1 px-2 py-1">
              <div className="flex h-5 w-5 items-center justify-center">
                <div
                  className={`h-2 w-2 rounded-full ${isHealthy ? 'bg-emerald-400' : 'bg-amber-400'}`}
                />
              </div>
              <span className="text-xs font-medium text-foreground">{projectHealth}</span>
            </div>
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
