import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { PaymentEnvironment, PaymentProvider } from '@insforge/shared-schemas';
import { paymentsService } from '#features/payments/services/payments.service';
import { razorpayService } from '#features/payments/services/razorpay.service';

export function usePaymentConnectionStatus(
  provider: PaymentProvider,
  environment: PaymentEnvironment
) {
  const isStripeProvider = provider === 'stripe';
  const isRazorpayProvider = provider === 'razorpay';

  const {
    data: stripeStatusData,
    isLoading: isLoadingStripeStatus,
    error: stripeStatusError,
  } = useQuery({
    queryKey: ['payments', 'status'],
    queryFn: () => paymentsService.getStatus(),
    enabled: isStripeProvider,
    staleTime: 30 * 1000,
  });

  const {
    data: razorpayStatusData,
    isLoading: isLoadingRazorpayStatus,
    error: razorpayStatusError,
  } = useQuery({
    queryKey: ['payments', 'razorpay', 'status'],
    queryFn: () => razorpayService.getStatus(),
    enabled: isRazorpayProvider,
    staleTime: 30 * 1000,
  });

  const activeStripeConnection = useMemo(
    () =>
      stripeStatusData?.connections.find((connection) => connection.environment === environment) ??
      null,
    [environment, stripeStatusData]
  );

  const activeRazorpayConnection = useMemo(
    () =>
      razorpayStatusData?.razorpayConnections.find(
        (connection) => connection.environment === environment
      ) ?? null,
    [environment, razorpayStatusData]
  );

  const activeConnection =
    provider === 'stripe' ? activeStripeConnection : activeRazorpayConnection;

  return {
    activeConnection,
    hasActiveKey: !!activeConnection?.maskedKey,
    isLoading: isStripeProvider ? isLoadingStripeStatus : isLoadingRazorpayStatus,
    error: isStripeProvider ? stripeStatusError : razorpayStatusError,
  };
}
