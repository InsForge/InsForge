import { useNavigate } from 'react-router-dom';
import { useMcpUsage } from '@/features/logs/hooks/useMcpUsage';
import { isInsForgeCloudProject } from '@/lib/utils/utils';
import { postMessageToParent } from '@/lib/utils/cloudMessaging';

interface ConnectCTAProps {
  className?: string;
  fallback?: string;
}

export function ConnectCTA({ className, fallback }: ConnectCTAProps) {
  const navigate = useNavigate();
  const { hasCompletedOnboarding } = useMcpUsage();

  if (hasCompletedOnboarding) {
    return fallback;
  }

  const handleConnect = () => {
    if (isInsForgeCloudProject()) {
      postMessageToParent({ type: 'SHOW_ONBOARDING_OVERLAY' });
    } else {
      void navigate('/dashboard/onboard');
    }
  };

  return (
    <span className={className}>
      <button
        onClick={handleConnect}
        className="text-chart-blue-dark dark:text-emerald-300 hover:no-underline focus:outline-none"
      >
        Connect
      </button>{' '}
      to your coding agent to get started.
    </span>
  );
}
