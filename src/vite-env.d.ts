/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Build-time override for `ENGINE_MAX_VISITS`; see `src/engine/katago/limits.ts`. */
  readonly VITE_KATAGO_MAX_VISITS?: string;
  /** Build-time override for `ENGINE_MAX_TIME_MS`; see `src/engine/katago/limits.ts`. */
  readonly VITE_KATAGO_MAX_TIME_MS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module '*.sgf?raw' {
  const content: string;
  export default content;
}

declare const __APP_VERSION__: string;
declare const __APP_COMMIT__: string;
declare const __APP_COMMIT_DATE__: string;
