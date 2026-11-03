# @alwith/module-desktop-shell

Default desktop capabilities for create-alwith: native macOS/Windows/Linux menus, macOS material and Windows acrylic with an opaque fallback, and Atlas native trackpad support. The native window frame retains Windows close/minimize/maximize and system snap behavior. This initial implementation does not reproduce U's custom Windows overlay controls.

This package owns native behavior and its JS bridge. The generated shell block owns React layout and can be edited or replaced. No row-height, color, radius or titlebar styling configuration is required.

## Install in a generated application

Use the published npm package with a caret version; never link a maintainer checkout. In Cargo, depend on `tauri-plugin-alwith-desktop-shell` at `../node_modules/@alwith/module-desktop-shell/rust`. Register `.plugin(tauri_plugin_alwith_desktop_shell::init("en"))` and grant `alwith-desktop-shell:default` to the main window. Main-window configuration comes from `desktopWindow(appConfig)` in `@alwith/module-desktop-shell/config`.

Import styles.css after theme styles. Await `initializeDesktopShell()` before rendering; retain opaque defaults if initialization fails. Use `.desktop-shell`, `.desktop-shell-navigation` and `.desktop-shell-workspace` in the default block. Connect Atlas with `connectDesktopAtlas(controller)` and dispose the returned function on replacement/unmount. Subscribe to `onDesktopNewChat` only while the authenticated chat page is mounted, disposing the returned listener on unmount (including asynchronous registration races).

Native menu labels take the application's locale. Brand is read from Tauri's generated productName. Menu actions emit only to the focused webview. Standard edit/window commands use the operating system implementations.

The menu is the application's single registration of U's shortcuts: New Chat (`CmdOrCtrl+N`),
Preferences… (`CmdOrCtrl+,`, in the app menu on macOS, under File elsewhere) and Find
(`CmdOrCtrl+F`, under Edit). Each click or accelerator emits `alwith-shell:<action>` to the
focused webview; subscribe with `onDesktopMenu("new-chat" | "settings" | "find", handler)` while
the page that owns the action is mounted and dispose the listener on unmount. Pages do not register
their own `keydown` handlers for these keys.

## Ownership and release

Upgraded through npm. The Rust source ships within the public npm artifact. Default React markup belongs in create-alwith's registry block; consumers may replace it while retaining the native capabilities.

The package includes the native SDK source and third-party notices. Windows device acceptance is tracked separately.

## Replacing the complete menu

An application with its own complete menu registers `tauri_plugin_alwith_desktop_shell::init_native()` instead of `init(locale)`. It gets the same commands, native materials and Atlas without the default menu. Keep menu construction and action routing in the application. Do not also call `atlas_tauri::install`.

Applications without an Atlas page layout can import initialization and menu events from `/native`. That entry has no Atlas JavaScript dependency and does not impose navigation or sidebar markup. Native gesture installation remains part of the shell; only pages using an Atlas controller call connectDesktopAtlas.

## Brand configuration

Bun scripts import `configureProject` from `@alwith/module-desktop-shell/build`. It derives native configuration and icons from alwith.app.json, preserves user-owned pages, and uses the package name for the native binary while retaining the application display name. Generated projects do not depend on create-alwith.

The chat preset requires `chat` and `store`. Include `auth` in `modules` only for applications with ALwith account integration; native auth resources and pet asset permissions are omitted otherwise.

## Updates through GitHub Releases

An optional `updates` object turns on signed auto update: `{"github": "owner/repo", "pubkey": "<Tauri updater public key>"}`. `configureProject` then emits `plugins.updater` (the public key, the endpoint `https://github.com/owner/repo/releases/latest/download/latest.json` and `requireSignedVersion`) and `bundle.createUpdaterArtifacts`; without `updates` the configuration is unchanged.

The generated application registers `tauri_plugin_updater::Builder::new().build()` only when `tauri_plugin_alwith_desktop_shell::updates_configured(context.config())` is true, because the plugin refuses a config without a public key. The shell runs ALwith Desktop's updater: it checks 30 seconds after launch and hourly, downloads a hit straight away, keeps a verified archive across restarts and drops it when the release changes. `DesktopNavigationFooter` shows the progress and relaunch card by default (pass `status` to replace it), and the main window asks once per downloaded version whether to relaunch. `useDesktopUpdater()` exposes the state, a manual `check()` and `confirmInstallAndRelaunch()` for settings pages; `getUpdaterState()`, `onUpdaterState()`, `checkForUpdates()` and `installUpdateAndRelaunch()` are the plain functions underneath. All are covered by `alwith-desktop-shell:default`; no `updater:*` permission is needed. The private key never enters the project: create-alwith writes it to `~/.tauri/<name>.key` and the release workflow reads it from the `TAURI_SIGNING_PRIVATE_KEY` secret.

