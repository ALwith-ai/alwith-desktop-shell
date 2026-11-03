import type { ReactElement } from "react";
import type { DesktopUpdate, DesktopUpdaterState } from "./native.js";
import type { DesktopUpdateLabels } from "./react.js";
/** The native side of the updater; tests and other hosts may supply their own. */
export interface DesktopUpdaterIo {
  getState: () => Promise<DesktopUpdaterState>;
  listen: (handler: (state: DesktopUpdaterState) => void) => Promise<() => void>;
  check: () => Promise<DesktopUpdaterState>;
  install: (expected: Pick<DesktopUpdate, "version" | "signature">) => Promise<void>;
  confirm: (labels: DesktopUpdateLabels) => Promise<boolean>;
}
/** Application hooks around the shared updater, set once per window with `configureDesktopUpdater`. */
export interface DesktopUpdaterHooks {
  /** Runs after the user confirms and before the update is installed; a rejection cancels the install and becomes `error`. */
  prepare?: () => Promise<void>;
  /** Always follows `prepare`; `installed` is false when the install did not start. */
  finishPreparation?: (installed: boolean) => void;
  /** Every state change this window sees, for example for analytics. */
  onStateChange?: (state: DesktopUpdaterState, previous: DesktopUpdaterState) => void;
  /** `native` (default) asks with the platform dialog; `custom` sets `prompt` for the application's own dialog. */
  dialog?: "native" | "custom";
}
export interface DesktopUpdaterSnapshot {
  state: DesktopUpdaterState;
  /** An install is being prepared or started. */
  busy: boolean;
  /** Why the last install did not happen. */
  error: string | null;
  /** The application's own dialog should ask now (`dialog: "custom"`). */
  prompt: boolean;
}
export interface DesktopUpdater {
  getSnapshot(): DesktopUpdaterSnapshot;
  subscribe(listener: () => void): () => void;
  configure(hooks: DesktopUpdaterHooks): void;
  setLabels(labels: DesktopUpdateLabels): void;
  /** Mirrors the native state (listen, then get); with `autoPrompt` this window asks once per ready version. */
  start(autoPrompt?: boolean): Promise<void>;
  check(): Promise<void>;
  /** Prepare, re-check the confirmed release, install. Resolves whether the install started. */
  install(): Promise<boolean>;
  confirmInstallAndRelaunch(): Promise<boolean>;
  requestInstall(): Promise<boolean>;
  dismiss(): void;
}
/** One updater mirror over `io`; the shell's own instance backs `useDesktopUpdater`. */
export declare function createDesktopUpdater(io: DesktopUpdaterIo): DesktopUpdater;
/** Sets this window's updater hooks: `prepare`, `finishPreparation`, `onStateChange` and `dialog`. */
export declare function configureDesktopUpdater(hooks: DesktopUpdaterHooks): void;
/** The status line for a state: checking, downloading with percent, staging, ready, up to date or disabled. */
export declare function desktopUpdateStatusText(state: DesktopUpdaterState, labels: DesktopUpdateLabels): string;
/**
 * The application updater without UI. `autoPrompt` asks to relaunch once per ready version; only
 * the main window should pass it. Render your own card, dialog or rail from the result.
 */
export declare function useDesktopUpdater(options?: {
  autoPrompt?: boolean;
  labels?: Partial<DesktopUpdateLabels>;
  onError?: (error: unknown) => void;
}): DesktopUpdaterSnapshot & {
  labels: DesktopUpdateLabels;
  status: string;
  check: () => Promise<void>;
  install: () => Promise<boolean>;
  confirmInstallAndRelaunch: () => Promise<boolean>;
  requestInstall: () => Promise<boolean>;
  dismiss: () => void;
};
/** ALwith Desktop's update card at the foot of the navigation: progress, staging, installing, then relaunch. */
export declare function DesktopUpdateStatus(props: {
  labels?: Partial<DesktopUpdateLabels>;
  onError?: (error: unknown) => void;
}): ReactElement | null;
