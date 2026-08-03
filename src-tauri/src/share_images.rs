//! Image reference extraction for share_document (pure std, no deps).
//!
//! Integration tests `#[path]`-include this file directly — see
//! tests/share_images_test.rs for why (app_lib links WebView2).
//!
//! Replaces the old regex `!\[([^\]]*)\]\(([^)]+)\)` which silently dropped
//! any image whose destination carried a CommonMark title
//! (`![a](p.png "title")` captured `p.png "title"` as the path → exists()
//! failed → image missing from the share ZIP). Also handles reference forms
//! the regex never saw: angle-bracket destinations, <img> HTML tags, and
//! Obsidian size/alias suffixes (![[img.png|300]]).

/// How the image was referenced in the source markdown.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ImageRefKind {
    /// ![alt](destination)
    Markdown,
    /// Obsidian ![[target]] (target already stripped of |alias / |size)
    Wiki,
    /// Raw <img src="..."> tag
    Html,
}

/// One image reference found in the markdown source.
#[derive(Debug, Clone)]
pub struct ImageRef {
    /// Exact source text, used for the rewrite-replace in share_document.
    pub original: String,
    /// Path / wikilink target / URL (title and wiki suffix stripped).
    pub target: String,
    pub kind: ImageRefKind,
}

/// http(s) and data: URIs are not local files — share skips them.
pub fn is_remote(target: &str) -> bool {
    target.starts_with("http://") || target.starts_with("https://") || target.starts_with("data:")
}

// ============================================
// Path handling for the share bundle
// ============================================

/// Lexically resolve `.` / `..` components (no filesystem access, no
/// Windows `\\?\` verbatim prefix that fs::canonicalize would add).
///
/// Why: a doc at `<root>/<sub>/doc.md` referencing `../assets/img.png`
/// joins to `<root>/<sub>/../assets/img.png`. Passing that UNNORMALIZED
/// path to share_relative_path stripped the `<root>/<sub>` prefix string
/// and produced `../assets/img.png` as the bundle-relative path —
/// temp_dir.join("../assets/...") escaped the temp dir and the ZIP ended
/// up with no images (2026-08-03 user report).
pub fn normalize_path(p: &std::path::Path) -> std::path::PathBuf {
    use std::path::{Component, PathBuf};
    let mut out = PathBuf::new();
    for c in p.components() {
        match c {
            Component::CurDir => {}
            Component::ParentDir => {
                // Pop only past a Normal component; a leading .. in a
                // relative path (or at filesystem root) is kept.
                if matches!(out.components().next_back(), Some(Component::Normal(_))) {
                    out.pop();
                } else {
                    out.push("..");
                }
            }
            other => out.push(other.as_os_str()),
        }
    }
    out
}

/// Compute a bundle-relative path for an image inside the share temp dir.
/// The result NEVER starts with `..` (that would escape the temp dir and
/// drop the file from the ZIP): images outside both `base_dir` and
/// `md_dir` fall back to their bare file name.
pub fn share_relative_path(source: &std::path::Path, base_dir: &str, md_dir: &str) -> String {
    let source_str = source.to_string_lossy().replace("\\", "/");
    let base_str = base_dir.replace("\\", "/");
    let base_str = base_str.trim_end_matches('/');
    let md_dir_str = md_dir.replace("\\", "/");
    let md_dir_str = md_dir_str.trim_end_matches('/');

    let rel = if !base_str.is_empty() && source_str.starts_with(base_str) {
        source_str[base_str.len()..].trim_start_matches('/').to_string()
    } else if !md_dir_str.is_empty() && source_str.starts_with(md_dir_str) {
        source_str[md_dir_str.len()..]
            .trim_start_matches('/')
            .to_string()
    } else {
        String::new()
    };

    if !rel.is_empty() && rel != ".." && !rel.starts_with("../") {
        return rel;
    }
    source
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "image".to_string())
}

