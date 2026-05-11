import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, Loader2 } from 'lucide-react';
import {
  Button,
  CopyButton,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tab,
  Tabs,
} from '@insforge/ui';
import type { AIOverviewMetricPoint, AIOverviewRequestRow } from '@insforge/shared-schemas';
import { CodeEditor, PaginationControls } from '#components';
import OpenAIIcon from '#assets/logos/openai.svg?react';
import ClaudeIcon from '#assets/logos/claude_code.svg?react';
import GeminiIcon from '#assets/logos/gemini.svg?react';
import { useAIOverview } from '#features/ai/hooks/useAIOverview';
import { useOpenRouterKey } from '#features/ai/hooks/useOpenRouterKey';
import { getFriendlyModelName, getProviderLogo } from '#features/ai/helpers';
import { formatTime } from '#lib/utils/utils';

function getCodeSnippets(modelId: string) {
  return {
    sdk: `import OpenAI from 'openai';

const openai = new OpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPENROUTER_API_KEY,
});

const completion = await openai.chat.completions.create({
  model: '${modelId}',
  messages: [
    {
      role: 'user',
      content: 'Why is the sky blue?',
    },
  ],
});

console.log(completion.choices[0].message);`,
    python: `from openai import OpenAI
import os

client = OpenAI(
    base_url="https://openrouter.ai/api/v1",
    api_key=os.environ["OPENROUTER_API_KEY"],
)

completion = client.chat.completions.create(
    model="${modelId}",
    messages=[
        {
            "role": "user",
            "content": "Why is the sky blue?",
        }
    ],
)

print(completion.choices[0].message)`,
    http: `curl https://openrouter.ai/api/v1/chat/completions \\
  -H "Authorization: Bearer $OPENROUTER_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"${modelId}","messages":[{"role":"user","content":"Why is the sky blue?"}]}'`,
  };
}

type CodeTab = keyof ReturnType<typeof getCodeSnippets>;
type TimeRange = '1h' | '1d' | '1w' | '1m' | '1y';

const CODE_TAB_LANGUAGE: Record<CodeTab, 'javascript' | 'python'> = {
  sdk: 'javascript',
  python: 'python',
  http: 'python',
};

const QUICK_START_MODELS = [
  {
    id: 'openai/gpt-5.5',
    label: 'OpenAI',
    icon: OpenAIIcon,
  },
  {
    id: 'anthropic/claude-sonnet-4.6',
    label: 'Anthropic',
    icon: ClaudeIcon,
  },
  {
    id: 'google/gemini-2.5-pro',
    label: 'Gemini',
    icon: GeminiIcon,
  },
] as const;

const TIME_RANGE_OPTIONS: { value: TimeRange; label: string }[] = [
  { value: '1h', label: 'Last 1 hour' },
  { value: '1d', label: 'Last 1 day' },
  { value: '1w', label: 'Last 1 week' },
  { value: '1m', label: 'Last 1 month' },
  { value: '1y', label: 'Last 1 year' },
];

const REQUEST_RANGE_OPTIONS: { value: Extract<TimeRange, '1w' | '1m'>; label: string }[] = [
  { value: '1w', label: 'Last 1 week' },
  { value: '1m', label: 'Last 1 month' },
];

function formatCurrency(value: number): string {
  return `$${value.toFixed(value >= 10 ? 0 : 2)}`;
}

function formatCompact(value: number): string {
  return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(
    value
  );
}

function formatTokenCount(value: number): string {
  return new Intl.NumberFormat('en').format(value);
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
      detail: 'Bucket',
    };
  }

  if (/^\d{4}-\d{2}$/.test(label)) {
    return {
      axis: new Intl.DateTimeFormat(undefined, { month: 'short' }).format(date),
      title: new Intl.DateTimeFormat(undefined, { month: 'short', year: 'numeric' }).format(date),
      detail: 'Monthly',
    };
  }

  if (/T/.test(label)) {
    return {
      axis: new Intl.DateTimeFormat(undefined, {
        hour: 'numeric',
        minute: '2-digit',
      }).format(date),
      title: new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date),
      detail: new Intl.DateTimeFormat(undefined, {
        hour: 'numeric',
        minute: '2-digit',
      }).format(date),
    };
  }

  return {
    axis: new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date),
    title: new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(date),
    detail: 'Daily',
  };
}

