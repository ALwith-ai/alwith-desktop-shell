export type DesktopThemePreference = "light" | "dark" | "system";
export type DesktopTheme = "light" | "dark";
export declare function readThemePreference(): DesktopThemePreference;
export declare function initializeDesktopTheme(): void;
export declare function setThemePreference(next: DesktopThemePreference): Promise<void>;
export declare function themePreference(): DesktopThemePreference;
export declare function resolvedTheme(): DesktopTheme;
export declare function subscribeTheme(listener: () => void): () => void;
/**
 * Records the preference for the first paint of the next page without applying it. Apps that keep the
 * preference in their own store call this whenever they apply it.
 */
export declare function rememberThemePreference(next: string): void
