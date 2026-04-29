import type { Pool } from 'pg';
import { AppError } from '@/api/middlewares/error.js';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import type { StripeEnvironment, StripePrice, StripePriceRow } from '@/types/payments.js';
import {
  buildStripeIdempotencyKey,
  getStripeObjectId,
  normalizePriceRow,
  normalizeStripeDecimal,
  normalizeStripePrice,
} from '@/services/payments/helpers.js';
import { PaymentConfigService } from '@/services/payments/payment-config.service.js';
import type {
  ArchivePaymentPriceResponse,
  CreatePaymentPriceRequest,
  GetPaymentPriceResponse,
  ListPaymentPricesRequest,
  ListPaymentPricesResponse,
  MutatePaymentPriceResponse,
  UpdatePaymentPriceRequest,
} from '@insforge/shared-schemas';

export class PaymentPriceService {
  private static instance: PaymentPriceService;
  private pool: Pool | null = null;
  private readonly configService = PaymentConfigService.getInstance();

  static getInstance(): PaymentPriceService {
    if (!PaymentPriceService.instance) {
      PaymentPriceService.instance = new PaymentPriceService();
    }

    return PaymentPriceService.instance;
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
    const client = await this.getPool().connect();
    const lockName = `payments_environment_${environment}`;

    try {
      await client.query('SELECT pg_advisory_lock(hashtext($1))', [lockName]);
      return await task();
    } finally {
      try {
        await client.query('SELECT pg_advisory_unlock(hashtext($1))', [lockName]);
      } finally {
        client.release();
      }
    }
  }

  async listPrices(filters: ListPaymentPricesRequest): Promise<ListPaymentPricesResponse> {
    const params: string[] = [filters.environment];
    const productFilter = filters.stripeProductId ? 'AND stripe_product_id = $2' : '';
    if (filters.stripeProductId) {
      params.push(filters.stripeProductId);
    }

    const result = await this.getPool().query(
      `SELECT
         environment,
         stripe_price_id AS "stripePriceId",
         stripe_product_id AS "stripeProductId",
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
       FROM payments.prices
       WHERE environment = $1
         ${productFilter}
       ORDER BY environment, stripe_product_id, stripe_price_id`,
      params
    );

    return {
      prices: (result.rows as StripePriceRow[]).map((row) => normalizePriceRow(row)),
    };
  }

  async getPrice(
    environment: StripeEnvironment,
    stripePriceId: string
  ): Promise<GetPaymentPriceResponse> {
    const result = await this.getPool().query(
      `SELECT
         environment,
         stripe_price_id AS "stripePriceId",
         stripe_product_id AS "stripeProductId",
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
       FROM payments.prices
       WHERE environment = $1
         AND stripe_price_id = $2`,
      [environment, stripePriceId]
    );
    const price = (result.rows as StripePriceRow[]).map((row) => normalizePriceRow(row))[0];

    if (!price) {
      throw new AppError(
        `Stripe ${environment} price not found: ${stripePriceId}`,
        404,
        ERROR_CODES.NOT_FOUND
      );
    }

    return { price };
  }

  private async upsertPriceMirror(
    environment: StripeEnvironment,
    price: StripePrice
  ): Promise<void> {
    const client = await this.getPool().connect();

    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO payments.prices (
           environment,
           stripe_price_id,
           stripe_product_id,
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
         ON CONFLICT (environment, stripe_price_id) DO UPDATE SET
           stripe_product_id = EXCLUDED.stripe_product_id,
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

  async createPrice(input: CreatePaymentPriceRequest): Promise<MutatePaymentPriceResponse> {
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

      await this.upsertPriceMirror(environment, price);

      return {
        price: normalizeStripePrice(price, environment),
      };
    });
  }

  async updatePrice(
    stripePriceId: string,
    input: UpdatePaymentPriceRequest
  ): Promise<MutatePaymentPriceResponse> {
    const { environment, ...priceInput } = input;

    return this.withEnvironmentLock(environment, async () => {
      const provider = await this.configService.createStripeProvider(environment);
      const price = await provider.updatePrice(stripePriceId, priceInput);

      await this.upsertPriceMirror(environment, price);

      return {
        price: normalizeStripePrice(price, environment),
      };
    });
  }

  async archivePrice(
    environment: StripeEnvironment,
    stripePriceId: string
  ): Promise<ArchivePaymentPriceResponse> {
    return this.withEnvironmentLock(environment, async () => {
      const provider = await this.configService.createStripeProvider(environment);
      const price = await provider.updatePrice(stripePriceId, { active: false });

      await this.upsertPriceMirror(environment, price);

      return {
        price: normalizeStripePrice(price, environment),
        archived: !price.active,
      };
    });
  }
}
