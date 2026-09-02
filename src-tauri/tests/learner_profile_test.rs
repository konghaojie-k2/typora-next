//! Integration tests for cross-course learner memory (Sprint 21).
//!
//! Pure logic lives in src/learner_profile.rs — included via `#[path]`
//! because app_lib-linked test exes fail to start on some machines.
//!
//! Run with: cargo test --test learner_profile_test

#[path = "../src/learner_profile.rs"]
mod learner_profile;

use learner_profile::{
    aggregate_learner_context, build_completion_profile, record_course_completion,
};
use std::fs;
use std::path::{Path, PathBuf};

/// Unique temp dir per test case
fn tmp_dir(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "learner_profile_test_{}_{}",
        std::process::id(),
        tag
    ));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir
}

/// Create a fake completed course: .learning/{project,knowledge-graph,quiz-history}.json
/// `prefix` makes concept names unique across courses (dedup tests need this).
fn make_course_prefixed(
    root: &Path,
    name: &str,
    course_type: Option<&str>,
    prefix: &str,
) -> PathBuf {
    let course = root.join(name);
    let learning = course.join(".learning");
    fs::create_dir_all(&learning).unwrap();

    let mut project = serde_json::json!({
        "name": name,
        "course_status": "completed",
        "chapters": [{"title": "第1章", "file": "ch1.md"}]
    });
    if let Some(ct) = course_type {
        project["course_type"] = serde_json::json!(ct);
    }
    fs::write(
        learning.join("project.json"),
        serde_json::to_string_pretty(&project).unwrap(),
    )
    .unwrap();

    fs::write(
        learning.join("knowledge-graph.json"),
        serde_json::to_string_pretty(&serde_json::json!({
            "version": "1.0",
            "nodes": [
                {"id": "c1", "name": format!("{prefix}所有权"), "chapter": "ch1", "node_status": "mastered"},
                {"id": "c2", "name": format!("{prefix}借用"), "chapter": "ch1", "node_status": "mastered"},
                {"id": "c3", "name": format!("{prefix}生命周期"), "chapter": "ch1", "node_status": "struggling"},
                {"id": "c4", "name": format!("{prefix}宏"), "chapter": "ch1", "node_status": "learning"},
                {"id": "c5", "name": format!("{prefix}未开始概念"), "chapter": "ch1", "node_status": "not_started"}
            ],
            "edges": []
        }))
        .unwrap(),
    )
    .unwrap();

    fs::write(
        learning.join("quiz-history.json"),
        serde_json::to_string_pretty(&serde_json::json!({
            "version": "1.0",
            "entries": [
                {"chapter_file": "ch1.md", "timestamp": 100, "score": 40, "rating": "struggling",
                 "weak_concepts": [format!("{prefix}生命周期")]},
                {"chapter_file": "ch1.md", "timestamp": 200, "score": 50, "rating": "struggling",
                 "weak_concepts": [format!("{prefix}生命周期")]},
                {"chapter_file": "ch1.md", "timestamp": 300, "score": 90, "rating": "mastered",
                 "weak_concepts": []}
            ]
        }))
        .unwrap(),
    )
    .unwrap();

    course
}

fn make_course(root: &Path, name: &str, course_type: Option<&str>) -> PathBuf {
    make_course_prefixed(root, name, course_type, "")
}

// ---------- build_completion_profile ----------

#[test]
fn test_profile_collects_mastered_and_struggling_only() {
    let root = tmp_dir("profile_basic");
    let course = make_course(&root, "rust-basic", Some("technical"));

    let profile = build_completion_profile(&course, 1000).expect("profile should build");

    assert_eq!(profile["course_name"], "rust-basic");
    assert_eq!(profile["course_type"], "technical");
    assert_eq!(profile["completed_at"], 1000);

    let concepts = profile["concepts"].as_array().unwrap();
    let names: Vec<&str> = concepts
        .iter()
        .map(|c| c["name"].as_str().unwrap())
        .collect();
    // learning / not_started 概念不进入档案
    assert!(names.contains(&"所有权"));
    assert!(names.contains(&"生命周期"));
    assert!(!names.contains(&"宏"), "learning status should be omitted");
    assert!(!names.contains(&"未开始概念"));

    let lifetime = concepts.iter().find(|c| c["name"] == "生命周期").unwrap();
    assert_eq!(lifetime["status"], "struggling");
}

