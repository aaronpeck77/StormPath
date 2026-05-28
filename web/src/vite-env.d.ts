/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_IOS_BUILD_NUMBER?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare const __APP_VERSION__: string;
