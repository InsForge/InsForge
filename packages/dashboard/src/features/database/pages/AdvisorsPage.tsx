import { AlertTriangle, CheckCircle2, Loader2, Scan } from 'lucide-react';
import { Button } from '@insforge/ui';
import { useLocation, useNavigate } from 'react-router-dom';
import { DatabaseStudioSidebarPanel } from '#features/database/components/DatabaseSidebar';
import { useAdvisorScan } from '#features/database/hooks/useAdvisorScan';
import type { AdvisorFinding, AdvisorSeverity } from '#features/database/services/advisor.service';

function formatScanTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function getSeverityClass(severity: AdvisorSeverity) {
  switch (severity) {
    case 'critical':
      return 'border-red-500/30 bg-red-500/10 text-red-500';
    case 'warning':
      return 'border-yellow-500/30 bg-yellow-500/10 text-yellow-500';
    case 'info':
      return 'border-blue-500/30 bg-blue-500/10 text-blue-500';
  }
}

function formatCategory(value: AdvisorFinding['category']) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export default function AdvisorsPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { runScan, isScanning, result, error } = useAdvisorScan();

  const handleRunScan = () => {
    runScan();
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
            {isScanning ? (
              <div className="flex min-h-10 items-center gap-2 rounded border border-border bg-[rgb(var(--semantic-1))] px-4 py-2 text-sm font-medium text-foreground">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                Scanning database...
              </div>
            ) : (
              <Button className="gap-2" onClick={handleRunScan}>
                <Scan className="h-4 w-4" />
                Run scan now
              </Button>
            )}
          </div>

          {result ? (
            <div className="rounded border border-border bg-[rgb(var(--semantic-2))] p-5">
              <div className="flex flex-col gap-4">
                <div className="flex items-start gap-3">
                  {result.errors.length > 0 ? (
                    <AlertTriangle className="mt-0.5 h-5 w-5 text-yellow-500" />
                  ) : (
                    <CheckCircle2 className="mt-0.5 h-5 w-5 text-green-500" />
                  )}
                  <div className="min-w-0">
                    <h2 className="text-base font-medium leading-6 text-foreground">
                      Scan finished
                    </h2>
                    <p className="text-sm leading-6 text-muted-foreground">
                      {formatScanTime(result.scannedAt)}
                    </p>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-4">
                  <div className="rounded border border-border bg-[rgb(var(--semantic-1))] p-3">
                    <p className="text-xs leading-4 text-muted-foreground">Total findings</p>
                    <p className="text-2xl font-medium leading-8 text-foreground">
                      {result.summary.total}
                    </p>
                  </div>
                  <div className="rounded border border-border bg-[rgb(var(--semantic-1))] p-3">
                    <p className="text-xs leading-4 text-muted-foreground">Critical</p>
                    <p className="text-2xl font-medium leading-8 text-red-500">
                      {result.summary.critical}
                    </p>
                  </div>
                  <div className="rounded border border-border bg-[rgb(var(--semantic-1))] p-3">
                    <p className="text-xs leading-4 text-muted-foreground">Warnings</p>
                    <p className="text-2xl font-medium leading-8 text-yellow-500">
                      {result.summary.warning}
                    </p>
                  </div>
                  <div className="rounded border border-border bg-[rgb(var(--semantic-1))] p-3">
                    <p className="text-xs leading-4 text-muted-foreground">Info</p>
                    <p className="text-2xl font-medium leading-8 text-blue-500">
                      {result.summary.info}
                    </p>
                  </div>
                </div>

                {result.errors.length > 0 ? (
                  <div className="rounded border border-yellow-500/30 bg-yellow-500/10 p-3">
                    <p className="text-sm font-medium leading-5 text-foreground">
                      {result.errors.length} rule error{result.errors.length === 1 ? '' : 's'}
                    </p>
                    <p className="text-sm leading-6 text-muted-foreground">
                      Some advisor rules could not complete. Check backend logs for full details.
                    </p>
                  </div>
                ) : null}

                <div className="flex flex-col gap-3">
                  <h2 className="text-base font-medium leading-6 text-foreground">Scan results</h2>

                  {result.findings.length === 0 ? (
                    <div className="rounded border border-green-500/30 bg-green-500/10 p-4">
                      <p className="text-sm font-medium leading-5 text-foreground">
                        No advisor findings
                      </p>
                      <p className="text-sm leading-6 text-muted-foreground">
                        The scan did not find security, performance, or health issues.
                      </p>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-3">
                      {result.findings.map((finding) => (
                        <div
                          key={finding.id}
                          className="rounded border border-border bg-[rgb(var(--semantic-1))] p-4"
                        >
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <h3 className="text-sm font-medium leading-5 text-foreground">
                                  {finding.title}
                                </h3>
                                <span
                                  className={`rounded border px-2 py-0.5 text-xs font-medium leading-4 ${getSeverityClass(
                                    finding.severity
                                  )}`}
                                >
                                  {finding.severity}
                                </span>
                                <span className="rounded border border-border bg-[rgb(var(--semantic-2))] px-2 py-0.5 text-xs font-medium leading-4 text-muted-foreground">
                                  {formatCategory(finding.category)}
                                </span>
                              </div>

                              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                                {finding.description}
                              </p>

                              {finding.affectedObject ? (
                                <p className="mt-2 break-all text-xs leading-5 text-muted-foreground">
                                  Affected: {finding.affectedObject}
                                </p>
                              ) : null}

                              {finding.recommendation ? (
                                <p className="mt-2 text-sm leading-6 text-foreground">
                                  {finding.recommendation}
                                </p>
                              ) : null}
                            </div>

                            <span className="shrink-0 rounded bg-[rgb(var(--semantic-2))] px-2 py-1 font-mono text-xs leading-4 text-muted-foreground">
                              {finding.ruleId}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : null}

          {error ? (
            <div className="rounded border border-red-500/30 bg-red-500/10 p-4">
              <p className="text-sm font-medium leading-5 text-foreground">Scan failed</p>
              <p className="text-sm leading-6 text-muted-foreground">{error.message}</p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
