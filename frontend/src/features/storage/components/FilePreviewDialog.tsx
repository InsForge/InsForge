import { useState, useEffect } from 'react';
import { Download, ExternalLink } from 'lucide-react';
import { Dialog, DialogContent } from '@/components/radix/Dialog';
import { Button } from '@/components/radix/Button';
import { Badge } from '@/components/radix/Badge';
import { LoadingState } from '@/components';
import { storageService } from '@/features/storage/services/storage.service';
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

  // Reset state when file changes
  useEffect(() => {
    if (!file || !open) {
      setPreviewUrl(null);
      setError(null);
      return;
    }

    const loadPreview = async () => {
      if (!file) {
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        const fileBucket = file.bucket || bucket;
        const blob = await storageService.downloadObject(fileBucket, file.key);

        // Validate blob
        if (!blob || blob.size === 0) {
          throw new Error('Empty or corrupted file');
        }

        const url = URL.createObjectURL(blob);
        setPreviewUrl(url);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to load preview';
        setError(errorMessage);
      } finally {
        setIsLoading(false);
      }
    };

    void loadPreview();
  }, [file, open, bucket]);

  // Cleanup URL when component unmounts or file changes
  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

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
      return <div className="bg-gray-200 w-full h-full min-h-[400px] rounded" />;
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
        <div className="flex items-center justify-center h-full bg-gray-200">
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
        <iframe
          src={`${previewUrl}#toolbar=0&navpanes=0&scrollbar=0`}
          className="w-full h-[630px]"
          title={fileName}
          onError={() => setError('Failed to load PDF')}
        />
      );
    }

    // Fallback empty preview
    return <div className="bg-gray-200 w-full h-full min-h-[400px] rounded" />;
  };

  if (!file) {
    return null;
  }

  const fileName = file.key.split('/').pop() || file.key;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[800px] max-w-[800px] p-0 overflow-hidden flex">
        <div className="w-[800px] min-h-[500px] max-h-[820px] bg-white rounded-xl shadow-lg border border-zinc-200 flex flex-col">
          {/* Header */}
          <div className="px-6 py-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-zinc-950 leading-6">{fileName}</h2>
                <div className="flex items-center gap-1.5 mt-1.5">
                  <span className="text-sm text-zinc-500">{formatFileSize(file.size)}</span>
                  {file.mimeType && (
                    <Badge variant="outline" className="text-xs font-normal px-2.5 py-0.5">
                      {file.mimeType}
                    </Badge>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Preview Content */}
          <div className="flex flex-1 overflow-hidden px-6">
            {isLoading ? (
              <div className="flex items-center justify-center w-full min-h-[400px]">
                <LoadingState />
              </div>
            ) : (
              <div className="w-full h-full overflow-auto">{renderPreview()}</div>
            )}
          </div>

          {/* Footer Actions */}
          <div className="px-6 py-6">
            <div className="flex justify-end gap-3">
              <Button
                variant="outline"
                className="flex-1 h-10 px-3 gap-1.5"
                onClick={handleDownload}
              >
                <Download className="h-5 w-5" />
                <span className="text-sm font-medium">Download</span>
              </Button>
              <Button variant="outline" className="flex-1 h-10 px-3 gap-1.5" onClick={openInNewTab}>
                <ExternalLink className="h-5 w-5" />
                <span className="text-sm font-medium">Open in new tab</span>
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
      <div className="flex items-center justify-center h-full min-h-[400px]">
        <LoadingState />
      </div>
    );
  }

  return (
    <div className="bg-gray-50 rounded p-4 w-full h-full">
      <pre className="text-sm whitespace-pre-wrap break-words">{content}</pre>
    </div>
  );
}
