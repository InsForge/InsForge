import crypto from 'crypto';
import { describe, expect, it } from 'vitest';
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
});
