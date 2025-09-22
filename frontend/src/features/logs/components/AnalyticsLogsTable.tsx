import React, { useState } from 'react';
import { Clock, ChevronRight, ChevronDown, ArrowDown } from 'lucide-react';
import { AnalyticsLogRecord } from '@/features/logs/services/log.service';
import { Badge } from '@/components/radix/Badge';
import { JsonHighlight } from '@/components/JsonHighlight';
import { cn } from '@/lib/utils/utils';

interface AnalyticsLogsTableProps {
  logs: AnalyticsLogRecord[];
  loading: boolean;
  source: string;
  onRefresh: () => void;
  showSource?: boolean;
  onScroll: (e: React.UIEvent<HTMLDivElement>) => void;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  hasMore: boolean;
  isLoadingMore: boolean;
  autoRefresh: boolean;
  onScrollToBottom: () => void;
}

export function AnalyticsLogsTable({
  logs,
  loading,
  source,
  onRefresh: _onRefresh,
  showSource = false,
  onScroll,
  scrollRef,
  hasMore,
  isLoadingMore,
  autoRefresh,
  onScrollToBottom,
}: AnalyticsLogsTableProps) {
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    const months = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ];
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    const weekday = days[date.getDay()];
    const month = months[date.getMonth()];
    const day = date.getDate();
    const year = date.getFullYear();
    const time = date.toLocaleTimeString('en-US', { hour12: false });

    return `${weekday} ${month} ${day} ${year} ${time}`;
  };

  const toggleRowExpansion = (id: string) => {
    const newExpanded = new Set(expandedRows);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    setExpandedRows(newExpanded);
  };

  const getStatusCodeColor = (statusCode?: number) => {
    if (!statusCode) {
      return 'text-gray-600';
    }
    if (statusCode >= 200 && statusCode < 300) {
      return 'text-green-600';
    }
    if (statusCode >= 400 && statusCode < 500) {
      return 'text-yellow-600';
    }
    if (statusCode >= 500) {
      return 'text-red-600';
    }
    return 'text-gray-600';
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 dark:border-blue-400 mx-auto mb-4" />
          <p className="text-sm text-gray-500 dark:text-zinc-400">Loading logs...</p>
        </div>
      </div>
    );
  }

  if (!logs?.length) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <Clock className="mx-auto h-12 w-12 text-gray-400 mb-4" />
          <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">No Logs Found</h3>
          <p className="text-sm text-gray-500 dark:text-zinc-400">
            {source === 'search'
              ? 'No logs match your search criteria'
              : `No logs available for ${source}`}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-white dark:bg-neutral-800">
      {/* Status bar */}
      <div className="px-4 py-2 bg-gray-50 dark:bg-neutral-800 border-b text-xs text-gray-600 dark:text-zinc-400 flex justify-between items-center">
        <div className="flex items-center space-x-4">
          <span className="text-zinc-900 dark:text-zinc-400">{logs.length} logs loaded</span>
          {hasMore && (
            <div className="flex items-center space-x-2">
              <button
                onClick={onScrollToBottom}
                className="flex items-center space-x-1 text-blue-600 dark:text-blue-400 hover:text-blue-800 hover:bg-blue-300 dark:hover:bg-blue-600/50 px-2 py-1 rounded transition-colors"
                title="Go to bottom"
              >
                <ArrowDown className="h-3 w-3 text-zinc-900 dark:text-zinc-400" />
                <span>Go to bottom</span>
              </button>
              <span className="text-zinc-900 dark:text-zinc-400">•</span>
              <span className="text-blue-600 dark:text-blue-400">Scroll up to load older logs</span>
            </div>
          )}
          {autoRefresh && (
            <span className="text-green-600 dark:text-green-400 flex items-center">
              <div className="w-2 h-2 bg-green-500 rounded-full mr-1 animate-pulse" />
              Auto-refreshing
            </span>
          )}
        </div>
        {isLoadingMore && (
          <span className="text-gray-500 dark:text-zinc-400">Loading older logs...</span>
        )}
      </div>

      {/* Logs List - Scrollable with infinite scroll */}
      <div ref={scrollRef} className="flex-1 overflow-auto" onScroll={onScroll}>
        <div className="font-mono text-sm">
          {/* Loading indicator at top for older logs */}
          {isLoadingMore && (
            <div className="px-4 py-2 text-center text-gray-500 dark:text-zinc-400 text-xs bg-gray-50 dark:bg-neutral-700 border-b dark:border-neutral-700">
              <div className="inline-flex items-center">
                <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-gray-400 dark:border-gray-400 mr-2" />
                Loading older logs...
              </div>
            </div>
          )}

          {logs.map((log, index) => {
            const uniqueKey = `${log.id}-${log.timestamp}-${index}`;
            const isExpanded = expandedRows.has(log.id);
            const hasDetails = log.body && Object.keys(log.body).length > 0;

            return (
              <div
                key={uniqueKey}
                className="border-b border-gray-100 dark:border-neutral-700 hover:bg-gray-50 dark:hover:bg-neutral-700 dark:hover:text-white"
              >
                <div
                  className={cn(
                    'flex items-start px-4 py-2',
                    hasDetails ? 'cursor-pointer' : 'cursor-default'
                  )}
                  onClick={() => hasDetails && toggleRowExpansion(log.id)}
                >
                  {/* Timestamp column - gray background */}
                  <div className="flex-shrink-0 w-48 bg-gray-100 dark:bg-neutral-600 px-3 py-1 rounded mr-3 text-gray-700 dark:text-white text-xs">
                    {formatTimestamp(log.timestamp)}
                  </div>

                  {/* Message content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center space-x-2">
                      {/* Expand/collapse icon */}
                      {hasDetails && (
                        <div className="flex-shrink-0">
                          {isExpanded ? (
                            <ChevronDown className="h-3 w-3 text-zinc-900 dark:text-zinc-400" />
                          ) : (
                            <ChevronRight className="h-3 w-3 text-zinc-900 dark:text-zinc-400" />
                          )}
                        </div>
                      )}

                      {/* Log message */}
                      <span className="text-gray-900 dark:text-white break-all">
                        {log.event_message}
                      </span>

                      {/* Status code badge */}
                      {log.body?.status_code && (
                        <Badge
                          variant="outline"
                          className={cn(
                            'text-xs border-0',
                            getStatusCodeColor(log.body.status_code)
                          )}
                        >
                          {log.body.status_code}
                        </Badge>
                      )}

                      {/* Source name for search results */}
                      {showSource && log.source && (
                        <span className="text-blue-600 dark:text-blue-400 text-xs font-medium bg-blue-50 dark:bg-blue-900 px-2 py-1 rounded">
                          {log.source}
                        </span>
                      )}

                      {/* Duration */}
                      {log.body?.duration && (
                        <span className="text-gray-600 dark:text-zinc-400 text-xs bg-gray-50 dark:bg-neutral-700 px-2 py-1 rounded">
                          {log.body.duration}
                        </span>
                      )}

                      {/* Size */}
                      {log.body?.size && (
                        <span className="text-gray-500 dark:text-zinc-400 text-xs">
                          {log.body.size}b
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Expanded details */}
                {isExpanded && hasDetails && (
                  <div className="px-4 pb-3 bg-gray-50 dark:bg-neutral-800 dark:hover:bg-neutral-700 border-t border-gray-200 dark:border-neutral-700">
                    <div className="ml-48 pl-3">
                      {/* Request details */}
                      {log.body?.log_type === 'request' && (
                        <div className="space-y-1 text-xs text-gray-600 dark:text-zinc-400 mb-3">
                          {log.body.ip && (
                            <div>
                              <span className="font-medium text-gray-700 dark:text-white">IP:</span>{' '}
                              {log.body.ip}
                            </div>
                          )}
                          {log.body.user_agent && (
                            <div>
                              <span className="font-medium text-gray-700 dark:text-white">
                                User Agent:
                              </span>{' '}
                              {log.body.user_agent}
                            </div>
                          )}
                          {log.body.path && (
                            <div>
                              <span className="font-medium text-gray-700 dark:text-white">
                                Path:
                              </span>{' '}
                              {log.body.path}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Error details */}
                      {log.body?.error && (
                        <div className="mb-3 p-2 bg-red-50 dark:bg-red-900 border border-red-200 dark:border-red-800 rounded text-xs">
                          <div className="text-red-800 dark:text-red-200 font-medium mb-1">
                            Error:
                          </div>
                          <div className="text-red-700 dark:text-red-300">{log.body.error}</div>
                          {log.body.stack && (
                            <pre className="mt-2 text-red-600 dark:text-red-400 text-xs whitespace-pre-wrap overflow-x-auto">
                              {log.body.stack}
                            </pre>
                          )}
                        </div>
                      )}

                      {/* Full JSON body */}
                      <details className="text-xs">
                        <summary className="cursor-pointer text-zinc-600 dark:text-zinc-400 hover:text-zinc-800 font-medium mb-2">
                          Event Body
                        </summary>
                        <div className="bg-white dark:bg-neutral-700 p-2 rounded border overflow-x-auto">
                          <JsonHighlight json={JSON.stringify(log.body, null, 2)} />
                        </div>
                      </details>
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {/* End indicator */}
          {!hasMore && logs.length > 0 && (
            <div className="px-4 py-3 text-center text-gray-500 dark:text-zinc-400 text-xs bg-gray-50 dark:bg-neutral-700">
              No more logs to load
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
