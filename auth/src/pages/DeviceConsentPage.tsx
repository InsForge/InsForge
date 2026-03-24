import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useInsforge } from '@insforge/react';
import { ErrorCard } from '../components/ErrorCard';
import {
  buildDeviceSignInPath,
  approveDeviceAuthorization,
  denyDeviceAuthorization,
  lookupDeviceAuthorization,
  normalizeUserCodeInput,
  type DeviceAuthorizationSessionView,
} from '../lib/deviceAuthorization';

type InsforgeSessionLike = {
  accessToken?: string;
} | null;

type InsforgeContextLike = {
  getSession?: () => Promise<InsforgeSessionLike> | InsforgeSessionLike;
  isLoaded?: boolean;
};

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

export function DeviceConsentPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { getSession, isLoaded } = useInsforge() as InsforgeContextLike;
  const userCode = useMemo(
    () => normalizeUserCodeInput(searchParams.get('user_code') || ''),
    [searchParams]
  );
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [authorization, setAuthorization] = useState<DeviceAuthorizationSessionView | null>(null);
  const [loadingAuthorization, setLoadingAuthorization] = useState(true);
  const [actionState, setActionState] = useState<'idle' | 'approving' | 'denying'>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [resultMessage, setResultMessage] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function resolveSessionToken() {
      if (!isLoaded) {
        return;
      }

      try {
        const session = getSession ? await getSession() : null;
        if (cancelled) {
          return;
        }

        if (session && typeof session === 'object' && session.accessToken) {
          setAccessToken(session.accessToken);
          setAuthChecked(true);
          return;
        }
      } catch {
        if (cancelled) {
          return;
        }
      }

      void navigate(buildDeviceSignInPath(userCode), { replace: true });
    }

    void resolveSessionToken();

    return () => {
      cancelled = true;
    };
  }, [getSession, isLoaded, navigate, userCode]);

  useEffect(() => {
    let cancelled = false;

    async function loadAuthorization() {
      if (!authChecked) {
        return;
      }

      if (!userCode) {
        setErrorMessage('Missing device code.');
        setLoadingAuthorization(false);
        return;
      }

      setLoadingAuthorization(true);
      setErrorMessage('');

      try {
        const session = await lookupDeviceAuthorization(userCode, accessToken ?? undefined);
        if (cancelled) {
          return;
        }

        setAuthorization(session);
      } catch (error) {
        if (!cancelled) {
          setAuthorization(null);
          setErrorMessage(
            error instanceof Error ? error.message : 'Failed to load device authorization.'
          );
        }
      } finally {
        if (!cancelled) {
          setLoadingAuthorization(false);
        }
      }
    }

    void loadAuthorization();

    return () => {
      cancelled = true;
    };
  }, [accessToken, authChecked, userCode]);

  const clientContext = authorization?.clientContext ?? null;
  const canAct = Boolean(accessToken) && Boolean(authorization) && actionState === 'idle';
  const isFinalState =
    authorization?.status === 'denied' ||
    authorization?.status === 'expired' ||
    authorization?.status === 'consumed';

  async function handleDecision(action: 'approve' | 'deny') {
    if (!accessToken || !authorization) {
      setErrorMessage('Your browser session is missing. Please sign in again.');
      return;
    }

    setActionState(action === 'approve' ? 'approving' : 'denying');
    setErrorMessage('');
    setResultMessage('');

    try {
      const session =
        action === 'approve'
          ? await approveDeviceAuthorization(userCode, accessToken)
          : await denyDeviceAuthorization(userCode, accessToken);

      setAuthorization(session);
      setResultMessage(action === 'approve' ? 'Device approved.' : 'Device denied.');
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'Unable to update device authorization.'
      );
    } finally {
      setActionState('idle');
    }
  }

  if (loadingAuthorization) {
    return (
      <div className="w-full max-w-2xl px-6 py-10">
        <div className="rounded-3xl border border-slate-200 bg-white p-8 shadow-xl shadow-slate-900/5 dark:border-neutral-800 dark:bg-neutral-900">
          <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
            Loading device consent…
          </p>
        </div>
      </div>
    );
  }

  if (errorMessage && !authorization) {
    return (
      <div className="w-full max-w-2xl px-6 py-10">
        <ErrorCard title="Device authorization unavailable">
          <p>{errorMessage}</p>
        </ErrorCard>
      </div>
    );
  }

  if (!authorization) {
    return null;
  }

  return (
    <div className="w-full max-w-3xl px-6 py-10">
      <div className="rounded-3xl border border-white/60 bg-white/85 p-8 shadow-2xl shadow-slate-900/5 backdrop-blur dark:border-white/10 dark:bg-neutral-900/85">
        <p className="text-sm font-semibold uppercase tracking-[0.3em] text-slate-500 dark:text-slate-400">
          Device consent
        </p>
        <h1 className="mt-3 text-3xl font-semibold text-slate-950 dark:text-white">
          Review the device that is requesting access
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-300">
          Confirm only if you recognize this device and intended to sign in from it.
        </p>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(320px,1fr)]">
        <section className="rounded-3xl border border-slate-200 bg-white p-8 shadow-xl shadow-slate-900/5 dark:border-neutral-800 dark:bg-neutral-900">
          <div className="grid gap-4 sm:grid-cols-2">
            <Detail label="Device name" value={clientContext?.deviceName || 'Unknown device'} />
            <Detail label="Hostname" value={clientContext?.hostname || 'Unknown hostname'} />
            <Detail label="Platform" value={clientContext?.platform || 'Unknown platform'} />
            <Detail label="Instance domain" value={window.location.host} />
            <Detail label="Status" value={authorization.status} />
            <Detail label="Expires at" value={formatDateTime(authorization.expiresAt)} />
          </div>
        </section>

        <aside className="rounded-3xl border border-slate-200 bg-white p-8 shadow-xl shadow-slate-900/5 dark:border-neutral-800 dark:bg-neutral-900">
          <div className="space-y-3">
            <h2 className="text-lg font-semibold text-slate-950 dark:text-white">Actions</h2>
            <p className="text-sm leading-6 text-slate-600 dark:text-slate-300">
              {isFinalState
                ? 'This authorization is no longer pending.'
                : 'Choose whether to approve or deny this request.'}
            </p>
          </div>

          {resultMessage ? (
            <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-200">
              {resultMessage}
            </div>
          ) : null}

          {errorMessage ? (
            <div className="mt-5 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">
              {errorMessage}
            </div>
          ) : null}

          <div className="mt-6 flex flex-col gap-3">
            <button
              type="button"
              onClick={() => void handleDecision('approve')}
              disabled={!canAct || isFinalState}
              className="inline-flex items-center justify-center rounded-full bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200"
            >
              {actionState === 'approving' ? 'Approving...' : 'Confirm'}
            </button>
            <button
              type="button"
              onClick={() => void handleDecision('deny')}
              disabled={!canAct || isFinalState}
              className="inline-flex items-center justify-center rounded-full border border-slate-300 px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:text-slate-200 dark:hover:bg-neutral-800"
            >
              {actionState === 'denying' ? 'Denying...' : 'Deny'}
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-slate-50 px-4 py-3 dark:bg-neutral-950">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
        {label}
      </p>
      <p className="mt-2 text-sm font-medium text-slate-950 dark:text-white">{value}</p>
    </div>
  );
}
