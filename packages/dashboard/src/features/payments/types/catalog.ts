import type { PaymentProvider, StripeEnvironment } from '@insforge/shared-schemas';

export interface CatalogProduct {
  environment: StripeEnvironment;
  provider: PaymentProvider;
  providerProductId: string;
  name: string;
  description: string | null;
  active: boolean;
  providerDefaultPriceId: string | null;
  metadata: Record<string, string>;
  syncedAt: string;
}

export interface CatalogPrice {
  environment: StripeEnvironment;
  provider: PaymentProvider;
  providerPriceId: string;
  providerProductId: string | null;
  active: boolean;
  currency: string;
  unitAmount: number | null;
  unitAmountDecimal: string | null;
  type: string;
  lookupKey: string | null;
  billingScheme: string | null;
  taxBehavior: string | null;
  recurringInterval: string | null;
  recurringIntervalCount: number | null;
  metadata: Record<string, string>;
  syncedAt: string;
}
