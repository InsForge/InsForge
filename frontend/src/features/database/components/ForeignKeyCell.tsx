import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Link2, AlertCircle, X } from 'lucide-react';
import {
  Button,
  TypeBadge,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  ConvertedValue,
  DataGrid,
} from '@/components';
import { useTables } from '@/features/database/hooks/useTables';
import { useRecords } from '@/features/database/hooks/useRecords';
import { convertSchemaToColumns } from '@/features/database/components/DatabaseDataGrid';
import { formatValueForDisplay } from '@/lib/utils/utils';
import { useQuery } from '@tanstack/react-query';
import { useUsers } from '@/features/auth/hooks/useUsers';

// Special handling for auth.users foreign key references
// Schema matches UserSchema from @insforge/shared-schemas
const AUTH_USERS_TABLE = 'auth.users';
const authUsersSchema = {
  tableName: 'auth.users',
  columns: [
    { columnName: 'id', type: 'uuid', isUnique: true, isNullable: false },
    { columnName: 'email', type: 'string', isUnique: true, isNullable: false },
    { columnName: 'emailVerified', type: 'boolean', isUnique: false, isNullable: false },
    { columnName: 'providers', type: 'json', isUnique: false, isNullable: true },
    { columnName: 'metadata', type: 'json', isUnique: false, isNullable: true },
    { columnName: 'createdAt', type: 'timestamp', isUnique: false, isNullable: false },
    { columnName: 'updatedAt', type: 'timestamp', isUnique: false, isNullable: false },
  ],
};

interface ForeignKeyCellProps {
  value: string;
  foreignKey: {
    table: string;
    column: string;
  };
  onJumpToTable?: (tableName: string) => void;
}

export function ForeignKeyCell({ value, foreignKey, onJumpToTable }: ForeignKeyCellProps) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const { useTableSchema } = useTables();
  const isAuthUsers = foreignKey.table === AUTH_USERS_TABLE;

  // Regular table records hook (disabled for auth.users)
  const recordsHook = useRecords(isAuthUsers ? '' : foreignKey.table);

  // Auth users hook
  const { getUser } = useUsers({ enabled: false });

  // Helper function to safely render any value type (including JSON objects)
  const renderValue = (val: ConvertedValue): string => {
    return formatValueForDisplay(val);
  };

  // Fetch the referenced record when popover opens
  const searchValue = value ? renderValue(value) : '';

  // For auth.users, fetch user by ID
  const { data: authUserData, error: authUserError } = useQuery({
    queryKey: ['users', searchValue],
    queryFn: () => getUser(searchValue),
    enabled: isAuthUsers && open && !!value,
  });

  // For regular tables, fetch by foreign key
  const { data: recordData, error: recordError } = recordsHook.useRecordByForeignKey(
    foreignKey.column,
    searchValue,
    !isAuthUsers && open && !!value
  );

  // Use appropriate data source based on table type
  const record = isAuthUsers ? authUserData : recordData;
  const error = isAuthUsers ? authUserError : recordError;

  // Fetch schema for the referenced table (skip for auth.users)
  const { data: fetchedSchema } = useTableSchema(foreignKey.table, !isAuthUsers && open && !!value);
  const schema = isAuthUsers ? authUsersSchema : fetchedSchema;

  // Convert schema to columns for the mini DataGrid
  const columns = useMemo(() => {
    if (!schema) {
      return [];
    }
    // Use convertSchemaToColumns but disable foreign keys to prevent nested popovers
    return convertSchemaToColumns(schema, undefined, undefined).map((col) => ({
      ...col,
      width: 200,
      minWidth: 200,
      resizable: false,
      editable: false,
    }));
  }, [schema]);

  if (!value) {
    return <span className="text-muted-foreground">null</span>;
  }
  const displayValue = renderValue(value);

  return (
    <div className="w-full flex items-center justify-between gap-1">
      <span className="text-sm truncate" title={displayValue}>
        {displayValue}
      </span>

      <Popover open={open} onOpenChange={setOpen}>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-1 bg-white dark:bg-neutral-700"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Link2 className="h-5 w-5 text-black dark:text-white" />
                </Button>
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent>View linked record</TooltipContent>
          </Tooltip>
        </TooltipProvider>

        <PopoverContent
          className="relative w-[520px] p-0 bg-white dark:bg-[#2D2D2D] dark:border-neutral-700 overflow-hidden"
          align="center"
          side="bottom"
          sideOffset={5}
        >
          <div className="flex flex-col">
            <button className="absolute top-4 right-4">
              <X onClick={() => setOpen(false)} className="h-5 w-5 dark:text-neutral-400" />
            </button>
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-border-gray dark:border-neutral-700">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-medium text-muted-foreground dark:text-white">
                  Referencing record from
                </span>
                <TypeBadge
                  type={`${foreignKey.table}.${foreignKey.column}`}
                  className="dark:bg-neutral-800"
                />
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 min-h-0">
              {error && (
                <div className="flex items-center gap-2 p-3 text-sm text-destructive">
                  <AlertCircle className="h-4 w-4" />
                  <span>Failed to load record</span>
                </div>
              )}

              {record && schema && columns.length > 0 && (
                <div className="h-full flex flex-col">
                  {/* Mini DataGrid */}
                  <div className="flex-1">
                    <DataGrid
                      data={[record]} // Single record array
                      columns={columns}
                      loading={false}
                      showSelection={false}
                      showPagination={false}
                      className="bg-transparent"
                    />
                  </div>

                  {/* Jump to Table Button */}
                  {(onJumpToTable || isAuthUsers) && (
                    <div className="flex justify-end p-6 border-t border-border-gray dark:border-neutral-700">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-9 px-3 py-2 text-sm font-medium dark:text-white bg-bg-gray dark:bg-neutral-600"
                        onClick={() => {
                          if (isAuthUsers) {
                            void navigate('/dashboard/users');
                          } else if (onJumpToTable) {
                            onJumpToTable(foreignKey.table);
                          }
                          setOpen(false);
                        }}
                      >
                        {isAuthUsers ? 'Open Users' : 'Open Table'}
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
