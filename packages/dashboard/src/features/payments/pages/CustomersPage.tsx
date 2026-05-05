import { useMemo, useState } from 'react';
import { Settings } from 'lucide-react';
import { useOutletContext } from 'react-router-dom';
import { Button, Tab, Tabs } from '@insforge/ui';
import type { StripeCustomerMirror, StripeEnvironment } from '@insforge/shared-schemas';
import { ErrorState, LoadingState, TableHeader } from '#components';
import type { PaymentsOutletContext } from '#features/payments/components/PaymentsLayout';
import { usePaymentCustomers } from '#features/payments/hooks/usePaymentCustomers';
import { cn } from '#lib/utils/utils';

const ENVIRONMENTS: StripeEnvironment[] = ['test', 'live'];

const CUSTOMER_STATUS_CLASSES = {
  active: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  deleted: 'bg-[var(--alpha-3)] text-muted-foreground ring-[var(--alpha-8)]',
} as const;

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

function formatMetadata(metadata: Record<string, string>) {
  const entries = Object.entries(metadata);
  if (entries.length === 0) {
    return 'No metadata';
  }

  return entries
    .slice(0, 2)
    .map(([key, value]) => `${key}:${value}`)
    .join(', ');
}

function CustomerStatus({ deleted }: { deleted: boolean }) {
  const tone = deleted ? 'deleted' : 'active';

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1',
        CUSTOMER_STATUS_CLASSES[tone]
      )}
    >
      {deleted ? 'Deleted' : 'Active'}
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
            Add {keyName} before viewing {environment} Stripe customers.
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

function CustomersTable({ customers }: { customers: StripeCustomerMirror[] }) {
  if (customers.length === 0) {
    return (
      <div className="mx-auto flex w-4/5 max-w-[1120px] flex-col items-center justify-center rounded border border-dashed border-[var(--alpha-8)] bg-card p-8 text-center">
        <p className="text-sm font-medium text-foreground">No customers found</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Sync Stripe payments or wait for customer webhooks to populate this mirror.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-4/5 max-w-[1120px] flex-col gap-1">
      {customers.map((customer) => (
        <div
          key={`${customer.environment}:${customer.stripeCustomerId}`}
          className="rounded border border-[var(--alpha-8)] bg-card"
        >
          <div className="flex items-center rounded">
            <div className="flex h-14 min-w-0 flex-[1.2] flex-col justify-center px-2.5">
              <p className="truncate text-sm font-medium leading-[18px] text-foreground">
                {customer.name ?? customer.email ?? customer.stripeCustomerId}
              </p>
              <p className="truncate text-xs leading-4 text-muted-foreground">
                {customer.email ?? customer.phone ?? 'No contact details'}
              </p>
            </div>

            <div className="flex h-14 w-[110px] shrink-0 items-center px-2.5">
              <CustomerStatus deleted={customer.deleted} />
            </div>

            <div className="flex h-14 min-w-0 flex-[0.9] flex-col justify-center px-2.5">
              <p
                className="truncate font-mono text-xs leading-[18px] text-foreground"
                title={customer.stripeCustomerId}
              >
                {customer.stripeCustomerId}
              </p>
              <p className="truncate text-xs leading-4 text-muted-foreground">
                {formatMetadata(customer.metadata)}
              </p>
            </div>

            <div className="flex h-14 min-w-0 flex-[0.8] flex-col justify-center px-2.5">
              <p className="truncate text-sm leading-[18px] text-foreground">
                {customer.phone ?? 'Not set'}
              </p>
              <p className="truncate text-xs leading-4 text-muted-foreground">
                Created {formatDate(customer.stripeCreatedAt)}
              </p>
            </div>

            <div className="flex h-14 w-[190px] shrink-0 items-center px-2.5">
              <span className="truncate text-sm leading-[18px] text-muted-foreground">
                {formatDate(customer.syncedAt)}
              </span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function CustomersPage() {
  const { openPaymentsSettings } = useOutletContext<PaymentsOutletContext>();
  const [environment, setEnvironment] = useState<StripeEnvironment>('test');
  const [searchQuery, setSearchQuery] = useState('');

  const { activeConnection, customers, isLoading, error, refetch } =
    usePaymentCustomers(environment);
  const hasActiveKey = !!activeConnection?.maskedKey;

  const filteredCustomers = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) {
      return customers;
    }

    return customers.filter((customer) =>
      [
        customer.stripeCustomerId,
        customer.email,
        customer.name,
        customer.phone,
        ...Object.entries(customer.metadata).flatMap(([key, value]) => [key, value]),
      ]
        .filter((value): value is string => typeof value === 'string' && value.length > 0)
        .some((value) => value.toLowerCase().includes(query))
    );
  }, [customers, searchQuery]);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[rgb(var(--semantic-1))]">
      <TableHeader
        title="Customers"
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
        searchPlaceholder="Search customers"
      />

      <div className="relative min-h-0 flex-1 overflow-y-auto">
        {error ? (
          <ErrorState error={error as Error} onRetry={() => void refetch()} />
        ) : isLoading ? (
          <LoadingState message="Loading Stripe customers..." />
        ) : !hasActiveKey ? (
          <ConfigureStripeKeyEmptyState
            environment={environment}
            onConfigure={openPaymentsSettings}
          />
        ) : (
          <>
            <div className="h-10" />

            <div className="sticky top-0 z-10 bg-[rgb(var(--semantic-1))] px-3">
              <div className="mx-auto w-4/5 max-w-[1120px]">
                <div className="flex h-8 items-center text-sm text-muted-foreground">
                  <div className="flex-[1.2] px-2.5 py-1.5">Customer</div>
                  <div className="w-[110px] shrink-0 px-2.5 py-1.5">Status</div>
                  <div className="flex-[0.9] px-2.5 py-1.5">Stripe ID</div>
                  <div className="flex-[0.8] px-2.5 py-1.5">Contact</div>
                  <div className="w-[190px] shrink-0 px-2.5 py-1.5">Synced</div>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-4 px-3 pb-4 pt-1">
              <CustomersTable customers={filteredCustomers} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
