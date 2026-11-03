//! The updater cache: `<app cache>/updater/` holds the downloaded archive, the state file that
//! names it, and on macOS the staged application bundle extracted from it.

use crate::updater::state::UpdateInfo;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

pub const STATE_FILE: &str = "updater-state.json";
/// The staged bundle, ready to be swapped into place. After a swap it holds the previous version
/// until the next launch removes it. No `.app` extension, so Launch Services never registers the copy.
pub const STAGED_DIR: &str = "staged-bundle";
/// The previous bundle while the two-rename fallback moves the staged one into place.
pub const PREVIOUS_DIR: &str = "previous-bundle";

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct PersistedState {
    pub ready: Option<UpdateInfo>,
    /// The release manifest the endpoint served, so a cached archive can be re-verified and
    /// installed after a restart without asking the network again.
    #[serde(default)]
    pub manifest: Option<serde_json::Value>,
}

/// The archive name the release URL ends with; query and fragment are not part of it.
pub fn filename_from_url(url: &str) -> Option<String> {
    url.split(['?', '#']).next()?.rsplit('/').next().filter(|s| valid_filename(s)).map(str::to_owned)
}

/// A single path component inside the updater directory, never a way out of it.
pub fn valid_filename(name: &str) -> bool {
    !name.is_empty()
        && name != "."
        && name != ".."
        && name != STATE_FILE
        && name != STAGED_DIR
        && name != PREVIOUS_DIR
        && !name.contains(['/', '\\', ':', '%', '\0'])
}

pub fn staged_dir(updater_dir: &Path) -> PathBuf {
    updater_dir.join(STAGED_DIR)
}

pub fn previous_dir(updater_dir: &Path) -> PathBuf {
    updater_dir.join(PREVIOUS_DIR)
}

/// A missing, corrupt or unsafe file means "no pending update": the file is a regenerable cache
/// written atomically by `save`, so the next check simply fetches again.
pub fn load(state_json_path: &Path) -> PersistedState {
    let Ok(text) = std::fs::read_to_string(state_json_path) else {
        return PersistedState::default();
    };
    let state: PersistedState = serde_json::from_str(&text).unwrap_or_default();
    if state.ready.as_ref().is_some_and(|update| !valid_filename(&update.filename)) {
        return PersistedState::default();
    }
    state
}

pub fn save(state_json_path: &Path, state: &PersistedState) -> std::io::Result<()> {
    if let Some(parent) = state_json_path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let tmp = state_json_path.with_extension("json.tmp");
    let text = serde_json::to_string_pretty(state).map_err(std::io::Error::other)?;
    std::fs::write(&tmp, text)?;
    std::fs::rename(&tmp, state_json_path)?;
    Ok(())
}

/// Writes `<filename>.part` and renames it, so an interrupted write never looks like an archive.
pub fn write_archive(updater_dir: &Path, filename: &str, bytes: &[u8]) -> std::io::Result<PathBuf> {
    if !valid_filename(filename) {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            format!("unsafe update filename {filename:?}"),
        ));
    }
    std::fs::create_dir_all(updater_dir)?;
    let temporary = updater_dir.join(format!("{filename}.part"));
    let archive = updater_dir.join(filename);
    std::fs::write(&temporary, bytes)?;
    std::fs::rename(&temporary, &archive)?;
    Ok(archive)
}

/// Forgets the pending update: the state file, the archive and its partial download.
pub fn clear(updater_dir: &Path, archive_filename: Option<&str>) -> std::io::Result<()> {
    remove_if_exists(&updater_dir.join(STATE_FILE))?;
    if let Some(name) = archive_filename.filter(|name| valid_filename(name)) {
        remove_if_exists(&updater_dir.join(name))?;
        remove_if_exists(&updater_dir.join(format!("{name}.part")))?;
    }
    Ok(())
}

/// Removes the staged and previous bundles.
pub fn remove_bundles(updater_dir: &Path) -> std::io::Result<()> {
    remove_dir_if_exists(&staged_dir(updater_dir))?;
    remove_dir_if_exists(&previous_dir(updater_dir))
}

/// Everything a discarded update left behind.
pub fn discard(updater_dir: &Path, archive_filename: Option<&str>) -> std::io::Result<()> {
    clear(updater_dir, archive_filename)?;
    remove_bundles(updater_dir)
}

pub fn discard_or_log(updater_dir: &Path, archive_filename: Option<&str>) {
    if let Err(error) = discard(updater_dir, archive_filename) {
        log::warn!("failed to clear updater cache: {error}");
    }
}

