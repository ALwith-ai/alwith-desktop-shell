import type { ComponentType, ReactNode } from "react"

import type { DesktopTheme, DesktopThemePreference } from "./theme.js"
export declare function AuxWindowShell(props: {
  title?: ReactNode
  showTitleBar?: boolean
  sidebar: ReactNode
  sidebarClassName?: string
  className?: string
  children: ReactNode
}): ReactNode
export interface SettingsSectionItem {
  id: string
  label: string
  icon: ComponentType<{ className?: string }>
}
export declare function SettingsLayout(props: {
  sections: readonly SettingsSectionItem[]
  active: string | null
  onSelect: (id: string) => void
  label: string
  navigation?: ReactNode
  children: ReactNode
}): ReactNode
export declare function SettingLabel(props: { children: ReactNode }): ReactNode
export declare function SettingGroup(props: { children: ReactNode }): ReactNode
export declare function SettingRow(props: {
  title: string
  desc?: string
  children?: ReactNode
  aligned?: boolean
}): ReactNode
export declare function useDesktopTheme(): {
  preference: DesktopThemePreference
  theme: DesktopTheme
  setPreference: (next: DesktopThemePreference) => Promise<void>
}
export declare function useHideOnClose(onError?: (error: unknown) => void): void
/**
 * The active section: `?tab=` on first open, then what `openDesktopSettings(title, section)` asks for.
 * `onChange(id)` runs on every switch the main window asks for (also to the current section), not on local `setSection`.
 */
export declare function useSettingsSection(
  sections: readonly SettingsSectionItem[],
  fallback?: string,
  onChange?: (id: string) => void
): [string, (id: string) => void]
export type ThemeMode = "light" | "dark" | "system"
/** ALwith Desktop's light / system / dark preview cards, controlled by the host. */
export declare function ThemeModePicker(props: {
  value: ThemeMode
  onChange: (value: ThemeMode) => void
  labels: { light: string; system: string; dark: string }
  label: string
}): ReactNode
export declare function AppearanceSection(props: { language: string }): ReactNode
export declare function GeneralSection(props: {
  language: string
  languages: readonly { code: string; label: string }[]
  onLanguageChange: (code: string) => Promise<void> | void
  children?: ReactNode
}): ReactNode
export declare function AboutSection(props: { language: string; children?: ReactNode }): ReactNode
