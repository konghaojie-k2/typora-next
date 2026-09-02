//! Integration tests for the course-roadmap prompt + response parsing (Sprint 22).
//!
//! Pure logic lives in src/roadmap_prompt.rs — included via `#[path]`
//! because app_lib-linked test exes fail to start on some machines.
//!
//! Run with: cargo test --test roadmap_prompt_test

#[path = "../src/roadmap_prompt.rs"]
mod roadmap_prompt;

use roadmap_prompt::{build_roadmap_prompt, parse_roadmap_response};

fn sample_profile() -> serde_json::Value {
    serde_json::json!({
        "version": 1,
        "course_name": "Rust 入门",
        "course_type": "technical",
        "completed_at": 1000,
        "concepts": [
            {"name": "所有权", "status": "mastered"},
            {"name": "生命周期", "status": "struggling"}
        ],
        "weak_points": [
            {"concept": "生命周期", "chapter": "ch1", "detail": "quiz 2 次评级 struggling"}
        ]
    })
}

// ---------- build_roadmap_prompt ----------

#[test]
fn test_prompt_contains_course_and_mastery() {
    let p = build_roadmap_prompt("Rust 入门", Some(&sample_profile()), None, None, &[]);
    assert!(p.contains("Rust 入门"));
    assert!(p.contains("所有权"), "mastered concepts listed");
    assert!(p.contains("生命周期"), "struggling concept listed");
    assert!(p.contains("technical"));
}

#[test]
fn test_prompt_requires_reason_with_evidence() {
    let p = build_roadmap_prompt("X", Some(&sample_profile()), None, None, &[]);
    assert!(
        p.contains("点名依据") || p.contains("具体依据"),
        "prompt must require evidence-based reasons, got: {p}"
    );
}

#[test]
fn test_prompt_includes_learner_context_when_present() {
    let ctx = "巴赫音乐鉴赏（humanities，已完结）：\n  已掌握：赋格结构\n  薄弱：（无）";
    let p = build_roadmap_prompt("X", None, Some(ctx), None, &[]);
    assert!(p.contains("学习者历史"));
    assert!(p.contains("巴赫音乐鉴赏"));

    let p2 = build_roadmap_prompt("X", None, None, None, &[]);
    assert!(!p2.contains("学习者历史"), "absent context → no section");
}

#[test]
fn test_prompt_exclude_goals_constraint() {
    let excluded = vec!["方向A".to_string(), "方向B".to_string()];
    let p = build_roadmap_prompt("X", None, None, None, &excluded);
    assert!(p.contains("方向A"));
    assert!(p.contains("方向B"));
    assert!(
        p.contains("不得") && p.contains("重复"),
        "must forbid repeating excluded goals"
    );
}

#[test]
fn test_prompt_intent_instructions() {
    let p = build_roadmap_prompt("X", None, None, Some("harder"), &[]);
    assert!(
        p.contains("更难") || p.contains("加大难度") || p.contains("更深"),
        "harder intent missing"
    );

    let p = build_roadmap_prompt("X", None, None, Some("gentler"), &[]);
    assert!(
        p.contains("平缓") || p.contains("拆小"),
        "gentler intent missing"
    );

    let p = build_roadmap_prompt("X", None, None, Some("different"), &[]);
    assert!(
        p.contains("不同领域") || p.contains("相邻领域"),
        "different intent missing"
    );

    // Unknown intent ignored, no panic
    let p = build_roadmap_prompt("X", None, None, Some("bogus"), &[]);
    assert!(!p.contains("bogus"));
}

// ---------- parse_roadmap_response ----------

#[test]
fn test_parse_strips_code_block_and_normalizes() {
    let raw = "```json\n{\"directions\":[{\"goal\":\"深入生命周期\",\"reason\":\"因为…\",\"level\":\"advanced\",\"hours\":5}]}\n```";
    let dirs = parse_roadmap_response(raw, &[]).expect("should parse");
    assert_eq!(dirs.len(), 1);
    assert_eq!(dirs[0]["goal"], "深入生命周期");
    assert_eq!(dirs[0]["level"], "advanced");
    assert_eq!(dirs[0]["hours"], 5);
}

#[test]
fn test_parse_defaults_for_missing_fields() {
    let raw = r#"{"directions":[{"goal":"g1","reason":"r"}]}"#;
    let dirs = parse_roadmap_response(raw, &[]).unwrap();
    assert_eq!(dirs[0]["level"], "intermediate");
    assert_eq!(dirs[0]["hours"], 3);
}

#[test]
fn test_parse_filters_invalid_entries() {
    let raw =
        r#"{"directions":[{"goal":"","reason":"empty goal"},{"goal":"ok"},{"reason":"no goal"}]}"#;
    let dirs = parse_roadmap_response(raw, &[]).unwrap();
    assert_eq!(dirs.len(), 1);
    assert_eq!(dirs[0]["goal"], "ok");
}

#[test]
fn test_parse_filters_excluded_goals() {
    let raw = r#"{"directions":[{"goal":"旧方向"},{"goal":"新方向"}]}"#;
    let dirs = parse_roadmap_response(raw, &["旧方向".to_string()]).unwrap();
    assert_eq!(dirs.len(), 1);
    assert_eq!(dirs[0]["goal"], "新方向");
}

#[test]
fn test_parse_caps_at_three() {
    let raw = r#"{"directions":[{"goal":"1"},{"goal":"2"},{"goal":"3"},{"goal":"4"}]}"#;
    let dirs = parse_roadmap_response(raw, &[]).unwrap();
    assert_eq!(dirs.len(), 3);
}

#[test]
fn test_parse_all_filtered_is_error() {
    let raw = r#"{"directions":[{"goal":"旧方向"}]}"#;
    assert!(parse_roadmap_response(raw, &["旧方向".to_string()]).is_err());
}

#[test]
fn test_parse_invalid_json_is_error() {
    assert!(parse_roadmap_response("not json", &[]).is_err());
    assert!(parse_roadmap_response(r#"{"nope":[]}"#, &[]).is_err());
}
