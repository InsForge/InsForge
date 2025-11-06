import { LogsContent } from '@/features/logs/components/LogsContent';
import { EmptyState } from '@/components/EmptyState';
import { useParams } from 'react-router-dom';

export default function LogsPage() {
  // Get the source from the URL params (e.g., /dashboard/logs/MCP)
  const { source } = useParams<{ source?: string }>();

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-bg-gray dark:bg-neutral-800">
      {!source ? (
        <div className="flex-1 flex items-center justify-center">
          <EmptyState
            title="No Log Source Selected"
            description="Select a log source from the sidebar to view logs"
          />
        </div>
      ) : (
        <LogsContent source={source} />
      )}
    </div>
  );
}
