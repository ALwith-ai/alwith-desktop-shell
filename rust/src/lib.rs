//! Default native desktop shell. Product names come from the application's generated config.
mod cli_status;
pub mod updater;
pub use cli_status::{bundled_cli_status, CliStatus};
use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::{Emitter, Manager};

#[derive(Clone, serde::Serialize)]
pub struct ShellState {
    pub platform: &'static str,
    pub backdrop: &'static str,
    /// `plugins.updater` has endpoints and a public key (`updates_configured`), so the application registered `tauri-plugin-updater`.
    pub updates: bool,
}

pub use updater::UpdaterOptions;

/// Who installs the main window's native material and Atlas.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NativeWindow {
    /// The shell installs macOS material or Windows acrylic and Atlas (the default).
    Shell,
    /// The application installs both itself; the shell touches neither (Atlas refuses a second
    /// install). `native_backdrop` is what the application installed, reported as `backdrop`
    /// `"native"` (true) or `"opaque"` (false).
    Host { native_backdrop: bool },
}

/// Application choices for the shell plugin.
#[derive(Clone)]
pub struct ShellOptions {
    updater: UpdaterOptions,
    native_window: NativeWindow,
}

impl Default for ShellOptions {
    fn default() -> Self {
        Self { updater: UpdaterOptions::default(), native_window: NativeWindow::Shell }
    }
}

impl ShellOptions {
    pub fn new() -> Self {
        Self::default()
    }

    /// The updater's choices; see [`UpdaterOptions`].
    pub fn updater(mut self, updater: UpdaterOptions) -> Self {
        self.updater = updater;
        self
    }

    /// Leave the main window's material and Atlas to the application; see [`NativeWindow::Host`].
    pub fn host_native_window(mut self, native_backdrop: bool) -> Self {
        self.native_window = NativeWindow::Host { native_backdrop };
        self
    }
}

/// Whether `plugins.updater` carries endpoints and a public key, exactly as the updater requires.
/// Applications register `tauri_plugin_updater` only when this is true, because the plugin refuses
/// a configuration without a public key.
pub fn updates_configured(config: &tauri::Config) -> bool {
    updater::valid_updater_config(config.plugins.0.get("updater"))
}

/// The platform's folder dialog, for a draft's new project; `None` when the user cancels.
#[tauri::command]
async fn choose_folder(default_path: Option<String>) -> Result<Option<String>, String> {
    let mut dialog = rfd::AsyncFileDialog::new();
    if let Some(path) = default_path.filter(|path| !path.is_empty()) {
        dialog = dialog.set_directory(path);
    }
    Ok(dialog.pick_folder().await.map(|folder| folder.path().to_string_lossy().into_owned()))
}

/// The platform's confirmation dialog; `true` when the user chooses `ok`.
#[tauri::command]
async fn confirm(title: String, message: String, ok: String, cancel: String) -> bool {
    use rfd::{MessageButtons, MessageDialogResult, MessageLevel};
    let result = rfd::AsyncMessageDialog::new()
        .set_level(MessageLevel::Info)
        .set_title(&title)
        .set_description(&message)
        .set_buttons(MessageButtons::OkCancelCustom(ok.clone(), cancel))
        .show()
        .await;
    matches!(result, MessageDialogResult::Ok) || matches!(result, MessageDialogResult::Custom(choice) if choice == ok)
}

type ShellStatus = std::sync::Mutex<Result<ShellState, String>>;

#[tauri::command]
fn status(state: tauri::State<'_, ShellStatus>) -> Result<ShellState, String> {
    state.lock().map_err(|error| error.to_string())?.clone()
}

#[tauri::command]
async fn has_trackpad() -> Result<bool, String> {
    atlas_tauri::availability::has_trackpad().await
}

fn install_menu(app: &tauri::AppHandle, locale: &str) -> tauri::Result<()> {
    let zh = locale.starts_with("zh");
    let name = app.config().product_name.as_deref().unwrap_or(&app.package_info().name);
    // U's accelerators: the menu is the single registration of the application's shortcuts; each item emits
    // `alwith-shell:<action>` to the focused window, where the page decides what the action does.
    let new_chat = MenuItemBuilder::with_id("alwith-shell:new-chat", if zh { "新建对话" } else { "New Chat" })
        .accelerator("CmdOrCtrl+N")
        .build(app)?;
    let preferences = MenuItemBuilder::with_id("alwith-shell:settings", if zh { "偏好设置…" } else { "Preferences…" })
        .accelerator("CmdOrCtrl+,")
        .build(app)?;
    let find = MenuItemBuilder::with_id("alwith-shell:find", if zh { "查找" } else { "Find" })
        .accelerator("CmdOrCtrl+F")
        .build(app)?;
    let file = SubmenuBuilder::new(app, if zh { "文件" } else { "File" }).item(&new_chat);
    #[cfg(not(target_os = "macos"))]
    let file = file.separator().item(&preferences);
    let file = file.close_window().build()?;
    let edit = SubmenuBuilder::new(app, if zh { "编辑" } else { "Edit" })
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .separator()
        .item(&find)
        .build()?;
    let window =
        SubmenuBuilder::new(app, if zh { "窗口" } else { "Window" }).minimize().maximize().fullscreen().build()?;
    let menu = MenuBuilder::new(app);
    #[cfg(target_os = "macos")]
    let app_menu = SubmenuBuilder::new(app, name)
        .about(None)
        .separator()
        .item(&preferences)
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit()
        .build()?;
    #[cfg(target_os = "macos")]
    let menu = menu.item(&app_menu);
    #[cfg(not(target_os = "macos"))]
    let _ = name;
    let menu = menu.item(&file).item(&edit).item(&window).build()?;
    // Windows/Linux menus belong to the main window, never every auxiliary window.
    #[cfg(target_os = "macos")]
    app.set_menu(menu)?;
    #[cfg(not(target_os = "macos"))]
    app.get_webview_window("main").ok_or_else(|| tauri::Error::AssetNotFound("main window".into()))?.set_menu(menu)?;
    app.on_menu_event(|app, event| {
        let id = event.id().as_ref();
        if !id.starts_with("alwith-shell:") {
            return;
        }
        if let Some(window) = app.webview_windows().values().find(|w| w.is_focused().unwrap_or(false))
            && let Err(error) = window.emit(id, ())
        {
            log::error!("desktop shell menu: {error}");
        }
    });
    Ok(())
}

