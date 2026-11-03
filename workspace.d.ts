import type { Context, ReactElement, ReactNode } from "react";
import type { DesktopNavigationLabels } from "./react.js";
export type DesktopScreen = "main" | "leading";
export type DesktopCanvasRegion = "leading" | "chat" | "preview" | "trailing";
export type DesktopWorkspaceLabels = DesktopNavigationLabels;
export interface DesktopCanvasPreview {
  /** The preview region is shown beside chat. */
  open: boolean;
  /** The preview fills the first screen and chat collapses. */
  maximized: boolean;
  /** Dragging the divider below the minimum preview width closes it. */
  onOpenChange?: (open: boolean) => void;
}
export interface DesktopCanvas {
  viewportWidth: number;
  /** The first screen's content width: the viewport less the docked navigation. */
  budget: number;
  /** The region the canvas has settled on. */
  region: DesktopCanvasRegion;
  trailingActive: boolean;
  moving: boolean;
  /** Where the host portals its preview; null until the canvas mounts. */
  previewSlot: HTMLElement | null;
  setPreview: (preview: DesktopCanvasPreview) => void;
  navigate: (region: "chat" | "preview" | "trailing") => void;
}
export declare const DesktopCanvasContext: Context<DesktopCanvas | null>;
export declare function useDesktopCanvas(): DesktopCanvas | null;
/** Portaled menus opened from the navigation retain its floating surface until they close. */
/**
 * The navigation's footer. ALwith's campaign slot sits between `status` and the footer rows. Without
 * this footer the workspace shows the slot at the foot of the navigation instead.
 */
export declare function DesktopNavigationFooter(props: { status?: ReactNode; className?: string; children?: ReactNode }): ReactElement;
export declare const DesktopNavigationOverlayContext: Context<(() => () => void) | null>;
export declare const DesktopTitleBarContext: Context<HTMLElement | null>;
export declare const DesktopWorkspaceControlsContext: Context<HTMLElement | null>;
export declare const DesktopExtensionControlsContext: Context<HTMLElement | null>;
/** Native fullscreen is independent of the DOM fullscreen API and window maximization. */
export declare function useWindowFullscreen(): boolean;
/** The Windows title bar row above the workspace: app icon, sidebar toggle, extension toolbar, workspace controls. */
export declare function DesktopWindowsShell(props: { icon: string; title: string; zoom?: number; enabled?: boolean; children: ReactNode }): ReactNode;
/**
 * The desktop main window: a leading screen, the persistent navigation, a preview region the host fills through
 * `useDesktopCanvas().previewSlot`, chat, and an optional trailing station on ALwith Desktop's Atlas canvas.
 * Atlas owns grouping, snapping and every gutter. Hosts supply pages, not geometry.
 */
export declare function DesktopWorkspace(props: {
  navigation: ReactNode;
  leading?: ReactNode;
  children?: ReactNode;
  trailing?: ReactNode;
  /** Workspace controls at the end of the title bar (portaled into the Windows title bar there). */
  toolbar?: ReactNode;
  statusBar?: ReactNode;
  /** Rendered after the canvas, inside the sidebar provider (dialogs, palettes). */
  overlays?: ReactNode;
  screen?: DesktopScreen;
  onScreenChange?: (screen: DesktopScreen) => void;
  /** The region the canvas settled on (leading, chat, preview or trailing). */
  onRegionChange?: (region: DesktopCanvasRegion) => void;
  initialNavigationPinned?: boolean;
  /** Persists the pin choice; calls are serialized so a rapid toggle cannot restore an older value. */
  onNavigationPinnedChange?: (pinned: boolean) => void | Promise<void>;
  /** Overrides for `desktopNavigationLabels(navigator.language)`. */
  labels?: Partial<DesktopWorkspaceLabels>;
  direction?: "ltr" | "rtl";
  trackpad?: boolean;
  /** Page zoom; keeps the Windows sidebar toggle at native size. */
  zoom?: number;
  openLink?: (url: string) => void;
  onError?: (error: unknown) => void;
}): ReactElement;
