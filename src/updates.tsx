import { ArrowRightIcon, LoaderCircleIcon, RocketIcon } from "lucide-react"
import { type ReactElement, useCallback, useEffect, useSyncExternalStore } from "react"

import { Button } from "@/components/ui/button"

import {
  checkForUpdates,
  confirmDialog,
  type DesktopUpdate,
  type DesktopUpdaterState,
  getUpdaterState,
  installUpdateAndRelaunch,
  onUpdaterState
} from "../native.js"
import { type DesktopUpdateLabels, desktopUpdateLabels } from "../status-labels.js"

/** The native side of the updater; tests and other hosts may supply their own. */
export interface DesktopUpdaterIo {
  getState: () => Promise<DesktopUpdaterState>
  listen: (handler: (state: DesktopUpdaterState) => void) => Promise<() => void>
  check: () => Promise<DesktopUpdaterState>
  install: (expected: Pick<DesktopUpdate, "version" | "signature">) => Promise<void>
  confirm: (labels: DesktopUpdateLabels) => Promise<boolean>
}

/** Application hooks around the shared updater, set once per window with `configureDesktopUpdater`. */
export interface DesktopUpdaterHooks {
  /**
   * Runs after the user confirms and before the update is installed, for example to save open
   * work and close admission. A rejection cancels the install and its message becomes `error`.
   */
  prepare?: () => Promise<void>
  /** Always follows `prepare`; `installed` is false when the install did not start. */
  finishPreparation?: (installed: boolean) => void
  /** Every state change this window sees, for example for analytics. */
  onStateChange?: (state: DesktopUpdaterState, previous: DesktopUpdaterState) => void
  /** `native` asks with the platform dialog; `custom` sets `prompt` for the application's own dialog. */
  dialog?: "native" | "custom"
}

export interface DesktopUpdaterSnapshot {
  state: DesktopUpdaterState
  /** An install is being prepared or started. */
  busy: boolean
  /** Why the last install did not happen. */
  error: string | null
  /** The application's own dialog should ask now (`dialog: "custom"`). */
  prompt: boolean
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

/**
 * One mirror of the native updater per webview. Checking, downloading and staging are silent; the
 * only question is the relaunch once an update is ready, asked once per version by the window that
 * auto-prompts (the main window).
 */
export function createDesktopUpdater(io: DesktopUpdaterIo) {
  let snapshot: DesktopUpdaterSnapshot = { state: { type: "uninitialized" }, busy: false, error: null, prompt: false }
  let hooks: DesktopUpdaterHooks = {}
  let started: Promise<void> | null = null
  let prompting = false
  let labels: DesktopUpdateLabels = desktopUpdateLabels(
    (typeof navigator === "undefined" ? undefined : navigator.language) ?? "en"
  )
  const prompted = new Set<string>()
  const listeners = new Set<() => void>()

  const set = (next: Partial<DesktopUpdaterSnapshot>) => {
    snapshot = { ...snapshot, ...next }
    for (const listener of listeners) listener()
  }

  const publish = (state: DesktopUpdaterState) => {
    const previous = snapshot.state
    set({ state, ...(state.type !== "ready" && !snapshot.busy ? { prompt: false } : {}) })
    try {
      hooks.onStateChange?.(state, previous)
    } catch (error) {
      console.error(error)
    }
    if (prompting) void promptReady().catch(console.error)
  }

  const start = (): Promise<void> => {
    started ??= (async () => {
      let received = false
      let stop: (() => void) | undefined
      try {
        stop = await io.listen((next) => {
          received = true
          publish(next)
        })
        const initial = await io.getState()
        // An event arriving during the request must not be overwritten by its snapshot.
        if (!received) publish(initial)
      } catch (error) {
        stop?.()
        started = null
        throw error
      }
    })()
    return started
  }

  /** Prepare, re-check the release the user confirmed, then install it. Resolves whether it started. */
  const install = async (): Promise<boolean> => {
    const confirmed = snapshot.state
    if (snapshot.busy || confirmed.type !== "ready") return false
    set({ busy: true, error: null })
    let installed = false
    try {
      await hooks.prepare?.()
      // Preparation awaited; a revalidation may have replaced the release meanwhile.
      const current = snapshot.state
      if (
        current.type !== "ready" ||
        current.update.version !== confirmed.update.version ||
        current.update.signature !== confirmed.update.signature
      )
        throw new Error(labels.changed)
      await io.install({ version: confirmed.update.version, signature: confirmed.update.signature })
      installed = true
    } catch (error) {
      set({ error: message(error) })
    } finally {
      try {
        hooks.finishPreparation?.(installed)
      } finally {
        set({ busy: false, ...(installed ? { prompt: false } : {}) })
      }
    }
    return installed
  }

  const confirmInstallAndRelaunch = async (): Promise<boolean> => {
    if (snapshot.state.type !== "ready") return false
    if (!(await io.confirm(labels))) return false
    return install()
  }

  /** Ask now: the application's dialog (`custom`) or the platform's. */
  const requestInstall = async (): Promise<boolean> => {
    if (snapshot.state.type !== "ready") return false
    if (hooks.dialog === "custom") {
      set({ prompt: true, error: null })
      return false
    }
    return confirmInstallAndRelaunch()
  }

  const promptReady = async (): Promise<void> => {
    const state = snapshot.state
    if (state.type !== "ready" || prompted.has(state.update.version)) return
    prompted.add(state.update.version)
    await requestInstall()
  }

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    configure: (next: DesktopUpdaterHooks) => {
      hooks = next
    },
    setLabels: (next: DesktopUpdateLabels) => {
      labels = next
    },
    /** Mirrors the native state; with `autoPrompt` this window asks once per ready version. */
    start: async (autoPrompt = false) => {
      if (autoPrompt) prompting = true
      await start()
      if (autoPrompt) await promptReady()
    },
    check: async () => publish(await io.check()),
    install,
    confirmInstallAndRelaunch,
    requestInstall,
    dismiss: () => {
      if (!snapshot.busy) set({ prompt: false, error: null })
    }
  }
}

