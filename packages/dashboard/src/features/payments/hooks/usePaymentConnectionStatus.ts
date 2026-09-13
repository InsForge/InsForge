import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { PaymentEnvironment, PaymentProvider } from '@insforge/shared-schemas';
import { stripeService } from '#features/payments/services/stripe.service';
import { razorpayService } from '#features/payments/services/razorpay.service';
import { paystackService } from '#features/payments/services/paystack.service';
import {
  paystackQueryKeys,
  razorpayQueryKeys,
  stripeQueryKeys,
} from '#features/payments/queryKeys';

export function usePaymentConnectionStatus(
  provider: PaymentProvider,
  environment: PaymentEnvironment
) {
  const isStripeProvider = provider === 'stripe';
  const isRazorpayProvider = provider === 'razorpay';
  const isPaystackProvider = provider === 'paystack';

  const {
    data: stripeStatusData,
    isLoading: isLoadingStripeStatus,
    error: stripeStatusError,
  } = useQuery({
    queryKey: stripeQueryKeys.status,
    queryFn: () => stripeService.getStatus(),
    enabled: isStripeProvider,
    staleTime: 30 * 1000,
  });

  const {
    data: razorpayStatusData,
    isLoading: isLoadingRazorpayStatus,
    error: razorpayStatusError,
  } = useQuery({
    queryKey: razorpayQueryKeys.status,
    queryFn: () => razorpayService.getStatus(),
    enabled: isRazorpayProvider,
    staleTime: 30 * 1000,
  });

  const {
    data: paystackStatusData,
    isLoading: isLoadingPaystackStatus,
    error: paystackStatusError,
  } = useQuery({
    queryKey: paystackQueryKeys.status,
    queryFn: () => paystackService.getStatus(),
    enabled: isPaystackProvider,
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

  const activePaystackConnection = useMemo(
    () =>
      paystackStatusData?.paystackConnections.find(
        (connection) => connection.environment === environment
      ) ?? null,
    [environment, paystackStatusData]
  );

  const activeConnection = isStripeProvider
    ? activeStripeConnection
    : isRazorpayProvider
      ? activeRazorpayConnection
      : activePaystackConnection;

  return {
    activeConnection,
    hasActiveKey: !!activeConnection?.maskedKey,
    isLoading: isStripeProvider
      ? isLoadingStripeStatus
      : isRazorpayProvider
        ? isLoadingRazorpayStatus
        : isLoadingPaystackStatus,
    error: isStripeProvider
      ? stripeStatusError
      : isRazorpayProvider
        ? razorpayStatusError
        : paystackStatusError,
  };
}
