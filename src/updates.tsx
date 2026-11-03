import { ArrowRightIcon, LoaderCircleIcon, RocketIcon } from "lucide-react"
import { type ReactElement, useCallback, useEffect, useSyncExternalStore } from "react"

import {
  checkForUpdates,
  confirmDialog,
  type DesktopUpdaterState,
  getUpdaterState,
  installUpdateAndRelaunch,
  onUpdaterState
} from "../native.js"
import { desktopUpdateLabels, type DesktopUpdateLabels } from "../status-labels.js"
import { Button } from "@/components/ui/button"

// One mirror of the native updater per webview. Checking and downloading are silent; the only
// prompt is the relaunch question once an update is ready, asked once per version and only by
// the window that asked for prompts (the main window). Ported from ALwith Desktop.
let state: DesktopUpdaterState = { type: "uninitialized" }
let started: Promise<void> | null = null
const listeners = new Set<() => void>()
const prompted = new Set<string>()
let prompting = false
let promptLabels: DesktopUpdateLabels | null = null

function publish(next: DesktopUpdaterState): void {
  state = next
  for (const listener of listeners) listener()
  if (prompting) void promptReady()
}

function start(): Promise<void> {
  started ??= (async () => {
    let received = false
    await onUpdaterState((next) => {
      received = true
      publish(next)
    })
    const initial = await getUpdaterState()
    // An event arriving during the request must not be overwritten by its snapshot.
    if (!received) publish(initial)
  })().catch((error: unknown) => {
    started = null
    throw error
  })
  return started
}

async function confirmInstallAndRelaunch(labels: DesktopUpdateLabels): Promise<void> {
  const confirmed = await confirmDialog({
    title: labels.relaunchTitle,
    message: labels.relaunchDescription,
    ok: labels.relaunchNow,
    cancel: labels.relaunchLater
  })
  if (confirmed) await installUpdateAndRelaunch()
}

async function promptReady(): Promise<void> {
  if (state.type !== "ready" || prompted.has(state.update.version) || !promptLabels) return
  prompted.add(state.update.version)
  await confirmInstallAndRelaunch(promptLabels)
}

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
const snapshot = (): DesktopUpdaterState => state

/**
 * The application updater: its state, a manual check and the confirmed relaunch. `autoPrompt` asks
 * to relaunch once per downloaded version; only the main window should pass it.
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
  const current = useSyncExternalStore(subscribe, snapshot, snapshot)
  const language = typeof navigator === "undefined" ? "en" : navigator.language
  const labels = { ...desktopUpdateLabels(language), ...labelOverrides }
  useEffect(() => {
    if (autoPrompt) {
      prompting = true
      promptLabels = labels
    }
    start()
      .then(() => (autoPrompt ? promptReady() : undefined))
      .catch(onError)
    // Labels and the error sink are read when the prompt opens; they do not restart the mirror.
  }, [autoPrompt])
  const check = useCallback(() => checkForUpdates().then(publish), [])
  const relaunch = useCallback(() => confirmInstallAndRelaunch(labels), [labels])
  return { state: current, labels, check, confirmInstallAndRelaunch: relaunch }
}

/** ALwith Desktop's update card at the foot of the navigation: progress, installing, then relaunch. */
export function DesktopUpdateStatus({
  labels: labelOverrides,
  onError = console.error
}: {
  labels?: Partial<DesktopUpdateLabels>
  onError?: (error: unknown) => void
}): ReactElement | null {
  const { state, labels, confirmInstallAndRelaunch } = useDesktopUpdater({
    autoPrompt: true,
    labels: labelOverrides,
    onError
  })

  if (state.type === "downloading") {
    const total = state.totalBytes ?? 0
    const progress = total > 0 ? Math.min(((state.downloadedBytes ?? 0) / total) * 100, 100) : 0
    const label = labels.downloading.replace("{{percent}}", String(Math.round(progress)))
    return (
      <div className="flex h-12 w-full items-center gap-2 rounded-xl border bg-card p-2 shadow-lg" role="status">
        <svg
          role="progressbar"
          aria-label={label}
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
        <span className="truncate text-sm font-medium text-foreground">{label}</span>
      </div>
    )
  }

  if (state.type === "restarting") {
    return (
      <div className="flex h-12 w-full items-center gap-2 rounded-xl border bg-card p-2 shadow-lg" role="status">
        <LoaderCircleIcon className="size-8 shrink-0 animate-spin" aria-hidden="true" />
        <span className="truncate text-sm font-medium text-foreground">{labels.installing}</span>
      </div>
    )
  }

  if (state.type !== "ready") return null

  return (
    <Button
      variant="outline"
      onClick={() => void confirmInstallAndRelaunch().catch(onError)}
      className="h-12 w-full justify-start gap-2 rounded-xl bg-card p-2 shadow-lg hover:bg-card dark:bg-card dark:hover:bg-card"
    >
      <span className="flex size-8 shrink-0 items-center justify-center">
        <RocketIcon className="size-6" />
      </span>
      <span className="min-w-0 flex-1 truncate text-start">
        <span className="block truncate text-sm font-medium text-foreground">{labels.install}</span>
        <span className="block truncate text-xs font-normal text-muted-foreground">v{state.update.version}</span>
      </span>
      <ArrowRightIcon className="size-4 shrink-0 text-muted-foreground rtl:-scale-x-100" />
    </Button>
  )
}
