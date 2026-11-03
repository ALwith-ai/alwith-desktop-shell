//! The instant install: the verified archive is extracted into a complete staged bundle ahead of
//! time, and the click only swaps it into place by rename on the same volume.

use std::io;
use std::path::Path;

/// Why the staged bundle could not be put in place.
#[derive(Debug)]
pub enum SwapError {
    /// The install location is not writable by this user or lies on another volume; the
    /// plugin's own (privileged) replacement must do it. Nothing was changed.
    NeedsPlugin(io::Error),
    /// The swap failed; the previous bundle was left (or put back) in place.
    Failed(io::Error),
}

impl std::fmt::Display for SwapError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SwapError::NeedsPlugin(error) => write!(f, "install location needs the privileged installer: {error}"),
            SwapError::Failed(error) => {
                write!(f, "cannot move the staged update into place: {error}")
            }
        }
    }
}

fn needs_plugin(error: &io::Error) -> bool {
    matches!(
        error.kind(),
        io::ErrorKind::PermissionDenied | io::ErrorKind::ReadOnlyFilesystem | io::ErrorKind::CrossesDevices
    )
}

fn classify(error: io::Error) -> SwapError {
    if needs_plugin(&error) { SwapError::NeedsPlugin(error) } else { SwapError::Failed(error) }
}

/// Puts `staged` at `target`. The atomic exchange is tried first, so `target` never disappears;
/// where the file system cannot exchange, `target` moves to `backup` and is restored if the
/// second rename fails. The previous bundle ends up in `staged` or `backup`, never deleted here.
pub fn swap_into_place(target: &Path, staged: &Path, backup: &Path) -> Result<(), SwapError> {
    if std::fs::symlink_metadata(staged).is_err() {
        return Err(SwapError::Failed(io::Error::new(io::ErrorKind::NotFound, "the staged update is missing")));
    }
    #[cfg(target_os = "macos")]
    match exchange(target, staged) {
        Ok(()) => return Ok(()),
        Err(error) if needs_plugin(&error) => return Err(SwapError::NeedsPlugin(error)),
        Err(error) => log::info!("cannot exchange the bundles ({error}); moving them instead"),
    }
    replace_bundle(target, staged, backup)
}

/// `renamex_np(RENAME_SWAP)`: APFS exchanges both paths in one step.
#[cfg(target_os = "macos")]
fn exchange(target: &Path, staged: &Path) -> io::Result<()> {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;
    let from = CString::new(staged.as_os_str().as_bytes())?;
    let to = CString::new(target.as_os_str().as_bytes())?;
    // SAFETY: both pointers are valid NUL-terminated strings that outlive the call.
    let result = unsafe { libc::renamex_np(from.as_ptr(), to.as_ptr(), libc::RENAME_SWAP) };
    if result == 0 { Ok(()) } else { Err(io::Error::last_os_error()) }
}

/// Two renames with rollback: the previous bundle is kept in `backup` until the staged one is in
/// place, and moved back when that fails.
pub fn replace_bundle(target: &Path, staged: &Path, backup: &Path) -> Result<(), SwapError> {
    crate::updater::persist::remove_dir_if_exists(backup).map_err(SwapError::Failed)?;
    std::fs::rename(target, backup).map_err(classify)?;
    if let Err(error) = std::fs::rename(staged, target) {
        if let Err(restore) = std::fs::rename(backup, target) {
            log::error!("the previous application stays at {}: {restore}", backup.display());
        }
        return Err(classify(error));
    }
    Ok(())
}

/// Extracts a tauri-bundler `.app.tar.gz` (`Name.app/Contents/...`) into `staged`, which becomes the
/// bundle root. The archive was verified before this; entries leaving the bundle are refused anyway.
#[cfg(target_os = "macos")]
pub fn extract_app_archive(archive: &Path, staged: &Path) -> io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    use std::path::{Component, PathBuf};

    let partial = staged.with_extension("part");
    crate::updater::persist::remove_dir_if_exists(staged)?;
    crate::updater::persist::remove_dir_if_exists(&partial)?;
    std::fs::create_dir_all(&partial)?;
    let result = (|| {
        let file = std::fs::File::open(archive)?;
        let mut tar = tar::Archive::new(flate2::read::GzDecoder::new(io::BufReader::new(file)));
        for entry in tar.entries()? {
            let mut entry = entry?;
            let path = entry.path()?.into_owned();
            let mut relative = PathBuf::new();
            for component in path.components().skip(1) {
                match component {
                    Component::Normal(part) => relative.push(part),
                    Component::CurDir => {}
                    _ => {
                        return Err(io::Error::new(
                            io::ErrorKind::InvalidData,
                            format!("archive entry leaves the bundle: {}", path.display()),
                        ));
                    }
                }
            }
            if relative.as_os_str().is_empty() {
                continue;
            }
            let destination = partial.join(&relative);
            if let Some(parent) = destination.parent() {
                std::fs::create_dir_all(parent)?;
            }
            entry.unpack(&destination)?;
        }
        if !partial.join("Contents").is_dir() {
            return Err(io::Error::new(io::ErrorKind::InvalidData, "the archive holds no application bundle"));
        }
        // The bundle root must be launchable by every user, as an installed app is.
        std::fs::set_permissions(&partial, std::fs::Permissions::from_mode(0o755))?;
        std::fs::rename(&partial, staged)
    })();
    if result.is_err() {
        let _ = crate::updater::persist::remove_dir_if_exists(&partial);
    }
    result
}

