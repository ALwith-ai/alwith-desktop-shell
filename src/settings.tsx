import { getVersion } from "@tauri-apps/api/app"
import { isTauri } from "@tauri-apps/api/core"
import { cn } from "cn"
import { MinusIcon, SquareIcon, XIcon } from "lucide-react"
import { type ComponentType, type ReactNode, useEffect, useId, useRef, useState, useSyncExternalStore } from "react"

import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

import { onSettingsSectionChange, readBundledCliStatus } from "../native.js"
import { desktopSettingsLabels } from "../status-labels.js"
import { resolvedTheme, setThemePreference, subscribeTheme, themePreference } from "../theme.js"
import { setZoomLevel, subscribeZoom, ZOOM_LEVELS, zoomLevel } from "../zoom.js"

const IS_WINDOWS = typeof navigator !== "undefined" && navigator.platform.includes("Win")

/**
 * Shell of auxiliary windows, from ALwith Desktop's aux-window-shell: the sidebar fills the window
 * height, the traffic lights float over it, a hairline separates it from the content; header and
 * footer belong to the right column.
 */
export function AuxWindowShell({
  title,
  showTitleBar = true,
  sidebar,
  sidebarClassName,
  className,
  children
}: {
  title?: ReactNode
  showTitleBar?: boolean
  sidebar: ReactNode
  sidebarClassName?: string
  className?: string
  children: ReactNode
}) {
  return (
    <div className={cn("bg-background flex h-screen", className)}>
      {/* ChatGPT's sidebar color as composited (window, shell layer, navigation tint), light and dark. */}
      <aside
        className={cn("border-border flex shrink-0 flex-col border-e bg-[#fcfcfc] dark:bg-[#1c1c1c]", sidebarClassName)}
      >
        {/* Windows uses a native title bar outside the webview. */}
        {!IS_WINDOWS && <div className="h-8 shrink-0" data-tauri-drag-region />}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{sidebar}</div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        {showTitleBar && (
          <div className="relative flex h-8 shrink-0 items-center gap-1 ps-2 pe-2" data-tauri-drag-region>
            {title && (
              <span className="text-muted-foreground absolute start-1/2 -translate-x-1/2 text-[13px] font-semibold rtl:translate-x-1/2">
                {title}
              </span>
            )}
            <div className="h-full flex-1" data-tauri-drag-region />
          </div>
        )}
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      </div>
    </div>
  )
}

export interface SettingsSectionItem {
  id: string
  label: string
  icon: ComponentType<{ className?: string }>
}

/** U's settings window: the section list on the left (30px navigation rows), one section on the right. */
export function SettingsLayout({
  sections,
  active,
  onSelect,
  label,
  navigation,
  children
}: {
  sections: readonly SettingsSectionItem[]
  active: string | null
  onSelect: (id: string) => void
  /** The section list's accessible name (U: "Settings"). */
  label: string
  /** More rows after the sections (U: extension settings pages). */
  navigation?: ReactNode
  children: ReactNode
}) {
  const current = sections.find((section) => section.id === active)
  return (
    <AuxWindowShell
      className="settings-window"
      sidebarClassName="w-60 [--navigation-row-height:30px]"
      sidebar={
        <nav
          aria-label={label}
          className="flex min-h-0 w-full min-w-0 flex-col gap-0.5 overflow-y-auto px-3 pt-5 pb-4 [&>*]:shrink-0"
        >
          {sections.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              data-active={active === id ? "" : undefined}
              aria-current={active === id ? "page" : undefined}
              onClick={() => onSelect(id)}
              className="group/navigation-row chrome-hover hover:bg-foreground/8 data-active:bg-foreground/5 focus-visible:outline-ring flex h-[30px] w-full items-center gap-1 overflow-hidden rounded-[10px] ps-1 pe-1.5 text-start text-sm outline-hidden [corner-shape:superellipse(1.5)] focus-visible:outline-2 focus-visible:outline-offset-[-2px] disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0 [&>span:last-child]:truncate"
            >
              <Icon />
              <span>{label}</span>
            </button>
          ))}
          {navigation}
        </nav>
      }
    >
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-5 pb-10">
        <section className="settings-content mx-auto w-full max-w-3xl" aria-label={current?.label}>
          {children}
        </section>
      </div>
    </AuxWindowShell>
  )
}

