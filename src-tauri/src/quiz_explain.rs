//! 小测逐题解析（Route B）的纯函数模块。
//!
//! 解析在提交后按需生成并缓存到 `.learning/quizzes/{chapter}.explanations.json`，
//! 不修改 quiz.json schema —— 存量项目无需重新出题即可使用。
//!
//! 纯 std + serde_json，可用 `#[path]` include 测试（不 link app_lib）。

use serde_json::{json, Value};
use std::path::PathBuf;

#[derive(Debug, Clone, PartialEq)]
pub struct QuizExplanation {
    pub question_id: String,
    pub explanation: String,
}

/// 章节文件名 → 解析缓存文件名。保留原扩展名，避免同名不同章节冲突。
pub fn cache_file_name(chapter_file: &str) -> String {
    let normalized = chapter_file.replace('\\', "/");
    let base = normalized.rsplit('/').next().unwrap_or("").trim();
    if base.is_empty() {
        "chapter.explanations.json".to_string()
    } else {
        format!("{}.explanations.json", base)
    }
}

/// 解析 .learning 目录：优先项目根目录，其次父目录（兼容 baseDir 为 chapters/ 的场景）。
/// 两者都不存在时返回项目根目录下的默认路径（由调用方创建）。
pub fn resolve_learning_dir(project_path: &str) -> PathBuf {
    let project = PathBuf::from(project_path);
    let direct = project.join(".learning");
    if direct.is_dir() {
        return direct;
    }
    if let Some(parent) = project.parent() {
        let sibling = parent.join(".learning");
        if sibling.is_dir() {
            return sibling;
        }
    }
    direct
}

fn correct_labels(question: &Value) -> Vec<String> {
    match question.get("correct") {
        Some(Value::String(s)) if !s.is_empty() => vec![s.clone()],
        Some(Value::Array(arr)) => arr
            .iter()
            .filter_map(|v| v.as_str().map(String::from))
            .collect(),
        _ => Vec::new(),
    }
}

fn option_text<'a>(question: &'a Value, label: &str) -> Option<&'a str> {
    question
        .get("options")
        .and_then(|v| v.as_array())
        .and_then(|options| {
            options
                .iter()
                .find(|o| o.get("label").and_then(|v| v.as_str()) == Some(label))
                .and_then(|o| o.get("text").and_then(|v| v.as_str()))
        })
}

fn options_line(question: &Value) -> String {
    question
        .get("options")
        .and_then(|v| v.as_array())
        .map(|options| {
            options
                .iter()
                .filter_map(|o| {
                    let label = o.get("label").and_then(|v| v.as_str())?;
                    let text = o.get("text").and_then(|v| v.as_str()).unwrap_or("");
                    Some(format!("{}) {}", label, text))
                })
                .collect::<Vec<_>>()
                .join(" ｜ ")
        })
        .unwrap_or_default()
}

fn correct_line(question: &Value) -> String {
    let labels = correct_labels(question);
    if labels.is_empty() {
        return "（无固定答案）".to_string();
    }
    labels
        .iter()
        .map(|label| match option_text(question, label) {
            Some(text) => format!("{}) {}", label, text),
            None => label.clone(),
        })
        .collect::<Vec<_>>()
        .join(" / ")
}

fn user_answer_line(record: &Value, question: &Value) -> String {
    let answer = match record.get("user_answer") {
        None | Some(Value::Null) => return "未作答".to_string(),
        Some(Value::Array(arr)) => {
            let labels: Vec<String> = arr
                .iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect();
            if labels.is_empty() {
                return "未作答".to_string();
            }
            labels
                .iter()
                .map(|label| match option_text(question, label) {
                    Some(text) => format!("{}) {}", label, text),
                    None => label.clone(),
                })
                .collect::<Vec<_>>()
                .join(", ")
        }
        Some(Value::String(s)) => {
            if s.trim().is_empty() {
                return "未作答".to_string();
            }
            match option_text(question, s) {
                Some(text) => format!("{}) {}", s, text),
                None => s.clone(),
            }
        }
        Some(other) => other.to_string(),
    };
    answer
}

