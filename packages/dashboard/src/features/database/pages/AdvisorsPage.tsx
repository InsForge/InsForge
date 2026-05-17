import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, Scan, AlertCircle, Copy, Check } from 'lucide-react';
import { Button } from '@insforge/ui';
import { useLocation, useNavigate } from 'react-router-dom';
import { DatabaseStudioSidebarPanel } from '#features/database/components/DatabaseSidebar';
import { useAdvisorLatestScan, useAdvisorScan } from '#features/database/hooks/useAdvisorScan';
import { DEFAULT_DATABASE_SCHEMA } from '#features/database/helpers';
import type {
  AdvisorCategory,
  AdvisorFinding,
  AdvisorSeverity,
} from '#features/database/services/advisor.service';

const categoryFilters: Array<{ value: AdvisorCategory | 'all'; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'security', label: 'Security' },
  { value: 'performance', label: 'Performance' },
  { value: 'health', label: 'Health' },
];

function formatScanTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function getSeverityClass(severity: AdvisorSeverity) {
  switch (severity) {
    case 'critical':
      return 'border-red-600 bg-red-600 text-white';
    case 'warning':
      return 'border-amber-400 bg-amber-400 text-amber-950';
    case 'info':
      return 'border-blue-600 bg-blue-600 text-white';
  }
}

