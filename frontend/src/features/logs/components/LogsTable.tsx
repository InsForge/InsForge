import React, { useState, useMemo } from 'react';
import { ChevronRight, ChevronDown } from 'lucide-react';
import { Button } from '@/components/radix/Button';
import { Badge } from '@/components/radix/Badge';
import { PaginationControls } from '@/components/PaginationControls';
import { LogEntry } from '../services/logs.service';

interface LogsTableProps {
  logs: LogEntry[];
  schema?: any;
  loading?: boolean;
  searchQuery?: string;
  onRefresh?: () => void;
  onConfirm?: (options: {
    title: string;
    description: string;
    confirmText?: string;
    destructive?: boolean;
  }) => Promise<boolean>;
  currentPage?: number;
  totalRecords?: number;
  pageSize?: number;
  onPageChange?: (page: number) => void;
}

export function LogsTable({
  logs,
  loading,
  searchQuery = '',
  currentPage = 1,
  totalRecords = 0,
  pageSize = 50,
  onPageChange,
}: LogsTableProps) {
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  // Filter logs based on search (client-side filtering on current page)
  const filteredLogs = useMemo(() => {
    if (!searchQuery || !logs) {
      return logs || [];
    }

    const lowerQuery = searchQuery.toLowerCase();
    return logs.filter(
      (log) =>
        log.action?.toLowerCase().includes(lowerQuery) ||
        log.table_name?.toLowerCase().includes(lowerQuery) ||
        log.record_id?.toString().toLowerCase().includes(lowerQuery) ||
        log.details?.toLowerCase().includes(lowerQuery)
    );
  }, [logs, searchQuery]);

  // Calculate total pages
  const totalPages = Math.ceil(totalRecords / pageSize);

  const toggleRowExpansion = (id: string) => {
    const newExpanded = new Set(expandedRows);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    setExpandedRows(newExpanded);
  };

  // Logs are audit records and should not be individually deletable
  // They can only be cleared in bulk by admins if needed

  const getActionBadge = (action: string) => {
    const actionMap: Record<string, { variant: any; label: string }> = {
      INSERT: { variant: 'default', label: 'Create' },
      UPDATE: { variant: 'secondary', label: 'Update' },
      DELETE: { variant: 'destructive', label: 'Delete' },
    };

    const config = actionMap[action] || { variant: 'outline', label: action };

    return (
      <Badge variant={config.variant} className="text-xs">
        {config.label}
      </Badge>
    );
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-gray-500">Loading logs...</div>
      </div>
    );
  }

  return (
    <div className="relative flex-1 flex flex-col overflow-hidden">
      <div className="flex-1 overflow-auto relative">
        <table className="w-full bg-white">
          <thead className="sticky top-0 z-20">
            <tr className="h-12.5 bg-gray-50 border-b border-gray-200">
              <th className="px-4 text-left text-[13px] font-semibold text-gray-600 min-w-45">
                Time
              </th>
              <th className="px-4 text-left text-[13px] font-semibold text-gray-600 min-w-25">
                Action
              </th>
              <th className="px-4 text-left text-[13px] font-semibold text-gray-600 min-w-37.5">
                Table
              </th>
              <th className="px-4 text-left text-[13px] font-semibold text-gray-600 min-w-50">
                Record ID
              </th>
              <th className="px-4 text-left text-[13px] font-semibold text-gray-600 min-w-37.5">
                Details
              </th>
            </tr>
          </thead>
          <tbody>
            {filteredLogs.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-12 text-center text-gray-500">
                  {searchQuery ? 'No logs found matching your search' : 'No activity logs yet'}
                </td>
              </tr>
            ) : (
              filteredLogs.map((log) => {
                const isExpanded = expandedRows.has(String(log.id));
                let details = null;

                try {
                  details = log.details ? JSON.parse(log.details) : null;
                } catch (e) {
                  details = log.details;
                }

                return (
                  <React.Fragment key={log.id}>
                    <tr className="h-14 border-b border-gray-100 transition-colors hover:bg-gray-50/50">
                      <td className="px-4 text-[13px] text-gray-600">
                        {formatDate(log.created_at)}
                      </td>
                      <td className="px-4">{getActionBadge(log.action)}</td>
                      <td className="px-4 text-sm font-medium text-gray-800">{log.table_name}</td>
                      <td className="px-4">
                        <span className="font-mono text-[13px] text-gray-500">
                          {log.record_id || '-'}
                        </span>
                      </td>
                      <td className="px-4">
                        {details && typeof details === 'object' ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => toggleRowExpansion(String(log.id))}
                            className="h-8 px-3 text-[13px]"
                          >
                            {isExpanded ? (
                              <ChevronDown className="h-3.5 w-3.5 mr-1" />
                            ) : (
                              <ChevronRight className="h-3.5 w-3.5 mr-1" />
                            )}
                            View Details
                          </Button>
                        ) : (
                          <span className="text-[13px] text-gray-500">{details || '-'}</span>
                        )}
                      </td>
                    </tr>
                    {isExpanded && details && typeof details === 'object' && (
                      <tr>
                        <td colSpan={5} className="px-4 py-3 bg-gray-50 border-b border-gray-100">
                          <pre className="text-xs text-gray-700 whitespace-pre-wrap font-mono bg-white p-3 rounded border border-border-gray">
                            {JSON.stringify(details, null, 2)}
                          </pre>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {!loading && totalRecords > pageSize && (
        <PaginationControls
          currentPage={currentPage}
          totalPages={totalPages}
          totalRecords={totalRecords}
          pageSize={pageSize}
          onPageChange={onPageChange}
          recordLabel="logs"
        />
      )}
    </div>
  );
}
