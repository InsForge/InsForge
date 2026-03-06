import { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { Plug, User } from 'lucide-react';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@insforge/ui';
import { Separator, ThemeSelect } from '@/components';
import { useTheme } from '@/lib/contexts/ThemeContext';
import { useAuth } from '@/lib/contexts/AuthContext';
import { useModal } from '@/lib/hooks/useModal';
import { useMcpUsage } from '@/features/logs/hooks/useMcpUsage';

import DiscordIcon from '@/assets/logos/discord.svg?react';
import GitHubIcon from '@/assets/logos/github.svg?react';
import InsForgeLogoLight from '@/assets/logos/insforge_light.svg';
import InsForgeLogoDark from '@/assets/logos/insforge_dark.svg';

const buttonClass =
  'gap-1.5 px-3 rounded-full text-muted-foreground hover:text-foreground [&_svg]:size-3.5 [&_svg]:text-muted-foreground hover:[&_svg]:text-foreground';

export default function AppHeader() {
  const { resolvedTheme } = useTheme();
  const { user, logout } = useAuth();
  const { setConnectDialogOpen } = useModal();
  const { hasCompletedOnboarding, latestRecord, isLoading: isMcpLoading } = useMcpUsage();
  const [githubStars, setGithubStars] = useState<number | null>(null);

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
    if (count >= 1000) return `${(count / 1000).toFixed(1)}k`;
    return count.toString();
  };

  return (
    <div className="h-12 w-full bg-semantic-2 border-b border-[var(--alpha-8)] z-50 flex items-center justify-between px-6">
      {/* Logo */}
      <a href="https://insforge.dev" target="_blank" rel="noopener noreferrer">
        <img
          src={resolvedTheme === 'light' ? InsForgeLogoLight : InsForgeLogoDark}
          alt="InsForge Logo"
          className="h-7 w-auto"
        />
      </a>

      {/* Right side controls */}
      <div className="flex items-center gap-1">
        {/* Social links */}
        <a
          href="https://discord.gg/DvBtaEc9Jz"
          target="_blank"
          rel="noopener noreferrer"
          className="p-2 text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Discord"
        >
          <DiscordIcon className="h-4 w-4" />
        </a>
        <a
          href="https://github.com/InsForge/InsForge"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 p-2 text-muted-foreground hover:text-foreground transition-colors"
          aria-label="GitHub"
        >
          <GitHubIcon className="h-4 w-4" />
          {githubStars !== null && (
            <span className="text-xs font-medium">{formatStars(githubStars)}</span>
          )}
        </a>

        <Separator className="h-4 mx-2" orientation="vertical" />

        {/* MCP connection status */}
        {!isMcpLoading && (
          hasCompletedOnboarding ? (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => setConnectDialogOpen(true)}
                    className={buttonClass}
                  >
                    <span className="h-2 w-2 rounded-full bg-primary shrink-0" aria-hidden="true" />
                    <span className="font-normal">Connected</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" sideOffset={8}>
                  <p className="text-xs">
                    Last MCP call:{' '}
                    <span className="font-medium text-foreground">
                      {latestRecord
                        ? format(new Date(latestRecord.created_at), 'MMM dd, yyyy, h:mm a')
                        : 'Unknown'}
                    </span>
                  </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setConnectDialogOpen(true)}
              className={buttonClass}
            >
              <Plug aria-hidden="true" />
              <span className="font-normal">Connect</span>
            </Button>
          )
        )}

        <Separator className="h-4 mx-2" orientation="vertical" />
        <ThemeSelect />
        <Separator className="h-4 mx-2" orientation="vertical" />

        {/* User dropdown — no avatar (admin has no avatar support) */}
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <button
              className="flex h-8 w-8 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-alpha-4 transition-colors"
              aria-label="User menu"
            >
              <User strokeWidth={1.5} className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>

          <DropdownMenuContent align="end" className="w-48" sideOffset={6} collisionPadding={16}>
            <DropdownMenuLabel>
              <p className="truncate text-sm font-normal text-muted-foreground">
                {user?.email || 'Administrator'}
              </p>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => void logout()}
              className="cursor-pointer"
            >
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
