import { useEffect, useMemo, useState } from 'react';
import { CopyButton } from '@insforge/ui';
import { useProjectId } from '../../../../lib/hooks/useMetadata';
import { useDashboardHost } from '../../../../lib/config/DashboardHostContext';
import { cn } from '../../../../lib/utils/utils';

interface DTestCLISectionProps {
  className?: string;
  agentName?: string;
}

function buildCliPrompt(projectId: string | null | undefined, apiKey: string | null) {
  const id = projectId || '<project id>';
  const loginLine = apiKey ? `npx @insforge/cli login --user-api-key ${apiKey}` : '<placeholder>';
  return [
    "I'm using InsForge as my backend. Login through:",
    '',
    loginLine,
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
  const host = useDashboardHost();
  const onRequestUserApiKey = host.onRequestUserApiKey;

  const [apiKey, setApiKey] = useState<string | null>(null);
  const [isFetchingKey, setIsFetchingKey] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);

  // Mint a fresh key every time this section mounts (entering the CLI tab).
  // Matches the "regenerate on each visit" policy decided for d_test.
  useEffect(() => {
    if (!onRequestUserApiKey) {
      return;
    }
    let cancelled = false;
    setIsFetchingKey(true);
    setKeyError(null);
    onRequestUserApiKey()
      .then((key) => {
        if (!cancelled) {
          setApiKey(key);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setKeyError(err instanceof Error ? err.message : 'Failed to generate API key');
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsFetchingKey(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [onRequestUserApiKey]);

  const prompt = useMemo(() => buildCliPrompt(projectId, apiKey), [projectId, apiKey]);
  const canCopy = Boolean(projectId) && Boolean(apiKey);

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
          <CopyButton text={prompt} showText={false} className="shrink-0" disabled={!canCopy} />
        </div>
        <pre className="m-0 whitespace-pre-wrap break-all font-mono text-sm leading-6 text-foreground">
          {prompt}
        </pre>
        {isFetchingKey && (
          <p className="text-xs leading-4 text-muted-foreground">Generating API key…</p>
        )}
        {keyError && (
          <p className="text-xs leading-4 text-destructive">
            Could not generate API key: {keyError}
          </p>
        )}
      </div>
    </section>
  );
}
