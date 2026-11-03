use super::test_support::TempDir;
use super::*;
use std::sync::atomic::AtomicUsize;
use std::sync::mpsc;

fn info(version: &str) -> UpdateInfo {
    UpdateInfo {
        version: version.into(),
        filename: format!("app-{version}.app.tar.gz"),
        signature: format!("sig-{version}"),
        content_length: Some(5),
    }
}

/// A scripted platform. Blocking calls can be held at a gate to observe the operation lock.
struct MockPlatform {
    remote: Mutex<Result<Option<UpdateInfo>, String>>,
    panic_on_check: AtomicBool,
    check_gate: Mutex<Option<mpsc::Receiver<()>>>,
    check_entered: tokio::sync::Notify,
    checks: AtomicUsize,
    download: Mutex<Result<Vec<u8>, String>>,
    download_gate: Mutex<Option<Arc<tokio::sync::Notify>>>,
    download_entered: tokio::sync::Notify,
    downloads: AtomicUsize,
    restore: Mutex<Result<(), String>>,
    restores: AtomicUsize,
    stage: Mutex<Result<(), String>>,
    stages: AtomicUsize,
    install: Mutex<Result<(), String>>,
    installs: AtomicUsize,
    explicit_restart: bool,
    restarts: AtomicUsize,
    prepare: Mutex<Result<(), String>>,
    /// Installs seen when each preparation finished: proves preparation precedes installation.
    prepared_before: Mutex<Vec<usize>>,
    aborts: AtomicUsize,
}

impl MockPlatform {
    fn new(remote: Option<&str>) -> Arc<Self> {
        Self::with_restart(remote, true)
    }

    fn with_restart(remote: Option<&str>, explicit_restart: bool) -> Arc<Self> {
        Arc::new(Self {
            remote: Mutex::new(Ok(remote.map(info))),
            panic_on_check: AtomicBool::new(false),
            check_gate: Mutex::new(None),
            check_entered: tokio::sync::Notify::new(),
            checks: AtomicUsize::new(0),
            download: Mutex::new(Ok(b"bytes".to_vec())),
            download_gate: Mutex::new(None),
            download_entered: tokio::sync::Notify::new(),
            downloads: AtomicUsize::new(0),
            restore: Mutex::new(Ok(())),
            restores: AtomicUsize::new(0),
            stage: Mutex::new(Ok(())),
            stages: AtomicUsize::new(0),
            install: Mutex::new(Ok(())),
            installs: AtomicUsize::new(0),
            explicit_restart,
            restarts: AtomicUsize::new(0),
            prepare: Mutex::new(Ok(())),
            prepared_before: Mutex::new(Vec::new()),
            aborts: AtomicUsize::new(0),
        })
    }

    fn set_remote(&self, remote: Result<Option<&str>, &str>) {
        *self.remote.lock().unwrap() = remote.map(|remote| remote.map(info)).map_err(str::to_owned);
    }

    fn hold_checks(&self) -> mpsc::Sender<()> {
        let (sender, receiver) = mpsc::channel();
        *self.check_gate.lock().unwrap() = Some(receiver);
        sender
    }

    fn hold_downloads(&self) -> Arc<tokio::sync::Notify> {
        let gate = Arc::new(tokio::sync::Notify::new());
        *self.download_gate.lock().unwrap() = Some(gate.clone());
        gate
    }
}

impl Platform for MockPlatform {
    fn check(&self, _: Duration) -> Result<Option<Release>, String> {
        self.checks.fetch_add(1, Ordering::SeqCst);
        if self.panic_on_check.load(Ordering::SeqCst) {
            panic!("check panicked");
        }
        let gate = self.check_gate.lock().unwrap().take();
        if let Some(gate) = gate {
            self.check_entered.notify_one();
            let _ = gate.recv();
        }
        let remote = self.remote.lock().unwrap().clone()?;
        Ok(remote.map(|info| Release { manifest: serde_json::json!({ "version": info.version }), info, native: None }))
    }

    fn download<'a>(&'a self, release: &'a Release, on_progress: ProgressFn) -> BoxFuture<'a, Result<Vec<u8>, String>> {
        Box::pin(async move {
            self.downloads.fetch_add(1, Ordering::SeqCst);
            let gate = self.download_gate.lock().unwrap().take();
            if let Some(gate) = gate {
                self.download_entered.notify_one();
                gate.notified().await;
            }
            on_progress(release.info.content_length.unwrap_or(5), release.info.content_length);
            self.download.lock().unwrap().clone()
        })
    }

