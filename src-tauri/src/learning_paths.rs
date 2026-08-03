//! Filesystem path helpers for learning projects.
//!
//! Pure-std module (no Tauri deps) so integration tests can `#[path]`-include
//! it directly — linking the full `app_lib` pulls in WebView2 and the test
//! exe fails to start in some Windows environments.

/// Sanitize a learning project slug into a safe ASCII directory name segment.
/// - Keep ASCII alphanumeric, dash, underscore
/// - Convert spaces to dashes
/// - Truncate to 60 chars
/// - Empty input → "learning-project"
pub fn sanitize_dir_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_' || *c == ' ')
        .collect();
    let collapsed = cleaned
        .split_whitespace()
        .collect::<Vec<_>>()
        .join("-")
        .to_ascii_lowercase();
    if collapsed.is_empty() {
        return "learning-project".to_string();
    }
    collapsed.chars().take(60).collect()
}

/// Create a dedicated subdirectory for a learning project under `parent_dir`.
/// Returns the absolute path of the created subdirectory.
/// If a directory with the same name already exists, appends a numeric suffix.
/// Missing parents are created recursively: the Windows folder picker can
/// return a path the user typed but never created, and refusing there just
/// strands the user after they already picked a location.
pub fn create_project_subdir_impl(parent_dir: String, slug: String) -> Result<String, String> {
    let parent = std::path::PathBuf::from(&parent_dir);
    if parent.exists() && !parent.is_dir() {
        return Err(format!("不是目录: {}", parent_dir));
    }
    std::fs::create_dir_all(&parent).map_err(|e| format!("创建父目录失败: {}", e))?;

    let base = sanitize_dir_name(&slug);
    let mut candidate = parent.join(&base);
    let mut suffix = 1;
    while candidate.exists() {
        suffix += 1;
        candidate = parent.join(format!("{}-{}", base, suffix));
    }

    std::fs::create_dir_all(&candidate).map_err(|e| format!("创建项目目录失败: {}", e))?;

    Ok(candidate.display().to_string())
}
