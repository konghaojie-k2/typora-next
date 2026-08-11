//! Explain 输出解析（2026-08-11 划词对话截断 bug 修复）
//!
//! 根因：模型写 .explain-result.json 时在字符串值内使用未转义的半角双引号
//! （如 "语义是"且"，不是"或""）→ serde 解析失败 → 旧 lenient fallback
//! 在第一个半角引号处截断 → 用户看到半句话、无省略号。
//!
//! 修复策略（robust fallback）：
//! - explanation 值的终点取结构边界（",\n … "suggested_questions" 键之前），
//!   而非第一个未转义引号——字符串内的裸引号原样保留；
//! - suggested_questions 按行打捞（模型习惯每行一条追问）；
//! - 对提取内容做基础 JSON 反转义（\n / \" / \\ 等）。
//!
//! ai_agent::parse_explain_response 是本模块的薄封装。

use serde_json::Value;

pub struct ExplainParsed {
    pub explanation: String,
    pub suggested_questions: Vec<String>,
}

/// 解析 explain 输出（agent 写盘文件内容或 ureq 原始回复）。
pub fn parse_explain_output(raw: &str) -> ExplainParsed {
    let cleaned = strip_code_fence(raw);

    if let Ok(parsed) = serde_json::from_str::<Value>(&cleaned) {
        let mut explanation = parsed
            .get("explanation")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        // Safety truncate to 1000 chars (very rare, only if LLM goes wild)
        if explanation.chars().count() > 1000 {
            explanation = explanation.chars().take(997).collect::<String>() + "...";
        }
        let suggested_questions = parsed
            .get("suggested_questions")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(String::from))
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        return ExplainParsed {
            explanation,
            suggested_questions,
        };
    }

    robust_fallback(&cleaned, raw)
}

/// 去掉 ```json ... ``` 代码块包装（多行与单行两种形态）。
fn strip_code_fence(raw: &str) -> String {
    let mut s = raw.trim();
    if s.starts_with("```") {
        if let Some(content_start) = s.find('\n') {
            // Multi-line: skip the ```json line
            s = s[content_start..].trim_start();
            // Remove closing ``` and everything after
            if let Some(end) = s.find("```") {
                s = s[..end].trim();
            }
        } else {
            // Single-line: strip ```...``` and optional `json` prefix
            s = &s[3..];
            if let Some(end) = s.rfind("```") {
                s = s[..end].trim();
            } else {
                s = s.trim();
            }
            if let Some(stripped) = s.strip_prefix("json").or_else(|| s.strip_prefix("JSON")) {
                s = stripped.trim();
            }
        }
    }
    s.to_string()
}

/// serde 失败时的兜底提取。
///
/// 首选结构边界提取（容忍字符串值内的裸半角引号）；
/// "suggested_questions" 键不存在（严重截断）时退化为旧的引号扫描。
fn robust_fallback(cleaned: &str, raw: &str) -> ExplainParsed {
    const EXPL_KEY: &str = "\"explanation\"";
    const QUESTIONS_KEY: &str = "\"suggested_questions\"";

    let Some(key_pos) = cleaned.find(EXPL_KEY) else {
        return ExplainParsed {
            explanation: raw.to_string(),
            suggested_questions: vec![],
        };
    };

    // 定位 explanation 值的起始引号（跳过 key 与冒号）
    let after_key = &cleaned[key_pos + EXPL_KEY.len()..];
    let value_start = after_key
        .find(':')
        .and_then(|colon| {
            after_key[colon + 1..]
                .find('"')
                .map(|q| key_pos + EXPL_KEY.len() + colon + 1 + q + 1)
        })
        .map(|pos| &cleaned[pos..]);

    let Some(value_region) = value_start else {
        return ExplainParsed {
            explanation: raw.to_string(),
            suggested_questions: vec![],
        };
    };

    let explanation = match value_region.find(QUESTIONS_KEY) {
        Some(q_pos) => {
            // 结构边界：region 形如 `...文本。",\n  ` —— 去尾逗号与收尾引号。
            // 值内若含裸引号（bug 场景）会原样保留。
            let region = value_region[..q_pos].trim_end();
            let region = region.strip_suffix(',').map(str::trim_end).unwrap_or(region);
            let inner = region.strip_suffix('"').unwrap_or(region);
            unescape_json_string(inner)
        }
        None => {
            // 旧行为：扫描到第一个未转义引号（应对 questions 键未写出的严重截断）
            let mut extracted = String::new();
            let mut chars = value_region.chars();
            loop {
                match chars.next() {
                    None => break,
                    Some('"') => {
                        if extracted.ends_with('\\') {
                            extracted.push('"');
                        } else {
                            break;
                        }
                    }
                    Some(c) => extracted.push(c),
                }
            }
            if extracted.is_empty() {
                raw.to_string()
            } else {
                extracted
            }
        }
    };

    ExplainParsed {
        explanation,
        suggested_questions: salvage_questions(cleaned),
    }
}

/// 从（可能含裸引号的）questions 数组按行打捞追问。
/// 模型习惯每条追问一行：`"追问1: ...",` —— 去行首引号、行尾 `,"`。
fn salvage_questions(cleaned: &str) -> Vec<String> {
    const QUESTIONS_KEY: &str = "\"suggested_questions\"";
    let Some(kpos) = cleaned.find(QUESTIONS_KEY) else {
        return vec![];
    };
    let after = &cleaned[kpos + QUESTIONS_KEY.len()..];
    let Some(bracket) = after.find('[') else {
        return vec![];
    };
    let body = &after[bracket + 1..];
    let body = match body.find(']') {
        Some(end) => &body[..end],
        None => body, // 截断到 EOF 也尽量打捞
    };

    let mut out = Vec::new();
    for line in body.lines() {
        let t = line.trim();
        let Some(t) = t.strip_prefix('"') else {
            continue;
        };
        let t = t.strip_suffix(',').unwrap_or(t);
        let t = t.strip_suffix('"').unwrap_or(t);
        let q = unescape_json_string(t);
        if !q.is_empty() {
            out.push(q);
        }
    }
    out
}

/// 基础 JSON 字符串反转义（\n \t \r \" \\），其余序列原样保留。
fn unescape_json_string(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars();
    while let Some(c) = chars.next() {
        if c == '\\' {
            match chars.next() {
                Some('n') => out.push('\n'),
                Some('t') => out.push('\t'),
                Some('r') => out.push('\r'),
                Some('"') => out.push('"'),
                Some('\\') => out.push('\\'),
                Some(other) => {
                    out.push('\\');
                    out.push(other);
                }
                None => out.push('\\'),
            }
        } else {
            out.push(c);
        }
    }
    out
}
