import { ZoomedVideo } from '@/components';
import extensionInstallVideo from '@/assets/videos/extension_install.mp4';

export function ExtensionSetupStep() {
  return (
    <div className="flex flex-col gap-4">
      <p className="dark:text-neutral-400 text-gray-500 text-sm leading-6">
        Follow the video guide to complete the setup in the extension.
      </p>
      {/* Video Container - Click to expand */}
      <ZoomedVideo
        src={extensionInstallVideo}
        className="w-full"
        aria-label="Demo of installing the InsForge extension"
      />
    </div>
  );
}
