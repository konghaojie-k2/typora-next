//! Integration tests for course planning prompt + response parsing.
//!
//! Pure logic lives in src/plan_prompt.rs — included via `#[path]` because
//! app_lib-linked test exes fail to start on some machines
//! (STATUS_ENTRYPOINT_NOT_FOUND). Do NOT `#[path]`-include ai_agent.rs
//! (references tauri:: and won't compile standalone).
//!
//! Run with: cargo test --test plan_prompt_test

#[path = "../src/plan_prompt.rs"]
mod plan_prompt;

use plan_prompt::{build_plan_prompt, parse_plan_response};

#[test]
fn test_build_plan_prompt_includes_goal_level_hours() {
    let p = build_plan_prompt("学 Rust", "beginner", 3, None);
    assert!(p.contains("学 Rust"), "prompt should include goal");
    assert!(
        p.contains("小白（零基础）"),
        "prompt should translate beginner to label"
    );
    assert!(p.contains("3 小时"), "prompt should include hours");
    assert!(
        p.contains("project_slug"),
        "prompt should describe the output schema"
    );
}

#[test]
fn test_build_plan_prompt_falls_back_to_raw_level_when_unknown() {
    let p = build_plan_prompt("goal", "unknown-level", 1, None);
    // Unknown level should be passed through verbatim
    assert!(p.contains("unknown-level"));
}

#[test]
fn test_build_plan_prompt_requests_course_type() {
    let p = build_plan_prompt("鉴赏巴赫的音乐", "beginner", 4, None);
    assert!(
        p.contains("course_type"),
        "plan prompt should request course_type"
    );
    for t in ["technical", "humanities", "hybrid"] {
        assert!(p.contains(t), "plan prompt should enumerate {t}");
    }
}

#[test]
fn test_build_plan_prompt_enumerates_engineering() {
    let p = build_plan_prompt("学习半导体刻蚀工艺", "intermediate", 5, None);
    assert!(
        p.contains("engineering"),
        "plan prompt should enumerate the engineering course type"
    );
}

// ---------- Sprint 21: learner context injection ----------

#[test]
fn test_learner_context_none_keeps_prompt_unchanged() {
    let p = build_plan_prompt("学 Rust", "beginner", 3, None);
    assert!(!p.contains("学习者历史"), "None → no learner section");
    assert!(!p.contains("衔接规则"));
    // 信息块后紧跟要求清单（无注入段）
    assert!(p.contains("预计投入时间：3 小时\n\n要求："));
}

#[test]
fn test_learner_context_empty_string_treated_as_none() {
    let p = build_plan_prompt("学 Rust", "beginner", 3, Some(""));
    assert!(!p.contains("学习者历史"));
    assert!(p.contains("预计投入时间：3 小时\n\n要求："));
}

#[test]
fn test_learner_context_injected_before_requirements() {
    let ctx = "Rust 入门（technical，已完结）：\n  已掌握：所有权、借用\n  薄弱：生命周期（quiz 2 次评级 struggling）";
    let p = build_plan_prompt("学 Rust 进阶", "intermediate", 4, Some(ctx));

    assert!(p.contains("## 学习者历史（来自已完结课程，仅供参考）"));
    assert!(p.contains("已掌握：所有权、借用"));
    assert!(p.contains("薄弱：生命周期"));
    assert!(p.contains("## 衔接规则"));
    assert!(p.contains("不得作为独立章节"));
    assert!(p.contains("衔接复习"));

    // 位置：学习者历史在要求清单之前
    let history_pos = p.find("学习者历史").unwrap();
    let req_pos = p.find("要求：").unwrap();
    assert!(
        history_pos < req_pos,
        "learner section must precede the requirements list"
    );
}

