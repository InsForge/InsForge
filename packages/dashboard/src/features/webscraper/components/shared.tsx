import { Badge, cn } from '@insforge/ui';

export const APIFY_CONSOLE_URL = 'https://console.apify.com';

export function fmtTime(iso: string | null): string {
  if (!iso) {
    return '—';
  }
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

export function fmtCost(usd: number | null | undefined): string {
  return typeof usd === 'number' ? `$${usd.toFixed(2)}` : '—';
}

// Run status as a colored badge, mirroring the auth grid's email-verified badge.
// Green = succeeded, red = failed/aborted/timed-out, amber = in-progress,
// muted = anything else.
export function RunStatusBadge({ status }: { status: string | null }) {
  const s = status ?? 'UNKNOWN';
  const tone =
    s === 'SUCCEEDED'
      ? 'bg-[rgb(var(--success))]'
      : s === 'FAILED' || s === 'ABORTED' || s === 'TIMED-OUT'
        ? 'bg-[rgb(var(--destructive))]'
        : s === 'RUNNING' || s === 'READY'
          ? 'bg-[rgb(var(--warning))]'
          : 'bg-muted-foreground';
  return (
    <Badge
      className={cn(
        'h-5 shrink-0 rounded px-1.5 py-0 text-xs font-medium leading-4 text-white',
        tone
      )}
    >
      {s}
    </Badge>
  );
}

// Entry prompt: paste into a coding agent to kick off a scrape via the skill.
export const SCRAPE_PROMPT =
  'Use the insforge webscraper apify skill to scrape <what you want> and return the results.';