export type DesktopUpdater = ReturnType<typeof createDesktopUpdater>

const updater = createDesktopUpdater({
  getState: getUpdaterState,
  listen: onUpdaterState,
  check: checkForUpdates,
  install: installUpdateAndRelaunch,
  confirm: (labels) =>
    confirmDialog({
      title: labels.relaunchTitle,
      message: labels.relaunchDescription,
      ok: labels.relaunchNow,
      cancel: labels.relaunchLater
    })
})

/** Sets this window's updater hooks: `prepare`, `finishPreparation`, `onStateChange` and `dialog`. */
export function configureDesktopUpdater(hooks: DesktopUpdaterHooks): void {
  updater.configure(hooks)
}

/** The status line for a state: checking, downloading with percent, staging, ready, up to date or disabled. */
export function desktopUpdateStatusText(state: DesktopUpdaterState, labels: DesktopUpdateLabels): string {
  switch (state.type) {
    case "checkingForUpdates":
      return labels.checking
    case "downloading": {
      const total = state.totalBytes ?? 0
      const percent = total > 0 ? Math.min(Math.round(((state.downloadedBytes ?? 0) / total) * 100), 100) : 0
      return labels.downloading.replace("{{percent}}", String(percent))
    }
    case "availableForDownload":
    case "staging":
      return labels.staging
    case "ready":
      return labels.ready.replace("{{version}}", state.update.version)
    case "restarting":
      return labels.installing
    case "disabled":
      return state.reason === "debugBuild" ? (labels.disabledDebugBuild ?? labels.disabled) : labels.disabled
    case "uninitialized":
      return labels.disabled
    default:
      return labels.upToDate
  }
}

/**
 * The application updater without UI: state, `busy`, `error`, `prompt`, the status text, a manual
 * `check()`, `install()` (prepare, identity re-check, install), `confirmInstallAndRelaunch()` (the
 * platform dialog first), `requestInstall()` and `dismiss()` for an application dialog.
 * `autoPrompt` asks to relaunch once per ready version; only the main window should pass it.
 */
