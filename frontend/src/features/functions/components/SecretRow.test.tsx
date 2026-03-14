import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { SecretRow } from './SecretRow';
import type { SecretSchema } from '@insforge/shared-schemas';
import { secretService } from '../services/secret.service';

const showToast = vi.fn();

vi.mock('@/lib/hooks/useToast', () => ({
  useToast: () => ({ showToast }),
}));

vi.mock('../services/secret.service', () => ({
  secretService: {
    getSecretValue: vi.fn(),
  },
}));

function renderSecretRow(secret: SecretSchema) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <SecretRow secret={secret} onDelete={vi.fn()} />
    </QueryClientProvider>
  );
}

describe('SecretRow', () => {
  const secret: SecretSchema = {
    id: 'secret-1',
    key: 'CLIENT_KEY',
    isActive: true,
    isReserved: false,
    lastUsedAt: null,
    expiresAt: null,
    createdAt: '2026-03-14T00:00:00.000Z',
    updatedAt: '2026-03-14T00:00:00.000Z',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('masks the value until reveal is requested', () => {
    renderSecretRow(secret);

    expect(screen.getByText('************')).toBeInTheDocument();
    expect(screen.queryByLabelText('Copy secret value')).not.toBeInTheDocument();
  });

  it('reveals and caches the fetched secret value', async () => {
    vi.mocked(secretService.getSecretValue).mockResolvedValue({
      key: secret.key,
      value: 'super-secret-value',
    });

    renderSecretRow(secret);

    fireEvent.click(screen.getByLabelText(`Reveal value for ${secret.key}`));

    expect(secretService.getSecretValue).toHaveBeenCalledTimes(1);
    expect(secretService.getSecretValue).toHaveBeenCalledWith(secret.key);

    await waitFor(() => {
      expect(screen.getByText('super-secret-value')).toBeInTheDocument();
    });

    expect(screen.getByLabelText('Copy secret value')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText(`Hide value for ${secret.key}`));
    expect(screen.getByText('************')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText(`Reveal value for ${secret.key}`));

    await waitFor(() => {
      expect(screen.getByText('super-secret-value')).toBeInTheDocument();
    });

    expect(secretService.getSecretValue).toHaveBeenCalledTimes(1);
  });
});
