import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Button, CopyButton } from '@insforge/ui';

export function ApiKeyCard({
  apiKey,
  host,
  posthogProjectId,
}: {
  apiKey: string;
  host: string;
  posthogProjectId: string;
}) {
  const [revealed, setRevealed] = useState(false);
  const masked =
    apiKey.length > 8
      ? `${apiKey.slice(0, 4)}${'•'.repeat(apiKey.length - 8)}${apiKey.slice(-4)}`
      : '•'.repeat(apiKey.length);

  return (
    <div className="rounded-lg border p-4">
      <h3 className="mb-3 text-sm font-semibold text-foreground">Project API Key</h3>
      <div className="mb-2 flex items-center gap-2">
        <code
          data-testid="apikey-display"
          className="flex-1 rounded bg-muted px-3 py-2 font-mono text-sm"
        >
          {revealed ? apiKey : masked}
        </code>
        <Button
          variant="ghost"
          size="icon"
          aria-label={revealed ? 'Hide API key' : 'Reveal API key'}
          onClick={() => setRevealed((v) => !v)}
        >
          {revealed ? <EyeOff /> : <Eye />}
        </Button>
        <CopyButton text={apiKey} showText={false} aria-label="Copy API key" />
      </div>
      <div className="space-y-1 text-xs text-muted-foreground">
        <div>
          Host: <code>{host}</code>
        </div>
        <div>
          Project ID: <code>{posthogProjectId}</code>
        </div>
      </div>
    </div>
  );
}