export function useDesktopUpdater({
  autoPrompt = false,
  labels: labelOverrides,
  onError = console.error
}: {
  autoPrompt?: boolean
  labels?: Partial<DesktopUpdateLabels>
  onError?: (error: unknown) => void
} = {}) {
  const current = useSyncExternalStore(updater.subscribe, updater.getSnapshot, updater.getSnapshot)
  const language = (typeof navigator === "undefined" ? undefined : navigator.language) ?? "en"
  const labels = { ...desktopUpdateLabels(language), ...labelOverrides }
  if (autoPrompt) updater.setLabels(labels)
  useEffect(() => {
    updater.start(autoPrompt).catch(onError)
    // Labels and the error sink are read when the prompt opens; they do not restart the mirror.
  }, [autoPrompt])
  const check = useCallback(() => updater.check().catch(onError), [])
  const confirmInstallAndRelaunch = useCallback(() => {
    updater.setLabels(labels)
    return updater.confirmInstallAndRelaunch()
  }, [labels])
  return {
    ...current,
    labels,
    status: desktopUpdateStatusText(current.state, labels),
    check,
    install: updater.install,
    confirmInstallAndRelaunch,
    requestInstall: updater.requestInstall,
    dismiss: updater.dismiss
  }
}

const card = "flex h-12 w-full items-center gap-2 rounded-xl border bg-card p-2 shadow-lg"

/** ALwith Desktop's update card at the foot of the navigation: progress, staging, installing, then relaunch. */
export function DesktopUpdateStatus({
  labels: labelOverrides,
  onError = console.error
}: {
  labels?: Partial<DesktopUpdateLabels>
  onError?: (error: unknown) => void
}): ReactElement | null {
  const { state, busy, error, labels, status, confirmInstallAndRelaunch } = useDesktopUpdater({
    autoPrompt: true,
    labels: labelOverrides,
    onError
  })

  if (state.type === "downloading") {
    const total = state.totalBytes ?? 0
    const progress = total > 0 ? Math.min(((state.downloadedBytes ?? 0) / total) * 100, 100) : 0
    return (
      <div className={card} role="status">
        <svg
          role="progressbar"
          aria-label={status}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress)}
          viewBox="0 0 24 24"
          className="size-8 shrink-0 -rotate-90"
        >
          <circle cx="12" cy="12" r="9" pathLength="100" fill="none" className="stroke-muted" strokeWidth="2" />
          <circle
            cx="12"
            cy="12"
            r="9"
            pathLength="100"
            fill="none"
            className="stroke-foreground"
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray="100"
            strokeDashoffset={100 - progress}
          />
        </svg>
        <span className="truncate text-sm font-medium text-foreground">{status}</span>
      </div>
    )
  }

  if (state.type === "staging" || state.type === "restarting") {
    return (
      <div className={card} role="status">
        <LoaderCircleIcon className="size-8 shrink-0 animate-spin" aria-hidden="true" />
        <span className="truncate text-sm font-medium text-foreground">{status}</span>
      </div>
    )
  }

  if (state.type !== "ready") return null

  return (
    <div className="flex w-full flex-col gap-1">
      <Button
        variant="outline"
        disabled={busy}
        onClick={() => void confirmInstallAndRelaunch().catch(onError)}
        className="h-12 w-full justify-start gap-2 rounded-xl bg-card p-2 shadow-lg hover:bg-card dark:bg-card dark:hover:bg-card"
      >
        <span className="flex size-8 shrink-0 items-center justify-center">
          {busy ? <LoaderCircleIcon className="size-6 animate-spin" /> : <RocketIcon className="size-6" />}
        </span>
        <span className="min-w-0 flex-1 truncate text-start">
          <span className="block truncate text-sm font-medium text-foreground">{labels.install}</span>
          <span className="block truncate text-xs font-normal text-muted-foreground">v{state.update.version}</span>
        </span>
        <ArrowRightIcon className="size-4 shrink-0 text-muted-foreground rtl:-scale-x-100" />
      </Button>
      {error && (
        <p role="alert" className="px-2 text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
