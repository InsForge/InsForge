import { useState, useEffect } from 'react';
import { LogOut, ChevronDown } from 'lucide-react';
import {
  Avatar,
  AvatarFallback,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Separator,
  ThemeToggle,
  Button,
} from '@/components';
import { ContactModal } from '@/components/ContactModal';
import {
  McpConnectionStatus,
  OnboardingModal,
  getOnboardingSkipped,
  setOnboardingSkipped,
} from '@/features/onboard';
import { useMcpUsage } from '@/features/logs/hooks/useMcpUsage';
import { cn, isInsForgeCloudProject } from '@/lib/utils/utils';
import { useTheme } from '@/lib/contexts/ThemeContext';
import { useAuth } from '@/lib/contexts/AuthContext';

// Import SVG icons
import DiscordIcon from '@/assets/logos/discord.svg?react';
import GitHubIcon from '@/assets/logos/github.svg?react';
import InsForgeLogoLight from '@/assets/logos/insforge_light.svg';
import InsForgeLogoDark from '@/assets/logos/insforge_dark.svg';

export default function AppHeader() {
  const { resolvedTheme } = useTheme();
  const { user, logout } = useAuth();
  const { hasCompletedOnboarding, isLoading: isMcpLoading } = useMcpUsage();
  const [githubStars, setGithubStars] = useState<number | null>(null);
  const [isContactModalOpen, setIsContactModalOpen] = useState(false);
  const [isOnboardingModalOpen, setIsOnboardingModalOpen] = useState(false);

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

  // Auto-open onboarding modal if user hasn't connected and hasn't skipped
  useEffect(() => {
    if (!isMcpLoading && !hasCompletedOnboarding && !getOnboardingSkipped()) {
      setIsOnboardingModalOpen(true);
    }
  }, [isMcpLoading, hasCompletedOnboarding]);

  // When MCP connection is established, close onboarding modal and clear skip flag
  useEffect(() => {
    if (hasCompletedOnboarding) {
      setIsOnboardingModalOpen(false);
      setOnboardingSkipped(false);
    }
  }, [hasCompletedOnboarding]);

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

  const isCloud = isInsForgeCloudProject();

  return (
    <>
      <div className="h-12 w-full bg-white dark:bg-neutral-800 border-b border-border-gray dark:border-neutral-700 z-50 flex items-center justify-between px-6">
        {/* Logo */}
        <div className="px-2 py-3">
          <a href="https://insforge.dev" target="_blank" rel="noopener noreferrer">
            <img
              src={resolvedTheme === 'light' ? InsForgeLogoLight : InsForgeLogoDark}
              alt="Insforge Logo"
              className="h-8 w-auto"
            />
          </a>
        </div>

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
          {/* Theme Toggle */}
          <ThemeToggle />
          <Separator className="h-5 mx-2" orientation="vertical" />
          {/* Text Us Button */}
          <Button
            variant="outline"
            onClick={() => setIsContactModalOpen(true)}
            className="h-9 py-2 bg-black dark:bg-white text-white dark:text-black border-neutral-600 dark:border-neutral-600 hover:bg-gray-900 dark:hover:bg-neutral-100 hover:text-white dark:hover:text-black rounded-full"
          >
            Text Us
          </Button>
          {/* MCP Connection Status */}
          <McpConnectionStatus onConnectClick={() => setIsOnboardingModalOpen(true)} />

          {/* User Profile - Only show in non-Cloud (OSS) environment */}
          {!isCloud && (
            <>
              <Separator className="h-5 mx-2" orientation="vertical" />
              <DropdownMenu modal={false}>
                <DropdownMenuTrigger asChild>
                  <button className="w-50 flex items-center gap-3 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-[8px] pr-3 transition-all duration-200 group">
                    <Avatar className="h-10 w-10 ring-2 ring-white dark:ring-gray-700 shadow-sm">
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
                <DropdownMenuContent
                  align="end"
                  className="w-48"
                  sideOffset={8}
                  collisionPadding={16}
                >
                  <DropdownMenuItem
                    onClick={logout}
                    className="cursor-pointer text-red-600 dark:text-red-400"
                  >
                    <LogOut className="mr-2 h-4 w-4" />
                    <span>Sign Out</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )}
        </div>
      </div>

      {/* Contact Modal */}
      <ContactModal open={isContactModalOpen} onOpenChange={setIsContactModalOpen} />

      {/* Onboarding Modal */}
      <OnboardingModal
        open={isOnboardingModalOpen}
        onOpenChange={setIsOnboardingModalOpen}
        onTextUsClick={() => {
          setIsOnboardingModalOpen(false);
          setIsContactModalOpen(true);
        }}
      />
    </>
  );
}
