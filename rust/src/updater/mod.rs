//! The standard auto-updater every ALwith desktop application shares through the shell plugin.
//! The service owns the state machine; `tauri-plugin-updater` checks, downloads, verifies and,
//! where the shell cannot, installs.
//!
//! A release found by the hourly check is downloaded straight away, verified, written to the
//! updater cache and staged: on macOS the archive is extracted into a complete bundle, so the
//! click that installs it only renames that bundle into place and restarts. While an update is
//! ready its release identity is revalidated every five minutes; the click itself asks no network.
//! The staged update survives restarts and is verified again (signature and identity) at launch.
//!
//! One `operation` lock serialises check and download, revalidation, recovery and installation.

pub mod bundle;
pub mod commands;
pub mod persist;
mod platform;
pub mod scheduler;
pub mod state;

pub use platform::PluginPlatform;

use crate::updater::state::{DisablementReason, State, UpdateInfo};
use semver::Version;
use serde::Deserialize;
use std::future::Future;
use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock, RwLock};
use std::time::{Duration, Instant};

/// The webview event carrying every state change.
pub const STATE_EVENT: &str = "alwith-desktop-shell:updater-state";

pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;
pub type ProgressFn = Box<dyn Fn(u64, Option<u64>) + Send + Sync>;
/// An application hook; it receives the application handle.
pub type Hook = Arc<dyn Fn(&tauri::AppHandle) + Send + Sync>;
/// An asynchronous application hook; it receives the application handle and reports failure.
pub type AsyncHook = Arc<dyn Fn(tauri::AppHandle) -> BoxFuture<'static, Result<(), String>> + Send + Sync>;

/// Application choices for the shared updater. The defaults suit generated applications.
#[derive(Clone, Default)]
pub struct UpdaterOptions {
    install_window: Option<String>,
    enable_in_debug: bool,
    before_exit: Option<Hook>,
    before_exit_async: Option<(Duration, AsyncHook)>,
    after_failed_install: Option<Hook>,
}

impl UpdaterOptions {
    pub fn new() -> Self {
        Self::default()
    }

    /// Only this window (for example `"main"`, which owns the save barrier) may install.
    pub fn install_window(mut self, label: impl Into<String>) -> Self {
        self.install_window = Some(label.into());
        self
    }

    /// Debug builds keep the updater disabled unless they opt in here.
    pub fn enable_in_debug(mut self, enabled: bool) -> Self {
        self.enable_in_debug = enabled;
        self
    }

    /// Windows: runs right before the installer is launched and the process exits through
    /// `std::process::exit`, which skips `RunEvent::Exit`. Stop child processes here. Without it the
    /// plugin's default (`cleanup_before_exit`) runs.
    pub fn on_before_exit(mut self, hook: impl Fn(&tauri::AppHandle) + Send + Sync + 'static) -> Self {
        self.before_exit = Some(Arc::new(hook));
        self
    }

    /// Every platform: awaited after the click claimed the update and before it goes into place
    /// (the macOS bundle swap, the Windows installer launch), for an ordered asynchronous shutdown
    /// such as draining Drive. An error, or not finishing within `timeout`, aborts the install: the
    /// update stays ready, the error is returned and `on_failed_install` runs. On Windows the
    /// synchronous `on_before_exit` still runs afterwards, right before the installer starts.
    pub fn on_before_exit_async(
        mut self, timeout: Duration,
        hook: impl Fn(tauri::AppHandle) -> BoxFuture<'static, Result<(), String>> + Send + Sync + 'static,
    ) -> Self {
        self.before_exit_async = Some((timeout, Arc::new(hook)));
        self
    }

    /// The installation did not happen after `on_before_exit` or `on_before_exit_async` ran; bring
    /// back what they stopped. Runs at most once per install attempt.
    pub fn on_failed_install(mut self, hook: impl Fn(&tauri::AppHandle) + Send + Sync + 'static) -> Self {
        self.after_failed_install = Some(Arc::new(hook));
        self
    }
}

