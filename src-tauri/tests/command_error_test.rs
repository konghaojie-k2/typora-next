//! Command Error Path Tests
//! Covers: outline validation, ai_provider string fragility, input truncation,
//!         quiz answer record shape, read_quiz_history empty path.
//!
//! Lesson from Sprint 3: parameter mismatches and untyped JSON boundaries
//! caused runtime failures that only surfaced during manual integration.

use serde::{Deserialize, Serialize};
use serde_json::json;

// ============================================
// Copied types from src/lib.rs — KEEP IN SYNC
// ============================================

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum AiProvider {
    Anthropic,
    Openai,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct QuizAnswerRecord {
    pub question_id: String,
    pub qtype: String,
    pub user_answer: Option<serde_json::Value>,
    pub is_correct: Option<bool>,
}

// ============================================
// Copied validation logic from src/lib.rs
// ============================================

fn validate_outline_chapters(outline: &serde_json::Value) -> Result<&Vec<serde_json::Value>, String> {
    outline["chapters"]
        .as_array()
        .ok_or_else(|| "outline.chapters must be an array".to_string())
}

fn build_ai_provider_string(provider: Option<&AiProvider>) -> String {
    provider
        .map(|p| format!("{:?}", p).to_lowercase())
        .unwrap_or_else(|| "anthropic".to_string())
}

fn truncate_text_for_explain(text: &str) -> String {
    if text.len() > 200 {
        text.chars().take(200).collect()
    } else {
        text.to_string()
    }
}

fn read_quiz_history_sync(project_path: &str) -> Result<serde_json::Value, String> {
    let path = std::path::PathBuf::from(project_path).join(".learning").join("quiz-history.json");
    if !path.exists() {
        return Ok(json!({ "version": "1.0", "entries": [] }));
    }
    let content = std::fs::read_to_string(&path)
        .map_err(|e| format!("读取 quiz-history.json 失败: {}", e))?;
    let value: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| format!("解析 quiz-history.json 失败: {}", e))?;
    Ok(value)
}

fn create_learning_project_sync(
    project_path: &str,
    outline: &serde_json::Value,
    goal: Option<&str>,
) -> Result<String, String> {
    let path = std::path::PathBuf::from(project_path);
    let learning_dir = path.join(".learning");
    let json_path = learning_dir.join("project.json");

    if json_path.exists() {
        return Ok(json_path.to_string_lossy().to_string());
    }

    std::fs::create_dir_all(&learning_dir)
        .map_err(|e| format!("Failed to create .learning directory: {}", e))?;

    let chapters = validate_outline_chapters(outline)?;

    let project = json!({
        "name": goal.unwrap_or_else(|| {
            chapters.first()
                .and_then(|c| c["title"].as_str())
                .unwrap_or("Learning Project")
        }),
        "created": std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0),
        "chapters": chapters.iter().enumerate().map(|(i, ch)| {
            json!({
                "title": ch["title"].as_str().unwrap_or(&format!("第 {} 章", i + 1)),
                "duration_minutes": ch["duration_minutes"].as_u64().unwrap_or(0),
                "concepts": ch["concepts"].as_array().map(|arr| {
                    arr.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect::<Vec<_>>()
                }).unwrap_or_default(),
                "status": "not_generated",
                "file": null
            })
        }).collect::<Vec<_>>(),
        "total_duration": outline["total_duration"].as_u64().unwrap_or_else(|| {
            chapters.iter().map(|c| c["duration_minutes"].as_u64().unwrap_or(0)).sum()
        })
    });

    let json_str = serde_json::to_string_pretty(&project)
        .map_err(|e| format!("Failed to serialize project: {}", e))?;
    std::fs::write(&json_path, json_str)
        .map_err(|e| format!("Failed to write project.json: {}", e))?;

    Ok(json_path.to_string_lossy().to_string())
}

// ============================================
// Tests
// ============================================

#[test]
fn test_ai_provider_debug_format_is_stable() {
    // Sprint 3 finding: ai_agent.rs used format!("{:?}", p).to_lowercase()
    // to build the provider string. If the enum is renamed, this breaks.
    assert_eq!(build_ai_provider_string(Some(&AiProvider::Anthropic)), "anthropic");
    assert_eq!(build_ai_provider_string(Some(&AiProvider::Openai)), "openai");
    assert_eq!(build_ai_provider_string(None), "anthropic");
}

#[test]
fn test_explain_text_truncation_at_200_chars() {
    let short = "short text";
    assert_eq!(truncate_text_for_explain(short), short);

    let exact_200 = "a".repeat(200);
    assert_eq!(truncate_text_for_explain(&exact_200).len(), 200);

    let long = "中".repeat(150); // 3 bytes each = 450 bytes, but 150 chars
    let truncated = truncate_text_for_explain(&long);
    assert_eq!(truncated.chars().count(), 150); // under char limit, not truncated

    let very_long = "x".repeat(500);
    let truncated = truncate_text_for_explain(&very_long);
    assert_eq!(truncated.chars().count(), 200);
    assert_eq!(truncated.len(), 200);
}

#[test]
fn test_create_learning_project_rejects_missing_chapters() {
    let tmp = std::env::temp_dir().join("typora_test_no_chapters");
    let _ = std::fs::remove_dir_all(&tmp);

    let outline = json!({ "total_duration": 60 });
    let result = create_learning_project_sync(tmp.to_str().unwrap(), &outline, None);

    assert!(result.is_err());
    assert!(result.unwrap_err().contains("chapters must be an array"));
}

