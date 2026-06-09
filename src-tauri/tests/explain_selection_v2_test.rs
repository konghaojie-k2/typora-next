//! Integration tests for explain_selection_v2 (Sprint 6 PB1/PB2)
//! Run with: cargo test --test explain_selection_v2_test
//!
//! NOTE: Pure functions are mirrored here because linking app_lib in
//! Windows integration tests causes STATUS_ENTRYPOINT_NOT_FOUND (Tauri
//! native deps). This mirrors the pattern used by review_schedule_test
//! and ai_agent_test.

// ============================================
// Mirrored data types (must stay in sync with ai_agent.rs)
// ============================================

#[derive(Debug, serde::Serialize, serde::Deserialize)]
struct QAItem {
    q: String,
    a: String,
}

#[derive(Debug, serde::Serialize, serde::Deserialize)]
struct ExplainV2Response {
    explanation: String,
    suggested_questions: Vec<String>,
}

// ============================================
// Mirrored pure functions (must stay in sync with ai_agent.rs)
// ============================================

fn build_explain_prompt(text: &str, context: Option<&str>, previous_qa: Option<&[QAItem]>) -> String {
    let mut parts: Vec<String> = Vec::new();

    if let Some(ctx) = context {
        parts.push(format!("当前章节：{}", ctx));
    }

    if let Some(qa_list) = previous_qa {
        parts.push("之前的对话：".to_string());
        for (i, qa) in qa_list.iter().enumerate() {
            parts.push(format!("  Q{}: {}", i + 1, qa.q));
            parts.push(format!("  A{}: {}", i + 1, qa.a));
        }
    }

    parts.push(String::new());
    parts.push("请用学术摘要风格简洁解释以下概念（严格150字以内）：".to_string());
    parts.push("要求：".to_string());
    parts.push("- 直接给出定义 + 核心机制 + 为什么重要".to_string());
    parts.push("- 禁止讲故事、禁止层层递进比喻、禁止冗余修饰".to_string());
    parts.push("- 一句话说完的事不要拆成三段".to_string());
    parts.push(String::new());
    parts.push("同时给出3-4个用户可能想追问的问题（作为JSON数组）。".to_string());
    parts.push(String::new());
    parts.push("返回格式（合法JSON）：".to_string());
    parts.push("{\"explanation\": \"...\", \"suggestedQuestions\": [\"...\", \"...\"]}".to_string());
    parts.push(String::new());

    let truncated = if text.chars().count() > 197 {
        text.chars().take(197).collect::<String>() + "..."
    } else {
        text.to_string()
    };
    parts.push(format!("概念：{}", truncated));

    parts.join("\n")
}

fn parse_explain_response(raw: &str) -> ExplainV2Response {
    // Strip markdown code block wrappers if present
    let cleaned = raw.trim();
    let cleaned = if cleaned.starts_with("```") {
        cleaned.lines()
            .skip(1)
            .take_while(|l| !l.trim_start().starts_with("```"))
            .collect::<Vec<_>>()
            .join("\n")
    } else {
        cleaned.to_string()
    };

    if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&cleaned) {
        let mut explanation = parsed
            .get("explanation")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        if explanation.chars().count() > 200 {
            explanation = explanation.chars().take(197).collect::<String>() + "...";
        }
        let suggested_questions = parsed
            .get("suggestedQuestions")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(String::from))
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        return ExplainV2Response {
            explanation,
            suggested_questions,
        };
    }

    let fallback = vec![
        "这是什么意思？".to_string(),
        "举个例子".to_string(),
        "有什么应用场景？".to_string(),
        "需要注意什么陷阱？".to_string(),
    ];
    ExplainV2Response {
        explanation: raw.to_string(),
        suggested_questions: fallback,
    }
}

// ============================================
// TDD Tests
// ============================================

#[test]
fn test_build_prompt_with_context() {
    let prompt = build_explain_prompt("位置编码", Some("第五章 位置编码"), None);
    assert!(prompt.contains("位置编码"), "prompt 应包含选中文字");
    assert!(prompt.contains("第五章 位置编码"), "prompt 应包含章节上下文");
    assert!(prompt.contains("合法JSON"), "prompt 应要求返回 JSON");
}

#[test]
fn test_build_prompt_with_previous_qa() {
    let qa = vec![
        QAItem {
            q: "位置编码是什么".to_string(),
            a: "给每个 token 加位置向量".to_string(),
        },
    ];
    let prompt = build_explain_prompt("和词嵌入区别？", Some("第五章"), Some(&qa));
    assert!(prompt.contains("之前的对话"), "prompt 应包含 previousQA 标题");
    assert!(prompt.contains("位置编码是什么"), "prompt 应包含 previousQA 的 q");
    assert!(prompt.contains("给每个 token 加位置向量"), "prompt 应包含 previousQA 的 a");
    assert!(prompt.contains("和词嵌入区别？"), "prompt 应包含当前追问");
}

#[test]
fn test_build_prompt_no_context() {
    let prompt = build_explain_prompt("注意力", None, None);
    assert!(prompt.contains("注意力"));
    // Should not panic or fail when context is None
}

#[test]
fn test_truncate_text_over_200() {
    let long = "x".repeat(300);
    let prompt = build_explain_prompt(&long, None, None);
    let concept_line = prompt.lines().last().unwrap();
    assert!(concept_line.len() <= 210, "概念行应截断到 200 字以内 + 前缀");
}

#[test]
fn test_parse_legal_json() {
    let raw = r#"{"explanation": "位置编码给每个 token 加位置向量...", "suggestedQuestions": ["为啥用正弦？", "和词嵌入区别？", "代码示例"]}"#;
    let resp = parse_explain_response(raw);
    assert_eq!(resp.explanation, "位置编码给每个 token 加位置向量...");
    assert_eq!(resp.suggested_questions.len(), 3);
    assert_eq!(resp.suggested_questions[0], "为啥用正弦？");
}

#[test]
fn test_parse_non_json_fallback() {
    let raw = "This is not JSON, just plain text explanation.";
    let resp = parse_explain_response(raw);
    assert_eq!(resp.explanation, "This is not JSON, just plain text explanation.");
    assert_eq!(resp.suggested_questions.len(), 4, "降级后应有 4 个硬编码追问");
}

#[test]
fn test_parse_missing_suggested_questions() {
    let raw = r#"{"explanation": "位置编码给每个 token 加位置向量..."}"#;
    let resp = parse_explain_response(raw);
    assert!(!resp.explanation.is_empty());
    assert!(resp.suggested_questions.is_empty(), "缺 suggestedQuestions 时应为空数组");
}
