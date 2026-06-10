import type { Pool, PoolClient } from 'pg';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import { getBillingSubjectFromProviderAttributes } from '@/services/payments/helpers.js';
import { RazorpayConfigService } from '@/services/payments/razorpay/config.service.js';
import { RazorpayTransactionService } from '@/services/payments/razorpay/transaction.service.js';
import { withPaymentSessionAdvisoryLock } from '@/services/payments/payments-advisory-lock.js';
import type {
  RazorpayProvider,
  RazorpayPlan,
  RazorpayItem,
  RazorpayCustomer,
  RazorpaySubscription,
  RazorpayPayment,
  RazorpayInvoice,
} from '@/providers/payments/razorpay.provider.js';
import type { RazorpayEnvironment } from '@/types/payments.js';
import logger from '@/utils/logger.js';
import type {
  BillingSubject,
  RazorpayConnection,
  RazorpaySyncCounts,
  SyncRazorpayPaymentsEnvironmentResult,
  SyncRazorpayPaymentsResponse,
} from '@insforge/shared-schemas';

const EMPTY_RAZORPAY_SYNC_COUNTS: RazorpaySyncCounts = {
  plans: 0,
  items: 0,
  customers: 0,
  subscriptions: 0,
  invoices: 0,
  payments: 0,
};

interface RazorpaySyncStageFailure {
  stage: 'customers' | 'subscriptions' | 'invoices' | 'payments';
  error: string;
}

interface RazorpayCatalogItemInput {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
  amount: number | null;
  unitAmount: number | null;
  currency: string;
  type: string | null;
  raw: unknown;
  createdAt: number | null;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatStageFailures(failures: RazorpaySyncStageFailure[]): string {
  return failures.map((failure) => `${failure.stage}: ${failure.error}`).join('; ');
}

function normalizeRazorpayNotes(
  notes: Record<string, string | number | boolean> | undefined
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(notes ?? {}).map(([key, value]) => [key, String(value)])
  );
}

export class RazorpaySyncService {
  private static instance: RazorpaySyncService;
  private pool: Pool | null = null;
  private readonly configService = RazorpayConfigService.getInstance();
  private readonly transactionService = RazorpayTransactionService.getInstance();

  static getInstance(): RazorpaySyncService {
    if (!RazorpaySyncService.instance) {
      RazorpaySyncService.instance = new RazorpaySyncService();
    }
    return RazorpaySyncService.instance;
  }

  private getPool(): Pool {
    if (!this.pool) {
      this.pool = DatabaseManager.getInstance().getPool();
    }
    return this.pool;
  }

  async syncAll(
    environmentInput: RazorpayEnvironment | 'all'
  ): Promise<SyncRazorpayPaymentsResponse> {
    const environments =
      environmentInput === 'all'
        ? this.configService.listRazorpayEnvironments()
        : [environmentInput];

    const results: SyncRazorpayPaymentsEnvironmentResult[] = [];

    for (const environment of environments) {
      results.push(await this.syncEnvironment(environment));
    }

    return { results };
  }

  async syncEnvironmentAfterKeyChange(
    environment: RazorpayEnvironment,
    provider: RazorpayProvider
  ): Promise<SyncRazorpayPaymentsEnvironmentResult> {
    return this.performSyncEnvironment(environment, provider);
  }

  private syncEnvironment(
    environment: RazorpayEnvironment
  ): Promise<SyncRazorpayPaymentsEnvironmentResult> {
    return withPaymentSessionAdvisoryLock(
      this.getPool(),
      `payments_razorpay_environment_${environment}`,
      () => this.performSyncEnvironment(environment)
    );
  }

