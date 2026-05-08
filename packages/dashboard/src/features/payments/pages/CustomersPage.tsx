import { useCallback, useMemo, useState } from 'react';
import { SortColumn } from 'react-data-grid';
import { AlertCircle, Mail } from 'lucide-react';
import { useOutletContext } from 'react-router-dom';
import type { PaymentCustomerListItem } from '@insforge/shared-schemas';
import MastercardLogo from '#assets/logos/mastercard.svg?react';
import VisaLogo from '#assets/logos/visa.svg?react';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  DataGrid,
  DataGridEmptyState,
  ErrorState,
  LoadingState,
  TableHeader,
  type DataGridColumn,
  type DataGridRowType,
} from '#components';
import { PaymentsKeyMissingState } from '#features/payments/components/PaymentsKeyMissingState';
import type { PaymentsOutletContext } from '#features/payments/components/PaymentsLayout';
import { usePaymentCustomers } from '#features/payments/hooks/usePaymentCustomers';
import { cn } from '#lib/utils/utils';

type CustomerBadgeVariant = 'deleted' | 'guest' | null;

interface CustomerGridRow extends DataGridRowType {
  id: string;
  customerId: string;
  customer: string;
  email: string | null;
  paymentMethodBrand: string | null;
  paymentMethodLast4: string | null;
  countryCode: string | null;
  countryName: string | null;
  totalSpend: number | null;
  totalSpendCurrency: string | null;
  createdAt: string | null;
  paymentsCount: number;
  lastPaymentAt: string | null;
  badgeVariant: CustomerBadgeVariant;
}

const CUSTOMER_BADGE_CLASS_NAMES = {
  deleted: 'bg-[var(--alpha-8)] text-muted-foreground',
  guest: 'bg-[var(--alpha-8)] text-muted-foreground',
} as const;

const countryNames =
  typeof Intl.DisplayNames === 'function'
    ? new Intl.DisplayNames(undefined, { type: 'region' })
    : null;

const CUSTOMER_COLUMNS: DataGridColumn<CustomerGridRow>[] = [
  {
    key: 'customerId',
    name: 'Customer ID',
    width: 220,
    minWidth: 220,
    sortable: true,
    renderCell: ({ row }) => (
      <span
        className="truncate font-mono text-[13px] leading-[18px] text-foreground"
        title={row.customerId}
      >
        {row.customerId}
      </span>
    ),
  },
  {
    key: 'customer',
    name: 'Customer',
    width: 240,
    minWidth: 240,
    sortable: true,
    renderCell: ({ row }) => (
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="truncate text-[13px] leading-[18px] text-foreground" title={row.customer}>
          {row.customer}
        </span>
        <CustomerBadge variant={row.badgeVariant} />
      </div>
    ),
  },
  {
    key: 'email',
    name: 'Email',
    width: 280,
    minWidth: 280,
    sortable: true,
    renderCell: ({ row }) => <EmailCell value={row.email} />,
  },
  {
    key: 'paymentMethodBrand',
    name: 'Primary payment method',
    width: 240,
    minWidth: 240,
    sortable: false,
    renderCell: ({ row }) => (
      <PaymentMethodCell brand={row.paymentMethodBrand} last4={row.paymentMethodLast4} />
    ),
  },
  {
    key: 'countryCode',
    name: 'Country',
    width: 220,
    minWidth: 220,
    sortable: false,
    renderCell: ({ row }) => <CountryCell code={row.countryCode} name={row.countryName} />,
  },
  {
    key: 'totalSpend',
    name: 'Total Spend',
    width: 160,
    minWidth: 160,
    sortable: true,
    renderCell: ({ row }) => (
      <GridValue value={formatCurrencyAmount(row.totalSpend, row.totalSpendCurrency)} />
    ),
  },
  {
    key: 'paymentsCount',
    name: 'Payments',
    width: 120,
    minWidth: 120,
    sortable: true,
    renderCell: ({ row }) => (
      <span
        className="truncate text-[13px] leading-[18px] text-foreground"
        title={String(row.paymentsCount)}
      >
        {row.paymentsCount}
      </span>
    ),
  },
  {
    key: 'lastPaymentAt',
    name: 'Last Payment',
    width: 190,
    minWidth: 190,
    sortable: true,
    renderCell: ({ row }) => <GridValue value={formatDateTime(row.lastPaymentAt)} />,
  },
  {
    key: 'createdAt',
    name: 'Created',
    width: 190,
    minWidth: 190,
    sortable: true,
    sortDescendingFirst: false,
    renderCell: ({ row }) => <GridValue value={formatDateTime(row.createdAt)} />,
  },
];

function formatDateTime(value: string | null) {
  if (!value) {
    return '-';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function formatCurrencyAmount(amount: number | null, currency: string | null) {
  if (amount === null || !currency) {
    return '-';
  }

  const normalizedCurrency = currency.toUpperCase();
  const fractionDigits =
    new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: normalizedCurrency,
      currencyDisplay: 'code',
    }).resolvedOptions().maximumFractionDigits ?? 2;

  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: normalizedCurrency,
    currencyDisplay: 'code',
  }).format(amount / 10 ** fractionDigits);
}

