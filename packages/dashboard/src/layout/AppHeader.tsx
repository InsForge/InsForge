import { useState, useEffect } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { LogOut, ChevronDown, Plug, X } from 'lucide-react';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@insforge/ui';
import { Avatar, AvatarFallback, Separator, ThemeSelect } from '../components';
import { cn } from '../lib/utils/utils';
import { useTheme } from '../lib/contexts/ThemeContext';
import { useAuth } from '../lib/contexts/AuthContext';
import { useOpenConnectDialog } from './ConnectDialogContext';
import { getFeatureFlag } from '../lib/analytics/posthog';
import { useMcpUsage } from '../features/logs/hooks/useMcpUsage';
import { useProjectId } from '../lib/hooks/useMetadata';

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

// Import SVG icons
import DiscordIcon from '../assets/logos/discord.svg?react';
import GitHubIcon from '../assets/logos/github.svg?react';
import InsForgeLogoLight from '../assets/logos/insforge_light.svg';
import InsForgeLogoDark from '../assets/logos/insforge_dark.svg';

export default function AppHeader() {
  const { resolvedTheme } = useTheme();
  const { user, logout } = useAuth();
  const openConnectDialog = useOpenConnectDialog();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const dashboardVariant = getFeatureFlag('dashboard-v4-experiment');
  const isDTestDashboard = dashboardVariant === 'd_test' && location.pathname === '/dashboard';

  const handleConnectClick = () => {
    if (isDTestDashboard) {
      const next = new URLSearchParams(searchParams);
      next.set('view', 'install');
      setSearchParams(next, { replace: true });
      return;
    }
    openConnectDialog();
  };

  // D test connect-tip: show once after MCP call is detected and user lands on dashboard view.
  const { hasCompletedOnboarding } = useMcpUsage();
  const { projectId } = useProjectId();
  // Initialise to `true` (dismissed) so the tip never flashes while `projectId` is still
  // resolving — otherwise the lazy init would read the shared `-default` localStorage key
  // and leak dismissal state across projects.
  const [connectTipDismissed, setConnectTipDismissed] = useState(true);
  useEffect(() => {
    if (!projectId) {
      return;
    }
    setConnectTipDismissed(readConnectTipDismissed(getConnectTipKey(projectId)));
  }, [projectId]);
  const showConnectTip =
    isDTestDashboard &&
    searchParams.get('view') !== 'install' &&
    hasCompletedOnboarding &&
    !connectTipDismissed;
  const handleDismissConnectTip = () => {
    if (!projectId) {
      return;
    }
    setConnectTipDismissed(true);
    writeConnectTipDismissed(getConnectTipKey(projectId));
  };

  const [githubStars, setGithubStars] = useState<number | null>(null);

  // Fetch GitHub stars
  useEffect(() => {
    fetch('https://api.github.com/repos/InsForge/InsForge')
      .then((res) => res.json())
      .then((data) => {
        if (data.stargazers_count !== undefined) {
          setGithubStars(data.stargazers_count);
        }
      })
      .catch((err) => {
        console.error('Failed to fetch GitHub stars:', err);
      });
  }, []);

  const formatStars = (count: number): string => {
    if (count >= 1000) {
      return `${(count / 1000).toFixed(1)}k`;
    }
    return count.toString();
  };

  const getUserInitials = (email: string) => {
    if (!email) {
      return 'U';
    }
    const parts = email.split('@')[0].split('.');
    if (parts.length > 1) {
      return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase();
    }
    return email.substring(0, 2).toUpperCase();
  };

  const getAvatarColor = (email: string) => {
    if (!email) {
      return 'bg-gray-500';
    }
    const hash = email.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const colors = [
      'bg-blue-500',
      'bg-green-500',
      'bg-yellow-500',
      'bg-purple-500',
      'bg-pink-500',
      'bg-indigo-500',
    ];
    return colors[hash % colors.length];
  };

  return (
    <>
      <div className="h-12 w-full bg-semantic-2 border-b border-[var(--alpha-8)] z-50 flex items-center justify-between px-6">
        {/* Logo */}

        <a href="https://insforge.dev" target="_blank" rel="noopener noreferrer">
          <img
            src={resolvedTheme === 'light' ? InsForgeLogoLight : InsForgeLogoDark}
            alt="Insforge Logo"
            className="h-7 w-auto"
          />
        </a>

        {/* Right side controls */}
        <div className="flex items-center gap-1">
          {/* Social Links - Small Icon Buttons */}
          <a
            href="https://discord.gg/DvBtaEc9Jz"
            target="_blank"
            rel="noopener noreferrer"
            className="p-2 text-gray-600 dark:text-zinc-400 hover:text-neutral-900 dark:hover:text-white transition-colors duration-200"
            aria-label="Discord"
          >
            <DiscordIcon className="h-5 w-5" />
          </a>
          <a
            href="https://github.com/InsForge/InsForge"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 p-2 text-gray-600 dark:text-zinc-400 hover:text-neutral-900 dark:hover:text-white transition-colors duration-200"
            aria-label="GitHub"
          >
            <GitHubIcon className="h-5 w-5" />
            {githubStars !== null && (
              <span className="text-sm font-medium">{formatStars(githubStars)}</span>
            )}
          </a>
          <Separator className="h-5 mx-2" orientation="vertical" />
          <ThemeSelect />
          <Separator className="h-5 mx-2" orientation="vertical" />
          {/* MCP Connection Status */}
          <div className="relative">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={handleConnectClick}
              className="gap-1 rounded-[14px] border-[var(--alpha-8)] px-2 [&_svg]:size-4"
            >
              <Plug aria-hidden="true" />
              <span>Connect</span>
            </Button>
            {showConnectTip && (
              <div className="absolute right-0 top-full z-50 mt-2 w-[200px] animate-in fade-in slide-in-from-top-1">
                {/* Arrow pointing up to the Connect button (inverted color) */}
                <div className="absolute -top-[6px] right-4 h-0 w-0 border-x-[6px] border-b-[8px] border-x-transparent border-b-[rgb(var(--foreground))]" />
                <div className="relative flex flex-col gap-2 rounded border border-[var(--alpha-8)] bg-[rgb(var(--foreground))] p-3 shadow-lg">
                  <div className="flex items-center justify-between gap-2">
                    <span className="rounded bg-[rgb(var(--inverse))]/10 px-2 py-0.5 text-xs font-medium leading-4 text-[rgb(var(--inverse))]">
                      Tip
                    </span>
                    <button
                      type="button"
                      onClick={handleDismissConnectTip}
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
            )}
          </div>

          {/* User Profile*/}
          <Separator className="h-5 mx-2" orientation="vertical" />
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <button className="w-50 flex items-center gap-3 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-[8px] pr-3 transition-all duration-200 group">
                <Avatar className="h-8 w-8 ring-2 ring-white dark:ring-gray-700 shadow-sm">
                  <AvatarFallback
                    className={cn(
                      'text-white font-medium text-sm',
                      getAvatarColor(user?.email ?? '')
                    )}
                  >
                    {getUserInitials(user?.email ?? '')}
                  </AvatarFallback>
                </Avatar>
                <div className="text-left hidden md:block">
                  <p className="text-sm font-medium text-zinc-950 dark:text-zinc-100 leading-tight">
                    Admin
                  </p>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    {user?.email || 'Administrator'}
                  </p>
                </div>
                <ChevronDown className="h-5 w-5 text-black dark:text-white hidden md:block ml-auto" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48" sideOffset={8} collisionPadding={16}>
              <DropdownMenuItem
                onClick={() => void logout()}
                className="cursor-pointer text-red-600 dark:text-red-400"
              >
                <LogOut className="mr-2 h-4 w-4" />
                <span>Sign Out</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </>
  );
}