  private async performSyncEnvironment(
    environment: RazorpayEnvironment,
    providerOverride?: RazorpayProvider
  ): Promise<SyncRazorpayPaymentsEnvironmentResult> {
    let provider = providerOverride;
    if (!provider) {
      try {
        provider = await this.configService.createRazorpayProvider(environment);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn('Razorpay sync skipped: keys not configured', { environment, error: message });
        const connection = await this.configService.recordConnectionStatus(
          environment,
          'unconfigured',
          message
        );
        return this.buildSyncResult(
          environment,
          'failed',
          connection,
          EMPTY_RAZORPAY_SYNC_COUNTS,
          message
        );
      }
    }

    try {
      const { account, plans, items } = await provider.syncCatalog();

      const client = await this.getPool().connect();
      try {
        await client.query('BEGIN');
        await this.upsertItems(client, environment, items);
        await this.upsertPlans(client, environment, plans);
        await this.deleteMissingCatalogRows(client, environment, items, plans);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }

      const stageFailures: RazorpaySyncStageFailure[] = [];
      let customers: RazorpayCustomer[] = [];
      try {
        customers = await provider.listCustomers();
        await this.upsertCustomers(environment, customers);
      } catch (err) {
        const error = getErrorMessage(err);
        stageFailures.push({ stage: 'customers', error });
        logger.warn('Razorpay customer sync failed', {
          environment,
          error,
        });
      }

      let subscriptions: RazorpaySubscription[] = [];
      try {
        subscriptions = await provider.listSubscriptions();
        await this.upsertSubscriptions(environment, subscriptions);
      } catch (err) {
        const error = getErrorMessage(err);
        stageFailures.push({ stage: 'subscriptions', error });
        logger.warn('Razorpay subscription sync failed', {
          environment,
          error,
        });
      }

      let invoices: RazorpayInvoice[] = [];
      try {
        invoices = await provider.listInvoices();
        await this.transactionService.upsertInvoices(environment, invoices);
      } catch (err) {
        const error = getErrorMessage(err);
        stageFailures.push({ stage: 'invoices', error });
        logger.warn('Razorpay invoice transaction sync failed', {
          environment,
          error,
        });
      }

      let payments: RazorpayPayment[] = [];
      try {
        payments = await provider.listPayments();
        await this.transactionService.upsertPayments(environment, payments);
      } catch (err) {
        const error = getErrorMessage(err);
        stageFailures.push({ stage: 'payments', error });
        logger.warn('Razorpay transaction sync failed', {
          environment,
          error,
        });
      }

      const syncCounts: RazorpaySyncCounts = {
        plans: plans.length,
        items: items.length,
        customers: customers.length,
        subscriptions: subscriptions.length,
        invoices: invoices.length,
        payments: payments.length,
      };

      if (stageFailures.length > 0) {
        const errorMessage = formatStageFailures(stageFailures);
        await this.configService.writeFailedSnapshot(
          environment,
          account.id,
          account.merchantName,
          account.livemode,
          syncCounts,
          errorMessage,
          new Date()
        );

        logger.warn('Razorpay sync completed with failed stages', {
          environment,
          syncCounts,
          error: errorMessage,
        });

        const connection = await this.configService.getConnection(environment);
        return this.buildSyncResult(environment, 'failed', connection, syncCounts, errorMessage);
      }

      await this.configService.writeSnapshot(
        environment,
        account.id,
        account.merchantName,
        account.livemode,
        syncCounts,
        new Date()
      );

      logger.info('Razorpay sync completed', { environment, syncCounts });
      const connection = await this.configService.getConnection(environment);

      return this.buildSyncResult(environment, 'succeeded', connection, syncCounts, null);
    } catch (error) {
      const message = getErrorMessage(error);
      logger.error('Razorpay sync failed', { environment, error: message });
      const connection = await this.configService.recordConnectionStatus(
        environment,
        'error',
        message
      );
      return this.buildSyncResult(
        environment,
        'failed',
        connection,
        EMPTY_RAZORPAY_SYNC_COUNTS,
        message
      );
    }
  }

  private buildSyncResult(
    environment: RazorpayEnvironment,
    status: 'succeeded' | 'failed',
    connection: RazorpayConnection,
    syncCounts: RazorpaySyncCounts,
    error: string | null
  ): SyncRazorpayPaymentsEnvironmentResult {
    return {
      environment,
      status,
      connection,
      syncCounts,
      error,
    };
  }

