# @alwith/module-desktop-shell

Default desktop capabilities for create-alwith: native macOS/Windows/Linux menus, macOS material and Windows acrylic with an opaque fallback, and Atlas native trackpad support. The native window frame retains Windows close/minimize/maximize and system snap behavior. This initial implementation does not reproduce U's custom Windows overlay controls.

This package owns native behavior and its JS bridge. The generated shell block owns React layout and can be edited or replaced. No row-height, color, radius or titlebar styling configuration is required.

## Install in a generated application

Use the published npm package with a caret version; never link a maintainer checkout. In Cargo, depend on `alwith-desktop-shell = "0.6"` from crates.io. Register `.plugin(alwith_desktop_shell::init("en"))` and grant `alwith-desktop-shell:default` to the main window. Main-window configuration comes from `desktopWindow(appConfig)` in `@alwith/module-desktop-shell/config`.

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

An application with its own complete menu registers `alwith_desktop_shell::init_native()` instead of `init(locale)`. It gets the same commands, native materials and Atlas without the default menu. Keep menu construction and action routing in the application. Do not also call `atlas_tauri::install`.

An application that installs its own window material and Atlas (ALwith Desktop) registers `init_with_options(locale, ShellOptions::new().host_native_window(native_backdrop))` instead, with `locale` `None` when it also owns the menu. The shell then calls neither `set_effects` nor `atlas_tauri::install` (Atlas refuses a second install) and reports `backdrop` as `"native"` when `native_backdrop` is true, `"opaque"` otherwise. `init`, `init_with`, `init_native` and `init_native_with` keep installing both.

Applications without an Atlas page layout can import initialization and menu events from `/native`. That entry has no Atlas JavaScript dependency and does not impose navigation or sidebar markup. Native gesture installation remains part of the shell; only pages using an Atlas controller call connectDesktopAtlas.

## Brand configuration

Bun scripts import `configureProject` from `@alwith/module-desktop-shell/build`. It derives native configuration and icons from alwith.app.json, preserves user-owned pages, and uses the package name for the native binary while retaining the application display name. Generated projects do not depend on create-alwith.

The chat preset requires `chat` and `store`. Include `auth` in `modules` only for applications with ALwith account integration; native auth resources and pet asset permissions are omitted otherwise.

## Staging module libraries

Bun staging scripts import `stageNativeModule` from `@alwith/module-desktop-shell/stage` to copy a module's private library into the application at build time. It runs only in Node/Bun, never in the webview.

```js
import { stageNativeModule } from "@alwith/module-desktop-shell/stage"
const staged = stageNativeModule(import.meta.url, "editor", "aarch64-apple-darwin", nativeDirectory, licenses, contract)
for (const file of staged) if (file.signing === "resign") await sign(file.path)
```

