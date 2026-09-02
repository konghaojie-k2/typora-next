//! D 层：课程内容元素合规校验（element-compliance）。
//!
//! 生成章节后扫描 `{NN}-*.md`：对 engineering / humanities 课程，凡出现**非**图表/
//! 纯文本围栏的编程代码块（python / javascript / bash / pseudocode…）即记违规，
//! 由 `generate_chapters` 后置触发一轮 agent `element-repair` 定向重写（best-effort）。
//!
//! 纯 std + serde_json，可用 `#[path]` include 测试（不 link app_lib）：
//!   cargo test --test element_compliance_test
//!
//! 设计边界：只抓**围栏代码块**（可靠、零误报）。行内 code / 裸伪代码是不可靠信号，
//! 交给 SKILL.md 骨架（engineering 模板不预留代码槽位）+ 模型自检兜底，不做假硬约束。
//!
//! 仅 engineering / humanities 受限；hybrid 计算类小节合法用代码，不硬禁。

/// engineering/humanities 允许的非编程围栏语言（图表 / 纯文本 / LaTeX）。
pub const ALLOWED_NON_CODE_LANGS: [&str; 5] = ["mermaid", "text", "txt", "tex", "latex"];

/// 该 course_type 下，给定围栏语言是否算"应禁止的编程代码块"。
pub fn is_code_block_forbidden(course_type: &str, lang: &str) -> bool {
    if !matches!(course_type, "engineering" | "humanities") {
        return false;
    }
    let l = lang.trim().to_ascii_lowercase();
    // 空标签（未打语言标签的围栏）在受限域下视为编程块 → 违规；
    // 非白名单的其它标签（python/js/bash/go…）同判违规。
    !ALLOWED_NON_CODE_LANGS.contains(&l.as_str())
}

/// 围栏语言检测：行首（去空白后）以 ``` 或 ~~~ 开头 → 返回其余部分 trim 后语言标签。
/// 关闭围栏自身匹配时返回 Some("")；调用方靠 inside/outside 状态区分开关。
fn fence_lang_of(line: &str) -> Option<&str> {
    let t = line.trim();
    if let Some(rest) = t.strip_prefix("```") {
        Some(rest.trim())
    } else if let Some(rest) = t.strip_prefix("~~~") {
        Some(rest.trim())
    } else {
        None
    }
}

/// 一条章节合规违规。
#[derive(Debug, Clone, PartialEq)]
pub struct ElementViolation {
    pub file: String,
    /// 违规围栏语言标签（空串 = 未打标签）。
    pub lang: String,
    /// opening 围栏所在行（1-based）。
    pub line: usize,
    pub detail: String,
}

/// 扫描单章 Markdown，返回违规清单。非 engineering/humanities 恒返回空。
pub fn check_chapter(course_type: &str, filename: &str, content: &str) -> Vec<ElementViolation> {
    let mut out = Vec::new();
    if !matches!(course_type, "engineering" | "humanities") {
        return out;
    }

    let mut in_fence = false;
    let mut fence_lang = String::new();
    let mut fence_start = 0usize;

    for (i, line) in content.lines().enumerate() {
        if !in_fence {
            if let Some(lang) = fence_lang_of(line) {
                in_fence = true;
                fence_lang = lang.to_string();
                fence_start = i + 1; // 1-based
            }
        } else if fence_lang_of(line).is_some() {
            // 遇到关闭围栏（或嵌套围栏）→ 结算前一个围栏
            if is_code_block_forbidden(course_type, &fence_lang) {
                let lang_display = if fence_lang.trim().is_empty() {
                    "(未打语言标签)".to_string()
                } else {
                    fence_lang.clone()
                };
                out.push(ElementViolation {
                    file: filename.to_string(),
                    lang: fence_lang.clone(),
                    line: fence_start,
                    detail: format!(
                        "{course_type} 课程禁止编程代码块：`{lang_display}`（{fence_start} 行起）"
                    ),
                });
            }
            in_fence = false;
        }
        // 注意：文件尾部未闭合的围栏在下面 EOF 处结算
    }

    // EOF：结算未闭合的围栏（未闭合 = 更可能是残留代码块，同样标记）
    if in_fence && is_code_block_forbidden(course_type, &fence_lang) {
        let lang_display = if fence_lang.trim().is_empty() {
            "(未打语言标签)".to_string()
        } else {
            fence_lang.clone()
        };
        out.push(ElementViolation {
            file: filename.to_string(),
            lang: fence_lang.clone(),
            line: fence_start,
            detail: format!(
                "{course_type} 课程禁止编程代码块：`{lang_display}`（{fence_start} 行起，未闭合）"
            ),
        });
    }

    out
}
