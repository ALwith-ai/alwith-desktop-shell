//! `tauri-plugin-updater` behind the updater's `Platform`: the plugin checks and verifies
//! (minisign and the signed version); the shell downloads resumably, stages and swaps the macOS
//! bundle, and falls back to the plugin's own installer where the swap cannot run.

use crate::updater::state::UpdateInfo;
use crate::updater::{BoxFuture, DownloadError, Platform, ProgressFn, Release, UpdaterOptions, persist};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tauri::AppHandle;
use tauri_plugin_updater::{Update, UpdaterBuilder, UpdaterExt};

pub struct PluginPlatform {
    app: AppHandle,
    options: UpdaterOptions,
    /// Shared by the asynchronous hook and Windows' synchronous one, so recovery runs once.
    lifecycle: Arc<InstallLifecycle>,
}

impl PluginPlatform {
    pub fn new(app: AppHandle, options: UpdaterOptions) -> Self {
        Self { app, options, lifecycle: Arc::new(InstallLifecycle::default()) }
    }

    fn recover(&self) {
        self.lifecycle.recover_if_stopped(|| {
            if let Some(recover) = &self.options.after_failed_install {
                recover(&self.app);
            }
        });
    }

    fn release(update: Update) -> Result<Release, String> {
        let filename = persist::filename_from_url(update.download_url.as_str())
            .ok_or_else(|| format!("cannot take a safe file name from the download URL {}", update.download_url))?;
        Ok(Release {
            info: UpdateInfo {
                version: update.version.clone(),
                filename,
                signature: update.signature.clone(),
                content_length: None,
            },
            manifest: update.raw_json.clone(),
            native: Some(Arc::new(update)),
        })
    }

    /// The plugin's update re-created from the cached manifest, offline. The plugin then always
    /// requires the version recorded in the signature to match.
    fn restored(info: &UpdateInfo, manifest: &serde_json::Value, builder: UpdaterBuilder) -> Result<Update, String> {
        let update = builder
            .build()
            .map_err(|error| error.to_string())?
            .restore_update(manifest.clone())
            .map_err(|error| error.to_string())?
            .ok_or("the cached update is no longer newer than the running version")?;
        let filename = persist::filename_from_url(update.download_url.as_str());
        if update.version != info.version
            || update.signature != info.signature
            || filename.as_deref() != Some(&info.filename)
        {
            return Err("the cached release manifest does not describe the cached update".into());
        }
        Ok(update)
    }

    /// The client for the archive, configured as the plugin configures its own: the same proxy
    /// choice and the same `plugins.updater` TLS switches. It carries no deadline for the whole
    /// request; `reqwest-resumable` bounds silence instead.
    fn client(&self, update: &Update) -> Result<reqwest::Client, String> {
        // The plugin's TLS backend has no built-in provider; the plugin installs this one too.
        if rustls::crypto::CryptoProvider::get_default().is_none() {
            let _ = rustls::crypto::ring::default_provider().install_default();
        }
        let config = self.app.config().plugins.0.get("updater");
        let enabled = |camel: &str, kebab: &str| {
            config
                .and_then(|config| config.get(camel).or_else(|| config.get(kebab)))
                .and_then(serde_json::Value::as_bool)
                .unwrap_or(false)
        };
        // Not refused, as the plugin does not refuse it either: only the signature then protects
        // the archive in transit.
        if update.download_url.scheme() != "https"
            && !enabled("dangerousInsecureTransportProtocol", "dangerous-insecure-transport-protocol")
        {
            log::warn!("the update download URL {} does not use the `https` protocol", update.download_url);
        }
        let mut builder = reqwest::Client::builder()
            .user_agent(concat!(env!("CARGO_PKG_NAME"), "/", env!("CARGO_PKG_VERSION")))
            .connect_timeout(CONNECT_TIMEOUT)
            .danger_accept_invalid_certs(enabled("dangerousAcceptInvalidCerts", "dangerous-accept-invalid-certs"))
            .danger_accept_invalid_hostnames(enabled(
                "dangerousAcceptInvalidHostnames",
                "dangerous-accept-invalid-hostnames",
            ));
        if update.no_proxy {
            builder = builder.no_proxy();
        } else if let Some(proxy) = &update.proxy {
            builder = builder.proxy(reqwest::Proxy::all(proxy.as_str()).map_err(|error| error.to_string())?);
        }
        builder.build().map_err(|error| error.to_string())
    }

