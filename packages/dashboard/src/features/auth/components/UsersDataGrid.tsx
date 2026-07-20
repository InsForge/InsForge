import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyRound, Mail, User } from 'lucide-react';
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  DataGrid,
  type DataGridColumn,
  type DataGridProps,
  type RenderCellProps,
  type SelectionCellProps,
} from '#components';
import AppleLogo from '#assets/logos/apple.svg?react';
import DiscordLogo from '#assets/logos/discord.svg?react';
import FacebookLogo from '#assets/logos/facebook.svg?react';
import GithubLogo from '#assets/logos/github.svg?react';
import GoogleLogo from '#assets/logos/google.svg?react';
import InstagramLogo from '#assets/logos/instagram.svg?react';
import LinkedinLogo from '#assets/logos/linkedin.svg?react';
import MicrosoftLogo from '#assets/logos/microsoft.svg?react';
import SpotifyLogo from '#assets/logos/spotify.svg?react';
import TiktokLogo from '#assets/logos/tiktok.svg?react';
import XLogo from '#assets/logos/x.svg?react';
import {
  Badge,
  Checkbox,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  cn,
} from '@insforge/ui';
import { formatTime } from '#lib/utils/utils';
import type { UserSchema } from '@insforge/shared-schemas';
import { useCustomOAuthConfig } from '#features/auth/hooks/useCustomOAuthConfig';

type UserDataGridRow = UserSchema & {
  [key: string]: string | number | boolean | null | string[] | Record<string, unknown>;
};

const providerLabelMap: Record<string, string> = {
  google: 'Google',
  github: 'GitHub',
  discord: 'Discord',
  linkedin: 'LinkedIn',
  facebook: 'Facebook',
  instagram: 'Instagram',
  apple: 'Apple',
  x: 'X',
  spotify: 'Spotify',
  tiktok: 'TikTok',
  microsoft: 'Microsoft',
  email: 'Email',
};

const providerLogoMap = {
  google: GoogleLogo,
  github: GithubLogo,
  discord: DiscordLogo,
  linkedin: LinkedinLogo,
  facebook: FacebookLogo,
  instagram: InstagramLogo,
  apple: AppleLogo,
  x: XLogo,
  spotify: SpotifyLogo,
  tiktok: TiktokLogo,
  microsoft: MicrosoftLogo,
} as const;

const ProviderBadge = ({
  provider,
  customLabels,
}: {
  provider: string;
  customLabels?: Record<string, string>;
}) => {
  const normalized = provider.toLowerCase();
  const label =
    providerLabelMap[normalized] ??
    customLabels?.[normalized] ??
    normalized.charAt(0).toUpperCase() + normalized.slice(1);
  const ProviderLogo = providerLogoMap[normalized as keyof typeof providerLogoMap];
  const isCustomProvider = Boolean(customLabels?.[normalized]);

  return (
    <Badge className="h-5 rounded border border-[var(--alpha-inverse-8)] bg-white px-1.5 py-0 text-xs font-medium leading-4 text-black">
      {ProviderLogo ? (
        <ProviderLogo className="h-4 w-4 shrink-0" />
      ) : normalized === 'email' ? (
        <Mail className="h-4 w-4 shrink-0 text-black" />
      ) : isCustomProvider ? (
        <KeyRound className="h-4 w-4 shrink-0 text-black" />
      ) : null}
      {label}
    </Badge>
  );
};

const BADGE_WIDTH = 82;
const OVERFLOW_BADGE_WIDTH = 40;

