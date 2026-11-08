import type { ReactNode } from "react"

/** The shell's zoom level and its actions, for the workspace's `zoom` and the settings row. */
export declare function useDesktopZoom(): {
  level: number
  interaction: number
  levels: readonly number[]
  setLevel: (value: number) => Promise<void>
  zoomIn: () => Promise<void>
  zoomOut: () => Promise<void>
  reset: () => Promise<void>
}
/**
 * U's zoom feedback: after a zoom change in this window, the level with its buttons floats under the
 * titlebar for two seconds, longer while hovered or keyboard-focused. Mounted once per window.
 */
export declare function ZoomFeedback(props: {
  language: string
  showFeedback?: boolean
  onError?: (error: unknown) => void
}): ReactNode