/// Install once in the application builder. Locale is product data, not styling configuration.
pub fn init(locale: &str) -> tauri::plugin::TauriPlugin<tauri::DynRuntime> {
    init_with_options(Some(locale), ShellOptions::default())
}

/// `init` with the application's updater choices (install window, Windows exit hooks, debug opt-in).
pub fn init_with(locale: &str, updater: UpdaterOptions) -> tauri::plugin::TauriPlugin<tauri::DynRuntime> {
    init_with_options(Some(locale), ShellOptions::new().updater(updater))
}

/// The same plugin for applications that own a complete menu: identical commands and native
/// material, without the default menu.
pub fn init_native() -> tauri::plugin::TauriPlugin<tauri::DynRuntime> {
    init_with_options(None, ShellOptions::default())
}

/// `init_native` with the application's updater choices.
pub fn init_native_with(updater: UpdaterOptions) -> tauri::plugin::TauriPlugin<tauri::DynRuntime> {
    init_with_options(None, ShellOptions::new().updater(updater))
}

/// The plugin with every application choice: the default menu in `locale` (`None` for an
/// application that owns its complete menu), the updater, and who installs the native window.
pub fn init_with_options(locale: Option<&str>, options: ShellOptions) -> tauri::plugin::TauriPlugin<tauri::DynRuntime> {
    let ShellOptions { updater, native_window } = options;
    let locale = locale.map(str::to_owned);
    tauri::plugin::Builder::new("alwith-desktop-shell")
        .invoke_handler(tauri::generate_handler![
            cli_status::cli_status,
            status,
            has_trackpad,
            choose_folder,
            confirm,
            updater::commands::updater_state,
            updater::commands::updater_check,
            updater::commands::updater_install_and_relaunch
        ])
        .setup(move |app, _| {
            app.manage(ShellStatus::new(Err("Desktop shell is not ready".into())));
            // Disabled without a configured updater; otherwise checks in the background and downloads hits.
            updater::init(app, updater.clone());
            Ok(())
        })
        .on_event(move |app, event| {
            match event {
                tauri::RunEvent::Ready => {}
                // A programmatic exit or restart, or the event loop ending. A user's close request
                // (`code: None`) may still be prevented by the application, so it does not stop updates.
                tauri::RunEvent::ExitRequested { code: Some(_), .. } | tauri::RunEvent::Exit => {
                    return updater::shutdown(app);
                }
                _ => return,
            }
            // Every plugin is set up by now, so recovery and the schedule can use tauri-plugin-updater.
            updater::start(app);
            let result = install(app, locale.as_deref(), native_window).map_err(|error| error.to_string());
            if let Err(error) = &result {
                log::error!("Desktop shell: {error}");
            }
            *app.state::<ShellStatus>().lock().expect("desktop shell status") = result;
        })
        .build()
}

fn install(
    app: &tauri::AppHandle, locale: Option<&str>, native_window: NativeWindow,
) -> Result<ShellState, Box<dyn std::error::Error>> {
    let state = match native_window {
        NativeWindow::Shell => install_native(app)?,
        NativeWindow::Host { native_backdrop } => host_state(app, native_backdrop),
    };
    if let Some(locale) = locale {
        install_menu(app, locale)?;
    }
    Ok(state)
}

/// The state of an application that installed its own material and Atlas.
fn host_state(app: &tauri::AppHandle, native_backdrop: bool) -> ShellState {
    ShellState {
        platform: std::env::consts::OS,
        backdrop: if native_backdrop { "native" } else { "opaque" },
        updates: updates_configured(app.config()),
    }
}

/// Install material and Atlas once after the main window exists. Both plugin entry points call this.
pub fn install_native(app: &tauri::AppHandle) -> Result<ShellState, Box<dyn std::error::Error>> {
    let window = app.get_webview_window("main").ok_or("desktop shell needs a main window")?;
    let mut backdrop = "opaque";
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    {
        use tauri::window::{Effect, EffectsBuilder};
        #[cfg(target_os = "macos")]
        let effect = Effect::UnderWindowBackground;
        #[cfg(target_os = "windows")]
        let effect = Effect::Acrylic;
        match window.set_effects(EffectsBuilder::new().effect(effect).build()) {
            Ok(()) => backdrop = "native",
            Err(error) => log::warn!("Native backdrop unavailable, using opaque surface: {error}"),
        }
    }
    let _ = window;
    atlas_tauri::install(app)?;
    Ok(ShellState { platform: std::env::consts::OS, backdrop, updates: updates_configured(app.config()) })
}
