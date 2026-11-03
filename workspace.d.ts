import type { Context, ReactElement, ReactNode } from "react";
import type { DesktopNavigationLabels } from "./react.js";
export type DesktopScreen = "main" | "leading";
/**
 * A canvas region (板, Desktop's `REGION` vocabulary): leading, trailing, or a pane named by its bare camelCase ID,
 * as Desktop names `chat`, `preview`, `sidePanes` and `workbench`.
 */
export type DesktopCanvasRegion = "leading" | "trailing" | (string & {});
/**
 * A pane of the main screen. Panes are laid out in the order given: neighbours share a screen while both keep their
 * minimum, otherwise the next one moves on to the following screen whole.
 */
export interface DesktopPane {
  /** A unique camelCase ID other than `leading`, `navigation` and `trailing`; it is also the pane's region name. */
  id: string;
  title: string;
  children: ReactNode;
  /** Narrowest width while sharing a screen; 320 by default. */
  min?: number;
  /** Collapsed to no width; the content stays mounted. A pane without `hidden` cannot be hidden. */
  hidden?: boolean;
  /** Takes a whole screen of its own. */
  maximized?: boolean;
  /** Its start edge carries a divider; the dragged width is the pane's requested width until it is hidden or maximized. */
  resizable?: boolean;
}
export type DesktopWorkspaceLabels = DesktopNavigationLabels;
export interface DesktopCanvas {
  viewportWidth: number;
  /** The first screen's content width: the viewport less the docked navigation. */
  budget: number;
  /** The region the canvas has settled on. */
  region: DesktopCanvasRegion;
  trailingActive: boolean;
  moving: boolean;
  navigate: (region: Exclude<DesktopCanvasRegion, "leading">) => void;
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
 * The desktop main window on ALwith Desktop's Atlas canvas: a leading screen, the persistent navigation, the
 * main screen's panes, and an optional trailing station.
 * Atlas owns grouping, snapping and every gutter. Hosts supply panes, not geometry.
 */
export declare function DesktopWorkspace(props: {
  navigation: ReactNode;
  leading?: ReactNode;
  /** The main screen's panes in canvas order, between leading and trailing. */
  panes: DesktopPane[];
  trailing?: ReactNode;
  /** Workspace controls at the end of the title bar (portaled into the Windows title bar there). */
  toolbar?: ReactNode;
  statusBar?: ReactNode;
  /** Rendered after the canvas, inside the sidebar provider (dialogs, palettes). */
  overlays?: ReactNode;
  screen?: DesktopScreen;
  onScreenChange?: (screen: DesktopScreen) => void;
  /** The region the canvas settled on: leading, trailing or a pane ID. */
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
