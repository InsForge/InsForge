import type { Pool } from 'pg';
import { AppError } from '@/utils/errors.js';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import type {
  StripePriceRow,
  StripeProductRow,
  StripeEnvironment,
  StripeProduct,
} from '@/types/payments.js';
import {
  buildStripeIdempotencyKey,
  getStripeObjectId,
  normalizePriceRow,
  normalizeProductRow,
  normalizeStripeProduct,
} from '@/services/payments/helpers.js';
import { withPaymentSessionAdvisoryLock } from '@/services/payments/payments-advisory-lock.js';
import { StripeConfigService } from '@/services/payments/stripe/config.service.js';
import {
  ERROR_CODES,
  type CreateStripeProductRequest,
  type DeleteStripeProductResponse,
  type GetStripeProductResponse,
  type ListStripeProductsRequest,
  type ListStripeProductsResponse,
  type MutateStripeProductResponse,
  type UpdateStripeProductRequest,
} from '@insforge/shared-schemas';

export class StripeProductService {
  private static instance: StripeProductService;
  private pool: Pool | null = null;
  private readonly configService = StripeConfigService.getInstance();

  static getInstance(): StripeProductService {
    if (!StripeProductService.instance) {
      StripeProductService.instance = new StripeProductService();
    }

    return StripeProductService.instance;
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

  async listProducts(input: ListStripeProductsRequest): Promise<ListStripeProductsResponse> {
    const result = await this.getPool().query(
      `SELECT
         environment,
         product_id AS "productId",
         name,
         description,
         active,
         default_price_id AS "defaultPriceId",
         metadata,
         synced_at AS "syncedAt"
       FROM payments.stripe_products
       WHERE environment = $1
       ORDER BY environment, name, product_id`,
      [input.environment]
    );

    return {
      products: (result.rows as StripeProductRow[]).map((row) => normalizeProductRow(row)),
    };
  }

  async getProduct(
    environment: StripeEnvironment,
    productId: string
  ): Promise<GetStripeProductResponse> {
    const [productResult, pricesResult] = await Promise.all([
      this.getPool().query(
        `SELECT
           environment,
           product_id AS "productId",
           name,
           description,
           active,
           default_price_id AS "defaultPriceId",
           metadata,
           synced_at AS "syncedAt"
         FROM payments.stripe_products
         WHERE environment = $1
           AND product_id = $2`,
        [environment, productId]
      ),
      this.getPool().query(
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
           AND product_id = $2
         ORDER BY environment, product_id, price_id`,
        [environment, productId]
      ),
    ]);

    const productRow = productResult.rows[0] as StripeProductRow | undefined;

    if (!productRow) {
      throw new AppError(
        `Stripe ${environment} product not found: ${productId}`,
        404,
        ERROR_CODES.PAYMENT_PRODUCT_NOT_FOUND
      );
    }

    return {
      product: normalizeProductRow(productRow),
      prices: (pricesResult.rows as StripePriceRow[]).map((row) => normalizePriceRow(row)),
    };
  }

  private async upsertProductRecord(
    environment: StripeEnvironment,
    product: StripeProduct
  ): Promise<void> {
    const client = await this.getPool().connect();

    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO payments.stripe_products (
           environment,
           product_id,
           name,
           description,
           active,
           default_price_id,
           metadata,
           raw,
           synced_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
         ON CONFLICT (environment, product_id) DO UPDATE SET
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

  private async deleteProductRecord(
    environment: StripeEnvironment,
    productId: string
  ): Promise<void> {
    const client = await this.getPool().connect();

    try {
      await client.query('BEGIN');
      await client.query(
        `DELETE FROM payments.stripe_prices
         WHERE environment = $1
           AND product_id = $2`,
        [environment, productId]
      );
      await client.query(
        `DELETE FROM payments.stripe_products
         WHERE environment = $1
           AND product_id = $2`,
        [environment, productId]
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async createProduct(input: CreateStripeProductRequest): Promise<MutateStripeProductResponse> {
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

      await this.upsertProductRecord(environment, product);

      return {
        product: normalizeStripeProduct(product, environment),
      };
    });
  }

  async updateProduct(
    productId: string,
    input: UpdateStripeProductRequest
  ): Promise<MutateStripeProductResponse> {
    const { environment, ...productInput } = input;

    return this.withEnvironmentLock(environment, async () => {
      const provider = await this.configService.createStripeProvider(environment);
      const product = await provider.updateProduct(productId, productInput);

      await this.upsertProductRecord(environment, product);

      return {
        product: normalizeStripeProduct(product, environment),
      };
    });
  }

  async deleteProduct(
    environment: StripeEnvironment,
    productId: string
  ): Promise<DeleteStripeProductResponse> {
    return this.withEnvironmentLock(environment, async () => {
      const provider = await this.configService.createStripeProvider(environment);
      const deletedProduct = await provider.deleteProduct(productId);

      if (deletedProduct.deleted) {
        await this.deleteProductRecord(environment, deletedProduct.id);
      }

      return {
        productId: deletedProduct.id,
        deleted: deletedProduct.deleted,
      };
    });
  }
}
