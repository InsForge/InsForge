import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SecretRow } from '../components/SecretRow';
import { secretService } from '../services/secret.service';

// Mock the services
vi.mock('../services/secret.service', () => ({
  secretService: {
    getSecretValue: vi.fn(),
  },
}));

const mockShowToast = vi.fn();
vi.mock('@/lib/hooks/useToast', () => ({
  useToast: () => ({
    showToast: mockShowToast,
  }),
}));

describe('SecretRow', () => {
  const mockSecret = {
    id: '1',
    key: 'TEST_SECRET',
    isActive: true,
    isReserved: false,
    lastUsedAt: null,
    expiresAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const mockOnDelete = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders masked value by default', () => {
    render(<SecretRow secret={mockSecret} onDelete={mockOnDelete} />);
    expect(screen.getByText('••••••••••••••••')).toBeInTheDocument();
    expect(screen.getByText('TEST_SECRET')).toBeInTheDocument();
  });

  it('reveals value when eye icon is clicked', async () => {
    vi.mocked(secretService.getSecretValue).mockResolvedValue('secret-value-123');

    render(<SecretRow secret={mockSecret} onDelete={mockOnDelete} />);

    const revealButton = screen.getByTitle('Reveal value');
    fireEvent.click(revealButton);

    await waitFor(() => {
      expect(secretService.getSecretValue).toHaveBeenCalledWith('TEST_SECRET');
    });

    expect(screen.getByText('secret-value-123')).toBeInTheDocument();
    expect(screen.queryByText('••••••••••••••••')).not.toBeInTheDocument();
  });

  it('shows copy button only when value is revealed', async () => {
    vi.mocked(secretService.getSecretValue).mockResolvedValue('secret-value-123');

    render(<SecretRow secret={mockSecret} onDelete={mockOnDelete} />);

    expect(screen.queryByTitle('Copy to clipboard')).not.toBeInTheDocument();

    const revealButton = screen.getByTitle('Reveal value');
    fireEvent.click(revealButton);

    await waitFor(() => {
      expect(screen.getByTitle('Copy to clipboard')).toBeInTheDocument();
    });
  });

  it('masks value again when eye-off icon is clicked', async () => {
    vi.mocked(secretService.getSecretValue).mockResolvedValue('secret-value-123');

    render(<SecretRow secret={mockSecret} onDelete={mockOnDelete} />);

    const revealButton = screen.getByTitle('Reveal value');
    fireEvent.click(revealButton);

    await waitFor(() => {
      expect(screen.getByText('secret-value-123')).toBeInTheDocument();
    });

    const hideButton = screen.getByTitle('Hide value');
    fireEvent.click(hideButton);

    expect(screen.getByText('••••••••••••••••')).toBeInTheDocument();
    expect(screen.queryByText('secret-value-123')).not.toBeInTheDocument();
  });
});
