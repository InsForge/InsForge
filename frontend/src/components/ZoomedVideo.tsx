import { useState, useRef, useEffect } from 'react';
import { Dialog, DialogContent } from './radix/Dialog';
import { Expand } from 'lucide-react';
import { cn } from '@/lib/utils/utils';

interface ZoomedVideoProps {
  src: string;
  className?: string;
  'aria-label'?: string;
}

export function ZoomedVideo({ src, className, 'aria-label': ariaLabel }: ZoomedVideoProps) {
  const [isOpen, setIsOpen] = useState(false);
  const thumbnailRef = useRef<HTMLVideoElement>(null);
  const dialogVideoRef = useRef<HTMLVideoElement>(null);

  // Sync playback time when opening dialog
  useEffect(() => {
    if (isOpen && thumbnailRef.current && dialogVideoRef.current) {
      dialogVideoRef.current.currentTime = thumbnailRef.current.currentTime;
    }
  }, [isOpen]);

  return (
    <>
      {/* Thumbnail video with click to expand */}
      <div
        className={cn('relative group cursor-pointer rounded overflow-hidden', className)}
        onClick={() => setIsOpen(true)}
      >
        <video
          ref={thumbnailRef}
          src={src}
          autoPlay
          loop
          muted
          playsInline
          className="w-full h-full object-cover"
          aria-label={ariaLabel}
        />
        {/* Expand icon overlay */}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
          <div className="opacity-0 group-hover:opacity-100 transition-opacity bg-black/60 rounded-full p-2">
            <Expand className="w-5 h-5 text-white" />
          </div>
        </div>
      </div>

      {/* Zoomed dialog */}
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="max-w-5xl w-[90vw] p-0 border-0 bg-transparent shadow-none">
          <video
            ref={dialogVideoRef}
            src={src}
            autoPlay
            loop
            muted
            playsInline
            className="w-full h-full rounded-lg"
            aria-label={ariaLabel}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
