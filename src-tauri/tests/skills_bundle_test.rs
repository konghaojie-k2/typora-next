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

/// Sprint 26: wikimedia-commons skill 的 scripts/wiki-fetch.mjs 必须随递归拷贝
/// 进项目（agent 执行的是项目内副本），且整个 skill 目录一并就位。
#[test]
fn test_copy_bundled_skills_copies_wiki_fetch_script() {
    let dst = std::env::temp_dir().join(format!("skills-copy-wiki-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dst);
    let project_path = dst.to_string_lossy().to_string();
    copy_bundled_skills_to_project(&project_path).expect("copy should succeed");
    let base = dst.join(".pi").join("skills").join("wikimedia-commons");
    assert!(base.join("SKILL.md").exists(), "wikimedia-commons SKILL.md");
    assert!(
        base.join("scripts").join("wiki-fetch.mjs").exists(),
        "scripts/wiki-fetch.mjs must reach the project"
    );
    let _ = std::fs::remove_dir_all(&dst);
}

/// AI 伴学「画个图」：typora-course-visualize skill 必须随拷贝进项目
/// （visualize stage 的 prompt 按名引用，缺拷贝则 agent 找不到 skill）。
#[test]
fn test_copy_bundled_skills_copies_visualize_skill() {
    let dst = std::env::temp_dir().join(format!("skills-copy-visualize-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dst);
    let project_path = dst.to_string_lossy().to_string();
    copy_bundled_skills_to_project(&project_path).expect("copy should succeed");
    let skill_md = dst
        .join(".pi")
        .join("skills")
        .join("typora-course-visualize")
        .join("SKILL.md");
    assert!(skill_md.exists(), "typora-course-visualize SKILL.md must reach the project");
    let _ = std::fs::remove_dir_all(&dst);
}
