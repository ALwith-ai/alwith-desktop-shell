import { isTauri } from "@tauri-apps/api/core"

const KEY = "alwith-desktop-shell.theme"
const EVENT = "alwith-shell:theme"
const QUERY = "(prefers-color-scheme: dark)"
const THEMES = ["light", "dark", "system"]
const listeners = new Set()
let theme = "system"
let resolved = "light"
let started = false

/** The saved appearance preference: light, dark or system (the default). */
export function readThemePreference() {
  try {
    const stored = localStorage.getItem(KEY)
    return THEMES.includes(stored) ? stored : "system"
  } catch {
    return "system"
  }
}

function systemTheme() {
  return matchMedia(QUERY).matches ? "dark" : "light"
}

function apply() {
  resolved = theme === "system" ? systemTheme() : theme
  const root = document.documentElement
  root.classList.remove("light", "dark")
  root.classList.add(resolved)
  root.style.colorScheme = resolved
  for (const listener of listeners) listener()
  if (isTauri()) {
    void import("@tauri-apps/api/app")
      .then(({ setTheme }) => setTheme(theme === "system" ? null : theme))
      .catch((error) => console.error("Failed to set native theme", error))
  }
}

/**
 * Applies the saved preference before the first paint and keeps every window in step: the system
 * query while following the system, and the shell's theme event from other windows. Call once per page.
 */
export function initializeDesktopTheme() {
  if (started) return
  started = true
  theme = readThemePreference()
  apply()
  matchMedia(QUERY).addEventListener("change", () => {
    if (theme === "system") apply()
  })
  if (isTauri())
    void import("@tauri-apps/api/event")
      .then(({ listen }) =>
        listen(EVENT, (event) => {
          if (THEMES.includes(event.payload) && event.payload !== theme) {
            theme = event.payload
            apply()
          }
        })
      )
      .catch((error) => console.error("Failed to follow the theme across windows", error))
}

/**
 * Records the preference for the first paint of the next page without applying it. Apps that keep the
 * preference in their own store call this whenever they apply it.
 */
export function rememberThemePreference(next) {
  if (!THEMES.includes(next)) return
  try {
    localStorage.setItem(KEY, next)
  } catch {}
}

/** Saves and applies the preference here, then tells the other windows. */
export async function setThemePreference(next) {
  if (!THEMES.includes(next)) throw new Error(`Unknown theme: ${next}`)
  theme = next
  localStorage.setItem(KEY, next)
  apply()
  if (isTauri()) {
    const { emit } = await import("@tauri-apps/api/event")
    await emit(EVENT, next)
  }
}

export function themePreference() {
  return theme
}

/** The theme on screen now: light or dark. */
export function resolvedTheme() {
  return resolved
}

export function subscribeTheme(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
