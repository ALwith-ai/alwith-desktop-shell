import { invoke, isTauri } from "@tauri-apps/api/core"

/** U's zoom steps (Chrome's and VS Code's): View → Zoom In / Zoom Out / Actual Size. */
export const ZOOM_LEVELS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2]
const DEFAULT_LEVEL = 1
const KEY = "alwith-desktop-shell.zoom"
const EVENT = "alwith-shell:zoom"
const IS_MAC = typeof navigator !== "undefined" && navigator.platform.startsWith("Mac")
const IS_WINDOWS = typeof navigator !== "undefined" && navigator.platform.includes("Win")
const listeners = new Set()
let level = DEFAULT_LEVEL
let interaction = 0
let appliedLevel = DEFAULT_LEVEL
let pending = Promise.resolve()
let revision = 0
let started = false

/** The nearest step; a value beyond the steps becomes the first or last one. */
export function clampZoomLevel(value) {
  if (!Number.isFinite(value)) throw new Error("Zoom level must be finite")
  let best = ZOOM_LEVELS[0]
  for (const step of ZOOM_LEVELS) if (Math.abs(value - step) < Math.abs(value - best)) best = step
  return best
}

/** The saved level, else the default (100%). */
export function readZoomPreference() {
  try {
    const stored = Number(localStorage.getItem(KEY))
    return Number.isFinite(stored) && stored > 0 ? clampZoomLevel(stored) : DEFAULT_LEVEL
  } catch {
    return DEFAULT_LEVEL
  }
}

function remember(next) {
  try {
    if (next === DEFAULT_LEVEL) localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, String(next))
  } catch {}
}

/** Native-sized chrome (the sidebar toggle beside the traffic lights) is the inverse of the page zoom. */
function correct(next) {
  document.documentElement.style.setProperty("--window-zoom-correction", String(1 / next))
}

function notify() {
  for (const listener of listeners) listener()
}

/** macOS keeps the traffic lights centered in the zoomed titlebar; the other platforms have nothing to move. */
async function alignNativeControls(next) {
  if (IS_MAC) await invoke("plugin:alwith-desktop-shell|set_traffic_light_zoom", { zoom: next })
}

function apply(next, local) {
  const request = ++revision
  level = next
  if (local) interaction++
  correct(next)
  notify()
  // Rapid key presses, native zoom and the other windows' broadcasts stay in order.
  const operation = pending
    .then(async () => {
      if (isTauri()) {
        const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow")
        await getCurrentWebviewWindow().setZoom(next)
        await alignNativeControls(next)
      }
      appliedLevel = next
      if (!local) return
      remember(next)
      if (isTauri()) {
        const { emit } = await import("@tauri-apps/api/event")
        await emit(EVENT, next)
      }
    })
    .catch((error) => {
      if (request === revision) {
        level = appliedLevel
        correct(level)
        notify()
      }
      throw error
    })
  // Reported to its caller, while the next operation may proceed.
  pending = operation.catch(() => {})
  return operation
}

/** Applies and saves the level here, then the other windows follow. */
export function setZoomLevel(value) {
  return apply(clampZoomLevel(value), true)
}

export function zoomIn() {
  const index = ZOOM_LEVELS.indexOf(clampZoomLevel(level))
  return setZoomLevel(ZOOM_LEVELS[Math.min(index + 1, ZOOM_LEVELS.length - 1)])
}

export function zoomOut() {
  const index = ZOOM_LEVELS.indexOf(clampZoomLevel(level))
  return setZoomLevel(ZOOM_LEVELS[Math.max(index - 1, 0)])
}

export function resetZoom() {
  return setZoomLevel(DEFAULT_LEVEL)
}

/** The level on screen now. */
export function zoomLevel() {
  return level
}

/** The number of zoom changes made in this window (menu, keys, buttons); feedback shows once per change. */
export function zoomInteraction() {
  return interaction
}

export function subscribeZoom(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/**
 * Applies the saved level to this window before the first paint, answers the View menu (Zoom In, Zoom
 * Out, Actual Size) and the other windows' changes. Call once per page, before rendering.
 */
export async function initializeDesktopZoom() {
  if (started) return
  started = true
  level = readZoomPreference()
  correct(level)
  notify()
  if (!isTauri()) return
  const report = (error) => console.error("Desktop zoom", error)
  const [{ getCurrentWebviewWindow }, { listen }] = await Promise.all([
    import("@tauri-apps/api/webviewWindow"),
    import("@tauri-apps/api/event")
  ])
  const current = getCurrentWebviewWindow()
  void listen(EVENT, (event) => {
    const next = event.payload
    if (typeof next === "number" && next !== level) apply(clampZoomLevel(next), false).catch(report)
  }).catch(report)
  const actions = { "zoom-in": zoomIn, "zoom-out": zoomOut, "actual-size": resetZoom }
  for (const [action, run] of Object.entries(actions)) {
    void current.listen(`alwith-shell:${action}`, () => run().catch(report)).catch(report)
  }
  // Windows: the native menu's accelerators do not reach a focused webview, so the keys are answered here (U).
  if (IS_WINDOWS) {
    document.addEventListener("keydown", (event) => {
      if (!event.ctrlKey || event.altKey || event.metaKey || event.isComposing || event.defaultPrevented) return
      const run =
        event.key === "=" || event.key === "+" ? zoomIn : event.key === "-" ? zoomOut : event.key === "0" ? resetZoom : null
      if (run === null) return
      event.preventDefault()
      void run().catch(report)
    })
  }
  if (level !== DEFAULT_LEVEL) await current.setZoom(level)
  await alignNativeControls(level)
  appliedLevel = level
}
