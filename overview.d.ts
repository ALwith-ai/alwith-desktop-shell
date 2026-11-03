import type { AtlasController } from "@nyssance/atlas/dom"
export declare function connectDesktopOverview(
  controller: AtlasController,
  options?: { openLink?: (url: string) => void | Promise<void>; onError?: (error: unknown) => void }
): () => void
