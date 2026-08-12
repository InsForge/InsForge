import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';

vi.mock('../../src/utils/logger.js', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import {
  destroyEmailCooldownInterval,
  perEmailCooldown,
  perPhoneCooldown,
} from '../../src/api/middlewares/rate-limiters.js';

function run(middleware: ReturnType<typeof perPhoneCooldown>, body: Record<string, unknown>) {
  const next = vi.fn();
  const call = () =>
    middleware({ body } as unknown as Request, {} as Response, next as NextFunction);
  return { call, next };
}

describe('OTP send cooldowns key only validated identifiers', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    // Clears the shared cooldown store between tests.
    destroyEmailCooldownInterval();
  });

  it('applies the phone cooldown to repeated valid requests', () => {
    const middleware = perPhoneCooldown(60000);
    const first = run(middleware, { phone: '+15551234567' });
    first.call();
    expect(first.next).toHaveBeenCalled();

    const second = run(middleware, { phone: '+15551234567' });
    expect(() => second.call()).toThrow(/wait/i);
  });

  it('treats whitespace-padded phones as the same cooldown key', () => {
    const middleware = perPhoneCooldown(60000);
    run(middleware, { phone: '+15551234567' }).call();

    const padded = run(middleware, { phone: '  +15551234567  ' });
    expect(() => padded.call()).toThrow(/wait/i);
  });

  it('a phone number in the email field cannot poison the phone cooldown', () => {
    // Attacker hits the email endpoint with a phone-shaped "email" — invalid,
    // so no cooldown key may be set.
    const emailMiddleware = perEmailCooldown(60000);
    const poison = run(emailMiddleware, { email: '+15551234567' });
    poison.call();
    expect(poison.next).toHaveBeenCalled();

    // The victim's legitimate phone request is unaffected.
    const phoneMiddleware = perPhoneCooldown(60000);
    const victim = run(phoneMiddleware, { phone: '+15551234567' });
    victim.call();
    expect(victim.next).toHaveBeenCalled();
  });

  it('an email in the phone field cannot poison the email cooldown', () => {
    const phoneMiddleware = perPhoneCooldown(60000);
    run(phoneMiddleware, { phone: 'user@example.com' }).call();

    const emailMiddleware = perEmailCooldown(60000);
    const victim = run(emailMiddleware, { email: 'user@example.com' });
    victim.call();
    expect(victim.next).toHaveBeenCalled();
  });
});
