import { Loader2 } from 'lucide-react';
import { JoinDiscordCta } from './JoinDiscordCta';

export function ProjectRestoringPage() {
  return (
    <div className="flex min-h-full min-w-0 flex-1 items-center justify-center bg-[rgb(var(--semantic-1))] px-4 py-8">
      <section className="w-full max-w-[612px] overflow-hidden rounded-[4px] border border-[var(--alpha-8)] bg-card">
        <div className="flex items-center gap-2 p-4">
          <Loader2 className="size-4 animate-spin stroke-[1.5] text-foreground" />
          <h2 className="text-base font-medium leading-7 text-foreground">Restore in Progress</h2>
        </div>

        <div className="px-4 pb-6">
          <p className="text-sm leading-6 text-muted-foreground">
            Restoration can take anywhere from a few minutes to several hours, depending on your
            database size. Your project will be offline while the restore is in progress. You can
            safely leave this page
          </p>
        </div>

        <div className="flex items-center justify-end border-t border-[var(--alpha-8)] p-4">
          <JoinDiscordCta className="justify-end" />
        </div>
      </section>
    </div>
  );
}
