//! Integration tests for element-compliance (D 层) checker.
//!
//! Pure logic lives in src/element_compliance.rs — included via `#[path]` because
//! app_lib-linked test exes fail to start on some machines
//! (STATUS_ENTRYPOINT_NOT_FOUND). Do NOT `#[path]`-include ai_agent.rs.
//!
//! Run with: cargo test --test element_compliance_test

#[path = "../src/element_compliance.rs"]
mod element_compliance;

use element_compliance::{check_chapter, is_code_block_forbidden};

// ---------- is_code_block_forbidden ----------

#[test]
fn technical_allows_programming_code_blocks() {
    assert!(!is_code_block_forbidden("technical", "python"));
    assert!(!is_code_block_forbidden("technical", "rust"));
    assert!(!is_code_block_forbidden("technical", "javascript"));
}

#[test]
fn engineering_bans_programming_code_blocks() {
    assert!(is_code_block_forbidden("engineering", "python"));
    assert!(is_code_block_forbidden("engineering", "python3"));
    assert!(is_code_block_forbidden("engineering", "javascript"));
    assert!(is_code_block_forbidden("engineering", "rust"));
}

#[test]
fn engineering_allows_mermaid_and_plaintext() {
    assert!(!is_code_block_forbidden("engineering", "mermaid"));
    assert!(!is_code_block_forbidden("engineering", "text"));
    assert!(!is_code_block_forbidden("engineering", "txt"));
    assert!(!is_code_block_forbidden("engineering", "tex"));
    assert!(!is_code_block_forbidden("engineering", "latex"));
}

#[test]
fn humanities_bans_programming_code_blocks() {
    assert!(is_code_block_forbidden("humanities", "python"));
    assert!(is_code_block_forbidden("humanities", "go"));
}

#[test]
fn hybrid_allows_programming_code_blocks() {
    // hybrid 计算类小节用 technical 元素（含代码），不做 D 层硬禁
    assert!(!is_code_block_forbidden("hybrid", "python"));
    assert!(!is_code_block_forbidden("hybrid", "javascript"));
}

#[test]
fn unknown_type_is_not_restricted() {
    assert!(!is_code_block_forbidden("something-else", "python"));
}

#[test]
fn empty_lang_is_forbidden_for_engineering() {
    // 未打标签的围栏代码块在 engineering 下视为编程块 → 违规
    assert!(is_code_block_forbidden("engineering", ""));
    assert!(is_code_block_forbidden("engineering", "  "));
}

// ---------- check_chapter ----------

#[test]
fn engineering_flags_python_fence() {
    let md = "正文\n\n```python\nx = 1\n```\n\n结尾";
    let v = check_chapter("engineering", "01-刻蚀.md", md);
    assert_eq!(v.len(), 1, "should flag one code block");
    assert_eq!(v[0].lang, "python");
    assert_eq!(v[0].file, "01-刻蚀.md");
    assert_eq!(v[0].line, 3, "opening fence should be on line 3 (1-based)");
    assert!(v[0].detail.contains("禁止"));
}

#[test]
fn engineering_allows_mermaid_fence() {
    let md = "```mermaid\nflowchart LR\nA-->B\n```";
    let v = check_chapter("engineering", "01.md", md);
    assert!(v.is_empty(), "mermaid fence should not be flagged");
}

#[test]
fn engineering_allows_tex_fence() {
    let md = "```tex\nE = m c^2\n```";
    let v = check_chapter("engineering", "01.md", md);
    assert!(v.is_empty());
}

#[test]
fn technical_never_flags_code_blocks() {
    let md = "```python\nx=1\n```\n```javascript\ny=2\n```";
    let v = check_chapter("technical", "01.md", md);
    assert!(v.is_empty());
}

#[test]
fn engineering_flags_multiple_fences_with_lang_and_line() {
    let md = "## 1.1 简介\n\n```bash\nls\n```\n\n好\n\n```python\na=1\n```";
    let v = check_chapter("engineering", "a.md", md);
    assert_eq!(v.len(), 2);
    assert!(v.iter().any(|x| x.lang == "bash"));
    assert!(v.iter().any(|x| x.lang == "python"));
    assert!(!v.iter().any(|x| x.lang == "mermaid"));
}

#[test]
fn engineering_flags_unclosed_fence_at_open() {
    // 未闭合的围栏也要标记（在 opening 行记录）
    let md = "前文\n```python\nx = 1";
    let v = check_chapter("engineering", "a.md", md);
    assert_eq!(v.len(), 1, "unclosed python fence should be flagged");
}

#[test]
fn engineering_does_not_flag_text_without_fences() {
    let md = "纯文本，没有代码块。电解铝的阳极消耗。";
    let v = check_chapter("engineering", "a.md", md);
    assert!(v.is_empty());
}

#[test]
fn engineering_flags_tilde_fences() {
    let md = "~~~python\nx=1\n~~~";
    let v = check_chapter("engineering", "a.md", md);
    assert_eq!(v.len(), 1, "tilde fences should also be detected");
}