    fn restore(&self, info: &UpdateInfo, manifest: &serde_json::Value, archive: &Path) -> Result<Release, String> {
        self.restores.fetch_add(1, Ordering::SeqCst);
        std::fs::read(archive).map_err(|error| error.to_string())?;
        self.restore.lock().unwrap().clone()?;
        Ok(Release { info: info.clone(), manifest: manifest.clone(), native: None })
    }

    fn stage(&self, archive: &Path, staged: &Path) -> Result<(), String> {
        self.stages.fetch_add(1, Ordering::SeqCst);
        self.stage.lock().unwrap().clone()?;
        let bytes = std::fs::read(archive).map_err(|error| error.to_string())?;
        persist::remove_dir_if_exists(staged).map_err(|error| error.to_string())?;
        std::fs::create_dir_all(staged.join("Contents")).map_err(|error| error.to_string())?;
        std::fs::write(staged.join("Contents/payload"), bytes).map_err(|error| error.to_string())
    }

    fn install(&self, _: &Release, _: &Path) -> Result<(), String> {
        self.installs.fetch_add(1, Ordering::SeqCst);
        self.install.lock().unwrap().clone()
    }

    fn prepare_install(&self) -> BoxFuture<'_, Result<(), String>> {
        Box::pin(async move {
            tokio::task::yield_now().await;
            self.prepared_before.lock().unwrap().push(self.installs.load(Ordering::SeqCst));
            self.prepare.lock().unwrap().clone()
        })
    }

    fn abort_install(&self) {
        self.aborts.fetch_add(1, Ordering::SeqCst);
    }

    fn needs_explicit_restart(&self) -> bool {
        self.explicit_restart
    }

    fn restart(&self) {
        self.restarts.fetch_add(1, Ordering::SeqCst);
    }
}

struct Harness {
    svc: Arc<UpdaterService>,
    platform: Arc<MockPlatform>,
    emitted: Arc<Mutex<Vec<State>>>,
    dir: PathBuf,
}

impl Harness {
    fn new(tmp: &TempDir, platform: Arc<MockPlatform>) -> Self {
        let emitted = Arc::new(Mutex::new(Vec::<State>::new()));
        let sink = emitted.clone();
        let svc = Arc::new(UpdaterService::new(move |state| sink.lock().unwrap().push(state.clone())));
        let dir = tmp.path().join("updater");
        svc.enable(Context {
            platform: platform.clone(),
            dir: dir.clone(),
            current_version: "1.0.0".into(),
            install_window: None,
        });
        Self { svc, platform, emitted, dir }
    }

    fn idle(tmp: &TempDir, platform: Arc<MockPlatform>) -> Self {
        let harness = Self::new(tmp, platform);
        harness.svc.set_state(State::Idle);
        harness
    }

    async fn ready(tmp: &TempDir, version: &str) -> Self {
        let harness = Self::idle(tmp, MockPlatform::new(Some(version)));
        assert!(harness.svc.check_now().await.is_ready(&info(version)));
        harness
    }

    fn context(&self) -> Arc<Context> {
        self.svc.context().unwrap()
    }

    fn emitted(&self) -> Vec<State> {
        self.emitted.lock().unwrap().clone()
    }

    fn archive(&self, version: &str) -> PathBuf {
        self.dir.join(info(version).filename)
    }

    fn persisted(&self) -> persist::PersistedState {
        persist::load(&self.dir.join(persist::STATE_FILE))
    }
}

// ── check, download and staging ──