#[test]
fn test_profile_weak_points_count_struggling_ratings() {
    let root = tmp_dir("profile_weak");
    let course = make_course(&root, "rust-basic", None);

    let profile = build_completion_profile(&course, 1000).unwrap();
    let weak = profile["weak_points"].as_array().unwrap();
    assert_eq!(weak.len(), 1);
    assert_eq!(weak[0]["concept"], "生命周期");
    // 两次 struggling 评级 → detail 含次数
    assert!(
        weak[0]["detail"].as_str().unwrap().contains('2'),
        "detail should mention count, got: {}",
        weak[0]["detail"]
    );
}

#[test]
fn test_profile_missing_graph_returns_minimal() {
    let root = tmp_dir("profile_minimal");
    let course = root.join("bare");
    let learning = course.join(".learning");
    fs::create_dir_all(&learning).unwrap();
    fs::write(
        learning.join("project.json"),
        r#"{"name": "bare", "course_status": "completed", "chapters": []}"#,
    )
    .unwrap();

    let profile = build_completion_profile(&course, 1000).expect("minimal profile");
    assert_eq!(profile["course_name"], "bare");
    assert_eq!(profile["concepts"].as_array().unwrap().len(), 0);
}

#[test]
fn test_profile_missing_project_json_returns_none() {
    let root = tmp_dir("profile_none");
    let course = root.join("empty");
    fs::create_dir_all(&course).unwrap();
    assert!(build_completion_profile(&course, 1000).is_none());
}

// ---------- record_course_completion (profile + index upsert) ----------

#[test]
fn test_record_writes_profile_and_index() {
    let root = tmp_dir("record");
    let course = make_course(&root, "rust-basic", Some("technical"));
    let index = root.join("learning-index.json");

    record_course_completion(&course, &index, 1000).unwrap();

    assert!(course.join(".learning/completion-profile.json").exists());

    let idx: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(&index).unwrap()).unwrap();
    let courses = idx["courses"].as_array().unwrap();
    assert_eq!(courses.len(), 1);
    assert_eq!(courses[0]["course_name"], "rust-basic");
    assert_eq!(courses[0]["completed_at"], 1000);
}

#[test]
fn test_record_upserts_same_course() {
    let root = tmp_dir("record_upsert");
    let course = make_course(&root, "rust-basic", None);
    let index = root.join("learning-index.json");

    record_course_completion(&course, &index, 1000).unwrap();
    record_course_completion(&course, &index, 2000).unwrap();

    let idx: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(&index).unwrap()).unwrap();
    let courses = idx["courses"].as_array().unwrap();
    assert_eq!(courses.len(), 1, "same course must upsert, not duplicate");
    assert_eq!(courses[0]["completed_at"], 2000);
}

// ---------- aggregate_learner_context ----------

#[test]
fn test_aggregate_formats_course_blocks() {
    let root = tmp_dir("aggregate");
    let course = make_course(&root, "rust-basic", Some("technical"));
    let index = root.join("learning-index.json");
    record_course_completion(&course, &index, 1000).unwrap();

    let ctx = aggregate_learner_context(&index).expect("context should exist");
    assert!(ctx.contains("rust-basic"), "should name the course");
    assert!(ctx.contains("technical"));
    assert!(ctx.contains("已掌握"));
    assert!(ctx.contains("所有权"));
    assert!(ctx.contains("薄弱"));
    assert!(ctx.contains("生命周期"));
}

#[test]
fn test_aggregate_missing_index_returns_none() {
    let root = tmp_dir("aggregate_none");
    let index = root.join("nonexistent.json");
    assert!(aggregate_learner_context(&index).is_none());
}

#[test]
fn test_aggregate_corrupt_index_returns_none() {
    let root = tmp_dir("aggregate_corrupt");
    let index = root.join("learning-index.json");
    fs::write(&index, "not json {{{").unwrap();
    assert!(aggregate_learner_context(&index).is_none());
}

