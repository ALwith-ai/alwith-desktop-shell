fn main() {
    tauri_plugin::Builder::new(&[
        "status",
        "has_trackpad",
        "cli_status",
        "choose_folder",
        "confirm",
        "updater_state",
        "updater_check",
        "updater_install_and_relaunch",
        "set_traffic_light_zoom",
    ])
    .build();
}
