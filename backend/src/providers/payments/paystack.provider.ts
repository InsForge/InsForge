import crypto from 'crypto';
import type { PaystackEnvironment } from '@/types/payments.js';

export const PAYSTACK_API_BASE_URL = 'https://api.paystack.co';

/** Abort Paystack REST calls that receive no response within this window. */
export const PAYSTACK_REQUEST_TIMEOUT_MS = 30_000;

const PAYSTACK_SHA512_SIGNATURE_HEX = /^[0-9a-f]{128}$/i;

export class PaystackKeyValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PaystackKeyValidationError';
  }
}

/**
 * Error raised for non-2xx Paystack REST responses. Paystack reports failures
 * as an HTTP status plus a JSON body of `{ status: false, message }`.
 */
export class PaystackApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number
  ) {
    super(message);
    this.name = 'PaystackApiError';
  }
}

/**
 * Wrap a rejected `fetch` (no HTTP response at all) as a PaystackApiError:
 * timeout aborts surface as 504, other network failures (DNS, connection
 * refused, TLS) as 502. The underlying cause text is preserved.
 */
function toPaystackFetchError(error: unknown): PaystackApiError {
  if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
    return new PaystackApiError(
      `Paystack request timed out after ${PAYSTACK_REQUEST_TIMEOUT_MS}ms`,
      504
    );
  }

  // Undici reports network failures as `TypeError: fetch failed` with the
  // useful detail (e.g. "getaddrinfo ENOTFOUND api.paystack.co") on `cause`.
  const cause = error instanceof Error ? error.cause : undefined;
  const causeMessage =
    cause instanceof Error ? cause.message : typeof cause === 'string' ? cause : null;
  const baseMessage =
    error instanceof Error && error.message.trim() ? error.message : String(error);
  const message = causeMessage
    ? `Paystack request failed: ${baseMessage} (${causeMessage})`
    : `Paystack request failed: ${baseMessage}`;

  return new PaystackApiError(message, 502);
}

type PaystackKeyKind = 'secret' | 'public';

function getExpectedPaystackKeyPrefix(
  environment: PaystackEnvironment,
  kind: PaystackKeyKind
): string {
  const base = kind === 'public' ? 'pk' : 'sk';
  return environment === 'live' ? `${base}_live_` : `${base}_test_`;
}

export function validatePaystackKey(environment: PaystackEnvironment, key: string): void {
  // Paystack keys encode both the key kind (sk_ / pk_) and the environment
  // (test / live) in their prefix, so a prefix check catches mismatched keys.
  const kind: PaystackKeyKind = key.startsWith('pk_') ? 'public' : 'secret';
  const expectedPrefix = getExpectedPaystackKeyPrefix(environment, kind);
  if (!key.startsWith(expectedPrefix)) {
    throw new PaystackKeyValidationError(
      `Paystack ${kind} key must start with "${expectedPrefix}" for the ${environment} environment`
    );
  }
}

export function maskPaystackKey(key: string): string {
  if (key.length <= 8) {
    return '****';
  }
  const knownPrefix = ['sk_test_', 'sk_live_', 'pk_test_', 'pk_live_'].find((prefix) =>
    key.startsWith(prefix)
  );
  const prefix = knownPrefix ?? key.slice(0, 4);
  return `${prefix}****${key.slice(-4)}`;
}

export interface PaystackAccountInfo {
  id: string | null;
  accountEmail: string | null;
  livemode: boolean;
}

export interface PaystackTransactionInitInput {
  amount: number;
  currency: string;
  email: string;
  reference?: string | null;
  callbackUrl?: string | null;
  metadata?: Record<string, string>;
}

/** `data` returned by POST /transaction/initialize. */
export interface PaystackInitializeResult {
  authorization_url: string;
  access_code: string;
  reference: string;
}

/** Transaction resource returned by GET /transaction/verify/:reference. */
export interface PaystackTransactionResource {
  id: number;
  domain: string;
  status:
    | 'abandoned'
    | 'failed'
    | 'ongoing'
    | 'pending'
    | 'processing'
    | 'queued'
    | 'reversed'
    | 'success';
  reference: string;
  amount: number;
  currency: string;
  gateway_response: string | null;
  channel: string | null;
  message: string | null;
  ip_address: string | null;
  fees: number | null;
  paid_at: string | null;
  created_at: string;
  // Paystack echoes metadata back as an object, a JSON string, or "" when unset.
  metadata: Record<string, unknown> | string | null;
  customer: {
    id: number;
    customer_code: string;
    email: string | null;
    first_name: string | null;
    last_name: string | null;
  } | null;
  authorization: {
    authorization_code: string | null;
    card_type: string | null;
    last4: string | null;
    bank: string | null;
    channel: string | null;
    reusable: boolean | null;
  } | null;
}

