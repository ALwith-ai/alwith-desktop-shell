import { type AtlasController, connectTrackpad, isViewportResize } from "@nyssance/atlas/dom"
import { desktopDefaults, MIN_BLOCK_WIDTH, MIN_PREVIEW_WIDTH, resolveAtlasBlocks } from "@nyssance/atlas/layout"
import { useAtlas } from "@nyssance/atlas/react"
import { attachWindowDrag, tauriTrackpad } from "@nyssance/atlas/tauri"
import { getIdentifier } from "@tauri-apps/api/app"
import { isTauri } from "@tauri-apps/api/core"
import { PanelLeftDashedIcon, PanelLeftIcon } from "lucide-react"
import {
  createContext,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from "react"
import { createPortal } from "react-dom"

import { Button } from "@/components/ui/button"
import { SidebarProvider } from "@/components/ui/sidebar"

import { vibemonBanner } from "../campaigns.js"
import { connectDesktopOverview } from "../overview.js"
import { desktopNavigationLabels } from "../status-labels.js"
import { DesktopStatusBar } from "./status-item.js"
import { DesktopUpdateStatus } from "./updates.js"

export type DesktopScreen = "main" | "leading"
export type DesktopCanvasRegion = "leading" | "chat" | "preview" | "trailing"

export interface DesktopWorkspaceLabels {
  pin: string
  unpin: string
  pages: string
  page: (number: number) => string
  overview: string
  campaigns: string
}

const isMac = () => typeof navigator !== "undefined" && navigator.platform.toLowerCase().includes("mac")
const IS_WINDOWS = typeof navigator !== "undefined" && navigator.platform.includes("Win")

/** Native fullscreen is independent of the DOM fullscreen API and window maximization. */
export function useWindowFullscreen(): boolean {
  const [fullscreen, setFullscreen] = useState(false)
  useEffect(() => {
    if (!isTauri()) return
    let disposed = false
    let revision = 0
    let unlisten: (() => void) | undefined
    void import("@tauri-apps/api/webviewWindow")
      .then(async ({ getCurrentWebviewWindow }) => {
        const window = getCurrentWebviewWindow()
        const refresh = async () => {
          const request = ++revision
          const value = await window.isFullscreen()
          if (!disposed && request === revision) setFullscreen(value)
        }
        unlisten = await window.onResized(() => void refresh())
        if (disposed) unlisten()
        else await refresh()
      })
      .catch(console.error)
    return () => {
      disposed = true
      unlisten?.()
    }
  }, [])
  return fullscreen
}

// Windows draws its own title bar row; the workspace portals its controls into these slots.
export const DesktopTitleBarContext = createContext<HTMLElement | null>(null)
export const DesktopWorkspaceControlsContext = createContext<HTMLElement | null>(null)
export const DesktopExtensionControlsContext = createContext<HTMLElement | null>(null)

/** The Windows title bar row above the workspace: app icon, sidebar toggle, extension toolbar, workspace controls. */
export function DesktopWindowsShell({
  icon,
  title,
  zoom = 1,
  enabled = isTauri() && IS_WINDOWS,
  children
}: {
  icon: string
  title: string
  zoom?: number
  enabled?: boolean
  children: ReactNode
}): ReactNode {
  const [controls, setControls] = useState<HTMLDivElement | null>(null)
  const [workspaceControls, setWorkspaceControls] = useState<HTMLDivElement | null>(null)
  const [extensionControls, setExtensionControls] = useState<HTMLDivElement | null>(null)
  useLayoutEffect(() => {
    if (!enabled) return
    const style = document.documentElement.style
    style.setProperty("--main-window-zoom", String(zoom))
    style.setProperty("--tauri-plugin-decoration-titlebar-height", `${32 / zoom}px`)
    return () => {
      style.removeProperty("--main-window-zoom")
      style.removeProperty("--tauri-plugin-decoration-titlebar-height")
    }
  }, [enabled, zoom])
  if (!enabled) return children
  return (
    <DesktopTitleBarContext.Provider value={controls}>
      <DesktopWorkspaceControlsContext.Provider value={workspaceControls}>
        <DesktopExtensionControlsContext.Provider value={extensionControls}>
          <div className="flex h-full flex-col">
            <header
              className="windows-main-titlebar flex shrink-0 items-center select-none"
              dir="ltr"
              style={{ height: 32 / zoom, paddingRight: "var(--tauri-plugin-decoration-right-clearance, 0px)" }}
            >
              <div
                className="flex h-full shrink-0 items-center"
                style={{ paddingInline: 12 / zoom }}
                title={title}
                data-tauri-drag-region
              >
                <img
                  src={icon}
                  alt={title}
                  draggable={false}
                  className="pointer-events-none object-contain"
                  style={{ width: 24 / zoom, height: 24 / zoom }}
                />
              </div>
              <div ref={setControls} className="flex h-full shrink-0 items-center" />
              <div className="relative h-full min-w-0 flex-1" data-tauri-drag-region>
                <div
                  ref={setExtensionControls}
                  className="windows-extension-controls pointer-events-none absolute inset-0 flex items-center px-2"
                />
              </div>
              <div
                ref={setWorkspaceControls}
                className="windows-workspace-controls flex h-full shrink-0 items-center"
              />
            </header>
            <div className="windows-main-content relative min-h-0 flex-1 overflow-hidden">{children}</div>
          </div>
        </DesktopExtensionControlsContext.Provider>
      </DesktopWorkspaceControlsContext.Provider>
    </DesktopTitleBarContext.Provider>
  )
}

const NAVIGATION_WIDTH = desktopDefaults.navigationWidth
// The leading screen leaves the navigation's visible width beside it (248 - 4). A full 248 would let
// Atlas group the docked navigation with the leading screen instead of the first content screen.
const NAVIGATION_PEEK = NAVIGATION_WIDTH - desktopDefaults.gutter

export interface DesktopCanvasPreview {
  /** The preview region is shown beside chat. */
  open: boolean
  /** The preview fills the first screen and chat collapses. */
  maximized: boolean
  /** Dragging the divider below the minimum preview width closes it. */
  onOpenChange?: (open: boolean) => void
}
export interface DesktopCanvas {
  viewportWidth: number
  /** The first screen's content width: the viewport less the docked navigation. */
  budget: number
  /** The region the canvas has settled on. */
  region: DesktopCanvasRegion
  trailingActive: boolean
  moving: boolean
  /** Where the host portals its preview; null until the canvas mounts. */
  previewSlot: HTMLElement | null
  setPreview: (preview: DesktopCanvasPreview) => void
  navigate: (region: "chat" | "preview" | "trailing") => void
}
export const DesktopCanvasContext = createContext<DesktopCanvas | null>(null)
export function useDesktopCanvas(): DesktopCanvas | null {
  return useContext(DesktopCanvasContext)
}

/** Portaled menus opened from the navigation retain its floating surface until they close. */
export const DesktopNavigationOverlayContext = createContext<(() => () => void) | null>(null)

const REGION_PRIORITY: DesktopCanvasRegion[] = ["chat", "preview", "trailing", "leading"]
function groupRegion(api: AtlasController, index: number): DesktopCanvasRegion {
  const geometry = api.getGeometry()
  // A region collapsed to nothing (a closed preview) is never the foreground.
  const names = (geometry.groups[index] ?? [])
    .filter((region) => (geometry.regions[region]?.offsetWidth ?? 0) > 0)
    .map((region) => geometry.regions[region]?.dataset.atlasRegion)
  return REGION_PRIORITY.find((name) => names.includes(name)) ?? "chat"
}

/** ALwith Desktop's Atlas canvas: Atlas owns snapping, grouping and every gutter. */
function useWorkspaceCanvas({
  screen,
  pinned,
  onScreenChange,
  onRegionChange,
  trailing,
  direction,
  labels,
  trackpad,
  openLink,
  onError
}: {
  screen: DesktopScreen
  pinned: boolean
  onScreenChange?: (screen: DesktopScreen) => void
  onRegionChange?: (region: DesktopCanvasRegion) => void
  trailing: boolean
  direction: "ltr" | "rtl"
  labels: DesktopWorkspaceLabels
  trackpad: boolean
  openLink?: (url: string) => void
  onError: (error: unknown) => void
}) {
  const [initialDirection] = useState(direction)
  const root = useRef<HTMLDivElement | null>(null)
  const [viewportWidth, setViewportWidth] = useState(0)
  const [preview, setPreviewState] = useState<DesktopCanvasPreview>({ open: false, maximized: false })
  const [previewWidth, setPreviewWidth] = useState(0)
  const [previewSlot, setPreviewSlot] = useState<HTMLElement | null>(null)
  const [region, setRegion] = useState<DesktopCanvasRegion>(screen === "leading" ? "leading" : "chat")
  const [moving, setMoving] = useState(false)
  const [peeking, setPeeking] = useState(false)
  const [draggingPreview, setDraggingPreview] = useState(false)
  const divider = useRef(false)
  const pending = useRef<{ region: DesktopCanvasRegion; animate: boolean } | null>(null)
  const callbacks = useRef({ onScreenChange, onRegionChange, screen })
  useLayoutEffect(() => {
    callbacks.current = { onScreenChange, onRegionChange, screen }
  }, [onScreenChange, onRegionChange, screen])
  const statusbar = () =>
    root.current?.closest("[data-main-screen]")?.querySelector<HTMLElement>(".main-window-statusbar") ?? null
  const { ref: atlasRef, atlas: api } = useAtlas({
    direction: initialDirection,
    initialRegion: screen === "leading" ? "leading" : "chat",
    pagination: { container: statusbar, label: labels.pages, pageLabel: (index: number) => labels.page(index + 1) },
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
      if (divider.current || !isViewportResize(node, entries)) return
      setViewportWidth(node.clientWidth)
    }
  })
  const ref = useCallback(
    (node: HTMLDivElement | null): void => {
      root.current = node
      atlasRef(node)
    },
    [atlasRef]
  )
  useEffect(() => (api && isTauri() ? attachWindowDrag(api.root, onError) : undefined), [api, onError])
  useEffect(() => {
    if (!api || !trackpad || !isTauri()) return
    return connectTrackpad(api, tauriTrackpad({ command: "plugin:alwith-desktop-shell|has_trackpad" }), onError)
  }, [api, trackpad, onError])
  useEffect(() => (api ? connectDesktopOverview(api, { openLink }) : undefined), [api, openLink])
  useLayoutEffect(() => {
    if (api) setViewportWidth(api.root.clientWidth)
  }, [api])

  // The main screen's blocks in order: chat, then the preview. Maximized, the preview asks for a whole screen, which
  // leaves no room beside chat, so it takes the next screen to the right and chat keeps the first.
  const screenWidth = Math.max(0, viewportWidth - (pinned ? NAVIGATION_WIDTH : 0))
  const blocks = resolveAtlasBlocks({
    screen: screenWidth,
    nextScreen: viewportWidth,
    blocks: [
      { name: "chat" as const, min: MIN_BLOCK_WIDTH },
      ...(preview.open
        ? [{ name: "preview" as const, min: MIN_PREVIEW_WIDTH, width: preview.maximized ? screenWidth : previewWidth }]
        : [])
    ]
  })
  const widths = { screen: screenWidth, chat: blocks.chat, preview: blocks.preview ?? 0 }
  const sizes = {
    leading: `calc(100% - ${pinned ? NAVIGATION_PEEK : NAVIGATION_WIDTH}px)`,
    preview: widths.preview,
    chat: widths.chat,
    trailing: trailing ? desktopDefaults.trailingWidth : 0
  }
  const geometryKey = `${viewportWidth}:${pinned}:${sizes.preview}:${sizes.chat}:${sizes.trailing}:${direction}`

  const settle = useCallback((next: DesktopCanvasRegion) => {
    setRegion(next)
    callbacks.current.onRegionChange?.(next)
    const nextScreen = next === "leading" ? "leading" : "main"
    if (nextScreen !== callbacks.current.screen) callbacks.current.onScreenChange?.(nextScreen)
  }, [])
  const reduced = (): boolean => window.matchMedia("(prefers-reduced-motion: reduce)").matches
  const show = useCallback(
    (target: DesktopCanvasRegion, animate: boolean): void => {
      if (!api) return
      const geometry = api.getGeometry()
      const find = (name: DesktopCanvasRegion): number =>
        geometry.groups.findIndex((group) =>
          group.some(
            (item) => geometry.regions[item]?.dataset.atlasRegion === name && geometry.regions[item]!.offsetWidth > 0
          )
        )
      // A closed preview has no width, so the main screen falls back to chat (and the reverse).
      const fallback = target === "chat" ? "preview" : target === "preview" ? "chat" : null
      let index = find(target)
      if (index === -1 && fallback) index = find(fallback)
      if (index === -1) return
      api.cancelInput()
      api.goToSnap(index, { instant: !animate || reduced() })
    },
    [api]
  )

  // Rebuild once per geometry change, then return to the region the host asked for or the one on screen.
  const appliedKey = useRef<string | null>(null)
  useLayoutEffect(() => {
    if (!api || viewportWidth === 0 || appliedKey.current === geometryKey || divider.current) return
    appliedKey.current = geometryKey
    api.refresh({ direction })
    const target = pending.current ?? { region, animate: false }
    pending.current = null
    show(target.region === "preview" && !preview.open ? "chat" : target.region, target.animate)
    // Collapsing or restoring a region can change the foreground without moving the canvas.
    if (!target.animate) settle(groupRegion(api, api.getGeometry().selected))
  }, [api, viewportWidth, geometryKey, direction, region, preview.open, show, settle])

  useEffect(() => {
    if (!api) return
    const stop = api.subscribe((state: { moving: boolean }) => setMoving(state.moving))
    const settled = (): void => {
      setMoving(false)
      settle(groupRegion(api, api.getGeometry().selected))
    }
    api.on("settle", settled)
    return () => {
      stop()
      api.off("settle", settled)
      api.cancelInput()
    }
  }, [api, settle])

  // The host's screen is a request; the canvas reports back once it settles. Compare against the canvas's own
  // selection, not the last settled region, which lags while a move is still running.
  const previousScreen = useRef(screen)
  useEffect(() => {
    if (!api || previousScreen.current === screen) return
    previousScreen.current = screen
    if ((screen === "leading") === (groupRegion(api, api.getGeometry().selected) === "leading")) return
    show(screen === "leading" ? "leading" : "chat", true)
  }, [api, screen, show])

  const navigate = useCallback(
    (target: "chat" | "preview" | "trailing"): void => {
      pending.current = { region: target, animate: true }
      show(target, true)
    },
    [show]
  )
  const onPreviewOpenChange = useRef<DesktopCanvasPreview["onOpenChange"]>(undefined)
  const setPreview = useCallback((next: DesktopCanvasPreview): void => {
    onPreviewOpenChange.current = next.onOpenChange
    setPreviewState((current) => {
      if (current.open === next.open && current.maximized === next.maximized) return current
      // Maximizing moves to the preview's own screen; restoring returns to chat beside it.
      if (next.open && next.maximized !== current.maximized)
        pending.current = { region: next.maximized ? "preview" : "chat", animate: true }
      return next
    })
    if (!next.open) setPreviewWidth(0)
  }, [])

  // The preview sits after chat, as ALwith Desktop's file and device panels do; its start edge carries the only divider.
  const dragStart = useRef(0)
  const divide = {
    start: (): void => {
      dragStart.current = widths.preview
      divider.current = true
      setDraggingPreview(true)
      api?.cancelInput()
    },
    drag: (dx: number): void => {
      // Narrower than its minimum, or wide enough to squeeze chat, the preview moves to the next screen.
      setPreviewWidth(Math.max(0, Math.min(widths.screen, dragStart.current - dx)))
    },
    end: (): void => {
      divider.current = false
      setDraggingPreview(false)
      // Widths followed the pointer without rebuilding; regroup once on release, as ALwith Desktop does.
      appliedKey.current = geometryKey
      api?.refresh({ direction })
      show(region === "preview" && !preview.open ? "chat" : region, false)
    }
  }

  const context = useMemo<DesktopCanvas>(
    () => ({
      viewportWidth,
      budget: widths.screen,
      region,
      trailingActive: region === "trailing",
      moving,
      previewSlot,
      setPreview,
      navigate
    }),
    [viewportWidth, widths.screen, region, moving, previewSlot, setPreview, navigate]
  )
  return {
    ref,
    sizes,
    context,
    region,
    moving,
    peeking,
    preview,
    draggingPreview,
    divide,
    setPreviewSlot
  }
}

