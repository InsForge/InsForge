import Razorpay from 'razorpay';
import crypto from 'crypto';
import type { RazorpayEnvironment } from '@/types/payments.js';

export class RazorpayKeyValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RazorpayKeyValidationError';
  }
}

function getExpectedRazorpayKeyPrefix(environment: RazorpayEnvironment): string {
  return environment === 'live' ? 'rzp_live_' : 'rzp_test_';
}

export function validateRazorpayKey(environment: RazorpayEnvironment, keyId: string): void {
  const expectedPrefix = getExpectedRazorpayKeyPrefix(environment);
  if (!keyId.startsWith(expectedPrefix)) {
    throw new RazorpayKeyValidationError(
      `Razorpay key ID must start with "${expectedPrefix}" for the ${environment} environment`
    );
  }
}

export function maskRazorpayKey(key: string): string {
  if (key.length <= 8) {
    return '****';
  }
  const prefix = key.startsWith('rzp_test_')
    ? 'rzp_test_'
    : key.startsWith('rzp_live_')
      ? 'rzp_live_'
      : key.slice(0, 4);
  return `${prefix}****${key.slice(-4)}`;
}

export interface RazorpayAccountInfo {
  id: string;
  merchantName: string | null;
  livemode: boolean;
}

export interface RazorpayPlan {
  id: string;
  entity: string;
  interval: number;
  period: 'daily' | 'weekly' | 'monthly' | 'yearly';
  item: {
    id: string;
    name: string;
    description: string | null;
    amount: number;
    unit_amount: number;
    currency: string;
    active: boolean;
  };
  notes: Record<string, string>;
  created_at: number;
}

export interface RazorpayItem {
  id: string;
  active: boolean;
  amount: number;
  unit_amount: number;
  currency: string;
  name: string;
  description: string | null;
  type: 'invoice';
  created_at: number;
}

export interface RazorpayCustomer {
  id: string;
  entity: string;
  name: string | null;
  email: string | null;
  contact: string | null;
  gstin: string | null;
  notes: Record<string, string | number>;
  created_at: number;
}

export interface RazorpaySubscription {
  id: string;
  entity: string;
  plan_id: string;
  customer_id: string | null;
  status:
    | 'created'
    | 'authenticated'
    | 'active'
    | 'pending'
    | 'halted'
    | 'cancelled'
    | 'completed'
    | 'expired'
    | 'paused';
  current_start: number | null;
  current_end: number | null;
  ended_at: number | null;
  quantity: number;
  notes: Record<string, string | number>;
  charge_at: number | null;
  start_at: number | null;
  end_at: number | null;
  total_count: number | null;
  paid_count: number | null;
  remaining_count: number | null;
  short_url: string | null;
  has_scheduled_changes: boolean;
  change_scheduled_at: number | null;
  offer_id: string | null;
  created_at: number;
}

export interface RazorpayPayment {
  id: string;
  entity: string;
  amount: number;
  currency: string;
  status: 'created' | 'authorized' | 'captured' | 'refunded' | 'failed';
  order_id: string | null;
  invoice_id: string | null;
  international: boolean;
  method: string;
  amount_refunded: number;
  refund_status: string | null;
  captured: boolean;
  description: string | null;
  card_id: string | null;
  bank: string | null;
  wallet: string | null;
  vpa: string | null;
  email: string | null;
  contact: string | null;
  customer_id: string | null;
  notes: Record<string, string | number>;
  fee: number | null;
  tax: number | null;
  error_code: string | null;
  error_description: string | null;
  error_source: string | null;
  error_step: string | null;
  error_reason: string | null;
  created_at: number;
}

export interface RazorpayInvoice {
  id: string;
  entity: string;
  type: string;
  description: string | null;
  customer_id: string | null;
  customer_details: {
    id: string | null;
    name: string | null;
    email: string | null;
    contact: string | null;
  } | null;
  order_id: string | null;
  subscription_id: string | null;
  payment_id: string | null;
  status: 'draft' | 'issued' | 'partially_paid' | 'paid' | 'cancelled' | 'expired';
  amount: number;
  amount_paid: number;
  amount_due: number;
  currency: string;
  short_url: string | null;
  notes: Record<string, string | number>;
  line_items: Array<{
    id: string;
    item_id: string | null;
    name: string;
    description: string | null;
    amount: number;
    unit_amount: number;
    quantity: number;
    currency: string;
  }>;
  paid_at: number | null;
  cancelled_at: number | null;
  expired_at: number | null;
  issued_at: number | null;
  created_at: number;
}

export interface RazorpayWebhookPayload {
  entity: string;
  account_id: string;
  event: string;
  contains: string[];
  payload: Record<string, unknown>;
  created_at: number;
}

export class RazorpayProvider {
  private readonly client: Razorpay;

  constructor(
    private readonly keyId: string,
    private readonly keySecret: string,
    public readonly environment: RazorpayEnvironment
  ) {
    this.client = new Razorpay({ key_id: keyId, key_secret: keySecret });
  }

