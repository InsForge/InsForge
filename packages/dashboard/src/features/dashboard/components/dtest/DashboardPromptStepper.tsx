import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, CopyButton } from '@insforge/ui';
import { Database, Sparkles, Rocket } from 'lucide-react';
import StepUserIcon from '#assets/icons/step_user.svg?react';
import StepUploadIcon from '#assets/icons/step_upload.svg?react';
import stepBgDecoration from '#assets/images/step_bg_decoration.svg';
import { useMetadata, useProjectId } from '#lib/hooks/useMetadata';
import { useUsers } from '#features/auth';
import { useAIUsageSummary } from '#features/ai/hooks/useAIUsage';
import { useDeploymentMetadata } from '#features/deployments/hooks/useDeploymentMetadata';
import { useMcpUsage } from '#features/logs/hooks/useMcpUsage';

// --- Prompt Stepper Data ---

type StepKey = 'database' | 'auth' | 'storage' | 'ai' | 'deployment';

interface PromptStep {
  id: number;
  key: StepKey;
  category: string;
  title: string;
  prompt: string;
  icon: React.ReactNode;
  navigateTo?: { label: string; path: string };
}

const PROMPT_STEPS: PromptStep[] = [
  {
    id: 1,
    key: 'database',
    category: 'Database',
    title: 'Add sample data',
    prompt: 'Use InsForge Skills to create a table in InsForge backend and add some sample data.',
    icon: <Database className="size-12 text-[rgb(var(--disabled))]" />,
    navigateTo: { label: 'Go to Database', path: '/dashboard/database/tables' },
  },
  {
    id: 2,
    key: 'auth',
    category: 'Authentication',
    title: 'Sign up your first user',
    prompt:
      'Use InsForge Skills to add user authentication to this app using InsForge Auth.\n\nUsers should be able to:\n1. Sign up / Sign in with Email\n2. Add Google OAuth\n3. Sign out\n\nAlso update the database and access control so each record belongs to a user:\n1. Add a `user_id` column to the relevant table(s)\n2. Set `user_id` automatically when a new record is created\n3. Restrict reads and writes so users can only access their own data\n4. Add the required row level security policies for this\n\nUpdate the app UI and backend logic so authentication is fully wired up and only signed in users can create and view their own records.',
    icon: <StepUserIcon className="size-12 text-[rgb(var(--disabled))]" />,
    navigateTo: { label: 'Go to User', path: '/dashboard/authentication/users' },
  },
  {
    id: 3,
    key: 'storage',
    category: 'Storage',
    title: 'Upload a file',
    prompt:
      'Use InsForge Skills to add file upload to this app.\nUsers should be able to upload a file and attach it to a record.\nShow the uploaded file in the UI.\nUse InsForge Storage for file uploads.',
    icon: <StepUploadIcon className="size-12 text-[rgb(var(--disabled))]" />,
    navigateTo: { label: 'Go to Storage', path: '/dashboard/storage' },
  },
  {
    id: 4,
    key: 'ai',
    category: 'Model Gateway',
    title: 'Add LLM feature',
    prompt:
      'Use InsForge Skills to add an AI feature to this app using the InsForge AI Gateway.\nUsers should be able to type natural language and have the AI generate a useful response automatically.',
    icon: <Sparkles className="size-12 text-[rgb(var(--disabled))]" />,
    navigateTo: { label: 'Go to Model Gateway', path: '/dashboard/ai' },
  },
  {
    id: 5,
    key: 'deployment',
    category: 'Deployment',
    title: 'Deploy your site',
    prompt:
      'Use InsForge Skills to deploy this app on InsForge, after deploying, share the live URL.',
    icon: <Rocket className="size-12 text-[rgb(var(--disabled))]" />,
    navigateTo: { label: 'Go to Deployment', path: '/dashboard/deployments' },
  },
];

const getStepperDismissKey = (projectId?: string) =>
  `insforge-prompt-stepper-dismissed-${projectId || 'default'}`;

const getStepDoneKey = (projectId: string | null | undefined, stepKey: StepKey) =>
  `insforge-ctest-step-${stepKey}-done-${projectId || 'default'}`;

// --- Prompt display ---

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

// --- Stepper card (presentation) ---

interface StepperCardProps {
  onDismiss: () => void;
  completedSteps: boolean[];
  showDismiss?: boolean;
}

