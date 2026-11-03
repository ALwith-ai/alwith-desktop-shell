export { initializeDesktopShell, onDesktopNewChat, onDesktopMenu, getUpdaterState, onUpdaterState, checkForUpdates, installUpdateAndRelaunch, confirmDialog, chooseFolder, openDesktopSettings, openDesktopGuide, closeDesktopSettings } from "./native.js"
import { isTauri } from "@tauri-apps/api/core"
import { connectTrackpad } from "@nyssance/atlas/dom"
import { attachWindowDrag, tauriTrackpad } from "@nyssance/atlas/tauri"

/** Uses Atlas' own lifecycle and native gesture implementation. */
export function connectDesktopAtlas(controller, onError = console.error) {
  if (!isTauri()) return () => {}
  const stopDrag = attachWindowDrag(controller.root, onError)
  const stopTrackpad = connectTrackpad(controller, tauriTrackpad({
    command: "plugin:alwith-desktop-shell|has_trackpad"
  }), onError)
  return () => { stopDrag(); stopTrackpad() }
}