export function SettingLabel({ children }: { children: ReactNode }) {
  return <h2 className="mb-3 cursor-default text-sm font-medium">{children}</h2>
}

export function SettingGroup({ children }: { children: ReactNode }) {
  return <div className="settings-group flex w-full min-w-0 flex-col">{children}</div>
}

/** A row with a title, optional description and a control; `aligned` reserves U's control column. */
export function SettingRow({
  title,
  desc,
  children,
  aligned = false
}: {
  title: string
  desc?: string
  children?: ReactNode
  aligned?: boolean
}) {
  const id = useId()
  return (
    <div
      role="group"
      aria-labelledby={`${id}-title`}
      aria-describedby={desc ? `${id}-description` : undefined}
      className={cn("settings-row", aligned && "settings-row-aligned")}
    >
      <div className="settings-row-label min-w-0">
        <div id={`${id}-title`} className="text-sm leading-5 font-medium">
          {title}
        </div>
        {desc && (
          <div
            id={`${id}-description`}
            className="settings-row-description text-muted-foreground mt-1 text-xs leading-5"
          >
            {desc}
          </div>
        )}
      </div>
      {children && <div className="settings-row-control">{children}</div>}
    </div>
  )
}

/** The appearance preference and the theme on screen, kept in step across windows by the shell. */
export function useDesktopTheme() {
  const preference = useSyncExternalStore(subscribeTheme, themePreference, themePreference)
  const theme = useSyncExternalStore(subscribeTheme, resolvedTheme, resolvedTheme)
  return { preference, theme, setPreference: setThemePreference }
}

/** Closing the settings window hides it so the next open is instant (U, VS Code and Obsidian do the same). */
/**
 * The active settings section: `?tab=` on first open, then whatever the main window asks for
 * through `openDesktopSettings(title, section)` while the window stays hidden-not-closed.
 * `onChange(id)` runs on every such switch from the main window, even to the current section (U
 * closes an open extension settings page); local `setSection` calls do not run it.
 */
export function useSettingsSection(
  sections: readonly SettingsSectionItem[],
  fallback = "general",
  onChange?: (id: string) => void
): [string, (id: string) => void] {
  // Read when an event arrives, so a section list built per render does not resubscribe.
  const latest = useRef(sections)
  latest.current = sections
  const known = (id: string | null) => (id !== null && latest.current.some((section) => section.id === id) ? id : null)
  const [section, setSection] = useState(
    () => known(new URLSearchParams(window.location.search).get("tab")) ?? fallback
  )
  // Read when an event arrives, so an inline callback does not resubscribe.
  const changed = useRef(onChange)
  changed.current = onChange
  useEffect(() => {
    let stop: (() => void) | undefined
    let disposed = false
    void onSettingsSectionChange((id) => {
      const next = known(id)
      if (next === null) return
      setSection(next)
      changed.current?.(next)
    })
      .then((unlisten) => {
        if (disposed) unlisten()
        else stop = unlisten
      })
      .catch(console.error)
    return () => {
      disposed = true
      stop?.()
    }
    // The section ids are static per window.
  }, [])
  return [section, setSection]
}

export function useHideOnClose(onError: (error: unknown) => void = console.error) {
  useEffect(() => {
    if (!isTauri()) return
    let stop: (() => void) | undefined
    let disposed = false
    void import("@tauri-apps/api/webviewWindow")
      .then(async ({ getCurrentWebviewWindow }) => {
        const win = getCurrentWebviewWindow()
        const unlisten = await win.onCloseRequested((event) => {
          event.preventDefault()
          void win.hide().catch(onError)
        })
        if (disposed) unlisten()
        else stop = unlisten
      })
      .catch(onError)
    return () => {
      disposed = true
      stop?.()
    }
  }, [onError])
}

