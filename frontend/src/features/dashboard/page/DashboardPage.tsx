import { useLocation, useNavigate } from 'react-router-dom';
import { useMetadata } from '@/lib/hooks/useMetadata';
import { useUsers } from '@/features/auth';
import { Users, Database, HardDrive } from 'lucide-react';
import { ConnectionSuccessBanner, StatsCard } from '../components';
import { useMcpUsage } from '@/features/logs/hooks/useMcpUsage';
import { LogsTable, LogsTableColumn } from '@/features/logs/components/LogsTable';
import { format } from 'date-fns';

interface McpUsageRecord {
  tool_name: string;
  created_at: string;
}

export default function DashboardPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { metadata, auth, tables, storage, isLoading } = useMetadata();
  const { totalUsers } = useUsers();
  const { records } = useMcpUsage();

  const authCount = auth?.oauths.length || 0;
  const showBanner = location.state?.showSuccessBanner === true;

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    return format(date, 'MMM dd, yyyy h:mm a');
  };

  const mcpColumns: LogsTableColumn<McpUsageRecord>[] = [
    {
      key: 'tool_name',
      label: 'MCP Call',
      render: (row) => (
        <p className="text-sm text-gray-900 dark:text-white font-normal leading-6">
          {row.tool_name}
        </p>
      ),
    },
    {
      key: 'created_at',
      label: 'Time',
      width: '216px',
      render: (row) => (
        <p className="text-sm text-gray-900 dark:text-white font-normal leading-6">
          {formatTime(row.created_at)}
        </p>
      ),
    },
  ];

  const handleViewMoreClick = () => {
    localStorage.setItem('selectedLogSource', 'MCP');
    const isCloudRoute = location.pathname.startsWith('/cloud');
    void navigate(isCloudRoute ? '/cloud/logs' : '/dashboard/logs');
  };

  return (
    <main className="h-full bg-white dark:bg-neutral-800 overflow-y-auto">
      <div className="flex flex-col gap-6 w-full max-w-[1080px] mx-auto pt-6 h-full">
        {/* Connection Success Banner - Only shows once on first connection */}
        {showBanner && <ConnectionSuccessBanner />}

        {/* Dashboard Header */}
        <div className="flex items-center justify-between w-full">
          <h1 className="text-xl font-semibold text-gray-900 dark:text-white tracking-[-0.1px]">
            Dashboard
          </h1>
        </div>

        {/* Stats Cards */}
        <div className="flex gap-6 w-full max-h-[280px] h-full grow">
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
            description={`${tables.length || 0} ${tables.length === 1 ? 'Table' : 'Tables'}`}
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

        <div className="flex items-center justify-between w-full">
          <p className="text-xl font-semibold text-gray-900 dark:text-white tracking-[-0.1px]">
            MCP Call Records
          </p>
          <button
            onClick={handleViewMoreClick}
            className="flex items-center gap-2 px-3 py-2 text-sm text-white font-medium hover:bg-neutral-700 rounded-lg transition-colors"
          >
            View More
          </button>
        </div>

        {/* MCP Call Record Table */}
        <div className="w-full rounded-[8px] overflow-hidden shadow-sm">
          <LogsTable
            columns={mcpColumns}
            data={records.slice(0, 5)}
            emptyMessage="No MCP call records found"
          />
        </div>

        <div className="h-8 flex-shrink-0" />
      </div>
    </main>
  );
}
