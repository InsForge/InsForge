import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { ArrowLeft, Database, Pencil, Plus, Trash2 } from 'lucide-react';
import { Link, useMatch, useNavigate } from 'react-router-dom';
import EmptyBoxSvg from '#assets/images/empty_box.svg?react';
import {
  FeatureSidebar,
  type FeatureSidebarActionButton,
  type FeatureSidebarItemAction,
  type FeatureSidebarListItem,
} from '#components';
import { ScrollArea } from '#components/radix/ScrollArea';
import { useIsCloudHostingMode } from '#lib/config/DashboardHostContext';
import { cn } from '#lib/utils/utils';
import { Button } from '@insforge/ui';

const DATABASE_STUDIO_SIDEBAR_BASE_ITEMS: Array<{
  id: string;
  label: string;
  href: string;
  sectionEnd?: boolean;
}> = [
  {
    id: 'indexes',
    label: 'Indexes',
    href: '/dashboard/database/indexes',
  },
  {
    id: 'triggers',
    label: 'Triggers',
    href: '/dashboard/database/triggers',
  },
  {
    id: 'functions',
    label: 'Functions',
    href: '/dashboard/database/functions',
  },
  {
    id: 'policies',
    label: 'Policies',
    href: '/dashboard/database/policies',
    sectionEnd: true,
  },
  {
    id: 'migrations',
    label: 'Migrations',
    href: '/dashboard/database/migrations',
  },
  {
    id: 'templates',
    label: 'Templates',
    href: '/dashboard/database/templates',
  },
];

export interface DatabaseSidebarProps {
  tables: string[];
  selectedTable?: string;
  onTableSelect: (tableName: string) => void;
  loading?: boolean;
  onNewTable?: () => void;
  onEditTable?: (table: string) => void;
  onDeleteTable?: (table: string) => void;
  initialMode?: 'tables' | 'studio';
  animateToMode?: 'tables' | 'studio';
}

export interface DatabaseStudioSidebarPanelProps {
  onBack: () => void;
}

interface DatabaseStudioSidebarItemProps {
  label: string;
  href: string;
  sectionEnd?: boolean;
}

function DatabaseStudioSidebarItem({ label, href, sectionEnd }: DatabaseStudioSidebarItemProps) {
  const match = useMatch({ path: href, end: false });
  const isSelected = !!match;

  return (
    <>
      <div
        className={cn(
          'flex w-full items-center gap-1 rounded px-1.5 py-1.5 transition-colors',
          isSelected
            ? 'bg-alpha-8 text-foreground'
            : 'text-muted-foreground hover:bg-alpha-4 hover:text-foreground'
        )}
      >
        <Link to={href} className="flex min-w-0 flex-1 items-center px-2">
          <p className={cn('truncate text-sm leading-5', isSelected && 'text-inherit')}>{label}</p>
        </Link>
      </div>

      {sectionEnd && <div className="my-1.5 h-px w-full bg-alpha-8" />}
    </>
  );
}

const STUDIO_MENU_TRANSITION_MS = 260;

export function DatabaseStudioSidebarPanel({ onBack }: DatabaseStudioSidebarPanelProps) {
  const isCloudHostingMode = useIsCloudHostingMode();

  return (
    <aside className="h-full w-60 flex flex-col border-r border-border bg-semantic-1 flex-shrink-0">
      <div className="p-3">
        <Button
          variant="ghost"
          className="h-8 w-full justify-start gap-1 rounded px-1.5 text-sm leading-5 font-medium text-muted-foreground hover:bg-transparent hover:text-foreground"
          onClick={onBack}
        >
          <ArrowLeft className="h-5 w-5" />
          Back
        </Button>
      </div>

      <ScrollArea className="flex-1 px-3 pb-2">
        <div className="flex flex-col gap-1.5">
          {(isCloudHostingMode
            ? [
                ...DATABASE_STUDIO_SIDEBAR_BASE_ITEMS,
                {
                  id: 'backups',
                  label: 'Backup & Restore',
                  href: '/dashboard/database/backups',
                },
              ]
            : DATABASE_STUDIO_SIDEBAR_BASE_ITEMS
          ).map((item) => (
            <DatabaseStudioSidebarItem
              key={item.id}
              label={item.label}
              href={item.href}
              sectionEnd={item.sectionEnd}
            />
          ))}
        </div>
      </ScrollArea>
    </aside>
  );
}