#[tokio::test]
async fn a_hit_is_downloaded_staged_persisted_and_then_ready() {
    let tmp = TempDir::new();
    let h = Harness::idle(&tmp, MockPlatform::new(Some("1.1.0")));
    let state = h.svc.check_now().await;
    assert!(state.is_ready(&info("1.1.0")));
    let kinds: Vec<_> = h.emitted().iter().map(std::mem::discriminant).collect();
    let expected = [
        State::Idle,
        State::CheckingForUpdates,
        State::Downloading { update: info("1.1.0"), downloaded_bytes: None, total_bytes: None },
        State::Staging { update: info("1.1.0") },
        State::Ready { update: info("1.1.0") },
    ];
    for kind in expected.iter().map(std::mem::discriminant) {
        assert!(kinds.contains(&kind));
    }
    assert!(!h.emitted().iter().any(|state| matches!(state, State::AvailableForDownload { .. })));
    // Ready comes only after staging finished.
    let staging = h.emitted().iter().position(|state| matches!(state, State::Staging { .. })).unwrap();
    let ready = h.emitted().iter().position(|state| matches!(state, State::Ready { .. })).unwrap();
    assert!(staging < ready);
    assert_eq!(std::fs::read(h.archive("1.1.0")).unwrap(), b"bytes");
    assert!(persist::staged_dir(&h.dir).join("Contents/payload").exists());
    let persisted = h.persisted();
    assert_eq!(persisted.ready, Some(info("1.1.0")));
    assert_eq!(persisted.manifest, Some(serde_json::json!({ "version": "1.1.0" })));
}

#[tokio::test]
async fn a_miss_an_error_or_a_panicked_check_returns_to_idle() {
    let tmp = TempDir::new();
    let h = Harness::idle(&tmp, MockPlatform::new(None));
    assert_eq!(h.svc.check_now().await, State::Idle);
    h.platform.set_remote(Err("offline"));
    assert_eq!(h.svc.check_now().await, State::Idle);
    h.platform.panic_on_check.store(true, Ordering::SeqCst);
    assert_eq!(h.svc.check_now().await, State::Idle);
    assert_eq!(h.platform.checks.load(Ordering::SeqCst), 3);
    // The next check still runs: nothing is stuck.
    h.platform.panic_on_check.store(false, Ordering::SeqCst);
    h.platform.set_remote(Ok(Some("1.1.0")));
    assert!(h.svc.check_now().await.is_ready(&info("1.1.0")));
}

#[tokio::test]
async fn failed_download_or_staging_persists_nothing_and_returns_to_idle() {
    let tmp = TempDir::new();
    let h = Harness::idle(&tmp, MockPlatform::new(Some("1.1.0")));
    *h.platform.download.lock().unwrap() = Err("network".into());
    assert_eq!(h.svc.check_now().await, State::Idle);
    assert!(!h.archive("1.1.0").exists());
    *h.platform.download.lock().unwrap() = Ok(b"bytes".to_vec());
    *h.platform.stage.lock().unwrap() = Err("disk full".into());
    assert_eq!(h.svc.check_now().await, State::Idle);
    assert!(!h.archive("1.1.0").exists());
    assert!(h.persisted().ready.is_none());
    assert!(!persist::staged_dir(&h.dir).exists());
}

#[tokio::test]
async fn checks_only_start_from_idle() {
    let tmp = TempDir::new();
    let h = Harness::new(&tmp, MockPlatform::new(Some("1.1.0")));
    // Uninitialized (recovery not finished) and Disabled never check.
    assert_eq!(h.svc.check_now().await, State::Uninitialized);
    h.svc.set_state(State::Disabled { reason: DisablementReason::DebugBuild });
    h.svc.scheduled_check().await;
    assert_eq!(h.platform.checks.load(Ordering::SeqCst), 0);
}

