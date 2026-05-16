import { Scan } from 'lucide-react';
import { Button } from '@insforge/ui';
import { useLocation, useNavigate } from 'react-router-dom';
import { DatabaseStudioSidebarPanel } from '#features/database/components/DatabaseSidebar';

export default function AdvisorsPage() {
  const location = useLocation();
  const navigate = useNavigate();

  const handleRunScan = () => {
    return undefined;
  };

  return (
    <div className="flex h-full min-h-0 overflow-hidden bg-[rgb(var(--semantic-1))]">
      <DatabaseStudioSidebarPanel
        onBack={() =>
          void navigate(
            {
              pathname: '/dashboard/database/tables',
              search: location.search,
            },
            { state: { slideFromStudio: true } }
          )
        }
      />
      <div className="min-w-0 flex-1 overflow-auto bg-[rgb(var(--semantic-1))]">
        <div className="mx-auto flex w-full max-w-[1024px] flex-col gap-6 px-4 pb-10 pt-8 sm:px-6 sm:pt-10 lg:px-10">
          <div className="flex flex-col gap-2">
            <h1 className="text-2xl font-medium leading-8 text-foreground">Database Advisors</h1>
            <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
              Scan the database for security, performance, and health recommendations.
            </p>
          </div>

          <div className="flex min-h-[220px] flex-col items-start justify-center gap-5 rounded border border-border bg-[rgb(var(--semantic-2))] px-6 py-8">
            <div className="flex h-12 w-12 items-center justify-center rounded bg-primary/10 text-primary">
              <Scan className="h-6 w-6" />
            </div>
            <div className="flex flex-col gap-1">
              <h2 className="text-lg font-medium leading-7 text-foreground">Run advisor scan</h2>
              <p className="max-w-xl text-sm leading-6 text-muted-foreground">
                Check row-level security, indexes, slow queries, and database health signals.
              </p>
            </div>
            <Button className="gap-2" onClick={handleRunScan}>
              <Scan className="h-4 w-4" />
              Run scan now
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
