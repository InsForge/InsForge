import { useState, useRef, useEffect } from 'react';
import { ExternalLink } from 'lucide-react';
import { CopyButton, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@insforge/ui';
import { useProjectId } from '../../../../lib/hooks/useMetadata';
import { useCloudProjectInfo } from '../../../../lib/hooks/useCloudProjectInfo';
import { cn } from '../../../../lib/utils/utils';

interface StepProps {
  number: number;
  title: string;
  description: string;
  isLast?: boolean;
  children: React.ReactNode;
}

function Step({ number, title, description, isLast = false, children }: StepProps) {
  return (
    <div className="flex w-full gap-3">
      {/* Step indicator column */}
      <div className="flex shrink-0 flex-col items-center">
        <div className="flex size-7 items-center justify-center rounded-full border border-alpha-16 bg-toast text-sm text-foreground">
          {number}
        </div>
        {!isLast && <div className="w-px flex-1 bg-alpha-16" />}
      </div>

      {/* Step content */}
      <div className={cn('flex min-w-0 flex-1 flex-col gap-3', !isLast && 'pb-10')}>
        <div className="flex flex-col pl-1">
          <p className="text-base font-medium leading-7 text-foreground">{title}</p>
          <p className="text-sm leading-6 text-muted-foreground">{description}</p>
        </div>
        {children}
      </div>
    </div>
  );
}

interface CommandBoxProps {
  command: string;
}

function CommandBox({ command }: CommandBoxProps) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  const handleBoxClick = async () => {
    try {
      await navigator.clipboard.writeText(command);
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      setCopied(true);
      timerRef.current = setTimeout(() => {
        setCopied(false);
        timerRef.current = null;
      }, 3000);
    } catch (error) {
      console.error(error);
    }
  };

  return (
    <TooltipProvider>
      <Tooltip open={copied}>
        <TooltipTrigger asChild>
          <div
            role="button"
            tabIndex={0}
            onClick={() => void handleBoxClick()}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                void handleBoxClick();
              }
            }}
            className="flex w-full cursor-pointer items-center rounded border border-[var(--border)] bg-semantic-0 py-1.5 pl-3 pr-1.5 transition-colors hover:border-[var(--alpha-16)] hover:bg-[var(--alpha-4)]"
          >
            <div className="flex min-w-0 flex-1 items-center gap-3 whitespace-nowrap px-1 font-mono text-sm leading-5">
              <span className="shrink-0 text-muted-foreground">$</span>
              <span className="overflow-hidden text-ellipsis text-foreground">{command}</span>
            </div>
            <CopyButton
              text={command}
              showText
              className="h-7 shrink-0 gap-1.5 rounded bg-[var(--alpha-8)] px-2 text-sm font-normal text-muted-foreground before:hidden hover:bg-[var(--alpha-12)] hover:text-foreground"
            />
          </div>
        </TooltipTrigger>
        <TooltipContent>Copied!</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

interface NewCLISectionProps {
  className?: string;
  isCTest?: boolean;
  /** Hide the internal "Get Started" header. Parent should already render a title. */
  hideHeader?: boolean;
}

export function NewCLISection({
  className,
  isCTest = false,
  hideHeader = false,
}: NewCLISectionProps) {
  const { projectId } = useProjectId();
  const { projectInfo } = useCloudProjectInfo();

  const projectName = (projectInfo.name || 'my-app').replace(/\s+/g, '-');
  const createCommand = `npx @insforge/cli link --project-id ${projectId || '<project id>'}`;
  const devCommand = `cd ${projectName} && npm run dev`;

  return (
    <div
      className={cn(
        'flex w-full max-w-[640px] flex-col gap-6 rounded border border-[var(--alpha-8)] bg-card p-6',
        className
      )}
    >
      {/* Header — hidden when isCTest or hideHeader (title is external in those variants) */}
      {!isCTest && !hideHeader && (
        <div className="flex max-w-[640px] flex-col gap-3">
          <h3 className="text-2xl font-medium leading-8 text-foreground">Get Started</h3>
          <p className="text-sm leading-6 text-muted-foreground">
            Run these commands to create a new web app with your credentials.
          </p>
        </div>
      )}

      {/* Steps */}
      <div className="flex flex-col">
        <Step
          number={1}
          title="Build With Your Agent"
          description="Connect your agent and start a new Next.js app with backend pre-configured"
        >
          <CommandBox command={createCommand} />
        </Step>

        <Step
          number={2}
          title="Start the Dev Server"
          description="Navigate to your project and run the development server"
        >
          <CommandBox command={devCommand} />
        </Step>

        <Step
          number={3}
          title="View Your App"
          description="Open your browser to see the app running locally"
          isLast={!isCTest}
        >
          <div className="flex items-center gap-1 pl-1">
            <a
              href="http://localhost:3000"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm leading-6 text-primary underline"
            >
              http://localhost:3000
            </a>
            <ExternalLink className="size-4 text-primary" />
          </div>
        </Step>

        {isCTest && (
          <Step number={4} title="Add a To Do to your app" description="" isLast>
            <></>
          </Step>
        )}
      </div>
    </div>
  );
}
