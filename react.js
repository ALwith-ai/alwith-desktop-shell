import { createElement as h } from "react"
import { LeadingNavigation } from "./leading-navigation.js"
import "./overview.css"

/** The leading screen: U's rail beside the page the rail selected. */
export function DesktopLeading({ navigation, children }) {
  return h("div", { className: "desktop-shell-leading" }, navigation, h("div", { className: "desktop-shell-leading-page" }, children))
}

export function DesktopHeader({ title, status, error, children }) {
  return h("header", { className: "desktop-shell-chat-header", "data-tauri-drag-region": true },
    h("span", { className: "desktop-shell-title" }, title),
    children,
    status && h("span", { className: "desktop-shell-status" }, status),
    error && h("span", { className: "desktop-shell-error", role: "alert" }, error))
}

export { DesktopStatusBar, DesktopStatusItem } from "./status-item.js"
export { desktopNavigationLabels, desktopSettingsLabels, desktopUpdateLabels } from "./status-labels.js"
export { useDesktopUpdater, DesktopUpdateStatus } from "./updates.js"
export { LeadingNavigation }
export { DesktopWorkspace, DesktopWindowsShell, DesktopCanvasContext, DesktopNavigationFooter, DesktopNavigationOverlayContext, DesktopTitleBarContext, DesktopWorkspaceControlsContext, DesktopExtensionControlsContext, useDesktopCanvas, useWindowFullscreen } from "./workspace.js"