/// What the frontend saw when the user confirmed: installing a different release is refused.
#[derive(Debug, Clone, Deserialize)]
pub struct ReleaseIdentity {
    pub version: String,
    pub signature: String,
}

/// A release the endpoint announced: its identity, the manifest that re-creates the plugin's
/// update offline, and the plugin's own handle while this session still has it.
#[derive(Clone)]
pub struct Release {
    pub info: UpdateInfo,
    pub manifest: serde_json::Value,
    pub native: Option<Arc<dyn std::any::Any + Send + Sync>>,
}

impl std::fmt::Debug for Release {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Release").field("info", &self.info).finish_non_exhaustive()
    }
}

/// The platform side of the updater. Blocking methods run on a blocking thread.
pub trait Platform: Send + Sync + 'static {
    /// One bounded request to the endpoints (blocking).
    fn check(&self, timeout: Duration) -> Result<Option<Release>, String>;
    /// Downloads the archive and verifies its signature.
    fn download<'a>(&'a self, release: &'a Release, on_progress: ProgressFn) -> BoxFuture<'a, Result<Vec<u8>, String>>;
    /// Re-creates a cached release from its manifest and verifies the archive against it, without
    /// network (blocking).
    fn restore(&self, info: &UpdateInfo, manifest: &serde_json::Value, archive: &Path) -> Result<Release, String>;
    /// Prepares the verified archive for an instant install (blocking): macOS extracts the bundle.
    fn stage(&self, archive: &Path, staged: &Path) -> Result<(), String>;
    /// Puts the staged update in place (blocking). Windows launches the installer and exits.
    fn install(&self, release: &Release, updater_dir: &Path) -> Result<(), String>;
    /// The application's preparation before the update goes into place; an error aborts the install.
    fn prepare_install(&self) -> BoxFuture<'_, Result<(), String>> {
        Box::pin(async { Ok(()) })
    }
    /// The install was aborted or failed after `prepare_install` began; restore the application.
    fn abort_install(&self) {}
    fn needs_explicit_restart(&self) -> bool;
    /// Requests a restart through the event loop, so `RunEvent` cleanup runs.
    fn restart(&self);
}

pub struct Context {
    pub platform: Arc<dyn Platform>,
    pub dir: PathBuf,
    pub current_version: String,
    pub install_window: Option<String>,
}

fn is_newer_version(candidate: &str, current: &str) -> Result<bool, String> {
    let candidate = Version::parse(candidate.trim_start_matches('v')).map_err(|error| error.to_string())?;
    let current = Version::parse(current.trim_start_matches('v')).map_err(|error| error.to_string())?;
    Ok(candidate > current)
}

/// `plugins.updater` must carry at least one endpoint and a public key; the plugin refuses less.
pub fn valid_updater_config(updater: Option<&serde_json::Value>) -> bool {
    let Some(updater) = updater else {
        return false;
    };
    let endpoints = updater.get("endpoints").and_then(|value| value.as_array()).is_some_and(|endpoints| {
        !endpoints.is_empty() && endpoints.iter().all(|e| e.as_str().is_some_and(|e| !e.trim().is_empty()))
    });
    let pubkey = updater.get("pubkey").and_then(|value| value.as_str()).is_some_and(|key| !key.trim().is_empty());
    endpoints && pubkey
}

/// Why the updater stays off, if it does.
pub fn disablement(configured: bool, debug_build: bool, enable_in_debug: bool) -> Option<DisablementReason> {
    if !configured {
        Some(DisablementReason::InvalidConfiguration)
    } else if debug_build && !enable_in_debug {
        Some(DisablementReason::DebugBuild)
    } else {
        None
    }
}

