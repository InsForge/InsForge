import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { ArrowUpCircle, Loader2, RotateCcw, StopCircle } from 'lucide-react';
import {
  Button,
  ConfirmDialog,
  CopyButton,
  Tab,
  Tabs,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  useToast,
} from '@insforge/ui';
import type { AIOverviewMetricPoint } from '@insforge/shared-schemas';
import { CodeEditor } from '#components';
import { AIActivityChartCard } from '#features/ai/components/AIActivityChartCard';
import { useAIModelCredits } from '#features/ai/hooks/useAIModelCredits';
import { useAIOverview } from '#features/ai/hooks/useAIOverview';
import { useOpenRouterKey, useRotateOpenRouterKey } from '#features/ai/hooks/useOpenRouterKey';
import { useDashboardHost } from '#lib/config/DashboardHostContext';
import { useConfirm } from '#lib/hooks/useConfirm';
import type { DashboardModelCreditUsage } from '#types';
import {
  CODE_TAB_LANGUAGE,
  OVERVIEW_QUICK_START_MODELS,
  getOverviewCodeSnippets,
  type CodeTab,
} from '#features/ai/constants';

function formatModelCredit(value: number, compact = false): string {
  if (compact && Number.isInteger(value)) {
    return `$${value.toFixed(0)}`;
  }

  return `$${value.toFixed(2)}`;
}

function formatChartCurrency(value: number): string {
  return `$${value.toFixed(value >= 10 ? 0 : 2)}`;
}

function metricTotal(points: AIOverviewMetricPoint[]): number {
  return points.reduce((sum, point) => sum + point.value, 0);
}

function UnavailableChartCard({ title, message }: { title: string; message: string }) {
  return (
    <div className="flex h-[280px] flex-col rounded border border-[var(--alpha-8)] bg-card">
      <div className="flex h-10 shrink-0 items-center justify-between px-2.5">
        <div className="text-[13px] leading-[18px] text-foreground">{title}</div>
        <div className="text-lg font-medium leading-6 text-muted-foreground">—</div>
      </div>
      <div className="relative min-h-0 flex-1 px-2.5 pb-4">
        <div className="absolute inset-x-2.5 bottom-12 top-8 flex flex-col justify-between pl-14">
          <span className="border-t border-dashed border-[var(--alpha-8)]" />
          <span className="border-t border-dashed border-[var(--alpha-8)]" />
          <span className="border-t border-dashed border-[var(--alpha-8)]" />
        </div>
        <div className="absolute inset-0 flex items-center justify-center px-12 text-center text-[12px] leading-4 text-muted-foreground">
          {message}
        </div>
      </div>
    </div>
  );
}

