import Stripe from 'stripe';
import type {
  StripeAccount,
  StripeClient,
  StripeEnvironment,
  StripePrice,
  StripeProduct,
  StripeSyncSnapshot,
} from '@/types/payments.js';

const KEY_PREFIX_BY_ENVIRONMENT: Record<StripeEnvironment, string> = {
  test: 'sk_test_',
  live: 'sk_live_',
};

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
}
