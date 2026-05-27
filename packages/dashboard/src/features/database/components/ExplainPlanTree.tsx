import type { ExplainPlanNode, ExplainSQLResponse } from '@insforge/shared-schemas';
import { ChevronRight } from 'lucide-react';

interface ExplainPlanTreeProps {
  data: ExplainSQLResponse;
}

interface ExplainPlanNodeViewProps {
  node: ExplainPlanNode;
  depth?: number;
}

function formatMs(value: number | undefined): string {
  return value === undefined ? 'n/a' : `${value.toFixed(value < 10 ? 3 : 2)} ms`;
}

function formatNumber(value: number | undefined): string {
  return value === undefined ? 'n/a' : new Intl.NumberFormat().format(value);
}

function PlanMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-[112px] flex-col gap-0.5 rounded-md border border-[var(--alpha-6)] bg-[var(--alpha-3)] px-2 py-1.5">
      <span className="text-[11px] font-medium leading-4 text-muted-foreground">{label}</span>
      <span className="truncate font-mono text-xs leading-4 text-foreground">{value}</span>
    </div>
  );
}

function PlanDetails({ node }: { node: ExplainPlanNode }) {
  const details = [
    node.relationName ? `Relation: ${node.relationName}` : null,
    node.indexName ? `Index: ${node.indexName}` : null,
    node.alias ? `Alias: ${node.alias}` : null,
    node.filter ? `Filter: ${node.filter}` : null,
    node.indexCond ? `Index Cond: ${node.indexCond}` : null,
    node.hashCond ? `Hash Cond: ${node.hashCond}` : null,
    node.joinFilter ? `Join Filter: ${node.joinFilter}` : null,
    node.recheckCond ? `Recheck Cond: ${node.recheckCond}` : null,
    node.groupKey?.length ? `Group Key: ${node.groupKey.join(', ')}` : null,
    node.sortKey?.length ? `Sort Key: ${node.sortKey.join(', ')}` : null,
  ].filter((detail): detail is string => detail !== null);

  if (!details.length) {
    return null;
  }

  return (
    <div className="mt-3 space-y-1 rounded-md bg-[var(--alpha-3)] px-3 py-2">
      {details.map((detail) => (
        <p key={detail} className="break-words font-mono text-xs leading-5 text-muted-foreground">
          {detail}
        </p>
      ))}
    </div>
  );
}

function ExplainPlanNodeView({ node, depth = 0 }: ExplainPlanNodeViewProps) {
  const hasChildren = node.plans.length > 0;
  const actualTime =
    node.actualStartupTime !== undefined || node.actualTotalTime !== undefined
      ? `${formatMs(node.actualStartupTime)} - ${formatMs(node.actualTotalTime)}`
      : 'n/a';
  const cost =
    node.startupCost !== undefined || node.totalCost !== undefined
      ? `${formatNumber(node.startupCost)} - ${formatNumber(node.totalCost)}`
      : 'n/a';

  return (
    <div className="relative">
      {depth > 0 && (
        <div className="absolute bottom-0 left-0 top-0 w-px bg-[var(--alpha-6)]" aria-hidden />
      )}
      <div className={depth > 0 ? 'pl-5' : ''}>
        <div className="rounded-lg border border-[var(--alpha-7)] bg-[rgb(var(--semantic-1))] p-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <ChevronRight
                className={`h-4 w-4 shrink-0 text-muted-foreground ${hasChildren ? 'rotate-90' : ''}`}
              />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium leading-5 text-foreground">
                  {node.nodeType}
                </p>
                {node.relationName && (
                  <p className="truncate text-xs leading-4 text-muted-foreground">
                    {node.relationName}
                  </p>
                )}
              </div>
            </div>
            {node.sharedHitBlocks !== undefined && (
              <span className="rounded bg-[var(--alpha-5)] px-2 py-0.5 font-mono text-[11px] leading-4 text-muted-foreground">
                {node.sharedHitBlocks} hits
              </span>
            )}
          </div>

          <div className="mt-3 grid grid-cols-[repeat(auto-fit,minmax(112px,1fr))] gap-2">
            <PlanMetric label="Cost" value={cost} />
            <PlanMetric label="Est. rows" value={formatNumber(node.planRows)} />
            <PlanMetric label="Actual time" value={actualTime} />
            <PlanMetric label="Actual rows" value={formatNumber(node.actualRows)} />
          </div>

          <PlanDetails node={node} />
        </div>

        {hasChildren && (
          <div className="mt-3 space-y-3">
            {node.plans.map((child, index) => (
              <ExplainPlanNodeView
                key={`${child.nodeType}-${child.relationName ?? 'node'}-${index}`}
                node={child}
                depth={depth + 1}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function ExplainPlanTree({ data }: ExplainPlanTreeProps) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--alpha-7)] bg-[rgb(var(--semantic-1))] p-3">
        <PlanMetric label="Total time" value={formatMs(data.totalQueryTime)} />
        <PlanMetric label="Planning" value={formatMs(data.planningTime)} />
        <PlanMetric label="Execution" value={formatMs(data.executionTime)} />
        {data.rolledBack && (
          <span className="rounded-md bg-[var(--alpha-5)] px-2 py-1 text-xs font-medium leading-4 text-muted-foreground">
            Rolled back
          </span>
        )}
      </div>
      <ExplainPlanNodeView node={data.plan} />
    </div>
  );
}
