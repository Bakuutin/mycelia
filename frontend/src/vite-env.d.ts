/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FRONTEND_LIFECYCLE_AT: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
