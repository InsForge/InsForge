import { Pencil, Plus, Trash2 } from 'lucide-react';
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

  const actionButtons: SecondaryMenuActionButton[] = onNewBucket
    ? [{ id: 'create-bucket', label: 'Create Bucket', icon: Plus, onClick: onNewBucket }]
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
        onClick: () => onDeleteBucket(item.id),
      });
    }

    return actions;
  };

  return (
    <SecondaryMenu
      title="Storage"
      items={bucketMenuItems}
      activeItemId={selectedBucket}
      loading={loading}
      actionButtons={actionButtons}
      emptyState={
        <p className="px-2 py-1 text-sm text-muted-foreground">No buckets yet</p>
      }
      itemActions={getItemActions}
      showSearch={buckets.length > 3}
      searchPlaceholder="Search buckets..."
    />
  );
}
