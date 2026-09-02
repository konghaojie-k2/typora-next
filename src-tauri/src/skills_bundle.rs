//! Bundled-skills filesystem helpers (pure std — no tauri deps).
//!
//! Extracted from ai_agent.rs so the copy logic is unit-testable via
//! `#[path]` include (app_lib-linked test exes fail to start on some
//! machines with STATUS_ENTRYPOINT_NOT_FOUND).
//!
//! Run tests with: cargo test --test skills_bundle_test

/// Find the directory containing bundled skills (src-tauri/skills/).
/// Mirrors `get_agent_bridge_path`'s candidate search.
pub fn get_bundled_skills_dir() -> Result<std::path::PathBuf, String> {
    let exe = std::env::current_exe().map_err(|e| format!("current_exe: {}", e))?;
    let exe_dir = exe.parent().ok_or("exe has no parent")?;

    let candidates = [
        exe_dir.join("skills"),
        exe_dir.join("_up_").join("skills"), // Tauri resources (Windows MSI)
        exe_dir.join("resources").join("skills"), // Tauri resources alt layout
        exe_dir.join("..").join("Resources").join("skills"), // macOS .app: Contents/Resources/skills
        exe_dir
            .join("..")
            .join("Resources")
            .join("_up_")
            .join("skills"), // macOS _up_ mapping
        exe_dir.join("..").join("skills"), // target/release/../skills = target/skills
        exe_dir.join("..").join("..").join("skills"), // target/release/../../skills = project-root/skills
        exe_dir.join("..").join("src-tauri").join("skills"), // target/release/ -> target/src-tauri/skills
        exe_dir
            .join("..")
            .join("..")
            .join("src-tauri")
            .join("skills"), // target/release/ -> project-root/src-tauri/skills
        exe_dir
            .join("..")
            .join("..")
            .join("..")
            .join("src-tauri")
            .join("skills"), // worktree root/src-tauri/skills
        exe_dir.join("..").join("..").join("..").join("skills"), // project root/skills (fallback)
    ];

    for c in &candidates {
        if c.exists() && c.is_dir() {
            return Ok(c.clone());
        }
    }

    Err(format!(
        "Bundled skills directory not found. Tried: {:?}",
        candidates
    ))
}

/// Recursively copy a directory tree (files + subdirectories).
/// Needed so skill `references/` subdirs (e.g. chapter-generation's
/// content-format.md) actually reach the project — the previous flat copy
/// silently skipped them, leaving initSession's inline read to fail.
fn copy_dir_recursive(src: &std::path::Path, dst: &std::path::Path) -> Result<(), String> {
    std::fs::create_dir_all(dst)
        .map_err(|e| format!("Failed to create {}: {}", dst.display(), e))?;
    for entry in
        std::fs::read_dir(src).map_err(|e| format!("Failed to read {}: {}", src.display(), e))?
    {
        let entry = entry.map_err(|e| format!("Dir entry error: {}", e))?;
        let path = entry.path();
        let dst_path = dst.join(entry.file_name().to_string_lossy().to_string());
        if path.is_dir() {
            copy_dir_recursive(&path, &dst_path)?;
        } else if path.is_file() {
            std::fs::copy(&path, &dst_path).map_err(|e| {
                format!(
                    "Failed to copy {} -> {}: {}",
                    path.display(),
                    dst_path.display(),
                    e
                )
            })?;
        }
    }
    Ok(())
}

/// Copy bundled skills into a project's `.pi/skills/` so the pi SDK discovers
/// them (pi's native discovery path). Called at project-setup time. Each skill
/// is a subdirectory containing `SKILL.md` — mirrored under `{project}/.pi/skills/`.
/// Legacy projects keep their `.claude/skills/` copies; the bridge also reads
/// skill references from there as a fallback.
pub fn copy_bundled_skills_to_project(project_path: &str) -> Result<(), String> {
    let src_dir = get_bundled_skills_dir()?;
    let dst_dir = std::path::PathBuf::from(project_path)
        .join(".pi")
        .join("skills");

    std::fs::create_dir_all(&dst_dir)
        .map_err(|e| format!("Failed to create {}: {}", dst_dir.display(), e))?;

    // Iterate top-level skill directories
    for entry in std::fs::read_dir(&src_dir)
        .map_err(|e| format!("Failed to read {}: {}", src_dir.display(), e))?
    {
        let entry = entry.map_err(|e| format!("Dir entry error: {}", e))?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let skill_name = match path.file_name().and_then(|n| n.to_str()) {
            Some(n) => n.to_string(),
            None => continue,
        };
        let dst_skill_dir = dst_dir.join(&skill_name);
        // Copy the whole skill tree (SKILL.md + references/ subdir)
        copy_dir_recursive(&path, &dst_skill_dir)?;
    }

    log::info!(
        "[copy_bundled_skills_to_project] copied from {} to {}",
        src_dir.display(),
        dst_dir.display()
    );
    Ok(())
}
