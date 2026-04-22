import { useMemo } from 'react';
import { CopyButton } from '@insforge/ui';
import { useProjectId } from '../../../../lib/hooks/useMetadata';
import { cn } from '../../../../lib/utils/utils';

interface DTestCLISectionProps {
  className?: string;
  agentName?: string;
}

function buildCliPrompt(projectId: string | null | undefined) {
  const id = projectId || '<project id>';
  return [
    "I'm using InsForge as my backend. Login through:",
    '',
    '<placeholder>',
    '',
    'Then install the InsForge CLI and skills for this project, and link it with:',
    '',
    `npx @insforge/cli link --project-id ${id}`,
    '',
    'Use the InsForge CLI and skills for backend tasks.',
  ].join('\n');
}

export function DTestCLISection({ className, agentName }: DTestCLISectionProps) {
  const { projectId } = useProjectId();
  const hasProjectId = Boolean(projectId);
  const prompt = useMemo(() => buildCliPrompt(projectId), [projectId]);

  return (
    <section
      className={cn(
        'flex flex-col gap-3 rounded border border-[var(--alpha-8)] bg-card p-6',
        className
      )}
    >
      <div className="flex flex-col gap-1">
        <p className="text-base font-medium leading-7 text-foreground">Copy the setup prompt</p>
        <p className="text-sm leading-5 text-muted-foreground">
          Paste this into {agentName || 'your agent'} to install InsForge CLI and skills.
        </p>
      </div>

      <div className="flex flex-col gap-2 rounded border border-[var(--alpha-8)] bg-semantic-1 p-3">
        <div className="flex items-center justify-between">
          <span className="rounded bg-[var(--alpha-8)] px-2 py-0.5 text-xs font-medium leading-4 text-muted-foreground">
            Prompt
          </span>
          <CopyButton
            text={prompt}
            showText={false}
            className="shrink-0"
            disabled={!hasProjectId}
          />
        </div>
        <pre className="m-0 whitespace-pre-wrap break-all font-mono text-sm leading-6 text-foreground">
          {prompt}
        </pre>
      </div>
    </section>
  );
}