pub struct UpdaterService {
    state: RwLock<State>,
    operation: tokio::sync::Mutex<()>,
    generation: AtomicU64,
    stopped: AtomicBool,
    started: AtomicBool,
    stop: tokio::sync::Notify,
    release: Mutex<Option<Release>>,
    context: OnceLock<Arc<Context>>,
    notify_listeners: Box<dyn Fn(&State) + Send + Sync>,
}

impl UpdaterService {
    pub fn new(notify: impl Fn(&State) + Send + Sync + 'static) -> Self {
        Self {
            state: RwLock::new(State::Uninitialized),
            operation: tokio::sync::Mutex::new(()),
            generation: AtomicU64::new(0),
            stopped: AtomicBool::new(false),
            started: AtomicBool::new(false),
            stop: tokio::sync::Notify::new(),
            release: Mutex::new(None),
            context: OnceLock::new(),
            notify_listeners: Box::new(notify),
        }
    }

    /// Enables the service with its platform and cache directory.
    pub fn enable(&self, context: Context) {
        if self.context.set(Arc::new(context)).is_err() {
            log::warn!("updater already enabled");
        }
    }

    pub fn context(&self) -> Option<Arc<Context>> {
        self.context.get().cloned()
    }

    pub fn install_window(&self) -> Option<String> {
        self.context.get().and_then(|context| context.install_window.clone())
    }

    /// Stops the schedule and every further state change; called on exit.
    pub fn shutdown(&self) {
        self.stopped.store(true, Ordering::SeqCst);
        self.generation.fetch_add(1, Ordering::SeqCst);
        self.stop.notify_one();
    }

    fn is_stopped(&self) -> bool {
        self.stopped.load(Ordering::SeqCst)
    }

    pub fn state(&self) -> State {
        self.state.read().unwrap().clone()
    }

    pub fn set_state(&self, new_state: State) {
        if self.is_stopped() {
            return;
        }
        let mut current = self.state.write().unwrap();
        *current = new_state;
        (self.notify_listeners)(&current);
    }

    /// Store without notifying: a hit goes straight to `Downloading`, so the webview never
    /// sees `AvailableForDownload` flash by.
    fn set_state_silent(&self, new_state: State) {
        if self.is_stopped() {
            return;
        }
        *self.state.write().unwrap() = new_state;
    }

    /// Compare-and-set: moves to `next` only from a state `from` accepts.
    fn transition(&self, from: impl Fn(&State) -> bool, next: State) -> bool {
        if self.is_stopped() {
            return false;
        }
        let mut current = self.state.write().unwrap();
        if !from(&current) {
            return false;
        }
        *current = next;
        (self.notify_listeners)(&current);
        true
    }

    fn back_to_idle(&self) {
        self.set_state(State::Idle);
    }
}

/// Awaits an application hook for at most `timeout`; not finishing in time is an error.
pub async fn bounded(timeout: Duration, hook: BoxFuture<'_, Result<(), String>>) -> Result<(), String> {
    match tokio::time::timeout(timeout, hook).await {
        Ok(result) => result,
        Err(_) => Err(format!("the application did not finish preparing for the update within {timeout:?}")),
    }
}

async fn blocking<T: Send + 'static>(work: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tokio::task::spawn_blocking(work).await.unwrap_or_else(|error| Err(format!("updater task failed: {error}")))
}

impl UpdaterService {
    /// The manual check: one round now unless an operation is already running.
    pub async fn check_now(self: &Arc<Self>) -> State {
        if let Some(context) = self.context()
            && let Ok(_operation) = self.operation.try_lock()
        {
            self.check_and_download(&context).await;
        }
        self.state()
    }

    /// The scheduled check; skipped while another operation runs.
    pub async fn scheduled_check(self: &Arc<Self>) {
        if let Some(context) = self.context()
            && let Ok(_operation) = self.operation.try_lock()
        {
            self.check_and_download(&context).await;
        }
    }

