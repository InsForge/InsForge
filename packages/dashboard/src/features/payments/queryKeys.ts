import type { PaymentEnvironment } from '@insforge/shared-schemas';

export const stripeQueryKeys = {
  all: ['payments', 'stripe'] as const,
  config: ['payments', 'stripe', 'config'] as const,
  status: ['payments', 'stripe', 'status'] as const,
  catalog: ['payments', 'stripe', 'catalog'] as const,
  catalogByEnvironment: (environment: PaymentEnvironment) =>
    ['payments', 'stripe', 'catalog', environment] as const,
  customers: ['payments', 'stripe', 'customers'] as const,
  customersByEnvironment: (environment: PaymentEnvironment) =>
    ['payments', 'stripe', 'customers', environment] as const,
  subscriptions: ['payments', 'stripe', 'subscriptions'] as const,
  subscriptionsByEnvironment: (environment: PaymentEnvironment) =>
    ['payments', 'stripe', 'subscriptions', environment] as const,
  transactions: ['payments', 'stripe', 'transactions'] as const,
  transactionsByEnvironment: (environment: PaymentEnvironment) =>
    ['payments', 'stripe', 'transactions', environment] as const,
};

export const razorpayQueryKeys = {
  all: ['payments', 'razorpay'] as const,
  config: ['payments', 'razorpay', 'config'] as const,
  status: ['payments', 'razorpay', 'status'] as const,
  catalog: ['payments', 'razorpay', 'catalog'] as const,
  catalogByEnvironment: (environment: PaymentEnvironment) =>
    ['payments', 'razorpay', 'catalog', environment] as const,
  customers: ['payments', 'razorpay', 'customers'] as const,
  customersByEnvironment: (environment: PaymentEnvironment) =>
    ['payments', 'razorpay', 'customers', environment] as const,
  subscriptions: ['payments', 'razorpay', 'subscriptions'] as const,
  subscriptionsByEnvironment: (environment: PaymentEnvironment) =>
    ['payments', 'razorpay', 'subscriptions', environment] as const,
  transactions: ['payments', 'razorpay', 'transactions'] as const,
  transactionsByEnvironment: (environment: PaymentEnvironment) =>
    ['payments', 'razorpay', 'transactions', environment] as const,
  webhookSetup: (environment: PaymentEnvironment) =>
    ['payments', 'razorpay', 'webhook-setup', environment] as const,
};
