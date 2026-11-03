use std::time::Duration;

/// VSCode abstractUpdateService: first check after 30s, then hourly.
pub const FIRST_CHECK_DELAY: Duration = Duration::from_secs(30);
pub const CHECK_INTERVAL: Duration = Duration::from_secs(3600);
/// While an update is ready, its release identity is revalidated this often, so the click
/// that installs it needs no network.
pub const REVALIDATION_INTERVAL: Duration = Duration::from_secs(300);

/// HTTP timeouts handed to `tauri-plugin-updater`; they bound the request itself.
pub const CHECK_TIMEOUT: Duration = Duration::from_secs(30);
pub const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(300);
pub const REVALIDATION_TIMEOUT: Duration = Duration::from_secs(30);