`stageNativeModule(from, module, target, destination, licenses, contract?)` resolves the installed `@alwith/module-<module>` package from `from` (usually the staging script's `import.meta.url`), takes its library for one Rust target, copies it (and the device helper, made executable) into `destination` and the licences into `<licenses>/alwith-native-<module>/`, and returns every staged file as `{ path, signing }`: `resign` for ALwith libraries and helpers, which the application signs with its own identity, `resource` for licence files. Any mismatch throws. Staged files are build output and must be Git-ignored.

The artifact layout is the contract with alwith-modules, whose `scripts/lib/native-artifact.ts` validates the same fields before publication and additionally rejects unexpected files and implementation source in the directory. Each module package carries, per supported platform, `native/<os>-<cpu>/`:

- `artifact.json`: `{ module, contract, abi, target, binary, sha256, helper? }`. `module` is the module identity (`editor`, `chat-network`, ...); `contract` the integer contract generation (at least 1, and equal to `contract` when the caller passes one); `abi` is `1`; `target` the Rust target of the directory; `binary` the library file name; `sha256` its hex SHA-256; `helper` (device on macOS only, and required there) is `{ binary: "alwith-device-helper", sha256, revision }` with a 40-character hex source revision.
- The library, named `libalwith_native_<module>.dylib` (`darwin-arm64`, `aarch64-apple-darwin`), `alwith_native_<module>.dll` (`win32-x64`, `x86_64-pc-windows-msvc`) or `libalwith_native_<module>.so` (`linux-x64`, `x86_64-unknown-linux-gnu`, computer only), with `-` in the module replaced by `_`.
- `THIRD_PARTY_NOTICES.md` and `licenses/`, staged with the package's `LICENSE`. Symlinks are rejected.

The package's `package.json` `name` must be `@alwith/module-<module>`. A missing package, a missing platform directory, an unsupported target, a foreign identity, contract, ABI or file name, and a checksum mismatch each fail the build.

## Updates

An optional `updates` object turns on signed auto update: `{"pubkey": "<Tauri updater public key>", "github": "owner/repo"}`, or `endpoints` instead of (or before) `github` for any HTTPS host, such as a product-specific version service: `"endpoints": ["https://api.example.com/apps/my-app/update/{{target}}-{{arch}}/{{current_version}}"]` (the plugin fills `{{target}}`, `{{arch}}`, `{{current_version}}` and `{{bundle_type}}`). `requireSignedVersion` defaults to `true`. `configureProject` emits `plugins.updater` with the public key, the endpoints, `requireSignedVersion` and `windows.installMode: "passive"`; without `updates` the configuration is unchanged.

The application registers `tauri_plugin_updater::Builder::new().build()` only when `alwith_desktop_shell::updates_configured(context.config())` is true: endpoints and a public key are both present, the same test the shell applies. The shell then runs the one standard updater of every ALwith desktop application:

- It checks 30 seconds after launch and hourly, downloads a hit straight away (30 s check and 300 s download timeouts), writes the archive through a `.part` file, verifies it and stages it: on macOS the archive is extracted into a complete bundle in the updater cache. The state becomes `ready` only once the update is staged.
- While an update is ready, its release identity is revalidated every five minutes (30 s timeout). A withdrawn or replaced release is discarded and the current one fetched at once.
- The click asks no network. macOS renames the staged bundle into place on the same volume (an atomic exchange where APFS allows it; otherwise two renames with rollback) and falls back to the plugin's own privileged replacement when the install location is not writable or on another volume. Windows launches the verified installer immediately. The application then restarts through `request_restart()`, so its `RunEvent` cleanup runs. The log records the time from click to restart.
- A staged update survives restarts: at launch its archive is verified again against the cached release manifest (signature and signed version), staged again and revalidated.
- One lock serialises checking, downloading, revalidation, recovery and installation. The shell stops the updater itself on exit.
- The updater stays `disabled` without endpoints or public key, when the cache directory is unavailable, and in debug builds.

Rust options go through `init_with(locale, options)` or `init_native_with(options)` with `UpdaterOptions::new()`: `.install_window("main")` restricts installation to one window, `.enable_in_debug(true)` opts a debug build in, and on Windows `.on_before_exit(|app| ..)` runs before the installer replaces the application (stop child processes; the plugin otherwise calls `cleanup_before_exit`) with `.on_failed_install(|app| ..)` restoring what it stopped when the installer then fails to start. `.on_before_exit_async(timeout, |app| Box::pin(async move { .. }))` runs on every platform after the click claimed the update and before it goes into place (the macOS bundle swap, the Windows installer launch), for an ordered asynchronous shutdown such as draining Drive; the hook returns `Result<(), String>` (`updater::BoxFuture`). It is awaited at most `timeout`: an error or a timeout aborts the install explicitly (the update stays ready and the click returns the error) and `on_failed_install` runs. `on_failed_install` runs at most once per attempt, whether the asynchronous hook, the Windows hook or both ran before the failure. On Windows `on_before_exit` still runs afterwards, right before the installer starts. Pass all options through `ShellOptions::new().updater(..)` with `init_with_options` when the native window is the host's too.

`DesktopNavigationFooter` shows the progress and relaunch card by default (pass `status` to replace it), and the main window asks once per ready version whether to relaunch. `useDesktopUpdater()` is the headless hook for an application's own card, dialog or rail: `state`, `busy`, `error`, `prompt`, `status` (the label for checking, downloading, staging, ready, up to date or disabled), `check()`, `install()`, `confirmInstallAndRelaunch()`, `requestInstall()` and `dismiss()`. `configureDesktopUpdater({ prepare, finishPreparation, onStateChange, dialog })` sets per-window hooks: `prepare` runs after confirmation and before installation (save work, close admission); the release is checked again after it, and a different one is refused; `finishPreparation(installed)` always follows; `onStateChange(state, previous)` sees every change; `dialog: "custom"` sets `prompt` for the application's dialog instead of the platform question. Install failures are surfaced as `error`. `getUpdaterState()`, `onUpdaterState()`, `checkForUpdates()` and `installUpdateAndRelaunch(expected?)` are the plain functions underneath. All are covered by `alwith-desktop-shell:default`; no `updater:*` permission is needed. The private key never enters the project: create-alwith writes it to `~/.tauri/<name>.key` and the release workflow reads it from the `TAURI_SIGNING_PRIVATE_KEY` secret.

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
leading screen, the persistent navigation, the main screen's `panes` and an optional `trailing` station on
one Atlas canvas. Hosts supply panes; the shell owns geometry, gestures, pagination, the overview and the
window chrome.

- `panes` are laid out in the order given; each pane's `id` is also its region name (U passes `chat`, then
  `preview`). Neighbours share a screen while both keep their `min` (320 by default), otherwise the next one
  moves on to the following screen whole. `hidden` collapses a pane to no width and keeps its content mounted;
  a pane without it cannot be hidden. `maximized` gives a pane a whole screen, and `resizable` puts a divider
  on its start edge.
- `screen` (`"main" | "leading"`) and `onScreenChange` select the screen; `useDesktopCanvas()` gives content
  inside the workspace the canvas (`navigate(paneId | "trailing")`, `region`, `trailingActive`, `budget`).
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

## Default component libraries

The shell includes `@nyssance/shadcn` and `@nyssance/reui` as runtime dependencies, even before a page uses ReUI. UI builds map `@/components/reui/*` to ReUI and the remaining registry aliases to shadcn.

Generated applications declare both libraries directly because their editable pages consume them. Use the single `reui({ style: "vega" })` Vite plugin from `@nyssance/reui/vite`: local source overrides are checked first, followed by ReUI and shadcn. TypeScript paths and Tailwind source scanning must include both packages; create-alwith supplies this wiring by default.
