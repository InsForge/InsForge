import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DeviceAuthorizePage } from './DeviceAuthorizePage';

const navigateMock = vi.fn();
const fetchMock = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');

  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

vi.mock('@insforge/react', () => ({
  useInsforge: () => ({
    isLoaded: true,
    isSignedIn: false,
    getSession: vi.fn(),
  }),
}));

describe('DeviceAuthorizePage', () => {
  beforeEach(() => {
    navigateMock.mockReset();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        id: '11111111-1111-1111-1111-111111111111',
        status: 'pending_authorization',
        expiresAt: '2026-03-24T00:15:00.000Z',
        pollIntervalSeconds: 5,
        approvedByUserId: null,
        consumedAt: null,
        clientContext: {
          deviceName: 'my-vps',
        },
        createdAt: '2026-03-24T00:00:00.000Z',
        updatedAt: '2026-03-24T00:00:00.000Z',
      }),
    } as Response);
  });

  it('prefills the user code and redirects signed-out users to the existing sign-in flow', async () => {
    render(
      <MemoryRouter initialEntries={['/auth/device?user_code=abcd-efgh']}>
        <DeviceAuthorizePage />
      </MemoryRouter>
    );

    expect(screen.getByLabelText(/device code/i)).toHaveValue('ABCD-EFGH');

    fireEvent.click(screen.getByRole('button', { name: /continue/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/auth/device/authorizations/lookup'),
        expect.objectContaining({
          method: 'POST',
        })
      );
    });

    expect(navigateMock).toHaveBeenCalledWith(
      '/auth/sign-in?redirect=%2Fauth%2Fdevice%2Fconsent%3Fuser_code%3DABCD-EFGH',
      { replace: true }
    );
  });
});