    /// Idle → check → download → stage → Ready. The caller holds the operation lock.
    async fn check_and_download(self: &Arc<Self>, context: &Context) {
        if !self.transition(|state| matches!(state, State::Idle), State::CheckingForUpdates) {
            return;
        }
        let platform = context.platform.clone();
        let release = match tokio::task::spawn_blocking(move || platform.check(scheduler::CHECK_TIMEOUT)).await {
            Err(error) => {
                log::error!("update check task failed: {error}");
                return self.back_to_idle();
            }
            Ok(Err(error)) => {
                log::warn!("update check failed: {error}");
                return self.back_to_idle();
            }
            Ok(Ok(None)) => return self.back_to_idle(),
            Ok(Ok(Some(release))) => release,
        };
        self.set_state_silent(State::AvailableForDownload { update: release.info.clone() });
        let filename = release.info.filename.clone();
        if let Err(error) = self.download_and_stage(context, release).await {
            log::warn!("update download failed: {error}");
            let dir = context.dir.clone();
            let _ = blocking(move || {
                persist::discard_or_log(&dir, Some(&filename));
                Ok(())
            })
            .await;
            // A failed download must return to `Idle`, or the hourly check (which only runs from
            // `Idle`) is stuck for good.
            self.back_to_idle();
        }
    }

    async fn download_and_stage(self: &Arc<Self>, context: &Context, release: Release) -> Result<(), String> {
        let started = Instant::now();
        let update = release.info.clone();
        let generation = self.generation.fetch_add(1, Ordering::SeqCst) + 1;
        self.set_state(State::Downloading {
            update: update.clone(),
            downloaded_bytes: Some(0),
            total_bytes: update.content_length,
        });

        // Progress is throttled to about 1% (at least 64KB) so the IPC channel is not flooded;
        // the total prefers the HTTP Content-Length the plugin reports.
        let svc = self.clone();
        let progress_update = update.clone();
        let downloaded = Arc::new(AtomicU64::new(0));
        let last_emit = Arc::new(AtomicU64::new(0));
        let on_progress: ProgressFn = Box::new(move |chunk, total| {
            let now = downloaded.fetch_add(chunk, Ordering::Relaxed) + chunk;
            let total = total.or(progress_update.content_length);
            let threshold = total.map_or(262_144, |t| (t / 100).max(65_536));
            let prev = last_emit.load(Ordering::Relaxed);
            let done = total.is_some_and(|t| now >= t);
            if now.saturating_sub(prev) >= threshold || done {
                last_emit.store(now, Ordering::Relaxed);
                let mut state = svc.state.write().unwrap();
                if svc.generation.load(Ordering::SeqCst) == generation
                    && !svc.stopped.load(Ordering::SeqCst)
                    && matches!(&*state, State::Downloading { update, .. } if update == &progress_update)
                {
                    *state = State::Downloading {
                        update: progress_update.clone(),
                        downloaded_bytes: Some(now),
                        total_bytes: total,
                    };
                    (svc.notify_listeners)(&state);
                }
            }
        });

        let bytes = context.platform.download(&release, on_progress).await?;
        if self.is_stopped() {
            return Err("the application is closing".into());
        }
        let dir = context.dir.clone();
        let filename = update.filename.clone();
        let archive =
            blocking(move || persist::write_archive(&dir, &filename, &bytes).map_err(|error| error.to_string()))
                .await?;

        self.set_state(State::Staging { update: update.clone() });
        let platform = context.platform.clone();
        let staged = persist::staged_dir(&context.dir);
        blocking(move || platform.stage(&archive, &staged)).await?;
        if self.is_stopped() {
            return Err("the application is closing".into());
        }
        let state_file = context.dir.join(persist::STATE_FILE);
        let persisted =
            persist::PersistedState { ready: Some(update.clone()), manifest: Some(release.manifest.clone()) };
        persist::save(&state_file, &persisted).map_err(|error| error.to_string())?;
        *self.release.lock().unwrap() = Some(release);
        log::info!("Update {} downloaded and staged in {:?}", update.version, started.elapsed());
        self.set_state(State::Ready { update });
        Ok(())
    }

