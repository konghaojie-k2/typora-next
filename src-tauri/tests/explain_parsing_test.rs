use app_lib::ai_agent::{parse_explain_response, ExplainV2Response};

// ============================================
// ExplainV2Response serde parsing (agent-bridge path)
// ============================================

#[test]
fn test_explain_v2_serde_valid() {
    let json = r#"{"explanation":"test expl","suggested_questions":["q1","q2"]}"#;
    let result: ExplainV2Response = serde_json::from_str(json).unwrap();
    assert_eq!(result.explanation, "test expl");
    assert_eq!(result.suggested_questions.len(), 2);
}

#[test]
fn test_explain_v2_serde_empty_questions() {
    let json = r#"{"explanation":"only expl","suggested_questions":[]}"#;
    let result: ExplainV2Response = serde_json::from_str(json).unwrap();
    assert_eq!(result.explanation, "only expl");
    assert_eq!(result.suggested_questions.len(), 0);
}

// ============================================
// parse_explain_response (ureq path, code block handling)
// ============================================

#[test]
fn test_parse_explain_response_multiline() {
    let input = "```json\n{\n  \"explanation\": \"段解释\",\n  \"suggested_questions\": [\"追问1\"]\n}\n```";
    let result = parse_explain_response(input);
    assert_eq!(result.explanation, "段解释");
    assert_eq!(result.suggested_questions.len(), 1);
}

#[test]
fn test_parse_explain_response_single_line() {
    let input = r#"```json { "explanation": "单行解释", "suggested_questions": ["追问1"] } ```"#;
    let result = parse_explain_response(input);
    assert_eq!(result.explanation, "单行解释");
    assert_eq!(result.suggested_questions.len(), 1);
}

#[test]
fn test_parse_explain_response_truncated() {
    let input = r#"```json { "explanation": "完整的解释文本。", "suggested_questions": ["追问1", "追问2", "追问3: 截"#;
    let result = parse_explain_response(input);
    assert!(result.explanation.contains("完整的解释文本"));
}

#[test]
fn test_parse_explain_response_plain_json() {
    let input = r#"{"explanation": "无代码块", "suggested_questions": ["Q1"]}"#;
    let result = parse_explain_response(input);
    assert_eq!(result.explanation, "无代码块");
    assert_eq!(result.suggested_questions.len(), 1);
}

#[test]
fn test_parse_explain_response_no_json() {
    let input = "纯文本回复";
    let result = parse_explain_response(input);
    assert_eq!(result.explanation, "纯文本回复");
    assert_eq!(result.suggested_questions.len(), 0);
}