  private async upsertItems(
    client: PoolClient,
    environment: RazorpayEnvironment,
    items: RazorpayItem[]
  ): Promise<void> {
    for (const item of items) {
      await this.upsertItem(client, environment, {
        id: item.id,
        name: item.name,
        description: item.description ?? null,
        active: item.active !== false,
        amount: item.amount ?? null,
        unitAmount: item.unit_amount ?? item.amount ?? null,
        currency: item.currency.toLowerCase(),
        type: item.type ?? null,
        raw: item,
        createdAt: item.created_at ?? null,
      });
    }
  }

  private async upsertPlans(
    client: PoolClient,
    environment: RazorpayEnvironment,
    plans: RazorpayPlan[]
  ): Promise<void> {
    for (const plan of plans) {
      await this.upsertItem(client, environment, {
        id: plan.item.id,
        name: plan.item.name,
        description: plan.item.description ?? null,
        active: plan.item.active !== false,
        amount: plan.item.amount ?? null,
        unitAmount: plan.item.unit_amount ?? plan.item.amount ?? null,
        currency: plan.item.currency.toLowerCase(),
        type: null,
        raw: plan.item,
        createdAt: null,
      });

      await client.query(
        `INSERT INTO payments.razorpay_plans (
           environment,
           plan_id,
           item_id,
           period,
           interval,
           amount,
           unit_amount,
           currency,
           active,
           notes,
           raw,
           provider_created_at,
           synced_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
         ON CONFLICT (environment, plan_id) DO UPDATE SET
           item_id = EXCLUDED.item_id,
           period = EXCLUDED.period,
           interval = EXCLUDED.interval,
           amount = EXCLUDED.amount,
           unit_amount = EXCLUDED.unit_amount,
           currency = EXCLUDED.currency,
           active = EXCLUDED.active,
           notes = EXCLUDED.notes,
           raw = EXCLUDED.raw,
           provider_created_at = EXCLUDED.provider_created_at,
           synced_at = NOW(),
           updated_at = NOW()`,
        [
          environment,
          plan.id,
          plan.item.id,
          plan.period,
          plan.interval,
          plan.item.amount ?? null,
          plan.item.unit_amount ?? plan.item.amount ?? null,
          plan.item.currency.toLowerCase(),
          plan.item.active !== false,
          normalizeRazorpayNotes(plan.notes),
          plan,
          plan.created_at ? new Date(plan.created_at * 1000) : null,
        ]
      );
    }
  }

  private async upsertItem(
    client: PoolClient,
    environment: RazorpayEnvironment,
    item: RazorpayCatalogItemInput
  ): Promise<void> {
    await client.query(
      `INSERT INTO payments.razorpay_items (
         environment,
         item_id,
         name,
         description,
         active,
         amount,
         unit_amount,
         currency,
         type,
         raw,
         provider_created_at,
         synced_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
       ON CONFLICT (environment, item_id) DO UPDATE SET
         name = EXCLUDED.name,
         description = EXCLUDED.description,
         active = EXCLUDED.active,
         amount = EXCLUDED.amount,
         unit_amount = EXCLUDED.unit_amount,
         currency = EXCLUDED.currency,
         type = COALESCE(EXCLUDED.type, payments.razorpay_items.type),
         raw = EXCLUDED.raw,
         provider_created_at = COALESCE(EXCLUDED.provider_created_at, payments.razorpay_items.provider_created_at),
         synced_at = NOW(),
         updated_at = NOW()`,
      [
        environment,
        item.id,
        item.name,
        item.description,
        item.active,
        item.amount,
        item.unitAmount,
        item.currency,
        item.type,
        item.raw,
        item.createdAt ? new Date(item.createdAt * 1000) : null,
      ]
    );
  }