    /// Startup: a cached update is offered again only when it is newer than the running version,
    /// its archive verifies against the cached manifest, it stages again, and the remote still
    /// publishes the same release (a network error keeps it).
    pub async fn recover(self: &Arc<Self>) {
        let Some(context) = self.context() else {
            return;
        };
        let _operation = self.operation.lock().await;
        let dir = context.dir.clone();
        let persisted = persist::load(&dir.join(persist::STATE_FILE));
        let Some(ready) = persisted.ready else {
            // Leftovers: the previous version after a swap, or an unfinished staging.
            let cleanup = dir.clone();
            if let Err(error) = blocking(move || persist::remove_bundles(&cleanup).map_err(|e| e.to_string())).await {
                log::warn!("failed to clear updater cache: {error}");
            }
            return self.back_to_idle();
        };
        let discard = |reason: String| {
            let dir = dir.clone();
            let filename = ready.filename.clone();
            let svc = self.clone();
            async move {
                log::info!("discarding the cached update {}: {reason}", filename);
                let _ = blocking(move || {
                    persist::discard_or_log(&dir, Some(&filename));
                    Ok(())
                })
                .await;
                svc.back_to_idle();
            }
        };
        if !is_newer_version(&ready.version, &context.current_version).unwrap_or(false) {
            return discard(format!("{} is not newer than {}", ready.version, context.current_version)).await;
        }
        let Some(manifest) = persisted.manifest else {
            return discard("no release manifest was cached".into()).await;
        };

        self.set_state(State::Staging { update: ready.clone() });
        let platform = context.platform.clone();
        let (info, cached_dir) = (ready.clone(), dir.clone());
        let restored = blocking(move || {
            persist::remove_dir_if_exists(&persist::previous_dir(&cached_dir)).map_err(|e| e.to_string())?;
            let archive = cached_dir.join(&info.filename);
            let release = platform.restore(&info, &manifest, &archive)?;
            platform.stage(&archive, &persist::staged_dir(&cached_dir))?;
            Ok(release)
        })
        .await;
        let restored = match restored {
            Ok(release) => release,
            Err(error) => return discard(error).await,
        };

        let platform = context.platform.clone();
        match tokio::task::spawn_blocking(move || platform.check(scheduler::REVALIDATION_TIMEOUT)).await {
            Ok(Ok(Some(remote))) if remote.info.same_release(&ready) => {
                *self.release.lock().unwrap() = Some(remote);
                self.set_state(State::Ready { update: ready });
            }
            Ok(Ok(_)) => {
                drop(restored);
                self.discard_and_fetch(&context, &ready).await;
            }
            Ok(Err(error)) => {
                log::warn!("cached update revalidation failed: {error}");
                *self.release.lock().unwrap() = Some(restored);
                self.set_state(State::Ready { update: ready });
            }
            Err(error) => {
                log::error!("update revalidation task failed: {error}");
                *self.release.lock().unwrap() = Some(restored);
                self.set_state(State::Ready { update: ready });
            }
        }
    }

    /// While `Ready`, confirms the remote still publishes this release; otherwise replaces it.
    pub async fn revalidate(self: &Arc<Self>) {
        let Some(context) = self.context() else {
            return;
        };
        let Ok(_operation) = self.operation.try_lock() else {
            return;
        };
        let State::Ready { update } = self.state() else {
            return;
        };
        let platform = context.platform.clone();
        // The plugin's own HTTP timeout bounds the request; no blocking call sits inside an async timeout.
        match tokio::task::spawn_blocking(move || platform.check(scheduler::REVALIDATION_TIMEOUT)).await {
            Ok(Ok(Some(remote))) if remote.info.same_release(&update) => {
                let mut release = self.release.lock().unwrap();
                if release.as_ref().is_some_and(|current| current.info.same_release(&update)) {
                    *release = Some(remote);
                }
            }
            Ok(Ok(_)) => self.replace_ready(&context, &update).await,
            Ok(Err(error)) => log::warn!("cached update revalidation failed: {error}"),
            Err(error) => log::error!("update revalidation task failed: {error}"),
        }
    }

