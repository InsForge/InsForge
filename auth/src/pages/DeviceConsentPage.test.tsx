import { render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DeviceConsentPage } from './DeviceConsentPage';

const navigateMock = vi.fn();
const fetchMock = vi.fn();
const { getSessionMock, isLoadedMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  isLoadedMock: vi.fn(() => true),
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
    getSession: getSessionMock,
    isLoaded: isLoadedMock(),
  }),
}));

describe('DeviceConsentPage', () => {
  beforeEach(() => {
    navigateMock.mockReset();
    fetchMock.mockReset();
    getSessionMock.mockReset();
    isLoadedMock.mockReturnValue(true);
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        status: 'authenticated',
        expiresAt: '2026-03-24T00:15:00.000Z',
        clientContext: {
          deviceName: 'my-vps',
        },
      }),
    } as Response);
  });

  it('ignores leaked query access tokens and uses the SDK session token for consent lookup', async () => {
    getSessionMock.mockResolvedValue({
      accessToken: 'session-token-123',
    });

    render(
      <MemoryRouter
        initialEntries={['/auth/device/consent?user_code=abcde-fghij&access_token=leaked-token']}
      >
        <DeviceConsentPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/auth/device/authorizations/lookup'),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer session-token-123',
          }),
        })
      );
    });

    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('redirects back to sign-in when the SDK session cannot be resolved', async () => {
    getSessionMock.mockRejectedValue(new Error('session lookup failed'));

    render(
      <MemoryRouter
        initialEntries={['/auth/device/consent?user_code=abcde-fghij&access_token=leaked-token']}
      >
        <DeviceConsentPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith(
        '/auth/sign-in?redirect=%2Fauth%2Fdevice%2Fconsent%3Fuser_code%3DABCDE-FGHIJ',
        { replace: true }
      );
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
