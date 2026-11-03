import { invoke, isTauri } from "@tauri-apps/api/core"
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow"

export async function initializeDesktopShell() {
  if (!isTauri()) return { platform: "browser", backdrop: "opaque", updates: false }
  const state = await invoke("plugin:alwith-desktop-shell|status")
  document.documentElement.dataset.desktopPlatform = state.platform
  document.documentElement.dataset.desktopBackdrop = state.backdrop
  return state
}

/** Caller owns the returned cleanup; menu events target only this webview. */
export async function onDesktopNewChat(handler) {
  return onDesktopMenu("new-chat", handler)
}

/** A native menu action (`new-chat`, `settings`, `find`), by click or its accelerator; the caller owns the cleanup. */
export async function onDesktopMenu(action, handler) {
  if (!isTauri()) return () => {}
  return getCurrentWebviewWindow().listen(`alwith-shell:${action}`, handler)
}


const UPDATER_STATE = "alwith-desktop-shell:updater-state"
const DISABLED = { type: "disabled", reason: "invalidConfiguration" }

/** The updater's current state. The shell checks in the background and downloads a hit straight away. */
export async function getUpdaterState() {
  if (!isTauri()) return DISABLED
  return invoke("plugin:alwith-desktop-shell|updater_state")
}

/** Every updater state change; the caller owns the cleanup. */
export async function onUpdaterState(handler) {
  if (!isTauri()) return () => {}
  const { listen } = await import("@tauri-apps/api/event")
  return listen(UPDATER_STATE, (event) => handler(event.payload))
}

/** One check now, downloading a hit as the background loop would; resolves to the resulting state. */
export async function checkForUpdates() {
  if (!isTauri()) return DISABLED
  return invoke("plugin:alwith-desktop-shell|updater_check")
}

/**
 * Swaps the staged update into place and relaunches. With `expected` (the release the user
 * confirmed) a different ready release is refused. Rejects with the reason when it cannot install.
 */
export async function installUpdateAndRelaunch(expected) {
  if (!isTauri()) throw new Error("Updates are only available in the desktop application")
  await invoke(
    "plugin:alwith-desktop-shell|updater_install_and_relaunch",
    expected ? { expected: { version: expected.version, signature: expected.signature } } : {}
  )
}

/** The platform's confirmation dialog; `true` when the user chooses `ok`. */
export async function confirmDialog({ title, message, ok, cancel }) {
  if (!isTauri()) return window.confirm(`${title}\n\n${message}`)
  return invoke("plugin:alwith-desktop-shell|confirm", { title, message, ok, cancel })
}

/** The platform's folder dialog for a draft's new project; `null` when the user cancels or outside the desktop. */
export async function chooseFolder(defaultPath = null) {
  if (!isTauri()) return null
  return invoke("plugin:alwith-desktop-shell|choose_folder", { defaultPath })
}

const opening = new Map()
/**
 * Reuse one settings window (U: 760×800, fixed size); `section` opens or switches to that section.
 * Concurrent callers share creation; failures propagate. `options.defaultSection` is the `?tab=` of a
 * new window opened without `section`; `options.backgroundColor` is the new window's ground;
 * `options.attach(label)` runs before every show and focus (U re-parents the window to main on macOS).
 */
export async function openDesktopSettings(title = "Settings", section = undefined, options = {}) {
  const tab = section ?? options.defaultSection
  const url = tab === undefined ? "/settings.html" : `/settings.html?tab=${encodeURIComponent(tab)}`
  const existed = await openAuxWindow("settings", url, title, {
    width: 760, height: 800, resizable: false, maximizable: false, minimizable: false,
    ...(options.backgroundColor === undefined ? {} : { backgroundColor: options.backgroundColor })
  }, options.attach)
  if (existed && section !== undefined && isTauri()) {
    const { emitTo } = await import("@tauri-apps/api/event")
    await emitTo("settings", SETTINGS_CHANGE_SECTION, section)
  }
}
const SETTINGS_CHANGE_SECTION = "settings-change-tab"
/** Settings window: the section the main window asks for after the window already exists. */
export async function onSettingsSectionChange(handler) {
  if (!isTauri()) return () => {}
  const { listen } = await import("@tauri-apps/api/event")
  return listen(SETTINGS_CHANGE_SECTION, (event) => handler(String(event.payload)))
}
/** Reuse one guide window (U's user guide: 1000×760, resizable). */
export function openDesktopGuide(title = "Guide") {
  return openAuxWindow("guide", "/guide.html", title, { width: 1000, height: 760, minWidth: 640, minHeight: 480, center: true })
}
function openAuxWindow(label, url, title, options, attach = undefined) {
  const pending = opening.get(label) ?? openWindow(label, url, title, options, attach).finally(() => { opening.delete(label) })
  opening.set(label, pending)
  return pending
}
async function openWindow(label, url, title, options, attach) {
  if (!isTauri()) { window.open(url, label); return false }
  const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow")
  const existing = await WebviewWindow.getByLabel(label)
  if (existing) { await attach?.(label); await existing.show(); await existing.setFocus(); return true }
  const win = new WebviewWindow(label, {
    url, title, ...options,
    hiddenTitle: true, titleBarStyle: "overlay", visible: false
  })
  await new Promise((resolve, reject) => {
    let removeCreated, removeError
    const cleanup = () => { removeCreated?.(); removeError?.() }
    win.once("tauri://created", () => { cleanup(); resolve() }).then(stop => { removeCreated = stop }).catch(reject)
    win.once("tauri://error", event => { cleanup(); reject(new Error(String(event.payload))) }).then(stop => { removeError = stop }).catch(reject)
  })
  await attach?.(label)
  await win.show()
  await win.setFocus()
  return false
}
export async function closeDesktopSettings() {
  if (isTauri()) await getCurrentWebviewWindow().close()
  else window.close()
}

export function readBundledCliStatus(executable) { return invoke("plugin:alwith-desktop-shell|cli_status", { executable }) }
