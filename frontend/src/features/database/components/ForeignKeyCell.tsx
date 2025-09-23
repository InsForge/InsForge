import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link2, AlertCircle, X } from 'lucide-react';
import { Button } from '@/components/radix/Button';
import { TypeBadge } from '@/components/TypeBadge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/radix/Popover';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/radix/Tooltip';
import { databaseService } from '@/features/database/services/database.service';
import { ConvertedValue, DataGrid } from '@/components/datagrid';
import { convertSchemaToColumns } from '@/features/database/components/DatabaseDataGrid';
import { formatValueForDisplay } from '@/lib/utils/utils';

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

  // Helper function to safely render any value type (including JSON objects)
  const renderValue = (val: ConvertedValue): string => {
    return formatValueForDisplay(val);
  };

  // Fetch the referenced record when popover opens
  const {
    data: recordData,
    isLoading: _isLoading,
    error,
  } = useQuery({
    queryKey: ['table', foreignKey.table, foreignKey.column, value],
    queryFn: async () => {
      if (!value) {
        return null;
      }

      try {
        const searchValue = renderValue(value);
        const record = await databaseService.getRecordByForeignKeyValue(
          foreignKey.table,
          foreignKey.column,
          searchValue
        );
        return record;
      } catch (error) {
        console.error('Failed to fetch foreign key record:', error);
        throw error;
      }
    },
    enabled: open && !!value,
  });

  const record = recordData;

  // Fetch schema for the referenced table
  const { data: schema } = useQuery({
    queryKey: ['schema', foreignKey.table],
    queryFn: () => databaseService.getTableSchema(foreignKey.table),
    enabled: open && !!value,
  });

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
                  {onJumpToTable && (
                    <div className="flex justify-end p-6 border-t border-border-gray dark:border-neutral-700">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-9 px-3 py-2 text-sm font-medium dark:text-white bg-bg-gray dark:bg-neutral-600"
                        onClick={() => {
                          onJumpToTable(foreignKey.table);
                          setOpen(false);
                        }}
                      >
                        Open Table
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
