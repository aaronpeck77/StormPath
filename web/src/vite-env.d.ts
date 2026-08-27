/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_IOS_BUILD_NUMBER?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare const __APP_VERSION__: string;
declare const __STORMPATH_FLAVOR_STAMP__: string;
declare const __STORMPATH_PLUS_FORCED_STAMP__: string;
declare const __STORMPATH_TEST_PANEL_STAMP__: string;
declare const __STORMPATH_ADMOB_TEST_STAMP__: string;
