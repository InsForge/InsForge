import type { Pool } from 'pg';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import { StripeProvider } from '@/providers/payments/stripe.provider.js';
import { StripeConfigService } from '@/services/payments/stripe/config.service.js';
import { PaymentCustomerService } from '@/services/payments/payment-customer.service.js';
import { StripeSubscriptionService } from '@/services/payments/stripe/subscription.service.js';
import { withPaymentSessionAdvisoryLock } from '@/services/payments/payments-advisory-lock.js';
import { getStripeSecretKeyName } from '@/services/payments/stripe/constants.js';
import logger from '@/utils/logger.js';
import type { StripeEnvironment } from '@/types/payments.js';
import type {
  StripeConnection,
  SyncStripePaymentsEnvironmentResult,
  SyncStripePaymentsRequest,
  SyncStripePaymentsResponse,
  SyncStripePaymentsSubscriptionsSummary,
} from '@insforge/shared-schemas';

export class StripeSyncService {
  private static instance: StripeSyncService;
  private pool: Pool | null = null;
  private readonly configService = StripeConfigService.getInstance();
  private readonly customerService = PaymentCustomerService.getInstance();
  private readonly subscriptionService = StripeSubscriptionService.getInstance();

  static getInstance(): StripeSyncService {
    if (!StripeSyncService.instance) {
      StripeSyncService.instance = new StripeSyncService();
    }

    return StripeSyncService.instance;
  }

  private getPool(): Pool {
    if (!this.pool) {
      this.pool = DatabaseManager.getInstance().getPool();
    }

    return this.pool;
  }

  private async withEnvironmentLock<T>(
    environment: StripeEnvironment,
    task: () => Promise<T>
  ): Promise<T> {
    return withPaymentSessionAdvisoryLock(
      this.getPool(),
      `payments_environment_${environment}`,
      task
    );
  }

  async seedStripeKeysFromEnv(): Promise<void> {
    await this.configService.seedStripeKeysFromEnv(async (environment, provider) => {
      await this.syncPaymentsEnvironmentAfterKeyChange(environment, provider);
    });
  }

  async syncPayments(input: SyncStripePaymentsRequest): Promise<SyncStripePaymentsResponse> {
    const environments =
      input.environment === 'all'
        ? this.configService.listStripeEnvironments()
        : [input.environment];
    const results = await Promise.all(
      environments.map((environment) =>
        this.withEnvironmentLock(environment, async () => this.syncPaymentsEnvironment(environment))
      )
    );

    return { results };
  }

  async syncPaymentsEnvironmentAfterKeyChange(
    environment: StripeEnvironment,
    provider: StripeProvider
  ): Promise<SyncStripePaymentsEnvironmentResult> {
    return this.syncPaymentsEnvironment(environment, provider, false);
  }

  private async syncPaymentsEnvironment(
    environment: StripeEnvironment,
    providerOverride?: StripeProvider,
    checkAccountChange = true
  ): Promise<SyncStripePaymentsEnvironmentResult> {
    let provider = providerOverride;

    if (!provider) {
      let secretKey: string | null;

      try {
        secretKey = await this.configService.getStripeSecretKey(environment);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const connection = await this.configService.recordConnectionStatus(
          environment,
          'error',
          message
        );
        return { environment, connection, subscriptions: null };
      }

      if (!secretKey) {
        const connection = await this.configService.recordConnectionStatus(
          environment,
          'unconfigured',
          `${getStripeSecretKeyName(environment)} is not configured`
        );
        return { environment, connection, subscriptions: null };
      }

      provider = new StripeProvider(secretKey, environment);
    }

    try {
      let connection = await this.syncCatalogWithProvider(
        environment,
        provider,
        checkAccountChange
      );

      if (connection.status !== 'connected') {
        return { environment, connection, subscriptions: null };
      }

      try {
        await this.customerService.syncCustomersWithProvider(environment, provider);
      } catch (error) {
        logger.warn('Stripe customer mirror sync failed during payments sync', {
          environment,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      const subscriptions = await this.syncSubscriptionsWithProvider(environment, provider);
      connection = await this.configService.getConnection(environment);

      return { environment, connection, subscriptions };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Stripe payments sync failed', { environment, error: message });
      const connection = await this.configService.recordConnectionStatus(
        environment,
        'error',
        message
      );
      return { environment, connection, subscriptions: null };
    }
  }

  private async syncSubscriptionsWithProvider(
    environment: StripeEnvironment,
    provider: StripeProvider
  ): Promise<SyncStripePaymentsSubscriptionsSummary> {
    return this.subscriptionService.syncSubscriptionsWithProvider(environment, provider);
  }

  private async syncCatalogWithProvider(
    environment: StripeEnvironment,
    provider: StripeProvider,
    checkAccountChange: boolean
  ): Promise<StripeConnection> {
    const snapshot = await provider.syncCatalog();
    const currentStripeAccountId = checkAccountChange
      ? await this.configService.getCurrentStripeAccountId(environment)
      : snapshot.account.id;
    const accountChanged = currentStripeAccountId !== snapshot.account.id;
    const webhookSetup = accountChanged
      ? await this.configService.tryRecreateManagedStripeWebhook(provider, environment)
      : null;

    await this.configService.writeSnapshot(
      environment,
      snapshot,
      new Date(),
      accountChanged,
      webhookSetup
    );

    return this.configService.getConnection(environment);
  }
}
