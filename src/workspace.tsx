import { type AtlasController, connectTrackpad, isViewportResize } from "@nyssance/atlas/dom"
import { desktopDefaults, MIN_BLOCK_WIDTH, resolveAtlasBlocks } from "@nyssance/atlas/layout"
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
import { createPortal, flushSync } from "react-dom"

import { Button } from "@/components/ui/button"
import { SidebarProvider } from "@/components/ui/sidebar"

import { vibemonBanner } from "../campaigns.js"
import { connectDesktopOverview } from "../overview.js"
import { desktopNavigationLabels } from "../status-labels.js"
import { DesktopStatusBar } from "./status-item.js"
import { DesktopUpdateStatus } from "./updates.js"

export type DesktopScreen = "main" | "leading"
/**
 * A canvas region (板, Desktop's `REGION` vocabulary): leading, trailing, or a pane named by its bare camelCase ID,
 * as Desktop names `chat`, `preview`, `sidePanes` and `workbench`.
 */
export type DesktopCanvasRegion = "leading" | "trailing" | (string & {})
/**
 * A pane of the main screen. Panes are laid out in the order given: neighbours share a screen while both keep their
 * minimum, otherwise the next one moves on to the following screen whole.
 */
export interface DesktopPane {
  /** A unique camelCase ID other than `leading`, `navigation` and `trailing`; it is also the pane's region name. */
  id: string
  title: string
  children: ReactNode
  /** Narrowest width while sharing a screen; 320 by default. */
  min?: number
  /** Collapsed to no width; the content stays mounted. A pane without `hidden` cannot be hidden. */
  hidden?: boolean
  /** Takes a whole screen of its own. */
  maximized?: boolean
  /** Its start edge carries a divider; the dragged width is the pane's requested width until it is hidden or maximized. */
  resizable?: boolean
}
const SHELL_REGIONS: readonly string[] = ["leading", "navigation", "trailing"]

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

export interface DesktopCanvas {
  viewportWidth: number
  /** The first screen's content width: the viewport less the docked navigation. */
  budget: number
  /** The region the canvas has settled on. */
  region: DesktopCanvasRegion
  trailingActive: boolean
  moving: boolean
  navigate: (region: Exclude<DesktopCanvasRegion, "leading">) => void
}
export const DesktopCanvasContext = createContext<DesktopCanvas | null>(null)
export function useDesktopCanvas(): DesktopCanvas | null {
  return useContext(DesktopCanvasContext)
}

/** Portaled menus opened from the navigation retain its floating surface until they close. */
export const DesktopNavigationOverlayContext = createContext<(() => () => void) | null>(null)

/** The region a screen shows: its first pane in canvas order, else trailing, else leading. */
function groupRegion(
  api: AtlasController,
  index: number,
  paneIds: readonly string[],
  preferred?: string | null
): DesktopCanvasRegion {
  const geometry = api.getGeometry()
  // A region collapsed to nothing (a hidden pane) is never the foreground.
  const names = (geometry.groups[index] ?? [])
    .filter((region) => (geometry.regions[region]?.offsetWidth ?? 0) > 0)
    .map((region) => geometry.regions[region]?.dataset.atlasRegion)
  return (
    (preferred && names.includes(preferred) ? preferred : undefined) ??
    paneIds.find((id) => names.includes(id)) ??
    (["trailing", "leading"] as const).find((name) => names.includes(name)) ??
    paneIds[0]!
  )
}

