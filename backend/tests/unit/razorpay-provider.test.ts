import crypto from 'crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  RazorpayProvider,
  maskRazorpayKey,
  validateRazorpayKey,
} from '../../src/providers/payments/razorpay.provider';

const TEST_RAZORPAY_KEY_ID = 'rzp_test_fixture';
const TEST_RAZORPAY_KEY_SECRET = 'test_secret';

function sign(payload: string, secret: string = TEST_RAZORPAY_KEY_SECRET): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

describe('RazorpayProvider', () => {
  it('rejects keys with the wrong environment prefix', () => {
    expect(() => validateRazorpayKey('test', 'rzp_live_wrong')).toThrow(
      /must start with "rzp_test_"/i
    );
  });

  it('masks configured keys for logs and API responses', () => {
    expect(maskRazorpayKey('rzp_test_abcdefghijklmnopqrstuvwxyz')).toBe('rzp_test_****wxyz');
  });

  it('strictly validates webhook signatures as 64-character hex digests', () => {
    const provider = new RazorpayProvider(TEST_RAZORPAY_KEY_ID, TEST_RAZORPAY_KEY_SECRET, 'test');
    const rawBody = Buffer.from('{"event":"payment.captured"}');
    const signature = sign(rawBody.toString('utf8'), 'webhook_secret');

    expect(provider.verifyWebhookSignature(rawBody, signature, 'webhook_secret')).toBe(true);
    expect(provider.verifyWebhookSignature(rawBody, `${signature}zz`, 'webhook_secret')).toBe(
      false
    );
    expect(provider.verifyWebhookSignature(rawBody, `${signature}g`, 'webhook_secret')).toBe(false);
  });

  it('strictly validates order and subscription checkout signatures as hex digests', () => {
    const provider = new RazorpayProvider(TEST_RAZORPAY_KEY_ID, TEST_RAZORPAY_KEY_SECRET, 'test');
    const orderSignature = sign('order_123|pay_123');
    const subscriptionSignature = sign('pay_123|sub_123');

    expect(provider.verifyOrderPaymentSignature('order_123', 'pay_123', orderSignature)).toBe(true);
    expect(
      provider.verifyOrderPaymentSignature('order_123', 'pay_123', `${orderSignature}zz`)
    ).toBe(false);

    expect(
      provider.verifySubscriptionPaymentSignature('sub_123', 'pay_123', subscriptionSignature)
    ).toBe(true);
    expect(
      provider.verifySubscriptionPaymentSignature(
        'sub_123',
        'pay_123',
        `${subscriptionSignature}zz`
      )
    ).toBe(false);
  });

  // Stub the SDK client's list endpoint so the real fetchAllPaginated loop runs.
  function stubPlansAll(provider: RazorpayProvider, all: ReturnType<typeof vi.fn>) {
    (provider as unknown as { client: { plans: { all: typeof all } } }).client.plans.all = all;
  }

  it('walks every page until a short page and concatenates the results', async () => {
    const provider = new RazorpayProvider(TEST_RAZORPAY_KEY_ID, TEST_RAZORPAY_KEY_SECRET, 'test');
    const firstPage = Array.from({ length: 100 }, (_, i) => ({ id: `plan_${i}` }));
    const secondPage = [{ id: 'plan_100' }, { id: 'plan_101' }];
    const all = vi
      .fn()
      .mockResolvedValueOnce({ items: firstPage })
      .mockResolvedValueOnce({ items: secondPage });
    stubPlansAll(provider, all);

    const result = await provider.listPlans();

    expect(result).toHaveLength(102);
    expect(result[0]).toEqual({ id: 'plan_0' });
    expect(result[101]).toEqual({ id: 'plan_101' });
    // A full page triggers another request; the short page stops the loop.
    expect(all).toHaveBeenCalledTimes(2);
    expect(all).toHaveBeenNthCalledWith(1, { count: 100, skip: 0 });
    expect(all).toHaveBeenNthCalledWith(2, { count: 100, skip: 100 });
  });

  it('stops after a single short page and tolerates a missing items field', async () => {
    const provider = new RazorpayProvider(TEST_RAZORPAY_KEY_ID, TEST_RAZORPAY_KEY_SECRET, 'test');
    const all = vi.fn().mockResolvedValueOnce({ items: [{ id: 'plan_0' }] });
    stubPlansAll(provider, all);

    expect(await provider.listPlans()).toEqual([{ id: 'plan_0' }]);
    expect(all).toHaveBeenCalledTimes(1);

    const empty = vi.fn().mockResolvedValueOnce({});
    stubPlansAll(provider, empty);
    expect(await provider.listPlans()).toEqual([]);
    expect(empty).toHaveBeenCalledTimes(1);
  });
});
