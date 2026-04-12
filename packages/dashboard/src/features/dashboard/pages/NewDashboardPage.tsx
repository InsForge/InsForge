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
} from 'lucide-react';
import { useMetadata } from '../../../lib/hooks/useMetadata';
import { useIsCloudHostingMode } from '../../../lib/config/DashboardHostContext';
import { useCloudProjectInfo } from '../../../lib/hooks/useCloudProjectInfo';
import { useApiKey } from '../../../lib/hooks/useMetadata';
import { useMcpUsage } from '../../logs/hooks/useMcpUsage';
import { getBackendUrl, isInsForgeCloudProject } from '../../../lib/utils/utils';
import { useUsers } from '../../auth';
import { useAIGatewayConfig } from '../../ai/hooks/useAIGatewayConfig';
import { useDeploymentMetadata } from '../../deployments/hooks/useDeploymentMetadata';
import { NewCLISection } from '../components/connect/NewCLISection';
import { MCPSection } from '../components/connect';

// --- Prompt Stepper Data ---

interface PromptStep {
  id: number;
  title: string;
  prompt: string;
}

const PROMPT_STEPS: PromptStep[] = [
  {
    id: 1,
    title: 'Add sample data',
    prompt:
      'Check if a "todo" table exists in the database. If it does, add the sample data below directly. If not, create it first with columns: text, createdAt, and isCompleted.\n\nThen add 4 todo items:\n\n1. Add sign in for users\n2. Add file upload\n3. Use AI to turn text into tasks\n4. Deploy your app',
  },
  {
    id: 2,
    title: 'Sign up your first user',
    prompt:
      'Add authentication to this app using InsForge Auth.\n\nUsers should be able to sign up, sign in, and sign out.\n\nAfter implementing, sign up a test user to verify it works.',
  },
  {
    id: 3,
    title: 'Upload a file',
    prompt:
      'Add file upload to this app using InsForge Storage.\n\nCreate a storage bucket called "todo-attachments".\n\nUsers should be able to upload a file next to each todo item and see the uploaded file in the UI.',
  },
  {
    id: 4,
    title: 'Add LLM feature',
    prompt:
      'Add an AI feature to this todo app using InsForge AI Gateway.\n\nAdd a text input where users can type natural language like "Plan a birthday party" and the app automatically creates multiple todo items from it.\n\nUse the InsForge AI Gateway API to call the LLM.',
  },
  {
    id: 5,
    title: 'Deploy your app',
    prompt:
      'Deploy this app on InsForge, after deploying, share the live URL.',
  },
];

const STEPPER_DISMISS_KEY = 'insforge-prompt-stepper-dismissed';

// --- Sub-components ---

interface MetricCardProps {
  label: string;
  value: string;
  subValue?: string;
  icon: React.ReactNode;
  onNavigate?: () => void;
}

function MetricCard({ label, value, subValue, icon, onNavigate }: MetricCardProps) {
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

        {/* Value */}
        <div className="flex items-baseline gap-2">
          <p className="text-[20px] font-medium leading-7 text-foreground">{value}</p>
          {subValue && (
            <span className="text-[13px] leading-[22px] text-muted-foreground">{subValue}</span>
          )}
        </div>
      </div>
    </div>
  );
}

// --- Step completion circle ---

function StepCircle({ completed, active }: { completed: boolean; active: boolean }) {
  if (completed) {
    return (
      <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary">
        <Check className="h-3 w-3 text-[rgb(var(--inverse))]" />
      </div>
    );
  }

  // Empty circle — matches Figma ○ style
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
}