/// Tells Launch Services the bundle changed.
pub fn touch(path: &Path) {
    if let Err(error) = std::fs::File::open(path).and_then(|file| file.set_modified(std::time::SystemTime::now())) {
        log::warn!("cannot touch {}: {error}", path.display());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::updater::test_support::TempDir;

    fn bundle(path: &Path, marker: &str) {
        std::fs::create_dir_all(path.join("Contents")).unwrap();
        std::fs::write(path.join("Contents/version"), marker).unwrap();
    }

    fn marker(path: &Path) -> String {
        std::fs::read_to_string(path.join("Contents/version")).unwrap()
    }

    #[test]
    fn swap_puts_the_staged_bundle_in_place_and_keeps_the_previous_one() {
        let tmp = TempDir::new();
        let (target, staged, backup) =
            (tmp.path().join("App.app"), tmp.path().join("staged.app"), tmp.path().join("previous.app"));
        bundle(&target, "old");
        bundle(&staged, "new");
        swap_into_place(&target, &staged, &backup).unwrap();
        assert_eq!(marker(&target), "new");
        let previous = if staged.exists() { &staged } else { &backup };
        assert_eq!(marker(previous), "old");
    }

    #[test]
    fn missing_staged_bundle_changes_nothing() {
        let tmp = TempDir::new();
        let (target, staged, backup) =
            (tmp.path().join("App.app"), tmp.path().join("staged.app"), tmp.path().join("previous.app"));
        bundle(&target, "old");
        assert!(matches!(swap_into_place(&target, &staged, &backup), Err(SwapError::Failed(_))));
        assert_eq!(marker(&target), "old");
    }

    #[test]
    fn failed_second_rename_rolls_the_previous_bundle_back() {
        let tmp = TempDir::new();
        let (target, backup) = (tmp.path().join("App.app"), tmp.path().join("previous.app"));
        bundle(&target, "old");
        // The staged bundle vanished after the swap was decided: the second rename fails.
        let staged = tmp.path().join("gone.app");
        assert!(matches!(replace_bundle(&target, &staged, &backup), Err(SwapError::Failed(_))));
        assert_eq!(marker(&target), "old");
        assert!(!backup.exists());
    }

    #[test]
    fn replace_bundle_moves_staged_into_place_with_a_backup() {
        let tmp = TempDir::new();
        let (target, staged, backup) =
            (tmp.path().join("App.app"), tmp.path().join("staged.app"), tmp.path().join("previous.app"));
        bundle(&target, "old");
        bundle(&staged, "new");
        bundle(&backup, "stale");
        replace_bundle(&target, &staged, &backup).unwrap();
        assert_eq!(marker(&target), "new");
        assert_eq!(marker(&backup), "old");
    }

    #[cfg(unix)]
    #[test]
    fn unwritable_install_location_needs_the_plugin_and_changes_nothing() {
        use std::os::unix::fs::PermissionsExt;
        let tmp = TempDir::new();
        let locked = tmp.path().join("Applications");
        let (target, staged, backup) =
            (locked.join("App.app"), tmp.path().join("staged.app"), tmp.path().join("previous.app"));
        bundle(&target, "old");
        bundle(&staged, "new");
        std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o555)).unwrap();
        let result = swap_into_place(&target, &staged, &backup);
        std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o755)).unwrap();
        if nix_is_root() {
            return;
        }
        assert!(matches!(result, Err(SwapError::NeedsPlugin(_))), "{result:?}");
        assert_eq!(marker(&target), "old");
        assert_eq!(marker(&staged), "new");
    }

    #[cfg(unix)]
    fn nix_is_root() -> bool {
        std::process::Command::new("id").arg("-u").output().is_ok_and(|out| out.stdout.starts_with(b"0\n"))
    }

    #[cfg(target_os = "macos")]
    fn archive(entries: &[(&str, &[u8])]) -> Vec<u8> {
        let mut builder = tar::Builder::new(flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::fast()));
        for (path, data) in entries {
            let mut header = tar::Header::new_gnu();
            header.set_size(data.len() as u64);
            header.set_mode(0o755);
            header.set_cksum();
            builder.append_data(&mut header, path, *data).unwrap();
        }
        builder.into_inner().unwrap().finish().unwrap()
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn extraction_builds_a_complete_staged_bundle() {
        use std::os::unix::fs::PermissionsExt;
        let tmp = TempDir::new();
        let path = tmp.path().join("App.app.tar.gz");
        std::fs::write(
            &path,
            archive(&[("App.app/Contents/Info.plist", b"plist"), ("App.app/Contents/MacOS/app", b"binary")]),
        )
        .unwrap();
        let staged = tmp.path().join("staged.app");
        bundle(&staged, "stale");
        extract_app_archive(&path, &staged).unwrap();
        assert_eq!(std::fs::read(staged.join("Contents/MacOS/app")).unwrap(), b"binary");
        assert!(!staged.join("Contents/version").exists());
        assert_eq!(std::fs::metadata(&staged).unwrap().permissions().mode() & 0o777, 0o755);
        assert!(!tmp.path().join("staged.part").exists());
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn extraction_refuses_archives_without_a_bundle() {
        let tmp = TempDir::new();
        let path = tmp.path().join("bad.tar.gz");
        std::fs::write(&path, archive(&[("App.app/readme", b"x")])).unwrap();
        let staged = tmp.path().join("staged.app");
        assert!(extract_app_archive(&path, &staged).is_err());
        assert!(!staged.exists());
        assert!(!tmp.path().join("staged.part").exists());
        std::fs::write(&path, b"not an archive").unwrap();
        assert!(extract_app_archive(&path, &staged).is_err());
    }
}
