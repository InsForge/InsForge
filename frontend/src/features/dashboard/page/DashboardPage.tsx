import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useMetadata } from '@/lib/hooks/useMetadata';
import { useUsers } from '@/features/auth';
import { Users, Database, HardDrive, Lock, ChevronRight } from 'lucide-react';
import { ConnectionSuccessBanner, StatsCard, PromptCard, PromptDialog } from '../components';
import { useMcpUsage } from '@/features/logs/hooks/useMcpUsage';
import { LogsDataGrid, type LogsColumnDef } from '@/features/logs/components/LogsDataGrid';
import { cn, formatTime } from '@/lib/utils/utils';
import { Button } from '@/components';
import { quickStartPrompts, type PromptTemplate } from '../prompts';

export default function DashboardPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [selectedPrompt, setSelectedPrompt] = useState<PromptTemplate | null>(null);
  const [promptDialogOpen, setPromptDialogOpen] = useState(false);
  const { metadata, auth, tables, storage, isLoading } = useMetadata();
  const { totalUsers } = useUsers();
  const { records } = useMcpUsage();

  const authCount = auth?.oauths.length ?? 0;
  const tableCount = tables?.length ?? 0;
  const showBanner = location.state?.showSuccessBanner === true;

  const mcpColumns: LogsColumnDef[] = [
    {
      key: 'tool_name',
      name: 'MCP Call',
      width: '12fr',
      renderCell: ({ row }) => (
        <p className="text-sm font-normal leading-6">{String(row.tool_name ?? '')}</p>
      ),
    },
    {
      key: 'created_at',
      name: 'Time',
      width: 'minmax(200px, 1fr)',
      renderCell: ({ row }) => (
        <p className="text-sm font-normal leading-6">{formatTime(String(row.created_at ?? ''))}</p>
      ),
    },
  ];

  const handleViewMoreClick = () => {
    void navigate('/dashboard/logs/MCP');
  };

  return (
    <main className="h-full overflow-y-auto">
      <div className="flex flex-col gap-16 w-full max-w-[1080px] mx-auto pt-6 pb-8">
        <div className="flex flex-col gap-6">
          {/* Connection Success Banner - Only shows once on first connection */}
          {showBanner && <ConnectionSuccessBanner />}
          <h1 className="text-xl font-semibold tracking-[-0.1px]">Dashboard</h1>

          {/* Stats Section */}
          <section className="flex flex-col gap-6 w-full">
            <div className="flex gap-6 w-full h-[176px]">
              <StatsCard
                icon={Users}
                title="AUTH"
                value={(totalUsers || 0).toLocaleString()}
                unit={totalUsers === 1 ? 'user' : 'users'}
                description={`${authCount} OAuth ${authCount === 1 ? 'provider' : 'providers'} enabled`}
                isLoading={isLoading}
              />

              <StatsCard
                icon={Database}
                title="Database"
                value={(metadata?.database?.totalSizeInGB || 0).toFixed(2)}
                unit="GB"
                description={`${tableCount} ${tableCount === 1 ? 'Table' : 'Tables'}`}
                isLoading={isLoading}
              />

              <StatsCard
                icon={HardDrive}
                title="Storage"
                value={(storage?.totalSizeInGB || 0).toFixed(2)}
                unit="GB"
                description={`${storage?.buckets?.length || 0} ${storage?.buckets?.length === 1 ? 'Bucket' : 'Buckets'}`}
                isLoading={isLoading}
              />
            </div>
          </section>
        </div>

        {/* Quick Start Prompt Section */}
        <section className="flex flex-col gap-6 w-full">
          <div className="flex flex-col gap-1 w-full">
            <h2 className="text-xl font-semibold tracking-[-0.1px]">Quick Start Prompt</h2>
            <p className="text-sm text-light-mode-text dark:text-dark-mode-text leading-6">
              Paste the prompts below into your agent to quickly start building real apps.
            </p>
          </div>

          <div className="grid grid-cols-3 gap-6 w-full">
            {quickStartPrompts.map((prompt, index) => (
              <PromptCard
                key={index}
                title={prompt.title}
                onClick={() => {
                  setSelectedPrompt(prompt);
                  setPromptDialogOpen(true);
                }}
              />
            ))}
          </div>

          <PromptDialog
            open={promptDialogOpen}
            onOpenChange={setPromptDialogOpen}
            promptTemplate={selectedPrompt}
          />
        </section>

        {/* Templates & Components Section */}
        <section className="flex flex-col gap-6 w-full">
          <div className="flex flex-col gap-1 w-full">
            <h2 className="text-xl font-semibold tracking-[-0.1px]">Explore Our Platform</h2>
            <p className="text-sm text-light-mode-text dark:text-dark-mode-text leading-6">
              InsForge gives you every backend feature you need. Use the whole platform or just the
              features you want.
            </p>
          </div>

          <div className="flex gap-6 w-full">
            {/* Sign-in Component Card */}
            <button
              onClick={() => void navigate('/dashboard/authentication/auth-methods')}
              className="flex-1 bg-light-mode-card dark:bg-dark-mode-card border border-light-mode-border dark:border-dark-mode-border rounded-lg p-4 flex items-center gap-3 hover:bg-light-mode-background hover:border-light-mode-border-hover dark:hover:bg-dark-mode-secondary dark:hover:border-dark-mode-border-hover hover:shadow-sm transition-all group"
            >
              <div className="flex-1 flex items-center gap-4">
                <div className="bg-light-mode-secondary dark:bg-dark-mode-background rounded p-3.5 flex items-center justify-center shrink-0">
                  <Lock className="w-6 h-6 text-light-mode-icon dark:text-dark-mode-icon" />
                </div>
                <div className="flex flex-col gap-1 items-start text-left">
                  <p className="text-base font-normal leading-6">Authentication</p>
                  <p className="text-sm text-light-mode-text dark:text-dark-mode-text leading-6">
                    User Authentication and management
                  </p>
                </div>
              </div>
              <ChevronRight className="w-5 h-5 text-light-mode-icon dark:text-dark-mode-text shrink-0 group-hover:translate-x-0.5 transition-transform" />
            </button>

            {/* Database Templates Card */}
            <button
              onClick={() => void navigate('/dashboard/database/templates')}
              className="flex-1 bg-light-mode-card dark:bg-dark-mode-card border border-light-mode-border dark:border-dark-mode-border rounded-lg p-4 flex items-center gap-3 hover:bg-light-mode-background hover:border-light-mode-border-hover dark:hover:bg-dark-mode-secondary dark:hover:border-dark-mode-border-hover hover:shadow-sm transition-all group"
            >
              <div className="flex-1 flex items-center gap-4">
                <div className="bg-light-mode-secondary dark:bg-dark-mode-background rounded p-3.5 flex items-center justify-center shrink-0">
                  <Database className="w-6 h-6 text-light-mode-icon dark:text-dark-mode-icon" />
                </div>
                <div className="flex flex-col gap-1 items-start text-left">
                  <p className="text-base   font-normal leading-6">Database</p>
                  <p className="text-sm text-light-mode-text dark:text-dark-mode-text leading-6">
                    Manage your tables and data
                  </p>
                </div>
              </div>
              <ChevronRight className="w-5 h-5 text-light-mode-icon dark:text-dark-mode-text shrink-0 group-hover:translate-x-0.5 transition-transform" />
            </button>
          </div>
        </section>

        {/* MCP Call Records Section */}
        <section className="flex flex-col gap-6 w-full">
          <div className="flex items-center justify-between w-full">
            <p className="text-xl font-semibold ">MCP Call Records</p>
            <Button
              onClick={handleViewMoreClick}
              className="h-8 px-4 font-medium dark:bg-primary-emerald"
            >
              View More
            </Button>
          </div>

          <div className={cn('w-full overflow-hidden', !records.length && 'h-60')}>
            <LogsDataGrid
              columnDefs={mcpColumns}
              data={records.slice(0, 5)}
              emptyState={
                <div className="h-20 text-sm text-light-mode-text dark:text-dark-mode-text">
                  No MCP call records found
                </div>
              }
              noPadding
            />
          </div>
        </section>
      </div>
    </main>
  );
}
