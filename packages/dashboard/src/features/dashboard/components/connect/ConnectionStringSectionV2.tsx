import { useMemo, useState } from 'react';
import { CopyButton } from '@insforge/ui';
import { ShowPasswordButton } from './ShowPasswordButton';
import {
  useDatabaseConnectionString,
  useDatabasePassword,
} from '../../../../lib/hooks/useMetadata';
import { cn } from '../../../../lib/utils/utils';

interface ConnectionParameter {
  label: string;
  value: string | number | undefined;
}

interface ConnectionStringSectionV2Props {
  className?: string;
  /** Layout orientation. 'horizontal' (default) places title column beside content. 'vertical' stacks title above content. */
  variant?: 'horizontal' | 'vertical';
}

function formatParameterValue(value: string | number | undefined) {
  if (value === undefined || value === null || value === '') {
    return '-';
  }
  return String(value);
}

export function ConnectionStringSectionV2({
  className,
  variant = 'horizontal',
}: ConnectionStringSectionV2Props) {
  const [showConnectionPassword, setShowConnectionPassword] = useState(false);
  const [showParamsPassword, setShowParamsPassword] = useState(false);

  const { connectionData, isLoading: isConnectionLoading } = useDatabaseConnectionString();
  const { passwordData } = useDatabasePassword();

  const dbParams = connectionData?.parameters;
  const dbPassword = passwordData?.databasePassword || '';
  const maskedPassword = dbParams?.password || '*******';

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

  const parameters = useMemo<ConnectionParameter[]>(() => {
    return [
      { label: 'HOST', value: dbParams?.host },
      { label: 'DATABASE', value: dbParams?.database },
      { label: 'USER', value: dbParams?.user },
      { label: 'PORT', value: dbParams?.port },
      {
        label: 'PASSWORD',
        value: showParamsPassword ? dbPassword || maskedPassword : maskedPassword,
      },
      { label: 'SSL', value: dbParams?.sslmode },
    ];
  }, [
    dbParams?.host,
    dbParams?.database,
    dbParams?.user,
    dbParams?.port,
    dbParams?.sslmode,
    dbPassword,
    maskedPassword,
    showParamsPassword,
  ]);

  const isVertical = variant === 'vertical';

  return (
    <div
      className={cn(
        'flex gap-6',
        isVertical ? 'flex-col' : 'flex-row',
        isConnectionLoading && 'animate-pulse',
        className
      )}
    >
      <div
        className={cn('flex flex-col gap-1', isVertical ? 'w-full' : 'w-[240px] shrink-0 gap-2')}
      >
        <p
          className={cn(
            'font-medium leading-7 text-foreground',
            isVertical ? 'text-base' : 'text-sm leading-6'
          )}
        >
          Connection String
        </p>
        <p className="text-sm leading-5 text-muted-foreground">
          Copy the connection details for your database.
        </p>
      </div>
      <div className="flex flex-1 flex-col gap-3">
        <div className="flex flex-col gap-2 rounded border border-[var(--alpha-8)] bg-semantic-0 p-3">
          <div className="flex items-center justify-between">
            <div className="flex h-5 items-center justify-center rounded bg-[var(--alpha-8)] px-2">
              <span className="text-xs font-medium leading-4 text-muted-foreground">
                connection string
              </span>
            </div>
            <div className="flex items-center gap-[5px]">
              <ShowPasswordButton
                show={showConnectionPassword}
                onToggle={() => setShowConnectionPassword(!showConnectionPassword)}
              />
              <CopyButton text={connectionStringClipboard} showText={false} />
            </div>
          </div>
          <p className="break-all font-mono text-sm leading-6 text-foreground">
            {connectionStringDisplay || 'Loading...'}
          </p>
        </div>

        <div className="flex flex-col gap-2 rounded border border-[var(--alpha-8)] bg-semantic-0 p-3">
          <div className="flex items-center justify-between">
            <div className="flex h-5 items-center justify-center rounded bg-[var(--alpha-8)] px-2">
              <span className="text-xs font-medium leading-4 text-muted-foreground">
                parameters
              </span>
            </div>
            <div className="flex items-center gap-[5px]">
              <ShowPasswordButton
                show={showParamsPassword}
                onToggle={() => setShowParamsPassword(!showParamsPassword)}
              />
              <CopyButton
                text={parameters
                  .map(({ label, value }) => `${label}: ${formatParameterValue(value)}`)
                  .join('\n')}
                showText={false}
              />
            </div>
          </div>
          <div className="flex flex-col gap-1 font-mono text-sm leading-5">
            {parameters.map(({ label, value }) => (
              <p key={label} className="break-all text-foreground">
                <span className="text-muted-foreground">{label}: </span>
                <span>{formatParameterValue(value)}</span>
              </p>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