// ── the operation lock ──

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_operation_lock_serialises_checks_downloads_revalidation_and_install() {
    let tmp = TempDir::new();
    let h = Harness::idle(&tmp, MockPlatform::new(Some("1.1.0")));
    let gate = h.platform.hold_downloads();
    let entered = h.platform.download_entered.notified();
    let first = tokio::spawn({
        let svc = h.svc.clone();
        async move { svc.check_now().await }
    });
    entered.await;
    assert!(matches!(h.svc.state(), State::Downloading { .. }));
    // Another manual check, the schedule and a revalidation do nothing while the download runs.
    assert!(matches!(h.svc.check_now().await, State::Downloading { .. }));
    h.svc.scheduled_check().await;
    h.svc.revalidate().await;
    assert_eq!(h.platform.checks.load(Ordering::SeqCst), 1);
    assert_eq!(h.svc.install_and_relaunch(None).await.unwrap_err(), "not in Ready state");
    gate.notify_one();
    assert!(first.await.unwrap().is_ready(&info("1.1.0")));
    assert_eq!(h.platform.downloads.load(Ordering::SeqCst), 1);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn install_waits_for_a_running_revalidation_and_then_installs() {
    let tmp = TempDir::new();
    let h = Harness::ready(&tmp, "1.1.0").await;
    let release_check = h.platform.hold_checks();
    let entered = h.platform.check_entered.notified();
    let revalidation = tokio::spawn({
        let svc = h.svc.clone();
        async move { svc.revalidate().await }
    });
    entered.await;
    let install = tokio::spawn({
        let svc = h.svc.clone();
        async move { svc.install_and_relaunch(None).await }
    });
    tokio::time::sleep(Duration::from_millis(50)).await;
    assert_eq!(h.platform.installs.load(Ordering::SeqCst), 0);
    assert!(h.svc.state().is_ready(&info("1.1.0")));
    release_check.send(()).unwrap();
    revalidation.await.unwrap();
    install.await.unwrap().unwrap();
    assert_eq!(h.platform.installs.load(Ordering::SeqCst), 1);
    assert_eq!(h.platform.restarts.load(Ordering::SeqCst), 1);
}

// ── shutdown ──

#[tokio::test]
async fn shutdown_ends_the_schedule_and_freezes_the_state() {
    let tmp = TempDir::new();
    let h = Harness::new(&tmp, MockPlatform::new(None));
    let tick = Duration::from_millis(5);
    let run = tokio::spawn(h.svc.clone().run(tick, tick, tick));
    tokio::time::sleep(tick * 6).await;
    assert!(h.platform.checks.load(Ordering::SeqCst) >= 2);
    h.svc.shutdown();
    tokio::time::timeout(Duration::from_secs(2), run).await.expect("the schedule stops").unwrap();
    let checks = h.platform.checks.load(Ordering::SeqCst);
    let emitted = h.emitted().len();
    // Whatever the state was when the application exited, it no longer changes.
    let frozen = h.svc.state();
    h.svc.set_state(State::Disabled { reason: DisablementReason::DebugBuild });
    h.svc.scheduled_check().await;
    assert_eq!(h.svc.state(), frozen);
    assert_eq!(h.emitted().len(), emitted);
    assert_eq!(h.platform.checks.load(Ordering::SeqCst), checks);
}

#[tokio::test]
async fn shutdown_before_the_schedule_starts_still_stops_it() {
    let tmp = TempDir::new();
    let h = Harness::new(&tmp, MockPlatform::new(None));
    h.svc.shutdown();
    tokio::time::timeout(
        Duration::from_secs(2),
        h.svc.clone().run(Duration::ZERO, Duration::from_secs(60), Duration::from_secs(60)),
    )
    .await
    .expect("the schedule stops");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn progress_after_shutdown_is_dropped_and_nothing_is_persisted() {
    let tmp = TempDir::new();
    let h = Harness::idle(&tmp, MockPlatform::new(Some("1.1.0")));
    let gate = h.platform.hold_downloads();
    let entered = h.platform.download_entered.notified();
    let check = tokio::spawn({
        let svc = h.svc.clone();
        async move { svc.check_now().await }
    });
    entered.await;
    let before = h.emitted().len();
    h.svc.shutdown();
    gate.notify_one();
    check.await.unwrap();
    assert_eq!(h.emitted().len(), before);
    assert!(h.persisted().ready.is_none());
    assert!(matches!(h.svc.state(), State::Downloading { downloaded_bytes: Some(0), .. }));
}

// ── revalidation ──

#[tokio::test]
async fn revalidation_keeps_the_same_release_and_survives_network_errors() {
    let tmp = TempDir::new();
    let h = Harness::ready(&tmp, "1.1.0").await;
    h.svc.revalidate().await;
    assert!(h.svc.state().is_ready(&info("1.1.0")));
    h.platform.set_remote(Err("offline"));
    h.svc.revalidate().await;
    assert!(h.svc.state().is_ready(&info("1.1.0")));
    h.platform.panic_on_check.store(true, Ordering::SeqCst);
    h.svc.revalidate().await;
    assert!(h.svc.state().is_ready(&info("1.1.0")));
    assert!(h.archive("1.1.0").exists());
    assert_eq!(h.platform.downloads.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn revalidation_mismatch_discards_and_fetches_the_replacement_at_once() {
    let tmp = TempDir::new();
    let h = Harness::ready(&tmp, "1.1.0").await;
    h.platform.set_remote(Ok(Some("1.2.0")));
    h.svc.revalidate().await;
    assert!(h.svc.state().is_ready(&info("1.2.0")));
    assert!(!h.archive("1.1.0").exists());
    assert!(h.archive("1.2.0").exists());
    assert_eq!(h.persisted().ready, Some(info("1.2.0")));
    let after_ready = h.emitted().iter().position(|state| state.is_ready(&info("1.1.0"))).unwrap();
    assert!(h.emitted()[after_ready..].contains(&State::Idle));

    // A replaced artifact (same version, new signature) is a different release too.
    let mut replaced = info("1.2.0");
    replaced.signature = "resigned".into();
    *h.platform.remote.lock().unwrap() = Ok(Some(replaced.clone()));
    h.svc.revalidate().await;
    assert!(h.svc.state().is_ready(&replaced));

    // A withdrawn release leaves nothing.
    h.platform.set_remote(Ok(None));
    h.svc.revalidate().await;
    assert_eq!(h.svc.state(), State::Idle);
    assert!(h.persisted().ready.is_none());
    assert!(!persist::staged_dir(&h.dir).exists());
}

#[tokio::test]
async fn only_the_same_ready_release_is_replaced() {
    let tmp = TempDir::new();
    let h = Harness::ready(&tmp, "1.1.0").await;
    let _operation = h.svc.operation.lock().await;
    h.svc.replace_ready(&h.context(), &info("0.9.0")).await;
    assert!(h.svc.state().is_ready(&info("1.1.0")));
    assert!(h.archive("1.1.0").exists());
}

// ── restart survival ──

#[tokio::test]
async fn a_staged_update_survives_a_restart_and_is_verified_again() {
    let tmp = TempDir::new();
    let first = Harness::ready(&tmp, "1.1.0").await;
    drop(first);
    let h = Harness::new(&tmp, MockPlatform::new(Some("1.1.0")));
    h.svc.recover().await;
    assert!(h.svc.state().is_ready(&info("1.1.0")));
    assert_eq!(h.platform.restores.load(Ordering::SeqCst), 1);
    assert_eq!(h.platform.stages.load(Ordering::SeqCst), 1);
    assert!(matches!(h.emitted()[0], State::Staging { .. }));
    // Installing after the restart needs no network.
    let checks = h.platform.checks.load(Ordering::SeqCst);
    h.svc.install_and_relaunch(None).await.unwrap();
    assert_eq!(h.platform.checks.load(Ordering::SeqCst), checks);
    assert_eq!(h.platform.installs.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn recovery_keeps_the_update_offline_and_replaces_a_changed_release() {
    let tmp = TempDir::new();
    drop(Harness::ready(&tmp, "1.1.0").await);
    let offline = MockPlatform::new(None);
    offline.set_remote(Err("offline"));
    let h = Harness::new(&tmp, offline);
    h.svc.recover().await;
    assert!(h.svc.state().is_ready(&info("1.1.0")));
    drop(h);

    let h = Harness::new(&tmp, MockPlatform::new(Some("1.2.0")));
    h.svc.recover().await;
    assert!(h.svc.state().is_ready(&info("1.2.0")));
    assert!(!h.archive("1.1.0").exists());
}

#[tokio::test]
async fn recovery_discards_unverifiable_old_or_incomplete_caches() {
    // The signature or identity no longer verifies.
    let tmp = TempDir::new();
    drop(Harness::ready(&tmp, "1.1.0").await);
    let h = Harness::new(&tmp, MockPlatform::new(Some("1.1.0")));
    *h.platform.restore.lock().unwrap() = Err("bad signature".into());
    h.svc.recover().await;
    assert_eq!(h.svc.state(), State::Idle);
    assert!(h.persisted().ready.is_none());
    assert!(!h.archive("1.1.0").exists());
    assert!(!persist::staged_dir(&h.dir).exists());

    // The archive is gone.
    let tmp = TempDir::new();
    let first = Harness::ready(&tmp, "1.1.0").await;
    std::fs::remove_file(first.archive("1.1.0")).unwrap();
    let h = Harness::new(&tmp, MockPlatform::new(Some("1.1.0")));
    h.svc.recover().await;
    assert_eq!(h.svc.state(), State::Idle);

    // Not newer than the running version, or a state file from before manifests were cached.
    for (version, manifest) in [("1.0.0", true), ("0.9.0", true), ("1.1.0", false)] {
        let tmp = TempDir::new();
        let h = Harness::new(&tmp, MockPlatform::new(Some(version)));
        persist::write_archive(&h.dir, &info(version).filename, b"bytes").unwrap();
        let state = persist::PersistedState {
            ready: Some(info(version)),
            manifest: manifest.then(|| serde_json::json!({ "version": version })),
        };
        persist::save(&h.dir.join(persist::STATE_FILE), &state).unwrap();
        h.svc.recover().await;
        assert_eq!(h.svc.state(), State::Idle, "{version}");
        assert!(!h.archive(version).exists(), "{version}");
        assert_eq!(h.platform.restores.load(Ordering::SeqCst), 0);
    }
}

#[tokio::test]
async fn recovery_without_a_pending_update_removes_leftover_bundles() {
    let tmp = TempDir::new();
    let h = Harness::new(&tmp, MockPlatform::new(None));
    std::fs::create_dir_all(persist::staged_dir(&h.dir).join("Contents")).unwrap();
    std::fs::create_dir_all(persist::previous_dir(&h.dir).join("Contents")).unwrap();
    h.svc.recover().await;
    assert_eq!(h.svc.state(), State::Idle);
    assert!(!persist::staged_dir(&h.dir).exists());
    assert!(!persist::previous_dir(&h.dir).exists());
}

// ── install ──

#[tokio::test]
async fn install_claims_the_update_installs_clears_and_restarts() {
    let tmp = TempDir::new();
    let h = Harness::ready(&tmp, "1.1.0").await;
    let checks = h.platform.checks.load(Ordering::SeqCst);
    h.svc
        .install_and_relaunch(Some(&ReleaseIdentity { version: "1.1.0".into(), signature: "sig-1.1.0".into() }))
        .await
        .unwrap();
    assert!(matches!(h.svc.state(), State::Restarting { .. }));
    assert_eq!(h.platform.checks.load(Ordering::SeqCst), checks, "no network on click");
    assert_eq!(h.platform.restarts.load(Ordering::SeqCst), 1);
    assert!(!h.archive("1.1.0").exists());
    assert!(h.persisted().ready.is_none());
}

#[tokio::test]
async fn windows_like_installers_restart_themselves() {
    let tmp = TempDir::new();
    let h = Harness::idle(&tmp, MockPlatform::with_restart(Some("1.1.0"), false));
    h.svc.check_now().await;
    h.svc.install_and_relaunch(None).await.unwrap();
    assert_eq!(h.platform.installs.load(Ordering::SeqCst), 1);
    assert_eq!(h.platform.restarts.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn failed_install_restores_ready_and_keeps_the_staged_update() {
    let tmp = TempDir::new();
    let h = Harness::ready(&tmp, "1.1.0").await;
    *h.platform.install.lock().unwrap() = Err("swap failed".into());
    assert_eq!(h.svc.install_and_relaunch(None).await.unwrap_err(), "swap failed");
    assert!(h.svc.state().is_ready(&info("1.1.0")));
    let emitted = h.emitted();
    assert!(matches!(emitted[emitted.len() - 2], State::Restarting { .. }));
    assert!(h.archive("1.1.0").exists());
    assert_eq!(h.persisted().ready, Some(info("1.1.0")));
    assert_eq!(h.platform.restarts.load(Ordering::SeqCst), 0);
    // The user can try again.
    *h.platform.install.lock().unwrap() = Ok(());
    h.svc.install_and_relaunch(None).await.unwrap();
}

#[tokio::test]
async fn install_refuses_a_different_release_than_the_one_confirmed() {
    let tmp = TempDir::new();
    let h = Harness::ready(&tmp, "1.1.0").await;
    let stale = ReleaseIdentity { version: "1.1.0".into(), signature: "old".into() };
    assert!(h.svc.install_and_relaunch(Some(&stale)).await.unwrap_err().contains("changed"));
    assert_eq!(h.platform.installs.load(Ordering::SeqCst), 0);
    assert!(h.svc.state().is_ready(&info("1.1.0")));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn concurrent_installs_claim_the_update_once() {
    let tmp = TempDir::new();
    let h = Harness::ready(&tmp, "1.1.0").await;
    let (a, b) = tokio::join!(h.svc.install_and_relaunch(None), h.svc.install_and_relaunch(None));
    assert!(a.is_ok() != b.is_ok());
    assert_eq!(h.platform.installs.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn install_without_an_enabled_updater_fails_clearly() {
    let svc = Arc::new(UpdaterService::new(|_| {}));
    svc.set_state(State::Disabled { reason: DisablementReason::InvalidConfiguration });
    assert_eq!(svc.install_and_relaunch(None).await.unwrap_err(), "updates are not enabled");
}

// ── configuration ──

#[test]
fn disabled_without_endpoints_or_public_key_and_in_debug_builds_unless_opted_in() {
    let valid =
        serde_json::json!({ "pubkey": "a2V5", "endpoints": ["https://example.com/{{target}}/{{current_version}}"] });
    assert!(valid_updater_config(Some(&valid)));
    for invalid in [
        serde_json::json!({ "pubkey": "a2V5" }),
        serde_json::json!({ "pubkey": "a2V5", "endpoints": [] }),
        serde_json::json!({ "pubkey": "a2V5", "endpoints": [""] }),
        serde_json::json!({ "pubkey": "", "endpoints": ["https://example.com"] }),
        serde_json::json!({ "pubkey": "  \n", "endpoints": ["https://example.com"] }),
        serde_json::json!({ "endpoints": ["https://example.com"] }),
    ] {
        assert!(!valid_updater_config(Some(&invalid)), "{invalid}");
    }
    assert!(!valid_updater_config(None));
    assert_eq!(disablement(false, false, true), Some(DisablementReason::InvalidConfiguration));
    assert_eq!(disablement(true, true, false), Some(DisablementReason::DebugBuild));
    assert_eq!(disablement(true, true, true), None);
    assert_eq!(disablement(true, false, false), None);
}

// ── asynchronous preparation before installation ──

#[tokio::test]
async fn preparation_is_awaited_before_the_update_goes_into_place() {
    let tmp = TempDir::new();
    let h = Harness::ready(&tmp, "1.1.0").await;
    h.svc.install_and_relaunch(None).await.unwrap();
    assert_eq!(*h.platform.prepared_before.lock().unwrap(), vec![0]);
    assert_eq!(h.platform.installs.load(Ordering::SeqCst), 1);
    assert_eq!(h.platform.aborts.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn failed_preparation_aborts_returns_to_ready_and_recovers() {
    let tmp = TempDir::new();
    let h = Harness::ready(&tmp, "1.1.0").await;
    *h.platform.prepare.lock().unwrap() = Err("drive did not stop".into());
    assert_eq!(h.svc.install_and_relaunch(None).await.unwrap_err(), "drive did not stop");
    assert!(h.svc.state().is_ready(&info("1.1.0")));
    assert_eq!(h.platform.installs.load(Ordering::SeqCst), 0);
    assert_eq!(h.platform.restarts.load(Ordering::SeqCst), 0);
    assert_eq!(h.platform.aborts.load(Ordering::SeqCst), 1);
    // The update is still staged and installs once preparation succeeds.
    *h.platform.prepare.lock().unwrap() = Ok(());
    h.svc.install_and_relaunch(None).await.unwrap();
    assert_eq!(h.platform.installs.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn a_failed_install_after_preparation_recovers() {
    let tmp = TempDir::new();
    let h = Harness::ready(&tmp, "1.1.0").await;
    *h.platform.install.lock().unwrap() = Err("swap failed".into());
    assert!(h.svc.install_and_relaunch(None).await.is_err());
    assert_eq!(h.platform.aborts.load(Ordering::SeqCst), 1);
    assert!(h.svc.state().is_ready(&info("1.1.0")));
}

#[tokio::test]
async fn a_preparation_that_does_not_finish_in_time_fails() {
    let error = bounded(Duration::from_millis(10), Box::pin(std::future::pending())).await.unwrap_err();
    assert!(error.contains("within"), "{error}");
    assert_eq!(bounded(Duration::from_secs(5), Box::pin(async { Ok(()) })).await, Ok(()));
    assert_eq!(bounded(Duration::from_secs(5), Box::pin(async { Err("no".into()) })).await, Err("no".into()));
}
