//! Integration tests for explain output parsing（2026-08-11 划词对话截断 bug）。
//!
//! 根因：模型写 .explain-result.json 时在字符串值内使用未转义的半角双引号
//! （如 "语义是"且"，不是"或""）→ serde 解析失败 → 旧 lenient fallback
//! 在第一个半角引号处截断 → 用户看到半句话。
//!
//! 修复：explain_parse 模块的 robust fallback 以结构边界（"suggested_questions"
//! 键）而非第一个引号作为 explanation 值的终点，并尽量打捞追问列表。
//!
//! Run with: cargo test --test explain_parse_test

#[path = "../src/explain_parse.rs"]
mod explain_parse;

use explain_parse::parse_explain_output;

/// 真实 bug 样本（2026-08-11 owl-ontology-basics cue-4，pi session 16:41）：
/// 模型写入的文件内容——字符串值内全是未转义半角引号。
const BUG_SAMPLE: &str = r#"{
  "explanation": "可以，但这里藏着一个著名的坑：多个 rdfs:domain 的语义是"且"，不是"或"。接着之前表单校验的比喻说——你给"票价"这个字段贴了两条规则。如果你真要表达"或"的关系，RDFS 表达不了——正确做法是定义一个父类（比如"可售票对象"）作为唯一的 domain。",
  "suggested_questions": [
    "追问1: 假设"票价"同时声明 domain 是"班次"和"旅游产品"，推理机会推断出什么？",
    "追问2: 多个 rdfs:range 的语义是不是也是"且"？",
    "追问3: 想表达"或"关系时，为什么要定义一个涵盖两类的父类作为唯一 domain？"
  ]
}
"#;

#[test]
fn raw_quotes_inside_string_do_not_truncate_explanation() {
    let r = parse_explain_output(BUG_SAMPLE);
    assert!(
        r.explanation.contains("作为唯一的 domain。"),
        "explanation should be complete, got: {}",
        r.explanation
    );
    assert!(r.explanation.starts_with("可以，但这里藏着"));
    // 内部半角引号原样保留（展示层不影响）
    assert!(r.explanation.contains("语义是\"且\""));
}

#[test]
fn raw_quotes_questions_are_salvaged() {
    let r = parse_explain_output(BUG_SAMPLE);
    assert_eq!(r.suggested_questions.len(), 3);
    assert!(r.suggested_questions[0].contains("票价"));
    assert!(r.suggested_questions[2].ends_with('？'));
}

#[test]
fn valid_json_still_parses_normally() {
    let r = parse_explain_output(r#"{"explanation":"段解释","suggested_questions":["q1","q2"]}"#);
    assert_eq!(r.explanation, "段解释");
    assert_eq!(r.suggested_questions.len(), 2);
}

#[test]
fn valid_json_with_escaped_quotes_keeps_them() {
    let r = parse_explain_output(r#"{"explanation":"他说\"你好\"之后","suggested_questions":[]}"#);
    assert_eq!(r.explanation, "他说\"你好\"之后");
}

#[test]
fn code_fence_wrapped_json_still_works() {
    let r = parse_explain_output("```json\n{\n  \"explanation\": \"段解释\",\n  \"suggested_questions\": [\"追问1\"]\n}\n```");
    assert_eq!(r.explanation, "段解释");
    assert_eq!(r.suggested_questions.len(), 1);
}

#[test]
fn truncated_mid_array_keeps_complete_explanation() {
    let r = parse_explain_output(r#"```json { "explanation": "完整的解释文本。", "suggested_questions": ["追问1", "追问2", "追问3: 截"#);
    assert!(r.explanation.contains("完整的解释文本"));
}

#[test]
fn plain_text_returns_raw() {
    let r = parse_explain_output("纯文本回复");
    assert_eq!(r.explanation, "纯文本回复");
    assert!(r.suggested_questions.is_empty());
}

#[test]
fn truncated_before_questions_key_falls_back_to_quote_scan() {
    // suggested_questions 键都没写出来（EOF 在 explanation 值后）→ 旧逻辑兜底
    let r = parse_explain_output(r#"{ "explanation": "这段解释完整。"#);
    assert!(r.explanation.contains("这段解释完整。"));
}

#[test]
fn safety_cap_still_applies_on_valid_json() {
    let long = "字".repeat(1200);
    let input = format!(r#"{{"explanation":"{}","suggested_questions":[]}}"#, long);
    let r = parse_explain_output(&input);
    assert_eq!(r.explanation.chars().count(), 1000);
    assert!(r.explanation.ends_with("..."));
}
