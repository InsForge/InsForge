import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pencil, Plus, Settings, Trash2 } from 'lucide-react';
import {
  EmptyStateIllustration,
  FeatureSidebar,
  type FeatureSidebarActionButton,
  type FeatureSidebarHeaderButton,
  type FeatureSidebarItemAction,
  type FeatureSidebarListItem,
} from '#components';
import { StorageSettingsMenuDialog } from './StorageSettingsMenuDialog';

/** Props accepted by the StorageSidebar component. */
interface StorageSidebarProps {
  buckets: string[];
  selectedBucket?: string;
  onBucketSelect: (bucketName: string) => void;
  loading?: boolean;
  onNewBucket?: () => void;
  onEditBucket?: (bucketName: string) => void;
  onDeleteBucket?: (bucketName: string) => void;
}

/** Sidebar listing storage buckets with create, edit, delete, and settings actions. */
export function StorageSidebar({
  buckets,
  selectedBucket,
  onBucketSelect,
  loading,
  onNewBucket,
  onEditBucket,
  onDeleteBucket,
}: StorageSidebarProps) {
  const { t } = useTranslation('chrome');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const bucketMenuItems: FeatureSidebarListItem[] = buckets.map((bucket) => ({
    id: bucket,
    label: bucket,
    onClick: () => onBucketSelect(bucket),
  }));
  const showEmptyState = buckets.length === 0;

  const actionButtons: FeatureSidebarActionButton[] = onNewBucket
    ? [
        {
          id: 'create-bucket',
          label: t('storage.createBucket', { defaultValue: 'Create Bucket' }),
          icon: Plus,
          onClick: onNewBucket,
        },
      ]
    : [];

  const getItemActions = (item: FeatureSidebarListItem): FeatureSidebarItemAction[] => {
    const actions: FeatureSidebarItemAction[] = [];

    if (onEditBucket) {
      actions.push({
        id: `edit-${item.id}`,
        label: t('storage.editBucket', { defaultValue: 'Edit Bucket' }),
        icon: Pencil,
        onClick: () => onEditBucket(item.id),
      });
    }

    if (onDeleteBucket) {
      actions.push({
        id: `delete-${item.id}`,
        label: t('storage.deleteBucket', { defaultValue: 'Delete Bucket' }),
        icon: Trash2,
        destructive: true,
        onClick: () => onDeleteBucket(item.id),
      });
    }

    return actions;
  };

  const headerButtons: FeatureSidebarHeaderButton[] = [
    {
      id: 'storage-settings',
      label: t('storage.storageSettings', { defaultValue: 'Storage Settings' }),
      icon: Settings,
      onClick: () => setIsSettingsOpen(true),
    },
  ];

  return (
    <>
      <FeatureSidebar
        title={t('storage.buckets', { defaultValue: 'Buckets' })}
        items={bucketMenuItems}
        activeItemId={selectedBucket}
        loading={loading}
        headerButtons={headerButtons}
        actionButtons={actionButtons}
        emptyState={
          showEmptyState ? (
            <div className="flex flex-col items-center gap-2 pt-2 text-center">
              <EmptyStateIllustration />
              <p className="text-sm font-medium leading-6 text-muted-foreground">
                {t('storage.noBucketsYet', { defaultValue: 'No buckets yet' })}
              </p>
              <div className="text-xs leading-4">
                <button
                  type="button"
                  className="font-medium text-primary disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={onNewBucket}
                  disabled={!onNewBucket}
                >
                  {t('storage.createFirstBucket', { defaultValue: 'Create your first bucket' })}
                </button>
                <p className="text-muted-foreground">
                  {t('storage.toGetStarted', { defaultValue: 'to get started' })}
                </p>
              </div>
            </div>
          ) : undefined
        }
        itemActions={getItemActions}
        showSearch={!showEmptyState}
        searchPlaceholder={t('storage.searchBuckets', { defaultValue: 'Search buckets...' })}
      />
      <StorageSettingsMenuDialog open={isSettingsOpen} onOpenChange={setIsSettingsOpen} />
    </>
  );
}
