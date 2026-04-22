import { useMemo, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { CopyButton } from '@insforge/ui';
import { useProjectId } from '../../../../lib/hooks/useMetadata';
import { cn } from '../../../../lib/utils/utils';

interface DTestCLISectionProps {
  apiKey: string;
  className?: string;
}

const maskedApiKey = (key: string) =>
  key ? `${key.slice(0, 3)}${'*'.repeat(Math.max(key.length - 3, 8))}` : 'ik_' + '*'.repeat(32);

function buildCliPrompt(projectId: string | null | undefined, apiKey: string) {
  const id = projectId || '<project id>';
  return [
    "I'm using InsForge as my backend. Here's my API key:",
    '',
    apiKey || '<api key>',
    '',
    'Please install the InsForge CLI and skills for this project, and link it with:',
    '',
    `npx @insforge/cli@latest link --project-id ${id}`,
    '',
    'Then use the InsForge CLI and skills for backend tasks.',
  ].join('\n');
}

export function DTestCLISection({ apiKey, className }: DTestCLISectionProps) {
  const { projectId } = useProjectId();
  const [showApiKey, setShowApiKey] = useState(false);

  const fullPrompt = useMemo(() => buildCliPrompt(projectId, apiKey), [projectId, apiKey]);
  const displayPrompt = useMemo(
    () => (showApiKey ? fullPrompt : buildCliPrompt(projectId, maskedApiKey(apiKey))),
    [fullPrompt, projectId, apiKey, showApiKey]
  );

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
          Paste this into your agent to install InsForge CLI and skills.
        </p>
      </div>

      <div className="flex flex-col gap-2 rounded border border-[var(--alpha-8)] bg-semantic-1 p-3">
        <div className="flex items-center justify-between">
          <span className="rounded bg-[var(--alpha-8)] px-2 py-0.5 text-xs font-medium leading-4 text-muted-foreground">
            Prompt
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowApiKey((v) => !v)}
              className="inline-flex h-5 items-center gap-1 rounded text-xs font-normal leading-4 text-muted-foreground transition-colors hover:text-foreground"
              aria-pressed={showApiKey}
              aria-label={`${showApiKey ? 'Hide' : 'Show'} API key`}
            >
              {showApiKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              <span>{showApiKey ? 'Hide' : 'Show'} API Key</span>
            </button>
            <CopyButton text={fullPrompt} showText={false} className="shrink-0" />
          </div>
        </div>
        <pre className="m-0 whitespace-pre-wrap break-all font-mono text-sm leading-6 text-foreground">
          {displayPrompt}
        </pre>
      </div>
    </section>
  );
}
