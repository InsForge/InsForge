import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ChevronRight, Settings } from 'lucide-react';
import { useOutletContext } from 'react-router-dom';
import { Button, Tab, Tabs } from '@insforge/ui';
import { ErrorState, LoadingState, TableHeader } from '../../../components';
import { cn } from '../../../lib/utils/utils';
import { usePaymentSubscriptions } from '../hooks/usePaymentSubscriptions';
import type { PaymentsOutletContext } from '../components/PaymentsLayout';
import type {
  StripeEnvironment,
  StripeSubscriptionItem,
  StripeSubscriptionMirror,
  StripeSubscriptionStatus,
} from '@insforge/shared-schemas';

const ENVIRONMENTS: StripeEnvironment[] = ['test', 'live'];

const SUBSCRIPTION_STATUS_CLASSES: Record<StripeSubscriptionStatus, string> = {
  incomplete: 'bg-amber-50 text-amber-700 ring-amber-200',
  incomplete_expired: 'bg-[var(--alpha-3)] text-muted-foreground ring-[var(--alpha-8)]',
  trialing: 'bg-sky-50 text-sky-700 ring-sky-200',
  active: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  past_due: 'bg-amber-50 text-amber-700 ring-amber-200',
  canceled: 'bg-[var(--alpha-3)] text-muted-foreground ring-[var(--alpha-8)]',
  unpaid: 'bg-rose-50 text-rose-700 ring-rose-200',
  paused: 'bg-[var(--alpha-3)] text-muted-foreground ring-[var(--alpha-8)]',
};

