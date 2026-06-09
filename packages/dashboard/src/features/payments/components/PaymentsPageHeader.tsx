import {
  SearchInput,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@insforge/ui';
import type { PaymentEnvironment } from '@insforge/shared-schemas';
import { TableHeader } from '#components';
import { PaymentProviderSelect } from './PaymentProviderSelect';
import type { PaymentsOutletContext } from './PaymentsLayout';

const PAYMENT_ENVIRONMENT_LABELS: Record<PaymentEnvironment, string> = {
  test: 'Test',
  live: 'Live',
};

const PAYMENT_ENVIRONMENTS: PaymentEnvironment[] = ['test', 'live'];

interface PaymentsPageHeaderProps extends Pick<
  PaymentsOutletContext,
  'provider' | 'setProvider' | 'environment' | 'setEnvironment'
> {
  title: string;
  leftSlot?: React.ReactNode;
  showDividerAfterTitle?: boolean;
  showSearch?: boolean;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  searchInputClassName?: string;
  searchDebounceTime?: number;
}

export function PaymentsPageHeader({
  title,
  leftSlot,
  showDividerAfterTitle,
  showSearch = true,
  searchValue = '',
  onSearchChange,
  searchPlaceholder,
  searchInputClassName,
  searchDebounceTime,
  provider,
  setProvider,
  environment,
  setEnvironment,
}: PaymentsPageHeaderProps) {
  const shouldShowSearch = showSearch && !!onSearchChange;

  return (
    <TableHeader
      title={title}
      className="h-14 min-h-14"
      leftClassName="py-0"
      rightClassName="py-0"
      showDividerAfterTitle={showDividerAfterTitle}
      leftSlot={leftSlot}
      showSearch={false}
      rightActions={
        <>
          {shouldShowSearch && (
            <SearchInput
              value={searchValue}
              onChange={onSearchChange}
              placeholder={searchPlaceholder ?? 'Search'}
              debounceTime={searchDebounceTime ?? 0}
              className={searchInputClassName ?? 'w-64'}
            />
          )}

          <div className="flex items-center gap-1.5">
            <span className="text-sm font-medium text-muted-foreground">Provider:</span>
            <PaymentProviderSelect value={provider} onValueChange={setProvider} />
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-sm font-medium text-muted-foreground">Environment:</span>
            <Select
              value={environment}
              onValueChange={(value) => setEnvironment(value as PaymentEnvironment)}
            >
              <SelectTrigger className="h-9 w-[108px]" aria-label="Payment environment">
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end" className="w-[108px]">
                {PAYMENT_ENVIRONMENTS.map((item) => (
                  <SelectItem key={item} value={item}>
                    {PAYMENT_ENVIRONMENT_LABELS[item]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </>
      }
    />
  );
}