function ProvidersCell({
  row,
  customLabels,
}: RenderCellProps<UserDataGridRow> & {
  customLabels?: Record<string, string>;
}) {
  const providers = row.providers;
  const hasProviders = Array.isArray(providers) && providers.length > 0;
  const uniqueProviders = hasProviders ? (providers as string[]) : [];
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(300);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const cell = container.closest('[role="gridcell"]') as HTMLElement | null;
    const target = cell ?? container;

    let frameId: number;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frameId);
      frameId = requestAnimationFrame(() => {
        setContainerWidth(target.getBoundingClientRect().width);
      });
    });

    observer.observe(target);
    setContainerWidth(target.getBoundingClientRect().width);

    return () => {
      cancelAnimationFrame(frameId);
      observer.disconnect();
    };
  }, []);

  const maxBadgesThatFit = Math.max(0, Math.floor(containerWidth / BADGE_WIDTH));
  const hasOverflow = uniqueProviders.length > maxBadgesThatFit;
  const visibleProviderCount = hasOverflow
    ? Math.max(0, Math.floor((containerWidth - OVERFLOW_BADGE_WIDTH) / BADGE_WIDTH))
    : uniqueProviders.length;
  const visibleProviders = uniqueProviders.slice(0, visibleProviderCount);
  const hiddenProviders = uniqueProviders.slice(visibleProviderCount);

  if (!hasProviders) {
    return <span className="truncate text-[13px] leading-[18px] text-muted-foreground">null</span>;
  }

  return (
    <div ref={containerRef} className="flex w-full items-center gap-1 overflow-hidden">
      {visibleProviders.map((provider) => (
        <ProviderBadge key={provider} provider={provider} customLabels={customLabels} />
      ))}
      {hiddenProviders.length > 0 && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge className="h-5 rounded bg-[var(--alpha-8)] px-1.5 py-0 text-xs font-medium leading-4 text-muted-foreground">
                +{hiddenProviders.length}
              </Badge>
            </TooltipTrigger>
            <TooltipContent side="top" align="center">
              {hiddenProviders
                .map(
                  (p) =>
                    providerLabelMap[p.toLowerCase()] ??
                    customLabels?.[p.toLowerCase()] ??
                    p.charAt(0).toUpperCase() + p.slice(1)
                )
                .join(', ')}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
    </div>
  );
}

function createProvidersCellRenderer(customLabels?: Record<string, string>) {
  return function ProvidersCellRenderer(props: RenderCellProps<UserDataGridRow>) {
    return <ProvidersCell {...props} customLabels={customLabels} />;
  };
}

function createEmailVerifiedCellRenderer(trueLabel: string, falseLabel: string) {
  return function EmailVerifiedCellRenderer({ row }: RenderCellProps<UserDataGridRow>) {
    if (typeof row.emailVerified !== 'boolean') {
      return (
        <span className="truncate text-[13px] leading-[18px] text-muted-foreground">null</span>
      );
    }

    return (
      <Badge
        className={cn(
          'h-5 rounded px-1.5 py-0 text-xs font-medium leading-4 text-white',
          row.emailVerified ? 'bg-[rgb(var(--success))]' : 'bg-[rgb(var(--destructive))]'
        )}
      >
        {row.emailVerified ? trueLabel : falseLabel}
      </Badge>
    );
  };
}

const DateTimeCellRenderer = ({
  row,
  column,
}: RenderCellProps<UserDataGridRow> & { column: { key: string } }) => {
  const rawValue = row[column.key as keyof UserDataGridRow];
  const value = typeof rawValue === 'string' ? rawValue : '';
  const displayValue = value ? formatTime(value) : 'null';
  return (
    <span
      className={cn(
        'truncate text-[13px] leading-[18px]',
        value ? 'text-foreground' : 'text-muted-foreground'
      )}
      title={displayValue}
    >
      {displayValue}
    </span>
  );
};

export interface UsersColumnLabels {
  id?: string;
  email?: string;
  providers?: string;
  emailVerified?: string;
  created?: string;
  updated?: string;
  verifiedTrue?: string;
  verifiedFalse?: string;
}