Local application builds do not create signed updater archives or require an updater private key. Release workflows opt in with `tauri build --config '{"bundle":{"createUpdaterArtifacts":true}}'` and supply their signing key. The public updater endpoint remains configured in the application.

## Pages

`desktopShellPages()` (`./vite`) is a Vite plugin for every HTML entry. Before the first paint each page
takes the theme the shell remembered, so no window flashes the wrong scheme; `setThemePreference`
remembers it, and apps that keep the theme in their own store call `rememberThemePreference` whenever they
apply it. In `index.html` it also fills the empty `#root` with the stroked ΛLwith wordmark, which plays in
the main window until React mounts. Add it to `plugins` in `vite.config.ts` and keep
`<div id="root"></div>` empty.

## Main window

`DesktopWorkspace` (`./react`) is ALwith U's main window, the one implementation every app shares: a
leading screen, the persistent navigation, the main screen (`children`, optionally a preview after chat)
and an optional `trailing` station on one Atlas canvas. Hosts supply pages; the shell owns geometry,
gestures, pagination, the overview and the window chrome.

- `screen` (`"main" | "leading"`) and `onScreenChange` select the screen; `useDesktopCanvas()` gives pages
  inside the workspace the canvas (`navigate("chat" | "preview" | "trailing")`, `trailingActive`,
  `setWorkspace` for a chat/preview split, `setDividerDragging`).
- `initialNavigationPinned` and `onNavigationPinnedChange` drive the pin toggle after the native window
  controls (80px in on macOS outside fullscreen, 8px elsewhere). Unpinned, the navigation hides and floats
  back in from the start edge. The host persists the choice; calls are serialized. The root carries
  `data-sidebar-mode="pinned" | "floating" | "hidden"`.
- `toolbar` sits at the end of the title row, `statusBar` in the bottom row (Atlas pagination shares it),
  `overlays` after the canvas. Wrap each page in `.main-chat-surface` for the rounded page surface.
- `labels` default to `desktopNavigationLabels(navigator.language)`; also pass `direction`, `trackpad`
  (the host's trackpad preference), `zoom`, `openLink` and `onError`.
- Build the navigation's footer with `DesktopNavigationFooter` (`status` first, then the footer rows as
  children); ALwith's campaign slot sits between them. Without it the slot sits at the foot of the navigation.
- Portaled menus opened from the navigation call the function in `DesktopNavigationOverlayContext` so the
  floating navigation stays open while they are.
- On Windows, wrap the app in `DesktopWindowsShell` (`icon`, `title`, `zoom`): it draws the title bar row
  and the workspace portals its toggle and toolbar there.
- The navigation ends with ALwith's campaign slot. It is part of the workspace, not an option: whether it
  shows is decided by the app's identity, and apps ALwith ships itself carry none.

The `./react` entry also provides `DesktopHeader`, `DesktopLeading` and
`LeadingNavigation`: the leading screen is U's 48px rail of icon buttons with inline-end
tooltips (`items` with id, label, icon and onClick; `activePage` highlights one) beside the page
it selected, which the host renders as `DesktopLeading`'s children. Supply page content and navigation actions; the package owns Atlas composition, native gesture wiring, header spacing and surface geometry. Import `./theme.css` for the shared U theme and `./tailwind.css` for generated-app Tailwind bindings. Other products may keep their own theme by omitting these opt-in imports.

`chooseFolder(defaultPath?)` from `./native` opens the platform's folder dialog and resolves the
picked path, or `null` when the user cancels; the chat block hands it to the conversation host as
`chooseFolder` for the draft project picker. It is covered by `alwith-desktop-shell:default`.

`openDesktopGuide(title)` opens or focuses one `guide.html` window (U's user guide: 1000×760,
resizable); the application provides that page and grants the same window permissions as for
settings.

