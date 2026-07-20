import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import type { AIOverview, AIOverviewMetricPoint } from '@insforge/shared-schemas';
import { AIActivityChartCard } from '#features/ai/components/AIActivityChartCard';
import { useAIOverview } from '#features/ai/hooks/useAIOverview';

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: value > 0 && value < 0.01 ? 4 : 2,
  }).format(value);
}

function formatCompact(value: number): string {
  return new Intl.NumberFormat('en', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}

function formatChartCurrency(value: number): string {
  return formatCurrency(value);
}

function metricTotal(points: AIOverviewMetricPoint[]): number {
  return points.reduce((sum, point) => sum + point.value, 0);
}

function UsageMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex min-w-0 flex-col gap-2 bg-card p-4">
      <span className="text-[12px] leading-4 text-muted-foreground">{label}</span>
      <span className="text-xl font-medium leading-7 tracking-[-0.02em] text-foreground">
        {formatCurrency(value)}
      </span>
    </div>
  );
}

function KeyUsagePanel({ usage }: { usage: AIOverview['key'] }) {
  const { t, i18n } = useTranslation('chrome');
  const hasLimit = usage.limit !== null && usage.limitRemaining !== null;
  const limit = usage.limit ?? 0;
  const limitRemaining = usage.limitRemaining ?? 0;
  const amountUsed = hasLimit ? Math.max(0, limit - limitRemaining) : 0;
  const usedPercentage =
    hasLimit && limit > 0 ? Math.min(100, Math.max(0, (amountUsed / limit) * 100)) : 0;
  const resetValue = usage.limitReset
    ? (() => {
        const resetDate = new Date(usage.limitReset);
        if (!Number.isNaN(resetDate.getTime()) && /\d{4}-\d{2}-\d{2}/.test(usage.limitReset)) {
          return new Intl.DateTimeFormat(i18n.language, {
            dateStyle: 'medium',
            timeZone: 'UTC',
          }).format(resetDate);
        }
        return t(`ai.usage.resetCadence.${usage.limitReset}`, {
          defaultValue: usage.limitReset,
        });
      })()
    : null;

  return (
    <div className="overflow-hidden rounded border border-[var(--alpha-8)] bg-[var(--alpha-8)]">
      <div className="grid grid-cols-2 gap-px lg:grid-cols-4">
        <UsageMetric
          label={t('ai.usage.today', { defaultValue: 'Today' })}
          value={usage.usageDaily}
        />
        <UsageMetric
          label={t('ai.usage.thisWeek', { defaultValue: 'This week' })}
          value={usage.usageWeekly}
        />
        <UsageMetric
          label={t('ai.usage.thisMonth', { defaultValue: 'This month' })}
          value={usage.usageMonthly}
        />
        <UsageMetric
          label={t('ai.usage.allTime', { defaultValue: 'All time' })}
          value={usage.usage}
        />
      </div>
      {hasLimit ? (
        <div className="flex flex-col gap-4 border-t border-[var(--alpha-8)] bg-card p-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0 flex-1">
            <div className="mb-2 flex items-center justify-between gap-4 text-[12px] leading-4">
              <span className="text-muted-foreground">
                {t('ai.usage.spendingLimit', { defaultValue: 'Key spending limit' })}
              </span>
              <span className="font-medium text-foreground">
                {formatCurrency(amountUsed)} {t('ai.usage.of', { defaultValue: 'of' })}{' '}
                {formatCurrency(limit)}
              </span>
            </div>
            <div
              role="progressbar"
              aria-label={t('ai.usage.spendingLimitUsed', {
                defaultValue: 'OpenRouter key spending limit used',
              })}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(usedPercentage)}
              className="h-1.5 overflow-hidden rounded-full bg-[var(--alpha-8)]"
            >
              <div
                className="h-full rounded-full bg-foreground transition-[width]"
                style={{ width: `${usedPercentage}%` }}
              />
            </div>
          </div>
          <div className="flex shrink-0 gap-8 text-[12px] leading-4">
            <div className="flex flex-col gap-1">
              <span className="text-muted-foreground">
                {t('ai.usage.remaining', { defaultValue: 'Remaining' })}
              </span>
              <span className="font-medium text-foreground">{formatCurrency(limitRemaining)}</span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-muted-foreground">
                {t('ai.usage.limitReset', { defaultValue: 'Limit reset' })}
              </span>
              <span className="font-medium text-foreground">
                {resetValue
                  ? t('ai.usage.resetsValue', {
                      defaultValue: 'Resets {{value}}',
                      value: resetValue,
                    })
                  : t('ai.usage.neverResets', { defaultValue: 'Never resets' })}
              </span>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function UnavailableActivity({ message }: { message: string }) {
  const { t } = useTranslation('chrome');

  return (
    <div className="flex min-h-[160px] flex-col items-center justify-center gap-2 rounded border border-[var(--alpha-8)] bg-card px-6 text-center">
      <p className="text-sm font-medium text-foreground">
        {t('ai.usage.activityUnavailable', { defaultValue: 'Activity unavailable' })}
      </p>
      <p className="max-w-[520px] text-[12px] leading-5 text-muted-foreground">{message}</p>
    </div>
  );
}

function ModelUsageTable({ modelUsage }: { modelUsage: NonNullable<AIOverview['modelUsage']> }) {
  const { t } = useTranslation('chrome');
  const rows = modelUsage.slice(0, 10);
  const totalSpend = modelUsage.reduce((sum, item) => sum + item.spend, 0);

  return (
    <div className="overflow-hidden rounded border border-[var(--alpha-8)] bg-card">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] border-collapse text-left">
          <thead>
            <tr className="border-b border-[var(--alpha-8)] text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-2.5 font-medium">
                {t('ai.usage.model', { defaultValue: 'Model' })}
              </th>
              <th className="w-[112px] px-4 py-2.5 text-right font-medium">
                {t('ai.usage.requests', { defaultValue: 'Requests' })}
              </th>
              <th className="w-[112px] px-4 py-2.5 text-right font-medium">
                {t('ai.usage.tokens', { defaultValue: 'Tokens' })}
              </th>
              <th className="w-[112px] px-4 py-2.5 text-right font-medium">
                {t('ai.usage.spend', { defaultValue: 'Spend' })}
              </th>
              <th className="w-[160px] px-4 py-2.5 font-medium">
                {t('ai.usage.share', { defaultValue: 'Share' })}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((item) => {
              const share = totalSpend > 0 ? (item.spend / totalSpend) * 100 : 0;
              const providerLabel = item.providers.length > 0 ? item.providers.join(', ') : '—';

              return (
                <tr key={item.model} className="border-b border-[var(--alpha-8)] last:border-b-0">
                  <td className="max-w-0 px-4 py-3">
                    <div className="truncate text-[13px] font-medium leading-[18px] text-foreground">
                      {item.model}
                    </div>
                    <div className="mt-0.5 truncate text-[11px] leading-4 text-muted-foreground">
                      {providerLabel}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right text-[13px] tabular-nums text-foreground">
                    {formatCompact(item.requests)}
                  </td>
                  <td
                    className="px-4 py-3 text-right text-[13px] tabular-nums text-foreground"
                    title={t('ai.usage.tokenBreakdown', {
                      defaultValue:
                        '{{prompt}} prompt · {{completion}} completion · {{reasoning}} reasoning',
                      prompt: formatCompact(item.promptTokens),
                      completion: formatCompact(item.completionTokens),
                      reasoning: formatCompact(item.reasoningTokens),
                    })}
                  >
                    {formatCompact(item.totalTokens)}
                  </td>
                  <td className="px-4 py-3 text-right text-[13px] tabular-nums text-foreground">
                    {formatCurrency(item.spend)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--alpha-8)]">
                        <div
                          className="h-full rounded-full bg-foreground"
                          style={{ width: `${Math.min(100, Math.max(0, share))}%` }}
                        />
                      </div>
                      <span className="w-9 text-right text-[11px] tabular-nums text-muted-foreground">
                        {share.toFixed(1)}%
                      </span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {modelUsage.length > rows.length ? (
        <div className="border-t border-[var(--alpha-8)] px-4 py-2.5 text-[11px] leading-4 text-muted-foreground">
          {t('ai.usage.showingTopModels', { defaultValue: 'Showing top 10 models by spend' })}
        </div>
      ) : null}
    </div>
  );
}

export default function AIUsagePage() {
  const { t } = useTranslation('chrome');
  const { data, isLoading, isError, error } = useAIOverview();
  const totals = useMemo(
    () => ({
      spend: metricTotal(data?.charts.spend ?? []),
      requests: metricTotal(data?.charts.requests ?? []),
      tokens: metricTotal(data?.charts.tokens ?? []),
    }),
    [data]
  );

  return (
    <div className="h-full overflow-y-auto bg-[rgb(var(--semantic-1))]">
      <div className="mx-auto flex w-full max-w-[1024px] flex-col gap-8 px-10 py-10">
        <div className="flex min-w-0 flex-col gap-2">
          <h1 className="text-2xl font-medium leading-8 text-foreground">
            {t('ai.usage.title', { defaultValue: 'Usage' })}
          </h1>
          <p className="text-sm leading-5 text-muted-foreground">
            {t('ai.usage.description', {
              defaultValue:
                'Track OpenRouter spend, activity, and model usage for this gateway key.',
            })}
          </p>
        </div>

        {isLoading ? (
          <div className="flex h-[280px] items-center justify-center rounded border border-[var(--alpha-8)] bg-card">
            <Loader2 className="size-7 animate-spin text-muted-foreground" />
          </div>
        ) : isError || !data ? (
          <div className="flex h-[200px] items-center justify-center rounded border border-[var(--alpha-8)] bg-card px-6 text-center text-sm text-muted-foreground">
            {error?.message ||
              t('ai.usage.loadFailed', { defaultValue: 'Failed to load usage from OpenRouter.' })}
          </div>
        ) : (
          <>
            <section className="flex flex-col gap-3">
              <div>
                <h2 className="text-lg font-medium leading-7 text-foreground">
                  {t('ai.usage.spendSummary', { defaultValue: 'Summary' })}
                </h2>
                <p className="mt-0.5 text-[12px] leading-4 text-muted-foreground">
                  {t('ai.usage.spendDescription', {
                    defaultValue: 'Spend reported for the active OpenRouter API key.',
                  })}
                </p>
              </div>
              <KeyUsagePanel usage={data.key} />
            </section>

            <section className="flex flex-col gap-3">
              <div className="flex items-end justify-between gap-4">
                <div>
                  <h2 className="text-lg font-medium leading-7 text-foreground">
                    {t('ai.usage.activity', { defaultValue: 'Activity' })}
                  </h2>
                  <p className="mt-0.5 text-[12px] leading-4 text-muted-foreground">
                    {t('ai.usage.activityDescription', {
                      defaultValue: 'Historical spend, request, and token activity for this key.',
                    })}
                  </p>
                </div>
                <span className="text-[12px] leading-4 text-muted-foreground">
                  {t('ai.usage.past30Days', { defaultValue: 'Past 30 UTC days' })}
                </span>
              </div>
              {!data.key.observabilityAvailable ? (
                <UnavailableActivity
                  message={
                    data.key.observabilityError ||
                    t('ai.usage.managementKeyRequired', {
                      defaultValue: 'Configure an OpenRouter management key to load activity.',
                    })
                  }
                />
              ) : (
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  <AIActivityChartCard
                    title={t('ai.usage.spend', { defaultValue: 'Spend' })}
                    points={data.charts.spend}
                    value={formatChartCurrency(totals.spend)}
                    valueFormatter={formatChartCurrency}
                  />
                  <AIActivityChartCard
                    title={t('ai.usage.requests', { defaultValue: 'Requests' })}
                    points={data.charts.requests}
                    value={formatCompact(totals.requests)}
                  />
                  <AIActivityChartCard
                    title={t('ai.usage.tokens', { defaultValue: 'Tokens' })}
                    points={data.charts.tokens}
                    value={formatCompact(totals.tokens)}
                  />
                </div>
              )}
            </section>

            {data.key.observabilityAvailable ? (
              <section className="flex flex-col gap-3">
                <div className="flex items-end justify-between gap-4">
                  <div>
                    <h2 className="text-lg font-medium leading-7 text-foreground">
                      {t('ai.usage.models', { defaultValue: 'Models' })}
                    </h2>
                    <p className="mt-0.5 text-[12px] leading-4 text-muted-foreground">
                      {t('ai.usage.modelsDescription', {
                        defaultValue:
                          'Usage grouped by model across OpenRouter endpoints and providers.',
                      })}
                    </p>
                  </div>
                  <span className="text-[12px] leading-4 text-muted-foreground">
                    {t('ai.usage.past30Days', { defaultValue: 'Past 30 UTC days' })}
                  </span>
                </div>
                {(data.modelUsage ?? []).length > 0 ? (
                  <ModelUsageTable modelUsage={data.modelUsage ?? []} />
                ) : (
                  <div className="flex h-[120px] items-center justify-center rounded border border-[var(--alpha-8)] bg-card text-sm text-muted-foreground">
                    {t('ai.usage.noModelActivity', { defaultValue: 'No model activity yet.' })}
                  </div>
                )}
              </section>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
