/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_BASE_PATH?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

/** Verze buildu (vite.config.ts `define`). */
declare const __BUILD_ID__: string