    /// The remote no longer publishes `update`: discard it, return to `Idle` only if it is still
    /// the ready one, and fetch the replacement at once. The caller holds the operation lock.
    async fn replace_ready(self: &Arc<Self>, context: &Context, update: &UpdateInfo) {
        if self.state().is_ready(update) {
            self.discard_and_fetch(context, update).await;
        }
    }

    async fn discard_and_fetch(self: &Arc<Self>, context: &Context, update: &UpdateInfo) {
        log::info!("update {} was withdrawn or replaced; fetching the current release", update.version);
        let dir = context.dir.clone();
        let filename = update.filename.clone();
        let _ = blocking(move || {
            persist::discard_or_log(&dir, Some(&filename));
            Ok(())
        })
        .await;
        *self.release.lock().unwrap() = None;
        if self.transition(
            |state| {
                state.is_ready(update)
                    || matches!(state, State::Staging { update: staging } if staging.same_release(update))
            },
            State::Idle,
        ) {
            self.check_and_download(context).await;
        }
    }

    /// The click: the staged update goes into place and the application restarts. No network.
    pub async fn install_and_relaunch(self: &Arc<Self>, expected: Option<&ReleaseIdentity>) -> Result<(), String> {
        let clicked = Instant::now();
        let context = self.context().ok_or("updates are not enabled")?;
        let matches_expected = |update: &UpdateInfo| {
            expected.is_none_or(|expected| expected.version == update.version && expected.signature == update.signature)
        };
        match self.state() {
            State::Ready { update } if matches_expected(&update) => {}
            State::Ready { .. } => {
                return Err("the update changed; review the new version before installing".into());
            }
            _ => return Err("not in Ready state".into()),
        }
        // Only a revalidation (bounded by its timeout) can hold the lock while an update is ready.
        let _operation = self.operation.lock().await;
        if self.is_stopped() {
            return Err("the application is closing".into());
        }
        // Claim the update atomically so concurrent windows cannot install it twice.
        let update = {
            let mut state = self.state.write().unwrap();
            let update = match &*state {
                State::Ready { update } if matches_expected(update) => update.clone(),
                State::Ready { .. } => {
                    return Err("the update changed; review the new version before installing".into());
                }
                _ => return Err("not in Ready state".into()),
            };
            *state = State::Restarting { update: update.clone() };
            (self.notify_listeners)(&state);
            update
        };
        log::info!("Installing update {} ({:?} after click)", update.version, clicked.elapsed());
        let Some(release) = self.release.lock().unwrap().clone().filter(|release| release.info.same_release(&update))
        else {
            self.set_state(State::Ready { update });
            return Err("the staged update is missing".into());
        };
        if let Err(error) = context.platform.prepare_install().await {
            log::error!("Update preparation failed {:?} after click: {error}", clicked.elapsed());
            context.platform.abort_install();
            self.set_state(State::Ready { update });
            return Err(error);
        }
        let platform = context.platform.clone();
        let dir = context.dir.clone();
        if let Err(error) = blocking(move || platform.install(&release, &dir)).await {
            log::error!("Update installation failed {:?} after click: {error}", clicked.elapsed());
            context.platform.abort_install();
            self.set_state(State::Ready { update });
            return Err(error);
        }
        log::info!("Update {} in place {:?} after click", update.version, clicked.elapsed());
        // The staged directory now holds the previous version; the next launch removes it.
        if let Err(error) = persist::clear(&context.dir, Some(&update.filename)) {
            log::warn!("failed to clear updater cache: {error}");
        }
        *self.release.lock().unwrap() = None;
        if context.platform.needs_explicit_restart() {
            log::info!("Restart requested {:?} after click", clicked.elapsed());
            context.platform.restart();
        }
        Ok(())
    }

