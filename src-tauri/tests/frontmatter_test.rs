//! Integration tests for YAML frontmatter hybrid rendering.
//!
//! Pure logic lives in src/frontmatter.rs — included via `#[path]` because
//! app_lib-linked test exes fail to start on some machines
//! (STATUS_ENTRYPOINT_NOT_FOUND).
//!
//! Run with: cargo test --test frontmatter_test

#[path = "../src/frontmatter.rs"]
mod frontmatter;

use frontmatter::{extract_frontmatter, render_frontmatter};

// ---------- extract_frontmatter ----------

#[test]
fn test_extract_no_frontmatter() {
    let (fm, body) = extract_frontmatter("# Hello\n\nworld");
    assert!(fm.is_none());
    assert_eq!(body, "# Hello\n\nworld");
}

#[test]
fn test_extract_simple_frontmatter() {
    let (fm, body) = extract_frontmatter("---\ntitle: Hi\ndate: 2026-01-01\n---\n\n# Content");
    assert_eq!(fm.as_deref(), Some("title: Hi\ndate: 2026-01-01"));
    assert!(
        body.starts_with("# Content"),
        "body should drop frontmatter"
    );
}

// ---------- simple frontmatter keeps the card ----------

#[test]
fn test_simple_flat_frontmatter_renders_card() {
    let html = render_frontmatter("title: My Post\nauthor: Alice\ndate: 2026-01-01");
    assert!(
        html.contains("frontmatter-card"),
        "flat yaml should keep card"
    );
    assert!(html.contains("My Post"));
    assert!(html.contains("frontmatter-key"));
    assert!(html.contains("author"));
}

#[test]
fn test_simple_card_escapes_html() {
    let html = render_frontmatter("title: <script>alert(1)</script>");
    assert!(!html.contains("<script>"), "card must escape html");
    assert!(html.contains("&lt;script&gt;"));
}

// ---------- complex frontmatter falls back to raw yaml block ----------

/// The core regression: SKILL.md `when-to-use: |` block scalar must be
/// rendered faithfully, with the indented body preserved — not dropped.
#[test]
fn test_block_scalar_renders_raw_and_preserves_body() {
    let yaml = "name: chapter-generation\ndescription: 章节生成\nwhen-to-use: |\n  满足任一时调用：\n  - 需要拉取章节大纲\n  - 需要拉取写作约束";
    let html = render_frontmatter(yaml);
    assert!(
        html.contains("language-yaml"),
        "block scalar should fall back to raw yaml block, got: {html}"
    );
    assert!(
        !html.contains("frontmatter-card"),
        "complex yaml must not use the naive card"
    );
    // The entire block scalar body must survive verbatim
    assert!(html.contains("满足任一时调用："));
    assert!(html.contains("- 需要拉取章节大纲"));
    assert!(html.contains("- 需要拉取写作约束"));
}

#[test]
fn test_block_scalar_variants_detected() {
    for v in ["|", "|-", "|+", ">", ">-", ">+", "|2", ">+2"] {
        let yaml = format!("key: {v}\n  body");
        let html = render_frontmatter(&yaml);
        assert!(
            html.contains("language-yaml"),
            "indicator `{v}` should trigger raw mode"
        );
    }
}

#[test]
fn test_nested_map_renders_raw() {
    let yaml = "name: x\nmetadata:\n  version: 2\n  tags:\n    - a";
    let html = render_frontmatter(yaml);
    assert!(html.contains("language-yaml"));
    assert!(html.contains("version: 2"));
    assert!(html.contains("- a"));
}

#[test]
fn test_top_level_list_renders_raw() {
    let yaml = "- alpha\n- beta";
    let html = render_frontmatter(yaml);
    assert!(html.contains("language-yaml"));
    assert!(html.contains("- alpha"));
}

#[test]
fn test_raw_block_escapes_html() {
    let yaml = "when-to-use: |\n  <script>alert(1)</script>\n  & <b>";
    let html = render_frontmatter(yaml);
    assert!(!html.contains("<script>"), "raw block must escape html");
    assert!(html.contains("&lt;script&gt;"));
    assert!(html.contains("&amp;"));
}

// ---------- edge cases that must STAY in card mode ----------

#[test]
fn test_url_and_colon_values_stay_card() {
    // colons inside values (URLs, k:v filter strings) are not block scalars
    let yaml = "title: Post\nlink: https://example.com\nfilter: k_feat:current;k_period:0T";
    let html = render_frontmatter(yaml);
    assert!(
        html.contains("frontmatter-card"),
        "colon-bearing values should stay in card mode, got: {html}"
    );
}

#[test]
fn test_comment_lines_do_not_trigger_raw() {
    let yaml = "# a comment\ntitle: Post";
    let html = render_frontmatter(yaml);
    assert!(html.contains("frontmatter-card"));
}
