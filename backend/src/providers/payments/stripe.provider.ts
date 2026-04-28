import Stripe from 'stripe';
import type {
  StripeAccount,
  StripeClient,
  StripeEnvironment,
  StripePrice,
  StripePriceCreateInput,
  StripePriceUpdateInput,
  StripeProduct,
  StripeProductCreateInput,
  StripeProductDeleteResult,
  StripeProductUpdateInput,
  StripeSyncSnapshot,
} from '@/types/payments.js';

const KEY_PREFIX_BY_ENVIRONMENT: Record<StripeEnvironment, string> = {
  test: 'sk_test_',
  live: 'sk_live_',
};

type StripeProductCreateParams = Parameters<StripeClient['products']['create']>[0];
type StripeProductUpdateParams = NonNullable<Parameters<StripeClient['products']['update']>[1]>;
type StripePriceCreateParams = Parameters<StripeClient['prices']['create']>[0];
type StripePriceUpdateParams = NonNullable<Parameters<StripeClient['prices']['update']>[1]>;

export class StripeKeyValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StripeKeyValidationError';
  }
}

export function validateStripeSecretKey(environment: StripeEnvironment, value: string): void {
  const secretKeyName = `STRIPE_${environment.toUpperCase()}_SECRET_KEY`;
  const expectedPrefix = KEY_PREFIX_BY_ENVIRONMENT[environment];
  if (!value.startsWith(expectedPrefix)) {
    throw new StripeKeyValidationError(`${secretKeyName} must start with ${expectedPrefix}`);
  }
}

export function maskStripeKey(apiKey: string): string {
  if (apiKey.length <= 8) {
    return '****';
  }

  const prefix = apiKey.startsWith('sk_test_')
    ? 'sk_test_'
    : apiKey.startsWith('sk_live_')
      ? 'sk_live_'
      : apiKey.slice(0, 4);

  return `${prefix}****${apiKey.slice(-4)}`;
}

export class StripeProvider {
  private client: StripeClient;

  constructor(
    secretKey: string,
    public readonly environment: StripeEnvironment,
    client?: StripeClient
  ) {
    this.client =
      client ??
      new Stripe(secretKey, {
        typescript: true,
      });
  }

  async retrieveAccount(): Promise<StripeAccount> {
    return this.client.accounts.retrieveCurrent();
  }

  async syncCatalog(): Promise<StripeSyncSnapshot> {
    const [account, products, prices] = await Promise.all([
      this.retrieveAccount(),
      this.listProducts(),
      this.listPrices(),
    ]);

    return { account, products, prices };
  }

  async listProducts(): Promise<StripeProduct[]> {
    const products: StripeProduct[] = [];

    for await (const product of this.client.products.list({ limit: 100 })) {
      products.push(product);
    }

    return products;
  }

  async createProduct(input: StripeProductCreateInput): Promise<StripeProduct> {
    const params: StripeProductCreateParams = {
      name: input.name,
    };

    if (input.description !== undefined && input.description !== null) {
      params.description = input.description;
    }

    if (input.active !== undefined) {
      params.active = input.active;
    }

    if (input.metadata !== undefined) {
      params.metadata = input.metadata;
    }

    return this.client.products.create(params);
  }

  async updateProduct(productId: string, input: StripeProductUpdateInput): Promise<StripeProduct> {
    const params: StripeProductUpdateParams = {};

    if (input.name !== undefined) {
      params.name = input.name;
    }

    if (input.description !== undefined) {
      params.description = input.description ?? '';
    }

    if (input.active !== undefined) {
      params.active = input.active;
    }

    if (input.metadata !== undefined) {
      params.metadata = input.metadata;
    }

    return this.client.products.update(productId, params);
  }

  async deleteProduct(productId: string): Promise<StripeProductDeleteResult> {
    return this.client.products.del(productId);
  }

  async listPrices(): Promise<StripePrice[]> {
    const pricesById = new Map<string, StripePrice>();

    for await (const price of this.client.prices.list({ limit: 100, active: true })) {
      pricesById.set(price.id, price);
    }

    for await (const price of this.client.prices.list({ limit: 100, active: false })) {
      pricesById.set(price.id, price);
    }

    return [...pricesById.values()];
  }

  async createPrice(input: StripePriceCreateInput): Promise<StripePrice> {
    const params: StripePriceCreateParams = {
      product: input.stripeProductId,
      currency: input.currency,
      unit_amount: input.unitAmount,
    };

    if (input.lookupKey !== undefined && input.lookupKey !== null) {
      params.lookup_key = input.lookupKey;
    }

    if (input.active !== undefined) {
      params.active = input.active;
    }

    if (input.recurring) {
      params.recurring = {
        interval: input.recurring.interval,
      };

      if (input.recurring.intervalCount !== undefined) {
        params.recurring.interval_count = input.recurring.intervalCount;
      }
    }

    if (input.taxBehavior !== undefined) {
      params.tax_behavior = input.taxBehavior;
    }

    if (input.metadata !== undefined) {
      params.metadata = input.metadata;
    }

    return this.client.prices.create(params);
  }

  async updatePrice(priceId: string, input: StripePriceUpdateInput): Promise<StripePrice> {
    const params: StripePriceUpdateParams = {};

    if (input.active !== undefined) {
      params.active = input.active;
    }

    if (input.lookupKey !== undefined) {
      params.lookup_key = input.lookupKey ?? '';
    }

    if (input.taxBehavior !== undefined) {
      params.tax_behavior = input.taxBehavior;
    }

    if (input.metadata !== undefined) {
      params.metadata = input.metadata;
    }

    return this.client.prices.update(priceId, params);
  }
}