#[test]
fn test_create_learning_project_rejects_non_array_chapters() {
    let tmp = std::env::temp_dir().join("typora_test_bad_chapters");
    let _ = std::fs::remove_dir_all(&tmp);

    let outline = json!({ "chapters": "not an array" });
    let result = create_learning_project_sync(tmp.to_str().unwrap(), &outline, None);

    assert!(result.is_err());
    assert!(result.unwrap_err().contains("chapters must be an array"));
}

#[test]
fn test_create_learning_project_creates_valid_project_json() {
    let tmp = std::env::temp_dir().join("typora_test_valid");
    let _ = std::fs::remove_dir_all(&tmp);

    let outline = json!({
        "chapters": [
            { "title": "Ch1", "duration_minutes": 25, "concepts": ["c1"] },
            { "title": "Ch2", "duration_minutes": 35 }
        ],
        "total_duration": 60
    });

    let result = create_learning_project_sync(tmp.to_str().unwrap(), &outline, Some("My Goal"));
    assert!(result.is_ok());

    let project_path = tmp.join(".learning").join("project.json");
    let content = std::fs::read_to_string(&project_path).unwrap();
    let project: serde_json::Value = serde_json::from_str(&content).unwrap();

    assert_eq!(project["name"], "My Goal");
    assert_eq!(project["chapters"].as_array().unwrap().len(), 2);
    assert_eq!(project["chapters"][0]["title"], "Ch1");
    assert_eq!(project["chapters"][0]["duration_minutes"], 25);
    assert_eq!(project["total_duration"], 60);
    assert_eq!(project["chapters"][0]["status"], "not_generated");

    // Cleanup
    let _ = std::fs::remove_dir_all(&tmp);
}

#[test]
fn test_create_learning_project_does_not_overwrite_existing() {
    let tmp = std::env::temp_dir().join("typora_test_no_overwrite");
    let _ = std::fs::remove_dir_all(&tmp);
    std::fs::create_dir_all(&tmp.join(".learning")).unwrap();
    std::fs::write(&tmp.join(".learning").join("project.json"), "{}")
        .unwrap();

    let outline = json!({ "chapters": [] });
    let result = create_learning_project_sync(tmp.to_str().unwrap(), &outline, None);

    assert!(result.is_ok());
    // Should return the existing path without error
    assert!(result.unwrap().ends_with("project.json"));

    let _ = std::fs::remove_dir_all(&tmp);
}

#[test]
fn test_read_quiz_history_returns_empty_for_missing_path() {
    let tmp = std::env::temp_dir().join("typora_test_no_history");
    let _ = std::fs::remove_dir_all(&tmp);

    let result = read_quiz_history_sync(tmp.to_str().unwrap());
    assert!(result.is_ok());

    let history = result.unwrap();
    assert_eq!(history["version"], "1.0");
    assert!(history["entries"].as_array().unwrap().is_empty());
}

#[test]
fn test_read_quiz_history_reads_existing_file() {
    let tmp = std::env::temp_dir().join("typora_test_with_history");
    let _ = std::fs::remove_dir_all(&tmp);
    std::fs::create_dir_all(&tmp.join(".learning")).unwrap();

    let data = json!({
        "version": "1.0",
        "entries": [{"chapter_file": "01.md", "score": 0.8}]
    });
    std::fs::write(
        &tmp.join(".learning").join("quiz-history.json"),
        serde_json::to_string_pretty(&data).unwrap(),
    )
    .unwrap();

    let result = read_quiz_history_sync(tmp.to_str().unwrap());
    assert!(result.is_ok());

    let history = result.unwrap();
    assert_eq!(history["entries"].as_array().unwrap().len(), 1);
    assert_eq!(history["entries"][0]["score"], 0.8);

    let _ = std::fs::remove_dir_all(&tmp);
}

#[test]
fn test_quiz_answer_record_accepts_various_user_answer_types() {
    // Sprint 3 finding: QuizAnswerRecord.user_answer is Option<Value>,
    // accepting any JSON. JS sends strings, arrays, or null.
    let r1 = QuizAnswerRecord {
        question_id: "q1".into(),
        qtype: "single".into(),
        user_answer: Some(json!("A")),
        is_correct: Some(true),
    };
    let r2 = QuizAnswerRecord {
        question_id: "q2".into(),
        qtype: "multiple".into(),
        user_answer: Some(json!(["A", "B"])),
        is_correct: Some(true),
    };
    let r3 = QuizAnswerRecord {
        question_id: "q3".into(),
        qtype: "short".into(),
        user_answer: Some(json!("open answer")),
        is_correct: None,
    };
    let r4 = QuizAnswerRecord {
        question_id: "q4".into(),
        qtype: "single".into(),
        user_answer: None,
        is_correct: None,
    };

    let serialized = serde_json::to_string(&vec![&r1, &r2, &r3, &r4]).unwrap();
    assert!(serialized.contains("\"user_answer\":\"A\""));
    assert!(serialized.contains("\"user_answer\":[\"A\",\"B\"]"));
    assert!(serialized.contains("\"user_answer\":\"open answer\""));
    assert!(serialized.contains("\"user_answer\":null"));
}
