import type { CSSProperties } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import EmptyBoxSvg from '@/assets/images/empty_box.svg?react';
import {
  SecondaryMenu,
  type SecondaryMenuActionButton,
  type SecondaryMenuItemAction,
  type SecondaryMenuListItem,
} from '@/components/layout/SecondaryMenu';

interface StorageSidebarProps {
  buckets: string[];
  selectedBucket?: string;
  onBucketSelect: (bucketName: string) => void;
  loading?: boolean;
  onNewBucket?: () => void;
  onEditBucket?: (bucketName: string) => void;
  onDeleteBucket?: (bucketName: string) => void;
}

export function StorageSidebar({
  buckets,
  selectedBucket,
  onBucketSelect,
  loading,
  onNewBucket,
  onEditBucket,
  onDeleteBucket,
}: StorageSidebarProps) {
  const bucketMenuItems: SecondaryMenuListItem[] = buckets.map((bucket) => ({
    id: bucket,
    label: bucket,
    onClick: () => onBucketSelect(bucket),
  }));
  const showEmptyState = buckets.length === 0;

  const actionButtons: SecondaryMenuActionButton[] = onNewBucket
    ? [
        {
          id: 'create-bucket',
          label: 'Create Bucket',
          icon: Plus,
          onClick: onNewBucket,
        },
      ]
    : [];

  const getItemActions = (item: SecondaryMenuListItem): SecondaryMenuItemAction[] => {
    const actions: SecondaryMenuItemAction[] = [];

    if (onEditBucket) {
      actions.push({
        id: `edit-${item.id}`,
        label: 'Edit Bucket',
        icon: Pencil,
        onClick: () => onEditBucket(item.id),
      });
    }

    if (onDeleteBucket) {
      actions.push({
        id: `delete-${item.id}`,
        label: 'Delete Bucket',
        icon: Trash2,
        destructive: true,
        onClick: () => onDeleteBucket(item.id),
      });
    }

    return actions;
  };

  return (
    <SecondaryMenu
      title="Buckets"
      items={bucketMenuItems}
      activeItemId={selectedBucket}
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
            <p className="text-sm font-medium leading-6 text-muted-foreground">No buckets yet</p>
            <div className="text-xs leading-4">
              <button
                type="button"
                className="font-medium text-primary disabled:cursor-not-allowed disabled:opacity-60"
                onClick={onNewBucket}
                disabled={!onNewBucket}
              >
                Create your first bucket
              </button>
              <p className="text-muted-foreground">to get started</p>
            </div>
          </div>
        ) : undefined
      }
      itemActions={getItemActions}
      showSearch={!showEmptyState}
      searchPlaceholder="Search buckets..."
    />
  );
}