/** ALwith Desktop's Atlas canvas: Atlas owns snapping, grouping and every gutter. */
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
}: {
  screen: DesktopScreen
  pinned: boolean
  onScreenChange?: (screen: DesktopScreen) => void
  onRegionChange?: (region: DesktopCanvasRegion) => void
  panes: readonly DesktopPane[]
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
  const paneIds = panes.map((pane) => pane.id)
  // The main screen starts on the first screen after the navigation.
  const first = panes.find((pane) => !pane.hidden)?.id ?? paneIds[0]!
  // Widths the user dragged resizable panes to, by pane ID.
  const [requested, setRequested] = useState<Record<string, number>>({})
  const [region, setRegion] = useState<DesktopCanvasRegion>(screen === "leading" ? "leading" : first)
  const [moving, setMoving] = useState(false)
  const [peeking, setPeeking] = useState(false)
  const [dragging, setDragging] = useState<string | null>(null)
  const divider = useRef(false)
  const pending = useRef<{ region: DesktopCanvasRegion; animate: boolean } | null>(null)
  const callbacks = useRef({ onScreenChange, onRegionChange, screen, paneIds, region })
  useLayoutEffect(() => {
    callbacks.current = { onScreenChange, onRegionChange, screen, paneIds, region }
  })
  const statusbar = useCallback(
    () => root.current?.closest("[data-main-screen]")?.querySelector<HTMLElement>(".main-window-statusbar") ?? null,
    []
  )
  const { ref: atlasRef, atlas: api } = useAtlas(
    useMemo(
      () => ({
        direction: initialDirection,
        initialRegion: screen === "leading" ? "leading" : first,
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
          flushSync(() => setViewportWidth(node.clientWidth))
        }
      }),
      [initialDirection, screen, first, labels.pages, labels.page, labels.overview, statusbar, pinned, trackpad]
    )
  )
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

  // The main screen's blocks in the host's order. A maximized pane asks for a whole screen, which leaves no room beside
  // its neighbour, so it takes a screen of its own.
  const screenWidth = Math.max(0, viewportWidth - (pinned ? NAVIGATION_WIDTH : 0))
  const blocks = resolveAtlasBlocks({
    screen: screenWidth,
    nextScreen: viewportWidth,
    blocks: panes
      .filter((pane) => !pane.hidden)
      .map((pane) => ({
        name: pane.id,
        min: pane.min ?? MIN_BLOCK_WIDTH,
        width: pane.maximized ? screenWidth : requested[pane.id]
      }))
  })
  const sizes = {
    leading: `calc(100% - ${pinned ? NAVIGATION_PEEK : NAVIGATION_WIDTH}px)`,
    panes: Object.fromEntries(paneIds.map((id) => [id, blocks[id] ?? 0])) as Record<string, number>,
    trailing: trailing ? desktopDefaults.trailingWidth : 0
  }
  const geometryKey = `${viewportWidth}:${pinned}:${paneIds.map((id) => `${id}=${sizes.panes[id]}`).join(",")}:${sizes.trailing}:${direction}`

  // A hidden or maximized pane forgets its dragged width; maximizing moves to the pane's own screen and restoring
  // returns to the screen it shares.
  const layoutKey = panes.map((pane) => `${pane.id}:${pane.hidden === true}:${pane.maximized === true}`).join(",")
  const previousPanes = useRef(panes)
  useLayoutEffect(() => {
    const before = new Map(previousPanes.current.map((pane) => [pane.id, pane]))
    previousPanes.current = panes
    const forget = panes.filter((pane) => pane.hidden || pane.maximized).map((pane) => pane.id)
    if (forget.some((id) => id in requested))
      setRequested((current) => Object.fromEntries(Object.entries(current).filter(([id]) => !forget.includes(id))))
    const changed = panes.find(
      (pane) => !pane.hidden && pane.maximized && before.has(pane.id) && !before.get(pane.id)!.maximized
    )
    if (changed) pending.current = { region: changed.id, animate: true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutKey])

  const settle = useCallback((next: DesktopCanvasRegion) => {
    callbacks.current.region = next
    setRegion(next)
    callbacks.current.onRegionChange?.(next)
    const nextScreen = next === "leading" ? "leading" : "main"
    if (nextScreen !== callbacks.current.screen) callbacks.current.onScreenChange?.(nextScreen)
  }, [])
  const reduced = (): boolean => window.matchMedia("(prefers-reduced-motion: reduce)").matches
  const show = useCallback(
    (target: DesktopCanvasRegion, animate: boolean, allowReplacement = false): boolean => {
      if (!api) return false
      const geometry = api.getGeometry()
      const find = (name: DesktopCanvasRegion | undefined): number =>
        geometry.groups.findIndex((group) =>
          group.some(
            (item) => geometry.regions[item]?.dataset.atlasRegion === name && geometry.regions[item]!.offsetWidth > 0
          )
        )
      const candidate =
        find(target) !== -1
          ? target
          : allowReplacement && callbacks.current.paneIds.includes(target)
            ? callbacks.current.paneIds.find((id) => find(id) !== -1)
            : undefined
      const index = find(candidate)
      const resolved =
        candidate && callbacks.current.paneIds.includes(candidate)
          ? callbacks.current.paneIds.find((id) => find(id) === index)
          : candidate
      if (!resolved) return false
      api.cancelInput()
      api.goTo(resolved, { instant: !animate || reduced() })
      settle(resolved)
      return true
    },
    [api, settle]
  )

  // Rebuild once per geometry change, then return to the region the host asked for or the one on screen.
  const appliedKey = useRef<string | null>(null)
  useLayoutEffect(() => {
    if (!api || viewportWidth === 0 || appliedKey.current === geometryKey || divider.current) return
    appliedKey.current = geometryKey
    const target = pending.current ?? { region: callbacks.current.region, animate: false }
    api.refresh({ direction })
    pending.current = null
    show(target.region, target.animate, true)
  }, [api, viewportWidth, geometryKey, direction, region, dragging, show, settle])

  useEffect(() => {
    if (!api) return
    const stop = api.subscribe((state: { moving: boolean }) => setMoving(state.moving))
    const settled = (): void => {
      if (divider.current) return
      setMoving(false)
      settle(groupRegion(api, api.getGeometry().selected, callbacks.current.paneIds, api.getState().activeRegion))
    }
    api.on("settle", settled)
    const stopOverview = api.overview.subscribe((state) => {
      if (state === null) settled()
    })
    return () => {
      stopOverview()
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
    if (
      (screen === "leading") ===
      (groupRegion(api, api.getGeometry().selected, callbacks.current.paneIds) === "leading")
    )
      return
    show(screen === "leading" ? "leading" : callbacks.current.paneIds[0]!, true, true)
  }, [api, screen, show])

  const navigate = useCallback(
    (target: Exclude<DesktopCanvasRegion, "leading">): void => {
      pending.current = show(target, true) ? null : { region: target, animate: true }
    },
    [show]
  )
  // A resizable pane's start edge carries the divider, as ALwith Desktop's preview does.
  const dragStart = useRef(0)
  const dragBounds = useRef({ min: 0, max: 0 })
  const divide = {
    start: (id: string): void => {
      dragStart.current = sizes.panes[id] ?? 0
      const geometry = api?.getGeometry()
      const group = geometry?.groups.find((indices) =>
        indices.some((index) => geometry.regions[index]?.dataset.atlasRegion === id)
      )
      const names = group?.map((index) => geometry!.regions[index]?.dataset.atlasRegion) ?? paneIds
      const siblings = panes.filter((pane) => pane.id !== id && !pane.hidden && names.includes(pane.id))
      const minimum = panes.find((pane) => pane.id === id)?.min ?? MIN_BLOCK_WIDTH
      const sharedWidth = names.includes("navigation") ? screenWidth : viewportWidth
      const reserved = siblings.reduce((sum, pane) => sum + (pane.min ?? MIN_BLOCK_WIDTH), 0)
      // A positive undersized request moves this pane to the next screen; zero means automatic sizing.
      // Expanding it must preserve the other panes' minimum widths.
      dragBounds.current = { min: 1, max: Math.max(minimum, sharedWidth - reserved) }
      divider.current = true
      setDragging(id)
      api?.cancelInput()
    },
    drag: (id: string, dx: number): void => {
      const next = Math.round(
        Math.max(dragBounds.current.min, Math.min(dragBounds.current.max, dragStart.current - dx))
      )
      setRequested((current) => (current[id] === next ? current : { ...current, [id]: next }))
    },
    end: (): void => {
      divider.current = false
      setDragging(null)
    }
  }

  const context = useMemo<DesktopCanvas>(
    () => ({
      viewportWidth,
      budget: screenWidth,
      region,
      trailingActive: region === "trailing",
      moving,
      navigate
    }),
    [viewportWidth, screenWidth, region, moving, navigate]
  )
  return {
    ref,
    sizes,
    context,
    region,
    moving,
    peeking,
    dragging,
    divide
  }
}

function PaneDivider({
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
  const previousUserSelect = useRef("")
  const pending = useRef<number | null>(null)
  const frame = useRef(0)
  const drag = useRef(onDrag)
  drag.current = onDrag
  const flush = (): void => {
    cancelAnimationFrame(frame.current)
    frame.current = 0
    if (pending.current !== null) {
      const delta = pending.current
      pending.current = null
      drag.current(delta)
    }
  }
  const finish = (applyPending = true): void => {
    if (startX.current === null) return
    if (applyPending) flush()
    else {
      cancelAnimationFrame(frame.current)
      frame.current = 0
      pending.current = null
    }
    startX.current = null
    document.body.style.userSelect = previousUserSelect.current
    onEnd()
  }
  useEffect(
    () => () => {
      cancelAnimationFrame(frame.current)
      if (startX.current !== null) document.body.style.userSelect = previousUserSelect.current
    },
    []
  )
  return (
    <div
      data-no-drag
      className="desktop-shell-divider"
      onPointerDown={(event) => {
        if (event.button !== 0 || startX.current !== null) return
        event.preventDefault()
        startX.current = event.clientX
        previousUserSelect.current = document.body.style.userSelect
        document.body.style.userSelect = "none"
        onStart()
        event.currentTarget.setPointerCapture(event.pointerId)
      }}
      onPointerMove={(event) => {
        if (startX.current === null) return
        event.preventDefault()
        pending.current = (event.clientX - startX.current) * (direction === "rtl" ? -1 : 1)
        if (!frame.current) frame.current = requestAnimationFrame(flush)
      }}
      onPointerUp={() => finish()}
      onPointerCancel={() => finish(false)}
      onLostPointerCapture={() => finish(false)}
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
 * main screen's panes, and an optional trailing station.
 * Atlas owns grouping, snapping and every gutter. Hosts supply panes, not geometry.
 */
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
}: {
  navigation: ReactNode
  leading?: ReactNode
  /** The main screen's panes in canvas order, between leading and trailing. */
  panes: DesktopPane[]
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
  const paneIds = panes.map((pane) => pane.id)
  if (
    paneIds.length === 0 ||
    new Set(paneIds).size !== paneIds.length ||
    paneIds.some((id) => !/^[a-z][a-zA-Z0-9]*$/.test(id) || SHELL_REGIONS.includes(id))
  )
    throw new Error("Panes need unique camelCase IDs other than leading, navigation and trailing")
  // The navigation docks beside the first screen after it: the first pane that is not hidden.
  const first = panes.find((pane) => !pane.hidden)?.id ?? paneIds[0]!
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
    panes,
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
      // The navigation docks beside the first screen, so toggling it from another screen (the trailing station or
      // a maximized pane) also returns there.
      if (canvas.region !== first) navigate(first)
      setPresentation("docked")
      setPinned(next)
      // Serialize writes so rapid toggles cannot restore an older choice on restart.
      saving.current = saving.current.then(() => onNavigationPinnedChange?.(next)).catch(onError)
    },
    [mainActive, canvas.region, first, navigate, onNavigationPinnedChange, onError]
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
        onClick={() => (docked && canvas.region !== first ? navigate(first) : changePinned(!docked))}
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
              {panes.map((pane) => (
                <div
                  key={pane.id}
                  className="main-screen-pane"
                  data-screen-panel={pane.id}
                  data-atlas-region={pane.id}
                  data-atlas-collapsed={canvas.sizes.panes[pane.id] === 0}
                  aria-label={pane.title}
                  style={{ width: canvas.sizes.panes[pane.id] }}
                  inert={!mainActive || pane.hidden}
                  aria-hidden={!mainActive || pane.hidden}
                >
                  <div className="main-screen-pane-body">{pane.children}</div>
                  {pane.resizable && (canvas.dragging === pane.id || (!pane.hidden && !pane.maximized)) && (
                    <PaneDivider
                      direction={direction}
                      onStart={() => canvas.divide.start(pane.id)}
                      onDrag={(dx) => canvas.divide.drag(pane.id, dx)}
                      onEnd={canvas.divide.end}
                    />
                  )}
                </div>
              ))}
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
