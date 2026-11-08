/** U's zoom steps (Chrome's and VS Code's): View → Zoom In / Zoom Out / Actual Size. */
export declare const ZOOM_LEVELS: readonly number[];
/** The nearest step; a value beyond the steps becomes the first or last one. */
export declare function clampZoomLevel(value: number): number;
/** The saved level, else the default (100%). */
export declare function readZoomPreference(): number;
/** Applies and saves the level here, then the other windows follow. */
export declare function setZoomLevel(value: number): Promise<void>;
export declare function zoomIn(): Promise<void>;
export declare function zoomOut(): Promise<void>;
export declare function resetZoom(): Promise<void>;
/** The level on screen now. */
export declare function zoomLevel(): number;
/** The number of zoom changes made in this window (menu, keys, buttons); feedback shows once per change. */
export declare function zoomInteraction(): number;
export declare function subscribeZoom(listener: () => void): () => void;
/**
 * Applies the saved level to this window before the first paint, answers the View menu (Zoom In, Zoom
 * Out, Actual Size) and the other windows' changes. Call once per page, before rendering.
 */
export declare function initializeDesktopZoom(): Promise<void>;
