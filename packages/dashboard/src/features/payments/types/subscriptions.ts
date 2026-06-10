import type {
  RazorpaySubscription,
  RazorpaySubscriptionStatus,
  StripeSubscription,
} from '@insforge/shared-schemas';

export type PaymentSubscriptionStatus =
  | 'incomplete'
  | 'incomplete_expired'
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'unpaid'
  | 'paused';

export interface PaymentSubscriptionItem {
  environment: 'test' | 'live';
  provider: 'stripe' | 'razorpay';
  providerSubscriptionItemId: string;
  providerSubscriptionId: string;
  providerProductId: string | null;
  providerPriceId: string | null;
  quantity: number | null;
  metadata: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentSubscription {
  environment: 'test' | 'live';
  provider: 'stripe' | 'razorpay';
  providerSubscriptionId: string;
  providerCustomerId: string | null;
  subjectType: string | null;
  subjectId: string | null;
  status: PaymentSubscriptionStatus;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  cancelAt: string | null;
  canceledAt: string | null;
  trialStart: string | null;
  trialEnd: string | null;
  providerLatestInvoiceId: string | null;
  metadata: Record<string, string>;
  syncedAt: string;
  createdAt: string;
  updatedAt: string;
  items: PaymentSubscriptionItem[];
}

export function normalizeStripeSubscription(subscription: StripeSubscription): PaymentSubscription {
  return {
    environment: subscription.environment,
    provider: 'stripe',
    providerSubscriptionId: subscription.subscriptionId,
    providerCustomerId: subscription.customerId,
    subjectType: subscription.subjectType,
    subjectId: subscription.subjectId,
    status: subscription.status,
    currentPeriodStart: subscription.currentPeriodStart,
    currentPeriodEnd: subscription.currentPeriodEnd,
    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
    cancelAt: subscription.cancelAt,
    canceledAt: subscription.canceledAt,
    trialStart: subscription.trialStart,
    trialEnd: subscription.trialEnd,
    providerLatestInvoiceId: subscription.latestInvoiceId,
    metadata: subscription.metadata,
    syncedAt: subscription.syncedAt,
    createdAt: subscription.createdAt,
    updatedAt: subscription.updatedAt,
    items: subscription.items.map((item) => ({
      environment: item.environment,
      provider: 'stripe',
      providerSubscriptionItemId: item.subscriptionItemId,
      providerSubscriptionId: item.subscriptionId,
      providerProductId: item.productId,
      providerPriceId: item.priceId,
      quantity: item.quantity,
      metadata: item.metadata,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    })),
  };
}

export function normalizeRazorpaySubscription(
  subscription: RazorpaySubscription
): PaymentSubscription {
  return {
    environment: subscription.environment,
    provider: 'razorpay',
    providerSubscriptionId: subscription.subscriptionId,
    providerCustomerId: subscription.customerId,
    subjectType: subscription.subjectType,
    subjectId: subscription.subjectId,
    status: normalizeRazorpaySubscriptionStatus(subscription.status),
    currentPeriodStart: subscription.currentStart,
    currentPeriodEnd: subscription.currentEnd,
    cancelAtPeriodEnd: subscription.status === 'cancelled' || subscription.endAt !== null,
    cancelAt: subscription.endAt,
    canceledAt: subscription.endedAt,
    trialStart: null,
    trialEnd: null,
    providerLatestInvoiceId: null,
    metadata: subscription.notes,
    syncedAt: subscription.syncedAt,
    createdAt: subscription.createdAt,
    updatedAt: subscription.updatedAt,
    items: [
      {
        environment: subscription.environment,
        provider: 'razorpay',
        providerSubscriptionItemId: subscription.planId,
        providerSubscriptionId: subscription.subscriptionId,
        providerProductId: null,
        providerPriceId: subscription.planId,
        quantity: subscription.quantity,
        metadata: subscription.notes,
        createdAt: subscription.createdAt,
        updatedAt: subscription.updatedAt,
      },
    ],
  };
}

function normalizeRazorpaySubscriptionStatus(
  status: RazorpaySubscriptionStatus
): PaymentSubscriptionStatus {
  switch (status) {
    case 'active':
      return 'active';
    case 'created':
    case 'authenticated':
    case 'pending':
      return 'incomplete';
    case 'halted':
      return 'past_due';
    case 'paused':
      return 'paused';
    case 'cancelled':
    case 'completed':
    case 'expired':
      return 'canceled';
  }

  return 'incomplete';
}