function PreviewDivider({
  direction,
  onStart,
  onDrag,
  onEnd
}: {
  direction: "ltr" | "rtl"
  onStart: () => void
  onDrag: (dx: number) => void
  onEnd: () => void
}): ReactElement {
  const startX = useRef<number | null>(null)
  const finish = (): void => {
    if (startX.current === null) return
    startX.current = null
    document.body.style.userSelect = ""
    onEnd()
  }
  return (
    <div
      data-no-drag
      className="desktop-shell-divider"
      onPointerDown={(event) => {
        event.preventDefault()
        startX.current = event.clientX
        document.body.style.userSelect = "none"
        onStart()
        event.currentTarget.setPointerCapture(event.pointerId)
      }}
      onPointerMove={(event) => {
        if (startX.current === null) return
        event.preventDefault()
        onDrag((event.clientX - startX.current) * (direction === "rtl" ? -1 : 1))
      }}
      onPointerUp={finish}
      onPointerCancel={finish}
      onLostPointerCapture={finish}
    />
  )
}

// Apps ALwith ships itself carry no campaigns; every other app built on this workspace does.
const FIRST_PARTY = ["ai.alwith.u"]
const CAMPAIGNS = [{ id: "vibemon", image: vibemonBanner }]

/** A first-party app and its side-by-side instances, such as `ai.alwith.u.dev`. */
function isFirstParty(identifier: string): boolean {
  return FIRST_PARTY.some((id) => identifier === id || identifier.startsWith(`${id}.`))
}

