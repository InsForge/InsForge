interface ExtensionSetupStepProps {
  videoSrc?: string;
}

export function ExtensionSetupStep({ videoSrc }: ExtensionSetupStepProps) {
  return (
    <div className="flex flex-col gap-4">
      <p className="dark:text-neutral-400 text-gray-500 text-sm leading-6">
        Follow the video guide to complete the setup in the extension.
      </p>

      {/* Video Container */}
      <div className="w-full aspect-video bg-neutral-900 rounded-lg overflow-hidden">
        {videoSrc ? (
          <video
            src={videoSrc}
            autoPlay
            loop
            muted
            playsInline
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-neutral-500 text-sm">
            Video placeholder
          </div>
        )}
      </div>
    </div>
  );
}