function formatCategory(value: AdvisorFinding['category']) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function getMetadataString(finding: AdvisorFinding, key: string): string | null {
  const value = finding.metadata?.[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function getMetadataNumber(finding: AdvisorFinding, key: string): number | null {
  const value = finding.metadata?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function getMetadataStringArray(finding: AdvisorFinding, key: string): string[] {
  const value = finding.metadata?.[key];
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === 'string');
}

function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function createIndexName(parts: string[]): string {
  return parts
    .join('_')
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
}

function getAffectedTable(
  finding: AdvisorFinding
): { schemaName: string; tableName: string } | null {
  const tableName = getMetadataString(finding, 'table');
  if (tableName) {
    return {
      schemaName: getMetadataString(finding, 'schema') ?? DEFAULT_DATABASE_SCHEMA,
      tableName,
    };
  }

  if (!finding.affectedObject) {
    return null;
  }

  const parts = finding.affectedObject.split('.');
  if (parts.length !== 2) {
    return null;
  }

  const [schemaName, parsedTableName] = parts;
  if (!schemaName || !parsedTableName || parsedTableName.includes('(')) {
    return null;
  }

  return { schemaName, tableName: parsedTableName };
}

function getFriendlyDescription(finding: AdvisorFinding): string {
  switch (finding.ruleId) {
    case 'rls-select-only':
      return 'This table has security policies written but RLS is switched off. The policies exist, but PostgreSQL is ignoring them, so rows can be exposed.';
    case 'rls-disabled':
      return 'This public table does not have row-level security enabled. Without RLS, table access depends only on broad database permissions.';
    case 'rls-no-policy':
      return 'RLS is enabled on this table, but no policies exist yet. Normal application users may be blocked until you define who can read or write rows.';
    case 'dangerous-function':
      return 'This function does not lock its search path. A caller-controlled search path can make the function resolve the wrong object at runtime.';
    case 'rls-permissive':
      return 'This table has more than one permissive policy for the same role and action. PostgreSQL has to evaluate overlapping policies, and the access model becomes harder to reason about.';
    case 'missing-fk-index':
      return 'This foreign key is missing a matching index. Updates or deletes on the referenced table can become slow as data grows.';
    case 'unused-index':
      return 'This index has not been used by recorded queries. It may be adding write overhead without helping reads.';
    case 'slow-query':
      return 'This query is averaging more than one second. It is worth checking the query plan and indexes before it becomes a user-facing bottleneck.';
    case 'connection-high':
      return 'Database connection usage is above the warning threshold. New requests may start queueing if usage keeps rising.';
    case 'connection-critical':
      return 'Database connection usage is near the maximum. The app can start failing new database requests.';
    case 'idle-in-transaction':
      return 'A client opened a transaction and then stopped doing work. This can hold locks and prevent cleanup.';
    case 'low-cache-hit-ratio':
      return 'Postgres is reading too much from disk instead of memory cache. Queries may feel slower than expected.';
    case 'long-running-query':
      return 'A query has been running for more than five minutes. It may be blocked, inefficient, or affecting other work.';
    case 'rls-policy-perf':
      return 'This RLS policy calls auth.uid() directly for each row. Wrapping it in a SELECT lets Postgres evaluate it once per statement.';
    case 'missing-rls-index':
      return 'This RLS policy filters by a column that is not indexed. User queries can turn into full table scans.';
    case 'dead-tuples':
      return 'This table has many dead rows waiting for cleanup. Vacuuming can recover space and improve query planning.';
    case 'stale-statistics':
      return 'The planner statistics for this table are old. Postgres may choose poor query plans until the table is analyzed.';
    case 'sequence-exhaustion':
      return 'This sequence is close to running out of available values. Inserts using it can fail once it is exhausted.';
    case 'autovacuum-blocked':
      return 'Autovacuum is blocked while trying to maintain a table. Cleanup cannot finish until the blocking session is resolved.';
    default:
      return finding.description;
  }
}

function getSqlRemediation(finding: AdvisorFinding): string | null {
  const affectedTable = getAffectedTable(finding);
  const qualifiedTable = affectedTable
    ? `${quoteIdentifier(affectedTable.schemaName)}.${quoteIdentifier(affectedTable.tableName)}`
    : null;

  switch (finding.ruleId) {
    case 'rls-disabled':
    case 'rls-select-only':
      return qualifiedTable ? `ALTER TABLE ${qualifiedTable} ENABLE ROW LEVEL SECURITY;` : null;
    case 'rls-no-policy':
      return qualifiedTable
        ? `CREATE POLICY "allow_owner_access" ON ${qualifiedTable} FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);`
        : null;
    case 'dangerous-function': {
      const schemaName = getMetadataString(finding, 'schema') ?? DEFAULT_DATABASE_SCHEMA;
      const functionName = getMetadataString(finding, 'function');
      const argumentsList = getMetadataString(finding, 'arguments') ?? '';
      return functionName
        ? `ALTER FUNCTION ${quoteIdentifier(schemaName)}.${quoteIdentifier(functionName)}(${argumentsList}) SET search_path = public, pg_temp;`
        : null;
    }
    case 'rls-permissive': {
      const policies = getMetadataStringArray(finding, 'policies');
      const policyToDrop = policies[1] ?? policies[0] ?? 'duplicate_policy_name';
      return qualifiedTable
        ? `DROP POLICY ${quoteIdentifier(policyToDrop)} ON ${qualifiedTable};`
        : null;
    }
    case 'unused-index': {
      const schemaName = getMetadataString(finding, 'schema') ?? DEFAULT_DATABASE_SCHEMA;
      const indexName = getMetadataString(finding, 'index');
      return indexName
        ? `DROP INDEX CONCURRENTLY IF EXISTS ${quoteIdentifier(schemaName)}.${quoteIdentifier(indexName)};`
        : null;
    }
    case 'missing-rls-index': {
      const columnName = getMetadataString(finding, 'column');
      if (!qualifiedTable || !affectedTable || !columnName) {
        return null;
      }

      const indexName = createIndexName(['idx', affectedTable.tableName, columnName, 'rls']);
      return `CREATE INDEX CONCURRENTLY IF NOT EXISTS ${quoteIdentifier(indexName)} ON ${qualifiedTable} (${quoteIdentifier(columnName)});`;
    }
    case 'dead-tuples':
      return qualifiedTable ? `VACUUM (ANALYZE) ${qualifiedTable};` : null;
    case 'stale-statistics':
      return qualifiedTable ? `ANALYZE ${qualifiedTable};` : null;
    case 'long-running-query': {
      const pid = getMetadataNumber(finding, 'pid');
      return pid ? `SELECT pg_cancel_backend(${pid});` : null;
    }
    case 'idle-in-transaction': {
      const pid = getMetadataNumber(finding, 'pid');
      return pid ? `SELECT pg_terminate_backend(${pid});` : null;
    }
    default:
      return null;
  }
}

export default function AdvisorsPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [categoryFilter, setCategoryFilter] = useState<AdvisorCategory | 'all'>('all');
  const [copiedFindingId, setCopiedFindingId] = useState<string | null>(null);
  const { data: latestResult, isLoading: isLatestLoading } = useAdvisorLatestScan();
  const { runScan, isScanning, result: scanResult, error } = useAdvisorScan();
  const result = scanResult ?? latestResult;
  const filteredFindings = useMemo(() => {
    if (!result) {
      return [];
    }

    if (categoryFilter === 'all') {
      return result.findings;
    }

    return result.findings.filter((finding) => finding.category === categoryFilter);
  }, [categoryFilter, result]);

  const handleRunScan = () => {
    runScan();
  };

  const handleCopySql = (findingId: string, sql: string) => {
    void navigator.clipboard.writeText(sql).then(() => {
      setCopiedFindingId(findingId);
      window.setTimeout(() => setCopiedFindingId(null), 1400);
    });
  };

  const handleAffectedObjectClick = (finding: AdvisorFinding) => {
    const affectedTable = getAffectedTable(finding);
    if (!affectedTable) {
      return;
    }

    const nextSearchParams = new URLSearchParams();
    if (affectedTable.schemaName !== DEFAULT_DATABASE_SCHEMA) {
      nextSearchParams.set('schema', affectedTable.schemaName);
    }
    nextSearchParams.set('table', affectedTable.tableName);

    void navigate({
      pathname: '/dashboard/database/tables',
      search: `?${nextSearchParams.toString()}`,
    });
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
                Scanning your database...
              </div>
            ) : (
              <Button className="gap-2" onClick={handleRunScan}>
                <Scan className="h-4 w-4" />
                Run scan now
              </Button>
            )}
          </div>

          {result ? (
            <div className="rounded-lg border border-border bg-[rgb(var(--semantic-2))] p-6 shadow-sm">
              <div className="flex flex-col gap-6">
                <div className="flex items-start gap-4">
                  <div
                    className={`flex rounded-full p-2.5 ${result.errors.length > 0 ? 'bg-yellow-500/10' : 'bg-green-500/10'}`}
                  >
                    {result.errors.length > 0 ? (
                      <AlertTriangle className="h-6 w-6 text-yellow-500" />
                    ) : (
                      <CheckCircle2 className="h-6 w-6 text-green-500" />
                    )}
                  </div>
                  <div className="min-w-0 pt-0.5">
                    <h2 className="text-lg font-semibold text-foreground">Scan finished</h2>
                    <p className="text-sm text-muted-foreground">
                      {formatScanTime(result.scannedAt)}
                    </p>
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-4">
                  <div className="rounded-lg border border-border bg-[rgb(var(--semantic-1))] p-4 shadow-sm">
                    <p className="text-xs font-medium uppercase text-muted-foreground">Total</p>
                    <p className="mt-1 text-2xl font-semibold text-foreground">
                      {result.summary.total}
                    </p>
                  </div>
                  <div className="rounded-lg border border-border bg-[rgb(var(--semantic-1))] p-4 shadow-sm">
                    <p className="text-xs font-medium uppercase text-muted-foreground">Critical</p>
                    <p className="mt-1 text-2xl font-semibold text-red-500">
                      {result.summary.critical}
                    </p>
                  </div>
                  <div className="rounded-lg border border-border bg-[rgb(var(--semantic-1))] p-4 shadow-sm">
                    <p className="text-xs font-medium uppercase text-muted-foreground">Warnings</p>
                    <p className="mt-1 text-2xl font-semibold text-yellow-500">
                      {result.summary.warning}
                    </p>
                  </div>
                  <div className="rounded-lg border border-border bg-[rgb(var(--semantic-1))] p-4 shadow-sm">
                    <p className="text-xs font-medium uppercase text-muted-foreground">Info</p>
                    <p className="mt-1 text-2xl font-semibold text-blue-500">
                      {result.summary.info}
                    </p>
                  </div>
                </div>

                {result.errors.length > 0 ? (
                  <div className="relative w-full rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-4 shadow-sm dark:border-yellow-500/20">
                    <AlertTriangle className="absolute left-4 top-4 h-5 w-5 text-yellow-600 dark:text-yellow-400" />
                    <div className="pl-8">
                      <h3 className="mb-1 text-sm font-semibold leading-none text-yellow-600 dark:text-yellow-400">
                        {result.errors.length} rule error{result.errors.length === 1 ? '' : 's'}
                      </h3>
                      <div className="text-sm text-yellow-700/90 dark:text-yellow-400/90">
                        Some advisor rules could not complete. Check backend logs for full details.
                      </div>
                    </div>
                  </div>
                ) : null}

                <div className="flex flex-col gap-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <h2 className="text-lg font-semibold text-foreground">Scan results</h2>
                    <div className="flex flex-wrap gap-1 rounded border border-border bg-[rgb(var(--semantic-1))] p-1">
                      {categoryFilters.map((filter) => {
                        const isActive = categoryFilter === filter.value;
                        const count = result
                          ? filter.value === 'all'
                            ? result.findings.length
                            : result.findings.filter((f) => f.category === filter.value).length
                          : 0;

                        return (
                          <button
                            key={filter.value}
                            type="button"
                            onClick={() => setCategoryFilter(filter.value)}
                            className={`relative cursor-pointer rounded px-3 py-1.5 text-xs font-medium transition-colors ${
                              isActive
                                ? 'bg-primary text-primary-foreground'
                                : 'text-muted-foreground hover:bg-[rgb(var(--semantic-2))] hover:text-foreground'
                            }`}
                          >
                            {filter.label}
                            {count > 0 ? (
                              <span className="absolute -right-1.5 -top-1.5 flex min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 py-0.5 text-[10px] font-bold leading-none text-white shadow-sm ring-2 ring-[rgb(var(--semantic-1))]">
                                {count}
                              </span>
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {filteredFindings.length === 0 ? (
                    <div className="flex w-full flex-col items-center justify-center rounded-lg border border-green-500/30 bg-green-500/10 px-6 py-10 text-center shadow-sm dark:border-green-500/20">
                      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-green-600 text-white">
                        <CheckCircle2 className="h-6 w-6" />
                      </div>
                      <p className="text-base font-base leading-6 text-green-700 dark:text-green-400">
                        {categoryFilter === 'all'
                          ? 'The latest scan did not find security, performance, or health issues.'
                          : `No ${categoryFilter} issues were found in the latest scan.`}
                      </p>
                    </div>
                  ) : isScanning ? (
                    <div className="flex w-full items-center justify-center gap-3 rounded-lg border border-border bg-[rgb(var(--semantic-1))] px-6 py-10 text-sm font-medium text-foreground shadow-sm">
                      <Loader2 className="h-5 w-5 animate-spin text-primary" />
                      Scanning your database...
                    </div>
                  ) : (
                    <div className="flex flex-col gap-4">
                      {filteredFindings.map((finding) => {
                        const sqlRemediation = getSqlRemediation(finding);
                        const affectedTable = getAffectedTable(finding);

                        return (
                          <div
                            key={finding.id}
                            className="rounded-lg border border-border bg-[rgb(var(--semantic-1))] p-5 shadow-sm transition-shadow hover:shadow-md"
                          >
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <h3 className="text-sm font-medium leading-5 text-foreground">
                                    {finding.title}
                                  </h3>
                                  <span
                                    className={`rounded border px-2 py-0.5 text-xs font-semibold leading-4 ${getSeverityClass(
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
                                  {getFriendlyDescription(finding)}
                                </p>

                                {finding.affectedObject ? (
                                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs leading-5">
                                    <span className="font-medium text-muted-foreground">
                                      Affected
                                    </span>
                                    {affectedTable ? (
                                      <button
                                        type="button"
                                        onClick={() => handleAffectedObjectClick(finding)}
                                        className="max-w-full cursor-pointer break-all rounded border border-primary/30 bg-primary/10 px-2 py-1 font-mono font-medium text-primary transition-colors hover:border-primary hover:bg-primary/15"
                                      >
                                        {finding.affectedObject}
                                      </button>
                                    ) : (
                                      <span className="max-w-full break-all rounded border border-primary/30 bg-primary/10 px-2 py-1 font-mono font-medium text-primary">
                                        {finding.affectedObject}
                                      </span>
                                    )}
                                  </div>
                                ) : null}

                                {sqlRemediation ? (
                                  <div className="mt-4 overflow-hidden rounded border border-border bg-[rgb(var(--semantic-2))]">
                                    <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2">
                                      <span className="text-xs font-medium uppercase text-muted-foreground">
                                        Remediation SQL
                                      </span>
                                      <button
                                        type="button"
                                        onClick={() => handleCopySql(finding.id, sqlRemediation)}
                                        className="flex  cursor-pointer items-center gap-1 rounded border border-border bg-[rgb(var(--semantic-1))] px-2 py-1 text-xs font-medium text-foreground transition-colors hover:bg-[rgb(var(--semantic-3))]"
                                      >
                                        {copiedFindingId === finding.id ? (
                                          <Check className="h-3.5 w-3.5 text-green-500" />
                                        ) : (
                                          <Copy className="h-3.5 w-3.5" />
                                        )}
                                        {copiedFindingId === finding.id ? 'Copied' : 'Copy'}
                                      </button>
                                    </div>
                                    <pre className="overflow-x-auto whitespace-pre-wrap break-words px-3 py-3 font-mono text-xs leading-5 text-foreground">
                                      {sqlRemediation}
                                    </pre>
                                  </div>
                                ) : finding.recommendation ? (
                                  <p className="mt-3 text-sm leading-6 text-foreground">
                                    {finding.recommendation}
                                  </p>
                                ) : null}
                              </div>

                              <span className="shrink-0 rounded bg-[rgb(var(--semantic-2))] px-2 py-1 font-mono text-xs leading-4 text-muted-foreground">
                                {finding.ruleId}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : null}

          {!result && isScanning ? (
            <div className="flex items-center gap-3 rounded border border-border bg-[rgb(var(--semantic-2))] px-4 py-3 text-sm font-medium text-foreground shadow-sm">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              Scanning your database...
            </div>
          ) : null}

          {!result && isLatestLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading latest advisor scan...
            </div>
          ) : null}

          {error ? (
            <div className="relative w-full rounded-lg border border-red-500/30 bg-red-500/10 p-4 shadow-sm dark:border-red-500/20">
              <AlertCircle className="absolute left-4 top-4 h-5 w-5 text-red-600 dark:text-red-400" />
              <div className="pl-8">
                <h3 className="mb-1 text-sm font-semibold leading-none text-red-600 dark:text-red-400">
                  Scan failed
                </h3>
                <div className="text-sm text-red-700/90 dark:text-red-400/90">{error.message}</div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