interface CampaignSlot {
  label: string
  onOpen: () => void
  /** A mounted navigation footer takes the slot; the workspace keeps it otherwise. */
  claim: () => () => void
}
const CampaignSlotContext = createContext<CampaignSlot | null>(null)

/**
 * The navigation's footer. ALwith's campaign slot sits between `status` and the footer rows, where
 * ALwith Desktop shows it. Without this footer the workspace shows the slot at the foot of the
 * navigation instead.
 */
export function DesktopNavigationFooter({
  status,
  className,
  children
}: {
  status?: ReactNode
  className?: string
  children?: ReactNode
}): ReactElement {
  const slot = useContext(CampaignSlotContext)
  useLayoutEffect(() => slot?.claim(), [slot])
  return (
    <div
      data-slot="sidebar-footer"
      className={className ? `desktop-shell-navigation-footer ${className}` : "desktop-shell-navigation-footer"}
    >
      {status === undefined ? <DesktopUpdateStatus /> : status}
      {slot && <NavigationCampaigns label={slot.label} onOpen={slot.onOpen} />}
      {children}
    </div>
  )
}

/** ALwith's campaign slot at the foot of the navigation. Only an app ALwith ships itself goes without it. */
function NavigationCampaigns({ label, onOpen }: { label: string; onOpen: () => void }): ReactElement | null {
  const [shown, setShown] = useState(true)
  useEffect(() => {
    if (!isTauri()) return
    let disposed = false
    void getIdentifier()
      .then((identifier) => {
        if (!disposed) setShown(!isFirstParty(identifier))
      })
      .catch(console.error)
    return () => {
      disposed = true
    }
  }, [])
  if (!shown) return null
  return (
    <div className="desktop-shell-campaigns" data-slot="navigation-campaigns">
      {CAMPAIGNS.map((campaign) => (
        <Button
          key={campaign.id}
          variant="ghost"
          aria-label={label}
          onClick={onOpen}
          className="aspect-[16/5] h-auto w-full cursor-pointer overflow-hidden rounded-none border-0 p-0 transition-none"
        >
          <img src={campaign.image} alt="" className="size-full object-cover" draggable={false} />
        </Button>
      ))}
    </div>
  )
}