## Settings window and appearance

`./settings` is U's settings window: `AuxWindowShell` (the auxiliary-window frame with the
sidebar under the traffic lights), `SettingsLayout` (the section list with 30px navigation rows
and the centered content column; `navigation` adds rows after the sections, such as extension
settings pages), `SettingGroup` / `SettingLabel` / `SettingRow` (import `./settings.css`), and the
sections the shell can own: `AppearanceSection` (the Theme row: light / system / dark),
`GeneralSection` (version and language rows; the application supplies its language list and
handler, and more rows as children) and `AboutSection` (the bundled Codex version, then the
application's rows such as updates and licenses). `useHideOnClose()` hides the window instead of
closing it so reopening is instant. Labels come from `desktopSettingsLabels(language)`.

`./theme` owns the appearance preference: call `initializeDesktopTheme()` in every page before
the first render; `setThemePreference("light" | "dark" | "system")` saves it, applies the `.dark`
class and the native window theme (grant `core:app:allow-set-app-theme`), and tells the other
windows through a Tauri event;
`useDesktopTheme()` (from `./settings`) reads the preference and the resolved theme in React.

`openDesktopSettings(title, section?, options?)` opens or focuses one `settings.html` window; with `section` it opens on that section (`?tab=`) or, when the window already exists, switches it there through the `settings-change-tab` event, which `useSettingsSection(sections, fallback?, onChange?)` from `./settings` follows; `onChange(id)` runs on every switch the main window asks for (U closes an open extension settings page). Options, all optional: `defaultSection` (the `?tab=` of a new window opened without `section`; default none, so the page falls back to `"general"`), `backgroundColor` (the new window's Tauri `Color`), and `attach(label)`, which runs before every show and focus (U re-parents the window to the main window on macOS; a rejection propagates and the window is not shown). Provide that page in the app build and grant the standard Tauri webview creation, show and focus permissions. Settings content does not start a chat Runtime session.

## Overview presentation

`DesktopWorkspace` connects the shared overview title, bundled Caveat font,
accent colors and social links. These are shell presentation, not Atlas layout.
Applications using Atlas directly connect the same presentation and dispose it
when their controller changes:

```js
import { connectDesktopOverview } from "@alwith/module-desktop-shell/overview"
import "@alwith/module-desktop-shell/overview.css"

const disconnect = connectDesktopOverview(atlas, { openLink: openExternal })
// On unmount, before destroying the Atlas controller:
disconnect()
```

Atlas owns overview geometry, navigation and the bottom-bar double-click gesture.
The shell observes overview state; templates do not copy the title or CSS.

## Runtime status entry

`DesktopStatusItem` (`./status-item`, also exported from `./react`) is Desktop's
bottom-right terminal icon and upward-opening status popover. Pass the server
URL/environment, application version, available update and actual Runtime CLI
version/path. The shell owns rendering; the host owns querying and opening URLs
or revealing local executables. Supply translated labels and an error handler.
There is no polling or automatic retry. Missing values remain absent, never
pretending to be a healthy connection. Environment indicators describe build
configuration, not server reachability. Nonstandard environment/signing labels
replace the icon, in server-first order. Remote CLI versions are plain text.

Render this entry in the host's existing bottom-right slot; it does not create
a footer or change Atlas pagination/insets. Include this package's JavaScript
in the host Tailwind source scan, as for the other shell React components.

`DesktopStatusBar` is ALwith Desktop's whole bottom row: a leading `start` slot
(extension status), an `end` slot before the status item (drive sync), and the
status item reading the app version and the bundled Codex CLI itself. Pass
`server` when the app talks to an ALwith server, and `readCli` when the Runtime
runs another CLI. `DesktopWorkspace` renders `<DesktopStatusBar />` when
`statusBar` is omitted, so every app shows the same corner; pass `statusBar={null}`
to hide it.

## License

Copyright 2026 ALWITHAI PTE. LTD. Licensed under the GNU Affero General Public License v3.0 only
(`AGPL-3.0-only`); see [LICENSE](LICENSE). A commercial license is available from ALwith for
applications that cannot meet the AGPL's terms. Third-party material keeps its own licenses, listed in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Contributions are accepted under the [contributor license agreement](CLA.md) so the project can stay
dual-licensed; the CLA bot asks for a signature on your first pull request.
