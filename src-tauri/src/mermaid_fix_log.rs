//! Call logging for fix_mermaid (pure-ish: serde_json + std::fs only).
//!
//! Integration tests `#[path]`-include this file directly — see
//! tests/share_images_test.rs for why (app_lib links WebView2).
//!
//! fix_mermaid calls the LLM via ureq directly (no Agent SDK), so the
//! agent-bridge log pipeline never sees it. Without these JSON-lines
//! entries there is NO way to answer "why did the fix take so long" —
//! every call (success or failure) appends one line to
//! `<app_log_dir>/mermaid-fix.log`.

use std::io::Write;
use std::path::{Path, PathBuf};

/// Log file location inside the app log dir.
pub fn log_path(log_dir: &Path) -> PathBuf {
    log_dir.join("mermaid-fix.log")
}

/// Format one JSON-lines log entry.
/// `error` is None on success.
pub fn format_entry(
    ts: &str,
    provider: &str,
    model: &str,
    duration_ms: u128,
    error: Option<&str>,
) -> String {
    serde_json::json!({
        "ts": ts,
        "provider": provider,
        "model": model,
        "duration_ms": duration_ms as u64,
        "ok": error.is_none(),
        "error": error,
    })
    .to_string()
}

/// Append one entry line to the log file (creates dir/file as needed).
pub fn append_entry(log_dir: &Path, line: &str) -> std::io::Result<()> {
    std::fs::create_dir_all(log_dir)?;
    let path = log_path(log_dir);
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)?;
    writeln!(file, "{}", line)
}
