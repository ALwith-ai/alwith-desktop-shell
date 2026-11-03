import type { ReactElement, ReactNode } from "react"
export interface DesktopStatusItemProps {
  server: { url: string; label: string; nonProduction: boolean } | null
  /** Nonstandard macOS signing only; null on other platforms or Developer ID builds. */
  signing: { label: string } | null
  appVersion: string | null
  latestVersion?: string | null
  /** The CLI executable actually used by Runtime, never the adapter package version. */
  cli: { version: string; local: { path: string; fromSource: boolean } | null } | null
  labels: { title: string; server: string; signing: string; version: string; cli: string; source: string }
  openUrl: (url: string) => void | Promise<void>
  revealPath: (path: string) => void | Promise<void>
  onError: (error: unknown) => void
}
export declare function DesktopStatusItem(props: DesktopStatusItemProps): ReactElement | null

export declare function desktopStatusLabels(
  language: string
): DesktopStatusItemProps["labels"] & { development: string }
/**
 * ALwith Desktop's status bar: host slots on the leading side and the server / CLI status item at the
 * trailing corner. The workspace renders it when no status bar is given.
 */
export declare function DesktopStatusBar(props: {
  server?: DesktopStatusItemProps["server"]
  signing?: DesktopStatusItemProps["signing"]
  /** The CLI the Runtime actually runs; defaults to the bundled Codex. */
  readCli?: () => Promise<DesktopStatusItemProps["cli"]>
  openUrl?: DesktopStatusItemProps["openUrl"]
  revealPath?: DesktopStatusItemProps["revealPath"]
  onError?: DesktopStatusItemProps["onError"]
  /** Fills the leading side, such as extension status items. */
  start?: ReactNode
  /** Sits just before the status item, such as drive sync state. */
  end?: ReactNode
}): ReactElement