const defaultLabels = (): DesktopWorkspaceLabels =>
  desktopNavigationLabels(typeof navigator === "undefined" ? "en" : navigator.language)

/**
 * The desktop main window on ALwith Desktop's Atlas canvas: a leading screen, the persistent navigation, a
 * preview region the host fills through `useDesktopCanvas().previewSlot`, chat, and an optional trailing station.
 * Atlas owns grouping, snapping and every gutter. Hosts supply pages, not geometry.
 */
export function DesktopWorkspace({
  navigation,
  leading,
  children,
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
}: {
  navigation: ReactNode
  leading?: ReactNode
  children?: ReactNode
  trailing?: ReactNode
  toolbar?: ReactNode
  statusBar?: ReactNode
  overlays?: ReactNode
  screen?: DesktopScreen
  onScreenChange?: (screen: DesktopScreen) => void
  onRegionChange?: (region: DesktopCanvasRegion) => void
  initialNavigationPinned?: boolean
  onNavigationPinnedChange?: (pinned: boolean) => void | Promise<void>
  labels?: Partial<DesktopWorkspaceLabels>
  direction?: "ltr" | "rtl"
  trackpad?: boolean
  zoom?: number
  openLink?: (url: string) => void
  onError?: (error: unknown) => void
}): ReactElement {
  const labels = { ...defaultLabels(), ...labelOverrides }
  const titlebar = useContext(DesktopTitleBarContext)
  const workspaceControls = useContext(DesktopWorkspaceControlsContext)
  const fullscreen = useWindowFullscreen()
  const [pinned, setPinned] = useState(initialNavigationPinned)
  const [presentation, setPresentation] = useState<"docked" | "floating">(
    initialNavigationPinned ? "docked" : "floating"
  )
  const canvas = useWorkspaceCanvas({
    screen,
    pinned,
    onScreenChange,
    onRegionChange,
    trailing: trailing !== undefined && trailing !== null && trailing !== false,
    direction,
    labels,
    trackpad,
    openLink,
    onError
  })
  const navigate = canvas.context.navigate
  const mainActive = screen === "main"
  const showMainControls = mainActive && canvas.region !== "trailing"
  const docked = !mainActive || pinned
  const visible = docked || canvas.peeking
  const panelId = useId()
  const panel = useRef<HTMLDivElement>(null)
  const toggle = useRef<HTMLButtonElement>(null)
  const overlayCount = useRef(0)
  const saving = useRef(Promise.resolve())

  const [footers, setFooters] = useState(0)
  const claimCampaigns = useCallback(() => {
    setFooters((count) => count + 1)
    return () => setFooters((count) => count - 1)
  }, [])
  const campaignSlot = useMemo(
    () => ({ label: labels.campaigns, onOpen: () => onScreenChange?.("leading"), claim: claimCampaigns }),
    [labels.campaigns, onScreenChange, claimCampaigns]
  )
  const retainOverlay = useCallback(() => {
    overlayCount.current += 1
    panel.current?.parentElement?.setAttribute("data-popup-open", "")
    return () => {
      overlayCount.current -= 1
      if (overlayCount.current === 0) panel.current?.parentElement?.removeAttribute("data-popup-open")
    }
  }, [])

  const changePinned = useCallback(
    (next: boolean) => {
      if (!mainActive) return
      // The navigation lives on chat's screen, so toggling it from another screen (the trailing station or a
      // maximized preview) also returns there.
      if (canvas.region !== "chat") navigate("chat")
      setPresentation("docked")
      setPinned(next)
      // Serialize writes so rapid toggles cannot restore an older choice on restart.
      saving.current = saving.current.then(() => onNavigationPinnedChange?.(next)).catch(onError)
    },
    [mainActive, canvas.region, navigate, onNavigationPinnedChange, onError]
  )

  useEffect(() => {
    if (canvas.peeking) setPresentation("floating")
  }, [canvas.peeking])

  useEffect(() => {
    if (!visible && panel.current?.contains(document.activeElement)) toggle.current?.focus({ preventScroll: true })
  }, [visible, showMainControls])

  const ToggleIcon = pinned ? PanelLeftIcon : PanelLeftDashedIcon
  const sidebarToggle = (
    <div
      className={titlebar ? "windows-sidebar-toggle" : "main-sidebar-toggle"}
      style={titlebar ? { width: 32 / zoom, height: 32 / zoom } : undefined}
    >
      <Button
        ref={toggle}
        variant="ghost"
        size="icon-xs"
        role="switch"
        aria-label={labels.pin}
        aria-checked={docked}
        aria-expanded={visible}
        aria-controls={panelId}
        data-atlas-navigation-trigger
        title={pinned ? labels.unpin : labels.pin}
        className="text-sidebar-foreground"
        // The navigation closes only while it is on screen; docked on chat's screen while another is shown, the button
        // returns to it instead.
        onClick={() => (docked && canvas.region !== "chat" ? navigate("chat") : changePinned(!docked))}
      >
        <ToggleIcon className="size-4 rtl:-scale-x-100" />
      </Button>
    </div>
  )

  return (
    <SidebarProvider
      open={docked}
      onOpenChange={changePinned}
      className="relative h-full min-h-0 flex-col overflow-clip"
      data-main-screen={screen}
      data-canvas-moving={canvas.moving}
      data-canvas-pinned={pinned}
      data-sidebar-mode={docked ? "pinned" : visible ? "floating" : "hidden"}
      data-sidebar-presentation={docked || canvas.moving ? "docked" : presentation}
      style={
        {
          "--sidebar-width": `${desktopDefaults.navigationWidth}px`,
          "--main-surface-radius": `${desktopDefaults.surfaceRadius}px`,
          "--main-titlebar-height": `${desktopDefaults.insetTop}px`,
          // Native window controls keep their size when page content zooms.
          "--sidebar-toggle-left": isMac() && !fullscreen ? "calc(80px * var(--window-zoom-correction))" : "8px"
        } as CSSProperties
      }
    >
      {showMainControls && workspaceControls && toolbar && createPortal(toolbar, workspaceControls)}
      {showMainControls && titlebar && createPortal(sidebarToggle, titlebar)}
      <DesktopCanvasContext.Provider value={canvas.context}>
        <div className="main-window-body" dir={direction}>
          <div ref={canvas.ref} className="main-canvas-viewport" data-atlas-layout="sized">
            <header className="main-window-titlebar" data-atlas-topbar>
              {showMainControls && !titlebar && sidebarToggle}
              {showMainControls && !workspaceControls && toolbar}
            </header>
            <footer className="main-window-statusbar" data-atlas-footer>
              {statusBar === undefined ? <DesktopStatusBar openUrl={openLink} onError={onError} /> : statusBar}
            </footer>
            <div className="main-screen-track" data-atlas-track>
              <div
                className="main-screen-leading"
                data-screen-panel="leading"
                data-atlas-region="leading"
                data-atlas-leading
                style={{ width: canvas.sizes.leading }}
                inert={mainActive}
                aria-hidden={mainActive}
              >
                {leading}
              </div>
              <DesktopNavigationOverlayContext.Provider value={retainOverlay}>
                <div
                  className="main-sidebar-shell"
                  data-atlas-region="navigation"
                  data-atlas-navigation
                  style={{ width: desktopDefaults.navigationWidth }}
                >
                  <div className="main-sidebar-viewport" data-atlas-navigation-surface id={panelId}>
                    <div
                      ref={panel}
                      className="main-sidebar-panel"
                      inert={!visible && !canvas.moving}
                      aria-hidden={!visible && !canvas.moving}
                    >
                      <CampaignSlotContext.Provider value={campaignSlot}>
                        <div className="main-sidebar-content">{navigation}</div>
                      </CampaignSlotContext.Provider>
                      {footers === 0 && <NavigationCampaigns label={labels.campaigns} onOpen={campaignSlot.onOpen} />}
                    </div>
                  </div>
                </div>
              </DesktopNavigationOverlayContext.Provider>
              <div
                className="main-screen-content"
                data-screen-panel="main"
                data-atlas-region="chat"
                data-atlas-collapsed={canvas.sizes.chat === 0}
                style={{ width: canvas.sizes.chat }}
                inert={!mainActive}
                aria-hidden={!mainActive}
              >
                {children}
              </div>
              <div
                className="main-screen-preview"
                data-screen-panel="preview"
                data-atlas-region="preview"
                data-atlas-collapsed={canvas.sizes.preview === 0}
                style={{ width: canvas.sizes.preview }}
                inert={!mainActive || !canvas.preview.open}
                aria-hidden={!mainActive || !canvas.preview.open}
              >
                <div ref={canvas.setPreviewSlot} className="main-screen-preview-slot" />
                {(canvas.draggingPreview || (canvas.preview.open && !canvas.preview.maximized)) && (
                  <PreviewDivider
                    direction={direction}
                    onStart={canvas.divide.start}
                    onDrag={canvas.divide.drag}
                    onEnd={canvas.divide.end}
                  />
                )}
              </div>
              <aside
                className="main-screen-trailing"
                data-screen-panel="trailing"
                data-atlas-region="trailing"
                data-atlas-trailing
                data-atlas-collapsed={canvas.sizes.trailing === 0}
                style={{ width: canvas.sizes.trailing }}
                inert={!canvas.context.trailingActive && !canvas.moving}
              >
                {trailing}
              </aside>
            </div>
          </div>
        </div>
      </DesktopCanvasContext.Provider>
      {overlays}
    </SidebarProvider>
  )
}