export function DatabaseSidebar({
  tables,
  selectedTable,
  onTableSelect,
  loading,
  onNewTable,
  onEditTable,
  onDeleteTable,
  initialMode = 'tables',
  animateToMode,
}: DatabaseSidebarProps) {
  const navigate = useNavigate();
  const [mode, setMode] = useState<'tables' | 'studio'>(initialMode);
  const showEmptyState = tables.length === 0;
  const navigateTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (navigateTimerRef.current) {
        window.clearTimeout(navigateTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!animateToMode || animateToMode === initialMode) {
      return;
    }

    const rafId = window.requestAnimationFrame(() => {
      setMode(animateToMode);
    });

    return () => {
      window.cancelAnimationFrame(rafId);
    };
  }, [animateToMode, initialMode]);

  const tableMenuItems: FeatureSidebarListItem[] = tables.map((table) => ({
    id: table,
    label: table,
    onClick: () => onTableSelect(table),
  }));

  const actionButtons: FeatureSidebarActionButton[] = [
    ...(onNewTable
      ? [
          {
            id: 'create-table',
            label: 'Create Table',
            icon: Plus,
            onClick: onNewTable,
          },
        ]
      : []),
    {
      id: 'database-studio',
      label: 'Database Studio',
      icon: Database,
      onClick: () => {
        setMode('studio');
        if (navigateTimerRef.current) {
          window.clearTimeout(navigateTimerRef.current);
        }
        navigateTimerRef.current = window.setTimeout(() => {
          void navigate('/dashboard/database/indexes');
        }, STUDIO_MENU_TRANSITION_MS);
      },
    },
  ];

  const getItemActions = (item: FeatureSidebarListItem): FeatureSidebarItemAction[] => {
    const actions: FeatureSidebarItemAction[] = [];

    if (onEditTable) {
      actions.push({
        id: `edit-${item.id}`,
        label: 'Edit Table',
        icon: Pencil,
        onClick: () => onEditTable(item.id),
      });
    }

    if (onDeleteTable) {
      actions.push({
        id: `delete-${item.id}`,
        label: 'Delete Table',
        icon: Trash2,
        destructive: true,
        onClick: () => onDeleteTable(item.id),
      });
    }

    return actions;
  };

  return (
    <div className="h-full w-60 flex-shrink-0 overflow-hidden">
      <div
        className={cn(
          'flex h-full w-[200%] transition-transform duration-300 ease-in-out',
          mode === 'tables' ? 'translate-x-0' : '-translate-x-1/2'
        )}
      >
        <div className="h-full w-1/2">
          <FeatureSidebar
            title="Database"
            items={tableMenuItems}
            activeItemId={selectedTable}
            loading={loading}
            actionButtons={actionButtons}
            emptyState={
              showEmptyState ? (
                <div className="flex flex-col items-center gap-2 pt-2 text-center">
                  <EmptyBoxSvg
                    className="h-[95px] w-[160px]"
                    style={
                      {
                        '--empty-box-fill-primary': 'rgb(var(--semantic-2))',
                        '--empty-box-fill-secondary': 'rgb(var(--semantic-6))',
                      } as CSSProperties
                    }
                    aria-hidden="true"
                  />
                  <p className="text-sm font-medium leading-6 text-muted-foreground">
                    No Table Yet
                  </p>
                  <div className="text-xs leading-4">
                    <button
                      type="button"
                      className="font-medium text-primary disabled:cursor-not-allowed disabled:opacity-60"
                      onClick={onNewTable}
                      disabled={!onNewTable}
                    >
                      Create your first table
                    </button>
                    <p className="text-muted-foreground">to get started</p>
                  </div>
                </div>
              ) : undefined
            }
            itemActions={getItemActions}
            showSearch={!showEmptyState}
            searchPlaceholder="Search tables..."
          />
        </div>

        <div className="h-full w-1/2">
          <DatabaseStudioSidebarPanel onBack={() => setMode('tables')} />
        </div>
      </div>
    </div>
  );
}