/**
 * Refund entity delivered by refund.* webhooks. `transaction` arrives either
 * as the original transaction's reference/id or as an embedded object.
 */
export interface PaystackRefundResource {
  id: number | string;
  transaction: number | string | { id?: number | string | null; reference?: string | null } | null;
  amount: number;
  currency: string;
  status?: string | null;
  transaction_reference?: string | null;
  refunded_at?: string | null;
  created_at?: string | null;
}

/** Every successful Paystack response wraps its payload in this envelope. */
interface PaystackEnvelope<T> {
  status: boolean;
  message: string;
  data: T;
}

export interface PaystackProviderOptions {
  environment: PaystackEnvironment;
  secretKey: string;
}

export class PaystackProvider {
  public readonly environment: PaystackEnvironment;
  private readonly secretKey: string;

  constructor(options: PaystackProviderOptions) {
    this.environment = options.environment;
    this.secretKey = options.secretKey;
  }

  /**
   * Verify Paystack webhook signature.
   * Paystack signs webhooks using HMAC-SHA512 of the raw body keyed with the
   * account's secret key, so the undecoded request bytes must be hashed as-is.
   */
  verifyWebhookSignature(rawBody: Buffer | string, signature: string): boolean {
    if (!PAYSTACK_SHA512_SIGNATURE_HEX.test(signature)) {
      return false;
    }

    const expected = crypto.createHmac('sha512', this.secretKey).update(rawBody).digest('hex');
    const expectedBuf = Buffer.from(expected, 'hex');
    const signatureBuf = Buffer.from(signature, 'hex');
    if (expectedBuf.length !== signatureBuf.length) {
      return false;
    }
    return crypto.timingSafeEqual(expectedBuf, signatureBuf);
  }

  /**
   * Confirm secret key validity with a lightweight authenticated probe.
   * Paystack does not expose a stable account id through its REST API, so we
   * list a single transaction and derive livemode from the key's environment.
   */
  async retrieveAccount(): Promise<PaystackAccountInfo> {
    // A one-record transactions list is the cheapest authenticated call, so
    // invalid secret keys fail before saving.
    await this.request<PaystackTransactionResource[]>('/transaction?perPage=1');

    // Paystack secret keys encode the environment implicitly (sk_test_ / sk_live_)
    return {
      id: null, // Paystack has no stable account identifier on the REST API
      accountEmail: null,
      livemode: this.environment === 'live',
    };
  }

  async initializeTransaction(
    input: PaystackTransactionInitInput
  ): Promise<PaystackInitializeResult> {
    const body: Record<string, unknown> = {
      amount: input.amount,
      currency: input.currency,
      email: input.email,
    };

    if (input.reference) {
      body.reference = input.reference;
    }
    if (input.callbackUrl) {
      body.callback_url = input.callbackUrl;
    }
    if (input.metadata) {
      body.metadata = input.metadata;
    }

    return this.request<PaystackInitializeResult>('/transaction/initialize', {
      method: 'POST',
      body,
    });
  }

  async verifyTransaction(reference: string): Promise<PaystackTransactionResource> {
    return this.request<PaystackTransactionResource>(
      `/transaction/verify/${encodeURIComponent(reference)}`
    );
  }

  /**
   * Minimal fetch-based Paystack REST client (Paystack publishes no official
   * Node SDK). Successful responses arrive as `{ status: true, message, data }`;
   * failures as an HTTP error status with `{ status: false, message }`.
   */
  private async request<T>(
    path: string,
    options: { method?: 'GET' | 'POST'; body?: Record<string, unknown> } = {}
  ): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${PAYSTACK_API_BASE_URL}${path}`, {
        method: options.method ?? 'GET',
        headers: {
          Authorization: `Bearer ${this.secretKey}`,
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(PAYSTACK_REQUEST_TIMEOUT_MS),
        ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      });
    } catch (error) {
      // fetch rejects (rather than resolving with an error status) on network
      // failures — DNS, connection refused, TLS — and on timeout aborts. Wrap
      // both as PaystackApiError so they normalize to upstream failures instead
      // of leaking as generic 500s.
      throw toPaystackFetchError(error);
    }

    let payload: PaystackEnvelope<T> | null = null;
    try {
      payload = (await response.json()) as PaystackEnvelope<T>;
    } catch {
      // Non-JSON body (e.g. a gateway error page); fall through to the status check.
      payload = null;
    }

    if (!response.ok || !payload || payload.status !== true) {
      const message =
        payload && typeof payload.message === 'string' && payload.message.trim()
          ? payload.message
          : `Paystack request failed with status ${response.status}`;
      throw new PaystackApiError(message, response.status);
    }

    return payload.data;
  }
}
