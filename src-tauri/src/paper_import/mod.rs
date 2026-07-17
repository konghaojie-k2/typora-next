//! PDF/URL paper import — convert external papers to Markdown via MinerU.
//!
//! This module keeps the PaperReader renderer untouched; it only adds a
//! "source adapter" that turns PDFs and paper URLs into local `.md` files,
//! then reuses the existing `openPaperFile` flow.

use std::path::PathBuf;
use tauri::Manager;

/// Result returned to the frontend after a successful import.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PaperImportResult {
    pub md_path: String,
    pub md_content: String,
    pub title: Option<String>,
}

/// Snapshot of an in-flight import task.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ImportStatus {
    pub state: String,
    pub message: Option<String>,
    pub percent: Option<u8>,
}

impl ImportStatus {
    pub fn unknown() -> Self {
        Self {
            state: "unknown".to_string(),
            message: None,
            percent: None,
        }
    }
}

pub mod arxiv;
pub mod mineru;
pub mod storage;

/// Build a human-readable error from a minerU-style message.
pub fn user_facing_error(context: &str, detail: Option<&str>) -> String {
    match detail {
        Some(d) if !d.is_empty() => format!("{}: {}", context, d),
        _ => context.to_string(),
    }
}

/// Resolve where imported papers should live.
///
/// Priority:
/// 1. `project_dir/.learning/papers/{yyyy-MM}/`
/// 2. app_local_data_dir/papers/{yyyy-MM}/
pub fn resolve_papers_dir(
    app_handle: &tauri::AppHandle,
    project_dir: Option<&str>,
) -> Result<PathBuf, String> {
    if let Some(dir) = project_dir {
        let path = PathBuf::from(dir).join(".learning").join("papers");
        return Ok(path);
    }

    let base = app_handle
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("Failed to get app local data dir: {}", e))?;
    Ok(base.join("papers"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_user_facing_error_with_detail() {
        assert_eq!(
            user_facing_error("导入失败", Some("网络超时")),
            "导入失败: 网络超时"
        );
    }

    #[test]
    fn test_user_facing_error_without_detail() {
        assert_eq!(user_facing_error("导入失败", None), "导入失败");
    }

    #[test]
    fn test_user_facing_error_empty_detail() {
        assert_eq!(user_facing_error("导入失败", Some("")), "导入失败");
    }
}
