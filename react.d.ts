import type { ReactNode, ReactElement } from "react";
export interface DesktopNavigationLabels { pin: string; unpin: string; pages: string; page: (number: number) => string; overview: string; campaigns: string }
export declare function desktopNavigationLabels(language: string): DesktopNavigationLabels;
export declare function DesktopHeader(props: { title?: ReactNode; status?: ReactNode; error?: ReactNode; children?: ReactNode }): ReactElement;

export { DesktopStatusBar, DesktopStatusItem, type DesktopStatusItemProps } from "./status-item.js";
export declare function DesktopLeading(props: { navigation: ReactNode; children?: ReactNode }): ReactNode;
export { LeadingNavigation, type LeadingNavigationItem, type LeadingNavigationProps } from "./leading-navigation.js";
export declare function desktopSettingsLabels(language: string): { title: string; general: string; appearance: string; about: string; account: string; theme: string; themeLight: string; themeDark: string; themeSystem: string; language: string; versionLabel: string; engine: string; codexVersion: string; updates: string };
export interface DesktopUpdateLabels { downloading: string; installing: string; install: string; relaunchTitle: string; relaunchDescription: string; relaunchNow: string; relaunchLater: string }
export declare function desktopUpdateLabels(language: string): DesktopUpdateLabels;
export * from "./updates.js";
export * from "./workspace.js";
