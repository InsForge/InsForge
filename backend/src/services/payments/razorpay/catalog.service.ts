import type { Pool } from 'pg';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import {
  type RazorpayItem as RazorpayProviderItem,
  type RazorpayPlan as RazorpayProviderPlan,
} from '@/providers/payments/razorpay.provider.js';
import { RazorpayConfigService } from '@/services/payments/razorpay/config.service.js';
import { withPaymentSessionAdvisoryLock } from '@/services/payments/payments-advisory-lock.js';
import type { RazorpayEnvironment, RazorpayItemRow, RazorpayPlanRow } from '@/types/payments.js';
import { toISOString, toISOStringOrNull } from '@/utils/dates.js';
import type {
  CreateRazorpayItemRequest,
  CreateRazorpayPlanRequest,
  ListRazorpayCatalogResponse,
  MutateRazorpayItemResponse,
  MutateRazorpayPlanResponse,
  RazorpayItem,
  RazorpayPlan,
  UpdateRazorpayItemRequest,
} from '@insforge/shared-schemas';

export class RazorpayCatalogService {
  private static instance: RazorpayCatalogService;
  private pool: Pool | null = null;
  private readonly configService = RazorpayConfigService.getInstance();

  static getInstance(): RazorpayCatalogService {
    if (!RazorpayCatalogService.instance) {
      RazorpayCatalogService.instance = new RazorpayCatalogService();
    }

    return RazorpayCatalogService.instance;
  }

  private getPool(): Pool {
    if (!this.pool) {
      this.pool = DatabaseManager.getInstance().getPool();
    }

    return this.pool;
  }

  async listCatalog(environment: RazorpayEnvironment): Promise<ListRazorpayCatalogResponse> {
    const [itemsResult, plansResult] = await Promise.all([
      this.getPool().query(
        `SELECT
           environment,
           item_id AS "itemId",
           name,
           description,
           active,
           amount,
           unit_amount AS "unitAmount",
           currency,
           type,
           provider_created_at AS "providerCreatedAt",
           synced_at AS "syncedAt"
         FROM payments.razorpay_items
         WHERE environment = $1
         ORDER BY environment, name, item_id`,
        [environment]
      ),
      this.getPool().query(
        `SELECT
           environment,
           plan_id AS "planId",
           item_id AS "itemId",
           period,
           interval,
           amount,
           unit_amount AS "unitAmount",
           currency,
           active,
           notes,
           provider_created_at AS "providerCreatedAt",
           synced_at AS "syncedAt"
         FROM payments.razorpay_plans
         WHERE environment = $1
         ORDER BY environment, item_id, period, interval, plan_id`,
        [environment]
      ),
    ]);

    return {
      items: (itemsResult.rows as RazorpayItemRow[]).map((row) => this.normalizeItemRow(row)),
      plans: (plansResult.rows as RazorpayPlanRow[]).map((row) => this.normalizePlanRow(row)),
    };
  }

  async createItem(input: CreateRazorpayItemRequest): Promise<MutateRazorpayItemResponse> {
    return this.withEnvironmentLock(input.environment, async () => {
      const provider = await this.configService.createRazorpayProvider(input.environment);
      const item = await provider.createItem({
        name: input.name,
        amount: input.amount,
        currency: input.currency,
        description: input.description ?? null,
      });

      await this.upsertItemRecord(input.environment, item);

      return {
        item: this.normalizeProviderItem(item, input.environment),
      };
    });
  }

  async updateItem(
    itemId: string,
    input: UpdateRazorpayItemRequest
  ): Promise<MutateRazorpayItemResponse> {
    return this.withEnvironmentLock(input.environment, async () => {
      const provider = await this.configService.createRazorpayProvider(input.environment);
      const item = await provider.updateItem(itemId, {
        name: input.name,
        amount: input.amount,
        currency: input.currency,
        description: input.description,
        active: input.active,
      });

      await this.upsertItemRecord(input.environment, item);

      return {
        item: this.normalizeProviderItem(item, input.environment),
      };
    });
  }