function normalizeLogDate(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return `${value}T00:00:00Z`;
  }

  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) {
    return `${value}:00Z`;
  }

  return value;
}

function getProviderLogoId(provider: string): string {
  const normalized = provider.toLowerCase();
  const providerMap: Record<string, string> = {
    anthropic: 'anthropic',
    google: 'google',
    openai: 'openai',
    xai: 'x-ai',
    x: 'x-ai',
    'x-ai': 'x-ai',
    amazon: 'amazon',
    bedrock: 'amazon',
    deepseek: 'deepseek',
    qwen: 'qwen',
  };

  return providerMap[normalized] ?? normalized;
}

function formatRequestModelName(model: string): string {
  const modelName = model.includes('/') ? model.split('/').slice(1).join('/') : model;
  return getFriendlyModelName(modelName).replace(/\bGpt\b/g, 'GPT');
}

function ProviderCell({ provider }: { provider: string }) {
  const Logo = getProviderLogo(getProviderLogoId(provider));

  return (
    <div className="flex min-w-0 items-center gap-2">
      {Logo && <Logo className="size-4 shrink-0 text-foreground" />}
      <span className="truncate">{provider}</span>
    </div>
  );
}

function OpenRouterKeyBox({
  apiKey,
  maskedKey,
  isLoading,
}: {
  apiKey?: string;
  maskedKey?: string;
  isLoading?: boolean;
}) {
  const displayValue = isLoading ? 'Loading…' : maskedKey || 'Not configured';
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
        <button className="flex items-center gap-1 text-[13px] leading-[18px] text-foreground">
          {title}
          <ChevronDown className="size-3 text-muted-foreground" />
        </button>
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
                        <div className="truncate text-muted-foreground">{label.detail}</div>
                        <div className="truncate text-muted-foreground">
                          {valueFormatter(point.value)}
                        </div>
                      </div>
                      <div
                        className="w-full rounded-t-sm bg-[rgb(var(--disabled))]"
                        style={{ height: `${Math.max(8, (point.value / max) * chartHeight)}px` }}
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

function RequestTable({ rows }: { rows: AIOverviewRequestRow[] }) {
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 10;
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const offset = (safeCurrentPage - 1) * pageSize;
  const displayRows = rows.slice(offset, offset + pageSize);

  return (
    <div className="overflow-hidden rounded border border-[var(--alpha-8)] bg-card">
      <div className="grid h-12 grid-cols-[1.3fr_1.4fr_1fr_0.75fr_0.75fr_120px] items-center border-b border-[var(--alpha-8)] px-1.5 text-[13px] leading-[18px] text-muted-foreground">
        <div className="px-2.5">Date</div>
        <div className="px-2.5">Model</div>
        <div className="px-2.5">Provider</div>
        <div className="px-2.5">Input</div>
        <div className="px-2.5">Output</div>
        <div className="px-2.5">Cost</div>
      </div>
      {displayRows.length === 0 ? (
        <div className="flex h-[180px] items-center justify-center text-[13px] text-muted-foreground">
          No OpenRouter activity rows available for this key.
        </div>
      ) : (
        displayRows.map((row, index) => (
          <div
            key={row.id}
            className={[
              'grid h-12 grid-cols-[1.3fr_1.4fr_1fr_0.75fr_0.75fr_120px] items-center px-1.5 text-[13px] leading-[18px] text-foreground',
              index === displayRows.length - 1 ? '' : 'border-b border-[var(--alpha-8)]',
            ].join(' ')}
          >
            <div className="truncate px-2.5">{formatTime(normalizeLogDate(row.date))}</div>
            <div className="truncate px-2.5">{formatRequestModelName(row.model)}</div>
            <div className="min-w-0 px-2.5">
              <ProviderCell provider={row.provider} />
            </div>
            <div className="px-2.5">{formatTokenCount(row.inputTokens)}</div>
            <div className="px-2.5">{formatTokenCount(row.outputTokens)}</div>
            <div className="px-2.5">{formatCurrency(row.cost)}</div>
          </div>
        ))
      )}
      {rows.length > 0 && (
        <PaginationControls
          currentPage={safeCurrentPage}
          totalPages={totalPages}
          onPageChange={setCurrentPage}
          totalRecords={rows.length}
          pageSize={pageSize}
          recordLabel="requests"
          className="[&_button]:h-8 [&_button]:w-8 [&_button]:min-w-8 [&_button]:px-2 [&_svg]:h-5 [&_svg]:w-5 bg-card"
        />
      )}
    </div>
  );
}

export default function AIOverviewPage() {
  const [codeTab, setCodeTab] = useState<CodeTab>('sdk');
  const [selectedModelId, setSelectedModelId] = useState<(typeof QUICK_START_MODELS)[number]['id']>(
    QUICK_START_MODELS[0].id
  );
  const [usageRange, setUsageRange] = useState<TimeRange>('1m');
  const [requestsRange, setRequestsRange] = useState<Extract<TimeRange, '1w' | '1m'>>('1m');
  const { data: usageData, isLoading: isUsageLoading } = useAIOverview(usageRange);
  const { data: requestsData } = useAIOverview(requestsRange);
  const { data: openRouterKey, isLoading: isOpenRouterKeyLoading } = useOpenRouterKey();
  const codeSnippets = useMemo(() => getCodeSnippets(selectedModelId), [selectedModelId]);

  const totals = useMemo(
    () => ({
      spend: formatCurrency(metricTotal(usageData?.charts.spend ?? [])),
      tokens: formatCompact(metricTotal(usageData?.charts.tokens ?? [])),
    }),
    [usageData]
  );

  return (
    <div className="h-full overflow-y-auto bg-[rgb(var(--semantic-1))]">
      <div className="mx-auto flex w-full max-w-[1024px] flex-col gap-6 px-10 py-10">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-medium leading-8 text-foreground">Overview</h1>
          <p className="text-sm leading-5 text-muted-foreground">
            Your models are ready — build LLM-powered features or add more integrations.
          </p>
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
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" className="h-8 bg-[#68e5a2] px-4 text-black hover:bg-[#68e5a2]/90">
                Quick Start
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
              <div className="relative h-[156px] min-h-0 overflow-hidden rounded-b bg-[#1e1e1e]">
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
              {QUICK_START_MODELS.map((model) => {
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
          <h2 className="text-lg font-medium leading-7 text-foreground">Usage</h2>
          <div className="flex gap-2">
            <Select value={usageRange} onValueChange={(value) => setUsageRange(value as TimeRange)}>
              <SelectTrigger className="h-8 w-[180px]">
                <SelectValue placeholder="Last 1 month" />
              </SelectTrigger>
              <SelectContent>
                {TIME_RANGE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {isUsageLoading ? (
            <div className="flex h-[340px] items-center justify-center rounded border border-[var(--alpha-8)] bg-card">
              <Loader2 className="size-8 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              <ChartCard
                title="Spend"
                points={usageData?.charts.spend ?? []}
                value={totals.spend}
                valueFormatter={formatCurrency}
              />
              <ChartCard
                title="Tokens"
                points={usageData?.charts.tokens ?? []}
                value={totals.tokens}
              />
            </div>
          )}
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-medium leading-7 text-foreground">Requests</h2>
          <Select
            value={requestsRange}
            onValueChange={(value) => setRequestsRange(value as Extract<TimeRange, '1w' | '1m'>)}
          >
            <SelectTrigger className="h-8 w-[180px]">
              <SelectValue placeholder="Last 1 month" />
            </SelectTrigger>
            <SelectContent>
              {REQUEST_RANGE_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <RequestTable rows={requestsData?.requests.rows ?? []} />
        </section>
      </div>
    </div>
  );
}
