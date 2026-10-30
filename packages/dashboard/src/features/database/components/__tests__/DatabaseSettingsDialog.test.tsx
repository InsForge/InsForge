import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseBackupConfigResponse } from '@insforge/shared-schemas';

const hookMocks = vi.hoisted(() => ({
  config: null as DatabaseBackupConfigResponse | null,
  isLoading: false,
  isUpdating: false,
  error: null as Error | null,
  updateConfig: vi.fn(),
}));

vi.mock('#features/database/hooks/useBackupConfig', () => ({
  useBackupConfig: () => ({
    config: hookMocks.config,
    isLoading: hookMocks.isLoading,
    isUpdating: hookMocks.isUpdating,
    error: hookMocks.error,
    updateConfig: hookMocks.updateConfig,
    refetch: vi.fn(),
  }),
}));

import { DatabaseSettingsDialog } from '#features/database/components/DatabaseSettingsDialog';

function cronInput() {
  return screen.getByRole('textbox', { name: 'Cron expression' });
}

describe('DatabaseSettingsDialog', () => {
  beforeEach(() => {
    hookMocks.config = null;
    hookMocks.isLoading = false;
    hookMocks.isUpdating = false;
    hookMocks.error = null;
    hookMocks.updateConfig.mockReset();
    hookMocks.updateConfig.mockResolvedValue({});
  });

  it('shows a loading state until the config arrives', () => {
    hookMocks.isLoading = true;

    render(<DatabaseSettingsDialog open={true} onOpenChange={vi.fn()} />);

    expect(screen.getByText('Loading configuration...')).toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  });

  it('grays out schedule controls while disabled, then enables, picks a preset, and saves', async () => {
    hookMocks.config = {
      enabled: false,
      cronSchedule: '0 0 * * *',
      retentionDays: 7,
      nextBackupAt: null,
    };
    const user = userEvent.setup();
    const onOpenChange = vi.fn();

    render(<DatabaseSettingsDialog open={true} onOpenChange={onOpenChange} />);

    const toggle = screen.getByRole('switch', { name: 'Scheduled Backups' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');

    // Frequency and retention only apply while scheduling is on.
    expect(cronInput()).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Weekly' })).toBeDisabled();
    expect(screen.getByRole('combobox')).toBeDisabled();

    await user.click(toggle);
    expect(cronInput()).toBeEnabled();
    expect(screen.getByRole('combobox')).toBeEnabled();

    // Quick-pick chip prefills the cron field and the echo updates.
    await user.click(screen.getByRole('button', { name: 'Weekly' }));
    expect(cronInput()).toHaveValue('0 0 * * 0');

    await user.click(screen.getByRole('button', { name: 'Save Changes' }));

    expect(hookMocks.updateConfig).toHaveBeenCalledWith({
      enabled: true,
      cronSchedule: '0 0 * * 0',
      retentionDays: 7,
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('shows an API-set schedule in the cron field with the next-run readout', async () => {
    hookMocks.config = {
      enabled: true,
      cronSchedule: '15 3 * * 2',
      retentionDays: null,
      nextBackupAt: '2026-08-04T03:15:00.000Z',
    };
    const user = userEvent.setup();

    render(<DatabaseSettingsDialog open={true} onOpenChange={vi.fn()} />);

    expect(cronInput()).toHaveValue('15 3 * * 2');
    // Schedules-style feedback: the saved config's next fire time, not a
    // humanized sentence. Date rendering is timezone-dependent, so match the
    // label only.
    expect(screen.getByText(/Next backup:/)).toBeInTheDocument();

    await user.clear(cronInput());
    await user.type(cronInput(), '45 4 * * *');
    await user.click(screen.getByRole('button', { name: 'Save Changes' }));

    expect(hookMocks.updateConfig).toHaveBeenCalledWith({
      enabled: true,
      cronSchedule: '45 4 * * *',
      retentionDays: null,
    });
  });

  it('flags an unparseable expression and blocks saving', async () => {
    hookMocks.config = {
      enabled: true,
      cronSchedule: '0 0 * * *',
      retentionDays: 7,
      nextBackupAt: null,
    };
    const user = userEvent.setup();

    render(<DatabaseSettingsDialog open={true} onOpenChange={vi.fn()} />);

    await user.clear(cronInput());
    await user.type(cronInput(), '0 0 * *');

    expect(screen.getByText('Invalid cron expression.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeDisabled();
    expect(hookMocks.updateConfig).not.toHaveBeenCalled();
  });

  it('lets the user disable backups even with an invalid cron left in the field', async () => {
    hookMocks.config = {
      enabled: true,
      cronSchedule: '0 0 * * *',
      retentionDays: 7,
      nextBackupAt: '2026-07-30T00:00:00.000Z',
    };
    const user = userEvent.setup();

    render(<DatabaseSettingsDialog open={true} onOpenChange={vi.fn()} />);

    await user.clear(cronInput());
    await user.type(cronInput(), 'garbage');
    expect(screen.getByText('Invalid cron expression.')).toBeInTheDocument();

    await user.click(screen.getByRole('switch', { name: 'Scheduled Backups' }));

    // Scheduling is off: the stale error hides and the save goes through with
    // the invalid cron omitted, so the stored schedule stays intact.
    expect(screen.queryByText('Invalid cron expression.')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save Changes' }));

    expect(hookMocks.updateConfig).toHaveBeenCalledWith({ enabled: false, retentionDays: 7 });
  });

  it('flags a sub-hour schedule with the once-per-hour rule and blocks saving', async () => {
    hookMocks.config = {
      enabled: true,
      cronSchedule: '0 0 * * *',
      retentionDays: 7,
      nextBackupAt: null,
    };
    const user = userEvent.setup();

    render(<DatabaseSettingsDialog open={true} onOpenChange={vi.fn()} />);

    await user.clear(cronInput());
    await user.type(cronInput(), '*/30 * * * *');

    expect(screen.getByText('Backups can run at most once per hour.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeDisabled();
    expect(hookMocks.updateConfig).not.toHaveBeenCalled();
  });
});
