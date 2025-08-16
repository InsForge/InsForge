import { useState, useEffect } from 'react';
import { LogOut, ChevronDown } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/radix/DropdownMenu';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/radix/Avatar';
import { Separator } from '@/components/radix/Separator';
import { cn } from '@/lib/utils/utils';

// Import SVG icons
import DiscordIcon from '@/assets/icons/discord.svg';
import InsForgeIcon from '@/assets/icons/insforge.svg';
import GitHubIcon from '@/assets/icons/github.svg';

interface AppHeaderProps {
  currentUser: any;
  onLogout: () => void;
}

export default function AppHeader({ currentUser, onLogout }: AppHeaderProps) {
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
    <div className="h-16 w-full bg-white border-b border-border-gray z-50 flex items-center justify-between px-6">
      {/* Logo */}
      <div className="px-2 py-3">
        <img src={InsForgeIcon} alt="Insforge Logo" className="h-6 w-auto" />
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
          <img src={GitHubIcon} alt="GitHub Icon" className="h-5 w-5" />
          <p className="text-sm text-white">
            We need you
            <span className="text-md ml-1">{emojis[currentEmojiIndex]}</span>
          </p>
        </a>

        {/* Discord Badge */}
        <a
          href="https://discord.gg/mqPxArVZ26"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-3 h-10 px-4 text-zinc-50 text-sm font-medium bg-[#5765F2] hover:bg-[#3E4CD7] rounded-full transition-all duration-200"
        >
          <img src={DiscordIcon} alt="Discord Icon" className="h-5 w-5" />
          <p className="text-sm text-white mr-1.5">Ask us anything</p>
        </a>
        <Separator className="h-6 mx-1" orientation="vertical" />
        {/* User Profile */}
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <button className="w-50 flex items-center gap-3 hover:bg-zinc-100 rounded-[8px] pr-3 transition-all duration-200 group">
              <Avatar className="h-10 w-10 ring-2 ring-white shadow-sm">
                <AvatarImage src={currentUser?.avatar} />
                <AvatarFallback
                  className={cn(
                    'text-white font-medium text-sm',
                    getAvatarColor(currentUser?.email)
                  )}
                >
                  {getUserInitials(currentUser?.email)}
                </AvatarFallback>
              </Avatar>
              <div className="text-left hidden md:block">
                <p className="text-sm font-medium text-zinc-950 leading-tight">Admin</p>
                <p className="text-xs  text-zinc-500">{currentUser?.email || 'Administrator'}</p>
              </div>
              <ChevronDown className="h-5 w-5 text-black hidden md:block ml-auto" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48" sideOffset={8} collisionPadding={16}>
            <DropdownMenuItem
              onClick={onLogout}
              className="cursor-pointer text-red-600 focus:text-red-600"
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
