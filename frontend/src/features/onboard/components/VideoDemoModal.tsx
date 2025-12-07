import { cn } from '@/lib/utils/utils';

export interface VideoDemoModalProps {
  open: boolean;
  className?: string;
}

export function VideoDemoModal({ open, className }: VideoDemoModalProps) {
  if (!open) {
    return null;
  }

  return (
    <div
      className={cn(
        'bg-gray-100 dark:bg-[#3A3A3A] border border-gray-200 dark:border-neutral-700 rounded-lg p-3 flex flex-col gap-2.5',
        className
      )}
    >
      <p className="text-gray-900 dark:text-white text-sm leading-6">
        InsForge MCP lets your coding agent build and control your backend
      </p>
      <div className="w-full aspect-video rounded overflow-hidden bg-neutral-800">
        <video
          autoPlay
          muted
          loop
          playsInline
          className="w-full h-full object-cover"
          controlsList="nodownload"
        >
          <source src="https://insforge.dev/assets/videos/database.mp4" type="video/mp4" />
          Your browser does not support the video tag.
        </video>
      </div>
    </div>
  );
}
