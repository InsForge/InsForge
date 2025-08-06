import { Folder } from 'lucide-react';
import { FeatureSidebar } from '@/components/FeatureSidebar';
import { BucketListSkeleton } from './BucketListSkeleton';
import { BucketEmptyState } from './BucketEmptyState';

interface BucketInfo {
  fileCount: number;
  totalSize: number;
}

interface StorageSidebarProps {
  buckets: Record<string, BucketInfo>;
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
  return (
    <FeatureSidebar
      title="Buckets"
      items={buckets}
      selectedItem={selectedBucket}
      onItemSelect={onBucketSelect}
      loading={loading}
      onNewItem={onNewBucket}
      onEditItem={onEditBucket}
      onDeleteItem={onDeleteBucket}
      searchPlaceholder="Search buckets..."
      newItemTooltip="Create New Bucket"
      editLabel="Edit Bucket"
      deleteLabel="Delete Bucket"
      icon={Folder}
      renderSkeleton={() => <BucketListSkeleton />}
      renderEmptyState={(searchTerm) => <BucketEmptyState searchTerm={searchTerm} />}
    />
  );
}
