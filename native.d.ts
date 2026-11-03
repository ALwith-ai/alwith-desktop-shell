export interface DesktopShellState { platform: "macos" | "windows" | "linux" | "browser"; backdrop: "native" | "opaque"; updates: boolean }
export interface DesktopUpdate { version: string; filename: string; signature: string; contentLength: number | null }
export type DesktopUpdaterState =
  | { type: "uninitialized" | "idle" | "checkingForUpdates" }
  | { type: "disabled"; reason: "invalidConfiguration" | "debugBuild" | "cacheUnavailable" }
  | { type: "availableForDownload" | "staging" | "ready" | "restarting"; update: DesktopUpdate }
  | { type: "downloading"; update: DesktopUpdate; downloadedBytes: number | null; totalBytes: number | null }
export declare function initializeDesktopShell(): Promise<DesktopShellState>;
export declare function onDesktopNewChat(handler: () => void): Promise<() => void>;
export type DesktopMenuAction = "new-chat" | "settings" | "find";
export declare function onDesktopMenu(action: DesktopMenuAction, handler: () => void): Promise<() => void>;
export declare function getUpdaterState(): Promise<DesktopUpdaterState>;
export declare function onUpdaterState(handler: (state: DesktopUpdaterState) => void): Promise<() => void>;
export declare function checkForUpdates(): Promise<DesktopUpdaterState>;
export declare function installUpdateAndRelaunch(expected?: Pick<DesktopUpdate, "version" | "signature">): Promise<void>;
export declare function confirmDialog(options: { title: string; message: string; ok: string; cancel: string }): Promise<boolean>;
export declare function chooseFolder(defaultPath?: string | null): Promise<string | null>;
export interface DesktopSettingsWindowOptions {
  /** The `?tab=` of a new window opened without `section`; default: none (the page's own fallback, `"general"`). */
  defaultSection?: string;
  /** The new window's ground (Tauri `Color`); default: the platform default. */
  backgroundColor?: import("@tauri-apps/api/window").Color;
  /** Runs before every show and focus, for a new or an existing window (U re-parents it to main on macOS). */
  attach?: (label: string) => Promise<unknown>;
}
export declare function openDesktopSettings(title?: string, section?: string, options?: DesktopSettingsWindowOptions): Promise<void>;
export declare function onSettingsSectionChange(handler: (section: string) => void): Promise<() => void>;
export declare function openDesktopGuide(title?: string): Promise<void>;
export declare function closeDesktopSettings(): Promise<void>;

export declare function readBundledCliStatus(executable: string): Promise<NonNullable<import("./status-item.js").DesktopStatusItemProps["cli"]>>;
