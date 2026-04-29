import type { Pool } from 'pg';
import { AppError } from '@/api/middlewares/error.js';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import type {
  StripeEnvironment,
  StripePriceRow,
  StripeProduct,
  StripeProductRow,
} from '@/types/payments.js';
import {
  buildStripeIdempotencyKey,
  getStripeObjectId,
  normalizePriceRow,
  normalizeProductRow,
  normalizeStripeProduct,
} from '@/services/payments/helpers.js';
import { PaymentConfigService } from '@/services/payments/payment-config.service.js';
import type {
  CreatePaymentProductRequest,
  DeletePaymentProductResponse,
  GetPaymentProductResponse,
  ListPaymentProductsRequest,
  ListPaymentProductsResponse,
  MutatePaymentProductResponse,
  UpdatePaymentProductRequest,
} from '@insforge/shared-schemas';

export class PaymentProductService {
  private static instance: PaymentProductService;
  private pool: Pool | null = null;
  private readonly configService = PaymentConfigService.getInstance();

  static getInstance(): PaymentProductService {
    if (!PaymentProductService.instance) {
      PaymentProductService.instance = new PaymentProductService();
    }

    return PaymentProductService.instance;
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

  async listProducts(input: ListPaymentProductsRequest): Promise<ListPaymentProductsResponse> {
    const result = await this.getPool().query(
      `SELECT
         environment,
         stripe_product_id AS "stripeProductId",
         name,
         description,
         active,
         default_price_id AS "defaultPriceId",
         metadata,
         synced_at AS "syncedAt"
       FROM payments.products
       WHERE environment = $1
       ORDER BY environment, name, stripe_product_id`,
      [input.environment]
    );

    return {
      products: (result.rows as StripeProductRow[]).map((row) => normalizeProductRow(row)),
    };
  }

  async getProduct(
    environment: StripeEnvironment,
    stripeProductId: string
  ): Promise<GetPaymentProductResponse> {
    const [productResult, pricesResult] = await Promise.all([
      this.getPool().query(
        `SELECT
           environment,
           stripe_product_id AS "stripeProductId",
           name,
           description,
           active,
           default_price_id AS "defaultPriceId",
           metadata,
           synced_at AS "syncedAt"
         FROM payments.products
         WHERE environment = $1
           AND stripe_product_id = $2`,
        [environment, stripeProductId]
      ),
      this.getPool().query(
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
           AND stripe_product_id = $2
         ORDER BY environment, stripe_product_id, stripe_price_id`,
        [environment, stripeProductId]
      ),
    ]);

    const productRow = productResult.rows[0] as StripeProductRow | undefined;

    if (!productRow) {
      throw new AppError(
        `Stripe ${environment} product not found: ${stripeProductId}`,
        404,
        ERROR_CODES.NOT_FOUND
      );
    }

    return {
      product: normalizeProductRow(productRow),
      prices: (pricesResult.rows as StripePriceRow[]).map((row) => normalizePriceRow(row)),
    };
  }

  private async upsertProductMirror(
    environment: StripeEnvironment,
    product: StripeProduct
  ): Promise<void> {
    const client = await this.getPool().connect();

    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO payments.products (
           environment,
           stripe_product_id,
           name,
           description,
           active,
           default_price_id,
           metadata,
           raw,
           synced_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
         ON CONFLICT (environment, stripe_product_id) DO UPDATE SET
           name = EXCLUDED.name,
           description = EXCLUDED.description,
           active = EXCLUDED.active,
           default_price_id = EXCLUDED.default_price_id,
           metadata = EXCLUDED.metadata,
           raw = EXCLUDED.raw,
           synced_at = EXCLUDED.synced_at,
           updated_at = NOW()`,
        [
          environment,
          product.id,
          product.name,
          product.description ?? null,
          product.active,
          getStripeObjectId(product.default_price),
          product.metadata ?? {},
          product,
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

  private async deleteProductMirror(
    environment: StripeEnvironment,
    stripeProductId: string
  ): Promise<void> {
    const client = await this.getPool().connect();

    try {
      await client.query('BEGIN');
      await client.query(
        `DELETE FROM payments.prices
         WHERE environment = $1
           AND stripe_product_id = $2`,
        [environment, stripeProductId]
      );
      await client.query(
        `DELETE FROM payments.products
         WHERE environment = $1
           AND stripe_product_id = $2`,
        [environment, stripeProductId]
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async createProduct(input: CreatePaymentProductRequest): Promise<MutatePaymentProductResponse> {
    const { environment, idempotencyKey, ...productInput } = input;

    return this.withEnvironmentLock(environment, async () => {
      const provider = await this.configService.createStripeProvider(environment);
      const product = await provider.createProduct({
        ...productInput,
        ...(idempotencyKey
          ? {
              idempotencyKey: buildStripeIdempotencyKey(environment, 'product', idempotencyKey),
            }
          : {}),
      });

      await this.upsertProductMirror(environment, product);

      return {
        product: normalizeStripeProduct(product, environment),
      };
    });
  }

  async updateProduct(
    stripeProductId: string,
    input: UpdatePaymentProductRequest
  ): Promise<MutatePaymentProductResponse> {
    const { environment, ...productInput } = input;

    return this.withEnvironmentLock(environment, async () => {
      const provider = await this.configService.createStripeProvider(environment);
      const product = await provider.updateProduct(stripeProductId, productInput);

      await this.upsertProductMirror(environment, product);

      return {
        product: normalizeStripeProduct(product, environment),
      };
    });
  }

  async deleteProduct(
    environment: StripeEnvironment,
    stripeProductId: string
  ): Promise<DeletePaymentProductResponse> {
    return this.withEnvironmentLock(environment, async () => {
      const provider = await this.configService.createStripeProvider(environment);
      const deletedProduct = await provider.deleteProduct(stripeProductId);

      if (deletedProduct.deleted) {
        await this.deleteProductMirror(environment, deletedProduct.id);
      }

      return {
        stripeProductId: deletedProduct.id,
        deleted: deletedProduct.deleted,
      };
    });
  }
}