#[test]
fn test_parse_plan_response_strips_code_block() {
    let raw = "```json\n{\"project_slug\":\"demo\",\"chapters\":[{\"title\":\"A\",\"duration_minutes\":10,\"concepts\":[\"x\"]}],\"total_duration\":10}\n```";
    let v = parse_plan_response(raw).expect("should parse");
    assert_eq!(v["project_slug"], "demo");
    assert_eq!(v["chapters"].as_array().unwrap().len(), 1);
    assert_eq!(v["chapters"][0]["title"], "A");
}

#[test]
fn test_parse_plan_response_normalizes_missing_chapter_fields() {
    let raw = r#"{"chapters":[{"title":""},{"duration_minutes":15,"concepts":["a","b"]}]}"#;
    let v = parse_plan_response(raw).expect("should parse");
    let chapters = v["chapters"].as_array().unwrap();
    // Empty title → fallback
    assert_eq!(chapters[0]["title"], "第 1 章");
    // Missing duration → default 20
    assert_eq!(chapters[0]["duration_minutes"], 20);
    assert_eq!(chapters[1]["duration_minutes"], 15);
    // Missing concepts → empty array
    assert_eq!(chapters[0]["concepts"].as_array().unwrap().len(), 0);
}

#[test]
fn test_parse_plan_response_recomputes_total_duration() {
    let raw = r#"{"chapters":[{"title":"A","duration_minutes":10},{"title":"B","duration_minutes":15}],"total_duration":999}"#;
    let v = parse_plan_response(raw).expect("should parse");
    // Recomputed, not the model's claim
    assert_eq!(v["total_duration"], 25);
}

#[test]
fn test_parse_plan_response_sanitizes_invalid_slug() {
    // Empty slug
    let v = parse_plan_response(r#"{"chapters":[],"project_slug":""}"#).unwrap();
    assert_eq!(v["project_slug"], "learning-project");
    // Slug with uppercase
    let v = parse_plan_response(r#"{"chapters":[],"project_slug":"FooBar"}"#).unwrap();
    assert_eq!(v["project_slug"], "learning-project");
    // Slug too long
    let v = parse_plan_response(&format!(
        r#"{{"chapters":[],"project_slug":"{}"}}"#,
        "a".repeat(60)
    ))
    .unwrap();
    assert_eq!(v["project_slug"], "learning-project");
    // Slug starts with hyphen
    let v = parse_plan_response(r#"{"chapters":[],"project_slug":"-bad"}"#).unwrap();
    assert_eq!(v["project_slug"], "learning-project");
    // Valid slug should be preserved
    let v = parse_plan_response(r#"{"chapters":[],"project_slug":"diffusion-model"}"#).unwrap();
    assert_eq!(v["project_slug"], "diffusion-model");
}

#[test]
fn test_parse_plan_response_preserves_course_type() {
    // Present → survives chapter/total_duration normalization
    let raw = r#"{"project_slug":"demo","course_type":"humanities","chapters":[{"title":"A","duration_minutes":10,"concepts":["x"]}],"total_duration":999}"#;
    let v = parse_plan_response(raw).expect("should parse");
    assert_eq!(v["total_duration"], 10); // normalized
    assert_eq!(
        v["course_type"], "humanities",
        "course_type must survive normalization"
    );
    // Absent → stays absent (legacy plans, skill-side inference fallback)
    let v2 = parse_plan_response(
        r#"{"project_slug":"demo","chapters":[{"title":"A","duration_minutes":10,"concepts":["x"]}]}"#,
    )
    .unwrap();
    assert!(
        v2.get("course_type").is_none(),
        "course_type must not be fabricated"
    );
}

#[test]
fn test_parse_plan_response_rejects_missing_chapters() {
    let raw = r#"{"project_slug":"demo"}"#;
    assert!(
        parse_plan_response(raw).is_err(),
        "should reject without chapters"
    );
}

#[test]
fn test_parse_plan_response_rejects_malformed_json() {
    assert!(parse_plan_response("not json at all").is_err());
    assert!(parse_plan_response("```json\n{invalid}\n```").is_err());
}
