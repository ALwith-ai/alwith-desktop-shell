//! U's native titlebar controls on macOS: the traffic lights sit at the titlebar's center for the
//! page's zoom level, keep their place through resizes and display changes, and stay hidden until
//! AppKit finishes a fullscreen transition.

mod native;

use native::{MAIN_WINDOW, TRAFFIC_LIGHT_CENTER_Y, align_native, prepare, traffic_light_center_y, window_key};
use objc2_app_kit::NSWindow;
use std::sync::atomic::Ordering;
use tauri::{Manager, Runtime};

fn align_main_window<R: Runtime>(window: &tauri::Window<R>) {
    if window.label() != "main" {
        return;
    }
    let handle = window.clone();
    if let Err(error) = window.run_on_main_thread(move || {
        let result = handle.ns_window().map_err(|error| error.to_string()).and_then(|pointer| {
            // SAFETY: the live Tauri window is retained and accessed on AppKit's main thread.
            align_native(unsafe { &*(pointer as *const NSWindow) }, traffic_light_center_y())
        });
        if let Err(error) = result {
            log::error!("Cannot align native window controls: {error}");
        }
    }) {
        log::error!("Cannot schedule traffic-light alignment: {error}");
    }
}

/// Decorates the window's AppKit delegate and aligns the main window's controls; the plugin calls it
/// for every window as it becomes ready.
pub(crate) fn window_ready<R: Runtime>(window: &tauri::Window<R>) {
    let handle = window.clone();
    if let Err(error) = window.run_on_main_thread(move || match handle.ns_window() {
        Ok(pointer) => {
            // SAFETY: the live Tauri window is retained and accessed on AppKit's main thread.
            let native = unsafe { &*(pointer as *const NSWindow) };
            prepare(native);
            if handle.label() == "main" {
                MAIN_WINDOW.with(|main| main.set(Some(window_key(native))));
                if let Err(error) = align_native(native, traffic_light_center_y()) {
                    log::error!("Cannot align native window controls: {error}");
                }
            }
        }
        Err(error) => log::error!("Cannot prepare fullscreen controls: {error}"),
    }) {
        log::error!("Cannot schedule fullscreen controls: {error}");
    }
    let handle = window.clone();
    window.on_window_event(move |event| on_window_event(&handle, event));
}

/// Keep native controls centered in the zoomed webview toolbar.
pub(crate) async fn set_traffic_light_zoom<R: Runtime>(window: tauri::WebviewWindow<R>, zoom: f64) -> Result<(), String> {
    if window.label() != "main" {
        return Ok(());
    }
    let center_y = 16.0 * zoom;
    TRAFFIC_LIGHT_CENTER_Y.store(center_y.to_bits(), Ordering::Relaxed);
    let (sender, receiver) = tokio::sync::oneshot::channel();
    let handle = window.clone();
    window
        .run_on_main_thread(move || {
            let result = handle.ns_window().map_err(|error| error.to_string()).and_then(|pointer| {
                // SAFETY: the live Tauri window is retained and accessed on AppKit's main thread.
                align_native(unsafe { &*(pointer as *const NSWindow) }, center_y)
            });
            let _ = sender.send(result);
        })
        .map_err(|error| error.to_string())?;
    receiver.await.map_err(|error| error.to_string())?
}

/// Re-align after the window restores its native geometry or display scale.
fn on_window_event<R: Runtime>(window: &tauri::Window<R>, event: &tauri::WindowEvent) {
    if !matches!(
        event,
        tauri::WindowEvent::Resized(_)
            | tauri::WindowEvent::ScaleFactorChanged { .. }
            | tauri::WindowEvent::Focused(true)
            | tauri::WindowEvent::Moved(_)
    ) {
        return;
    }
    align_main_window(window);
}
