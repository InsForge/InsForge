import type Stripe from 'stripe';

type StripeInstance = Stripe.Stripe;
type AsyncIterableItem<T> = T extends AsyncIterable<infer Item> ? Item : never;

export const STRIPE_ENVIRONMENTS = ['test', 'live'] as const;
export type StripeEnvironment = (typeof STRIPE_ENVIRONMENTS)[number];

export type StripeConnectionStatus = 'unconfigured' | 'connected' | 'error';
export type StripeLatestSyncStatus = 'succeeded' | 'failed';

export type StripeAccount = Awaited<ReturnType<StripeInstance['accounts']['retrieveCurrent']>>;
export type StripeProduct = AsyncIterableItem<ReturnType<StripeInstance['products']['list']>>;
export type StripePrice = AsyncIterableItem<ReturnType<StripeInstance['prices']['list']>>;
export type StripeClient = Pick<StripeInstance, 'accounts' | 'products' | 'prices'>;

export interface StripeKeyConfig {
  environment: StripeEnvironment;
  hasKey: boolean;
  maskedKey: string | null;
}

export interface StripeSyncSnapshot {
  account: StripeAccount;
  products: StripeProduct[];
  prices: StripePrice[];
}

export interface StripeConnectionRow {
  environment: StripeEnvironment;
  status: StripeConnectionStatus;
  stripeAccountId: string | null;
  stripeAccountEmail: string | null;
  accountLivemode: boolean | null;
  maskedKey?: string | null;
  lastSyncedAt: Date | string | null;
  lastSyncStatus: StripeLatestSyncStatus | null;
  lastSyncError: string | null;
  lastSyncCounts: Record<string, number> | null;
}

export interface StripeProductRow {
  environment: StripeEnvironment;
  stripeProductId: string;
  name: string;
  description: string | null;
  active: boolean;
  defaultPriceId: string | null;
  metadata: Record<string, string>;
  syncedAt: Date | string;
  isDeleted: boolean;
}

export interface StripePriceRow {
  environment: StripeEnvironment;
  stripePriceId: string;
  stripeProductId: string | null;
  active: boolean;
  currency: string;
  unitAmount: number | string | null;
  unitAmountDecimal: string | null;
  type: string;
  lookupKey: string | null;
  billingScheme: string | null;
  taxBehavior: string | null;
  recurringInterval: string | null;
  recurringIntervalCount: number | null;
  metadata: Record<string, string>;
  syncedAt: Date | string;
  isDeleted: boolean;
}