function getCustomerLabel(customer: PaymentCustomerListItem) {
  return customer.name ?? customer.email ?? customer.stripeCustomerId;
}

function getCustomerBadgeVariant(customer: PaymentCustomerListItem): CustomerBadgeVariant {
  if (customer.deleted) {
    return 'deleted';
  }

  return customer.name ? null : 'guest';
}

function getCountryName(countryCode: string | null) {
  if (!countryCode) {
    return null;
  }

  try {
    return countryNames?.of(countryCode) ?? countryCode;
  } catch {
    return countryCode;
  }
}

function getFlagUrl(countryCode: string) {
  return `https://flagcdn.com/${countryCode.toLowerCase()}.svg`;
}

function normalizeCardBrand(brand: string | null) {
  if (!brand) {
    return null;
  }

  const normalizedBrand = brand.trim().toLowerCase();
  if (normalizedBrand === 'visa') {
    return 'visa';
  }

  if (normalizedBrand === 'mastercard' || normalizedBrand === 'master card') {
    return 'mastercard';
  }

  return normalizedBrand;
}

function compareGridValues(
  leftValue: string | number | null,
  rightValue: string | number | null,
  direction: SortColumn['direction']
) {
  if ((leftValue === null || leftValue === '') && (rightValue === null || rightValue === '')) {
    return 0;
  }

  if (leftValue === null || leftValue === '') {
    return direction === 'ASC' ? -1 : 1;
  }

  if (rightValue === null || rightValue === '') {
    return direction === 'ASC' ? 1 : -1;
  }

  let comparison = 0;
  if (typeof leftValue === 'number' && typeof rightValue === 'number') {
    comparison = leftValue - rightValue;
  } else {
    comparison = String(leftValue).localeCompare(String(rightValue), undefined, {
      sensitivity: 'base',
      numeric: true,
    });
  }

  return direction === 'ASC' ? comparison : -comparison;
}

function CustomerBadge({ variant }: { variant: CustomerBadgeVariant }) {
  if (!variant) {
    return null;
  }

  return (
    <span
      className={cn(
        'inline-flex items-center rounded px-2 py-0.5 text-xs font-medium',
        CUSTOMER_BADGE_CLASS_NAMES[variant]
      )}
    >
      {variant === 'deleted' ? 'Deleted' : 'Guest'}
    </span>
  );
}

function GridValue({ value }: { value: string | null }) {
  if (!value) {
    return <span className="text-[13px] leading-[18px] text-muted-foreground">-</span>;
  }

  return (
    <span className="truncate text-[13px] leading-[18px] text-foreground" title={value}>
      {value}
    </span>
  );
}

function EmailCell({ value }: { value: string | null }) {
  if (!value) {
    return <span className="text-[13px] leading-[18px] text-muted-foreground">-</span>;
  }

  return (
    <div className="flex min-w-0 items-center gap-2">
      <Mail className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span className="truncate text-[13px] leading-[18px] text-foreground" title={value}>
        {value}
      </span>
    </div>
  );
}

function PaymentMethodCell({ brand, last4 }: { brand: string | null; last4: string | null }) {
  const normalizedBrand = normalizeCardBrand(brand);

  if (!normalizedBrand && !last4) {
    return <span className="text-[13px] leading-[18px] text-muted-foreground">-</span>;
  }

  const BrandIcon =
    normalizedBrand === 'visa'
      ? VisaLogo
      : normalizedBrand === 'mastercard'
        ? MastercardLogo
        : null;
  const maskedDigits = last4 ? `•••• ${last4}` : null;
  const fallbackLabel =
    normalizedBrand && maskedDigits
      ? `${normalizedBrand.charAt(0).toUpperCase()}${normalizedBrand.slice(1)} ${maskedDigits}`
      : normalizedBrand
        ? normalizedBrand.charAt(0).toUpperCase() + normalizedBrand.slice(1)
        : maskedDigits;

  return (
    <div className="flex min-w-0 items-center gap-2">
      {BrandIcon ? (
        <span className="inline-flex h-5 w-8 shrink-0 items-center justify-center rounded-[4px] border border-[var(--alpha-8)] bg-white px-1 shadow-[0_1px_1px_rgba(0,0,0,0.04)]">
          <BrandIcon className="h-3.5 w-6 shrink-0" aria-hidden="true" />
        </span>
      ) : (
        <span
          className="truncate text-[13px] leading-[18px] text-foreground"
          title={fallbackLabel ?? ''}
        >
          {fallbackLabel}
        </span>
      )}
      {BrandIcon && maskedDigits && (
        <span className="truncate text-[13px] leading-[18px] text-foreground" title={maskedDigits}>
          {maskedDigits}
        </span>
      )}
      {BrandIcon && !maskedDigits && normalizedBrand && (
        <span
          className="truncate text-[13px] leading-[18px] text-foreground capitalize"
          title={normalizedBrand}
        >
          {normalizedBrand}
        </span>
      )}
    </div>
  );
}

