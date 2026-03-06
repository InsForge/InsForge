import type { CSSProperties } from 'react';
import EmptyBoxSvg from '@/assets/images/empty_box.svg?react';

export function StoragePageEmptyState() {
  return (
    <div className="flex h-full w-full items-center justify-center">
      <div className="flex flex-col items-center gap-2 text-center">
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
        <p className="text-sm font-medium leading-6 text-muted-foreground">No bucket selected</p>
        <p className="text-xs leading-4 text-muted-foreground">
          Select a bucket from the sidebar to view its files
        </p>
      </div>
    </div>
  );
}
