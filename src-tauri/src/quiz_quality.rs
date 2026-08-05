//! Quiz 质量校验纯函数（quiz-distractor-quality C 层）。
//!
//! 生成后校验章节 quiz.json：选项长度失衡 / 正确项照抄正文 → 违规清单，
//! 由 `generate_chapters` 后置触发一轮 agent 定向重写。
//! 纯 std + serde_json，可用 `#[path]` include 测试（不 link app_lib）。

use serde_json::Value;

/// 选项最长/最短字数比阈值（存量均值 2.35-3.3，优质题约 1.3-1.5）
pub const LENGTH_RATIO_THRESHOLD: f64 = 1.8;

/// 正确项照抄检测的最小字符数（短选项不做子串判定，防误报）
const VERBATIM_MIN_CHARS: usize = 20;

#[derive(Debug, Clone, PartialEq)]
pub struct QuizViolation {
    pub question_id: String,
    /// "length_ratio" | "verbatim"
    pub kind: String,
    pub detail: String,
}

fn char_len(s: &str) -> usize {
    s.chars().count()
}

/// 去空白后的子串判定（正文换行/空格不应豁免照抄）
fn contains_verbatim(chapter: &str, text: &str) -> bool {
    if chapter.contains(text) {
        return true;
    }
    let strip = |s: &str| s.chars().filter(|c| !c.is_whitespace()).collect::<String>();
    let c = strip(chapter);
    let t = strip(text);
    !t.is_empty() && c.contains(&t)
}

/// 校验一道 label 型单选题（options=[{label,text}]，correct=label）
pub fn check_label_question(q: &Value, chapter_text: Option<&str>) -> Vec<QuizViolation> {
    let mut out = Vec::new();
    let id = q
        .get("id")
        .and_then(|v| v.as_str())
        .unwrap_or("?")
        .to_string();

    let options = match q.get("options").and_then(|v| v.as_array()) {
        Some(o) if o.len() >= 2 => o,
        _ => return out,
    };
    let texts: Vec<&str> = options
        .iter()
        .filter_map(|o| o.get("text").and_then(|t| t.as_str()))
        .collect();

    // 1. 长度失衡
    if texts.len() == options.len() {
        let (min, max) = texts.iter().fold((usize::MAX, 0usize), |(mn, mx), t| {
            let l = char_len(t);
            (mn.min(l), mx.max(l))
        });
        if min > 0 {
            let ratio = max as f64 / min as f64;
            if ratio > LENGTH_RATIO_THRESHOLD {
                out.push(QuizViolation {
                    question_id: id.clone(),
                    kind: "length_ratio".to_string(),
                    detail: format!(
                        "选项长度比 {:.1} 倍（阈值 {} 倍），正确项不得明显更长",
                        ratio, LENGTH_RATIO_THRESHOLD
                    ),
                });
            }
        }
    }

    // 2. 正确项照抄正文
    if let Some(chapter) = chapter_text {
        let correct_label = q.get("correct").and_then(|v| v.as_str()).unwrap_or("");
        let correct_text = options.iter().find_map(|o| {
            if o.get("label").and_then(|l| l.as_str()) == Some(correct_label) {
                o.get("text").and_then(|t| t.as_str())
            } else {
                None
            }
        });
        if let Some(ct) = correct_text {
            if char_len(ct) >= VERBATIM_MIN_CHARS && contains_verbatim(chapter, ct) {
                out.push(QuizViolation {
                    question_id: id,
                    kind: "verbatim".to_string(),
                    detail: "正确项为正文原句照抄，须改写".to_string(),
                });
            }
        }
    }

    out
}

/// 校验章节 quiz.json（顶层 questions 数组），仅查 single 题型
pub fn check_quiz_json(json: &Value, chapter_text: Option<&str>) -> Vec<QuizViolation> {
    match json.get("questions").and_then(|q| q.as_array()) {
        Some(qs) => qs
            .iter()
            .filter(|q| q.get("qtype").and_then(|t| t.as_str()) == Some("single"))
            .flat_map(|q| check_label_question(q, chapter_text))
            .collect(),
        None => Vec::new(),
    }
}
