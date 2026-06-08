import { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { LogOut, ChevronDown, Plug, Plus, User, Trash } from 'lucide-react';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@insforge/ui';
import { apiClient } from '#lib/api/client';
import { Avatar, AvatarFallback, Separator, ThemeSelect } from '#components';
import { cn } from '#lib/utils/utils';
import { useTheme } from '#lib/contexts/ThemeContext';
import { useAuth } from '#lib/contexts/AuthContext';
import { useOpenConnectDialog } from './ConnectDialogContext';
import { getFeatureFlag } from '#lib/analytics/posthog';

// Import SVG icons
import DiscordIcon from '#assets/logos/discord.svg?react';
import GitHubIcon from '#assets/logos/github.svg?react';
import InsForgeLogoLight from '#assets/logos/insforge_light.svg';
import InsForgeLogoDark from '#assets/logos/insforge_dark.svg';

export default function AppHeader() {
  const { resolvedTheme } = useTheme();
  const { user, logout } = useAuth();
  const openConnectDialog = useOpenConnectDialog();
  const dashboardVariant = getFeatureFlag('dashboard-v4-experiment');
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [isAddAdminOpen, setIsAddAdminOpen] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRootAdmin, setIsRootAdmin] = useState(false);
  const [getAllAdmins, setAllAdmins] = useState<any[]>([]);
  const isDTest = dashboardVariant === 'd_test';
  const [setPasswordOpen, setIsSetPasswordOpen] = useState(false);
  const [oldPassword, setOldPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const isConnectDisabled = isDTest && pathname === '/dashboard/install';

  const handleAddAdmin = async () => {
    setIsSubmitting(true);
    try {
      await apiClient.request('/auth/admin/addAdmin', {
        method: 'POST',
        body: JSON.stringify({
          name: newUsername,
          password: newPassword,
        })
      })
      setIsAddAdminOpen(false);
    } catch (error) {
      console.error('Failed to add admin', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      setIsSubmitting(true);
      await apiClient.request(`/auth/admin/deleteAdmin`, {
        method: 'DELETE',
        body: JSON.stringify({
          id,
        })
      })
    } catch (error) {
      console.error('Failed to delete admin', error);
    } finally {
      setIsSubmitting(false);
    }
  }

  const changePassword = async () => {
    setIsSubmitting(true);
    try {
      if (confirmPassword !== newPassword) {
        throw new Error('Passwords do not match');
      }
      await apiClient.request('/auth/admin/resetPassword', {
        method: 'PUT',
        body: JSON.stringify({
          oldPassword,
          newPassword,
        })
      })
      setIsSetPasswordOpen(false);
    } catch (error) {
      console.error('Failed to change password', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConnectClick = () => {
    if (isDTest) {
      void navigate('/dashboard/install');
      return;
    }
    openConnectDialog();
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
  useEffect(() => {
    apiClient.request('/auth/admin/allAdmins', {
      method: "GET",
    }).then((result) => {
      setAllAdmins(result);
    })

  }, [isSubmitting])
  useEffect(() => {
    apiClient.request('/auth/admin/sessions/current').then((response) => {
      setIsRootAdmin(response);
    })
  }, [])

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
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={handleConnectClick}
            disabled={isConnectDisabled}
            className="gap-1 rounded-[14px] border-[var(--alpha-8)] px-2 [&_svg]:size-4"
          >
            <Plug aria-hidden="true" />
            <span>Connect</span>
          </Button>

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
              {isRootAdmin &&
                (<DropdownMenuItem
                  onClick={() => { setIsAddAdminOpen(true) }}
                  className="cursor-pointer dark:text-zinc-400"
                >
                  <Plus className="mr-2 h-4 w-4" />
                  <span>Add Admin</span>
                </DropdownMenuItem>)}
              {(getAllAdmins ?? []).map((admin: any, idx: any) => (
                <DropdownMenuItem
                  key={idx}
                  className="cursor-pointer flex justify-normal dark:text-zinc-400"
                >
                  <User className="mr-2 h-4 w-4" />
                  <span>{admin.username}</span>
                  {isRootAdmin && (<div className="bg-red-400 p-1 rounded-md" onClick={() => void handleDelete(admin.id)}>
                    <Trash className="h-4 w-4" />
                  </div>)}
                </DropdownMenuItem>
              ))}
              <DropdownMenuItem
                onClick={() => void logout()}
                className="cursor-pointer text-red-600 dark:text-red-400"
              >
                <LogOut className="mr-2 h-4 w-4" />
                <span>Sign Out</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => { setIsSetPasswordOpen(true); }}
                className="cursor-pointer dark:text-blue-400"
              >
                <Plus className="mr-2 h-4 w-4" />
                <span>change password</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Dialog open={isAddAdminOpen} onOpenChange={setIsAddAdminOpen}>
            <DialogContent className='w-80'>
              <DialogHeader>
                <DialogTitle>Add Admin</DialogTitle>
              </DialogHeader>
              <div className="flex flex-col p-10 gap-4 text-white">
                <input
                  placeholder="Username"
                  className="border-[var(--alpha-8)] border"
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                />
                <input
                  type="password"
                  className="border-[var(--alpha-8)] border"
                  placeholder="Password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
                <Button onClick={() => void handleAddAdmin()}>Add</Button>
              </div>
            </DialogContent>
          </Dialog>
          <Dialog open={setPasswordOpen} onOpenChange={setIsSetPasswordOpen}>
            <DialogContent className='w-80'>
              <DialogHeader>
                <DialogTitle>change password</DialogTitle>
              </DialogHeader>
              <div className="flex flex-col p-10 gap-4 text-white">
                <input
                  placeholder="old password"
                  type="password"
                  className="border-[var(--alpha-8)] border"
                  value={oldPassword}
                  onChange={(e) => setOldPassword(e.target.value)}
                />
                <input
                  type="password"
                  className="border-[var(--alpha-8)] border"
                  placeholder="new password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
                <input
                  type="password"
                  className="border-[var(--alpha-8)] border"
                  placeholder="confirm password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
                <Button onClick={() => void changePassword()}>change password</Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>
    </>
  );
}
