import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { getFeatureFlag } from '../../../../lib/analytics/posthog';
import { useMcpUsage } from '../../../logs/hooks/useMcpUsage';
import { useProjectId } from '../../../../lib/hooks/useMetadata';
import { useDashboardHost, useDashboardProject } from '../../../../lib/config/DashboardHostContext';
import { useDTestView } from './DTestViewContext';

const getConnectTipKey = (projectId: string | null | undefined) =>
  `insforge-dtest-connect-tip-dismissed-${projectId || 'default'}`;

function readConnectTipDismissed(key: string): boolean {
  try {
    return localStorage.getItem(key) === 'true';
  } catch {
    return false;
  }
}

function writeConnectTipDismissed(key: string): void {
  try {
    localStorage.setItem(key, 'true');
  } catch {
    // noop
  }
}

// Floating "you can always re-connect" tip, shown only in cloud-hosting after
// onboarding completes in d_test. Rendered at AppLayout level (not inside
// AppHeader) because cloud-hosting hides our AppHeader via showNavbar=false.
export function DTestConnectTip() {
  const dashboardVariant = getFeatureFlag('dashboard-v4-experiment');
  const { view } = useDTestView();
  const { hasCompletedOnboarding } = useMcpUsage();
  // Prefer the host-injected project id (synchronous) so the dismissal state
  // still resolves when /metadata/project-id 401s during auth bootstrap.
  const dashboardProject = useDashboardProject();
  const { projectId: apiProjectId } = useProjectId();
  const projectId = dashboardProject?.id ?? apiProjectId;

  // Tip is only meaningful in cloud-hosting — the "Connect" hint points at the
  // control plane's top-nav button. Self-hosting users don't have that flow.
  const host = useDashboardHost();
  const showNavbar = host.showNavbar ?? true;
  // Standard cloud path (inside iframe) hides our AppHeader, so tip sits near
  // the iframe's top (just under the control plane navbar). If cloud-hosting
  // renders standalone without iframe, our AppHeader shows and the tip must
  // clear it.
  const topClass = showNavbar ? 'top-14' : 'top-2';

  // Initialise dismissed so the tip never flashes while projectId is resolving.
  const [dismissed, setDismissed] = useState(true);
  useEffect(() => {
    if (!projectId) {
      return;
    }
    setDismissed(readConnectTipDismissed(getConnectTipKey(projectId)));
  }, [projectId]);

  if (
    host.mode !== 'cloud-hosting' ||
    dashboardVariant !== 'd_test' ||
    view === 'install' ||
    !hasCompletedOnboarding ||
    dismissed
  ) {
    return null;
  }

  const handleDismiss = () => {
    if (!projectId) {
      return;
    }
    setDismissed(true);
    writeConnectTipDismissed(getConnectTipKey(projectId));
  };

  return (
    <div
      className={`pointer-events-none fixed right-4 ${topClass} z-50 w-[220px] animate-in fade-in slide-in-from-top-1`}
    >
      {/* Arrow pointing up toward the control plane's Connect button in the navbar.
          Layout there: [Discord/GitHub] [Contact Us] [Connect ~90px wide] [Avatar 32px] pr-3.
          Connect centre ≈ 90px from viewport right; tip card sits at right-4 (16px from
          right), so the arrow needs right-[72px] within the card to land on Connect. */}
      <div className="pointer-events-none absolute -top-[6px] right-[72px] h-0 w-0 border-x-[6px] border-b-[8px] border-x-transparent border-b-[rgb(var(--foreground))]" />
      <div className="pointer-events-auto relative flex flex-col gap-2 rounded border border-[var(--alpha-8)] bg-[rgb(var(--foreground))] p-3 shadow-lg">
        <div className="flex items-center justify-between gap-2">
          <span className="rounded bg-[rgb(var(--inverse))]/10 px-2 py-0.5 text-xs font-medium leading-4 text-[rgb(var(--inverse))]">
            Tip
          </span>
          <button
            type="button"
            onClick={handleDismiss}
            aria-label="Dismiss tip"
            className="shrink-0 text-[rgb(var(--inverse))]/60 hover:text-[rgb(var(--inverse))]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="text-xs leading-4 text-[rgb(var(--inverse))]">
          You can always click here to re-connect.
        </p>
      </div>
    </div>
  );
}
