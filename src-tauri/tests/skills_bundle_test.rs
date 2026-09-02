//! Integration tests for bundled-skills copying (recursive fix).
//!
//! 2026-08-22 bug: the flat copy skipped subdirs, so
//! chapter-generation/references/content-format.md never reached projects and
//! initSession's inline read failed silently — the agent only ever saw
//! SKILL.md. The recursive copy fixes it.
//!
//! Pure std logic lives in src/skills_bundle.rs — included via `#[path]`
//! because app_lib-linked test exes fail to start on some machines
//! (STATUS_ENTRYPOINT_NOT_FOUND).
//!
//! Run with: cargo test --test skills_bundle_test

#[path = "../src/skills_bundle.rs"]
mod skills_bundle;

use skills_bundle::copy_bundled_skills_to_project;

#[test]
fn test_copy_bundled_skills_to_project_copies_references() {
    let dst = std::env::temp_dir().join(format!("skills-copy-test-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dst);
    let project_path = dst.to_string_lossy().to_string();
    copy_bundled_skills_to_project(&project_path).expect("copy should succeed");
    let refs = dst
        .join(".pi")
        .join("skills")
        .join("chapter-generation")
        .join("references")
        .join("content-format.md");
    assert!(
        refs.exists(),
        "references/content-format.md must reach the project (flat copy used to skip subdirs)"
    );
    let _ = std::fs::remove_dir_all(&dst);
}

#[test]
fn test_copy_bundled_skills_to_project_copies_top_level_skill_md() {
    let dst = std::env::temp_dir().join(format!("skills-copy-top-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dst);
    let project_path = dst.to_string_lossy().to_string();
    copy_bundled_skills_to_project(&project_path).expect("copy should succeed");
    let skill_md = dst
        .join(".pi")
        .join("skills")
        .join("chapter-generation")
        .join("SKILL.md");
    assert!(
        skill_md.exists(),
        "SKILL.md must still be copied (regression)"
    );
    let _ = std::fs::remove_dir_all(&dst);
}
