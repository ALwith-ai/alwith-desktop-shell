import { jsx as jsx_w77yafs4, jsxs as jsxs_eh6c78nj } from "react/jsx-runtime";
import { connectTrackpad, isViewportResize } from "@nyssance/atlas/dom";
import { desktopDefaults, MIN_BLOCK_WIDTH, resolveAtlasBlocks } from "@nyssance/atlas/layout";
import { useAtlas } from "@nyssance/atlas/react";
import { attachWindowDrag, tauriTrackpad } from "@nyssance/atlas/tauri";
import { getIdentifier } from "@tauri-apps/api/app";
import { isTauri } from "@tauri-apps/api/core";
import { PanelLeftDashedIcon, PanelLeftIcon } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { createPortal, flushSync } from "react-dom";
import { Button } from "@nyssance/shadcn/vega/components/ui/button";
import { SidebarProvider } from "@nyssance/shadcn/vega/components/ui/sidebar";
import { vibemonBanner } from "./campaigns.js";
import { connectDesktopOverview } from "./overview.js";
import { desktopNavigationLabels } from "./status-labels.js";
import { DesktopStatusBar } from "./status-item.js";
import { DesktopUpdateStatus } from "./updates.js";
const SHELL_REGIONS = ["leading", "navigation", "trailing"];
const isMac = () => typeof navigator !== "undefined" && navigator.platform.toLowerCase().includes("mac");
const IS_WINDOWS = typeof navigator !== "undefined" && navigator.platform.includes("Win");
export function useWindowFullscreen() {
  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => {
    if (!isTauri())
      return;
    let disposed = false;
    let revision = 0;
    let unlisten;
    import("@tauri-apps/api/webviewWindow").then(async ({ getCurrentWebviewWindow }) => {
      const window = getCurrentWebviewWindow();
      const refresh = async () => {
        const request = ++revision;
        const value = await window.isFullscreen();
        if (!disposed && request === revision)
          setFullscreen(value);
      };
      unlisten = await window.onResized(() => void refresh());
      if (disposed)
        unlisten();
      else
        await refresh();
    }).catch(console.error);
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
  return fullscreen;
}
export const DesktopTitleBarContext = createContext(null);
export const DesktopWorkspaceControlsContext = createContext(null);
export const DesktopExtensionControlsContext = createContext(null);
export function DesktopWindowsShell({
  icon,
  title,
  zoom = 1,
  enabled = isTauri() && IS_WINDOWS,
  children
}) {
  const [controls, setControls] = useState(null);
  const [workspaceControls, setWorkspaceControls] = useState(null);
  const [extensionControls, setExtensionControls] = useState(null);
  useLayoutEffect(() => {
    if (!enabled)
      return;
    const style = document.documentElement.style;
    style.setProperty("--main-window-zoom", String(zoom));
    style.setProperty("--tauri-plugin-decoration-titlebar-height", `${32 / zoom}px`);
    return () => {
      style.removeProperty("--main-window-zoom");
      style.removeProperty("--tauri-plugin-decoration-titlebar-height");
    };
  }, [enabled, zoom]);
  if (!enabled)
    return children;
  return jsx_w77yafs4(DesktopTitleBarContext.Provider, {
    value: controls,
    children: jsx_w77yafs4(DesktopWorkspaceControlsContext.Provider, {
      value: workspaceControls,
      children: jsx_w77yafs4(DesktopExtensionControlsContext.Provider, {
        value: extensionControls,
        children: jsxs_eh6c78nj("div", {
          className: "flex h-full flex-col",
          children: [
            jsxs_eh6c78nj("header", {
              className: "windows-main-titlebar flex shrink-0 items-center select-none",
              dir: "ltr",
              style: { height: 32 / zoom, paddingRight: "var(--tauri-plugin-decoration-right-clearance, 0px)" },
              children: [
                jsx_w77yafs4("div", {
                  className: "flex h-full shrink-0 items-center",
                  style: { paddingInline: 12 / zoom },
                  title,
                  "data-tauri-drag-region": true,
                  children: jsx_w77yafs4("img", {
                    src: icon,
                    alt: title,
                    draggable: false,
                    className: "pointer-events-none object-contain",
                    style: { width: 24 / zoom, height: 24 / zoom }
                  })
                }),
                jsx_w77yafs4("div", {
                  ref: setControls,
                  className: "flex h-full shrink-0 items-center"
                }),
                jsx_w77yafs4("div", {
                  className: "relative h-full min-w-0 flex-1",
                  "data-tauri-drag-region": true,
                  children: jsx_w77yafs4("div", {
                    ref: setExtensionControls,
                    className: "windows-extension-controls pointer-events-none absolute inset-0 flex items-center px-2"
                  })
                }),
                jsx_w77yafs4("div", {
                  ref: setWorkspaceControls,
                  className: "windows-workspace-controls flex h-full shrink-0 items-center"
                })
              ]
            }),
            jsx_w77yafs4("div", {
              className: "windows-main-content relative min-h-0 flex-1 overflow-hidden",
              children
            })
          ]
        })
      })
    })
  });
}
const NAVIGATION_WIDTH = desktopDefaults.navigationWidth;
const NAVIGATION_PEEK = NAVIGATION_WIDTH - desktopDefaults.gutter;
export const DesktopCanvasContext = createContext(null);
export function useDesktopCanvas() {
  return useContext(DesktopCanvasContext);
}
export const DesktopNavigationOverlayContext = createContext(null);
function groupRegion(api, index, paneIds, preferred) {
  const geometry = api.getGeometry();
  const names = (geometry.groups[index] ?? []).filter((region) => (geometry.regions[region]?.offsetWidth ?? 0) > 0).map((region) => geometry.regions[region]?.dataset.atlasRegion);
  return (preferred && names.includes(preferred) ? preferred : undefined) ?? paneIds.find((id) => names.includes(id)) ?? ["trailing", "leading"].find((name) => names.includes(name)) ?? paneIds[0];
}
function useWorkspaceCanvas({
  screen,
  pinned,
  onScreenChange,
  onRegionChange,
  panes,
  trailing,
  direction,
  labels,
  trackpad,
  openLink,
  onError
}) {
  const [initialDirection] = useState(direction);
  const root = useRef(null);
  const [viewportWidth, setViewportWidth] = useState(0);
  const paneIds = panes.map((pane) => pane.id);
  const first = panes.find((pane) => !pane.hidden)?.id ?? paneIds[0];
  const [requested, setRequested] = useState({});
  const [region, setRegion] = useState(screen === "leading" ? "leading" : first);
  const [moving, setMoving] = useState(false);
  const [peeking, setPeeking] = useState(false);
  const [dragging, setDragging] = useState(null);
  const divider = useRef(false);
  const pending = useRef(null);
  const callbacks = useRef({ onScreenChange, onRegionChange, screen, paneIds, region });
  useLayoutEffect(() => {
    callbacks.current = { onScreenChange, onRegionChange, screen, paneIds, region };
  });
  const statusbar = useCallback(() => root.current?.closest("[data-main-screen]")?.querySelector(".main-window-statusbar") ?? null, []);
  const { ref: atlasRef, atlas: api } = useAtlas(useMemo(() => ({
    direction: initialDirection,
    initialRegion: screen === "leading" ? "leading" : first,
    pagination: { container: statusbar, label: labels.pages, pageLabel: (index) => labels.page(index + 1) },
    overview: { footer: statusbar, label: labels.overview },
    manageInert: false,
    navigationPinned: pinned,
    hoverNavigation: screen === "main",
    navigationWidth: NAVIGATION_WIDTH,
    onNavigationChange: setPeeking,
    flickMinIndex: pinned ? 1 : 0,
    trackpadEnabled: trackpad,
    blocked: () => divider.current,
    watchResize: (node, entries) => {
      if (divider.current || !isViewportResize(node, entries))
        return;
      flushSync(() => setViewportWidth(node.clientWidth));
    }
  }), [initialDirection, screen, first, labels.pages, labels.page, labels.overview, statusbar, pinned, trackpad]));
  const ref = useCallback((node) => {
    root.current = node;
    atlasRef(node);
  }, [atlasRef]);
  useEffect(() => api && isTauri() ? attachWindowDrag(api.root, onError) : undefined, [api, onError]);
  useEffect(() => {
    if (!api || !trackpad || !isTauri())
      return;
    return connectTrackpad(api, tauriTrackpad({ command: "plugin:alwith-desktop-shell|has_trackpad" }), onError);
  }, [api, trackpad, onError]);
  useEffect(() => api ? connectDesktopOverview(api, { openLink }) : undefined, [api, openLink]);
  useLayoutEffect(() => {
    if (api)
      setViewportWidth(api.root.clientWidth);
  }, [api]);
  const screenWidth = Math.max(0, viewportWidth - (pinned ? NAVIGATION_WIDTH : 0));
  const blocks = resolveAtlasBlocks({
    screen: screenWidth,
    nextScreen: viewportWidth,
    blocks: panes.filter((pane) => !pane.hidden).map((pane) => ({
      name: pane.id,
      min: pane.min ?? MIN_BLOCK_WIDTH,
      width: pane.maximized ? screenWidth : requested[pane.id]
    }))
  });
  const sizes = {
    leading: `calc(100% - ${pinned ? NAVIGATION_PEEK : NAVIGATION_WIDTH}px)`,
    panes: Object.fromEntries(paneIds.map((id) => [id, blocks[id] ?? 0])),
    trailing: trailing ? desktopDefaults.trailingWidth : 0
  };
  const geometryKey = `${viewportWidth}:${pinned}:${paneIds.map((id) => `${id}=${sizes.panes[id]}`).join(",")}:${sizes.trailing}:${direction}`;
  const layoutKey = panes.map((pane) => `${pane.id}:${pane.hidden === true}:${pane.maximized === true}`).join(",");
  const previousPanes = useRef(panes);
  useLayoutEffect(() => {
    const before = new Map(previousPanes.current.map((pane) => [pane.id, pane]));
    previousPanes.current = panes;
    const forget = panes.filter((pane) => pane.hidden || pane.maximized).map((pane) => pane.id);
    if (forget.some((id) => (id in requested)))
      setRequested((current) => Object.fromEntries(Object.entries(current).filter(([id]) => !forget.includes(id))));
    const changed = panes.find((pane) => !pane.hidden && pane.maximized && before.has(pane.id) && !before.get(pane.id).maximized);
    if (changed)
      pending.current = { region: changed.id, animate: true };
  }, [layoutKey]);
  const settle = useCallback((next) => {
    callbacks.current.region = next;
    setRegion(next);
    callbacks.current.onRegionChange?.(next);
    const nextScreen = next === "leading" ? "leading" : "main";
    if (nextScreen !== callbacks.current.screen)
      callbacks.current.onScreenChange?.(nextScreen);
  }, []);
  const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const show = useCallback((target, animate, allowReplacement = false) => {
    if (!api)
      return false;
    const geometry = api.getGeometry();
    const find = (name) => geometry.groups.findIndex((group) => group.some((item) => geometry.regions[item]?.dataset.atlasRegion === name && geometry.regions[item].offsetWidth > 0));
    const candidate = find(target) !== -1 ? target : allowReplacement && callbacks.current.paneIds.includes(target) ? callbacks.current.paneIds.find((id) => find(id) !== -1) : undefined;
    const index = find(candidate);
    const resolved = candidate && callbacks.current.paneIds.includes(candidate) ? callbacks.current.paneIds.find((id) => find(id) === index) : candidate;
    if (!resolved)
      return false;
    api.cancelInput();
    api.goTo(resolved, { instant: !animate || reduced() });
    settle(resolved);
    return true;
  }, [api, settle]);
  const appliedKey = useRef(null);
  useLayoutEffect(() => {
    if (!api || viewportWidth === 0 || appliedKey.current === geometryKey || divider.current)
      return;
    appliedKey.current = geometryKey;
    const target = pending.current ?? { region: callbacks.current.region, animate: false };
    api.refresh({ direction });
    pending.current = null;
    show(target.region, target.animate, true);
  }, [api, viewportWidth, geometryKey, direction, region, dragging, show, settle]);
  useEffect(() => {
    if (!api)
      return;
    const stop = api.subscribe((state) => setMoving(state.moving));
    const settled = () => {
      if (divider.current)
        return;
      setMoving(false);
      settle(groupRegion(api, api.getGeometry().selected, callbacks.current.paneIds, api.getState().activeRegion));
    };
    api.on("settle", settled);
    const stopOverview = api.overview.subscribe((state) => {
      if (state === null)
        settled();
    });
    return () => {
      stopOverview();
      stop();
      api.off("settle", settled);
      api.cancelInput();
    };
  }, [api, settle]);
  const previousScreen = useRef(screen);
  useEffect(() => {
    if (!api || previousScreen.current === screen)
      return;
    previousScreen.current = screen;
    if (screen === "leading" === (groupRegion(api, api.getGeometry().selected, callbacks.current.paneIds) === "leading"))
      return;
    show(screen === "leading" ? "leading" : callbacks.current.paneIds[0], true, true);
  }, [api, screen, show]);
  const navigate = useCallback((target) => {
    pending.current = show(target, true) ? null : { region: target, animate: true };
  }, [show]);
  const dragStart = useRef(0);
  const dragBounds = useRef({ min: 0, max: 0 });
  const divide = {
    start: (id) => {
      dragStart.current = sizes.panes[id] ?? 0;
      const geometry = api?.getGeometry();
      const group = geometry?.groups.find((indices) => indices.some((index) => geometry.regions[index]?.dataset.atlasRegion === id));
      const names = group?.map((index) => geometry.regions[index]?.dataset.atlasRegion) ?? paneIds;
      const siblings = panes.filter((pane) => pane.id !== id && !pane.hidden && names.includes(pane.id));
      const minimum = panes.find((pane) => pane.id === id)?.min ?? MIN_BLOCK_WIDTH;
      const sharedWidth = names.includes("navigation") ? screenWidth : viewportWidth;
      const reserved = siblings.reduce((sum, pane) => sum + (pane.min ?? MIN_BLOCK_WIDTH), 0);
      dragBounds.current = { min: 1, max: Math.max(minimum, sharedWidth - reserved) };
      divider.current = true;
      setDragging(id);
      api?.cancelInput();
    },
    drag: (id, dx) => {
      const next = Math.round(Math.max(dragBounds.current.min, Math.min(dragBounds.current.max, dragStart.current - dx)));
      setRequested((current) => current[id] === next ? current : { ...current, [id]: next });
    },
    end: () => {
      divider.current = false;
      setDragging(null);
    }
  };
  const context = useMemo(() => ({
    viewportWidth,
    budget: screenWidth,
    region,
    trailingActive: region === "trailing",
    moving,
    navigate
  }), [viewportWidth, screenWidth, region, moving, navigate]);
  return {
    ref,
    sizes,
    context,
    region,
    moving,
    peeking,
    dragging,
    divide
  };
}
function PaneDivider({
  direction,
  onStart,
  onDrag,
  onEnd
}) {
  const startX = useRef(null);
  const previousUserSelect = useRef("");
  const pending = useRef(null);
  const frame = useRef(0);
  const drag = useRef(onDrag);
  drag.current = onDrag;
  const flush = () => {
    cancelAnimationFrame(frame.current);
    frame.current = 0;
    if (pending.current !== null) {
      const delta = pending.current;
      pending.current = null;
      drag.current(delta);
    }
  };
  const finish = (applyPending = true) => {
    if (startX.current === null)
      return;
    if (applyPending)
      flush();
    else {
      cancelAnimationFrame(frame.current);
      frame.current = 0;
      pending.current = null;
    }
    startX.current = null;
    document.body.style.userSelect = previousUserSelect.current;
    onEnd();
  };
  useEffect(() => () => {
    cancelAnimationFrame(frame.current);
    if (startX.current !== null)
      document.body.style.userSelect = previousUserSelect.current;
  }, []);
  return jsx_w77yafs4("div", {
    "data-no-drag": true,
    className: "desktop-shell-divider",
    onPointerDown: (event) => {
      if (event.button !== 0 || startX.current !== null)
        return;
      event.preventDefault();
      startX.current = event.clientX;
      previousUserSelect.current = document.body.style.userSelect;
      document.body.style.userSelect = "none";
      onStart();
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    onPointerMove: (event) => {
      if (startX.current === null)
        return;
      event.preventDefault();
      pending.current = (event.clientX - startX.current) * (direction === "rtl" ? -1 : 1);
      if (!frame.current)
        frame.current = requestAnimationFrame(flush);
    },
    onPointerUp: () => finish(),
    onPointerCancel: () => finish(false),
    onLostPointerCapture: () => finish(false)
  });
}
const FIRST_PARTY = ["ai.alwith.u"];
const CAMPAIGNS = [{ id: "vibemon", image: vibemonBanner }];
function isFirstParty(identifier) {
  return FIRST_PARTY.some((id) => identifier === id || identifier.startsWith(`${id}.`));
}
const CampaignSlotContext = createContext(null);
export function DesktopNavigationFooter({
  status,
  className,
  children
}) {
  const slot = useContext(CampaignSlotContext);
  useLayoutEffect(() => slot?.claim(), [slot]);
  return jsxs_eh6c78nj("div", {
    "data-slot": "sidebar-footer",
    className: className ? `desktop-shell-navigation-footer ${className}` : "desktop-shell-navigation-footer",
    children: [
      status === undefined ? jsx_w77yafs4(DesktopUpdateStatus, {}) : status,
      slot && jsx_w77yafs4(NavigationCampaigns, {
        label: slot.label,
        onOpen: slot.onOpen
      }),
      children
    ]
  });
}
function NavigationCampaigns({ label, onOpen }) {
  const [shown, setShown] = useState(true);
  useEffect(() => {
    if (!isTauri())
      return;
    let disposed = false;
    getIdentifier().then((identifier) => {
      if (!disposed)
        setShown(!isFirstParty(identifier));
    }).catch(console.error);
    return () => {
      disposed = true;
    };
  }, []);
  if (!shown)
    return null;
  return jsx_w77yafs4("div", {
    className: "desktop-shell-campaigns",
    "data-slot": "navigation-campaigns",
    children: CAMPAIGNS.map((campaign) => jsx_w77yafs4(Button, {
      variant: "ghost",
      "aria-label": label,
      onClick: onOpen,
      className: "aspect-[16/5] h-auto w-full cursor-pointer overflow-hidden rounded-none border-0 p-0 transition-none",
      children: jsx_w77yafs4("img", {
        src: campaign.image,
        alt: "",
        className: "size-full object-cover",
        draggable: false
      })
    }, campaign.id))
  });
}
const defaultLabels = () => desktopNavigationLabels(typeof navigator === "undefined" ? "en" : navigator.language);
export function DesktopWorkspace({
  navigation,
  leading,
  panes,
  trailing,
  toolbar,
  statusBar,
  overlays,
  screen = "main",
  onScreenChange,
  onRegionChange,
  initialNavigationPinned = true,
  onNavigationPinnedChange,
  labels: labelOverrides,
  direction = "ltr",
  trackpad = true,
  zoom = 1,
  openLink,
  onError = console.error
}) {
  const paneIds = panes.map((pane) => pane.id);
  if (paneIds.length === 0 || new Set(paneIds).size !== paneIds.length || paneIds.some((id) => !/^[a-z][a-zA-Z0-9]*$/.test(id) || SHELL_REGIONS.includes(id)))
    throw new Error("Panes need unique camelCase IDs other than leading, navigation and trailing");
  const first = panes.find((pane) => !pane.hidden)?.id ?? paneIds[0];
  const labels = { ...defaultLabels(), ...labelOverrides };
  const titlebar = useContext(DesktopTitleBarContext);
  const workspaceControls = useContext(DesktopWorkspaceControlsContext);
  const fullscreen = useWindowFullscreen();
  const [pinned, setPinned] = useState(initialNavigationPinned);
  const [presentation, setPresentation] = useState(initialNavigationPinned ? "docked" : "floating");
  const canvas = useWorkspaceCanvas({
    screen,
    pinned,
    onScreenChange,
    onRegionChange,
    panes,
    trailing: trailing !== undefined && trailing !== null && trailing !== false,
    direction,
    labels,
    trackpad,
    openLink,
    onError
  });
  const navigate = canvas.context.navigate;
  const mainActive = screen === "main";
  const showMainControls = mainActive && canvas.region !== "trailing";
  const docked = !mainActive || pinned;
  const visible = docked || canvas.peeking;
  const panelId = useId();
  const panel = useRef(null);
  const toggle = useRef(null);
  const overlayCount = useRef(0);
  const saving = useRef(Promise.resolve());
  const [footers, setFooters] = useState(0);
  const claimCampaigns = useCallback(() => {
    setFooters((count) => count + 1);
    return () => setFooters((count) => count - 1);
  }, []);
  const campaignSlot = useMemo(() => ({ label: labels.campaigns, onOpen: () => onScreenChange?.("leading"), claim: claimCampaigns }), [labels.campaigns, onScreenChange, claimCampaigns]);
  const retainOverlay = useCallback(() => {
    overlayCount.current += 1;
    panel.current?.parentElement?.setAttribute("data-popup-open", "");
    return () => {
      overlayCount.current -= 1;
      if (overlayCount.current === 0)
        panel.current?.parentElement?.removeAttribute("data-popup-open");
    };
  }, []);
  const changePinned = useCallback((next) => {
    if (!mainActive)
      return;
    if (canvas.region !== first)
      navigate(first);
    setPresentation("docked");
    setPinned(next);
    saving.current = saving.current.then(() => onNavigationPinnedChange?.(next)).catch(onError);
  }, [mainActive, canvas.region, first, navigate, onNavigationPinnedChange, onError]);
  useEffect(() => {
    if (canvas.peeking)
      setPresentation("floating");
  }, [canvas.peeking]);
  useEffect(() => {
    if (!visible && panel.current?.contains(document.activeElement))
      toggle.current?.focus({ preventScroll: true });
  }, [visible, showMainControls]);
  const ToggleIcon = pinned ? PanelLeftIcon : PanelLeftDashedIcon;
  const sidebarToggle = jsx_w77yafs4("div", {
    className: titlebar ? "windows-sidebar-toggle" : "main-sidebar-toggle",
    style: titlebar ? { width: 32 / zoom, height: 32 / zoom } : undefined,
    children: jsx_w77yafs4(Button, {
      ref: toggle,
      variant: "ghost",
      size: "icon-xs",
      role: "switch",
      "aria-label": labels.pin,
      "aria-checked": docked,
      "aria-expanded": visible,
      "aria-controls": panelId,
      "data-atlas-navigation-trigger": true,
      title: pinned ? labels.unpin : labels.pin,
      className: "text-sidebar-foreground",
      onClick: () => docked && canvas.region !== first ? navigate(first) : changePinned(!docked),
      children: jsx_w77yafs4(ToggleIcon, {
        className: "size-4 rtl:-scale-x-100"
      })
    })
  });
  return jsxs_eh6c78nj(SidebarProvider, {
    open: docked,
    onOpenChange: changePinned,
    className: "relative h-full min-h-0 flex-col overflow-clip",
    "data-main-screen": screen,
    "data-canvas-moving": canvas.moving,
    "data-canvas-pinned": pinned,
    "data-sidebar-mode": docked ? "pinned" : visible ? "floating" : "hidden",
    "data-sidebar-presentation": docked || canvas.moving ? "docked" : presentation,
    style: {
      "--sidebar-width": `${desktopDefaults.navigationWidth}px`,
      "--main-surface-radius": `${desktopDefaults.surfaceRadius}px`,
      "--main-titlebar-height": `${desktopDefaults.insetTop}px`,
      "--sidebar-toggle-left": isMac() && !fullscreen ? "calc(80px * var(--window-zoom-correction))" : "8px"
    },
    children: [
      showMainControls && workspaceControls && toolbar && createPortal(toolbar, workspaceControls),
      showMainControls && titlebar && createPortal(sidebarToggle, titlebar),
      jsx_w77yafs4(DesktopCanvasContext.Provider, {
        value: canvas.context,
        children: jsx_w77yafs4("div", {
          className: "main-window-body",
          dir: direction,
          children: jsxs_eh6c78nj("div", {
            ref: canvas.ref,
            className: "main-canvas-viewport",
            "data-atlas-layout": "sized",
            children: [
              jsxs_eh6c78nj("header", {
                className: "main-window-titlebar",
                "data-atlas-topbar": true,
                children: [
                  showMainControls && !titlebar && sidebarToggle,
                  showMainControls && !workspaceControls && toolbar
                ]
              }),
              jsx_w77yafs4("footer", {
                className: "main-window-statusbar",
                "data-atlas-footer": true,
                children: statusBar === undefined ? jsx_w77yafs4(DesktopStatusBar, {
                  openUrl: openLink,
                  onError
                }) : statusBar
              }),
              jsxs_eh6c78nj("div", {
                className: "main-screen-track",
                "data-atlas-track": true,
                children: [
                  jsx_w77yafs4("div", {
                    className: "main-screen-leading",
                    "data-screen-panel": "leading",
                    "data-atlas-region": "leading",
                    "data-atlas-leading": true,
                    style: { width: canvas.sizes.leading },
                    inert: mainActive,
                    "aria-hidden": mainActive,
                    children: leading
                  }),
                  jsx_w77yafs4(DesktopNavigationOverlayContext.Provider, {
                    value: retainOverlay,
                    children: jsx_w77yafs4("div", {
                      className: "main-sidebar-shell",
                      "data-atlas-region": "navigation",
                      "data-atlas-navigation": true,
                      style: { width: desktopDefaults.navigationWidth },
                      children: jsx_w77yafs4("div", {
                        className: "main-sidebar-viewport",
                        "data-atlas-navigation-surface": true,
                        id: panelId,
                        children: jsxs_eh6c78nj("div", {
                          ref: panel,
                          className: "main-sidebar-panel",
                          inert: !visible && !canvas.moving,
                          "aria-hidden": !visible && !canvas.moving,
                          children: [
                            jsx_w77yafs4(CampaignSlotContext.Provider, {
                              value: campaignSlot,
                              children: jsx_w77yafs4("div", {
                                className: "main-sidebar-content",
                                children: navigation
                              })
                            }),
                            footers === 0 && jsx_w77yafs4(NavigationCampaigns, {
                              label: labels.campaigns,
                              onOpen: campaignSlot.onOpen
                            })
                          ]
                        })
                      })
                    })
                  }),
                  panes.map((pane) => jsxs_eh6c78nj("div", {
                    className: "main-screen-pane",
                    "data-screen-panel": pane.id,
                    "data-atlas-region": pane.id,
                    "data-atlas-collapsed": canvas.sizes.panes[pane.id] === 0,
                    "aria-label": pane.title,
                    style: { width: canvas.sizes.panes[pane.id] },
                    inert: !mainActive || pane.hidden,
                    "aria-hidden": !mainActive || pane.hidden,
                    children: [
                      jsx_w77yafs4("div", {
                        className: "main-screen-pane-body",
                        "data-atlas-surface": pane.bare ? undefined : "",
                        children: pane.children
                      }),
                      pane.resizable && (canvas.dragging === pane.id || !pane.hidden && !pane.maximized) && jsx_w77yafs4(PaneDivider, {
                        direction,
                        onStart: () => canvas.divide.start(pane.id),
                        onDrag: (dx) => canvas.divide.drag(pane.id, dx),
                        onEnd: canvas.divide.end
                      })
                    ]
                  }, pane.id)),
                  jsx_w77yafs4("aside", {
                    className: "main-screen-trailing",
                    "data-screen-panel": "trailing",
                    "data-atlas-region": "trailing",
                    "data-atlas-trailing": true,
                    "data-atlas-collapsed": canvas.sizes.trailing === 0,
                    style: { width: canvas.sizes.trailing },
                    inert: !canvas.context.trailingActive && !canvas.moving,
                    children: trailing
                  })
                ]
              })
            ]
          })
        })
      }),
      overlays
    ]
  });
}
