import type { ReactElement } from "react";
import type { DesktopUpdaterState } from "./native.js";
import type { DesktopUpdateLabels } from "./react.js";
/**
 * The application updater: its state, a manual check and the confirmed relaunch. `autoPrompt` asks
 * to relaunch once per downloaded version; only the main window should pass it.
 */
export declare function useDesktopUpdater(options?: {
  autoPrompt?: boolean;
  labels?: Partial<DesktopUpdateLabels>;
  onError?: (error: unknown) => void;
}): {
  state: DesktopUpdaterState;
  labels: DesktopUpdateLabels;
  check: () => Promise<void>;
  confirmInstallAndRelaunch: () => Promise<void>;
};
/** ALwith Desktop's update card at the foot of the navigation: progress, installing, then relaunch. */
export declare function DesktopUpdateStatus(props: {
  labels?: Partial<DesktopUpdateLabels>;
  onError?: (error: unknown) => void;
}): ReactElement | null;