    /// Recovery, then the hourly check and the five-minute revalidation, until `shutdown`.
    pub async fn run(
        self: Arc<Self>, first_check: Duration, check_interval: Duration, revalidation_interval: Duration,
    ) {
        if self.started.swap(true, Ordering::SeqCst) {
            return;
        }
        let svc = self.clone();
        let work = async move {
            svc.recover().await;
            let start = tokio::time::Instant::now();
            let mut checks = tokio::time::interval_at(start + first_check, check_interval);
            let mut revalidations = tokio::time::interval_at(start + revalidation_interval, revalidation_interval);
            checks.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
            revalidations.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
            loop {
                tokio::select! {
                    _ = checks.tick() => svc.scheduled_check().await,
                    _ = revalidations.tick() => svc.revalidate().await,
                }
            }
        };
        tokio::select! {
            () = work => {}
            () = self.stop.notified() => {}
        }
    }
}

// ── Tauri wiring ────────────────────────────────────────────────────────────

use tauri::{AppHandle, Emitter, Manager};

/// Creates the service: state changes reach every webview as `STATE_EVENT`. Missing endpoints or
/// public key, a debug build without opt-in, or no cache directory leave it `Disabled`.
pub fn init(app: &AppHandle, options: UpdaterOptions) {
    let app_handle = app.clone();
    let svc = Arc::new(UpdaterService::new(move |state| {
        if let Err(error) = app_handle.emit(STATE_EVENT, state) {
            log::error!("Cannot emit event: {error}");
        }
    }));
    app.manage(svc.clone());

    let configured = valid_updater_config(app.config().plugins.0.get("updater"));
    if let Some(reason) = disablement(configured, cfg!(debug_assertions), options.enable_in_debug) {
        log::info!("Updates disabled: {reason:?}");
        return svc.set_state(State::Disabled { reason });
    }
    let dir = match commands::updater_dir(app) {
        Ok(dir) => dir,
        Err(error) => {
            log::error!("Updates disabled, the updater cache is unavailable: {error}");
            return svc.set_state(State::Disabled { reason: DisablementReason::CacheUnavailable });
        }
    };
    svc.enable(Context {
        platform: Arc::new(PluginPlatform::new(app.clone(), options.clone())),
        dir,
        current_version: app.package_info().version.to_string(),
        install_window: options.install_window,
    });
}

/// Starts recovery and the schedule once every plugin, including `tauri-plugin-updater`, is set up.
pub fn start(app: &AppHandle) {
    if let Some(svc) = app.try_state::<Arc<UpdaterService>>()
        && svc.context().is_some()
    {
        let svc = svc.inner().clone();
        tauri::async_runtime::spawn(svc.run(
            scheduler::FIRST_CHECK_DELAY,
            scheduler::CHECK_INTERVAL,
            scheduler::REVALIDATION_INTERVAL,
        ));
    }
}

/// Stops the updater on exit; the shell plugin calls this itself.
pub fn shutdown(app: &AppHandle) {
    if let Some(svc) = app.try_state::<Arc<UpdaterService>>() {
        svc.shutdown();
    }
}

#[cfg(test)]
pub(crate) mod test_support {
    /// A unique scratch directory removed on drop (no `tempfile` dependency).
    pub struct TempDir(std::path::PathBuf);

    impl TempDir {
        pub fn new() -> Self {
            static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
            let id = NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            let path = std::env::temp_dir().join(format!("alwith-shell-updater-{}-{id}", std::process::id()));
            let _ = std::fs::remove_dir_all(&path);
            std::fs::create_dir_all(&path).unwrap();
            Self(path)
        }

        pub fn path(&self) -> &std::path::Path {
            &self.0
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
}

#[cfg(test)]
mod tests;
