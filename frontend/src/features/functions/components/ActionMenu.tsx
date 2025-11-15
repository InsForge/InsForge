import React from 'react';
import { MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/radix/DropdownMenu';
import { Button } from '@/components/radix/Button';

type ActionMenuProps = {
  onEdit: () => void;
  onDelete: () => void;
  ariaLabel?: string;
};

export const ActionMenu: React.FC<ActionMenuProps> = ({ onEdit, onDelete, ariaLabel }) => {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          title={ariaLabel ?? 'Actions'}
          onClick={(e: React.MouseEvent) => e.stopPropagation()}
        >
          <MoreHorizontal className="h-4 w-4 text-zinc-500 dark:text-zinc-300" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        sideOffset={6}
        className="w-40"
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault();
            onEdit();
          }}
        >
          <Pencil className="mr-2 h-4 w-4 dark:text-zinc-300 text-zinc-700" />
          <span>Edit</span>
        </DropdownMenuItem>

        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault();
            onDelete();
          }}
          className="dark:text-red-400 text-destructive"
        >
          <Trash2 className="mr-2 h-4 w-4 dark:text-red-400 text-destructive" />
          <span>Delete</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default ActionMenu;