function formatDate(value: string | null) {
  if (!value) {
    return 'Not set';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function formatShortDate(value: string | null) {
  if (!value) {
    return 'Not set';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

function formatStatusLabel(status: StripeSubscriptionStatus) {
  return status
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function formatPeriod(subscription: StripeSubscriptionMirror) {
  if (!subscription.currentPeriodStart && !subscription.currentPeriodEnd) {
    return 'No active period';
  }

  return `${formatShortDate(subscription.currentPeriodStart)} - ${formatShortDate(
    subscription.currentPeriodEnd
  )}`;
}

function formatSubject(subscription: StripeSubscriptionMirror) {
  if (!subscription.subjectType || !subscription.subjectId) {
    return 'Unmapped';
  }

  return `${subscription.subjectType}:${subscription.subjectId}`;
}

function SubscriptionStatus({ status }: { status: StripeSubscriptionStatus }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1',
        SUBSCRIPTION_STATUS_CLASSES[status]
      )}
    >
      {formatStatusLabel(status)}
    </span>
  );
}

function ConfigureStripeKeyEmptyState({
  environment,
  onConfigure,
}: {
  environment: StripeEnvironment;
  onConfigure: () => void;
}) {
  const keyName = environment === 'test' ? 'STRIPE_TEST_SECRET_KEY' : 'STRIPE_LIVE_SECRET_KEY';

  return (
    <div className="flex h-full min-h-[320px] items-center justify-center px-6 text-center">
      <div className="flex max-w-md flex-col items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--alpha-3)] text-muted-foreground">
          <Settings className="h-5 w-5" />
        </div>
        <div className="flex flex-col gap-1">
          <h2 className="text-sm font-medium text-foreground">
            Configure your Stripe {environment} key
          </h2>
          <p className="text-sm leading-6 text-muted-foreground">
            Add {keyName} before viewing {environment} subscriptions and subscription items.
          </p>
        </div>
        <Button variant="secondary" onClick={onConfigure} className="mt-1 h-9 rounded px-3">
          <Settings className="h-4 w-4" />
          Configure Stripe API keys
        </Button>
      </div>
    </div>
  );
}

function DetailCard({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded border border-[var(--alpha-8)] bg-card p-4">
      <p className="mb-1 text-sm text-muted-foreground">{label}</p>
      <div className="text-sm text-foreground">{value}</div>
    </div>
  );
}

function MonospaceValue({ value }: { value: string | null }) {
  return value ? (
    <span className="block max-w-full truncate font-mono text-xs text-foreground" title={value}>
      {value}
    </span>
  ) : (
    <span className="block max-w-full truncate text-muted-foreground">Not set</span>
  );
}

function SubscriptionsTable({
  subscriptions,
  onSelectSubscription,
}: {
  subscriptions: StripeSubscriptionMirror[];
  onSelectSubscription: (subscription: StripeSubscriptionMirror) => void;
}) {
  if (subscriptions.length === 0) {
    return (
      <div className="mx-auto flex w-4/5 max-w-[1024px] flex-col items-center justify-center rounded border border-dashed border-[var(--alpha-8)] bg-card p-8 text-center">
        <p className="text-sm font-medium text-foreground">No subscriptions found</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Completed subscription checkouts will appear after Stripe webhooks are processed.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-4/5 max-w-[1024px] flex-col gap-1">
      {subscriptions.map((subscription) => (
        <button
          key={`${subscription.environment}:${subscription.stripeSubscriptionId}`}
          type="button"
          onClick={() => onSelectSubscription(subscription)}
          className="rounded border border-[var(--alpha-8)] bg-card text-left"
        >
          <div className="flex cursor-pointer items-center rounded transition-colors hover:bg-[var(--alpha-8)]">
            <div className="flex w-[30px] shrink-0 items-center justify-center">
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </div>

            <div className="flex h-12 min-w-0 flex-[1.5] flex-col justify-center px-2.5">
              <p className="truncate font-mono text-xs leading-[18px] text-foreground">
                {subscription.stripeSubscriptionId}
              </p>
              <p className="truncate font-mono text-xs leading-4 text-muted-foreground">
                {subscription.stripeCustomerId}
              </p>
            </div>

            <div className="flex h-12 w-[120px] shrink-0 items-center px-2.5">
              <SubscriptionStatus status={subscription.status} />
            </div>

            <div className="flex h-12 min-w-0 flex-1 items-center px-2.5">
              <span className="truncate font-mono text-xs leading-[18px] text-muted-foreground">
                {formatSubject(subscription)}
              </span>
            </div>

            <div className="flex h-12 w-[90px] shrink-0 items-center px-2.5">
              <span className="text-sm leading-[18px] text-foreground">
                {subscription.items?.length ?? 0}
              </span>
            </div>

            <div className="flex h-12 w-[180px] shrink-0 items-center px-2.5">
              <span className="truncate text-sm leading-[18px] text-muted-foreground">
                {formatPeriod(subscription)}
              </span>
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}

function SubscriptionItemsTable({ items }: { items: StripeSubscriptionItem[] }) {
  if (items.length === 0) {
    return (
      <div className="rounded border border-dashed border-[var(--alpha-8)] bg-card p-8 text-center">
        <p className="text-sm font-medium text-foreground">No subscription items found</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Stripe items will appear after the subscription webhook projection is updated.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded border border-[var(--alpha-8)] bg-card">
      <div className="grid grid-cols-[minmax(140px,1fr)_minmax(120px,0.85fr)_minmax(140px,1fr)_120px] border-b border-[var(--alpha-8)] px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <div>Item</div>
        <div>Product</div>
        <div>Price</div>
        <div>Quantity</div>
      </div>
      {items.map((item) => (
        <div
          key={`${item.environment}:${item.stripeSubscriptionItemId}`}
          className="grid grid-cols-[minmax(140px,1fr)_minmax(120px,0.85fr)_minmax(140px,1fr)_120px] items-center border-b border-[var(--alpha-6)] px-4 py-3 text-sm last:border-0"
        >
          <div className="min-w-0">
            <p
              className="block max-w-full truncate font-mono text-xs text-foreground"
              title={item.stripeSubscriptionItemId}
            >
              {item.stripeSubscriptionItemId}
            </p>
          </div>
          <div className="min-w-0">
            <MonospaceValue value={item.stripeProductId} />
          </div>
          <div className="min-w-0">
            <MonospaceValue value={item.stripePriceId} />
          </div>
          <div className="min-w-0 truncate text-foreground">{item.quantity ?? 'Not set'}</div>
        </div>
      ))}
    </div>
  );
}

function SubscriptionDetail({
  subscription,
  onBack,
}: {
  subscription: StripeSubscriptionMirror;
  onBack: () => void;
}) {
  const items = subscription.items ?? [];

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[rgb(var(--semantic-1))]">
      <div className="flex h-14 shrink-0 items-center gap-2.5 border-b border-[var(--alpha-8)] bg-[rgb(var(--semantic-0))] px-4">
        <button
          type="button"
          onClick={onBack}
          className="text-base font-medium leading-7 text-muted-foreground transition-colors hover:text-foreground"
        >
          Subscriptions
        </button>
        <ChevronRight className="h-5 w-5 text-muted-foreground" />
        <p className="truncate font-mono text-xs font-medium leading-7 text-foreground">
          {subscription.stripeSubscriptionId}
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        <div className="mx-auto flex w-4/5 max-w-[1024px] flex-col gap-4">
          <div className="grid grid-cols-3 gap-4">
            <DetailCard
              label="Status"
              value={<SubscriptionStatus status={subscription.status} />}
            />
            <DetailCard label="Items" value={items.length} />
            <DetailCard label="Current period" value={formatPeriod(subscription)} />
          </div>

          <div className="rounded border border-[var(--alpha-8)] bg-card p-4">
            <p className="mb-2 text-sm text-muted-foreground">Subscription</p>
            <p className="font-mono text-xs text-foreground">{subscription.stripeSubscriptionId}</p>

            <div className="mt-4 grid grid-cols-2 gap-4">
              <div>
                <p className="mb-1 text-sm text-muted-foreground">Customer</p>
                <MonospaceValue value={subscription.stripeCustomerId} />
              </div>
              <div>
                <p className="mb-1 text-sm text-muted-foreground">Subject</p>
                <span className="font-mono text-xs text-foreground">
                  {formatSubject(subscription)}
                </span>
              </div>
              <div>
                <p className="mb-1 text-sm text-muted-foreground">Latest invoice</p>
                <MonospaceValue value={subscription.latestInvoiceId} />
              </div>
              <div>
                <p className="mb-1 text-sm text-muted-foreground">Updated</p>
                <span className="text-sm text-foreground">
                  {formatDate(subscription.updatedAt)}
                </span>
              </div>
            </div>
          </div>

          <section className="flex flex-col gap-3">
            <div>
              <h2 className="text-base font-medium text-foreground">Subscription items</h2>
              <p className="text-sm text-muted-foreground">
                Stripe items associated with this subscription, including product and price links.
              </p>
            </div>
            <SubscriptionItemsTable items={items} />
          </section>
        </div>
      </div>
    </div>
  );
}

export default function SubscriptionsPage() {
  const { openPaymentsSettings } = useOutletContext<PaymentsOutletContext>();
  const [environment, setEnvironment] = useState<StripeEnvironment>('test');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSubscription, setSelectedSubscription] = useState<StripeSubscriptionMirror | null>(
    null
  );
  const { activeConnection, subscriptions, isLoading, error, refetch } =
    usePaymentSubscriptions(environment);

  useEffect(() => {
    setSelectedSubscription(null);
  }, [environment]);

  const filteredSubscriptions = useMemo(() => {
    const normalizedSearch = searchQuery.trim().toLowerCase();
    if (!normalizedSearch) {
      return subscriptions;
    }

    return subscriptions.filter((subscription) => {
      const itemValues = (subscription.items ?? []).flatMap((item) => [
        item.stripeSubscriptionItemId,
        item.stripeProductId,
        item.stripePriceId,
      ]);

      return [
        subscription.stripeSubscriptionId,
        subscription.stripeCustomerId,
        subscription.subjectType,
        subscription.subjectId,
        subscription.status,
        subscription.latestInvoiceId,
        ...itemValues,
      ]
        .filter(Boolean)
        .some((value) => value?.toLowerCase().includes(normalizedSearch));
    });
  }, [subscriptions, searchQuery]);

  const hasActiveKey = !!activeConnection?.maskedKey;

  if (selectedSubscription) {
    return (
      <SubscriptionDetail
        subscription={selectedSubscription}
        onBack={() => setSelectedSubscription(null)}
      />
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[rgb(var(--semantic-1))]">
      <TableHeader
        title="Subscriptions"
        className="h-14 min-h-14"
        leftClassName="py-0"
        rightClassName="py-0"
        showDividerAfterTitle
        titleButtons={
          <Tabs
            value={environment}
            onValueChange={(value) => setEnvironment(value as StripeEnvironment)}
            className="h-8"
          >
            {ENVIRONMENTS.map((item) => (
              <Tab key={item} value={item} className="h-8 py-0">
                {item === 'test' ? 'Test' : 'Live'}
              </Tab>
            ))}
          </Tabs>
        }
        showSearch={hasActiveKey}
        searchValue={searchQuery}
        onSearchChange={setSearchQuery}
        searchDebounceTime={300}
        searchPlaceholder="Search subscriptions"
      />

      <div className="relative min-h-0 flex-1 overflow-y-auto">
        {error ? (
          <ErrorState error={error as Error} onRetry={() => void refetch()} />
        ) : isLoading ? (
          <LoadingState message="Loading Stripe subscriptions..." />
        ) : !hasActiveKey ? (
          <ConfigureStripeKeyEmptyState
            environment={environment}
            onConfigure={openPaymentsSettings}
          />
        ) : (
          <>
            <div className="h-10" />

            <div className="sticky top-0 z-10 bg-[rgb(var(--semantic-1))] px-3">
              <div className="mx-auto w-4/5 max-w-[1024px]">
                <div className="flex h-8 items-center text-sm text-muted-foreground">
                  <div className="w-[30px] shrink-0" />
                  <div className="flex-[1.5] px-2.5 py-1.5">Subscription</div>
                  <div className="w-[120px] shrink-0 px-2.5 py-1.5">Status</div>
                  <div className="flex-1 px-2.5 py-1.5">Subject</div>
                  <div className="w-[90px] shrink-0 px-2.5 py-1.5">Items</div>
                  <div className="w-[180px] shrink-0 px-2.5 py-1.5">Current Period</div>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-4 px-3 pb-4 pt-1">
              <SubscriptionsTable
                subscriptions={filteredSubscriptions}
                onSelectSubscription={setSelectedSubscription}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