function PromptStepper({ onDismiss, completedSteps }: PromptStepperProps) {
  const [activeStep, setActiveStep] = useState(0);
  const currentStep = PROMPT_STEPS[activeStep];

  return (
    <div className="flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-[20px] font-medium leading-7 text-foreground">
          Start configuring your backend with prompts
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onDismiss}
          className="text-sm text-muted-foreground"
        >
          Dismiss
        </Button>
      </div>
      <p className="text-[13px] leading-[18px] text-muted-foreground">
        Copy and Paste prompt to your agent to start building
      </p>

      {/* Stepper card */}
      <div className="flex overflow-hidden rounded border border-[var(--alpha-8)] bg-card">
        {/* Step list (left) */}
        <div className="flex w-[440px] shrink-0 flex-col border-r border-[var(--alpha-8)]">
          {PROMPT_STEPS.map((step, index) => {
            const isActive = index === activeStep;
            const isCompleted = completedSteps[index];
            return (
              <button
                key={step.id}
                type="button"
                onClick={() => setActiveStep(index)}
                className={`flex flex-col gap-2 border-b border-[var(--alpha-8)] p-4 text-left transition-colors last:border-b-0 ${
                  isActive
                    ? 'bg-[var(--special-toast,#323232)]'
                    : 'hover:bg-[var(--alpha-4)]'
                }`}
              >
                <div className="flex items-center gap-1">
                  <StepCircle completed={!!isCompleted} active={isActive} />
                  <span
                    className={`text-sm leading-5 ${
                      isCompleted
                        ? 'text-primary'
                        : isActive
                          ? 'text-primary'
                          : 'text-muted-foreground'
                    }`}
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
        <div className="flex flex-1 flex-col items-start gap-3 self-stretch bg-[var(--special-toast,#323232)] p-6">
          <div className="flex max-w-[480px] flex-col items-start gap-3">
            {/* Icon */}
            <div className="flex h-12 w-12 items-center justify-center">
              <Database className="h-6 w-6 text-muted-foreground" />
            </div>

            {/* Title */}
            <p className="text-[20px] font-medium leading-7 text-foreground">
              {currentStep.title}
            </p>

            {/* Prompt text */}
            <p className="whitespace-pre-line text-sm leading-6 text-foreground">
              {currentStep.prompt}
            </p>

            {/* Copy Prompt button */}
            <CopyButton
              text={currentStep.prompt}
              showText
              copyText="Copy Prompt"
              copiedText="Copied!"
              className="h-9 rounded bg-primary px-2 text-sm font-medium text-[rgb(var(--inverse))] hover:bg-primary/90"
            />
          </div>
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
  const { apiKey, isLoading: isApiKeyLoading } = useApiKey({ enabled: !canShowCli });
  const { gatewayConfig } = useAIGatewayConfig();
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

  const projectName = isCloudProject ? projectInfo.name : 'My InsForge Project';
  const instanceType = projectInfo.instanceType?.toUpperCase();
  const showInstanceTypeBadge = isCloudProject && !!instanceType;
  const agentConnected = hasCompletedOnboarding;

  const projectHealth = useMemo(() => {
    if (metadataError) return 'Issue';
    if (isMetadataLoading) return 'Loading...';
    return 'Healthy';
  }, [isMetadataLoading, metadataError]);

  const isHealthy = projectHealth === 'Healthy';

  const tableCount = tables?.length ?? 0;
  const databaseSize = (metadata?.database.totalSizeInGB ?? 0).toFixed(2);
  const storageSize = (storage?.totalSizeInGB ?? 0).toFixed(2);
  const bucketCount = storage?.buckets?.length ?? 0;
  const functionCount = metadata?.functions.length ?? 0;

  // --- Step completion detection (real-time via socket → React Query invalidation) ---
  const completedSteps = useMemo(() => [
    // Step 1: Add sample data — todo table has records
    (tables?.find((t) => t.tableName === 'todo')?.recordCount ?? 0) > 0,
    // Step 2: Sign up first user — more than just the admin user
    (totalUsers ?? 0) > 1,
    // Step 3: Upload a file — any storage bucket exists
    bucketCount > 0,
    // Step 4: Add LLM feature — AI gateway has a BYOK key configured
    !!gatewayConfig?.hasByokKey,
    // Step 5: Deploy your app — a deployment exists
    !!currentDeploymentId,
  ], [tables, totalUsers, bucketCount, gatewayConfig, currentDeploymentId]);

  const handleDismissStepper = useCallback(() => {
    setIsStepperDismissed(true);
    try {
      localStorage.setItem(STEPPER_DISMISS_KEY, 'true');
    } catch {
      // ignore
    }
  }, []);

  if (shouldShowLoadingState) {
    return <NewDashboardLoadingState />;
  }

  // Not connected — show CLI (cloud) or MCP (self-host)
  if (!agentConnected) {
    const displayApiKey = isApiKeyLoading ? 'ik_' + '*'.repeat(32) : apiKey || '';
    const appUrl = getBackendUrl();

    return (
      <main className="h-full min-h-0 min-w-0 overflow-y-auto bg-semantic-0">
        <div className="mx-auto flex w-full flex-col items-center gap-8 px-10 py-16">
          {canShowCli ? (
            <NewCLISection />
          ) : (
            <MCPSection apiKey={displayApiKey} appUrl={appUrl} isLoading={isApiKeyLoading} />
          )}
        </div>
      </main>
    );
  }

  // Connected — show full dashboard
  return (
    <main className="h-full min-h-0 min-w-0 overflow-y-auto bg-semantic-0">
      <div className="flex w-full flex-col gap-6 px-10 py-8">
        {/* Project Header */}
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-medium leading-8 text-foreground">
              {projectName}
            </h1>
            {showInstanceTypeBadge && (
              <Badge
                variant="default"
                className="rounded bg-[var(--alpha-8)] px-1 py-0.5 text-xs font-medium uppercase text-muted-foreground"
              >
                {instanceType}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-4">
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
        </div>

        {/* Metric Cards - 120px height, 4 cols, 12px gap */}
        <div className="grid h-[120px] grid-cols-4 gap-3">
          <MetricCard
            label="User"
            value={String(totalUsers ?? 0)}
            icon={<User className="h-5 w-5" />}
            onNavigate={() => void navigate('/dashboard/authentication/users')}
          />
          <MetricCard
            label="Database"
            value={`${tableCount}`}
            subValue={`${tableCount === 1 ? 'Table' : 'Tables'}    ${databaseSize} GB`}
            icon={<Database className="h-5 w-5" />}
            onNavigate={() => void navigate('/dashboard/database/tables')}
          />
          <MetricCard
            label="Storage"
            value={`${bucketCount}`}
            subValue={`${bucketCount === 1 ? 'Bucket' : 'Buckets'}    ${storageSize} GB`}
            icon={<HardDrive className="h-5 w-5" />}
            onNavigate={() => void navigate('/dashboard/storage')}
          />
          <MetricCard
            label="Edge Functions"
            value={String(functionCount)}
            subValue={functionCount === 1 ? 'Function' : 'Functions'}
            icon={<Braces className="h-5 w-5" />}
            onNavigate={() => void navigate('/dashboard/functions/list')}
          />
        </div>

        {/* Prompt Stepper */}
        {!isStepperDismissed && (
          <PromptStepper onDismiss={handleDismissStepper} completedSteps={completedSteps} />
        )}
      </div>
    </main>
  );
}