/// 构建逐题解析提示词。只包含「有记录且有题目」的题，避免让模型猜不存在的题。
pub fn build_prompt(
    chapter_title: Option<&str>,
    questions: &[Value],
    records: &[Value],
) -> String {
    let mut blocks: Vec<String> = Vec::new();
    for record in records {
        let Some(id) = record.get("question_id").and_then(|v| v.as_str()) else {
            continue;
        };
        let Some(question) = questions
            .iter()
            .find(|q| q.get("id").and_then(|v| v.as_str()) == Some(id))
        else {
            continue;
        };
        let question_text = question
            .get("question")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let qtype = question
            .get("qtype")
            .and_then(|v| v.as_str())
            .unwrap_or("single");
        blocks.push(format!(
            "题目 {}（id: {}，题型: {}）\n题干：{}\n选项：{}\n正确答案：{}\n学生答案：{}",
            blocks.len() + 1,
            id,
            qtype,
            question_text,
            options_line(question),
            correct_line(question),
            user_answer_line(record, question)
        ));
    }

    let mut parts: Vec<String> = Vec::new();
    if let Some(title) = chapter_title.filter(|t| !t.trim().is_empty()) {
        parts.push(format!("当前章节：{}", title));
    }
    parts.push("请为下面每道已作答的小测题写一段解析。".to_string());
    parts.push(blocks.join("\n\n"));
    parts.push(
        "要求：\n\
         - 解析用 Markdown，120-220 字，直接讲清机理/推导，不要复述题干\n\
         - 说明正确答案为什么成立；其他选项错在哪里（如有必要）\n\
         - 学生答错时点出误解；未作答时给出解题切入点\n\
         - 不要寒暄，不要输出题目之外的内容"
            .to_string(),
    );
    parts.push(
        "返回严格 JSON（不要代码块）：\n\
         {\"explanations\": [{\"question_id\": \"q1\", \"explanation\": \"...\"}]}"
            .to_string(),
    );
    parts.join("\n\n")
}

fn strip_code_fence(raw: &str) -> &str {
    let trimmed = raw.trim();
    if !trimmed.starts_with("```") {
        return trimmed;
    }
    let after_fence = match trimmed.find('\n') {
        Some(idx) => &trimmed[idx + 1..],
        None => return "",
    };
    let body = after_fence.trim();
    if body.ends_with("```") {
        &body[..body.len() - 3]
    } else {
        body
    }
}

/// 从自由文本里截取第一段 JSON（对象或数组）。
fn extract_json_slice(text: &str) -> Option<&str> {
    let open_obj = text.find('{');
    let open_arr = text.find('[');
    let start = match (open_obj, open_arr) {
        (Some(o), Some(a)) => o.min(a),
        (Some(o), None) => o,
        (None, Some(a)) => a,
        (None, None) => return None,
    };
    let is_object = text[start..].starts_with('{');
    let end = if is_object {
        text.rfind('}')
    } else {
        text.rfind(']')
    }?;
    if end <= start {
        return None;
    }
    Some(&text[start..=end])
}

/// 解析模型输出，只保留 allowed_ids 内、非空且去重后的条目。
pub fn parse_explanations(raw: &str, allowed_ids: &[String]) -> Vec<QuizExplanation> {
    let cleaned = strip_code_fence(raw);
    let Some(slice) = extract_json_slice(cleaned) else {
        return Vec::new();
    };
    let Ok(value) = serde_json::from_str::<Value>(slice) else {
        return Vec::new();
    };

    let entries = if value.is_array() {
        value.as_array().cloned().unwrap_or_default()
    } else {
        value
            .get("explanations")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default()
    };

    let mut seen: Vec<String> = Vec::new();
    let mut out: Vec<QuizExplanation> = Vec::new();
    for entry in entries {
        let id = entry
            .get("question_id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim();
        let text = entry
            .get("explanation")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim();
        if id.is_empty() || text.is_empty() {
            continue;
        }
        if !allowed_ids.iter().any(|allowed| allowed == id) {
            continue;
        }
        if seen.iter().any(|s| s == id) {
            continue;
        }
        seen.push(id.to_string());
        out.push(QuizExplanation {
            question_id: id.to_string(),
            explanation: text.to_string(),
        });
    }
    out
}

/// 缓存文件文档（version + 章节 + 生成时间 + 条目）。
pub fn cache_document(
    chapter_file: &str,
    entries: &[QuizExplanation],
    generated_at: &str,
) -> Value {
    json!({
        "version": "1.0",
        "chapter_file": chapter_file,
        "generated_at": generated_at,
        "explanations": entries
            .iter()
            .map(|e| json!({
                "question_id": e.question_id,
                "explanation": e.explanation,
            }))
            .collect::<Vec<_>>(),
    })
}

/// 条目 → 前端可消费的 JSON 数组。
pub fn explanations_json(entries: &[QuizExplanation]) -> Value {
    Value::Array(
        entries
            .iter()
            .map(|e| {
                json!({
                    "question_id": e.question_id,
                    "explanation": e.explanation,
                })
            })
            .collect(),
    )
}
