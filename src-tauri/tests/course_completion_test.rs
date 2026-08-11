//! Integration tests for course completion state (Sprint 16).
//!
//! 写侧规则：persist_quiz_result 在每章落 completed 后调用
//! mark_course_completed_if_done —— 全部章节完成则在 project.json
//! 顶层落 `course_status = "completed"`（课程级终态）。
//!
//! Run with: cargo test --test course_completion_test

#[path = "../src/course_completion.rs"]
mod course_completion;

use course_completion::mark_course_completed_if_done;
use serde_json::json;

fn project_with(statuses: &[(&str, &str)]) -> serde_json::Value {
    let chapters: Vec<_> = statuses
        .iter()
        .map(|(file, _)| json!({ "file": file, "title": "t" }))
        .collect();
    let mut status_map = serde_json::Map::new();
    for (file, status) in statuses {
        status_map.insert(file.to_string(), json!(status));
    }
    json!({ "name": "P", "chapters": chapters, "chapters_status": status_map })
}

#[test]
fn all_chapters_completed_stamps_course_status() {
    let mut p = project_with(&[("01-a.md", "completed"), ("02-b.md", "completed")]);
    assert!(mark_course_completed_if_done(&mut p));
    assert_eq!(p["course_status"], json!("completed"));
}

#[test]
fn chinese_completed_status_also_counts() {
    let mut p = project_with(&[("01-a.md", "已完成"), ("02-b.md", "已完成")]);
    assert!(mark_course_completed_if_done(&mut p));
    assert_eq!(p["course_status"], json!("completed"));
}

#[test]
fn pending_chapter_means_not_completed() {
    let mut p = project_with(&[("01-a.md", "completed"), ("02-b.md", "ready")]);
    assert!(!mark_course_completed_if_done(&mut p));
    assert!(p.get("course_status").is_none());
}

#[test]
fn chapter_missing_from_status_map_means_not_completed() {
    let mut p = json!({
        "chapters": [{ "file": "01-a.md" }, { "file": "02-b.md" }],
        "chapters_status": { "01-a.md": "completed" }
    });
    assert!(!mark_course_completed_if_done(&mut p));
    assert!(p.get("course_status").is_none());
}

#[test]
fn empty_chapters_means_not_completed() {
    let mut p = json!({ "chapters": [], "chapters_status": {} });
    assert!(!mark_course_completed_if_done(&mut p));
    assert!(p.get("course_status").is_none());
}

#[test]
fn already_stamped_is_idempotent() {
    let mut p = project_with(&[("01-a.md", "completed")]);
    p["course_status"] = json!("completed");
    assert!(mark_course_completed_if_done(&mut p));
    assert_eq!(p["course_status"], json!("completed"));
}

#[test]
fn legacy_chapter_level_status_fallback() {
    // 存量 project.json：章节状态在 chapter.status 上（v1 schema）
    let mut p = json!({
        "chapters": [{ "file": "01-a.md", "status": "已完成" }],
        "chapters_status": {}
    });
    assert!(mark_course_completed_if_done(&mut p));
    assert_eq!(p["course_status"], json!("completed"));
}
