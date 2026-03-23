import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useInsforge } from '@insforge/react';
import { ErrorCard } from '../components/ErrorCard';
import {
  AUTH_DEVICE_CONSENT_PATH,
  buildDeviceConsentPath,
  buildDeviceSignInPath,
  lookupDeviceAuthorization,
  normalizeUserCodeInput,
  type DeviceAuthorizationSessionView,
} from '../lib/deviceAuthorization';

type InsforgeSessionLike = {
  accessToken?: string;
} | null;

type InsforgeContextLike = {
  getSession?: () => Promise<InsforgeSessionLike> | InsforgeSessionLike;
  isSignedIn?: boolean;
};

const INVALID_DEVICE_AUTHORIZATION_STATUSES: DeviceAuthorizationSessionView['status'][] = [
  'denied',
  'expired',
  'consumed',
];

export function DeviceAuthorizePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { getSession, isSignedIn } = useInsforge() as InsforgeContextLike;
  const [userCode, setUserCode] = useState(() =>
    normalizeUserCodeInput(searchParams.get('user_code') || '')
  );
  const [errorMessage, setErrorMessage] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const queryUserCode = searchParams.get('user_code');
    if (queryUserCode) {
      setUserCode(normalizeUserCodeInput(queryUserCode));
    }
  }, [searchParams]);

  const consentPath = useMemo(() => buildDeviceConsentPath(userCode), [userCode]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const normalizedUserCode = normalizeUserCodeInput(userCode);
    if (!normalizedUserCode) {
      setErrorMessage('Enter the device code shown on your terminal.');
      return;
    }

    setLoading(true);
    setErrorMessage('');

    try {
      const session = await lookupDeviceAuthorization(normalizedUserCode);
      if (INVALID_DEVICE_AUTHORIZATION_STATUSES.includes(session.status)) {
        throw new Error('This device code is no longer valid.');
      }

      const browserSession = getSession ? await getSession() : null;
      const hasBrowserSession =
        Boolean(isSignedIn) ||
        Boolean(browserSession && typeof browserSession === 'object' && browserSession.accessToken);

      navigate(
        hasBrowserSession ? consentPath : buildDeviceSignInPath(normalizedUserCode),
        { replace: true }
      );
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to resolve the device code.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="w-full max-w-2xl px-6 py-10">
      <div className="mb-6 rounded-3xl border border-white/60 bg-white/85 p-8 shadow-2xl shadow-slate-900/5 backdrop-blur dark:border-white/10 dark:bg-neutral-900/85">
        <p className="text-sm font-semibold uppercase tracking-[0.3em] text-slate-500 dark:text-slate-400">
          Device authorization
        </p>
        <h1 className="mt-3 text-3xl font-semibold text-slate-950 dark:text-white">
          Connect your remote device
        </h1>
        <p className="mt-3 max-w-xl text-sm leading-6 text-slate-600 dark:text-slate-300">
          Enter the short code from your terminal to continue to browser consent.
        </p>
      </div>

      <form
        onSubmit={handleSubmit}
        className="rounded-3xl border border-slate-200 bg-white p-8 shadow-xl shadow-slate-900/5 dark:border-neutral-800 dark:bg-neutral-900"
      >
        <label htmlFor="device-code" className="block text-sm font-medium text-slate-700 dark:text-slate-200">
          Device code
        </label>
        <input
          id="device-code"
          name="device-code"
          value={userCode}
          onChange={(event) => setUserCode(normalizeUserCodeInput(event.target.value))}
          placeholder="ABCD-EFGH"
          autoCapitalize="characters"
          autoComplete="one-time-code"
          spellCheck={false}
          className="mt-2 w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-lg tracking-[0.3em] uppercase text-slate-950 outline-none transition placeholder:tracking-normal placeholder:normal-case placeholder:text-slate-400 focus:border-slate-900 dark:border-neutral-700 dark:bg-neutral-950 dark:text-white dark:focus:border-white"
        />
        <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
          Paste the 8-character code and we will verify it before opening consent.
        </p>

        {errorMessage ? (
          <div className="mt-5">
            <ErrorCard title="Device code unavailable">
              <p>{errorMessage}</p>
            </ErrorCard>
          </div>
        ) : null}

        <div className="mt-6 flex items-center gap-3">
          <button
            type="submit"
            disabled={loading}
            className="inline-flex items-center justify-center rounded-full bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200"
          >
            {loading ? 'Checking code...' : 'Continue'}
          </button>
          <span className="text-sm text-slate-500 dark:text-slate-400">
            Next step: {AUTH_DEVICE_CONSENT_PATH}
          </span>
        </div>
      </form>
    </div>
  );
}
