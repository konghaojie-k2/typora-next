//! Integration tests for generate_chapter_quiz PB4 extra questions (Sprint 6)
//! Run with: cargo test --test generate_chapter_quiz_pb4_test
//!
//! NOTE: Mirrors build_extra_question pure function from ai_agent.rs.

// ============================================
// Mirrored data types (must stay in sync with ai_agent.rs)
// ============================================

use serde_json::Value;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
struct QuizOption {
    label: String,
    text: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
struct QuizQuestion {
    id: String,
    #[serde(rename = "qtype")]
    qtype: String,
    question: String,
    options: Vec<QuizOption>,
    correct: Value,
    #[serde(default)]
    weak_concepts: Vec<String>,
}

// ============================================
// Mirrored pure function (must stay in sync with ai_agent.rs)
// ============================================

fn build_extra_question(idx: usize, concept: &str, explanation: &str) -> QuizQuestion {
    let summary = if explanation.len() > 100 {
        format!("{}...", &explanation[..100])
    } else {
        explanation.to_string()
    };
    QuizQuestion {
        id: format!("extra_{}", idx + 1),
        qtype: "single".to_string(),
        question: format!(
            "你在本章中询问过「{}」的含义。以下哪项描述最准确？",
            concept
        ),
        options: vec![
            QuizOption {
                label: "A".to_string(),
                text: summary,
            },
            QuizOption {
                label: "B".to_string(),
                text: "这是一种数据压缩算法".to_string(),
            },
            QuizOption {
                label: "C".to_string(),
                text: "这是数据库查询优化技术".to_string(),
            },
            QuizOption {
                label: "D".to_string(),
                text: "这是前端 UI 渲染框架".to_string(),
            },
        ],
        correct: Value::String("A".to_string()),
        weak_concepts: vec![concept.to_string()],
    }
}

// ============================================
// TDD Tests
// ============================================

#[test]
fn test_extra_question_id_format() {
    let q = build_extra_question(0, "位置编码", "给每个 token 加位置向量");
    assert_eq!(q.id, "extra_1");
    let q2 = build_extra_question(1, "注意力", "计算 token 间相关性");
    assert_eq!(q2.id, "extra_2");
}

#[test]
fn test_extra_question_includes_concept() {
    let q = build_extra_question(0, "位置编码", "给每个 token 加位置向量");
    assert!(q.question.contains("位置编码"), "题干应包含 concept");
    assert!(q.question.contains("询问过"), "题干应提示来自用户提问");
}

#[test]
fn test_extra_question_option_a_has_explanation() {
    let q = build_extra_question(0, "位置编码", "给每个 token 加位置向量");
    assert_eq!(q.options[0].label, "A");
    assert_eq!(q.options[0].text, "给每个 token 加位置向量");
}

#[test]
fn test_extra_question_truncates_long_explanation() {
    let long = "x".repeat(200);
    let q = build_extra_question(0, "位置编码", &long);
    assert!(
        q.options[0].text.ends_with("..."),
        "超过 100 字符应截断并加省略号"
    );
    assert!(
        q.options[0].text.len() <= 110,
        "截断后长度应 <= 100 + 3 省略号 + 边际"
    );
}

#[test]
fn test_extra_question_correct_is_a() {
    let q = build_extra_question(0, "位置编码", "给每个 token 加位置向量");
    assert_eq!(q.correct, Value::String("A".to_string()));
}

#[test]
fn test_extra_question_weak_concepts() {
    let q = build_extra_question(0, "位置编码", "给每个 token 加位置向量");
    assert_eq!(q.weak_concepts, vec!["位置编码"]);
}

#[test]
fn test_extra_question_qtype_is_single() {
    let q = build_extra_question(0, "位置编码", "给每个 token 加位置向量");
    assert_eq!(q.qtype, "single");
}

#[test]
fn test_extra_question_has_four_options() {
    let q = build_extra_question(0, "位置编码", "给每个 token 加位置向量");
    assert_eq!(q.options.len(), 4);
    assert_eq!(q.options[1].label, "B");
    assert_eq!(q.options[2].label, "C");
    assert_eq!(q.options[3].label, "D");
}
