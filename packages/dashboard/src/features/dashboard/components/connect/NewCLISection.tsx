import { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { Badge, CopyButton, Tabs, Tab } from '@insforge/ui';
import { useProjectId } from '../../../../lib/hooks/useMetadata';
import { cn } from '../../../../lib/utils/utils';

type OnboardingMode = 'template' | 'empty';

interface StepProps {
  number: number;
  title: string;
  description: string;
  isLast?: boolean;
  children: React.ReactNode;
}

function Step({ number, title, description, isLast = false, children }: StepProps) {
  return (
    <div className="flex gap-3 w-full">
      {/* Step indicator column */}
      <div className="flex flex-col items-center shrink-0">
        <div className="flex items-center justify-center size-7 rounded-full bg-toast border border-alpha-16 text-sm text-foreground">
          {number}
        </div>
        {!isLast && <div className="flex-1 w-px bg-alpha-16" />}
      </div>

      {/* Step content */}
      <div className={cn('flex-1 flex flex-col gap-3 min-w-0', !isLast && 'pb-10')}>
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
  return (
    <div className="flex items-center w-full rounded border border-[var(--border)] bg-semantic-0 pl-3 pr-1.5 py-1.5">
      <div className="flex-1 flex items-center gap-3 min-w-0 px-1 font-mono text-sm leading-5 whitespace-nowrap">
        <span className="text-muted-foreground shrink-0">$</span>
        <span className="text-foreground overflow-hidden text-ellipsis">{command}</span>
      </div>
      <CopyButton
        text={command}
        showText
        className="shrink-0 h-7 bg-[var(--alpha-8)] text-muted-foreground rounded px-2 gap-1.5 text-sm font-normal before:hidden hover:bg-[var(--alpha-12)] hover:text-foreground"
      />
    </div>
  );
}

interface NewCLISectionProps {
  className?: string;
}

export function NewCLISection({ className }: NewCLISectionProps) {
  const { projectId } = useProjectId();
  const [mode, setMode] = useState<OnboardingMode>('template');

  const projectName = 'my-app';
  const createCommand = `npx @insforge/cli link --project-id ${projectId || '<project id>'} --template todo`;
  const linkCommand = `npx @insforge/cli link --project-id ${projectId || '<project id>'}`;
  const devCommand = `cd ${projectName} && npm run dev`;

  return (
    <div className={cn('flex flex-col gap-6 items-center w-full', className)}>
      {/* Title */}
      <div className="flex flex-col items-start w-full max-w-[640px]">
        <h3 className="text-2xl font-medium leading-8 text-foreground text-center w-full">
          Get Started
        </h3>
      </div>

      {/* Mode toggle */}
      <Tabs
        value={mode}
        onValueChange={(v: string) => setMode(v as OnboardingMode)}
        className="w-full max-w-[640px]"
      >
        <Tab value="template" className="flex-1">
          <span>App Template</span>
          <Badge className="bg-[var(--alpha-8)] text-primary text-xs px-2 py-0.5 rounded">
            For Beginner
          </Badge>
        </Tab>
        <Tab value="empty" className="flex-1">
          Empty Project
        </Tab>
      </Tabs>

      {/* Stepper card */}
      <div className="w-full max-w-[640px] rounded border border-[var(--alpha-8)] bg-card">
        <div className="flex flex-col p-6">
          {mode === 'template' ? (
            <>
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
                isLast
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
            </>
          ) : (
            <>
              <Step
                number={1}
                title="Link Your Project"
                description="Run the following command in your terminal to connect your project"
              >
                <CommandBox command={linkCommand} />
              </Step>

              <Step
                number={2}
                title="Start Building"
                description="Use InsForge CLI or MCP tools to interact with your backend"
                isLast
              >
                <CommandBox command="npx @insforge/cli --help" />
              </Step>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
