use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DisablementReason {
    /// `plugins.updater` lacks endpoints or a public key.
    InvalidConfiguration,
    /// A debug build that did not opt in with `UpdaterOptions::enable_in_debug`.
    DebugBuild,
    /// The application cache directory, which holds downloaded updates, is unavailable.
    CacheUnavailable,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub version: String,
    pub filename: String,
    pub signature: String,
    pub content_length: Option<u64>,
}

impl UpdateInfo {
    /// A release is identified by its version and signature: a replaced artifact gets a new signature.
    pub fn same_release(&self, other: &UpdateInfo) -> bool {
        self.version == other.version && self.signature == other.signature
    }
}

/// The updater state machine (VSCode abstractUpdateService). `AvailableForDownload` is
/// stored but never emitted: a hit is downloaded straight away. `Ready` means the update is
/// verified and staged, so installing it needs no network and no extraction.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum State {
    Uninitialized,
    Disabled {
        reason: DisablementReason,
    },
    Idle,
    CheckingForUpdates,
    AvailableForDownload {
        update: UpdateInfo,
    },
    Downloading {
        update: UpdateInfo,
        #[serde(rename = "downloadedBytes")]
        downloaded_bytes: Option<u64>,
        #[serde(rename = "totalBytes")]
        total_bytes: Option<u64>,
    },
    /// Downloaded and verified; being prepared for an instant install.
    Staging {
        update: UpdateInfo,
    },
    Ready {
        update: UpdateInfo,
    },
    Restarting {
        update: UpdateInfo,
    },
}

impl State {
    pub fn idle() -> Self {
        State::Idle
    }

    pub fn is_ready(&self, update: &UpdateInfo) -> bool {
        matches!(self, State::Ready { update: ready } if ready.same_release(update))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn state_serializes_with_camelcase_type_tag() {
        let json = serde_json::to_string(&State::idle()).unwrap();
        assert!(json.contains("\"type\":\"idle\""));
        let json = serde_json::to_string(&State::Disabled { reason: DisablementReason::DebugBuild }).unwrap();
        assert!(json.contains("\"reason\":\"debugBuild\""));
    }

    #[test]
    fn ready_state_with_update_info_round_trips() {
        let update = UpdateInfo {
            version: "0.2.0".into(),
            filename: "ALwith.Codex.app.tar.gz".into(),
            signature: "sig".into(),
            content_length: Some(123),
        };
        let state = State::Ready { update };
        let json = serde_json::to_string(&state).unwrap();
        let back: State = serde_json::from_str(&json).unwrap();
        assert_eq!(state, back);
        let staging = serde_json::to_string(&State::Staging { update: back_update(&back) }).unwrap();
        assert!(staging.contains("\"type\":\"staging\""));
    }

    fn back_update(state: &State) -> UpdateInfo {
        match state {
            State::Ready { update } => update.clone(),
            _ => unreachable!(),
        }
    }

    #[test]
    fn downloading_serializes_snake_case_fields_as_camelcase() {
        let state = State::Downloading {
            update: UpdateInfo {
                version: "1.1.0".into(),
                filename: "x.tar.gz".into(),
                signature: "signature".into(),
                content_length: Some(1000),
            },
            downloaded_bytes: Some(100),
            total_bytes: Some(1000),
        };
        let json = serde_json::to_string(&state).unwrap();
        assert!(json.contains("\"downloadedBytes\":100"));
        assert!(json.contains("\"totalBytes\":1000"));
    }
}