  async createPlan(input: CreateRazorpayPlanRequest): Promise<MutateRazorpayPlanResponse> {
    return this.withEnvironmentLock(input.environment, async () => {
      const provider = await this.configService.createRazorpayProvider(input.environment);
      const plan = await provider.createPlan({
        period: input.period,
        interval: input.interval,
        item: input.item,
        notes: input.notes,
      });

      await this.upsertItemRecord(input.environment, plan.item);
      await this.upsertPlanRecord(input.environment, plan, input.notes ?? {});

      return {
        plan: this.normalizeProviderPlan(plan, input.environment, input.notes ?? {}),
      };
    });
  }

  private async withEnvironmentLock<T>(
    environment: RazorpayEnvironment,
    task: () => Promise<T>
  ): Promise<T> {
    return withPaymentSessionAdvisoryLock(
      this.getPool(),
      `payments_razorpay_environment_${environment}`,
      task
    );
  }

  private async upsertItemRecord(
    environment: RazorpayEnvironment,
    item: RazorpayProviderItem | RazorpayProviderPlan['item']
  ): Promise<void> {
    await this.getPool().query(
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
        item.description ?? null,
        item.active !== false,
        item.amount ?? null,
        item.unit_amount ?? item.amount ?? null,
        item.currency.toLowerCase(),
        'type' in item ? item.type : null,
        item,
        'created_at' in item && item.created_at ? new Date(item.created_at * 1000) : null,
      ]
    );
  }

  private async upsertPlanRecord(
    environment: RazorpayEnvironment,
    plan: RazorpayProviderPlan,
    notes: Record<string, string>
  ): Promise<void> {
    await this.getPool().query(
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
        notes,
        plan,
        plan.created_at ? new Date(plan.created_at * 1000) : null,
      ]
    );
  }

  private normalizeItemRow(row: RazorpayItemRow): RazorpayItem {
    return {
      ...row,
      amount: row.amount === null ? null : Number(row.amount),
      unitAmount: row.unitAmount === null ? null : Number(row.unitAmount),
      providerCreatedAt: toISOStringOrNull(row.providerCreatedAt),
      syncedAt: toISOString(row.syncedAt),
    };
  }

  private normalizePlanRow(row: RazorpayPlanRow): RazorpayPlan {
    return {
      ...row,
      interval: Number(row.interval),
      amount: row.amount === null ? null : Number(row.amount),
      unitAmount: row.unitAmount === null ? null : Number(row.unitAmount),
      providerCreatedAt: toISOStringOrNull(row.providerCreatedAt),
      syncedAt: toISOString(row.syncedAt),
    };
  }

  private normalizeProviderItem(
    item: RazorpayProviderItem,
    environment: RazorpayEnvironment
  ): RazorpayItem {
    return {
      environment,
      itemId: item.id,
      name: item.name,
      description: item.description ?? null,
      active: item.active !== false,
      amount: item.amount ?? null,
      unitAmount: item.unit_amount ?? item.amount ?? null,
      currency: item.currency.toLowerCase(),
      type: item.type ?? null,
      providerCreatedAt: item.created_at ? new Date(item.created_at * 1000).toISOString() : null,
      syncedAt: new Date().toISOString(),
    };
  }

  private normalizeProviderPlan(
    plan: RazorpayProviderPlan,
    environment: RazorpayEnvironment,
    notes: Record<string, string>
  ): RazorpayPlan {
    return {
      environment,
      planId: plan.id,
      itemId: plan.item.id,
      period: plan.period,
      interval: plan.interval,
      amount: plan.item.amount ?? null,
      unitAmount: plan.item.unit_amount ?? plan.item.amount ?? null,
      currency: plan.item.currency.toLowerCase(),
      active: plan.item.active !== false,
      notes,
      providerCreatedAt: plan.created_at ? new Date(plan.created_at * 1000).toISOString() : null,
      syncedAt: new Date().toISOString(),
    };
  }
}
