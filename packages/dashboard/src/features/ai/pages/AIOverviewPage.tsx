import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpCircle, Loader2, StopCircle } from 'lucide-react';
import {
  Button,
  CopyButton,
  Tab,
  Tabs,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@insforge/ui';
import type { AIOverviewMetricPoint } from '@insforge/shared-schemas';
import { CodeEditor } from '#components';
import { useAIModelCredits } from '#features/ai/hooks/useAIModelCredits';
import { useAIOverview } from '#features/ai/hooks/useAIOverview';
import { useOpenRouterKey } from '#features/ai/hooks/useOpenRouterKey';
import { useDashboardHost } from '#lib/config/DashboardHostContext';
import { useToast } from '#lib/hooks/useToast';
import type { DashboardModelCreditUsage } from '#types';
import {
  CODE_TAB_LANGUAGE,
  OVERVIEW_QUICK_START_MODELS,
  getOverviewCodeSnippets,
  type CodeTab,
} from '#features/ai/constants';

function formatCurrency(value: number): string {
  return `$${value.toFixed(value >= 10 ? 0 : 2)}`;
}

function formatModelCredit(value: number, compact = false): string {
  if (compact && Number.isInteger(value)) {
    return `$${value.toFixed(0)}`;
  }

  return `$${value.toFixed(2)}`;
}

function formatCompact(value: number): string {
  return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(
    value
  );
}

function metricTotal(points: AIOverviewMetricPoint[]): number {
  return points.reduce((sum, point) => sum + point.value, 0);
}

function parseBucketLabel(label: string): Date | null {
  if (/^\d{4}-\d{2}$/.test(label)) {
    const date = new Date(`${label}-01T00:00:00Z`);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(label)) {
    const date = new Date(`${label}T00:00:00Z`);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(label)) {
    const date = new Date(`${label}:00Z`);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const date = new Date(label);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatBucketLabel(label: string) {
  const date = parseBucketLabel(label);

  if (!date) {
    return {
      axis: label,
      title: label,
    };
  }

  if (/^\d{4}-\d{2}$/.test(label)) {
    return {
      axis: new Intl.DateTimeFormat(undefined, { month: 'short' }).format(date),
      title: new Intl.DateTimeFormat(undefined, { month: 'short', year: 'numeric' }).format(date),
    };
  }

  if (/T/.test(label)) {
    const hourLabel = new Intl.DateTimeFormat(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    }).format(date);

    return {
      axis: hourLabel,
      title: `${new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(
        date
      )}, ${hourLabel}`,
    };
  }

  return {
    axis: new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date),
    title: new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(date),
  };
}

function OpenRouterKeyBox({
  apiKey,
  maskedKey,
  isLoading,
  error,
}: {
  apiKey?: string;
  maskedKey?: string;
  isLoading?: boolean;
  error?: Error | null;
}) {
  const displayValue = isLoading ? 'Loading…' : maskedKey || error?.message || 'Not configured';
  const copyValue = apiKey ?? '';

  return (
    <div
      className={[
        'flex h-8 min-w-0 items-center rounded border border-[var(--alpha-8)] bg-[rgb(var(--semantic-1))] p-1.5 text-left transition-colors',
        isLoading ? 'animate-pulse' : '',
      ].join(' ')}
    >
      <span className="min-w-0 flex-1 truncate px-1 font-mono text-[12px] leading-4 text-muted-foreground">
        {displayValue}
      </span>
      {copyValue && !isLoading && (
        <CopyButton
          text={copyValue}
          showText={false}
          className="ml-2 shrink-0 text-muted-foreground hover:text-foreground"
        />
      )}
    </div>
  );
}

function getNiceChartMax(value: number): number {
  if (value <= 0) {
    return 1;
  }

  const exponent = Math.floor(Math.log10(value));
  const magnitude = 10 ** exponent;
  const normalized = value / magnitude;
  const niceNormalized = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return niceNormalized * magnitude;
}

function getXAxisLabels(points: AIOverviewMetricPoint[]) {
  if (points.length === 0) {
    return [];
  }

  if (points.length === 1) {
    return [{ label: formatBucketLabel(points[0].label).axis, position: 0, align: 'left' }];
  }

  if (points.length === 2) {
    return [
      { label: formatBucketLabel(points[0].label).axis, position: 0, align: 'left' },
      { label: formatBucketLabel(points[1].label).axis, position: 100, align: 'right' },
    ];
  }

  const middleIndex = Math.floor((points.length - 1) / 2);
  return [
    { label: formatBucketLabel(points[0].label).axis, position: 0, align: 'left' },
    {
      label: formatBucketLabel(points[middleIndex].label).axis,
      position: (middleIndex / (points.length - 1)) * 100,
      align: 'center',
    },
    {
      label: formatBucketLabel(points[points.length - 1].label).axis,
      position: 100,
      align: 'right',
    },
  ];
}

function ChartCard({
  title,
  points,
  value,
  valueFormatter = formatCompact,
}: {
  title: string;
  points: AIOverviewMetricPoint[];
  value: string;
  valueFormatter?: (value: number) => string;
}) {
  const chartPoints = points;
  const chartHeight = 176;
  const xAxisPadding = 12;
  const max = getNiceChartMax(Math.max(...chartPoints.map((point) => point.value), 0));
  const yTicks = [max, max / 2, 0];
  const xAxisLabels = getXAxisLabels(chartPoints);

  return (
    <div className="flex h-[280px] flex-col rounded border border-[var(--alpha-8)] bg-card">
      <div className="flex h-10 shrink-0 items-center justify-between px-2.5">
        <div className="text-[13px] leading-[18px] text-foreground">{title}</div>
        <div className="text-lg font-medium leading-6 text-foreground">{value}</div>
      </div>
      <div className="relative min-h-0 flex-1 px-2.5 pb-4">
        <div className="relative h-full pl-14 pt-2">
          {yTicks.map((tick) => (
            <div
              key={tick}
              className="absolute inset-x-0 flex items-center"
              style={{ top: `${8 + ((max - tick) / max) * chartHeight}px` }}
            >
              <span className="w-12 pr-2 text-right text-[10px] leading-4 text-muted-foreground">
                {valueFormatter(tick)}
              </span>
              <span className="h-px flex-1 border-t border-dashed border-[var(--alpha-8)]" />
            </div>
          ))}

          {chartPoints.length === 0 ? (
            <div className="absolute inset-x-14 bottom-6 top-3 flex items-center justify-center text-[12px] leading-4 text-muted-foreground">
              No data yet
            </div>
          ) : (
            <>
              <div className="absolute inset-x-0 bottom-5 top-3 flex items-end gap-1 pl-14">
                {chartPoints.map((point, index) => {
                  const label = formatBucketLabel(point.label);

                  return (
                    <div
                      key={`${point.label}-${index}`}
                      className="group relative flex min-w-0 flex-1 flex-col items-center gap-1"
                    >
                      <div className="pointer-events-none absolute bottom-[calc(100%+8px)] left-1/2 z-10 hidden w-[128px] -translate-x-1/2 rounded border border-[var(--alpha-8)] bg-[rgb(var(--semantic-1))] px-2 py-1.5 text-[11px] leading-4 text-foreground shadow-lg group-hover:block">
                        <div className="truncate font-medium">{label.title}</div>
                        <div className="truncate text-muted-foreground">
                          {valueFormatter(point.value)}
                        </div>
                      </div>
                      <div
                        className="w-full rounded-t-sm bg-[rgb(var(--disabled))]"
                        style={{
                          height: point.value <= 0 ? 0 : `${(point.value / max) * chartHeight}px`,
                        }}
                      />
                    </div>
                  );
                })}
              </div>
              <div className="absolute bottom-0 left-14 right-0 h-4">
                {xAxisLabels.map((label) => (
                  <span
                    key={`${label.label}-${label.position}`}
                    className={[
                      'absolute top-0 whitespace-nowrap text-[10px] leading-3 text-muted-foreground',
                      label.align === 'center'
                        ? '-translate-x-1/2'
                        : label.align === 'right'
                          ? '-translate-x-full'
                          : '',
                    ].join(' ')}
                    style={{
                      left: `calc(${label.position}% + ${
                        label.align === 'right'
                          ? -xAxisPadding
                          : label.align === 'left'
                            ? xAxisPadding
                            : 0
                      }px)`,
                    }}
                  >
                    {label.label}
                  </span>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function OverviewErrorPanel({ message, heightClass }: { message: string; heightClass: string }) {
  return (
    <div
      className={`flex ${heightClass} items-center justify-center rounded border border-[var(--alpha-8)] bg-card px-4 text-center text-sm text-muted-foreground`}
    >
      {message}
    </div>
  );
}

function ModelCreditPopover({
  credits,
  error,
  isLoading,
}: {
  credits?: DashboardModelCreditUsage;
  error?: Error | null;
  isLoading?: boolean;
}) {
  const used = credits?.used ?? 0;
  const limit = Math.max(credits?.limit ?? 0, 0);
  const isFree = credits?.isFree ?? false;
  const remaining = Math.max(0, limit - used);
  const overage = Math.max(0, used - limit);
  const hasOverage = !isFree && overage > 0;
  const isFreeExhausted = isFree && (limit <= 0 || remaining <= 0);
  const isLowCredit = isFree
    ? !isFreeExhausted && limit > 0 && remaining / limit <= 0.2
    : !hasOverage && limit > 0 && remaining / limit <= 0.2;
  const displayTotal = hasOverage ? Math.max(used, limit) : limit;
  const usedWidth =
    displayTotal > 0 ? Math.min(hasOverage ? limit / displayTotal : used / limit, 1) * 100 : 0;
  const overageWidth = displayTotal > 0 && hasOverage ? (overage / displayTotal) * 100 : 0;
  const progressColor = isFreeExhausted ? '#ef4444' : isLowCredit ? '#f59e0b' : '#ffffff';
  const host = useDashboardHost();
  const { showToast } = useToast();

  const handleUpgradeClick = () => {
    if (host.onShowUpgradeDialog) {
      host.onShowUpgradeDialog();
      return;
    }

    showToast('Subscription management is only available in cloud-hosting mode.', 'info');
  };

  if (isLoading) {
    return (
      <div className="w-[358px] rounded-lg border border-[#404040] bg-[#262626] p-5 text-sm text-[#a3a3a3] shadow-[0_4px_4px_rgba(0,0,0,0.4)]">
        Loading model credit usage...
      </div>
    );
  }

  if (error || !credits) {
    return (
      <div className="w-[358px] rounded-lg border border-[#404040] bg-[#262626] p-5 text-sm text-[#a3a3a3] shadow-[0_4px_4px_rgba(0,0,0,0.4)]">
        {error?.message || 'Model credit usage is unavailable.'}
      </div>
    );
  }

  return (
    <div className="w-[358px] rounded-lg border border-[#404040] bg-[#262626] p-3 text-sm shadow-[0_4px_4px_rgba(0,0,0,0.4)]">
      <div className="flex flex-col gap-3 rounded px-3 py-2">
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between text-[#a3a3a3]">
            <span>Used Credits</span>
            <span>{hasOverage ? 'Overage Usage' : 'Remaining'}</span>
          </div>
          <div className="flex items-end justify-between text-white">
            <div>
              <span className="font-semibold">{formatModelCredit(used)}</span>{' '}
              <span className="text-[#a3a3a3]">/ {formatModelCredit(limit)}</span>
            </div>
            <span className="font-semibold">
              {hasOverage ? formatModelCredit(overage) : formatModelCredit(remaining)}
            </span>
          </div>
        </div>
        <div className="flex h-1.5 overflow-hidden rounded-md bg-[#171717]">
          <div
            className="h-full"
            style={{ width: `${usedWidth}%`, backgroundColor: progressColor }}
          />
          {hasOverage && (
            <div className="h-full bg-[#0284c7]" style={{ width: `${overageWidth}%` }} />
          )}
        </div>
        {(isFreeExhausted || isLowCredit || hasOverage) && (
          <p className="leading-[18px] text-white">
            {isFreeExhausted
              ? 'AI features are paused.'
              : isFree
                ? 'AI features will pause when credits run out.'
                : `Additional usage ${hasOverage ? 'is' : 'will be'} billed pay-as-you-go.`}
          </p>
        )}
      </div>
      {isFree && (
        <button
          type="button"
          onClick={handleUpgradeClick}
          className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm font-medium leading-5 text-[#6ee7b7] transition-colors hover:bg-[var(--alpha-4)]"
        >
          <ArrowUpCircle className="size-5 shrink-0" aria-hidden="true" />
          <span>Upgrade plan for $10 credit</span>
        </button>
      )}
    </div>
  );
}

function ModelCreditBadge({
  credits,
  error,
  isLoading,
}: {
  credits?: DashboardModelCreditUsage;
  error?: Error | null;
  isLoading?: boolean;
}) {
  const limit = Math.max(credits?.limit ?? 0, 0);
  const used = credits?.used ?? 0;
  const remaining = Math.max(0, limit - used);
  const overage = Math.max(0, used - limit);
  const isFree = credits?.isFree ?? false;
  const hasOverage = !isFree && overage > 0;
  const isFreeExhausted = isFree && (limit <= 0 || remaining <= 0);
  const isLowFreeCredit = isFree && !isFreeExhausted && limit > 0 && remaining / limit <= 0.2;
  const label = isLoading
    ? 'Loading'
    : error
      ? 'Credit unavailable'
      : isFree
        ? `${formatModelCredit(remaining)} Credits`
        : hasOverage
          ? `${formatModelCredit(overage)} Overage`
          : `${formatModelCredit(remaining, true)} Credits`;
  const iconClass = isFreeExhausted
    ? 'size-5 text-[#ef4444]'
    : isLowFreeCredit
      ? 'size-5 text-[#f59e0b]'
      : hasOverage
        ? 'size-5 text-[#0284c7]'
        : 'size-5 text-muted-foreground';

  return (
    <TooltipProvider delayDuration={100}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className={[
              'flex shrink-0 items-center gap-1 rounded border border-[var(--alpha-8)] bg-card p-2 text-sm font-medium leading-5 text-foreground transition-colors hover:bg-[var(--alpha-4)]',
              isLoading ? 'animate-pulse' : '',
            ].join(' ')}
            aria-label="Model credit usage"
          >
            <StopCircle className={iconClass} aria-hidden="true" />
            <span>{label}</span>
          </button>
        </TooltipTrigger>
        <TooltipContent
          side="bottom"
          align="end"
          sideOffset={8}
          className="border-0 bg-transparent p-0 text-inherit shadow-none"
        >
          <ModelCreditPopover credits={credits} error={error} isLoading={isLoading} />
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export default function AIOverviewPage() {
  const host = useDashboardHost();
  const [codeTab, setCodeTab] = useState<CodeTab>('sdk');
  const [selectedModelId, setSelectedModelId] = useState<
    (typeof OVERVIEW_QUICK_START_MODELS)[number]['id']
  >(OVERVIEW_QUICK_START_MODELS[0].id);
  const {
    data: usageData,
    isLoading: isUsageLoading,
    isError: isUsageError,
    error: usageError,
  } = useAIOverview();
  const {
    data: openRouterKey,
    isLoading: isOpenRouterKeyLoading,
    error: openRouterKeyError,
  } = useOpenRouterKey();
  const {
    data: modelCredits,
    isLoading: isModelCreditsLoading,
    error: modelCreditsError,
  } = useAIModelCredits();
  const shouldShowModelCredits = host.mode === 'cloud-hosting' && !!host.onRequestModelCredits;
  const codeSnippets = useMemo(() => getOverviewCodeSnippets(selectedModelId), [selectedModelId]);

  const totals = useMemo(
    () => ({
      spend: formatCurrency(metricTotal(usageData?.charts.spend ?? [])),
      requests: formatCompact(metricTotal(usageData?.charts.requests ?? [])),
      tokens: formatCompact(metricTotal(usageData?.charts.tokens ?? [])),
    }),
    [usageData]
  );

  return (
    <div className="h-full overflow-y-auto bg-[rgb(var(--semantic-1))]">
      <div className="mx-auto flex w-full max-w-[1024px] flex-col gap-6 px-10 py-10">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-2">
            <h1 className="text-2xl font-medium leading-8 text-foreground">Overview</h1>
            <p className="text-sm leading-5 text-muted-foreground">
              Your models are ready — build LLM-powered features or add more integrations.
            </p>
          </div>
          {shouldShowModelCredits && (
            <ModelCreditBadge
              credits={modelCredits}
              error={modelCreditsError}
              isLoading={isModelCreditsLoading}
            />
          )}
        </div>

        <section className="grid min-h-[280px] grid-cols-[360px_1fr] overflow-hidden rounded border border-[var(--alpha-8)] bg-card">
          <div className="grid grid-rows-[1fr_32px] p-5">
            <div className="flex flex-col gap-5">
              <div className="flex flex-col gap-3">
                <h2 className="text-base font-medium leading-6 text-foreground">
                  Start using Model Gateway
                </h2>
                <p className="max-w-[280px] text-sm leading-5 text-muted-foreground">
                  Powered by OpenRouter, Model Gateway lets you switch between hundreds of models
                  without managing provider accounts.
                </p>
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="text-[12px] leading-4 text-muted-foreground">
                  Active OpenRouter key
                </span>
                <OpenRouterKeyBox
                  apiKey={openRouterKey?.apiKey}
                  maskedKey={openRouterKey?.maskedKey}
                  isLoading={isOpenRouterKeyLoading}
                  error={openRouterKeyError}
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                asChild
                size="sm"
                className="h-8 bg-[#68e5a2] px-4 text-black hover:bg-[#68e5a2]/90"
              >
                <Link to="/dashboard/ai/quick-start">Quick Start</Link>
              </Button>
            </div>
          </div>
          <div className="grid min-w-0 grid-rows-[1fr_32px] gap-5 p-5 pl-0">
            <div className="min-w-0">
              <Tabs
                value={codeTab}
                onValueChange={(value) => setCodeTab(value as CodeTab)}
                className="h-8"
              >
                <Tab value="sdk" className="h-8 flex-1">
                  JavaScript
                </Tab>
                <Tab value="python" className="h-8 flex-1">
                  Python
                </Tab>
                <Tab value="http" className="h-8 flex-1">
                  OpenAI HTTP
                </Tab>
              </Tabs>
              <div className="relative h-[156px] min-h-0 overflow-hidden rounded-b bg-white dark:bg-[#1e1e1e]">
                <CopyButton
                  text={codeSnippets[codeTab]}
                  showText={false}
                  className="absolute right-3 top-3 z-10 text-muted-foreground hover:text-foreground"
                />
                <CodeEditor
                  code={codeSnippets[codeTab]}
                  editable={false}
                  language={CODE_TAB_LANGUAGE[codeTab]}
                  basicSetup={false}
                  className="h-full pr-10 text-[12px]"
                />
              </div>
            </div>
            <div className="flex h-8 items-center gap-2 text-[12px] text-muted-foreground">
              {OVERVIEW_QUICK_START_MODELS.map((model) => {
                const Icon = model.icon;
                const isSelected = selectedModelId === model.id;

                return (
                  <button
                    key={model.id}
                    type="button"
                    onClick={() => setSelectedModelId(model.id)}
                    className={[
                      'flex h-8 items-center gap-1.5 rounded border px-3 transition-colors',
                      isSelected
                        ? 'border-[var(--alpha-16)] bg-[var(--alpha-4)] text-foreground'
                        : 'border-[var(--alpha-8)] text-muted-foreground hover:bg-[var(--alpha-4)] hover:text-foreground',
                    ].join(' ')}
                  >
                    <Icon className="size-4" />
                    {model.label}
                  </button>
                );
              })}
              <span className="text-muted-foreground">
                and{' '}
                <Link
                  to="/dashboard/ai/models"
                  className="underline underline-offset-4 hover:text-foreground"
                >
                  many more
                </Link>
              </span>
            </div>
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <div className="flex items-end justify-between gap-4">
            <h2 className="text-lg font-medium leading-7 text-foreground">Usage</h2>
            <span className="text-[12px] leading-4 text-muted-foreground">Past 30 UTC days</span>
          </div>
          {isUsageLoading ? (
            <div className="flex h-[340px] items-center justify-center rounded border border-[var(--alpha-8)] bg-card">
              <Loader2 className="size-8 animate-spin text-muted-foreground" />
            </div>
          ) : isUsageError ? (
            <OverviewErrorPanel
              heightClass="h-[340px]"
              message={usageError?.message || 'Failed to load usage overview.'}
            />
          ) : (
            <div className="grid grid-cols-2 gap-4">
              <ChartCard
                title="Spend"
                points={usageData?.charts.spend ?? []}
                value={totals.spend}
                valueFormatter={formatCurrency}
              />
              <ChartCard
                title="Requests"
                points={usageData?.charts.requests ?? []}
                value={totals.requests}
              />
              <ChartCard
                title="Tokens"
                points={usageData?.charts.tokens ?? []}
                value={totals.tokens}
              />
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
