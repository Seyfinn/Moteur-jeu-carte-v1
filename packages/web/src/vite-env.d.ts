/// <reference types="vite/client" />

/** Injecté au build par `vite.config.ts` (voir `resolveBuildVersion`). */
declare const __BUILD_VERSION__: { pr: number | null; sha: string | null };