    /// The plugin's installer: verification, extraction and replacement (privileged when the
    /// install location needs it). On Windows it launches the installer and exits the process.
    fn plugin_install(&self, release: &Release, archive: &Path) -> Result<(), String> {
        let bytes = std::fs::read(archive).map_err(|error| format!("cannot read the update archive: {error}"))?;
        let lifecycle = self.lifecycle.clone();
        let mut builder = self.app.updater_builder();
        // Windows only: NSIS exits through `process::exit`, bypassing `RunEvent::Exit`.
        if let Some(before_exit) = self.options.before_exit.clone() {
            let stopped = lifecycle.clone();
            let app = self.app.clone();
            builder = builder.on_before_exit(move || {
                before_exit(&app);
                stopped.mark_stopped();
                // No cleanup_before_exit: launching the installer can still fail, and the
                // existing windows and resources must remain usable.
            });
        }
        let update = Self::restored(&release.info, &release.manifest, builder)?;
        let result = update.install(bytes).map_err(|error| error.to_string());
        if result.is_err() {
            self.recover();
        }
        result
    }
}

impl Platform for PluginPlatform {
    fn check(&self, timeout: Duration) -> Result<Option<Release>, String> {
        let app = self.app.clone();
        let update = tokio::runtime::Handle::current().block_on(async move {
            app.updater_builder()
                .timeout(timeout)
                .build()
                .map_err(|error| error.to_string())?
                .check()
                .await
                .map_err(|error| error.to_string())
        })?;
        update.map(Self::release).transpose()
    }