/// Decode %XX sequences (Typora percent-encodes spaces in image paths).
/// Invalid sequences are kept literally; result is UTF-8 lossy.
pub fn percent_decode(s: &str) -> String {
    if !s.contains('%') {
        return s.to_string();
    }
    let bytes = s.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hi = (bytes[i + 1] as char).to_digit(16);
            let lo = (bytes[i + 2] as char).to_digit(16);
            if let (Some(hi), Some(lo)) = (hi, lo) {
                out.push((hi * 16 + lo) as u8);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Extract all image references (markdown, wikilink, HTML) in source order.
pub fn extract_image_refs(content: &str) -> Vec<ImageRef> {
    let mut refs = Vec::new();
    let bytes = content.as_bytes();
    let mut i = 0;

    while i < bytes.len() {
        // NB: match on BYTES, never content[i..] — i may sit inside a
        // multibyte UTF-8 char (Chinese prose) and str slicing would panic.
        if bytes[i..].starts_with(b"![[") {
            if let Some(end) = content[i + 3..].find("]]") {
                let original = &content[i..i + 3 + end + 2];
                let inner = &content[i + 3..i + 3 + end];
                // ![[path|alias-or-size]] — suffix is display config, not path
                let target = inner.split('|').next().unwrap_or("").trim();
                if !target.is_empty() {
                    refs.push(ImageRef {
                        original: original.to_string(),
                        target: target.to_string(),
                        kind: ImageRefKind::Wiki,
                    });
                }
                i += 3 + end + 2;
                continue;
            }
        } else if bytes[i..].starts_with(b"![") {
            if let Some(r) = parse_markdown_image(content, i) {
                let advance = r.original.len();
                refs.push(r);
                i += advance;
                continue;
            }
        } else if bytes[i..].starts_with(b"<img") {
            if let Some(r) = parse_html_img(content, i) {
                let advance = r.original.len();
                refs.push(r);
                i += advance;
                continue;
            }
        }
        i += 1;
    }

    refs
}

/// Parse `![alt](destination)` starting at `start` (which points at "![" ).
/// The destination may carry an optional title: `![a](p "t")`, `'t'`, `(t)`,
/// or be angle-bracketed (`![a](<p with spaces>)`).
fn parse_markdown_image(content: &str, start: usize) -> Option<ImageRef> {
    let alt_end = content[start + 2..].find(']')?;
    let open_paren = start + 2 + alt_end + 1;
    if !content[open_paren..].starts_with('(') {
        return None;
    }

    // Scan the destination: ends at a ')' that is not inside quotes,
    // angle brackets, or a nested parenthesized title.
    let bytes = content.as_bytes();
    let mut j = open_paren + 1;
    let mut in_quote: Option<u8> = None;
    let mut angle_depth = 0i32;
    let mut paren_depth = 0i32;
    while j < bytes.len() {
        let c = bytes[j];
        if let Some(q) = in_quote {
            if c == q {
                in_quote = None;
            }
        } else if c == b'"' || c == b'\'' {
            in_quote = Some(c);
        } else if c == b'<' {
            angle_depth += 1;
        } else if c == b'>' && angle_depth > 0 {
            angle_depth -= 1;
        } else if c == b'(' && angle_depth == 0 {
            paren_depth += 1;
        } else if c == b')' && angle_depth == 0 {
            if paren_depth > 0 {
                paren_depth -= 1;
            } else {
                break;
            }
        }
        j += 1;
    }
    if j >= bytes.len() {
        return None;
    }

    let dest_raw = &content[open_paren + 1..j];
    let target = split_destination(dest_raw)?;
    Some(ImageRef {
        original: content[start..j + 1].to_string(),
        target,
        kind: ImageRefKind::Markdown,
    })
}

/// Split a raw destination into path + optional title.
/// `<path with spaces> "title"` → `path with spaces`;
/// `path.png "title"` → `path.png`.
fn split_destination(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    if let Some(rest) = trimmed.strip_prefix('<') {
        let end = rest.find('>')?;
        let path = rest[..end].trim();
        return if path.is_empty() { None } else { Some(path.to_string()) };
    }
    // Plain destination: path ends at the first whitespace (title follows).
    let path = trimmed.split_whitespace().next()?;
    Some(path.to_string())
}

/// Parse an `<img ... src="...">` tag starting at `start` (which points at "<img").
fn parse_html_img(content: &str, start: usize) -> Option<ImageRef> {
    let tag_end = content[start..].find('>')? + start;
    let tag = &content[start..=tag_end];

    // Find src= then the quoted value (" or ')
    let src_pos = tag.find("src=")?;
    let after = &tag[src_pos + 4..];
    let after_trimmed = after.trim_start();
    let quote = after_trimmed.chars().next()?;
    if quote != '"' && quote != '\'' {
        return None;
    }
    let value_start = src_pos + 4 + (after.len() - after_trimmed.len()) + 1;
    let value_end = tag[value_start..].find(quote)? + value_start;
    let target = tag[value_start..value_end].trim();
    if target.is_empty() {
        return None;
    }
    Some(ImageRef {
        original: tag.to_string(),
        target: target.to_string(),
        kind: ImageRefKind::Html,
    })
}
