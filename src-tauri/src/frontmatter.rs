//! YAML frontmatter extraction and hybrid rendering.
//!
//! Simple flat key:value frontmatter renders as a metadata card; anything
//! with block scalars (`|`, `>`), nested maps, or lists falls back to a raw
//! Prism-highlighted YAML code block so the content is preserved verbatim.
//!
//! Self-contained (no tauri deps) so tests can `#[path]`-include this file.

/// Extract YAML frontmatter from markdown content
pub fn extract_frontmatter(text: &str) -> (Option<String>, String) {
    let trimmed = text.trim_start();
    if !trimmed.starts_with("---") {
        return (None, text.to_string());
    }
    if let Some(end_pos) = trimmed[3..].find("\n---") {
        let yaml = trimmed[3..3 + end_pos].trim();
        let rest = trimmed[3 + end_pos + 4..].trim_start();
        return (Some(yaml.to_string()), rest.to_string());
    }
    (None, text.to_string())
}

/// Render frontmatter: card for flat key:value, raw YAML block for complex
pub fn render_frontmatter(yaml: &str) -> String {
    if is_complex_frontmatter(yaml) {
        format!(
            "<pre class=\"frontmatter-raw\"><code class=\"language-yaml\">{}</code></pre>",
            escape_html(yaml)
        )
    } else {
        render_frontmatter_card(yaml)
    }
}

/// Detect YAML structures the naive card parser cannot represent:
/// block scalars (`key: |`, `key: >-2`, ...), indentation (nesting,
/// multi-line lists, block scalar bodies), and top-level list items.
fn is_complex_frontmatter(yaml: &str) -> bool {
    for line in yaml.lines() {
        let trimmed = line.trim_start();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        if line.starts_with(' ') || line.starts_with('\t') {
            return true;
        }
        if trimmed.starts_with("- ") || trimmed == "-" {
            return true;
        }
        if let Some((_, value)) = trimmed.split_once(':') {
            if is_block_scalar_indicator(value.trim()) {
                return true;
            }
        }
    }
    false
}

/// `|`, `>`, optionally followed by `-`/`+` chomping and an indentation digit
fn is_block_scalar_indicator(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.is_empty() || (bytes[0] != b'|' && bytes[0] != b'>') {
        return false;
    }
    bytes[1..]
        .iter()
        .all(|&c| c == b'-' || c == b'+' || c.is_ascii_digit())
}

/// Render YAML frontmatter as an HTML card
fn render_frontmatter_card(yaml: &str) -> String {
    let mut title = None;
    let mut rows = String::new();
    for line in yaml.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        if let Some((key, value)) = trimmed.split_once(':') {
            let key = key.trim();
            let value = value.trim().trim_matches('"').trim_matches('\'');
            if key.to_lowercase() == "title" {
                title = Some(value.to_string());
            } else {
                rows.push_str(&format!(
                    "<div class=\"frontmatter-row\"><span class=\"frontmatter-key\">{}</span><span class=\"frontmatter-value\">{}</span></div>",
                    escape_html(key), escape_html(value)
                ));
            }
        }
    }
    let title_html = title.map_or(String::new(), |t| {
        format!("<div class=\"frontmatter-title\">{}</div>", escape_html(&t))
    });
    format!(
        "<div class=\"frontmatter-card\">{}<div class=\"frontmatter-body\">{}</div></div>",
        title_html, rows
    )
}

/// Escape HTML special characters
fn escape_html(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}
