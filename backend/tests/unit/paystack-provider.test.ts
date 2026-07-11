import crypto from 'crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PaystackProvider,
  maskPaystackKey,
  validatePaystackKey,
} from '../../src/providers/payments/paystack.provider';

const TEST_PAYSTACK_SECRET_KEY = 'sk_test_fixture_secret';

function sign(payload: Buffer | string, secret: string = TEST_PAYSTACK_SECRET_KEY): string {
  return crypto.createHmac('sha512', secret).update(payload).digest('hex');
}

function jsonResponse(status: number, payload: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  } as Response;
}

describe('PaystackProvider', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('accepts keys whose prefix matches the environment', () => {
    expect(() => validatePaystackKey('test', 'sk_test_good')).not.toThrow();
    expect(() => validatePaystackKey('live', 'sk_live_good')).not.toThrow();
    expect(() => validatePaystackKey('test', 'pk_test_good')).not.toThrow();
    expect(() => validatePaystackKey('live', 'pk_live_good')).not.toThrow();
  });

  it('rejects keys with the wrong environment prefix', () => {
    expect(() => validatePaystackKey('test', 'sk_live_wrong')).toThrow(
      /must start with "sk_test_"/i
    );
    expect(() => validatePaystackKey('live', 'sk_test_wrong')).toThrow(
      /must start with "sk_live_"/i
    );
    expect(() => validatePaystackKey('test', 'pk_live_wrong')).toThrow(
      /must start with "pk_test_"/i
    );
    expect(() => validatePaystackKey('live', 'pk_test_wrong')).toThrow(
      /must start with "pk_live_"/i
    );
  });

  it('masks configured keys for logs and API responses', () => {
    expect(maskPaystackKey('sk_test_abcdefghijklmnopqrstuvwxyz')).toBe('sk_test_****wxyz');
    expect(maskPaystackKey('pk_live_abcdefghijklmnopqrstuvwxyz')).toBe('pk_live_****wxyz');
    // Unknown prefixes fall back to the first four characters.
    expect(maskPaystackKey('unknownkey12')).toBe('unkn****ey12');
    // Keys too short to mask meaningfully are fully masked.
    expect(maskPaystackKey('sk_test_')).toBe('****');
  });

  it('verifies webhook signatures as HMAC-SHA512 of the raw body keyed with the secret key', () => {
    const provider = new PaystackProvider({
      environment: 'test',
      secretKey: TEST_PAYSTACK_SECRET_KEY,
    });
    const rawBody = Buffer.from('{"event":"charge.success","data":{"id":12345}}');
    const signature = sign(rawBody);

    expect(signature).toMatch(/^[0-9a-f]{128}$/);
    expect(provider.verifyWebhookSignature(rawBody, signature)).toBe(true);
    // The string form of the same bytes verifies identically.
    expect(provider.verifyWebhookSignature(rawBody.toString('utf8'), signature)).toBe(true);
    // A tampered body no longer matches the signature.
    expect(
      provider.verifyWebhookSignature(
        Buffer.from('{"event":"charge.success","data":{"id":99999}}'),
        signature
      )
    ).toBe(false);
    // A signature computed with a different secret key fails.
    expect(provider.verifyWebhookSignature(rawBody, sign(rawBody, 'sk_test_other_secret'))).toBe(
      false
    );
  });

  it('rejects malformed webhook signatures before computing the HMAC', () => {
    const provider = new PaystackProvider({
      environment: 'test',
      secretKey: TEST_PAYSTACK_SECRET_KEY,
    });
    const rawBody = Buffer.from('{"event":"charge.success"}');
    const signature = sign(rawBody);
    const hmacSpy = vi.spyOn(crypto, 'createHmac');

    // Wrong length (SHA-256-sized, truncated, and over-long) fails fast.
    expect(provider.verifyWebhookSignature(rawBody, signature.slice(0, 64))).toBe(false);
    expect(provider.verifyWebhookSignature(rawBody, `${signature}ab`)).toBe(false);
    // Correct length but non-hex characters fails fast.
    expect(provider.verifyWebhookSignature(rawBody, 'g'.repeat(128))).toBe(false);
    expect(hmacSpy).not.toHaveBeenCalled();

    hmacSpy.mockRestore();
  });

  it('initializes transactions via POST /transaction/initialize with a Bearer header', async () => {
    const provider = new PaystackProvider({
      environment: 'test',
      secretKey: TEST_PAYSTACK_SECRET_KEY,
    });
    const data = {
      authorization_url: 'https://checkout.paystack.com/abc123',
      access_code: 'access_abc123',
      reference: 'ps_ref_123',
    };
    const mockFetch = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        status: true,
        message: 'Authorization URL created',
        data,
      })
    );
    vi.stubGlobal('fetch', mockFetch);

    const result = await provider.initializeTransaction({
      amount: 500000,
      currency: 'NGN',
      email: 'buyer@example.com',
      reference: 'ps_ref_123',
      callbackUrl: 'https://app.example.test/paystack/callback',
      metadata: { insforge_transaction_id: 'txn_local_123' },
    });

    // The `{ status: true, data }` envelope is unwrapped to the payload.
    expect(result).toEqual(data);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.paystack.co/transaction/initialize',
      expect.objectContaining({
        method: 'POST',
        headers: {
          Authorization: `Bearer ${TEST_PAYSTACK_SECRET_KEY}`,
          'Content-Type': 'application/json',
        },
        // Every request carries a timeout signal so a hung upstream cannot
        // stall the caller indefinitely.
        signal: expect.any(AbortSignal),
      })
    );
    const requestInit = mockFetch.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(requestInit.body))).toEqual({
      amount: 500000,
      currency: 'NGN',
      email: 'buyer@example.com',
      reference: 'ps_ref_123',
      callback_url: 'https://app.example.test/paystack/callback',
      metadata: { insforge_transaction_id: 'txn_local_123' },
    });
  });

  it('omits unset optional fields from the initialize request body', async () => {
    const provider = new PaystackProvider({
      environment: 'test',
      secretKey: TEST_PAYSTACK_SECRET_KEY,
    });
    const mockFetch = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        status: true,
        message: 'Authorization URL created',
        data: {
          authorization_url: 'https://checkout.paystack.com/abc123',
          access_code: 'access_abc123',
          reference: 'generated_ref',
        },
      })
    );
    vi.stubGlobal('fetch', mockFetch);

    await provider.initializeTransaction({
      amount: 500000,
      currency: 'NGN',
      email: 'buyer@example.com',
      reference: null,
      callbackUrl: null,
    });

    const requestInit = mockFetch.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(requestInit.body))).toEqual({
      amount: 500000,
      currency: 'NGN',
      email: 'buyer@example.com',
    });
  });

  it('verifies transactions via GET /transaction/verify/:reference with URL encoding', async () => {
    const provider = new PaystackProvider({
      environment: 'test',
      secretKey: TEST_PAYSTACK_SECRET_KEY,
    });
    const data = { id: 12345, reference: 'ref with/slash', status: 'success' };
    const mockFetch = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        status: true,
        message: 'Verification successful',
        data,
      })
    );
    vi.stubGlobal('fetch', mockFetch);

    const result = await provider.verifyTransaction('ref with/slash');

    expect(result).toEqual(data);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.paystack.co/transaction/verify/ref%20with%2Fslash',
      expect.objectContaining({
        method: 'GET',
        headers: {
          Authorization: `Bearer ${TEST_PAYSTACK_SECRET_KEY}`,
          'Content-Type': 'application/json',
        },
        signal: expect.any(AbortSignal),
      })
    );
    expect(mockFetch.mock.calls[0][1]).not.toHaveProperty('body');
  });

  it('throws PaystackApiError with the body message and HTTP status on API failures', async () => {
    const provider = new PaystackProvider({
      environment: 'test',
      secretKey: TEST_PAYSTACK_SECRET_KEY,
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(401, { status: false, message: 'Invalid key' }))
    );

    await expect(provider.verifyTransaction('ps_ref_123')).rejects.toMatchObject({
      name: 'PaystackApiError',
      message: 'Invalid key',
      statusCode: 401,
    });
  });

  it('falls back to a status-based message when the failure body is not JSON', async () => {
    const provider = new PaystackProvider({
      environment: 'test',
      secretKey: TEST_PAYSTACK_SECRET_KEY,
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        json: async () => {
          throw new Error('not json');
        },
      } as unknown as Response)
    );

    await expect(provider.verifyTransaction('ps_ref_123')).rejects.toMatchObject({
      name: 'PaystackApiError',
      message: 'Paystack request failed with status 502',
      statusCode: 502,
    });
  });

  it('treats a 2xx response with a false envelope status as an API failure', async () => {
    const provider = new PaystackProvider({
      environment: 'test',
      secretKey: TEST_PAYSTACK_SECRET_KEY,
    });
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(jsonResponse(200, { status: false, message: 'Transaction not found' }))
    );

    // The provider preserves the raw HTTP status; normalizePaystackError clamps
    // sub-400 statuses to 502 before they reach the error middleware.
    await expect(provider.verifyTransaction('ps_ref_123')).rejects.toMatchObject({
      name: 'PaystackApiError',
      message: 'Transaction not found',
      statusCode: 200,
    });
  });

  it('wraps network-level fetch failures as PaystackApiError 502 with the cause text', async () => {
    const provider = new PaystackProvider({
      environment: 'test',
      secretKey: TEST_PAYSTACK_SECRET_KEY,
    });
    const networkError = new TypeError('fetch failed');
    (networkError as { cause?: unknown }).cause = new Error(
      'getaddrinfo ENOTFOUND api.paystack.co'
    );
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(networkError));

    await expect(provider.verifyTransaction('ps_ref_123')).rejects.toMatchObject({
      name: 'PaystackApiError',
      statusCode: 502,
      message: 'Paystack request failed: fetch failed (getaddrinfo ENOTFOUND api.paystack.co)',
    });
  });

  it('wraps network failures without a cause using the error message', async () => {
    const provider = new PaystackProvider({
      environment: 'test',
      secretKey: TEST_PAYSTACK_SECRET_KEY,
    });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));

    await expect(provider.verifyTransaction('ps_ref_123')).rejects.toMatchObject({
      name: 'PaystackApiError',
      statusCode: 502,
      message: 'Paystack request failed: fetch failed',
    });
  });

  it('surfaces timeout aborts as PaystackApiError 504', async () => {
    const provider = new PaystackProvider({
      environment: 'test',
      secretKey: TEST_PAYSTACK_SECRET_KEY,
    });
    // AbortSignal.timeout rejects fetch with a DOMException named TimeoutError.
    const timeoutError = new Error('The operation was aborted due to timeout');
    timeoutError.name = 'TimeoutError';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(timeoutError));

    await expect(provider.verifyTransaction('ps_ref_123')).rejects.toMatchObject({
      name: 'PaystackApiError',
      statusCode: 504,
      message: 'Paystack request timed out after 30000ms',
    });
  });
});
