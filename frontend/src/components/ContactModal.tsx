import { useState, useEffect, useRef } from 'react';
import { Plus, Smartphone, X } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  ButtonWithLoading,
} from '@/components';
import { cn, isInsForgeCloudProject } from '@/lib/utils/utils';
import { feedbackService } from '@/lib/services/feedback.service';

const FOUNDER_PHONE = '+1 (617) 992-6332';
const MAX_FILES = 10;
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB in bytes
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];

interface ContactModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ContactModal({ open, onOpenChange }: ContactModalProps) {
  const location = useLocation();
  const [message, setMessage] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string>('');
  const [isDragging, setIsDragging] = useState(false);
  const dragCounterRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isMac, setIsMac] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setIsMac(/Mac|iPhone|iPad|iPod/.test(window.navigator.userAgent));
    }
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) {
      return;
    }

    const selectedFiles = Array.from(e.target.files);
    const validFiles = selectedFiles.filter((file) => {
      if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
        return false;
      }
      if (file.size > MAX_FILE_SIZE) {
        alert(`File "${file.name}" is too large. Maximum size is 10MB.`);
        return false;
      }
      return true;
    });

    const remainingSlots = MAX_FILES - files.length;
    const filesToAdd = validFiles.slice(0, remainingSlots);

    setFiles((prev) => [...prev, ...filesToAdd]);
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) {
      return;
    }

    const imageFiles: File[] = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];

      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
            continue;
          }
          if (file.size > MAX_FILE_SIZE) {
            alert(`Pasted image is too large. Maximum size is 10MB.`);
            continue;
          }
          imageFiles.push(file);
        }
      }
    }

    if (imageFiles.length > 0) {
      const remainingSlots = MAX_FILES - files.length;
      const filesToAdd = imageFiles.slice(0, remainingSlots);

      setFiles((prev) => [...prev, ...filesToAdd]);
      e.preventDefault();
    }
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current += 1;
    if (e.dataTransfer.types.includes('Files')) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current -= 1;
    if (dragCounterRef.current === 0) {
      setIsDragging(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = 0;
    setIsDragging(false);

    const droppedFiles = Array.from(e.dataTransfer.files);
    const validFiles = droppedFiles.filter((file) => {
      if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
        return false;
      }
      if (file.size > MAX_FILE_SIZE) {
        alert(`File "${file.name}" is too large. Maximum size is 10MB.`);
        return false;
      }
      return true;
    });

    const remainingSlots = MAX_FILES - files.length;
    const filesToAdd = validFiles.slice(0, remainingSlots);

    if (filesToAdd.length > 0) {
      setFiles((prev) => [...prev, ...filesToAdd]);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim() || isUploading) {
      return;
    }

    setIsUploading(true);
    const screenshotUrls: string[] = [];

    try {
      // Upload all files one by one
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        setUploadProgress(`Uploading ${i + 1}/${files.length}...`);

        try {
          const uniqueFileName = feedbackService.generateUniqueFileName(file.name);
          const uploadResult = await feedbackService.uploadScreenshot(file, uniqueFileName);
          screenshotUrls.push(uploadResult.url);
        } catch (error) {
          console.error(`Error uploading file ${file.name}:`, error);
        }
      }

      // Submit feedback with uploaded URLs
      setUploadProgress('Submitting feedback...');
      // Cloud: use appId from hostname, OSS: use pathname
      const page = isInsForgeCloudProject()
        ? window.location.hostname.split('.')[0]
        : location.pathname;
      await feedbackService.createFeedback({
        name: 'OSS User',
        email: 'oss@insforge.dev',
        page,
        feedback: message.trim(),
        screenshots: screenshotUrls,
      });

      // Clean up and close modal
      setMessage('');
      setFiles([]);
      setUploadProgress('');
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      onOpenChange(false);
    } catch (error) {
      console.error('Error sending feedback:', error);
      setUploadProgress('');
    } finally {
      setIsUploading(false);
    }
  };

  const handleModalClose = (isOpen: boolean) => {
    onOpenChange(isOpen);
    if (!isOpen) {
      setMessage('');
      setFiles([]);
      setUploadProgress('');
      setIsUploading(false);
      setIsDragging(false);
      dragCounterRef.current = 0;
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleModalClose}>
      <DialogContent className="bg-white dark:bg-neutral-800 dark:border-neutral-700 p-6 max-w-[640px]">
        <DialogTitle className="text-gray-900 dark:text-white text-2xl font-semibold mb-3">
          Contact Us
        </DialogTitle>

        <Tabs defaultValue="text" className="w-full">
          <TabsList className="grid w-full h-12 grid-cols-2 bg-gray-100 dark:bg-neutral-700 mb-3">
            <TabsTrigger
              value="text"
              className="text-gray-500 dark:text-neutral-400 hover:text-gray-900 dark:hover:text-white data-[state=active]:text-gray-900 dark:data-[state=active]:text-white data-[state=active]:bg-white dark:data-[state=active]:bg-neutral-800 h-9"
            >
              Text Us
            </TabsTrigger>
            <TabsTrigger
              value="form"
              className="text-gray-500 dark:text-neutral-400 hover:text-gray-900 dark:hover:text-white data-[state=active]:text-gray-900 dark:data-[state=active]:text-white data-[state=active]:bg-white dark:data-[state=active]:bg-neutral-800 h-9"
            >
              Submit Form
            </TabsTrigger>
          </TabsList>

          <TabsContent value="text" className="space-y-4">
            <p className="text-gray-500 dark:text-neutral-400 text-base">
              Text the founder directly or reach out on WhatsApp
            </p>

            {isMac ? (
              <a
                href={`imessage:${FOUNDER_PHONE.replace(/[()-\s]/g, '')}`}
                className="pl-3 pr-4 h-12 bg-gray-100 dark:bg-neutral-700 hover:bg-gray-200 dark:hover:bg-neutral-600 rounded-md transition-colors flex items-center justify-center gap-2 text-gray-900 dark:text-white"
              >
                <Smartphone className="w-5 h-5" /> Text us at {FOUNDER_PHONE}
              </a>
            ) : (
              <div className="pl-3 pr-4 h-12 bg-gray-50 dark:bg-neutral-900 border border-gray-200 dark:border-neutral-700 rounded-md flex items-center justify-center gap-2 text-gray-900 dark:text-white">
                <Smartphone className="w-5 h-5" /> Text us at {FOUNDER_PHONE}
              </div>
            )}

            <a
              href="https://wa.me/16179926332"
              target="_blank"
              rel="noopener noreferrer"
              className="h-12 pl-3 pr-4 bg-[#1E8D2E] rounded-md flex items-center justify-center gap-2 hover:bg-[#1E8D2E]/80 transition-colors text-white"
            >
              <svg viewBox="0 0 24 24" className="w-5 h-5 text-white fill-current">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
              </svg>
              Chat on WhatsApp
            </a>
          </TabsContent>

          <TabsContent value="form">
            <form
              onSubmit={(e) => void handleSubmit(e)}
              onPaste={handlePaste}
              onDragEnter={handleDragEnter}
              onDragLeave={handleDragLeave}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              className="space-y-2 relative"
            >
              <div>
                <p className="text-gray-500 dark:text-neutral-400 text-base font-medium mb-2">
                  Submit your feedback to us
                </p>
                <p className="text-gray-400 dark:text-neutral-400 text-sm leading-relaxed">
                  You can upload, paste or drag screenshots to the message box (max {MAX_FILES}{' '}
                  files, 10MB each). Clear screenshots and detailed descriptions help us resolve
                  your issue faster.
                </p>
              </div>

              {/* Message Textarea */}
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Enter your message or paste/drag images here"
                rows={8}
                className={cn(
                  'w-full pl-3 pr-2 py-2 rounded-md border bg-gray-50 dark:bg-neutral-900 border-gray-300 dark:border-neutral-600',
                  'text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-neutral-400 placeholder:text-sm resize-none text-sm',
                  'transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-emerald-500',
                  isDragging && 'opacity-30'
                )}
                required
              />

              {/* Drag Overlay */}
              {isDragging && (
                <div className="absolute inset-0 z-50 flex items-center justify-center pointer-events-none">
                  <div className="absolute inset-4 flex items-center justify-center bg-gray-100/95 dark:bg-neutral-900/95 border-4 border-dashed border-emerald-400 rounded-lg backdrop-blur-sm">
                    <div className="text-center pointer-events-none">
                      <div className="text-emerald-500 dark:text-emerald-400 text-2xl font-bold mb-2">
                        Drop your attachments here
                      </div>
                      <div className="text-gray-500 dark:text-neutral-300 text-base">
                        Max {MAX_FILES} files, 10MB each
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* File Upload */}
              <div className="space-y-3">
                {/* File List */}
                {files.length > 0 &&
                  files.map((file, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => removeFile(index)}
                        className="cursor-pointer flex-shrink-0"
                        disabled={isUploading}
                      >
                        <X className="w-5 h-5 text-gray-400 dark:text-neutral-400 hover:text-gray-900 dark:hover:text-white" />
                      </button>
                      <p className="text-gray-900 dark:text-white text-sm font-medium truncate">
                        {file.name}
                      </p>
                    </div>
                  ))}

                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept={ALLOWED_IMAGE_TYPES.join(',')}
                  onChange={handleFileChange}
                  className="hidden"
                />

                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={files.length >= MAX_FILES || isUploading}
                  className={cn(
                    'pl-2 pr-3 h-8 border rounded-md border-gray-300 dark:border-neutral-600 flex items-center gap-1 cursor-pointer',
                    'text-gray-700 dark:text-white hover:border-gray-500 dark:hover:border-white',
                    'transition-colors',
                    (files.length >= MAX_FILES || isUploading) && 'opacity-50 cursor-not-allowed'
                  )}
                >
                  <Plus className="w-6 h-6" />
                  Add Attachment ({files.length}/{MAX_FILES})
                </button>
              </div>

              {/* Upload Progress */}
              {uploadProgress && (
                <p className="text-emerald-500 dark:text-emerald-400 text-sm font-medium">
                  {uploadProgress}
                </p>
              )}

              {/* Submit Button */}
              <div className="flex justify-end mt-4">
                <ButtonWithLoading
                  type="submit"
                  disabled={!message.trim() || isUploading}
                  loading={isUploading}
                  className={cn(
                    'px-3 h-8 bg-emerald-300 hover:bg-emerald-400 text-black font-medium text-sm rounded-md',
                    'disabled:opacity-50 disabled:cursor-not-allowed'
                  )}
                >
                  {isUploading ? uploadProgress || 'Uploading...' : 'Submit'}
                </ButtonWithLoading>
              </div>
            </form>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
