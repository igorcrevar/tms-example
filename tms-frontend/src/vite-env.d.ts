/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_STAFF_API_BASE_URL?: string;
  readonly VITE_DRIVER_API_BASE_URL?: string;
  readonly VITE_SENTRY_DSN?: string;
  readonly VITE_SENTRY_TRACES_SAMPLE_RATE?: string;
  readonly VITE_SENTRY_RELEASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