function OverviewStatusPanel({ message, heightClass }: { message: string; heightClass: string }) {
  return (
    <div
      className={`flex ${heightClass} items-center justify-center rounded border border-[var(--alpha-8)] bg-card px-4 text-center text-sm text-muted-foreground`}
    >
      {message}
    </div>
  );
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
  const { t } = useTranslation('chrome');
  const displayValue = isLoading
    ? t('ai.overview.loadingEllipsis', { defaultValue: 'Loading…' })
    : maskedKey ||
      error?.message ||
      t('ai.overview.notConfigured', { defaultValue: 'Not configured' });
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

function ModelCreditPopover({
  credits,
  error,
  isLoading,
}: {
  credits?: DashboardModelCreditUsage;
  error?: Error | null;
  isLoading?: boolean;
}) {
  const { t } = useTranslation('chrome');
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

    showToast(
      t('ai.overview.subscriptionCloudOnly', {
        defaultValue: 'Subscription management is only available in cloud-hosting mode.',
      }),
      'info'
    );
  };

  if (isLoading) {
    return (
      <div className="w-[358px] rounded-lg border border-[#404040] bg-[#262626] p-5 text-sm text-[#a3a3a3] shadow-[0_4px_4px_rgba(0,0,0,0.4)]">
        {t('ai.overview.loadingModelCreditUsage', {
          defaultValue: 'Loading model credit usage...',
        })}
      </div>
    );
  }

  if (error || !credits) {
    return (
      <div className="w-[358px] rounded-lg border border-[#404040] bg-[#262626] p-5 text-sm text-[#a3a3a3] shadow-[0_4px_4px_rgba(0,0,0,0.4)]">
        {error?.message ||
          t('ai.overview.creditUsageUnavailable', {
            defaultValue: 'Model credit usage is unavailable.',
          })}
      </div>
    );
  }

  return (
    <div className="w-[358px] rounded-lg border border-[#404040] bg-[#262626] p-3 text-sm shadow-[0_4px_4px_rgba(0,0,0,0.4)]">
      <div className="flex flex-col gap-3 rounded px-3 py-2">
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between text-[#a3a3a3]">
            <span>{t('ai.overview.usedCredits', { defaultValue: 'Used Credits' })}</span>
            <span>
              {hasOverage
                ? t('ai.overview.overageUsage', {
                    defaultValue: 'Overage Usage',
                  })
                : t('ai.overview.remaining', { defaultValue: 'Remaining' })}
            </span>
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
              ? t('ai.overview.featuresPaused', {
                  defaultValue: 'AI features are paused.',
                })
              : isFree
                ? t('ai.overview.featuresWillPause', {
                    defaultValue: 'AI features will pause when credits run out.',
                  })
                : hasOverage
                  ? t('ai.overview.overageBilledNow', {
                      defaultValue: 'Additional usage is billed pay-as-you-go.',
                    })
                  : t('ai.overview.overageBilledLater', {
                      defaultValue: 'Additional usage will be billed pay-as-you-go.',
                    })}
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
          <span>
            {t('ai.overview.upgradePlan', {
              defaultValue: 'Upgrade plan for $10 credit',
            })}
          </span>
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
  const { t } = useTranslation('chrome');
  const limit = Math.max(credits?.limit ?? 0, 0);
  const used = credits?.used ?? 0;
  const remaining = Math.max(0, limit - used);
  const overage = Math.max(0, used - limit);
  const isFree = credits?.isFree ?? false;
  const hasOverage = !isFree && overage > 0;
  const isFreeExhausted = isFree && (limit <= 0 || remaining <= 0);
  const isLowFreeCredit = isFree && !isFreeExhausted && limit > 0 && remaining / limit <= 0.2;
  const label = isLoading
    ? t('ai.overview.loading', { defaultValue: 'Loading' })
    : error
      ? t('ai.overview.creditUnavailable', {
          defaultValue: 'Credit unavailable',
        })
      : isFree
        ? t('ai.overview.creditsAmount', {
            defaultValue: '{{amount}} Credits',
            amount: formatModelCredit(remaining),
          })
        : hasOverage
          ? t('ai.overview.overageAmount', {
              defaultValue: '{{amount}} Overage',
              amount: formatModelCredit(overage),
            })
          : t('ai.overview.creditsAmount', {
              defaultValue: '{{amount}} Credits',
              amount: formatModelCredit(remaining, true),
            });
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
            aria-label={t('ai.overview.modelCreditUsage', {
              defaultValue: 'Model credit usage',
            })}
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
  const { t } = useTranslation('chrome');
  const host = useDashboardHost();
  const [codeTab, setCodeTab] = useState<CodeTab>('sdk');
  const [selectedModelId, setSelectedModelId] = useState<
    (typeof OVERVIEW_QUICK_START_MODELS)[number]['id']
  >(OVERVIEW_QUICK_START_MODELS[0].id);
  const { confirm, confirmDialogProps } = useConfirm();
  const {
    data: openRouterKey,
    isLoading: isOpenRouterKeyLoading,
    error: openRouterKeyError,
  } = useOpenRouterKey();
  const {
    data: overviewData,
    isLoading: isOverviewLoading,
    isError: isOverviewError,
    error: overviewError,
  } = useAIOverview();
  const rotateOpenRouterKey = useRotateOpenRouterKey();
  const {
    data: modelCredits,
    isLoading: isModelCreditsLoading,
    error: modelCreditsError,
  } = useAIModelCredits();
  const shouldShowModelCredits = host.mode === 'cloud-hosting' && !!host.onRequestModelCredits;
  const canRotateOpenRouterKey = host.mode === 'cloud-hosting';
  const codeSnippets = useMemo(() => getOverviewCodeSnippets(selectedModelId), [selectedModelId]);
  const chartTotals = useMemo(
    () => formatChartCurrency(metricTotal(overviewData?.charts.spend ?? [])),
    [overviewData]
  );

  const handleRotateOpenRouterKey = async () => {
    const confirmed = await confirm({
      title: t('ai.overview.rotateKeyTitle', {
        defaultValue: 'Rotate OpenRouter key?',
      }),
      description: t('ai.overview.rotateKeyDescription', {
        defaultValue:
          'The current API key will stop working immediately. Update any apps or services that use it as soon as the new key appears.',
      }),
      confirmText: t('ai.overview.rotateKeyConfirm', {
        defaultValue: 'Rotate key',
      }),
      cancelText: t('ai.overview.cancel', { defaultValue: 'Cancel' }),
      destructive: true,
    });

    if (!confirmed) {
      return;
    }

    try {
      await rotateOpenRouterKey.mutateAsync();
    } catch {
      // Toast feedback is handled by the mutation hook.
    }
  };

  return (
    <div className="h-full overflow-y-auto bg-[rgb(var(--semantic-1))]">
      <div className="mx-auto flex w-full max-w-[1024px] flex-col gap-6 px-10 py-10">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-2">
            <h1 className="text-2xl font-medium leading-8 text-foreground">
              {t('ai.overview.title', { defaultValue: 'Overview' })}
            </h1>
            <p className="text-sm leading-5 text-muted-foreground">
              {t('ai.overview.description', {
                defaultValue:
                  'Your models are ready — build LLM-powered features or add more integrations.',
              })}
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
          <div className="grid min-w-0 grid-rows-[1fr_32px] p-5">
            <div className="flex min-w-0 flex-col gap-5">
              <div className="flex flex-col gap-3">
                <h2 className="text-base font-medium leading-6 text-foreground">
                  {t('ai.overview.startUsingGateway', {
                    defaultValue: 'Start using Model Gateway',
                  })}
                </h2>
                <p className="max-w-[280px] text-sm leading-5 text-muted-foreground">
                  {t('ai.overview.gatewayDescription', {
                    defaultValue:
                      'Powered by OpenRouter, Model Gateway lets you switch between hundreds of models without managing provider accounts.',
                  })}
                </p>
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="text-[12px] leading-4 text-muted-foreground">
                  {t('ai.overview.activeOpenRouterKey', {
                    defaultValue: 'Active OpenRouter key',
                  })}
                </span>
                <div className="flex min-w-0 items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <OpenRouterKeyBox
                      apiKey={openRouterKey?.apiKey}
                      maskedKey={openRouterKey?.maskedKey}
                      isLoading={isOpenRouterKeyLoading}
                      error={openRouterKeyError}
                    />
                  </div>
                  {canRotateOpenRouterKey && (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="h-8 shrink-0 px-2.5"
                      onClick={() => {
                        void handleRotateOpenRouterKey();
                      }}
                      disabled={
                        isOpenRouterKeyLoading || rotateOpenRouterKey.isPending || !openRouterKey
                      }
                    >
                      {rotateOpenRouterKey.isPending ? (
                        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                      ) : (
                        <RotateCcw className="size-4" aria-hidden="true" />
                      )}
                      <span>{t('ai.overview.rotate', { defaultValue: 'Rotate' })}</span>
                    </Button>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                asChild
                size="sm"
                className="h-8 bg-[#68e5a2] px-4 text-black hover:bg-[#68e5a2]/90"
              >
                <Link to="/dashboard/ai/quick-start">
                  {t('ai.overview.quickStart', { defaultValue: 'Quick Start' })}
                </Link>
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
                {t('ai.overview.and', { defaultValue: 'and' })}{' '}
                <Link
                  to="/dashboard/ai/models"
                  className="underline underline-offset-4 hover:text-foreground"
                >
                  {t('ai.overview.manyMore', { defaultValue: 'many more' })}
                </Link>
              </span>
            </div>
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <div className="flex items-end justify-between gap-4">
            <div>
              <h2 className="text-lg font-medium leading-7 text-foreground">
                {t('ai.overview.activity', { defaultValue: 'Spend' })}
              </h2>
              <p className="mt-0.5 text-[12px] leading-4 text-muted-foreground">
                {t('ai.overview.activityDescription', {
                  defaultValue: 'Historical spend for this key.',
                })}
              </p>
            </div>
            <Button asChild variant="secondary" size="sm" className="h-8 shrink-0">
              <Link to="/dashboard/ai/usage">
                {t('ai.overview.viewUsage', { defaultValue: 'View usage' })}
              </Link>
            </Button>
          </div>
          {isOverviewLoading ? (
            <div className="flex h-[280px] items-center justify-center rounded border border-[var(--alpha-8)] bg-card">
              <Loader2 className="size-7 animate-spin text-muted-foreground" />
            </div>
          ) : isOverviewError ? (
            <OverviewStatusPanel
              heightClass="h-[280px]"
              message={
                overviewError?.message ||
                t('ai.overview.activityLoadError', {
                  defaultValue: 'Failed to load activity overview.',
                })
              }
            />
          ) : !overviewData?.key.observabilityAvailable ? (
            <UnavailableChartCard
              title={t('ai.overview.spend', { defaultValue: 'Spend' })}
              message={
                overviewData?.key.observabilityError ||
                t('ai.overview.activityRequiresManagementKey', {
                  defaultValue: 'Configure an OpenRouter management key to load activity.',
                })
              }
            />
          ) : (
            <AIActivityChartCard
              title={t('ai.overview.spend', { defaultValue: 'Spend' })}
              points={overviewData.charts.spend}
              value={chartTotals}
              valueFormatter={formatChartCurrency}
            />
          )}
        </section>
      </div>
      <ConfirmDialog {...confirmDialogProps} />
    </div>
  );
}