    fn download<'a>(
        &'a self, release: &'a Release, updater_dir: &'a Path, on_progress: ProgressFn,
    ) -> BoxFuture<'a, Result<PathBuf, DownloadError>> {
        Box::pin(async move {
            // The update this session's check returned honours `requireSignedVersion` as configured.
            let update = match release.native.as_ref().and_then(|native| native.downcast_ref::<Update>()) {
                Some(update) => update.clone(),
                None => Self::restored(&release.info, &release.manifest, self.app.updater_builder())
                    .map_err(DownloadError::Failed)?,
            };
            let filename = release.info.filename.clone();
            let client = self.client(&update).map_err(DownloadError::Failed)?;
            let mut headers = update.headers.clone();
            if !headers.contains_key(reqwest::header::ACCEPT) {
                headers.insert(
                    reqwest::header::ACCEPT,
                    reqwest::header::HeaderValue::from_static("application/octet-stream"),
                );
            }
            let target = updater_dir.join(&filename);
            // The signature covers the whole archive, so it is read once to be verified.
            let verifier = update.clone();
            reqwest_resumable::Download::new(update.download_url.clone())
                .headers(headers)
                .key(update.signature.clone())
                .on_progress(move |progress| on_progress(progress.downloaded, progress.total))
                .verify(move |archive| {
                    let mut bytes = Vec::new();
                    std::io::Read::read_to_end(archive, &mut bytes)?;
                    Ok(verifier.verify(&bytes)?)
                })
                .to(&client, &target)
                .await
                .map_err(|error| match error {
                    error if error.is_transient() => DownloadError::Interrupted(error.to_string()),
                    error => DownloadError::Failed(error.to_string()),
                })?;
            Ok(target)
        })
    }

    fn restore(&self, info: &UpdateInfo, manifest: &serde_json::Value, archive: &Path) -> Result<Release, String> {
        let update = Self::restored(info, manifest, self.app.updater_builder())?;
        let bytes = std::fs::read(archive).map_err(|error| format!("cannot read the cached archive: {error}"))?;
        update.verify(&bytes).map_err(|error| format!("the cached archive does not verify: {error}"))?;
        Ok(Release { info: info.clone(), manifest: manifest.clone(), native: Some(Arc::new(update)) })
    }

    fn stage(&self, archive: &Path, staged: &Path) -> Result<(), String> {
        #[cfg(target_os = "macos")]
        {
            crate::updater::bundle::extract_app_archive(archive, staged)
                .map_err(|error| format!("cannot stage the update: {error}"))
        }
        #[cfg(not(target_os = "macos"))]
        {
            let _ = (archive, staged);
            Ok(())
        }
    }

    fn install(&self, release: &Release, updater_dir: &Path) -> Result<(), String> {
        let archive = updater_dir.join(&release.info.filename);
        #[cfg(target_os = "macos")]
        {
            use crate::updater::bundle::{SwapError, swap_into_place, touch};
            let executable = std::env::current_exe().map_err(|error| error.to_string())?;
            let target =
                tauri_plugin_updater::extract_path_from_executable(&executable).map_err(|error| error.to_string())?;
            match swap_into_place(&target, &persist::staged_dir(updater_dir), &persist::previous_dir(updater_dir)) {
                Ok(()) => {
                    touch(&target);
                    Ok(())
                }
                Err(SwapError::NeedsPlugin(error)) => {
                    log::info!("staged swap unavailable ({error}); using the plugin's installer");
                    self.plugin_install(release, &archive)
                }
                Err(error) => Err(error.to_string()),
            }
        }
        #[cfg(not(target_os = "macos"))]
        {
            self.plugin_install(release, &archive)
        }
    }

    fn prepare_install(&self) -> BoxFuture<'_, Result<(), String>> {
        Box::pin(async move {
            let Some((timeout, hook)) = self.options.before_exit_async.clone() else {
                return Ok(());
            };
            // Whatever the hook stopped before failing or timing out is restored by `abort_install`.
            self.lifecycle.mark_stopped();
            crate::updater::bounded(timeout, hook(self.app.clone())).await
        })
    }

    fn abort_install(&self) {
        self.recover();
    }

    fn needs_explicit_restart(&self) -> bool {
        !cfg!(target_os = "windows")
    }

    fn restart(&self) {
        self.app.request_restart();
    }
}

/// The longest wait for a connection to the archive's server.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(30);

/// Windows: installation may fail after the `on_before_exit` hook stopped the application's work.
#[derive(Default)]
struct InstallLifecycle(std::sync::atomic::AtomicBool);

impl InstallLifecycle {
    fn mark_stopped(&self) {
        self.0.store(true, std::sync::atomic::Ordering::Release);
    }

    fn recover_if_stopped(&self, recover: impl FnOnce()) {
        if self.0.swap(false, std::sync::atomic::Ordering::AcqRel) {
            recover();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn failed_install_recovers_only_after_the_exit_hook_ran() {
        let lifecycle = InstallLifecycle::default();
        let mut recovered = 0;
        lifecycle.recover_if_stopped(|| recovered += 1);
        assert_eq!(recovered, 0);
        lifecycle.mark_stopped();
        lifecycle.recover_if_stopped(|| recovered += 1);
        lifecycle.recover_if_stopped(|| recovered += 1);
        assert_eq!(recovered, 1);
    }

    #[test]
    fn the_asynchronous_and_windows_hooks_share_one_recovery() {
        let lifecycle = InstallLifecycle::default();
        let mut recovered = 0;
        // The asynchronous hook ran, then the Windows hook, then the installer failed to launch:
        // `plugin_install` recovers, and the service's `abort_install` finds nothing left to do.
        lifecycle.mark_stopped();
        lifecycle.mark_stopped();
        lifecycle.recover_if_stopped(|| recovered += 1);
        lifecycle.recover_if_stopped(|| recovered += 1);
        assert_eq!(recovered, 1);
    }
}
