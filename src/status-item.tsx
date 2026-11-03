import { cn } from "cn"
import { Terminal } from "lucide-react"
import { getVersion } from "@tauri-apps/api/app"
import { isTauri } from "@tauri-apps/api/core"
import { Fragment, type ReactNode, useEffect, useState } from "react"

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

import { readBundledCliStatus } from "../native.js"
import { desktopStatusLabels } from "../status-labels.js"
import type { DesktopStatusItemProps } from "../status-item.js"

/** Desktop status presentation. The item owns its typography; hosts only choose where it sits. */
export function DesktopStatusItem({
  server,
  signing,
  appVersion,
  latestVersion,
  cli,
  labels,
  openUrl,
  revealPath,
  onError
}: DesktopStatusItemProps) {
  const deviations = [server?.nonProduction ? server.label : null, signing?.label].filter(Boolean)
  if (!server && !signing && !appVersion && !cli) return null
  const act = (action: () => void | Promise<void>) => {
    Promise.resolve().then(action).catch(onError)
  }
  return (
    <Popover>
      <PopoverTrigger
        className="group text-muted-foreground flex h-full cursor-pointer items-center px-1 pe-2 text-xs"
        aria-label={[labels.title, ...deviations].join(" · ")}
        title={labels.title}
      >
        {deviations.length > 0 ? (
          <span className="flex items-center gap-1.5">
            <span className="size-2 shrink-0 rounded-full bg-amber-500" aria-hidden />
            <span>{deviations.join(" · ")}</span>
          </span>
        ) : (
          <Terminal size={16} />
        )}
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        alignOffset={-8}
        className="w-auto p-3 text-xs"
        data-overlay
        aria-label={labels.title}
      >
        <div className="grid grid-cols-[auto_auto_1fr] items-center gap-x-2 gap-y-2">
          {server && (
            <Fragment>
              <span
                className={cn("size-2 shrink-0 rounded-full", server.nonProduction ? "bg-amber-500" : "bg-green-500")}
                aria-hidden
              />
              <span className="text-muted-foreground justify-self-center">{labels.server}</span>
              <button
                type="button"
                className="justify-self-start hover:underline"
                onClick={() => act(() => openUrl(server.url))}
                title={server.url}
              >
                {server.label}
              </button>
            </Fragment>
          )}
          {signing && (
            <Fragment>
              <span className="size-2 shrink-0 rounded-full bg-amber-500" aria-hidden />
              <span className="text-muted-foreground justify-self-center">{labels.signing}</span>
              <span>{signing.label}</span>
            </Fragment>
          )}
          {appVersion && (
            <Fragment>
              <span
                className={cn(
                  "size-2 shrink-0 rounded-full",
                  latestVersion && latestVersion !== appVersion ? "bg-amber-500" : "bg-green-500"
                )}
                aria-hidden
              />
              <span className="text-muted-foreground justify-self-center">{labels.version}</span>
              <span className="flex items-center gap-1.5 justify-self-start">
                <code className="font-mono">{appVersion}</code>
                {latestVersion && latestVersion !== appVersion && <code className="font-mono">→ {latestVersion}</code>}
              </span>
            </Fragment>
          )}
          {cli && (
            <div className="col-span-3 grid grid-cols-subgrid items-center">
              <span
                className={cn("size-2 shrink-0 rounded-full", cli.local?.fromSource ? "bg-amber-500" : "bg-green-500")}
                aria-hidden
              />
              <span className="text-muted-foreground justify-self-center">{labels.cli}</span>
              {cli.local ? (
                <button
                  type="button"
                  className="justify-self-start font-mono hover:underline"
                  onClick={() => act(() => revealPath(cli.local!.path))}
                  title={cli.local.path}
                >
                  {cli.local.fromSource ? labels.source : cli.version}
                </button>
              ) : (
                <code className="justify-self-start font-mono">{cli.version}</code>
              )}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

export { desktopStatusLabels } from "../status-labels.js"

/**
 * ALwith Desktop's status bar: host slots (extension status, drive) on the leading side and the
 * server / CLI status item at the trailing corner. The workspace renders it when no status bar is given.
 */
export function DesktopStatusBar({
  server = null,
  signing = null,
  readCli = () => readBundledCliStatus("codex"),
  openUrl = (url) => void window.open(url, "_blank"),
  revealPath = (path) => void window.open(`file://${path}`, "_blank"),
  onError = console.error,
  start,
  end
}: {
  server?: DesktopStatusItemProps["server"]
  signing?: DesktopStatusItemProps["signing"]
  /** The CLI the Runtime actually runs; defaults to the bundled Codex. */
  readCli?: () => Promise<DesktopStatusItemProps["cli"]>
  openUrl?: DesktopStatusItemProps["openUrl"]
  revealPath?: DesktopStatusItemProps["revealPath"]
  onError?: DesktopStatusItemProps["onError"]
  /** Fills the leading side, such as extension status items. */
  start?: ReactNode
  /** Sits just before the status item, such as drive sync state. */
  end?: ReactNode
}) {
  const [appVersion, setAppVersion] = useState<string | null>(null)
  const [cli, setCli] = useState<DesktopStatusItemProps["cli"]>(null)
  useEffect(() => {
    if (!isTauri()) return
    let active = true
    void getVersion()
      .then((value) => active && setAppVersion(value))
      .catch(onError)
    void readCli()
      .then((value) => active && setCli(value))
      .catch(onError)
    return () => {
      active = false
    }
    // Read once per mount; the bundled CLI does not change while the app runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const labels = desktopStatusLabels(typeof navigator === "undefined" ? "en" : navigator.language)
  return (
    <>
      <div className="pointer-events-none flex min-w-0 flex-1 items-center gap-2 [-webkit-app-region:no-drag]">
        <div className="min-w-0 flex-1">{start}</div>
      </div>
      <div className="flex h-8 shrink-0 items-center gap-[4px]">
        {end}
        <div className="desktop-status-item flex h-8 shrink-0 items-center [&>button]:h-6 [&>button]:rounded-[min(var(--radius-md),10px)] [&>button]:border [&>button]:border-transparent [&>button]:px-2.5 [&>button]:font-medium [&>button]:whitespace-nowrap [&>button]:outline-none [&>button]:select-none [&>button]:focus-visible:border-ring [&>button]:focus-visible:ring-3 [&>button]:focus-visible:ring-ring/50">
          <DesktopStatusItem
            server={server}
            signing={signing}
            appVersion={appVersion}
            cli={cli}
            labels={labels}
            openUrl={openUrl}
            revealPath={revealPath}
            onError={onError}
          />
        </div>
      </div>
    </>
  )
}