  /**
   * Verify Razorpay webhook signature.
   * Razorpay signs webhooks using HMAC-SHA256 of the raw body.
   */
  verifyWebhookSignature(rawBody: string, signature: string, webhookSecret: string): boolean {
    const expected = crypto.createHmac('sha256', webhookSecret).update(rawBody).digest('hex');
    const expectedBuf = Buffer.from(expected, 'hex');
    const signatureBuf = Buffer.from(signature, 'hex');
    if (expectedBuf.length !== signatureBuf.length) {
      return false;
    }
    return crypto.timingSafeEqual(expectedBuf, signatureBuf);
  }

  /**
   * Fetch basic account info using the /orders or /items call to confirm key validity.
   * Razorpay does not have a dedicated "retrieve account" endpoint in the OSS SDK,
   * so we use a lightweight Orders probe.
   */
  async retrieveAccount(): Promise<RazorpayAccountInfo> {
    // Razorpay does not expose account metadata through the OSS SDK. Use a
    // lightweight authenticated Orders call so invalid key secrets fail before saving.
    await this.client.orders.all({ count: 1, skip: 0 });

    // Razorpay key ID encodes the environment implicitly (rzp_test_ / rzp_live_)
    return {
      id: this.keyId,
      merchantName: null, // requires dashboard API not available in OSS SDK
      livemode: this.environment === 'live',
    };
  }

  async listPlans(): Promise<RazorpayPlan[]> {
    const all: RazorpayPlan[] = [];
    let skip = 0;
    const count = 100;
    while (true) {
      const response = (await this.client.plans.all({ count, skip })) as unknown as {
        items: RazorpayPlan[];
      };
      const items = response.items ?? [];
      all.push(...items);
      if (items.length < count) {
        break;
      }
      skip += count;
    }
    return all;
  }

  async listItems(): Promise<RazorpayItem[]> {
    const all: RazorpayItem[] = [];
    let skip = 0;
    const count = 100;
    while (true) {
      const response = (await this.client.items.all({ count, skip })) as unknown as {
        items: RazorpayItem[];
      };
      const items = response.items ?? [];
      all.push(...items);
      if (items.length < count) {
        break;
      }
      skip += count;
    }
    return all;
  }

  async listCustomers(): Promise<RazorpayCustomer[]> {
    const all: RazorpayCustomer[] = [];
    let skip = 0;
    const count = 100;
    while (true) {
      const response = (await this.client.customers.all({ count, skip })) as unknown as {
        items: RazorpayCustomer[];
      };
      const items = response.items ?? [];
      all.push(...items);
      if (items.length < count) {
        break;
      }
      skip += count;
    }
    return all;
  }

  async listSubscriptions(): Promise<RazorpaySubscription[]> {
    const all: RazorpaySubscription[] = [];
    let skip = 0;
    const count = 100;

    // Razorpay returns at most 100 records per call.
    while (true) {
      const response = (await this.client.subscriptions.all({ count, skip })) as unknown as {
        items: RazorpaySubscription[];
        count: number;
      };
      const items = response.items ?? [];
      all.push(...items);
      if (items.length < count) {
        break;
      }
      skip += count;
    }

    return all;
  }

  async listPayments(): Promise<RazorpayPayment[]> {
    const all: RazorpayPayment[] = [];
    let skip = 0;
    const count = 100;

    while (true) {
      const response = (await this.client.payments.all({ count, skip })) as unknown as {
        items: RazorpayPayment[];
        count: number;
      };
      const items = response.items ?? [];
      all.push(...items);
      if (items.length < count) {
        break;
      }
      skip += count;
    }

    return all;
  }

  async listInvoices(): Promise<RazorpayInvoice[]> {
    const all: RazorpayInvoice[] = [];
    let skip = 0;
    const count = 100;

    while (true) {
      const response = (await this.client.invoices.all({ count, skip })) as unknown as {
        items: RazorpayInvoice[];
        count: number;
      };
      const items = response.items ?? [];
      all.push(...items);
      if (items.length < count) {
        break;
      }
      skip += count;
    }

    return all;
  }

  async createCustomer(input: {
    name?: string | null;
    email?: string | null;
    contact?: string | null;
    notes?: Record<string, string>;
  }): Promise<RazorpayCustomer> {
    const params: Record<string, unknown> = {};
    if (input.name) {
      params.name = input.name;
    }
    if (input.email) {
      params.email = input.email;
    }
    if (input.contact) {
      params.contact = input.contact;
    }
    if (input.notes) {
      params.notes = input.notes;
    }
    return this.client.customers.create(params) as Promise<RazorpayCustomer>;
  }

  async syncCatalog(): Promise<{
    account: RazorpayAccountInfo;
    plans: RazorpayPlan[];
    items: RazorpayItem[];
  }> {
    const [account, plans, items] = await Promise.all([
      this.retrieveAccount(),
      this.listPlans(),
      this.listItems(),
    ]);
    return { account, plans, items };
  }
}