#[test]
fn test_aggregate_prunes_moved_course() {
    let root = tmp_dir("aggregate_prune");
    let course = make_course(&root, "rust-basic", None);
    let index = root.join("learning-index.json");
    record_course_completion(&course, &index, 1000).unwrap();

    // 课程目录被移走 → 惰性删除 → 无可用内容
    fs::remove_dir_all(&course).unwrap();
    assert!(aggregate_learner_context(&index).is_none());

    let idx: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(&index).unwrap()).unwrap();
    assert_eq!(
        idx["courses"].as_array().unwrap().len(),
        0,
        "stale entry should be lazily removed from index"
    );
}

#[test]
fn test_aggregate_backfills_missing_profile() {
    let root = tmp_dir("aggregate_backfill");
    let course = make_course(&root, "legacy-course", None);
    let index = root.join("learning-index.json");

    // 手动写索引（模拟存量课程被登记但无档案）
    fs::write(
        &index,
        serde_json::to_string_pretty(&serde_json::json!({
            "version": 1,
            "courses": [{
                "course_path": course.to_string_lossy(),
                "course_name": "legacy-course",
                "completed_at": 500
            }]
        }))
        .unwrap(),
    )
    .unwrap();

    let ctx = aggregate_learner_context(&index).expect("backfill should produce context");
    assert!(ctx.contains("legacy-course"));
    assert!(ctx.contains("所有权"));
    // 档案被补写
    assert!(course.join(".learning/completion-profile.json").exists());
}

#[test]
fn test_aggregate_truncates_to_five_courses() {
    let root = tmp_dir("aggregate_truncate");
    let index = root.join("learning-index.json");
    for i in 0..6 {
        let course = make_course_prefixed(&root, &format!("course-{i}"), None, &format!("课{i}-"));
        record_course_completion(&course, &index, 1000 + i).unwrap();
    }

    let ctx = aggregate_learner_context(&index).unwrap();
    // 最新 5 门（course-5..course-1）在，最老的 course-0 被截断
    assert!(ctx.contains("course-5"));
    assert!(ctx.contains("course-1"));
    assert!(
        !ctx.contains("course-0"),
        "oldest course should be truncated, got: {ctx}"
    );
}

#[test]
fn test_aggregate_dedup_newest_status_wins() {
    let root = tmp_dir("aggregate_dedup");
    let index = root.join("learning-index.json");

    // 老课：生命周期 struggling（make_course 默认）
    let old_course = make_course(&root, "old-course", None);
    record_course_completion(&old_course, &index, 1000).unwrap();

    // 新课：同一概念已 mastered
    let new_course = root.join("new-course");
    let learning = new_course.join(".learning");
    fs::create_dir_all(&learning).unwrap();
    fs::write(
        learning.join("project.json"),
        r#"{"name": "new-course", "course_status": "completed", "chapters": []}"#,
    )
    .unwrap();
    fs::write(
        learning.join("knowledge-graph.json"),
        serde_json::to_string_pretty(&serde_json::json!({
            "version": "1.0",
            "nodes": [{"id": "c3", "name": "生命周期", "chapter": "ch1", "node_status": "mastered"}],
            "edges": []
        }))
        .unwrap(),
    )
    .unwrap();
    record_course_completion(&new_course, &index, 2000).unwrap();

    let ctx = aggregate_learner_context(&index).unwrap();
    // 新课（较新）的 mastered 优先 → 老课的「薄弱：生命周期」被去重
    let old_pos = ctx.find("old-course").unwrap();
    let old_section = &ctx[old_pos..];
    assert!(
        !old_section.contains("生命周期"),
        "older course's weak entry should be deduped by newer mastery, got: {ctx}"
    );
}

#[test]
fn test_aggregate_skips_corrupt_profile() {
    let root = tmp_dir("aggregate_corrupt_profile");
    let good = make_course_prefixed(&root, "good-course", None, "好-");
    let bad = make_course_prefixed(&root, "bad-course", None, "坏-");
    let index = root.join("learning-index.json");
    record_course_completion(&good, &index, 1000).unwrap();
    record_course_completion(&bad, &index, 2000).unwrap();

    // 破坏 bad 的档案
    fs::write(bad.join(".learning/completion-profile.json"), "{{corrupt").unwrap();

    let ctx = aggregate_learner_context(&index).expect("good course still aggregates");
    assert!(ctx.contains("good-course"));
    // bad-course 档案损坏但源数据还在 → backfill 重新生成，仍然可用
    // （若实现选择跳过也可接受，但不得 panic、不得影响 good-course）
}
