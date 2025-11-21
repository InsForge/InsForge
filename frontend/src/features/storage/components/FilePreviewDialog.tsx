import { useState, useEffect } from 'react';
import { Download, ExternalLink } from 'lucide-react';
import { Button, Dialog, DialogContent, LoadingState, TypeBadge } from '@/components';
import { useStorage } from '@/features/storage/hooks/useStorage';
import { StorageFileSchema } from '@insforge/shared-schemas';

interface FilePreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  file: StorageFileSchema | null;
  bucket: string;
}

export function FilePreviewDialog({ open, onOpenChange, file, bucket }: FilePreviewDialogProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { downloadObject } = useStorage();

  // Reset state when file changes
  useEffect(() => {
    if (!file || !open) {
      setPreviewUrl(null);
      setError(null);
      return;
    }

    let currentUrl: string | null = null;

    const loadPreview = async () => {
      if (!file) {
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        const fileBucket = file.bucket || bucket;
        // Fetch file with authentication and create blob URL
        const blob = await downloadObject(fileBucket, file.key);
        const url = URL.createObjectURL(blob);
        currentUrl = url;
        setPreviewUrl(url);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to load preview';
        setError(errorMessage);
      } finally {
        setIsLoading(false);
      }
    };

    void loadPreview();

    // Cleanup: Revoke blob URL when component unmounts or file changes
    return () => {
      if (currentUrl) {
        URL.revokeObjectURL(currentUrl);
      }
    };
  }, [file, open, bucket, downloadObject]);

  const handleDownload = () => {
    if (!file || !previewUrl) {
      return;
    }

    try {
      const fileName = file.key.split('/').pop() || file.key;
      const a = document.createElement('a');
      a.href = previewUrl;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch {
      setError('Download failed');
    }
  };

  const openInNewTab = () => {
    if (previewUrl) {
      window.open(previewUrl, '_blank');
    }
  };

  const isPreviewable = (mimeType?: string): boolean => {
    if (!mimeType) {
      return false;
    }
    return (
      mimeType.startsWith('image/') ||
      mimeType.startsWith('video/') ||
      mimeType.startsWith('audio/') ||
      mimeType.startsWith('text/') ||
      mimeType === 'application/json' ||
      mimeType === 'application/pdf'
    );
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) {
      return `${bytes} B`;
    }
    if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(2)} KB`;
    }
    if (bytes < 1024 * 1024 * 1024) {
      return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    }
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  const renderPreview = () => {
    if (!file) {
      return null;
    }

    // Show empty preview template for non-previewable files or errors
    if (!isPreviewable(file.mimeType) || error || !previewUrl) {
      return <div className="bg-neutral-200 dark:bg-neutral-700 w-full h-full rounded" />;
    }

    const mimeType = file.mimeType || '';
    const fileName = file.key.split('/').pop() || file.key;

    if (mimeType.startsWith('image/')) {
      return (
        <div className="w-full h-full flex items-center justify-center">
          <img
            src={previewUrl}
            alt={fileName}
            className="max-w-full max-h-full object-contain"
            onError={() => setError('Failed to load image')}
          />
        </div>
      );
    }

    if (mimeType.startsWith('video/')) {
      return (
        <video
          src={previewUrl}
          controls
          className="w-full h-full"
          onError={() => setError('Failed to load video')}
        >
          Your browser does not support the video tag.
        </video>
      );
    }

    if (mimeType.startsWith('audio/')) {
      return (
        <div className="flex items-center justify-center w-full h-full bg-gray-200 dark:bg-transparent">
          <audio
            src={previewUrl}
            controls
            className="w-full max-w-md"
            onError={() => setError('Failed to load audio')}
          >
            Your browser does not support the audio tag.
          </audio>
        </div>
      );
    }

    if (mimeType.startsWith('text/') || mimeType === 'application/json') {
      return <TextPreview url={previewUrl} />;
    }

    if (mimeType === 'application/pdf') {
      return (
        <div className="w-full h-[602px] overflow-hidden">
          <iframe
            src={`${previewUrl}#toolbar=0&navpanes=0`}
            className="w-full h-full"
            title={fileName}
            onError={() => setError('Failed to load PDF')}
          />
        </div>
      );
    }

    // Fallback empty preview
    return (
      <div className="bg-neutral-200 dark:bg-neutral-700 w-full h-full min-h-[400px] rounded" />
    );
  };

  if (!file) {
    return null;
  }

  const fileName = file.key.split('/').pop() || file.key;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[800px] max-w-[800px] p-0 flex">
        <div className="w-[800px] min-h-[500px] max-h-[820px] bg-white dark:bg-neutral-800 border border-zinc-200 dark:border-neutral-700 flex flex-col">
          {/* Header */}
          <div className="px-6 py-3">
            <div className="flex flex-col items-start gap-1">
              <h2 className="text-lg font-semibold text-zinc-950 dark:text-white">{fileName}</h2>
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-medium text-zinc-500 dark:text-neutral-400">
                  {formatFileSize(file.size)}
                </span>
                {file.mimeType && (
                  <TypeBadge type={file.mimeType} className="dark:bg-neutral-700" />
                )}
              </div>
            </div>
          </div>

          {/* Preview Content */}
          <div className="flex flex-1 overflow-hidden p-6 border-y border-zinc-200 dark:border-neutral-600">
            {isLoading ? (
              <div className="flex items-center justify-center w-full min-h-[400px]">
                <LoadingState />
              </div>
            ) : (
              renderPreview()
            )}
          </div>

          {/* Footer Actions */}
          <div className="px-6 py-6">
            <div className="flex justify-end gap-3">
              <Button
                variant="outline"
                className="flex-1 h-10 px-3 gap-1.5 dark:bg-neutral-600 dark:text-zinc-300 dark:border-neutral-600 dark:hover:bg-neutral-700"
                onClick={handleDownload}
              >
                <Download className="h-5 w-5" />
                <span className="text-sm font-medium dark:text-white">Download</span>
              </Button>
              <Button
                variant="outline"
                className="flex-1 h-10 px-3 gap-1.5 dark:bg-neutral-600 dark:text-zinc-300 dark:border-neutral-600 dark:hover:bg-neutral-700"
                onClick={openInNewTab}
              >
                <ExternalLink className="h-5 w-5" />
                <span className="text-sm font-medium dark:text-white">Open in new tab</span>
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Text file preview component
function TextPreview({ url }: { url: string }) {
  const [content, setContent] = useState<string>('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadTextContent = async () => {
      try {
        setLoading(true);
        // Fetch the blob URL (which is already authenticated)
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error('Failed to load text content');
        }

        const text = await response.text();
        // Limit content length for performance
        if (text.length > 100000) {
          setContent(text.substring(0, 100000) + '\n\n... (content truncated due to size)');
        } else {
          setContent(text);
        }
      } catch {
        setContent('Failed to load text content');
      } finally {
        setLoading(false);
      }
    };
    void loadTextContent();
  }, [url]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full w-full min-h-[400px]">
        <LoadingState />
      </div>
    );
  }

  return (
    <div className="bg-neutral-50 dark:bg-neutral-800 dark:text-neutral-300 rounded p-4 w-full h-full overflow-auto">
      <pre className="text-sm whitespace-pre-wrap break-words">{content}</pre>
    </div>
  );
}
