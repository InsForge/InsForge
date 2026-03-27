/// <reference types="vite/client" />
/// <reference types="vite-plugin-svgr/client" />

interface ImportMetaEnv {
  readonly VITE_DEBUG_MODE?: string;
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_PUBLIC_POSTHOG_KEY?: string;
  // add more env variables as needed
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
