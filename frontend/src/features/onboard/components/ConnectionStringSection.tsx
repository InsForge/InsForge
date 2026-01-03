import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { CopyButton, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components';
import { ShowPasswordButton } from './ShowPasswordButton';
import { useDatabaseConnectionString, useDatabasePassword } from '@/lib/hooks/useMetadata';
import { cn } from '@/lib/utils/utils';

interface ParameterRowProps {
  label: string;
  value: string | number | undefined;
  copyValue?: string;
}

const RESET_TIMEOUT_MS = 2000;

function ParameterRow({ label, value, copyValue }: ParameterRowProps) {
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const textToCopy = copyValue ?? String(value ?? '');
  const displayValue = value ?? '-';
  const hasCopyableValue = value !== undefined && value !== null && value !== '';

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const handleCopy = useCallback(() => {
    if (!hasCopyableValue) {
      return;
    }

    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    navigator.clipboard
      .writeText(textToCopy)
      .then(() => {
        setCopied(true);
        timeoutRef.current = setTimeout(() => {
          setCopied(false);
          timeoutRef.current = null;
        }, RESET_TIMEOUT_MS);
      })
      .catch((error) => {
        console.error('Failed to copy to clipboard:', error);
      });
  }, [hasCopyableValue, textToCopy]);

  return (
    <div className="group flex items-center gap-2">
      <span className="text-gray-400 dark:text-neutral-500 text-sm">{label}:</span>
      <TooltipProvider>
        <Tooltip open={copied}>
          <TooltipTrigger asChild>
            <button
              type="button"
              className={cn(
                'text-gray-700 dark:text-neutral-300 text-sm',
                hasCopyableValue &&
                  'cursor-pointer hover:text-gray-900 dark:hover:text-neutral-100 transition-colors'
              )}
              disabled={!hasCopyableValue}
              aria-label={`Copy ${label}`}
              onClick={handleCopy}
            >
              {displayValue}
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={4}>
            <p className="font-medium text-xs leading-5">Copied</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      {hasCopyableValue && (
        <CopyButton
          text={textToCopy}
          showText={false}
          className="h-5 w-5 p-0.5 bg-transparent hover:bg-gray-200 dark:hover:bg-neutral-700 border-none rounded min-w-0 opacity-0 group-hover:opacity-100 transition-opacity"
        />
      )}
    </div>
  );
}

interface ConnectionStringSectionProps {
  className?: string;
}

export function ConnectionStringSection({ className }: ConnectionStringSectionProps) {
  const [showConnectionPassword, setShowConnectionPassword] = useState(false);
  const [showParamsPassword, setShowParamsPassword] = useState(false);

  const { connectionData, isLoading: isConnectionLoading } = useDatabaseConnectionString();
  const { passwordData } = useDatabasePassword();

  const dbParams = connectionData?.parameters;
  const dbPassword = passwordData?.databasePassword || '';
  const maskedPassword = dbParams?.password || '********';

  const connectionStringDisplay = useMemo(() => {
    if (!connectionData?.connectionURL) {
      return '';
    }
    if (showConnectionPassword && dbPassword) {
      return connectionData.connectionURL.replace('********', dbPassword);
    }
    return connectionData.connectionURL;
  }, [connectionData?.connectionURL, showConnectionPassword, dbPassword]);

  const connectionStringClipboard = useMemo(() => {
    if (!connectionData?.connectionURL || !dbPassword) {
      return connectionData?.connectionURL || '';
    }
    return connectionData.connectionURL.replace('********', dbPassword);
  }, [connectionData?.connectionURL, dbPassword]);

  return (
    <div className={cn('flex flex-col gap-6', isConnectionLoading && 'animate-pulse', className)}>
      <p className="text-gray-500 dark:text-neutral-400 text-base leading-7">
        Ideal for applications with persistent and long-lived connections, such as those running on
        virtual machines or long-standing containers.
      </p>

      {/* Connection String */}
      <div className="bg-gray-100 dark:bg-neutral-900 rounded p-3">
        <div className="flex items-center justify-between mb-2">
          <div className="bg-gray-200 dark:bg-neutral-700 rounded px-2 h-5 flex items-center justify-center">
            <span className="text-gray-700 dark:text-neutral-50 text-xs">connection string</span>
          </div>
          <div className="flex items-center gap-2">
            <ShowPasswordButton
              show={showConnectionPassword}
              onToggle={() => setShowConnectionPassword(!showConnectionPassword)}
            />
            <CopyButton
              text={connectionStringClipboard}
              showText={false}
              className="h-6 w-6 p-1 bg-white dark:bg-neutral-800 hover:bg-gray-200 dark:hover:bg-neutral-700 border-none rounded-md shadow-sm min-w-0 text-black dark:text-white"
            />
          </div>
        </div>
        <p className="text-gray-700 dark:text-neutral-300 text-sm leading-6 break-words">
          {connectionStringDisplay || 'Loading...'}
        </p>
      </div>

      <div className="h-px bg-gray-200 dark:bg-neutral-700" />

      {/* Parameters */}
      <div className="bg-gray-100 dark:bg-neutral-900 rounded p-3">
        <div className="flex items-center justify-between mb-4">
          <div className="bg-gray-200 dark:bg-neutral-700 rounded px-2 h-5 flex items-center justify-center">
            <span className="text-gray-700 dark:text-neutral-50 text-xs">parameters</span>
          </div>
          <ShowPasswordButton
            show={showParamsPassword}
            onToggle={() => setShowParamsPassword(!showParamsPassword)}
          />
        </div>
        <div className="flex flex-col gap-3">
          <ParameterRow label="HOST" value={dbParams?.host} />
          <ParameterRow label="DATABASE" value={dbParams?.database} />
          <ParameterRow label="USER" value={dbParams?.user} />
          <ParameterRow label="PORT" value={dbParams?.port} />
          <ParameterRow
            label="PASSWORD"
            value={showParamsPassword ? dbPassword || maskedPassword : maskedPassword}
            copyValue={dbPassword || maskedPassword}
          />
          <ParameterRow label="SSL" value={dbParams?.sslmode} />
        </div>
      </div>
    </div>
  );
}
