import type { MouseEvent } from 'react';
import { HardDrive, ExternalLink } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { BucketMetadataSchema } from '@insforge/shared-schemas';

interface BucketNodeProps {
  data: {
    bucket: BucketMetadataSchema;
  };
}

export function BucketNode({ data }: BucketNodeProps) {
  const navigate = useNavigate();
  const { bucket } = data;
  const handleOpenBucket = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    const search = new URLSearchParams({ bucket: bucket.name }).toString();
    void navigate(`/dashboard/storage?${search}`);
  };

  return (
    <div className="bg-card rounded-lg border border-[var(--alpha-8)] min-w-[320px] shadow-sm">
      {/* Bucket Header */}
      <div className="flex items-center justify-between p-2">
        <div className="flex items-center gap-2">
          <div className="flex items-center justify-center w-11 h-11 bg-blue-300 rounded p-1.5">
            <HardDrive className="w-5 h-5 text-neutral-900" />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-medium text-zinc-950 dark:text-white">{bucket.name}</h3>
            <p className="text-xs text-zinc-600 dark:text-neutral-300">
              {bucket.objectCount ? `${bucket.objectCount} files` : '0 files'}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={handleOpenBucket}
          onMouseDown={(event) => event.stopPropagation()}
          className="flex h-7 w-7 items-center justify-center rounded text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-white/5 dark:hover:text-zinc-200"
          aria-label={`Open ${bucket.name} bucket`}
        >
          <ExternalLink className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