  private async deleteMissingCatalogRows(
    client: PoolClient,
    environment: RazorpayEnvironment,
    items: RazorpayItem[],
    plans: RazorpayPlan[]
  ): Promise<void> {
    const itemIds = Array.from(
      new Set([...items.map((item) => item.id), ...plans.map((plan) => plan.item.id)])
    );
    const planIds = plans.map((plan) => plan.id);

    await client.query(
      `DELETE FROM payments.razorpay_plans
       WHERE environment = $1
         AND NOT (plan_id = ANY($2::TEXT[]))`,
      [environment, planIds]
    );
    await client.query(
      `DELETE FROM payments.razorpay_items
       WHERE environment = $1
         AND NOT (item_id = ANY($2::TEXT[]))`,
      [environment, itemIds]
    );
  }

  private async upsertCustomers(
    environment: RazorpayEnvironment,
    customers: RazorpayCustomer[]
  ): Promise<void> {
    const syncedAt = new Date();
    const client = await this.getPool().connect();

    try {
      await client.query('BEGIN');

      for (const customer of customers) {
        const createdAt = customer.created_at ? new Date(customer.created_at * 1000) : null;

        await client.query(
          `INSERT INTO payments.customers (
             environment,
             provider,
             provider_customer_id,
             email,
             name,
             phone,
             deleted,
             metadata,
             raw,
             provider_created_at,
             synced_at
           )
           VALUES ($1, 'razorpay', $2, $3, $4, $5, false, $6, $7, $8, $9)
           ON CONFLICT (provider, environment, provider_customer_id) DO UPDATE SET
             email = EXCLUDED.email,
             name = EXCLUDED.name,
             phone = EXCLUDED.phone,
             deleted = false,
             metadata = EXCLUDED.metadata,
             raw = EXCLUDED.raw,
             provider_created_at = EXCLUDED.provider_created_at,
             synced_at = EXCLUDED.synced_at,
             updated_at = NOW()`,
          [
            environment,
            customer.id,
            customer.email ?? null,
            customer.name ?? null,
            customer.contact ?? null,
            customer.notes ?? {},
            customer,
            createdAt,
            syncedAt,
          ]
        );
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  private async upsertSubscriptions(
    environment: RazorpayEnvironment,
    subscriptions: RazorpaySubscription[]
  ): Promise<void> {
    const syncStartedAt = new Date();
    const client = await this.getPool().connect();

    try {
      await client.query('BEGIN');

      for (const sub of subscriptions) {
        const notes = normalizeRazorpayNotes(sub.notes);
        const subject = await this.resolveSubscriptionSubject(
          client,
          environment,
          sub.customer_id,
          notes
        );

        await client.query(
          `INSERT INTO payments.razorpay_subscriptions (
             environment,
             subscription_id,
             plan_id,
             customer_id,
             subject_type,
             subject_id,
             status,
             current_start,
             current_end,
             ended_at,
             quantity,
             charge_at,
             start_at,
             end_at,
             total_count,
             auth_attempts,
             paid_count,
             remaining_count,
             short_url,
             has_scheduled_changes,
             change_scheduled_at,
             offer_id,
             notes,
             raw,
             provider_created_at,
             synced_at
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26)
           ON CONFLICT (environment, subscription_id) DO UPDATE SET
             plan_id = EXCLUDED.plan_id,
             customer_id = EXCLUDED.customer_id,
             subject_type = EXCLUDED.subject_type,
             subject_id = EXCLUDED.subject_id,
             status = EXCLUDED.status,
             current_start = EXCLUDED.current_start,
             current_end = EXCLUDED.current_end,
             ended_at = EXCLUDED.ended_at,
             quantity = EXCLUDED.quantity,
             charge_at = EXCLUDED.charge_at,
             start_at = EXCLUDED.start_at,
             end_at = EXCLUDED.end_at,
             total_count = EXCLUDED.total_count,
             auth_attempts = EXCLUDED.auth_attempts,
             paid_count = EXCLUDED.paid_count,
             remaining_count = EXCLUDED.remaining_count,
             short_url = EXCLUDED.short_url,
             has_scheduled_changes = EXCLUDED.has_scheduled_changes,
             change_scheduled_at = EXCLUDED.change_scheduled_at,
             offer_id = EXCLUDED.offer_id,
             notes = EXCLUDED.notes,
             raw = EXCLUDED.raw,
             provider_created_at = EXCLUDED.provider_created_at,
             synced_at = EXCLUDED.synced_at,
             updated_at = NOW()`,
          [
            environment,
            sub.id,
            sub.plan_id,
            sub.customer_id ?? null,
            subject?.type ?? null,
            subject?.id ?? null,
            sub.status,
            sub.current_start ? new Date(sub.current_start * 1000) : null,
            sub.current_end ? new Date(sub.current_end * 1000) : null,
            sub.ended_at ? new Date(sub.ended_at * 1000) : null,
            sub.quantity ?? null,
            sub.charge_at ? new Date(sub.charge_at * 1000) : null,
            sub.start_at ? new Date(sub.start_at * 1000) : null,
            sub.end_at ? new Date(sub.end_at * 1000) : null,
            sub.total_count ?? null,
            sub.auth_attempts ?? null,
            sub.paid_count ?? null,
            sub.remaining_count ?? null,
            sub.short_url ?? null,
            sub.has_scheduled_changes,
            sub.change_scheduled_at ? new Date(sub.change_scheduled_at * 1000) : null,
            sub.offer_id ?? null,
            notes,
            sub,
            sub.created_at ? new Date(sub.created_at * 1000) : null,
            syncStartedAt,
          ]
        );

        if (subject && sub.customer_id) {
          await this.upsertCustomerMapping(client, environment, subject, sub.customer_id);
        }
      }

      const syncedIds = subscriptions.map((s) => s.id);
      await client.query(
        `DELETE FROM payments.razorpay_subscriptions
         WHERE environment = $1
           AND NOT (subscription_id = ANY($2::TEXT[]))
           AND (synced_at IS NULL OR synced_at < $3)
           AND updated_at < $3`,
        [environment, syncedIds, syncStartedAt]
      );

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  private async resolveSubscriptionSubject(
    client: PoolClient,
    environment: RazorpayEnvironment,
    customerId: string | null,
    notes: Record<string, string>
  ): Promise<BillingSubject | null> {
    return (
      getBillingSubjectFromProviderAttributes(notes) ??
      (await this.resolveSubjectFromCustomerMapping(client, environment, customerId))
    );
  }

  private async resolveSubjectFromCustomerMapping(
    client: PoolClient,
    environment: RazorpayEnvironment,
    customerId: string | null
  ): Promise<BillingSubject | null> {
    if (!customerId) {
      return null;
    }

    const result = await client.query(
      `SELECT
         subject_type AS "subjectType",
         subject_id AS "subjectId"
       FROM payments.customer_mappings
       WHERE provider = 'razorpay'
         AND environment = $1
         AND provider_customer_id = $2`,
      [environment, customerId]
    );

    const row = result.rows[0] as { subjectType: string; subjectId: string } | undefined;
    if (!row) {
      return null;
    }

    return { type: row.subjectType, id: row.subjectId };
  }

  private async upsertCustomerMapping(
    client: PoolClient,
    environment: RazorpayEnvironment,
    subject: BillingSubject,
    customerId: string
  ): Promise<void> {
    await client.query(
      `INSERT INTO payments.customer_mappings (
         provider,
         environment,
         subject_type,
         subject_id,
         provider_customer_id
       )
       VALUES ('razorpay', $1, $2, $3, $4)
       ON CONFLICT (provider, environment, subject_type, subject_id) DO UPDATE SET
         provider_customer_id = EXCLUDED.provider_customer_id,
         updated_at = NOW()`,
      [environment, subject.type, subject.id, customerId]
    );
  }
}
