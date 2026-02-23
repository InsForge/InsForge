import { useMemo } from 'react';
import { Mail, User } from 'lucide-react';
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  DataGrid,
  type DataGridColumn,
  type DataGridProps,
  type RenderCellProps,
  type SelectionCellProps,
} from '@/components';
import AppleLogo from '@/assets/logos/apple.svg?react';
import DiscordLogo from '@/assets/logos/discord.svg?react';
import FacebookLogo from '@/assets/logos/facebook.svg?react';
import GithubLogo from '@/assets/logos/github.svg?react';
import GoogleLogo from '@/assets/logos/google.svg?react';
import InstagramLogo from '@/assets/logos/instagram.svg?react';
import LinkedinLogo from '@/assets/logos/linkedin.svg?react';
import MicrosoftLogo from '@/assets/logos/microsoft.svg?react';
import SpotifyLogo from '@/assets/logos/spotify.svg?react';
import TiktokLogo from '@/assets/logos/tiktok.svg?react';
import XLogo from '@/assets/logos/x.svg?react';
import { Badge, Checkbox } from '@insforge/ui';
import { cn, formatTime } from '@/lib/utils/utils';
import type { UserSchema } from '@insforge/shared-schemas';

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

const ProviderBadge = ({ provider }: { provider: string }) => {
  const normalized = provider.toLowerCase();
  const label =
    providerLabelMap[normalized] ?? normalized.charAt(0).toUpperCase() + normalized.slice(1);
  const ProviderLogo = providerLogoMap[normalized as keyof typeof providerLogoMap];

  return (
    <Badge className="h-5 rounded border border-[var(--alpha-inverse-8)] bg-white px-1.5 py-0 text-xs font-medium leading-4 text-black">
      {ProviderLogo ? (
        <ProviderLogo className="h-4 w-4 shrink-0" />
      ) : normalized === 'email' ? (
        <Mail className="h-4 w-4 shrink-0 text-black" />
      ) : null}
      {label}
    </Badge>
  );
};

const ProvidersCellRenderer = ({ row }: RenderCellProps<UserDataGridRow>) => {
  const providers = row.providers;

  if (!providers || !Array.isArray(providers) || !providers.length) {
    return <span className="truncate text-[13px] leading-[18px] text-muted-foreground">null</span>;
  }

  const uniqueProviders = [...new Set(providers)];

  return (
    <div className="flex items-center gap-1" title={providers.join(', ')}>
      {uniqueProviders.slice(0, 1).map((provider) => (
        <ProviderBadge key={provider} provider={provider} />
      ))}
      {uniqueProviders.length > 1 && (
        <Badge className="h-5 rounded bg-[var(--alpha-8)] px-1.5 py-0 text-xs font-medium leading-4 text-muted-foreground">
          +{uniqueProviders.length - 1}
        </Badge>
      )}
    </div>
  );
};

const EmailVerifiedCellRenderer = ({ row }: RenderCellProps<UserDataGridRow>) => {
  if (typeof row.emailVerified !== 'boolean') {
    return <span className="truncate text-[13px] leading-[18px] text-muted-foreground">null</span>;
  }

  return (
    <Badge
      className={cn(
        'h-5 rounded px-1.5 py-0 text-xs font-medium leading-4 text-white',
        row.emailVerified ? 'bg-[rgb(var(--success))]' : 'bg-[rgb(var(--destructive))]'
      )}
    >
      {row.emailVerified ? 'True' : 'False'}
    </Badge>
  );
};

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

export function createUsersColumns(): DataGridColumn<UserDataGridRow>[] {
  return [
    {
      key: 'id',
      name: 'ID',
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
      name: 'Email',
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
      name: 'Providers',
      width: '1fr',
      minWidth: 140,
      sortable: true,
      renderCell: ProvidersCellRenderer,
    },
    {
      key: 'emailVerified',
      name: 'Email Verified',
      width: '1fr',
      minWidth: 130,
      sortable: true,
      renderCell: EmailVerifiedCellRenderer,
    },
    {
      key: 'createdAt',
      name: 'Created',
      width: '1.1fr',
      minWidth: 160,
      sortable: true,
      renderCell: (props) => <DateTimeCellRenderer {...props} />,
    },
    {
      key: 'updatedAt',
      name: 'Updated',
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

const UserSelectionCell = ({
  row,
  isSelected,
  onToggle,
  tabIndex,
}: SelectionCellProps<UserDataGridRow>) => {
  const profile = row.profile as Record<string, unknown> | null;
  const avatarUrl = profile?.avatar_url as string | undefined;
  const rawName = profile?.name;
  const name =
    (typeof rawName === 'string' && rawName.trim()) || row.email.split('@')[0] || 'Unknown';

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
  const columns = useMemo(() => createUsersColumns(), []);

  return (
    <DataGrid<UserDataGridRow>
      {...props}
      columns={columns}
      showSelection={true}
      showPagination={true}
      paginationRecordLabel="users"
      showTypeBadge={false}
      selectionColumnWidth={180}
      selectionHeaderLabel="User"
      renderSelectionCell={UserSelectionCell}
    />
  );
}
