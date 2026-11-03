import type { AtlasController } from "@nyssance/atlas/dom";
export { initializeDesktopShell, onDesktopNewChat, onDesktopMenu, getUpdaterState, onUpdaterState, checkForUpdates, installUpdateAndRelaunch, confirmDialog, chooseFolder, openDesktopSettings, openDesktopGuide, closeDesktopSettings } from "./native.js";
export type { DesktopShellState, DesktopUpdate, DesktopUpdaterState } from "./native.js";
export declare function connectDesktopAtlas(controller: AtlasController, onError?: (error: unknown) => void): () => void;