function CountryCell({ code, name }: { code: string | null; name: string | null }) {
  if (!code) {
    return <span className="text-[13px] leading-[18px] text-muted-foreground">-</span>;
  }

  const countryLabel = name ?? code;

  return (
    <div className="flex min-w-0 items-center gap-2">
      <img
        src={getFlagUrl(code)}
        alt=""
        className="h-3.5 w-5 shrink-0 rounded-[2px] object-cover"
        loading="lazy"
      />
      <span className="truncate text-[13px] leading-[18px] text-foreground" title={countryLabel}>
        {countryLabel}
      </span>
    </div>
  );
}

export default function CustomersPage() {
  const { openPaymentsSettings, environment } = useOutletContext<PaymentsOutletContext>();
  const [searchQuery, setSearchQuery] = useState('');
  const [sortColumns, setSortColumns] = useState<SortColumn[]>([
    { columnKey: 'lastPaymentAt', direction: 'DESC' },
  ]);

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
        customer.totalSpendCurrency,
        customer.paymentMethodBrand,
        customer.paymentMethodLast4,
        customer.countryCode,
        ...Object.entries(customer.metadata).flatMap(([key, value]) => [key, value]),
      ]
        .filter((value): value is string => typeof value === 'string' && value.length > 0)
        .some((value) => value.toLowerCase().includes(query))
    );
  }, [customers, searchQuery]);

  const customerRows = useMemo<CustomerGridRow[]>(
    () =>
      filteredCustomers.map((customer) => ({
        id: `${customer.environment}:${customer.stripeCustomerId}`,
        customerId: customer.stripeCustomerId,
        customer: getCustomerLabel(customer),
        email: customer.email,
        paymentMethodBrand: customer.paymentMethodBrand,
        paymentMethodLast4: customer.paymentMethodLast4,
        countryCode: customer.countryCode,
        countryName: getCountryName(customer.countryCode),
        totalSpend: customer.totalSpend,
        totalSpendCurrency: customer.totalSpendCurrency,
        createdAt: customer.stripeCreatedAt,
        paymentsCount: customer.paymentsCount,
        lastPaymentAt: customer.lastPaymentAt,
        badgeVariant: getCustomerBadgeVariant(customer),
      })),
    [filteredCustomers]
  );

  const sortedCustomerRows = useMemo(() => {
    if (sortColumns.length === 0) {
      return customerRows;
    }

    return [...customerRows].sort((leftRow, rightRow) => {
      for (const sortColumn of sortColumns) {
        const leftValue = leftRow[sortColumn.columnKey as keyof CustomerGridRow];
        const rightValue = rightRow[sortColumn.columnKey as keyof CustomerGridRow];
        const comparison = compareGridValues(
          typeof leftValue === 'string' || typeof leftValue === 'number' ? leftValue : null,
          typeof rightValue === 'string' || typeof rightValue === 'number' ? rightValue : null,
          sortColumn.direction
        );

        if (comparison !== 0) {
          return comparison;
        }
      }

      return 0;
    });
  }, [customerRows, sortColumns]);

  const handlePageChange = useCallback((_page: number) => {}, []);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[rgb(var(--semantic-1))]">
      <TableHeader
        title="Customers"
        className="h-14 min-h-14"
        leftClassName="py-0"
        rightClassName="py-0"
        showSearch={hasActiveKey}
        searchValue={searchQuery}
        onSearchChange={setSearchQuery}
        searchDebounceTime={300}
        searchPlaceholder="Search customer"
        searchInputClassName="w-[280px]"
      />

      <div className="relative min-h-0 flex-1 overflow-hidden">
        {error ? (
          <ErrorState error={error as Error} onRetry={() => void refetch()} />
        ) : isLoading ? (
          <LoadingState message="Loading Stripe customers..." />
        ) : !hasActiveKey ? (
          <PaymentsKeyMissingState
            environment={environment}
            resourceLabel="customers"
            onConfigure={openPaymentsSettings}
          />
        ) : (
          <div className="flex h-full flex-col">
            {activeConnection?.lastSyncError && (
              <div className="px-3 py-3">
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>Latest sync failed</AlertTitle>
                  <AlertDescription className="mt-2">
                    {activeConnection.lastSyncError}
                  </AlertDescription>
                </Alert>
              </div>
            )}

            <div className="min-h-0 flex-1 overflow-hidden">
              <DataGrid<CustomerGridRow>
                data={sortedCustomerRows}
                columns={CUSTOMER_COLUMNS}
                sortColumns={sortColumns}
                onSortColumnsChange={setSortColumns}
                currentPage={1}
                totalPages={1}
                pageSize={Math.max(sortedCustomerRows.length, 1)}
                totalRecords={sortedCustomerRows.length}
                onPageChange={handlePageChange}
                paginationRecordLabel="customers"
                showSelection={false}
                showTypeBadge={false}
                headerRowHeight={32}
                rowHeight={32}
                className="h-full"
                emptyState={
                  <DataGridEmptyState
                    message={
                      searchQuery.trim().length > 0
                        ? 'No customers match your search criteria'
                        : 'No customers found'
                    }
                  />
                }
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
