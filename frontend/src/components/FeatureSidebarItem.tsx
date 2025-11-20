import { useState } from 'react';
import { Pencil, Trash2, MoreVertical, LucideIcon } from 'lucide-react';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components';
import { cn } from '@/lib/utils/utils';

interface FeatureSidebarItemProps {
  name: string;
  icon: LucideIcon;
  isSelected: boolean;
  onClick: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  editLabel?: string;
  deleteLabel?: string;
}

export function FeatureSidebarItem({
  name,
  icon: Icon,
  isSelected,
  onClick,
  onEdit,
  onDelete,
  editLabel = 'Edit',
  deleteLabel = 'Delete',
}: FeatureSidebarItemProps) {
  const [dropdownOpen, setDropdownOpen] = useState(false);

  return (
    <div className="relative h-12 group">
      <Button
        variant="ghost"
        className={cn(
          'w-full h-full flex items-center justify-start px-[14px] py-[14px]',
          !isSelected && 'hover:bg-[#F8FAFC] dark:hover:bg-neutral-700',
          isSelected && 'bg-[#F1F5F9] dark:bg-neutral-600'
        )}
        onClick={onClick}
      >
        <Icon className="mr-2 h-4 w-4" />
        <span
          title={name}
          className={cn(
            'flex-1 min-w-0 truncate text-left',
            isSelected ? 'font-bold dark:text-zinc-300' : 'font-medium dark:text-zinc-300'
          )}
        >
          {name}
        </span>
        {(onEdit || onDelete) && (
          <div className="ml-2 flex items-center">
            <DropdownMenu open={dropdownOpen} onOpenChange={setDropdownOpen}>
              <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                <div
                  className={cn(
                    'h-6 w-6 p-0 flex items-center justify-center rounded cursor-pointer opacity-100',
                    `bg-transparent hover:bg-[#E2E8F0] dark:hover:bg-neutral-700`
                  )}
                >
                  <MoreVertical className="h-5 w-5 text-[#71717A] dark:text-zinc-300" />
                </div>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-48">
                {onEdit && (
                  <DropdownMenuItem
                    onClick={(e) => {
                      e.stopPropagation();
                      onEdit();
                    }}
                    className="cursor-pointer"
                  >
                    <Pencil className="mr-2 h-5 w-5 text-[#71717A] dark:text-zinc-300" />
                    {editLabel}
                  </DropdownMenuItem>
                )}
                {onDelete && (
                  <DropdownMenuItem
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete();
                    }}
                    className="text-red-600 focus:text-red-600 dark:text-red-400 dark:focus:text-red-400 cursor-pointer"
                  >
                    <Trash2 className="mr-2 h-5 w-5 dark:text-red-400" />
                    {deleteLabel}
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </Button>
    </div>
  );
}
