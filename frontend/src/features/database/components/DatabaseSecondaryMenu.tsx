import { useState } from 'react';
import { MoreVertical, Pencil, Plus, Trash2 } from 'lucide-react';
import { Link, useMatch, useNavigate } from 'react-router-dom';
import { useTables } from '@/features/database/hooks/useTables';
import { ScrollArea } from '@/components/radix/ScrollArea';
import { databaseStudioMenuItems } from '@/lib/utils/menuItems';
import { cn } from '@/lib/utils/utils';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  SearchInput,
} from '@insforge/ui';

// Sidebar used by studio pages (Indexes, Triggers, Functions, etc.)
// Fetches tables internally and navigates to TablesPage on table select.
export function DatabaseStudioSidebar() {
  const navigate = useNavigate();
  const { tables, isLoadingTables } = useTables();

  return (
    <DatabaseSecondaryMenu
      tables={tables}
      loading={isLoadingTables}
      onTableSelect={(table) => void navigate(`/dashboard/database/tables?table=${table}`)}
    />
  );
}

export interface DatabaseSecondaryMenuProps {
  tables: string[];
  selectedTable?: string;
  onTableSelect: (tableName: string) => void;
  loading?: boolean;
  onNewTable?: () => void;
  onEditTable?: (table: string) => void;
  onDeleteTable?: (table: string) => void;
}

interface TableItemProps {
  table: string;
  isSelected: boolean;
  onSelect: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}

function TableItem({ table, isSelected, onSelect, onEdit, onDelete }: TableItemProps) {
  const hasActions = !!(onEdit || onDelete);

  return (
    <div
      className={cn(
        'group flex w-full items-center gap-1 rounded-lg px-1.5 transition-colors',
        isSelected
          ? 'bg-alpha-8 text-foreground'
          : 'text-muted-foreground hover:bg-alpha-4 hover:text-foreground'
      )}
    >
      <button
        type="button"
        className="min-w-0 flex-1 px-2 py-1.5 text-left"
        onClick={onSelect}
      >
        <p className={cn('truncate text-sm font-medium leading-5', isSelected && 'text-inherit')}>
          {table}
        </p>
      </button>

      {hasActions && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
            <Button
              variant="ghost"
              size="icon-sm"
              className={cn(
                'h-6 w-6 rounded p-0',
                'hover:before:bg-transparent active:before:bg-transparent',
                isSelected
                  ? 'text-muted-foreground/50 opacity-100'
                  : 'text-muted-foreground/40 opacity-0 group-hover:opacity-100'
              )}
            >
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-40" sideOffset={6}>
            {onEdit && (
              <DropdownMenuItem
                className="cursor-pointer [&_svg]:size-3.5"
                onClick={(e) => { e.stopPropagation(); onEdit(); }}
              >
                <Pencil strokeWidth={1} />
                Edit Table
              </DropdownMenuItem>
            )}
            {onDelete && (
              <DropdownMenuItem
                className="cursor-pointer [&_svg]:size-3.5"
                onClick={(e) => { e.stopPropagation(); onDelete(); }}
              >
                <Trash2 strokeWidth={1} />
                Delete Table
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

function StudioItem({ label, href, sectionEnd }: { label: string; href: string; sectionEnd?: boolean }) {
  const match = useMatch({ path: href, end: false });
  const isSelected = !!match;

  return (
    <>
      <div
        className={cn(
          'flex w-full items-center gap-1 rounded-lg px-1.5 transition-colors',
          isSelected
            ? 'bg-alpha-8 text-foreground'
            : 'text-muted-foreground hover:bg-alpha-4 hover:text-foreground'
        )}
      >
        <Link to={href} className="flex min-w-0 flex-1 items-center px-2 py-1.5">
          <p className={cn('truncate text-sm font-medium leading-5', isSelected && 'text-inherit')}>
            {label}
          </p>
        </Link>
      </div>
      {sectionEnd && <div className="my-1.5 h-px w-full bg-alpha-8" />}
    </>
  );
}

export function DatabaseSecondaryMenu({
  tables,
  selectedTable,
  onTableSelect,
  loading,
  onNewTable,
  onEditTable,
  onDeleteTable,
}: DatabaseSecondaryMenuProps) {
  const [searchValue, setSearchValue] = useState('');
  const showEmptyState = !loading && tables.length === 0;

  const filteredTables = searchValue.trim()
    ? tables.filter((t) => t.toLowerCase().includes(searchValue.toLowerCase()))
    : tables;

  return (
    <aside className="h-full w-60 flex-shrink-0 flex flex-col border-r border-border bg-card">
      {/* Header */}
      <div className="flex h-[57px] shrink-0 items-center border-b border-[var(--alpha-8)] pl-4 pr-3 py-3">
        <p className="truncate text-base font-medium leading-7 text-foreground">Database</p>
      </div>

      <ScrollArea className="flex-1 px-3 py-3">
        {/* Tables section */}
        <div className="flex flex-col gap-1.5">
          <p className="mb-1.5 px-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/60">
            Tables
          </p>
          {loading ? (
            [...Array(5)].map((_, i) => (
              <div key={i} className="h-9 w-full animate-pulse rounded bg-alpha-8" />
            ))
          ) : (
            <>
              {tables.length > 3 && (
                <SearchInput
                  value={searchValue}
                  onChange={setSearchValue}
                  placeholder="Search tables..."
                  debounceTime={0}
                />
              )}
              {onNewTable && (
                <Button
                  variant="outline-muted"
                  className="h-8 w-full px-2.5 text-xs"
                  onClick={onNewTable}
                >
                  <Plus strokeWidth={1.5} className="!size-3.5" />
                  Create New Table
                </Button>
              )}
              {!showEmptyState && filteredTables.length === 0 ? (
                <p className="px-2 py-1 text-sm text-muted-foreground">No results found</p>
              ) : (
                filteredTables.map((table) => (
                  <TableItem
                    key={table}
                    table={table}
                    isSelected={table === selectedTable}
                    onSelect={() => onTableSelect(table)}
                    onEdit={onEditTable ? () => onEditTable(table) : undefined}
                    onDelete={onDeleteTable ? () => onDeleteTable(table) : undefined}
                  />
                ))
              )}
            </>
          )}
        </div>

        {/* Divider */}
        <div className="my-3 h-px w-full bg-alpha-8" />

        {/* Studio items */}
        <p className="mb-1.5 px-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/60">
          Database Management
        </p>
        <div className="flex flex-col gap-1.5">
          {databaseStudioMenuItems.map((item) => (
            <StudioItem
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
