import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SmsConfigSchema } from '@insforge/shared-schemas';
import '#lib/i18n';
import { SmsSettingsCard } from '#features/auth/components/SmsSettingsCard';

const ENABLED_CONFIG: SmsConfigSchema = {
  id: '11111111-1111-4111-8111-111111111111',
  enabled: true,
  provider: 'twilio',
  accountSid: `AC${'a'.repeat(32)}`,
  hasAuthToken: true,
  fromNumber: '+15550001111',
  messagingServiceSid: '',
  minIntervalSeconds: 60,
  otpMessageTemplate: 'Your verification code is {{ code }}. It expires in 5 minutes.',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('SmsSettingsCard', () => {
  const onSave = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('cancel reverts every edited field, including a typed auth token', async () => {
    const user = userEvent.setup();
    render(
      <SmsSettingsCard
        config={ENABLED_CONFIG}
        isLoading={false}
        isUpdating={false}
        onSave={onSave}
      />
    );

    const tokenInput = screen.getByLabelText('Auth token');
    await user.type(tokenInput, 'typed-secret');
    const sidInput = screen.getByLabelText('Account SID');
    await user.clear(sidInput);
    await user.type(sidInput, 'ACedited');

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => {
      expect(screen.getByLabelText('Auth token')).toHaveValue('');
    });
    expect(screen.getByLabelText('Account SID')).toHaveValue(ENABLED_CONFIG.accountSid);
    // Form is clean again, so the footer is gone.
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('always submits the twilio provider even when the stored config is console', async () => {
    const user = userEvent.setup();
    render(
      <SmsSettingsCard
        config={{ ...ENABLED_CONFIG, provider: 'console', hasAuthToken: false }}
        isLoading={false}
        isUpdating={false}
        onSave={onSave}
      />
    );

    const tokenInput = screen.getByLabelText('Auth token');
    await user.type(tokenInput, 'real-token');
    await user.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'twilio', authToken: 'real-token' })
    );
  });

  it('omits an untouched auth token from the payload so the stored one is kept', async () => {
    const user = userEvent.setup();
    render(
      <SmsSettingsCard
        config={ENABLED_CONFIG}
        isLoading={false}
        isUpdating={false}
        onSave={onSave}
      />
    );

    const intervalInput = screen.getByLabelText('Minimum interval');
    await user.clear(intervalInput);
    await user.type(intervalInput, '30');
    await user.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ authToken: undefined, minIntervalSeconds: 30 })
    );
  });

  it('rejects a malformed account SID with a field error instead of saving', async () => {
    const user = userEvent.setup();
    render(
      <SmsSettingsCard
        config={ENABLED_CONFIG}
        isLoading={false}
        isUpdating={false}
        onSave={onSave}
      />
    );

    const sidInput = screen.getByLabelText('Account SID');
    await user.clear(sidInput);
    await user.type(sidInput, 'ACnothex');
    await user.click(screen.getByRole('button', { name: 'Save Changes' }));

    expect(
      await screen.findByText('Account SID must be "AC" followed by 32 hex characters')
    ).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });
});
