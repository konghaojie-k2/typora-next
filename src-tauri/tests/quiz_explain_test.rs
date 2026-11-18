//! Integration tests for quiz explanation prompt/parse/cache helpers (Sprint 33).
//!
//! Run with: cargo test --test quiz_explain_test

#[path = "../src/quiz_explain.rs"]
mod quiz_explain;

use quiz_explain::{
    build_prompt, cache_document, cache_file_name, parse_explanations, resolve_learning_dir,
};
use serde_json::json;
use std::path::PathBuf;

fn questions() -> Vec<serde_json::Value> {
    vec![
        json!({
            "id": "q1",
            "qtype": "single",
            "question": "以下哪项最准确？",
            "options": [
                {"label": "A", "text": "正确项"},
                {"label": "B", "text": "干扰项"}
            ],
            "correct": "A",
            "weak_concepts": []
        }),
        json!({
            "id": "q2",
            "qtype": "single",
            "question": "第二题？",
            "options": [
                {"label": "A", "text": "甲"},
                {"label": "B", "text": "乙"}
            ],
            "correct": "B",
            "weak_concepts": []
        })
    ]
}

fn records() -> Vec<serde_json::Value> {
    vec![
        json!({"question_id": "q1", "qtype": "single", "user_answer": "B", "is_correct": false}),
        json!({"question_id": "q2", "qtype": "single", "user_answer": null, "is_correct": null}),
    ]
}

// ============================================
// cache_file_name
// ============================================

#[test]
fn cache_file_name_keeps_chapter_identity() {
    assert_eq!(
        cache_file_name("03-mechanics.md"),
        "03-mechanics.md.explanations.json"
    );
    assert_eq!(cache_file_name("/a/b/04.md"), "04.md.explanations.json");
    assert_eq!(cache_file_name("C:\\course\\05.md"), "05.md.explanations.json");
}

#[test]
fn cache_file_name_falls_back_for_empty_input() {
    assert_eq!(cache_file_name(""), "chapter.explanations.json");
}

// ============================================
// build_prompt
// ============================================

#[test]
fn prompt_contains_question_correct_and_user_answers() {
    let prompt = build_prompt(Some("第三章 力学"), &questions(), &records());
    assert!(prompt.contains("第三章 力学"));
    assert!(prompt.contains("q1"));
    assert!(prompt.contains("正确项"));
    assert!(prompt.contains("正确项"));
    assert!(prompt.contains("学生答案：B"));
    assert!(prompt.contains("未作答"));
    assert!(prompt.contains("JSON"));
}

#[test]
fn prompt_skips_records_without_matching_question() {
    let prompt = build_prompt(None, &questions(), &[json!({"question_id": "ghost"})]);
    assert!(!prompt.contains("ghost"));
    assert!(!prompt.contains("以下哪项最准确"), "没有问题记录不应渲染题目");
}

// ============================================
// parse_explanations
// ============================================

#[test]
fn parse_accepts_wrapper_object_with_code_fence() {
    let raw = "```json\n{\"explanations\":[{\"question_id\":\"q1\",\"explanation\":\"因为 A 成立。\"}]}\n```";
    let parsed = parse_explanations(raw, &["q1".to_string(), "q2".to_string()]);
    assert_eq!(parsed.len(), 1);
    assert_eq!(parsed[0].question_id, "q1");
    assert_eq!(parsed[0].explanation, "因为 A 成立。");
}

#[test]
fn parse_accepts_bare_array() {
    let raw = r#"[{"question_id":"q2","explanation":"B 才是对的。"}]"#;
    let parsed = parse_explanations(raw, &["q1".to_string(), "q2".to_string()]);
    assert_eq!(parsed.len(), 1);
    assert_eq!(parsed[0].question_id, "q2");
}

#[test]
fn parse_filters_unknown_ids_and_empty_text() {
    let raw = r#"{"explanations":[
        {"question_id":"q404","explanation":"不该出现"},
        {"question_id":"q1","explanation":"   "},
        {"question_id":"q2","explanation":"有效解析"}
    ]}"#;
    let parsed = parse_explanations(raw, &["q1".to_string(), "q2".to_string()]);
    assert_eq!(parsed.len(), 1, "只保留已知 id 且非空文本");
    assert_eq!(parsed[0].question_id, "q2");
}

#[test]
fn parse_dedupes_same_question_id() {
    let raw = r#"{"explanations":[
        {"question_id":"q1","explanation":"第一条"},
        {"question_id":"q1","explanation":"第二条"}
    ]}"#;
    let parsed = parse_explanations(raw, &["q1".to_string()]);
    assert_eq!(parsed.len(), 1);
    assert_eq!(parsed[0].explanation, "第一条");
}

#[test]
fn parse_returns_empty_for_garbage() {
    assert!(parse_explanations("抱歉，我无法回答。", &["q1".to_string()]).is_empty());
    assert!(parse_explanations("", &["q1".to_string()]).is_empty());
}

// ============================================
// cache_document
// ============================================

#[test]
fn cache_document_has_version_and_entries() {
    let entries = parse_explanations(
        r#"{"explanations":[{"question_id":"q1","explanation":"解析"}]}"#,
        &["q1".to_string()],
    );
    let doc = cache_document("03.md", &entries, "2026-11-18T10:00");
    assert_eq!(doc["version"], "1.0");
    assert_eq!(doc["chapter_file"], "03.md");
    assert_eq!(doc["generated_at"], "2026-11-18T10:00");
    assert_eq!(doc["explanations"][0]["question_id"], "q1");
    assert_eq!(doc["explanations"][0]["explanation"], "解析");
}

// ============================================
// resolve_learning_dir
// ============================================

#[test]
fn resolve_learning_dir_prefers_project_root() {
    let root = std::env::temp_dir().join(format!("quiz-explain-{}", std::process::id()));
    let project = root.join("proj");
    std::fs::create_dir_all(project.join(".learning").join("quizzes")).unwrap();

    let resolved = resolve_learning_dir(&project.display().to_string());
    assert_eq!(resolved, project.join(".learning"));

    std::fs::remove_dir_all(&root).ok();
}

#[test]
fn resolve_learning_dir_falls_back_to_parent() {
    let root = std::env::temp_dir().join(format!("quiz-explain-parent-{}", std::process::id()));
    std::fs::create_dir_all(root.join(".learning")).unwrap();
    let chapters = root.join("chapters");
    std::fs::create_dir_all(&chapters).unwrap();

    let resolved = resolve_learning_dir(&chapters.display().to_string());
    assert_eq!(resolved, root.join(".learning"));

    std::fs::remove_dir_all(&root).ok();
}

#[test]
fn resolve_learning_dir_returns_default_when_missing() {
    let project = PathBuf::from("/nonexistent/quiz-explain-proj");
    let resolved = resolve_learning_dir(&project.display().to_string());
    assert_eq!(resolved, project.join(".learning"));
}