fn remove_if_exists(path: &Path) -> std::io::Result<()> {
    match std::fs::remove_file(path) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e),
        _ => Ok(()),
    }
}

pub(crate) fn remove_dir_if_exists(path: &Path) -> std::io::Result<()> {
    match std::fs::symlink_metadata(path) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e),
        Ok(metadata) if metadata.is_dir() => std::fs::remove_dir_all(path),
        Ok(_) => std::fs::remove_file(path),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::updater::test_support::TempDir;

    #[test]
    fn unsafe_cached_paths_are_never_recovered() {
        let tmp = TempDir::new();
        for name in
            ["../outside", "..", ".", "C:\\outside", "evil%2Foutside", "file:stream", STATE_FILE, STAGED_DIR, ""]
        {
            let text = serde_json::json!({"ready": {"version":"1.0.0", "filename":name, "signature":"sig", "contentLength":null}});
            std::fs::write(tmp.path().join(STATE_FILE), text.to_string()).unwrap();
            assert!(load(&tmp.path().join(STATE_FILE)).ready.is_none(), "{name}");
        }
    }

    #[test]
    fn filename_from_url_strips_query_and_fragment_and_rejects_unsafe_names() {
        let url = "https://github.com/o/r/releases/download/v0.2.0/ALwith.Codex_0.2.0_aarch64.app.tar.gz";
        assert_eq!(filename_from_url(url).as_deref(), Some("ALwith.Codex_0.2.0_aarch64.app.tar.gz"));
        assert_eq!(
            filename_from_url("https://x.com/a/App.app.tar.gz?token=1/2#frag").as_deref(),
            Some("App.app.tar.gz")
        );
        assert_eq!(filename_from_url("https://x.com/a/App.tar.gz#x/y").as_deref(), Some("App.tar.gz"));
        assert_eq!(filename_from_url("https://x.com/path/"), None);
        assert_eq!(filename_from_url("https://x.com/a/..%2F..%2Fescape"), None);
        assert_eq!(filename_from_url("https://x.com/a/.."), None);
        assert_eq!(filename_from_url(""), None);
    }

    #[test]
    fn load_missing_or_corrupt_file_returns_default() {
        let tmp = TempDir::new();
        let path = tmp.path().join(STATE_FILE);
        assert!(load(&path).ready.is_none());
        std::fs::write(&path, "not json").unwrap();
        assert!(load(&path).ready.is_none());
    }

    #[test]
    fn save_then_load_round_trip_and_creates_parent() {
        let tmp = TempDir::new();
        let path = tmp.path().join("nested/dir").join(STATE_FILE);
        let original = PersistedState {
            ready: Some(UpdateInfo {
                version: "0.2.0".into(),
                filename: "x.tar.gz".into(),
                signature: "sig".into(),
                content_length: Some(123),
            }),
            manifest: Some(serde_json::json!({"version": "0.2.0"})),
        };
        save(&path, &original).unwrap();
        let loaded = load(&path);
        assert_eq!(loaded.ready.unwrap().version, "0.2.0");
        assert_eq!(loaded.manifest, original.manifest);
    }

    #[test]
    fn archive_is_written_through_a_part_file_and_rejects_unsafe_names() {
        let tmp = TempDir::new();
        let archive = write_archive(tmp.path(), "x.tar.gz", b"data").unwrap();
        assert_eq!(std::fs::read(&archive).unwrap(), b"data");
        assert!(!tmp.path().join("x.tar.gz.part").exists());
        assert!(write_archive(tmp.path(), "../x", b"data").is_err());
    }

    #[test]
    fn discard_removes_state_archive_and_bundles_and_tolerates_absence() {
        let tmp = TempDir::new();
        std::fs::write(tmp.path().join(STATE_FILE), "{}").unwrap();
        std::fs::write(tmp.path().join("x.tar.gz"), "data").unwrap();
        std::fs::write(tmp.path().join("x.tar.gz.part"), "data").unwrap();
        std::fs::create_dir_all(staged_dir(tmp.path()).join("Contents")).unwrap();
        std::fs::create_dir_all(previous_dir(tmp.path())).unwrap();
        discard(tmp.path(), Some("x.tar.gz")).unwrap();
        for name in [STATE_FILE, "x.tar.gz", "x.tar.gz.part", STAGED_DIR, PREVIOUS_DIR] {
            assert!(!tmp.path().join(name).exists(), "{name}");
        }
        discard(tmp.path(), Some("nonexistent.tar.gz")).unwrap();
    }
}
