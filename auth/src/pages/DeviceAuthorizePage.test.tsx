import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DeviceAuthorizePage } from './DeviceAuthorizePage';

const navigateMock = vi.fn();
const fetchMock = vi.fn();
const { isSignedInMock, getSessionMock } = vi.hoisted(() => ({
  isSignedInMock: vi.fn(() => false),
  getSessionMock: vi.fn(),
}));

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
    isSignedIn: isSignedInMock(),
    getSession: getSessionMock,
  }),
}));

describe('DeviceAuthorizePage', () => {
  beforeEach(() => {
    navigateMock.mockReset();
    fetchMock.mockReset();
    isSignedInMock.mockReturnValue(false);
    getSessionMock.mockResolvedValue(null);
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        status: 'pending_authorization',
        expiresAt: '2026-03-24T00:15:00.000Z',
      }),
    } as Response);
  });

  it('prefills the user code and redirects signed-out users to the existing sign-in flow', async () => {
    render(
      <MemoryRouter initialEntries={['/auth/device?user_code=abcde-fghij']}>
        <DeviceAuthorizePage />
      </MemoryRouter>
    );

    expect(screen.getByLabelText(/device code/i)).toHaveValue('ABCDE-FGHIJ');

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
      '/auth/sign-in?redirect=%2Fauth%2Fdevice%2Fconsent%3Fuser_code%3DABCDE-FGHIJ',
      { replace: true }
    );
  });

  it('navigates with the code that was validated even if the field changes before lookup resolves', async () => {
    let resolveLookup: ((value: Response) => void) | null = null;
    fetchMock.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveLookup = resolve;
        })
    );
    isSignedInMock.mockReturnValue(true);
    getSessionMock.mockResolvedValue({
      accessToken: 'access-token-123',
    });

    render(
      <MemoryRouter initialEntries={['/auth/device?user_code=abcde-fghij']}>
        <DeviceAuthorizePage />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    fireEvent.change(screen.getByLabelText(/device code/i), {
      target: { value: 'vwxyz-12345' },
    });

    if (!resolveLookup) {
      throw new Error('Expected lookup request to remain pending');
    }

    const pendingResolve = resolveLookup as (value: Response) => void;
    pendingResolve({
      ok: true,
      status: 200,
      json: async () => ({
        status: 'pending_authorization',
        expiresAt: '2026-03-24T00:15:00.000Z',
      }),
    } as Response);

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith('/auth/device/consent?user_code=ABCDE-FGHIJ', {
        replace: true,
      });
    });
  });
});