function StepperCard({ onDismiss, completedSteps, showDismiss = false }: StepperCardProps) {
  const navigate = useNavigate();
  const [activeStep, setActiveStep] = useState(0);
  const currentStep = PROMPT_STEPS[activeStep];
  const allCompleted = completedSteps.every(Boolean);

  return (
    <div className="flex flex-col gap-6 rounded-lg border border-[var(--alpha-8)] bg-card p-6">
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <p className="text-[20px] font-medium leading-7 text-foreground">
            Your Agent can now do the work for you
          </p>
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
          Open your coding agent and start building your project with prompts
        </p>
      </div>

      <div className="flex overflow-hidden rounded border border-[var(--alpha-8)]">
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
                <div className="flex items-center">
                  <span
                    className={`rounded bg-[var(--alpha-8)] px-1.5 py-0.5 text-xs leading-5 ${isActive ? 'text-primary' : 'text-muted-foreground'}`}
                  >
                    {step.category}
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

        <div className="relative flex flex-1 flex-col items-start self-stretch overflow-hidden bg-toast p-6">
          <div className="relative z-10 flex max-w-[640px] flex-col items-start gap-3">
            <div className="h-12 w-12">{currentStep.icon}</div>
            <p className="text-[20px] font-medium leading-7 text-foreground">{currentStep.title}</p>
            <PromptDisplay text={currentStep.prompt} />
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

// --- Self-contained wrapper ---

/**
 * Self-contained "Start building with Prompts" stepper for the connected
 * dashboard. Manages its own dismiss persistence and step-completion tracking
 * (live signals from useMetadata / useUsers / useAIUsageSummary /
 * useDeploymentMetadata, plus a sticky localStorage flag so completion stays
 * checked even if the agent later deletes the source data).
 *
 * Returns null silently when the user has dismissed it or projectId hasn't
 * resolved yet (avoids flashing the card while we read localStorage).
 */
export function DashboardPromptStepper() {
  const { tables, storage } = useMetadata();
  const { totalUsers } = useUsers();
  const { data: aiUsageSummary } = useAIUsageSummary();
  const { currentDeploymentId } = useDeploymentMetadata();
  const { projectId } = useProjectId();
  // Only surface the stepper after the agent has made at least one MCP call.
  // A user who lands on the connected dashboard without ever invoking MCP
  // (e.g. dismissed the Install view manually) shouldn't be nagged with steps.
  const { hasCompletedOnboarding } = useMcpUsage();

  const stepperDismissKey = getStepperDismissKey(projectId ?? undefined);
  const [isDismissed, setIsDismissed] = useState(false);
  const [stickyCompletedSteps, setStickyCompletedSteps] = useState<
    Partial<Record<StepKey, boolean>>
  >({});

  useEffect(() => {
    if (projectId === undefined) {
      return;
    }
    try {
      setIsDismissed(localStorage.getItem(stepperDismissKey) === 'true');
    } catch {
      // ignore
    }
  }, [projectId, stepperDismissKey]);

  useEffect(() => {
    if (projectId === undefined) {
      return;
    }
    const loaded: Partial<Record<StepKey, boolean>> = {};
    try {
      for (const step of PROMPT_STEPS) {
        if (localStorage.getItem(getStepDoneKey(projectId, step.key)) === 'true') {
          loaded[step.key] = true;
        }
      }
    } catch {
      // ignore
    }
    setStickyCompletedSteps(loaded);
  }, [projectId]);

  const databaseStepComplete = (tables ?? []).some((t) => t.recordCount > 0);
  const storageStepComplete = (storage?.buckets?.length ?? 0) > 0;

  const liveCompletedSteps = useMemo<Record<StepKey, boolean>>(
    () => ({
      database: databaseStepComplete,
      auth: (totalUsers ?? 0) >= 1,
      storage: storageStepComplete,
      ai: (aiUsageSummary?.totalRequests ?? 0) > 0,
      deployment: !!currentDeploymentId,
    }),
    [databaseStepComplete, totalUsers, storageStepComplete, aiUsageSummary, currentDeploymentId]
  );

  // Persist live completions so they stick even if the agent later removes
  // the source rows (e.g. via RLS policies the user added).
  useEffect(() => {
    if (projectId === undefined) {
      return;
    }
    for (const step of PROMPT_STEPS) {
      if (liveCompletedSteps[step.key]) {
        try {
          localStorage.setItem(getStepDoneKey(projectId, step.key), 'true');
        } catch {
          // ignore
        }
      }
    }
    setStickyCompletedSteps((prev) => {
      let changed = false;
      const next: Partial<Record<StepKey, boolean>> = { ...prev };
      for (const step of PROMPT_STEPS) {
        if (liveCompletedSteps[step.key] && !next[step.key]) {
          next[step.key] = true;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [projectId, liveCompletedSteps]);

  const completedSteps = useMemo<boolean[]>(
    () =>
      PROMPT_STEPS.map(
        (step) => liveCompletedSteps[step.key] || stickyCompletedSteps[step.key] === true
      ),
    [liveCompletedSteps, stickyCompletedSteps]
  );

  const handleDismiss = useCallback(() => {
    if (projectId === undefined) {
      return;
    }
    setIsDismissed(true);
    try {
      localStorage.setItem(stepperDismissKey, 'true');
    } catch {
      // ignore
    }
  }, [projectId, stepperDismissKey]);

  if (isDismissed || !hasCompletedOnboarding) {
    return null;
  }

  // The user is on the connected dashboard view, which means they've already
  // finished onboarding — always allow dismiss.
  return <StepperCard onDismiss={handleDismiss} completedSteps={completedSteps} showDismiss />;
}
