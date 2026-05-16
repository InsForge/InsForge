import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, RefreshCw, ShieldCheck } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@insforge/ui';
import { EmptyState, TableHeader } from '#components';
import { DatabaseStudioSidebarPanel } from '#features/database/components/DatabaseSidebar';
import { useAdvisorScan } from '#features/database/hooks/useAdvisorScan';
import { cn } from '#lib/utils/utils';
import type {
  AdvisorCategory,
  AdvisorFinding,
  AdvisorScanResponse,
} from '@insforge/shared-schemas';

type CategoryFilter = 'all' | AdvisorCategory;

const CATEGORY_FILTERS: Array<{ id: CategoryFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'security', label: 'Security' },
  { id: 'performance', label: 'Performance' },
  { id: 'health', label: 'Health' },
];

function severityClass(severity: AdvisorFinding['severity']) {
  if (severity === 'critical') {
    return 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300';
  }
  if (severity === 'warning') {
    return 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300';
  }
  return 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300';
}

function categoryClass(category: AdvisorCategory) {
  if (category === 'security') {
    return 'border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300';
  }
  if (category === 'performance') {
    return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
  }
  return 'border-slate-500/30 bg-slate-500/10 text-slate-700 dark:text-slate-300';
}

function Badge({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex h-6 items-center rounded border px-2 text-xs font-medium leading-none',
        className
      )}
    >
      {children}
    </span>
  );
}

function SummaryTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'critical' | 'warning' | 'info' | 'default';
}) {
  const toneClass =
    tone === 'critical'
      ? 'text-red-600 dark:text-red-300'
      : tone === 'warning'
        ? 'text-amber-600 dark:text-amber-300'
        : tone === 'info'
          ? 'text-sky-600 dark:text-sky-300'
          : 'text-foreground';

  return (
    <div className="min-w-0 rounded border border-border bg-[rgb(var(--semantic-0))] px-3 py-2">
      <div className={cn('text-lg font-semibold leading-7', toneClass)}>{value}</div>
      <div className="truncate text-xs leading-4 text-muted-foreground">{label}</div>
    </div>
  );
}

function FindingRow({ finding }: { finding: AdvisorFinding }) {
  const objectLabel = [finding.schemaName, finding.tableName, finding.objectName]
    .filter(Boolean)
    .join(' / ');

  return (
    <div className="border-b border-[var(--alpha-8)] px-4 py-3 last:border-b-0">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Badge className={severityClass(finding.severity)}>{finding.severity}</Badge>
        <Badge className={categoryClass(finding.category)}>{finding.category}</Badge>
        <span className="truncate text-sm font-medium leading-5 text-foreground">
          {finding.title}
        </span>
      </div>
      <p className="mt-2 text-sm leading-5 text-muted-foreground">{finding.message}</p>
      <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-xs leading-4 text-muted-foreground">
        <span className="font-mono">{finding.ruleId}</span>
        {objectLabel && <span className="truncate">{objectLabel}</span>}
      </div>
      <p className="mt-2 text-sm leading-5 text-foreground">{finding.remediation}</p>
    </div>
  );
}

function AdvisorContent({
  result,
  activeCategory,
  onCategoryChange,
}: {
  result: AdvisorScanResponse;
  activeCategory: CategoryFilter;
  onCategoryChange: (category: CategoryFilter) => void;
}) {
  const findings = useMemo(() => {
    if (activeCategory === 'all') {
      return result.findings;
    }
    return result.findings.filter((finding) => finding.category === activeCategory);
  }, [activeCategory, result.findings]);

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="grid grid-cols-2 gap-3 border-b border-[var(--alpha-8)] bg-[rgb(var(--semantic-1))] p-4 md:grid-cols-6">
        <SummaryTile label="Findings" value={result.findingCount} tone="default" />
        <SummaryTile label="Critical" value={result.summary.critical} tone="critical" />
        <SummaryTile label="Warnings" value={result.summary.warning} tone="warning" />
        <SummaryTile label="Info" value={result.summary.info} tone="info" />
        <SummaryTile label="Security" value={result.summary.security} tone="default" />
        <SummaryTile label="Performance" value={result.summary.performance} tone="default" />
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--alpha-8)] bg-[rgb(var(--semantic-0))] px-4 py-3">
        {CATEGORY_FILTERS.map((filter) => (
          <Button
            key={filter.id}
            variant={activeCategory === filter.id ? 'primary' : 'outline'}
            size="sm"
            className="h-8 rounded"
            onClick={() => onCategoryChange(filter.id)}
          >
            {filter.label}
          </Button>
        ))}
        <span className="ml-auto text-xs leading-4 text-muted-foreground">
          Scanned {new Date(result.scannedAt).toLocaleString()}
        </span>
      </div>

      {findings.length === 0 ? (
        <div className="flex min-h-[320px] items-center justify-center">
          <EmptyState
            title="No advisor findings"
            description={
              activeCategory === 'all'
                ? 'All enabled advisor rules passed.'
                : `No ${activeCategory} findings in the latest scan.`
            }
          />
        </div>
      ) : (
        <div className="bg-[rgb(var(--semantic-0))]">
          {findings.map((finding) => (
            <FindingRow key={finding.id} finding={finding} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function AdvisorsPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [activeCategory, setActiveCategory] = useState<CategoryFilter>('all');
  const advisorScan = useAdvisorScan();
  const result = advisorScan.data;
  const isScanning = advisorScan.isPending;

  const runScan = () => {
    setActiveCategory('all');
    advisorScan.mutate();
  };

  const rightActions = (
    <Button className="h-8 rounded gap-2" onClick={runScan} disabled={isScanning}>
      <RefreshCw className={cn('h-4 w-4', isScanning && 'animate-spin')} />
      {isScanning ? 'Scanning' : 'Run scan now'}
    </Button>
  );

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
      <div className="min-w-0 flex-1 flex flex-col overflow-hidden bg-[rgb(var(--semantic-1))]">
        <TableHeader
          title="Database Advisors"
          showDividerAfterTitle
          leftSlot={
            result ? (
              <div className="flex items-center gap-2 text-xs leading-4 text-muted-foreground">
                {result.findingCount === 0 ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                ) : (
                  <AlertTriangle className="h-4 w-4 text-amber-500" />
                )}
                {result.durationMs} ms
              </div>
            ) : undefined
          }
          rightActions={rightActions}
          showSearch={false}
        />

        {advisorScan.error ? (
          <div className="flex min-h-0 flex-1 items-center justify-center">
            <EmptyState
              title="Advisor scan failed"
              description={
                advisorScan.error instanceof Error ? advisorScan.error.message : 'An error occurred'
              }
            />
          </div>
        ) : result ? (
          <AdvisorContent
            result={result}
            activeCategory={activeCategory}
            onCategoryChange={setActiveCategory}
          />
        ) : (
          <div className="flex min-h-0 flex-1 items-center justify-center">
            <div className="flex max-w-md flex-col items-center gap-4 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded border border-border bg-[rgb(var(--semantic-0))]">
                <ShieldCheck className="h-6 w-6 text-muted-foreground" />
              </div>
              <EmptyState
                title={isScanning ? 'Scanning database...' : 'No advisor scan yet'}
                description={
                  isScanning
                    ? 'Checking security, performance, and health rules.'
                    : 'Run a scan to review the current database state.'
                }
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
