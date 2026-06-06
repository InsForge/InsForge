import type { Pool } from 'pg';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import type { RazorpayEnvironment, RazorpayItemRow, RazorpayPlanRow } from '@/types/payments.js';
import { toISOString, toISOStringOrNull } from '@/utils/dates.js';
import type {
  ListRazorpayCatalogResponse,
  RazorpayItem,
  RazorpayPlan,
} from '@insforge/shared-schemas';

export class RazorpayCatalogService {
  private static instance: RazorpayCatalogService;
  private pool: Pool | null = null;

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
           metadata,
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
           metadata,
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
}
