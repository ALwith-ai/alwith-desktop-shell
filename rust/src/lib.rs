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
    /// `plugins.updater` exists in the generated config, so the application registered `tauri-plugin-updater`.
    pub updates: bool,
}

/// Generated apps register `tauri_plugin_updater` only when `alwith.app.json` declares `updates`,
/// which is the only way `plugins.updater` reaches the Tauri config.
pub fn updates_configured(config: &tauri::Config) -> bool {
    config.plugins.0.contains_key("updater")
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
    plugin(Some(locale.to_owned()))
}

/// The same plugin for applications that own a complete menu: identical commands and native
/// material, without the default menu.
pub fn init_native() -> tauri::plugin::TauriPlugin<tauri::DynRuntime> {
    plugin(None)
}

fn plugin(locale: Option<String>) -> tauri::plugin::TauriPlugin<tauri::DynRuntime> {
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
        .setup(|app, _| {
            app.manage(ShellStatus::new(Err("Desktop shell is not ready".into())));
            // Disabled without a configured updater; otherwise checks in the background and downloads hits.
            updater::init(app);
            Ok(())
        })
        .on_event(move |app, event| {
            if !matches!(event, tauri::RunEvent::Ready) {
                return;
            }
            let result = install(app, locale.as_deref()).map_err(|error| error.to_string());
            if let Err(error) = &result {
                log::error!("Desktop shell: {error}");
            }
            *app.state::<ShellStatus>().lock().expect("desktop shell status") = result;
        })
        .build()
}

fn install(app: &tauri::AppHandle, locale: Option<&str>) -> Result<ShellState, Box<dyn std::error::Error>> {
    let state = install_native(app)?;
    if let Some(locale) = locale {
        install_menu(app, locale)?;
    }
    Ok(state)
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
