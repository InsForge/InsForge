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
} from '@/components';
import { cn } from '@/lib/utils/utils';
import { useTheme } from '@/lib/contexts/ThemeContext';

// Import SVG icons
import DiscordIcon from '@/assets/logos/discord.svg?react';
import GitHubIcon from '@/assets/logos/github.svg?react';
import InsForgeLogoLight from '@/assets/logos/insforge_light.svg';
import InsForgeLogoDark from '@/assets/logos/insforge_dark.svg';
import { User } from '@/lib/contexts/AuthContext';

interface AppHeaderProps {
  currentUser: User | null;
  onLogout: () => void;
}

export default function AppHeader({ currentUser, onLogout }: AppHeaderProps) {
  const { resolvedTheme } = useTheme();
  const [currentEmojiIndex, setCurrentEmojiIndex] = useState(0);
  const emojis = ['🙏', '🥺', '🫵'];

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentEmojiIndex((prevIndex) => (prevIndex + 1) % emojis.length);
    }, 2000);

    return () => clearInterval(interval);
  }, [emojis.length]);

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
    <div className="h-16 w-full bg-white dark:bg-neutral-800 border-b border-border-gray dark:border-neutral-700 z-50 flex items-center justify-between px-6">
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

      {/* Social Links */}
      <div className="flex items-center gap-3">
        {/* GitHub Badge */}
        <a
          href="https://github.com/InsForge/InsForge"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-3 h-10 px-4 text-zinc-50 text-sm font-medium bg-black hover:bg-[#28282F] rounded-full transition-all duration-200"
        >
          <GitHubIcon className="h-5 w-5 dark:text-white" />
          <p className="text-sm text-white">
            We need you
            <span className="text-md ml-1">{emojis[currentEmojiIndex]}</span>
          </p>
        </a>

        {/* Discord Badge */}
        <a
          href="https://discord.com/invite/MPxwj5xVvW"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-3 h-10 px-4 text-zinc-50 text-sm font-medium bg-[#5765F2] hover:bg-[#3E4CD7] rounded-full transition-all duration-200"
        >
          <DiscordIcon className="h-5 w-5" />
          <p className="text-sm text-white mr-1.5">Ask us anything</p>
        </a>
        <Separator className="h-6 mx-1" orientation="vertical" />
        {/* Theme Toggle */}
        <ThemeToggle />
        <Separator className="h-6 mx-1" orientation="vertical" />
        {/* User Profile */}
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <button className="w-50 flex items-center gap-3 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-[8px] pr-3 transition-all duration-200 group">
              <Avatar className="h-10 w-10 ring-2 ring-white dark:ring-gray-700 shadow-sm">
                <AvatarFallback
                  className={cn(
                    'text-white font-medium text-sm',
                    getAvatarColor(currentUser?.email ?? '')
                  )}
                >
                  {getUserInitials(currentUser?.email ?? '')}
                </AvatarFallback>
              </Avatar>
              <div className="text-left hidden md:block">
                <p className="text-sm font-medium text-zinc-950 dark:text-zinc-100 leading-tight">
                  Admin
                </p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  {currentUser?.email || 'Administrator'}
                </p>
              </div>
              <ChevronDown className="h-5 w-5 text-black dark:text-white hidden md:block ml-auto" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48" sideOffset={8} collisionPadding={16}>
            <DropdownMenuItem
              onClick={onLogout}
              className="cursor-pointer text-red-600 dark:text-red-400"
            >
              <LogOut className="mr-2 h-4 w-4" />
              <span>Sign Out</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