export type ThemeMode = "light" | "dark" | "system"

/** Fake window controls of a preview card, from ALwith Desktop's WindowChrome (size sm). */
function PreviewChrome({ dark }: { dark: boolean }) {
  if (!IS_WINDOWS) {
    return (
      <div className="flex items-center gap-1 px-2 pt-2">
        <span className="size-1.5 shrink-0 rounded-full" style={{ background: "#ff5f57" }} />
        <span className="size-1.5 shrink-0 rounded-full" style={{ background: "#febc2e" }} />
        <span className="size-1.5 shrink-0 rounded-full" style={{ background: "#28c840" }} />
      </div>
    )
  }
  return (
    <div className={cn("flex items-center justify-end gap-1 px-2 pt-2", dark ? "text-[#a3a3a3]" : "text-[#737373]")}>
      <MinusIcon className="size-2" strokeWidth={1} />
      <SquareIcon className="size-1.5" strokeWidth={1} />
      <XIcon className="size-2" strokeWidth={1} />
    </div>
  )
}

/** ALwith Desktop's theme preview card: a miniature window in the mode's colors, split for system. */
function ThemePreview({ mode, active }: { mode: ThemeMode; active: boolean }) {
  const dark = mode === "dark"
  return (
    <div
      className={cn(
        "relative h-16 w-24 overflow-hidden rounded-lg border-2 transition-colors",
        active ? "border-ring" : "hover:border-muted-foreground/30 border-transparent"
      )}
    >
      {mode === "system" ? (
        <div className="flex h-full">
          <div className="flex-1 bg-[#f5f5f5]">
            <div className="ms-1.5 mt-2 h-1.5 w-6 rounded-full bg-[#d4d4d4]" />
            <div className="ms-1.5 mt-1 h-1 w-8 rounded-full bg-[#e5e5e5]" />
            <div className="ms-1.5 mt-0.5 h-1 w-5 rounded-full bg-[#e5e5e5]" />
          </div>
          <div className="flex-1 bg-[#1e1e1e]">
            <div className="ms-1.5 mt-2 h-1.5 w-6 rounded-full bg-[#404040]" />
            <div className="ms-1.5 mt-1 h-1 w-8 rounded-full bg-[#333333]" />
            <div className="ms-1.5 mt-0.5 h-1 w-5 rounded-full bg-[#333333]" />
          </div>
        </div>
      ) : (
        <div className={cn("h-full", dark ? "bg-[#1e1e1e]" : "bg-[#f5f5f5]")}>
          <PreviewChrome dark={dark} />
          <div className="mt-2 px-2">
            <div className={cn("h-1.5 w-10 rounded-full", dark ? "bg-[#404040]" : "bg-[#d4d4d4]")} />
            <div className={cn("mt-1 h-1 w-14 rounded-full", dark ? "bg-[#333333]" : "bg-[#e5e5e5]")} />
            <div className={cn("mt-0.5 h-1 w-8 rounded-full", dark ? "bg-[#333333]" : "bg-[#e5e5e5]")} />
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * ALwith Desktop's appearance mode picker: light / system / dark preview cards. Controlled, so hosts with their
 * own theme store (U) use the same cards; labels are in light, system, dark order.
 */
export function ThemeModePicker({
  value,
  onChange,
  labels,
  label
}: {
  value: ThemeMode
  onChange: (value: ThemeMode) => void
  labels: { light: string; system: string; dark: string }
  label: string
}) {
  const options: ThemeMode[] = ["light", "system", "dark"]
  return (
    <div role="radiogroup" aria-label={label} className="flex items-center gap-2">
      {options.map((mode) => {
        const active = value === mode
        return (
          <button
            key={mode}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(mode)}
            className="focus-visible:[&>div]:border-ring flex cursor-pointer flex-col items-center gap-1.5 outline-none"
          >
            <ThemePreview mode={mode} active={active} />
            <span className={cn("text-xs", active ? "text-foreground font-medium" : "text-muted-foreground")}>
              {labels[mode]}
            </span>
          </button>
        )
      })}
    </div>
  )
}

/** The shell's appearance rows: the theme preference and U's zoom level (View → Zoom In / Zoom Out / Actual Size). */
export function AppearanceSection({ language }: { language: string }) {
  const labels = desktopSettingsLabels(language)
  const { preference, setPreference } = useDesktopTheme()
  const zoom = useSyncExternalStore(subscribeZoom, zoomLevel, zoomLevel)
  const percent = (level: number) => `${Math.round(level * 100)}%`
  return (
    <SettingGroup>
      <SettingRow title={labels.theme}>
        <ThemeModePicker
          value={preference}
          onChange={(next) => void setPreference(next).catch(console.error)}
          labels={{ light: labels.themeLight, system: labels.themeSystem, dark: labels.themeDark }}
          label={labels.theme}
        />
      </SettingRow>
      <SettingRow title={labels.zoom} aligned>
        <Select
          items={ZOOM_LEVELS.map((level) => ({ value: String(level), label: percent(level) }))}
          value={String(zoom)}
          onValueChange={(value) => {
            if (typeof value === "string" && value) void setZoomLevel(Number(value)).catch(console.error)
          }}
        >
          <SelectTrigger className="w-full" aria-label={labels.zoom}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent
            align="start"
            alignItemWithTrigger={false}
            sideOffset={6}
            className="max-w-(--available-width) min-w-0 p-1"
          >
            <SelectGroup>
              {ZOOM_LEVELS.map((level) => (
                <SelectItem key={level} value={String(level)}>
                  {percent(level)}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </SettingRow>
    </SettingGroup>
  )
}

/** U's General rows the shell can own: the version and the language. */
export function GeneralSection({
  language,
  languages,
  onLanguageChange,
  children
}: {
  language: string
  languages: readonly { code: string; label: string }[]
  onLanguageChange: (code: string) => Promise<void> | void
  /** More rows after the shell's. */
  children?: ReactNode
}) {
  const labels = desktopSettingsLabels(language)
  const [version, setVersion] = useState("")
  useEffect(() => {
    if (!isTauri()) return
    void getVersion().then(setVersion).catch(console.error)
  }, [])
  return (
    <SettingGroup>
      <SettingRow title={labels.versionLabel}>
        <span className="text-muted-foreground block text-end text-sm">v{version}</span>
      </SettingRow>
      <SettingRow title={labels.language} aligned>
        <Select
          items={languages.map((item) => ({ value: item.code, label: item.label }))}
          value={language}
          onValueChange={(value) => {
            if (typeof value === "string" && value) void Promise.resolve(onLanguageChange(value)).catch(console.error)
          }}
        >
          <SelectTrigger id="language" className="w-full" aria-label={labels.language}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent
            align="start"
            alignItemWithTrigger={false}
            sideOffset={6}
            className="max-w-(--available-width) min-w-0 p-1"
          >
            <SelectGroup>
              {languages.map((item) => (
                <SelectItem key={item.code} value={item.code}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </SettingRow>
      {children}
    </SettingGroup>
  )
}

/** U's About rows: the bundled engine, then the application's own rows (updates, licenses). */
export function AboutSection({ language, children }: { language: string; children?: ReactNode }) {
  const labels = desktopSettingsLabels(language)
  const [cli, setCli] = useState<string | null>(null)
  useEffect(() => {
    if (!isTauri()) return
    let active = true
    void readBundledCliStatus("codex")
      .then((status) => {
        if (active) setCli(status.version)
      })
      .catch(console.error)
    return () => {
      active = false
    }
  }, [])
  return (
    <SettingGroup>
      <SettingRow title={labels.engine}>
        <span className="text-muted-foreground text-sm">{labels.codexVersion.replace("{{version}}", cli ?? "—")}</span>
      </SettingRow>
      {children}
    </SettingGroup>
  )
}