export function createUsersColumns(
  customProviderLabels?: Record<string, string>,
  labels?: UsersColumnLabels
): DataGridColumn<UserDataGridRow>[] {
  return [
    {
      key: 'id',
      name: labels?.id ?? 'ID',
      width: '1.3fr',
      minWidth: 120,
      sortable: true,
      renderCell: ({ row }) => (
        <span className="truncate text-[13px] leading-[18px] text-foreground" title={row.id}>
          {row.id}
        </span>
      ),
    },
    {
      key: 'email',
      name: labels?.email ?? 'Email',
      width: '1.2fr',
      minWidth: 160,
      sortable: true,
      renderCell: ({ row }) => (
        <span className="truncate text-[13px] leading-[18px] text-foreground" title={row.email}>
          {row.email}
        </span>
      ),
    },
    {
      key: 'providers',
      name: labels?.providers ?? 'Providers',
      width: '1fr',
      minWidth: 140,
      sortable: true,
      renderCell: createProvidersCellRenderer(customProviderLabels),
    },
    {
      key: 'emailVerified',
      name: labels?.emailVerified ?? 'Email Verified',
      width: '1fr',
      minWidth: 130,
      sortable: true,
      renderCell: createEmailVerifiedCellRenderer(
        labels?.verifiedTrue ?? 'True',
        labels?.verifiedFalse ?? 'False'
      ),
    },
    {
      key: 'createdAt',
      name: labels?.created ?? 'Created',
      width: '1.1fr',
      minWidth: 160,
      sortable: true,
      renderCell: (props) => <DateTimeCellRenderer {...props} />,
    },
    {
      key: 'updatedAt',
      name: labels?.updated ?? 'Updated',
      width: '1.1fr',
      minWidth: 160,
      sortable: true,
      renderCell: (props) => <DateTimeCellRenderer {...props} />,
    },
  ];
}

export type UsersDataGridProps = Omit<
  DataGridProps<UserDataGridRow>,
  'columns' | 'selectionColumnWidth' | 'renderSelectionCell' | 'selectionHeaderLabel'
>;

const createUserSelectionCell = (unknownLabel: string) =>
  function UserSelectionCell({
    row,
    isSelected,
    onToggle,
    tabIndex,
  }: SelectionCellProps<UserDataGridRow>) {
    const profile = row.profile as Record<string, unknown> | null;
    const avatarUrl = profile?.avatar_url as string | undefined;
    const rawName = profile?.name;
    const name =
      (typeof rawName === 'string' && rawName.trim()) || row.email.split('@')[0] || unknownLabel;

    return (
      <div className="flex h-full w-full items-center gap-2 pr-2">
        <Checkbox
          checked={isSelected}
          onCheckedChange={(checked) => onToggle(checked === true)}
          tabIndex={tabIndex}
        />
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Avatar className="h-6 w-6 shrink-0 rounded-full">
            <AvatarImage src={avatarUrl} alt={name} className="rounded-full object-cover" />
            <AvatarFallback className="rounded-full bg-[var(--alpha-8)]">
              <User className="h-3.5 w-3.5 text-muted-foreground" />
            </AvatarFallback>
          </Avatar>
          <span className="truncate text-[13px] leading-[18px] text-foreground" title={name}>
            {name}
          </span>
        </div>
      </div>
    );
  };

export function UsersDataGrid(props: UsersDataGridProps) {
  const { t } = useTranslation('chrome');
  const { configs: customConfigs } = useCustomOAuthConfig();

  const customProviderLabels = useMemo(() => {
    const labels: Record<string, string> = {};
    for (const config of customConfigs) {
      labels[config.key.toLowerCase()] = config.name;
    }
    return labels;
  }, [customConfigs]);

  const columns = useMemo(
    () =>
      createUsersColumns(customProviderLabels, {
        id: t('auth.columnId', { defaultValue: 'ID' }),
        email: t('auth.email', { defaultValue: 'Email' }),
        providers: t('auth.columnProviders', { defaultValue: 'Providers' }),
        emailVerified: t('auth.columnEmailVerified', { defaultValue: 'Email Verified' }),
        created: t('auth.columnCreated', { defaultValue: 'Created' }),
        updated: t('auth.columnUpdated', { defaultValue: 'Updated' }),
        verifiedTrue: t('auth.verifiedTrue', { defaultValue: 'True' }),
        verifiedFalse: t('auth.verifiedFalse', { defaultValue: 'False' }),
      }),
    [customProviderLabels, t]
  );

  const renderSelectionCell = useMemo(
    () => createUserSelectionCell(t('auth.unknown', { defaultValue: 'Unknown' })),
    [t]
  );

  return (
    <DataGrid<UserDataGridRow>
      {...props}
      columns={columns}
      showSelection={true}
      showPagination={true}
      paginationRecordLabel={t('auth.usersRecordLabel', { defaultValue: 'users' })}
      showTypeBadge={false}
      selectionColumnWidth={180}
      selectionHeaderLabel={t('auth.user', { defaultValue: 'User' })}
      renderSelectionCell={renderSelectionCell}
    />
  );
}
