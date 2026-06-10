import type { Pool } from 'pg';
import { AppError } from '@/utils/errors.js';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import type { StripePriceRow, StripeEnvironment, StripePrice } from '@/types/payments.js';
import {
  buildStripeIdempotencyKey,
  getStripeObjectId,
  normalizePriceRow,
  normalizeStripeDecimal,
  normalizeStripePrice,
} from '@/services/payments/helpers.js';
import { withPaymentSessionAdvisoryLock } from '@/services/payments/payments-advisory-lock.js';
import { StripeConfigService } from '@/services/payments/stripe/config.service.js';
import {
  ERROR_CODES,
  type ArchiveStripePriceResponse,
  type CreateStripePriceRequest,
  type GetStripePriceResponse,
  type ListStripePricesRequest,
  type ListStripePricesResponse,
  type MutateStripePriceResponse,
  type UpdateStripePriceRequest,
} from '@insforge/shared-schemas';

export class StripePriceService {
  private static instance: StripePriceService;
  private pool: Pool | null = null;
  private readonly configService = StripeConfigService.getInstance();

  static getInstance(): StripePriceService {
    if (!StripePriceService.instance) {
      StripePriceService.instance = new StripePriceService();
    }

    return StripePriceService.instance;
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
    const lockName = `payments_environment_${environment}`;
    return withPaymentSessionAdvisoryLock(this.getPool(), lockName, task);
  }

  async listPrices(filters: ListStripePricesRequest): Promise<ListStripePricesResponse> {
    const params: string[] = [filters.environment];
    const productFilter = filters.productId ? 'AND product_id = $2' : '';
    if (filters.productId) {
      params.push(filters.productId);
    }

    const result = await this.getPool().query(
      `SELECT
         environment,
         price_id AS "priceId",
         product_id AS "productId",
         active,
         currency,
         unit_amount AS "unitAmount",
         unit_amount_decimal AS "unitAmountDecimal",
         type,
         lookup_key AS "lookupKey",
         billing_scheme AS "billingScheme",
         tax_behavior AS "taxBehavior",
         recurring_interval AS "recurringInterval",
         recurring_interval_count AS "recurringIntervalCount",
         metadata,
         synced_at AS "syncedAt"
       FROM payments.stripe_prices
       WHERE environment = $1
         ${productFilter}
       ORDER BY environment, product_id, price_id`,
      params
    );

    return {
      prices: (result.rows as StripePriceRow[]).map((row) => normalizePriceRow(row)),
    };
  }

  async getPrice(environment: StripeEnvironment, priceId: string): Promise<GetStripePriceResponse> {
    const result = await this.getPool().query(
      `SELECT
         environment,
         price_id AS "priceId",
         product_id AS "productId",
         active,
         currency,
         unit_amount AS "unitAmount",
         unit_amount_decimal AS "unitAmountDecimal",
         type,
         lookup_key AS "lookupKey",
         billing_scheme AS "billingScheme",
         tax_behavior AS "taxBehavior",
         recurring_interval AS "recurringInterval",
         recurring_interval_count AS "recurringIntervalCount",
         metadata,
         synced_at AS "syncedAt"
       FROM payments.stripe_prices
       WHERE environment = $1
         AND price_id = $2`,
      [environment, priceId]
    );
    const price = (result.rows as StripePriceRow[]).map((row) => normalizePriceRow(row))[0];

    if (!price) {
      throw new AppError(
        `Stripe ${environment} price not found: ${priceId}`,
        404,
        ERROR_CODES.PAYMENT_PRICE_NOT_FOUND
      );
    }

    return { price };
  }

  private async upsertPriceRecord(
    environment: StripeEnvironment,
    price: StripePrice
  ): Promise<void> {
    const client = await this.getPool().connect();

    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO payments.stripe_prices (
           environment,
           price_id,
           product_id,
           active,
           currency,
           unit_amount,
           unit_amount_decimal,
           type,
           lookup_key,
           billing_scheme,
           tax_behavior,
           recurring_interval,
           recurring_interval_count,
           metadata,
           raw,
           synced_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW())
         ON CONFLICT (environment, price_id) DO UPDATE SET
           product_id = EXCLUDED.product_id,
           active = EXCLUDED.active,
           currency = EXCLUDED.currency,
           unit_amount = EXCLUDED.unit_amount,
           unit_amount_decimal = EXCLUDED.unit_amount_decimal,
           type = EXCLUDED.type,
           lookup_key = EXCLUDED.lookup_key,
           billing_scheme = EXCLUDED.billing_scheme,
           tax_behavior = EXCLUDED.tax_behavior,
           recurring_interval = EXCLUDED.recurring_interval,
           recurring_interval_count = EXCLUDED.recurring_interval_count,
           metadata = EXCLUDED.metadata,
           raw = EXCLUDED.raw,
           synced_at = EXCLUDED.synced_at,
           updated_at = NOW()`,
        [
          environment,
          price.id,
          getStripeObjectId(price.product),
          price.active,
          price.currency,
          price.unit_amount ?? null,
          normalizeStripeDecimal(price.unit_amount_decimal),
          price.type,
          price.lookup_key ?? null,
          price.billing_scheme ?? null,
          price.tax_behavior ?? null,
          price.recurring?.interval ?? null,
          price.recurring?.interval_count ?? null,
          price.metadata ?? {},
          price,
        ]
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async createPrice(input: CreateStripePriceRequest): Promise<MutateStripePriceResponse> {
    const { environment, idempotencyKey, ...priceInput } = input;

    return this.withEnvironmentLock(environment, async () => {
      const provider = await this.configService.createStripeProvider(environment);
      const price = await provider.createPrice({
        ...priceInput,
        ...(idempotencyKey
          ? {
              idempotencyKey: buildStripeIdempotencyKey(environment, 'price', idempotencyKey),
            }
          : {}),
      });

      await this.upsertPriceRecord(environment, price);

      return {
        price: normalizeStripePrice(price, environment),
      };
    });
  }

  async updatePrice(
    priceId: string,
    input: UpdateStripePriceRequest
  ): Promise<MutateStripePriceResponse> {
    const { environment, ...priceInput } = input;

    return this.withEnvironmentLock(environment, async () => {
      const provider = await this.configService.createStripeProvider(environment);
      const price = await provider.updatePrice(priceId, priceInput);

      await this.upsertPriceRecord(environment, price);

      return {
        price: normalizeStripePrice(price, environment),
      };
    });
  }

  async archivePrice(
    environment: StripeEnvironment,
    priceId: string
  ): Promise<ArchiveStripePriceResponse> {
    return this.withEnvironmentLock(environment, async () => {
      const provider = await this.configService.createStripeProvider(environment);
      const price = await provider.updatePrice(priceId, { active: false });

      await this.upsertPriceRecord(environment, price);

      return {
        price: normalizeStripePrice(price, environment),
        archived: !price.active,
      };
    });
  }
}
