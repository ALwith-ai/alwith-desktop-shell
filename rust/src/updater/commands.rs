use crate::updater::state::State as UpdaterState;
use crate::updater::{ReleaseIdentity, UpdaterService};
use std::sync::Arc;
use tauri::{AppHandle, Manager, State as TauriState, WebviewWindow};

/// A manual check: one round now, downloading a hit as the background loop would. While another
/// updater operation runs it only reports the state.
#[tauri::command]
pub async fn updater_check(svc: TauriState<'_, Arc<UpdaterService>>) -> Result<UpdaterState, String> {
    Ok(svc.inner().clone().check_now().await)
}

#[tauri::command]
pub async fn updater_state(svc: TauriState<'_, Arc<UpdaterService>>) -> Result<UpdaterState, String> {
    Ok(svc.state())
}

/// Swaps the staged update into place and restarts. `expected` is the release the user confirmed;
/// a different ready release is refused.
#[tauri::command]
pub async fn updater_install_and_relaunch(
    window: WebviewWindow, svc: TauriState<'_, Arc<UpdaterService>>, expected: Option<ReleaseIdentity>,
) -> Result<(), String> {
    if let Some(label) = svc.install_window()
        && window.label() != label
    {
        return Err(format!("Install must be requested by the {label} window"));
    }
    svc.inner().clone().install_and_relaunch(expected.as_ref()).await
}

pub(crate) fn updater_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let base = app.path().app_cache_dir().map_err(|e| e.to_string())?;
    Ok(base.join("updater"))
}
