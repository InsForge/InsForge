import { useQuery } from '@tanstack/react-query';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTheme } from '@/lib/contexts/ThemeContext';
import { metadataService } from '@/features/metadata/services/metadata.service';
import { authService } from '@/features/auth/services/auth.service';
import { Skeleton } from '@/components/radix/Skeleton';
import { Card, CardContent } from '@/components/radix/Card';
import {
  Users,
  Database,
  HardDrive,
  Lock,
  Box,
  ChevronRight,
  ArrowLeftRight,
  Link2,
} from 'lucide-react';
import GithubLight from '@/assets/icons/github.svg';
import Google from '@/assets/icons/google.svg';
import GithubDark from '@/assets/icons/github_dark.svg';
import OpenAI from '@/assets/icons/openai.svg?react';
import Gemini from '@/assets/icons/gemini.svg';
import Claude from '@/assets/icons/claude_code_logo.svg';
import Grok from '@/assets/icons/grok.svg?react';

export default function DashboardPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { resolvedTheme } = useTheme();

  const {
    data: metadata,
    isLoading,
    refetch: _refetchMetadata,
  } = useQuery({
    queryKey: ['dashboard-metadata'],
    queryFn: () => metadataService.getDashboardMetadata(),
  });

  const { data: usersData, isLoading: isLoadingUsers } = useQuery({
    queryKey: ['users-count'],
    queryFn: () => authService.getUsers(),
  });

  const { data: fullMetadata, isLoading: isLoadingFullMetadata } = useQuery({
    queryKey: ['full-metadata'],
    queryFn: () => metadataService.getFullMetadata(),
  });

  const handleNavigateTo = (to: string, state?: { initialTab?: string }) => {
    const basePath = location.pathname.includes('/cloud')
      ? location.pathname.replace('/dashboard', '')
      : location.pathname;
    void navigate(`${basePath}/${to}`, { state });
  };

  const handleConnectInsForge = () => {
    if (window.parent !== window) {
      // Send message to parent window to open onboarding overlay
      const targetOrigin = window.location.origin.includes('localhost')
        ? '*'
        : 'https://insforge.dev';
      window.parent.postMessage(
        {
          type: 'OPEN_CONNECT_OVERLAY',
        },
        targetOrigin
      );
    } else {
      void handleNavigateTo('onboard');
    }
  };

  return (
    <main className="h-full bg-white dark:bg-neutral-800">
      <div className="flex justify-center py-6 px-0">
        <div className="flex flex-col gap-6 w-full max-w-[1080px] px-6">
          {/* Dashboard Header */}
          <div className="flex items-center justify-between w-full">
            <h1 className="text-xl font-semibold text-gray-900 dark:text-white tracking-[-0.1px]">
              Dashboard
            </h1>
          </div>

          {/* Connect InsForge Card */}
          <Card className="w-full bg-white dark:bg-[#333333] rounded-lg border border-gray-200 dark:border-neutral-700 shadow-[0px_1px_3px_0px_rgba(0,0,0,0.1)]">
            <CardContent className="px-8 py-6">
              <div className="flex items-center justify-between">
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <Link2 className="w-5 h-5 text-black dark:text-white" />
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                      Connect InsForge
                    </h3>
                  </div>
                  <p className="text-sm text-gray-600 dark:text-neutral-400">
                    With InsForge connected, your agent takes care of the backend for you
                  </p>
                </div>
                <div
                  className="flex items-center gap-2 px-4 py-2 bg-emerald-300 hover:bg-emerald-400 text-black rounded font-medium text-sm transition-colors cursor-pointer"
                  onClick={handleConnectInsForge}
                >
                  <ArrowLeftRight className="w-5 h-5" />
                  Connect
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Stats Cards */}
          <div className="flex gap-6 w-full">
            {/* AUTH Card */}
            <Card className="flex-1 bg-white dark:bg-[#333333] rounded-lg border border-gray-200 dark:border-neutral-700 shadow-[0px_1px_3px_0px_rgba(0,0,0,0.1)] h-[280px]">
              <CardContent className="p-8 h-full flex flex-col justify-between">
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2 h-7">
                    <Users className="w-5 h-5 text-gray-700 dark:text-white" />
                    <span className="text-base font-normal text-gray-900 dark:text-white">
                      AUTH
                    </span>
                  </div>
                </div>
                <div className="flex flex-col gap-4">
                  <div className="flex items-baseline gap-2">
                    {isLoadingUsers ? (
                      <Skeleton className="h-8 w-16 bg-gray-200 dark:bg-neutral-700" />
                    ) : (
                      <>
                        <span className="text-2xl font-normal text-gray-900 dark:text-white tracking-[-0.144px]">
                          {(usersData?.users.length || 0).toLocaleString()}
                        </span>
                        <span className="text-sm font-normal text-gray-500 dark:text-neutral-400">
                          {usersData?.users.length === 1 ? 'user' : 'users'}
                        </span>
                      </>
                    )}
                  </div>
                  {isLoadingFullMetadata ? (
                    <Skeleton className="h-5 w-36 bg-gray-200 dark:bg-neutral-700" />
                  ) : (
                    <p className="text-base text-gray-500 dark:text-neutral-400">
                      {(() => {
                        const authCount =
                          (fullMetadata?.auth?.google?.enabled ||
                          fullMetadata?.auth?.google?.useSharedKeys
                            ? 1
                            : 0) +
                          (fullMetadata?.auth?.github?.enabled ||
                          fullMetadata?.auth?.github?.useSharedKeys
                            ? 1
                            : 0);
                        return `${authCount} OAuth ${authCount === 1 ? 'provider' : 'providers'} enabled`;
                      })()}
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Database Card */}
            <Card className="flex-1 bg-white dark:bg-[#333333] rounded-lg border border-gray-200 dark:border-neutral-700 shadow-[0px_1px_3px_0px_rgba(0,0,0,0.1)] h-[280px]">
              <CardContent className="p-8 h-full flex flex-col justify-between">
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2 h-7">
                    <Database className="w-5 h-5 text-gray-700 dark:text-white" />
                    <span className="text-base font-normal text-gray-900 dark:text-white">
                      Database
                    </span>
                  </div>
                </div>
                <div className="flex flex-col gap-4">
                  <div className="flex items-baseline gap-2">
                    {isLoading ? (
                      <Skeleton className="h-8 w-14 bg-gray-200 dark:bg-neutral-700" />
                    ) : (
                      <>
                        <span className="text-2xl font-normal text-gray-900 dark:text-white tracking-[-0.144px]">
                          {(metadata?.databaseSizeGb || 0).toFixed(2)}
                        </span>
                        <span className="text-sm font-normal text-gray-500 dark:text-neutral-400">
                          GB
                        </span>
                      </>
                    )}
                  </div>
                  {isLoadingFullMetadata ? (
                    <Skeleton className="h-5 w-16 bg-gray-200 dark:bg-neutral-700" />
                  ) : (
                    <p className="text-base text-gray-500 dark:text-neutral-400">
                      {fullMetadata?.database?.tables?.length || 0}{' '}
                      {fullMetadata?.database?.tables?.length === 1 ? 'Table' : 'Tables'}
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Storage Card */}
            <Card className="flex-1 bg-white dark:bg-[#333333] rounded-lg border border-gray-200 dark:border-neutral-700 shadow-[0px_1px_3px_0px_rgba(0,0,0,0.1)] h-[280px]">
              <CardContent className="p-8 h-full flex flex-col justify-between">
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2 h-7">
                    <HardDrive className="w-5 h-5 text-gray-700 dark:text-white" />
                    <span className="text-base font-normal text-gray-900 dark:text-white">
                      Storage
                    </span>
                  </div>
                </div>
                <div className="flex flex-col gap-4">
                  <div className="flex items-baseline gap-2">
                    {isLoading ? (
                      <Skeleton className="h-8 w-14 bg-gray-200 dark:bg-neutral-700" />
                    ) : (
                      <>
                        <span className="text-2xl font-normal text-gray-900 dark:text-white tracking-[-0.144px]">
                          {(metadata?.storageSizeGb || 0).toFixed(2)}
                        </span>
                        <span className="text-sm font-normal text-gray-500 dark:text-neutral-400">
                          GB
                        </span>
                      </>
                    )}
                  </div>
                  {isLoadingFullMetadata ? (
                    <Skeleton className="h-5 w-20 bg-gray-200 dark:bg-neutral-700" />
                  ) : (
                    <p className="text-base text-gray-500 dark:text-neutral-400">
                      {fullMetadata?.storage?.buckets?.length || 0}{' '}
                      {fullMetadata?.storage?.buckets?.length === 1 ? 'Bucket' : 'Buckets'}
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Quick Start Section */}
          <div className="flex flex-col gap-6 w-full">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white tracking-[-0.1px]">
              Quick Start
            </h2>

            <div className="flex gap-6 w-full">
              {/* Add Social Sign On */}
              <Card className="h-18 flex-1 bg-white dark:bg-[#363636] dark:hover:bg-transparent rounded-lg border border-gray-200 dark:border-neutral-700 shadow-[0px_1px_3px_0px_rgba(0,0,0,0.1)] hover:shadow-md transition-shadow cursor-pointer">
                <CardContent
                  className="py-6 px-8"
                  onClick={() => handleNavigateTo('authentication', { initialTab: 'auth-methods' })}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Lock className="w-5 h-5 text-neutral-600 dark:text-neutral-400" />
                      <p className="text-base font-medium text-neutral-900 dark:text-white">
                        Add Social Sign On
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <img src={Google} alt="Google" className="w-5 h-5" />
                      <img
                        src={resolvedTheme === 'dark' ? GithubLight : GithubDark}
                        alt="Github"
                        className="w-5 h-5"
                      />
                      <ChevronRight className="w-5 h-5 text-neutral-600 dark:text-neutral-400" />
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Add AI Integration */}
              <Card className="h-18 flex-1 bg-white dark:bg-[#363636] dark:hover:bg-transparent rounded-lg border border-gray-200 dark:border-neutral-700 shadow-[0px_1px_3px_0px_rgba(0,0,0,0.1)] hover:shadow-md transition-shadow cursor-pointer">
                <CardContent className="py-6 px-8" onClick={() => handleNavigateTo('ai')}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <Box className="w-5 h-5 text-neutral-600 dark:text-neutral-400" />
                      <p className="text-base font-medium text-neutral-900 dark:text-white">
                        Add AI Integration
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <OpenAI className="w-5 h-5 fill-black dark:fill-white" />
                      <img src={Gemini} alt="Gemini" className="w-5 h-5" />
                      <img src={Claude} alt="Claude" className="w-5 h-5" />
                      <Grok className="w-5 h-5 fill-black dark:fill-white" />
                      <ChevronRight className="w-5 h-5 text-neutral-600 dark:text-neutral-400" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
