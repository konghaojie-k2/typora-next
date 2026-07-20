//! Markdown to DOCX export with native OMML math equations.
//!
//! Cross-platform Rust implementation using:
//! - pulldown-cmark for Markdown parsing
//! - docx-rs for DOCX generation
//! - latex2mathml + deckmint-math for LaTeX -> MathML -> OMML conversion

use docx_rs::*;
use pulldown_cmark::{Event, Parser, Tag, TagEnd};
use regex::Regex;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

const MATH_NS: &str = "http://schemas.openxmlformats.org/officeDocument/2006/math";

/// Math expression types
#[derive(Debug, Clone, PartialEq)]
pub enum MathBlock {
    Inline(String),
    Block(String),
}

/// Pre-rendered Mermaid diagram to embed in DOCX output.
#[derive(Debug, Clone, PartialEq)]
pub struct MermaidImage {
    pub bytes: Vec<u8>,
    pub width_px: u32,
    pub height_px: u32,
}

/// Extract math blocks from text, returning positions and content
///
/// Handles both inline ($...$) and block ($$...$$) math expressions.
/// Block math takes priority (detected first) to avoid partial matches.
pub fn extract_math_blocks(text: &str) -> Vec<(usize, usize, MathBlock)> {
    let mut results = Vec::new();
    let chars: Vec<char> = text.chars().collect();
    let len = chars.len();
    let mut i = 0;

    while i < len {
        // Check for $$ (block math) first
        if i + 1 < len && chars[i] == '$' && chars[i + 1] == '$' {
            let start = i;
            i += 2; // Skip opening $$

            // Skip leading whitespace/newline after $$
            while i < len && (chars[i] == ' ' || chars[i] == '\n') {
                i += 1;
            }

            let content_start = i;

            // Find closing $$
            while i + 1 < len {
                if chars[i] == '$' && chars[i + 1] == '$' {
                    // Check if it's not escaped
                    let mut backslash_count = 0;
                    let mut j = i.saturating_sub(1);
                    while j > content_start && chars[j] == '\\' {
                        backslash_count += 1;
                        j = j.saturating_sub(1);
                    }
                    if backslash_count % 2 == 0 {
                        // Found closing $$
                        let byte_content_start = text
                            .char_indices()
                            .nth(content_start)
                            .map(|(b, _)| b)
                            .unwrap_or(0);
                        let byte_end = text
                            .char_indices()
                            .nth(i)
                            .map(|(b, _)| b)
                            .unwrap_or(text.len());
                        let content = text[byte_content_start..byte_end].to_string();
                        let content = content.trim_end().to_string();
                        results.push((start, i + 2, MathBlock::Block(content)));
                        i += 2;
                        break;
                    }
                }
                i += 1;
            }

            if i >= len {
                i = start + 2;
            }
        }
        // Check for single $ (inline math)
        else if chars[i] == '$' {
            let start = i;
            i += 1;

            // Check if $ is followed by space (not inline math)
            if i < len && (chars[i] == ' ' || chars[i] == '\n') {
                i = start + 1;
                continue;
            }

            let content_start = i;

            // Find closing $
            while i < len {
                if chars[i] == '$' {
                    // Check if it's not escaped
                    let mut backslash_count = 0;
                    let mut j = i.saturating_sub(1);
                    while j > content_start && chars[j] == '\\' {
                        backslash_count += 1;
                        j = j.saturating_sub(1);
                    }
                    if backslash_count % 2 == 0 {
                        let byte_content_start = text
                            .char_indices()
                            .nth(content_start)
                            .map(|(b, _)| b)
                            .unwrap_or(0);
                        let byte_end = text
                            .char_indices()
                            .nth(i)
                            .map(|(b, _)| b)
                            .unwrap_or(text.len());
                        let content = &text[byte_content_start..byte_end];
                        if !content.is_empty() && !content.contains('\n') {
                            results.push((start, i + 1, MathBlock::Inline(content.to_string())));
                            i += 1;
                            break;
                        }
                    }
                }
                i += 1;
            }

            if i >= len {
                i = start + 1;
            }
        } else {
            i += 1;
        }
    }

    results
}

/// Pre-process text to protect math blocks from markdown parsing
///
/// Returns (protected_text, math_blocks) where math_blocks is a vector
/// of (placeholder, original_content, is_block) tuples.
pub fn preprocess_math(text: &str) -> (String, Vec<(String, String, bool)>) {
    let math_blocks = extract_math_blocks(text);

    if math_blocks.is_empty() {
        return (text.to_string(), Vec::new());
    }

    let mut replacements: Vec<(usize, usize, String, String, bool)> = Vec::new();

    for (idx, (start, end, block)) in math_blocks.into_iter().enumerate() {
        let (content, is_block) = match block {
            MathBlock::Inline(c) => (c, false),
            MathBlock::Block(c) => (c, true),
        };
        let placeholder = format!("%%MATH_BLOCK_{}%%", idx);
        replacements.push((start, end, placeholder, content, is_block));
    }

    replacements.sort_by(|a, b| b.0.cmp(&a.0));

    let mut result = text.to_string();
    let mut stored_blocks = Vec::new();

    for (char_start, char_end, placeholder, content, is_block) in replacements {
        let byte_start = result
            .char_indices()
            .nth(char_start)
            .map(|(b, _)| b)
            .unwrap_or(0);
        let byte_end = result
            .char_indices()
            .nth(char_end)
            .map(|(b, _)| b)
            .unwrap_or(result.len());

        let before = &result[..byte_start];
        let after = &result[byte_end..];
        stored_blocks.push((placeholder.clone(), content, is_block));
        result = format!("{}{}{}", before, placeholder, after);
    }

    (result, stored_blocks)
}

/// Resolve Obsidian WikiLink image path (mirrors frontend initObsidianEmbeds logic)
pub fn resolve_wikilink_path(target: &str, base_dir: &str) -> Option<PathBuf> {
    let base_normalized = base_dir.replace("\\", "/");
    let base_parts: Vec<&str> = base_normalized
        .split('/')
        .filter(|s| !s.is_empty())
        .collect();
    let target_normalized = target.replace("\\", "/");
    let target_parts: Vec<&str> = target_normalized
        .split('/')
        .filter(|s| !s.is_empty())
        .collect();

    if target_parts.is_empty() {
        return None;
    }

    for i in (0..base_parts.len()).rev() {
        if base_parts[i] == target_parts[0] {
            let mut match_len = 0;
            for j in 0..target_parts.len() {
                if i + j < base_parts.len() && base_parts[i + j] == target_parts[j] {
                    match_len += 1;
                } else {
                    break;
                }
            }
            if match_len > 0 {
                let vault_root = base_parts[..i].join("/");
                return Some(PathBuf::from(format!("{}/{}", vault_root, target)));
            }
        }
    }

    Some(PathBuf::from(base_dir).join(target))
}

/// Convert Markdown text to a DOCX byte vector.
///
/// `base_dir` is used to resolve relative image paths.
pub fn markdown_to_docx(markdown: &str, base_dir: &Path) -> Result<Vec<u8>, String> {
    // 1. Convert Obsidian WikiLink images to standard markdown images.
    let md = preprocess_wikilinks(markdown, base_dir);

    // 2. Extract math blocks (skipping code blocks) and replace with placeholders.
    let (protected_md, math_blocks) = preprocess_math_skip_code_blocks(&md);

    // 3. Walk pulldown-cmark events and build a docx-rs document.
    let docx = Converter::new(base_dir).run(&protected_md)?;

    // 4. Build XML representation and inject OMML equations.
    let mut xml_docx = docx.build();
    inject_math_omml(&mut xml_docx, &math_blocks)?;

    // 5. Pack to bytes.
    let mut buf = Vec::new();
    xml_docx
        .pack(std::io::Cursor::new(&mut buf))
        .map_err(|e| format!("DOCX pack failed: {}", e))?;
    Ok(buf)
}

/// Convert Markdown text to a DOCX byte vector, with pre-rendered Mermaid diagrams.
///
/// `mermaid_images` maps the trimmed Mermaid source to a `MermaidImage`. When a code
/// block with language `mermaid` is encountered and its source exists in the map, it
/// is embedded as an image (with an optional caption) instead of rendered as source
/// code.
pub fn markdown_to_docx_with_mermaid(
    markdown: &str,
    base_dir: &Path,
    mermaid_images: &HashMap<String, MermaidImage>,
) -> Result<Vec<u8>, String> {
    // 1. Convert Obsidian WikiLink images to standard markdown images.
    let md = preprocess_wikilinks(markdown, base_dir);

    // 2. Extract math blocks (skipping code blocks) and replace with placeholders.
    let (protected_md, math_blocks) = preprocess_math_skip_code_blocks(&md);

    // 3. Walk pulldown-cmark events and build a docx-rs document.
    let docx = Converter::new(base_dir)
        .with_mermaid_images(mermaid_images.clone())
        .run(&protected_md)?;

    // 4. Build XML representation and inject OMML equations.
    let mut xml_docx = docx.build();
    inject_math_omml(&mut xml_docx, &math_blocks)?;

    // 5. Pack to bytes.
    let mut buf = Vec::new();
    xml_docx
        .pack(std::io::Cursor::new(&mut buf))
        .map_err(|e| format!("DOCX pack failed: {}", e))?;
    Ok(buf)
}

// ============================================================================
// WikiLink preprocessing
// ============================================================================

fn preprocess_wikilinks(markdown: &str, base_dir: &Path) -> String {
    static RE: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    let re = RE.get_or_init(|| Regex::new(r"!\[\[([^\]]+)\]\]").unwrap());

    let base_dir_str = base_dir.to_string_lossy().to_string();
    re.replace_all(markdown, |caps: &regex::Captures| {
        let target = caps[1].trim();
        if let Some(path) = resolve_wikilink_path(target, &base_dir_str) {
            format!("![{}]({})", target, path.to_string_lossy())
        } else {
            caps[0].to_string()
        }
    })
    .to_string()
}

// ============================================================================
// Math OMML conversion
// ============================================================================

fn preprocess_math_skip_code_blocks(text: &str) -> (String, Vec<(String, String, bool)>) {
    // Find code block byte ranges so we don't interpret $ inside code as math.
    let code_ranges = find_code_block_ranges(text);

    // Get all math blocks (char indices).
    let math_blocks = extract_math_blocks(text);

    // Filter out math blocks that overlap with code blocks.
    let mut valid_blocks: Vec<(usize, usize, MathBlock)> = Vec::new();
    for (char_start, char_end, block) in math_blocks {
        let byte_start = char_idx_to_byte_idx(text, char_start);
        let byte_end = char_idx_to_byte_idx(text, char_end);
        let overlaps_code = code_ranges
            .iter()
            .any(|(cs, ce)| byte_start < *ce && *cs < byte_end);
        if !overlaps_code {
            valid_blocks.push((byte_start, byte_end, block));
        }
    }

    if valid_blocks.is_empty() {
        return (text.to_string(), Vec::new());
    }

    // Build replacements from end to start so indices stay valid.
    let mut replacements: Vec<(usize, usize, String)> = Vec::new();
    let mut stored: Vec<(String, String, bool)> = Vec::new();

    for (idx, (start, end, block)) in valid_blocks.into_iter().enumerate() {
        let (latex, is_block) = match block {
            MathBlock::Inline(c) => (c, false),
            MathBlock::Block(c) => (c, true),
        };
        let placeholder = format!("%%MATH_{}%%", idx);
        replacements.push((start, end, placeholder.clone()));
        stored.push((placeholder, latex, is_block));
    }

    replacements.sort_by(|a, b| b.0.cmp(&a.0));

    let mut result = text.to_string();
    for (start, end, placeholder) in replacements {
        result.replace_range(start..end, &placeholder);
    }

    (result, stored)
}

fn find_code_block_ranges(text: &str) -> Vec<(usize, usize)> {
    let mut ranges = Vec::new();
    let parser = Parser::new_ext(text, pulldown_cmark::Options::all());
    let mut code_start: Option<usize> = None;

    for (event, range) in parser.into_offset_iter() {
        match event {
            Event::Start(Tag::CodeBlock(_)) => code_start = Some(range.start),
            Event::End(TagEnd::CodeBlock) => {
                if let Some(start) = code_start {
                    ranges.push((start, range.end));
                    code_start = None;
                }
            }
            _ => {}
        }
    }

    ranges
}

fn char_idx_to_byte_idx(s: &str, char_idx: usize) -> usize {
    s.char_indices()
        .nth(char_idx)
        .map(|(b, _)| b)
        .unwrap_or(s.len())
}

fn build_omml(latex: &str, is_block: bool) -> Result<String, String> {
    let mathml = latex2mathml::latex_to_mathml(
        latex,
        if is_block {
            latex2mathml::DisplayStyle::Block
        } else {
            latex2mathml::DisplayStyle::Inline
        },
    )
    .map_err(|e| format!("LaTeX to MathML failed: {}", e))?;

    let omml_inner = deckmint_math::mathml_to_omml::convert(&mathml)
        .map_err(|e| format!("MathML to OMML failed: {}", e))?;

    Ok(fix_rad_missing_deg(&collapse_omath_wrappers(&omml_inner)))
}

/// OMML requires `<m:rad>` to contain a `<m:deg>` child; when it is absent
/// Word renders an empty-argument placeholder box above the radical.
/// deckmint-math omits `<m:deg>` for `\sqrt` (MathML `<msqrt>`), so insert an
/// empty, hidden degree — the same shape Word itself produces.
fn fix_rad_missing_deg(omml: &str) -> String {
    const RAD: &str = "<m:rad>";
    const DEG: &str = "<m:deg>";
    if !omml.contains(RAD) {
        return omml.to_string();
    }
    let mut out = String::with_capacity(omml.len() + 128);
    let mut rest = omml;
    while let Some(pos) = rest.find(RAD) {
        out.push_str(&rest[..pos + RAD.len()]);
        let after = &rest[pos + RAD.len()..];
        if !after.starts_with(DEG) {
            out.push_str("<m:radPr><m:degHide m:val=\"1\"/></m:radPr><m:deg/>");
        }
        rest = after;
    }
    out.push_str(rest);
    out
}

/// Strip redundant outer `<m:oMath>` wrappers, returning the bare inner content.
///
/// deckmint-math's `convert()` returns double-wrapped output
/// (`<m:oMath><m:oMath>…</m:oMath></m:oMath>`), and a bare `m:oMath` child
/// inside `m:oMath` is not valid OMML — Word treats the document as corrupt
/// and drops the equation. The injection sites add exactly one wrapper, so
/// this function must remove all of them.
fn collapse_omath_wrappers(omml: &str) -> String {
    let mut result = omml.trim().to_string();
    while let Some(inner) = strip_single_omath_wrapper(&result) {
        result = inner;
    }
    result
}

/// Remove one outer `<m:oMath>…</m:oMath>` pair, but only when it wraps the
/// entire string (i.e. its depth never returns to 0 before the final close).
fn strip_single_omath_wrapper(omml: &str) -> Option<String> {
    const OPEN: &str = "<m:oMath>";
    const CLOSE: &str = "</m:oMath>";
    let s = omml.trim();
    if !s.starts_with(OPEN) || !s.ends_with(CLOSE) {
        return None;
    }
    let mut depth = 0usize;
    let mut i = 0usize;
    let bytes = s.as_bytes();
    while i < bytes.len() {
        if bytes[i..].starts_with(OPEN.as_bytes()) {
            depth += 1;
            i += OPEN.len();
        } else if bytes[i..].starts_with(CLOSE.as_bytes()) {
            depth -= 1;
            if depth == 0 && i + CLOSE.len() != bytes.len() {
                return None; // outer pair closes before the end — not a wrapper
            }
            i += CLOSE.len();
        } else {
            i += 1;
        }
    }
    if depth != 0 {
        return None;
    }
    Some(s[OPEN.len()..s.len() - CLOSE.len()].trim().to_string())
}

fn inject_math_omml(
    xml_docx: &mut XMLDocx,
    math_blocks: &[(String, String, bool)],
) -> Result<(), String> {
    let mut doc_xml = String::from_utf8_lossy(&xml_docx.document).to_string();

    // Add math namespace to root if missing.
    if !doc_xml.contains("xmlns:m=") {
        doc_xml = doc_xml.replacen(
            "<w:document ",
            &format!("<w:document xmlns:m=\"{}\" ", MATH_NS),
            1,
        );
    }

    // Split document into paragraph segments so paragraph-level replacements can never
    // span across paragraphs (which caused catastrophic regex matches before).
    let mut segments = split_into_paragraphs(&doc_xml);

    // Paragraph-level math (standalone block formula).
    for (idx, (_, latex, is_block)) in math_blocks.iter().enumerate() {
        if !is_block {
            continue;
        }
        let placeholder = format!("%%MATH_{}%%", idx);
        let omml = match build_omml(latex, true) {
            Ok(xml) => format!(
                "<m:oMathPara xmlns:m=\"{}\"><m:oMath>{}</m:oMath>\n</m:oMathPara>",
                MATH_NS, xml
            ),
            Err(_) => format!("<w:r><w:t>$$ {} $$</w:t></w:r>", latex),
        };

        for segment in &mut segments {
            if let DocxSegment::Paragraph(para_xml) = segment {
                if para_xml.contains(&placeholder) {
                    *para_xml = format!("<w:p><w:pPr><w:rPr /></w:pPr>{}</w:p>", omml);
                    break;
                }
            }
        }
    }

    let mut doc_xml = segments.iter().map(|s| s.as_str()).collect::<String>();

    // Run-level math (inline formula).
    for (idx, (_, latex, is_block)) in math_blocks.iter().enumerate() {
        if *is_block {
            continue;
        }
        let placeholder = format!("%%MATH_{}%%", idx);
        let omml = match build_omml(latex, false) {
            Ok(xml) => format!("<m:oMath xmlns:m=\"{}\">{}</m:oMath>", MATH_NS, xml),
            Err(_) => format!("<w:r><w:t>${}$</w:t></w:r>", latex),
        };

        let run_pat = format!(
            r#"<w:r>(?:<w:rPr\s*/>|<w:rPr>.*?</w:rPr>)?<w:t(?:\s+xml:space="preserve")?>{}</w:t></w:r>"#,
            regex::escape(&placeholder)
        );
        let re = Regex::new(&run_pat).map_err(|e| e.to_string())?;
        doc_xml = re.replace_all(&doc_xml, omml.as_str()).to_string();
    }

    xml_docx.document = doc_xml.into_bytes();
    Ok(())
}

#[derive(Debug)]
enum DocxSegment {
    Paragraph(String),
    Other(String),
}

impl DocxSegment {
    fn as_str(&self) -> &str {
        match self {
            DocxSegment::Paragraph(s) | DocxSegment::Other(s) => s.as_str(),
        }
    }
}

/// Split DOCX document XML into top-level paragraph segments and other content.
/// Paragraphs do not nest, so simple tag-boundary tracking is sufficient.
fn split_into_paragraphs(xml: &str) -> Vec<DocxSegment> {
    static RE: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    let re = RE.get_or_init(|| Regex::new(r"(</?)w:p(?:\s[^>]*)?>").unwrap());

    let mut segments = Vec::new();
    let mut current_para = String::new();
    let mut in_para = false;
    let mut depth = 0usize;
    let mut last_end = 0usize;

    for cap in re.captures_iter(xml) {
        let m = cap.get(0).unwrap();
        let is_close = cap.get(1).map(|s| s.as_str() == "</").unwrap_or(false);

        if !in_para && !is_close {
            // Start of a new paragraph.
            if m.start() > last_end {
                segments.push(DocxSegment::Other(xml[last_end..m.start()].to_string()));
            }
            in_para = true;
            depth = 1;
            current_para = m.as_str().to_string();
            last_end = m.end();
        } else if in_para {
            current_para.push_str(&xml[last_end..m.end()]);
            last_end = m.end();
            if is_close {
                depth = depth.saturating_sub(1);
                if depth == 0 {
                    segments.push(DocxSegment::Paragraph(current_para.clone()));
                    current_para.clear();
                    in_para = false;
                }
            } else {
                depth += 1;
            }
        }
    }

    if last_end < xml.len() {
        segments.push(DocxSegment::Other(xml[last_end..].to_string()));
    }

    segments
}

// ============================================================================
// Code highlighting
// ============================================================================

/// A token category for syntax highlighting.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TokenKind {
    Plain,
    Keyword,
    String,
    Comment,
    Number,
}

/// A simple language-aware tokenizer for code blocks.
fn tokenize_code<'a>(line: &'a str, lang: &str) -> Vec<(&'a str, TokenKind)> {
    match lang.trim().to_ascii_lowercase().as_str() {
        "rust" => tokenize_generic(line, RUST_KEYWORDS),
        "python" => tokenize_generic(line, PYTHON_KEYWORDS),
        "javascript" | "js" | "typescript" | "ts" => tokenize_generic(line, JS_KEYWORDS),
        "java" => tokenize_generic(line, JAVA_KEYWORDS),
        "c" | "cpp" | "c++" | "cxx" => tokenize_generic(line, CPP_KEYWORDS),
        "go" => tokenize_generic(line, GO_KEYWORDS),
        _ => tokenize_generic(line, GENERIC_KEYWORDS),
    }
}

fn tokenize_generic<'a, 'b>(line: &'a str, keywords: &'b [&'b str]) -> Vec<(&'a str, TokenKind)> {
    let mut tokens = Vec::new();
    let chars: Vec<char> = line.chars().collect();
    // Map each char index to its byte position in the original string.
    // Append line.len() as sentinel so byte_pos[i] is always valid for i ≤ chars.len().
    let mut byte_pos: Vec<usize> = line.char_indices().map(|(b, _)| b).collect();
    byte_pos.push(line.len());
    let len = chars.len();
    let mut i = 0; // char index

    while i < len {
        // Whitespace run (including leading spaces so indentation is preserved).
        if chars[i].is_whitespace() {
            let start = i;
            while i < len && chars[i].is_whitespace() {
                i += 1;
            }
            tokens.push((&line[byte_pos[start]..byte_pos[i]], TokenKind::Plain));
            continue;
        }

        // Line comments.
        if i + 1 < len && chars[i] == '/' && chars[i + 1] == '/' {
            tokens.push((&line[byte_pos[i]..], TokenKind::Comment));
            break;
        }
        if i + 1 < len && chars[i] == '#' {
            tokens.push((&line[byte_pos[i]..], TokenKind::Comment));
            break;
        }

        // String literals.
        if chars[i] == '\"' || chars[i] == '\'' || chars[i] == '`' {
            let quote = chars[i];
            let start = i;
            i += 1;
            while i < len {
                if chars[i] == '\\' && i + 1 < len {
                    i += 2;
                } else if chars[i] == quote {
                    i += 1;
                    break;
                } else {
                    i += 1;
                }
            }
            tokens.push((&line[byte_pos[start]..byte_pos[i]], TokenKind::String));
            continue;
        }

        // Numbers.
        if chars[i].is_ascii_digit() {
            let start = i;
            while i < len
                && (chars[i].is_ascii_digit()
                    || chars[i] == '.'
                    || chars[i] == '_'
                    || chars[i] == 'x'
                    || chars[i] == 'X'
                    || chars[i] == 'b'
                    || chars[i] == 'o'
                    || chars[i].is_ascii_alphabetic()
                        && i > start
                        && matches!(chars[i - 1], '0'..='9' | 'x' | 'X' | 'b' | 'o'))
            {
                i += 1;
            }
            tokens.push((&line[byte_pos[start]..byte_pos[i]], TokenKind::Number));
            continue;
        }

        // Identifiers / keywords.
        if chars[i].is_ascii_alphabetic() || chars[i] == '_' {
            let start = i;
            while i < len && (chars[i].is_ascii_alphanumeric() || chars[i] == '_') {
                i += 1;
            }
            let word = &line[byte_pos[start]..byte_pos[i]];
            let kind = if keywords.contains(&word) {
                TokenKind::Keyword
            } else {
                TokenKind::Plain
            };
            tokens.push((word, kind));
            continue;
        }

        // Punctuation / operators.
        let start = i;
        i += 1;
        tokens.push((&line[byte_pos[start]..byte_pos[i]], TokenKind::Plain));
    }

    tokens
}

const RUST_KEYWORDS: &[&str] = &[
    "as", "async", "await", "break", "const", "continue", "crate", "dyn", "else", "enum", "extern",
    "false", "fn", "for", "if", "impl", "in", "let", "loop", "match", "mod", "move", "mut", "pub",
    "ref", "return", "self", "Self", "static", "struct", "super", "trait", "true", "type",
    "unsafe", "use", "where", "while",
];

const PYTHON_KEYWORDS: &[&str] = &[
    "and", "as", "assert", "async", "await", "break", "class", "continue", "def", "del", "elif",
    "else", "except", "False", "finally", "for", "from", "global", "if", "import", "in", "is",
    "lambda", "None", "nonlocal", "not", "or", "pass", "raise", "return", "True", "try", "while",
    "with", "yield",
];

const JS_KEYWORDS: &[&str] = &[
    "async",
    "await",
    "break",
    "case",
    "catch",
    "class",
    "const",
    "continue",
    "debugger",
    "default",
    "delete",
    "do",
    "else",
    "export",
    "extends",
    "false",
    "finally",
    "for",
    "function",
    "if",
    "import",
    "in",
    "instanceof",
    "let",
    "new",
    "null",
    "of",
    "return",
    "super",
    "switch",
    "this",
    "throw",
    "true",
    "try",
    "typeof",
    "var",
    "void",
    "while",
    "with",
    "yield",
];

const JAVA_KEYWORDS: &[&str] = &[
    "abstract",
    "assert",
    "boolean",
    "break",
    "byte",
    "case",
    "catch",
    "char",
    "class",
    "const",
    "continue",
    "default",
    "do",
    "double",
    "else",
    "enum",
    "extends",
    "final",
    "finally",
    "float",
    "for",
    "goto",
    "if",
    "implements",
    "import",
    "instanceof",
    "int",
    "interface",
    "long",
    "native",
    "new",
    "null",
    "package",
    "private",
    "protected",
    "public",
    "return",
    "short",
    "static",
    "strictfp",
    "super",
    "switch",
    "synchronized",
    "this",
    "throw",
    "throws",
    "transient",
    "true",
    "try",
    "void",
    "volatile",
    "while",
];

const CPP_KEYWORDS: &[&str] = &[
    "alignas",
    "alignof",
    "and",
    "and_eq",
    "asm",
    "auto",
    "bitand",
    "bitor",
    "bool",
    "break",
    "case",
    "catch",
    "char",
    "char8_t",
    "char16_t",
    "char32_t",
    "class",
    "compl",
    "concept",
    "const",
    "consteval",
    "constexpr",
    "constinit",
    "const_cast",
    "continue",
    "co_await",
    "co_return",
    "co_yield",
    "decltype",
    "default",
    "delete",
    "do",
    "double",
    "dynamic_cast",
    "else",
    "enum",
    "explicit",
    "export",
    "extern",
    "false",
    "float",
    "for",
    "friend",
    "goto",
    "if",
    "inline",
    "int",
    "long",
    "mutable",
    "namespace",
    "new",
    "noexcept",
    "not",
    "not_eq",
    "nullptr",
    "operator",
    "or",
    "or_eq",
    "private",
    "protected",
    "public",
    "register",
    "reinterpret_cast",
    "requires",
    "return",
    "short",
    "signed",
    "sizeof",
    "static",
    "static_assert",
    "static_cast",
    "struct",
    "switch",
    "template",
    "this",
    "thread_local",
    "throw",
    "true",
    "try",
    "typedef",
    "typeid",
    "typename",
    "union",
    "unsigned",
    "using",
    "virtual",
    "void",
    "volatile",
    "wchar_t",
    "while",
    "xor",
    "xor_eq",
];

const GO_KEYWORDS: &[&str] = &[
    "break",
    "case",
    "chan",
    "const",
    "continue",
    "default",
    "defer",
    "else",
    "fallthrough",
    "for",
    "func",
    "go",
    "goto",
    "if",
    "import",
    "interface",
    "map",
    "package",
    "range",
    "return",
    "select",
    "struct",
    "switch",
    "type",
    "var",
];

const GENERIC_KEYWORDS: &[&str] = &[
    "function", "fn", "def", "class", "if", "else", "for", "while", "return", "true", "false",
    "null", "let", "const", "var", "import", "from",
];

fn kind_to_color(kind: TokenKind) -> &'static str {
    match kind {
        TokenKind::Keyword => "D73A49",
        TokenKind::String => "032F62",
        TokenKind::Comment => "6A737D",
        TokenKind::Number => "005CC5",
        TokenKind::Plain => "24292E",
    }
}

/// Convert a line of code into styled runs for DOCX output.
fn highlight_code(line: &str, lang: &str) -> Vec<Run> {
    if line.is_empty() {
        return vec![Run::new()
            .fonts(RunFonts::new().ascii("Courier New"))
            .size(20)
            .add_text("")];
    }

    tokenize_code(line, lang)
        .into_iter()
        .map(|(text, kind): (&str, TokenKind)| {
            Run::new()
                .fonts(RunFonts::new().ascii("Courier New"))
                .color(kind_to_color(kind))
                .size(20)
                .add_text(text.to_string())
        })
        .collect()
}

// ============================================================================
// Markdown -> DOCX converter
// ============================================================================

#[derive(Debug, Clone)]
enum InlineItem {
    Text(String),
    Code(String),
    Bold(Vec<InlineItem>),
    Italic(Vec<InlineItem>),
    Strikethrough(Vec<InlineItem>),
    Link {
        url: String,
        children: Vec<InlineItem>,
    },
    Math {
        idx: usize,
    },
    Image(Pic, String), // Pic + alt text
    HardBreak,
}

/// Info attached to blockquote paragraphs: depth=1 for `>`, depth=2 for `>>`, etc.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
struct QuoteInfo {
    depth: usize,
}

#[derive(Debug, Clone)]
enum BlockItem {
    Paragraph(Vec<InlineItem>, QuoteInfo),
    Caption(usize, String), // Word-native caption: figure_number, alt_text (题注)
    Heading(pulldown_cmark::HeadingLevel, Vec<InlineItem>),
    CodeBlock(String, String, QuoteInfo), // content, lang, quote
    ListItem {
        level: usize,
        kind: ListKind,
        numbering_id: usize,
        items: Vec<InlineItem>,
        quote: QuoteInfo,
    },
    MathBlock {
        idx: usize,
    },
    Table {
        rows: Vec<Vec<Vec<InlineItem>>>,
        alignments: Vec<pulldown_cmark::Alignment>,
    },
    TableCaption(usize, String), // Word-native caption: table_number, text (题注)
    ThematicBreak,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ListKind {
    Bullet,
    Ordered(u64),
}

struct Converter {
    base_dir: PathBuf,
    mermaid_images: HashMap<String, MermaidImage>,
}

/// Normalize Mermaid source so the frontend pre-render key and the parsed code
/// block content match regardless of CRLF, leading/trailing blank lines, or the
/// indentation of the enclosing code fence.
fn normalize_mermaid_key(content: &str) -> String {
    let text = content.replace("\r\n", "\n").replace('\r', "\n");
    let lines: Vec<&str> = text.split('\n').collect();
    let min_indent = lines
        .iter()
        .filter(|l| !l.trim().is_empty())
        .map(|l| l.bytes().take_while(|b| b.is_ascii_whitespace()).count())
        .min()
        .unwrap_or(0);

    let dedented: String = lines
        .iter()
        .map(|l| {
            let strip = min_indent.min(l.len());
            &l[strip..]
        })
        .collect::<Vec<_>>()
        .join("\n");

    dedented.trim().to_string()
}

impl Converter {
    fn new(base_dir: &Path) -> Self {
        Self {
            base_dir: base_dir.to_path_buf(),
            mermaid_images: HashMap::new(),
        }
    }

    fn with_mermaid_images(mut self, images: HashMap<String, MermaidImage>) -> Self {
        self.mermaid_images = images;
        self
    }

    fn mermaid_image_for(&self, content: &str, lang: &str) -> Option<&MermaidImage> {
        let lang = lang.trim();
        if !lang.eq_ignore_ascii_case("mermaid") && !lang.eq_ignore_ascii_case("mmd") {
            return None;
        }
        let key = normalize_mermaid_key(content);
        self.mermaid_images.get(&key)
    }

    fn run(&self, markdown: &str) -> Result<Docx, String> {
        let parser = Parser::new_ext(markdown, pulldown_cmark::Options::all());
        let mut state = ParserState::new(&self.base_dir);

        for event in parser {
            state.handle(event)?;
        }
        state.finish();

        // Collect list numbering requirements.
        let mut list_kinds: HashMap<usize, ListKind> = HashMap::new();
        for block in &state.blocks {
            if let BlockItem::ListItem {
                numbering_id, kind, ..
            } = block
            {
                list_kinds.insert(*numbering_id, *kind);
            }
        }

        // Build document with styles and numberings.
        let mut docx = Docx::new();
        docx = self.add_heading_styles(docx);
        if !list_kinds.is_empty() {
            docx = docx.numberings(self.build_numberings(&list_kinds));
        }

        // Attach table captions: a paragraph immediately before a table that looks like
        // "表1：描述" / "Table 1: description" becomes the table's caption above it.
        let mut processed_blocks: Vec<BlockItem> = Vec::new();
        let mut table_counter = 0usize;
        for block in state.blocks {
            if let BlockItem::Table { rows, alignments } = block {
                if let Some(BlockItem::Paragraph(inlines, _)) = processed_blocks.last() {
                    let text = inlines_to_plain_text(inlines);
                    if let Some(desc) = extract_table_caption(&text) {
                        processed_blocks.pop();
                        table_counter += 1;
                        processed_blocks.push(BlockItem::TableCaption(table_counter, desc));
                        processed_blocks.push(BlockItem::Table { rows, alignments });
                        continue;
                    }
                }
                table_counter += 1;
                processed_blocks.push(BlockItem::TableCaption(table_counter, String::new()));
                processed_blocks.push(BlockItem::Table { rows, alignments });
                continue;
            }
            processed_blocks.push(block);
        }

        let mut mermaid_image_counter = 0usize;
        for block in processed_blocks {
            match block {
                BlockItem::Table { rows, alignments } => {
                    docx = docx.add_table(self.build_table(rows, alignments));
                }
                BlockItem::TableCaption(num, ref text) => {
                    docx =
                        docx.add_paragraph(self.build_caption_paragraph(num, text, "表", "Table"));
                }
                BlockItem::Caption(num, ref alt) => {
                    docx =
                        docx.add_paragraph(self.build_caption_paragraph(num, alt, "图", "Figure"));
                }
                BlockItem::CodeBlock(ref content, ref lang, _) => {
                    if let Some(img) = self.mermaid_image_for(content, lang) {
                        mermaid_image_counter += 1;
                        docx = docx.add_paragraph(
                            Paragraph::new().align(AlignmentType::Center).add_run(
                                Run::new().add_image(Pic::new_with_dimensions(
                                    img.bytes.clone(),
                                    img.width_px,
                                    img.height_px,
                                )),
                            ),
                        );
                        docx = docx.add_paragraph(self.build_caption_paragraph(
                            mermaid_image_counter,
                            "Mermaid diagram",
                            "图",
                            "Figure",
                        ));
                    } else {
                        docx = docx.add_paragraph(self.block_to_paragraph(block));
                    }
                }
                _ => docx = docx.add_paragraph(self.block_to_paragraph(block)),
            }
        }

        Ok(docx)
    }

    fn add_heading_styles(&self, mut docx: Docx) -> Docx {
        let sizes = [32usize, 28, 26, 24, 22, 20];
        for (i, size) in sizes.iter().enumerate() {
            let level = i + 1;
            let style = Style::new(format!("Heading{}", level), StyleType::Paragraph)
                .name(format!("heading {}", level))
                .based_on("Normal")
                .next("Normal")
                .outline_lvl(i)
                .bold()
                .size(*size);
            docx = docx.add_style(style);
        }
        // Add "Caption" style for image 题注 (Word built-in caption paragraph style).
        docx = docx.add_style(
            Style::new("Caption", StyleType::Paragraph)
                .name("caption")
                .based_on("Normal")
                .next("Normal"),
        );
        // Add "Hyperlink" character style so hyperlinks appear blue + underlined.
        docx = docx.add_style(
            Style::new("Hyperlink", StyleType::Character)
                .name("Hyperlink")
                .based_on("DefaultParagraphFont")
                .color("0563C1")
                .underline("single"),
        );
        docx
    }

    fn build_numberings(&self, list_kinds: &HashMap<usize, ListKind>) -> Numberings {
        let bullet_abstract_id = 0usize;
        let ordered_abstract_id = 2usize;

        let mut numberings = Numberings::new()
            .add_abstract_numbering(self.build_bullet_abstract(bullet_abstract_id))
            .add_abstract_numbering(self.build_ordered_abstract(ordered_abstract_id));

        for (&num_id, kind) in list_kinds {
            let abstract_id = match kind {
                ListKind::Bullet => bullet_abstract_id,
                ListKind::Ordered(_) => ordered_abstract_id,
            };
            numberings = numberings.add_numbering(Numbering::new(num_id, abstract_id));
        }

        numberings
    }

    fn build_bullet_abstract(&self, id: usize) -> AbstractNumbering {
        let bullets = ["\u{2022}", "\u{25E6}", "\u{25AA}", "\u{2022}", "\u{25E6}"];
        let mut abs = AbstractNumbering::new(id);
        for (level, bullet) in bullets.iter().enumerate() {
            abs = abs.add_level(
                Level::new(
                    level,
                    Start::new(1),
                    NumberFormat::new("bullet"),
                    LevelText::new(*bullet),
                    LevelJc::new("left"),
                )
                .indent(
                    Some(720 * (level as i32 + 1)),
                    Some(SpecialIndentType::Hanging(360)),
                    None,
                    None,
                ),
            );
        }
        abs
    }

    fn build_ordered_abstract(&self, id: usize) -> AbstractNumbering {
        let texts = ["%1.", "%2.", "%3.", "%4.", "%5."];
        let mut abs = AbstractNumbering::new(id);
        for (level, text) in texts.iter().enumerate() {
            abs = abs.add_level(
                Level::new(
                    level,
                    Start::new(1),
                    NumberFormat::new("decimal"),
                    LevelText::new(*text),
                    LevelJc::new("left"),
                )
                .indent(
                    Some(720 * (level as i32 + 1)),
                    Some(SpecialIndentType::Hanging(360)),
                    None,
                    None,
                ),
            );
        }
        abs
    }

    fn build_caption_paragraph(
        &self,
        num: usize,
        text: &str,
        prefix: &str,
        seq_name: &str,
    ) -> Paragraph {
        let mut para = Paragraph::new()
            .style("Caption")
            .align(AlignmentType::Center);
        // Prefix + SEQ auto-numbered field + "：" + text
        // SEQ field is included for Word to recalculate if user adds/removes captions.
        // We also write a sequential static number so it's correct on first open.
        para = para.add_run(Run::new().add_text(prefix));
        para = para.add_run(Run::new().add_field_char(FieldCharType::Begin, false));
        para = para.add_run(Run::new().add_instr_text(InstrText::Unsupported(format!(
            " SEQ {} \\* ARABIC ",
            seq_name
        ))));
        para = para.add_run(Run::new().add_field_char(FieldCharType::Separate, false));
        para = para.add_run(Run::new().add_text(num.to_string()));
        para = para.add_run(Run::new().add_field_char(FieldCharType::End, false));
        if !text.is_empty() {
            para = para.add_run(Run::new().add_text(format!("：{}", text)));
        }
        para
    }

    fn apply_quote_style(&self, mut para: Paragraph, depth: usize) -> Paragraph {
        if depth == 0 {
            return para;
        }
        let thickness: usize = match depth {
            1 => 24,
            2 => 48,
            _ => 72,
        };
        let color = match depth {
            1 => "808080",
            2 => "606060",
            _ => "404040",
        };
        let border = ParagraphBorder::new(ParagraphBorderPosition::Left)
            .color(color)
            .size(thickness)
            .space(8);
        para.property.borders = Some(ParagraphBorders::with_empty().set(border));
        let indent = (depth as i32) * 360;
        para.property = para.property.indent(Some(indent), None, None, None);
        para
    }

    fn build_table(
        &self,
        rows: Vec<Vec<Vec<InlineItem>>>,
        alignments: Vec<pulldown_cmark::Alignment>,
    ) -> Table {
        let alignments_ref = &alignments;
        let mut table_rows: Vec<TableRow> = Vec::with_capacity(rows.len());
        for row in rows {
            let mut cells: Vec<TableCell> = Vec::with_capacity(row.len());
            for (col_idx, cell_inlines) in row.into_iter().enumerate() {
                let mut para = Paragraph::new();
                para = self.add_inlines_to_para(para, cell_inlines);
                if let Some(align) = alignments_ref.get(col_idx) {
                    let align_type = match align {
                        pulldown_cmark::Alignment::Left => AlignmentType::Left,
                        pulldown_cmark::Alignment::Center => AlignmentType::Center,
                        pulldown_cmark::Alignment::Right => AlignmentType::Right,
                        pulldown_cmark::Alignment::None => AlignmentType::Left,
                    };
                    para = para.align(align_type);
                }
                cells.push(TableCell::new().add_paragraph(para));
            }
            table_rows.push(TableRow::new(cells));
        }
        Table::new(table_rows).width(5000, WidthType::Pct)
    }

    fn block_to_paragraph(&self, block: BlockItem) -> Paragraph {
        match block {
            BlockItem::Paragraph(inlines, quote) => {
                let mut para = Paragraph::new();
                para = self.add_inlines_to_para(para, inlines);
                self.apply_quote_style(para, quote.depth)
            }
            BlockItem::Heading(level, inlines) => {
                let style = format!("Heading{}", (level as u8).min(6));
                let mut para = Paragraph::new()
                    .style(&style)
                    .outline_lvl((level as usize).saturating_sub(1));
                para = self.add_inlines_to_para(para, inlines);
                para
            }
            BlockItem::CodeBlock(content, lang, quote) => {
                let para = self.code_block_to_paragraph(&content, &lang);
                self.apply_quote_style(para, quote.depth)
            }
            BlockItem::ListItem {
                level,
                numbering_id,
                items,
                quote,
                ..
            } => {
                let mut para = Paragraph::new()
                    .numbering(NumberingId::new(numbering_id), IndentLevel::new(level));
                para = self.add_inlines_to_para(para, items);
                self.apply_quote_style(para, quote.depth)
            }
            BlockItem::MathBlock { idx } => {
                Paragraph::new().add_run(Run::new().add_text(format!("%%MATH_{}%%", idx)))
            }
            BlockItem::ThematicBreak => {
                let mut para = Paragraph::new();
                para.property.borders = Some(
                    ParagraphBorders::with_empty()
                        .set(ParagraphBorder::new(ParagraphBorderPosition::Bottom).color("CCCCCC")),
                );
                para
            }
            BlockItem::Table { .. } | BlockItem::TableCaption(_, _) | BlockItem::Caption(_, _) => {
                // Tables and captions are handled directly by Converter::run.
                Paragraph::new()
            }
        }
    }

    fn code_block_to_paragraph(&self, content: &str, lang: &str) -> Paragraph {
        let content = content.trim_end_matches('\n');

        // Render pre-rendered Mermaid diagrams as images when available.
        if let Some(img) = self.mermaid_image_for(content, lang) {
            return Paragraph::new()
                .align(AlignmentType::Center)
                .add_run(Run::new().add_image(Pic::new_with_dimensions(
                    img.bytes.clone(),
                    img.width_px,
                    img.height_px,
                )));
        }

        let mut para = Paragraph::new();
        para.property.shading = Some(Shading::new().fill("F5F5F5"));
        para.property.borders = Some(
            ParagraphBorders::with_empty()
                .set(ParagraphBorder::new(ParagraphBorderPosition::Top).color("CCCCCC"))
                .set(ParagraphBorder::new(ParagraphBorderPosition::Left).color("CCCCCC"))
                .set(ParagraphBorder::new(ParagraphBorderPosition::Bottom).color("CCCCCC"))
                .set(ParagraphBorder::new(ParagraphBorderPosition::Right).color("CCCCCC")),
        );
        para.property.line_spacing = Some(
            LineSpacing::new()
                .line_rule(LineSpacingType::Exact)
                .line(280)
                .before(80)
                .after(80),
        );
        para.property.indent = Some(Indent::new(Some(160), None, Some(160), None));

        // Language label, if provided.
        let lang_trimmed = lang.trim();
        if !lang_trimmed.is_empty() {
            para = para.add_run(
                Run::new()
                    .fonts(RunFonts::new().ascii("Courier New"))
                    .bold()
                    .color("666666")
                    .size(18)
                    .add_text(lang_trimmed.to_string())
                    .add_break(BreakType::TextWrapping),
            );
        }

        let lines: Vec<&str> = content.split('\n').collect();
        for (i, line) in lines.iter().enumerate() {
            // Emit per-token runs with syntax coloring.
            for run in highlight_code(line, lang) {
                para = para.add_run(run);
            }
            if i + 1 < lines.len() {
                para = para.add_run(Run::new().add_break(BreakType::TextWrapping));
            }
        }
        para
    }

    fn add_inlines_to_para(&self, mut para: Paragraph, inlines: Vec<InlineItem>) -> Paragraph {
        for item in flatten_inlines(inlines) {
            match item {
                InlineItem::Link { url, children } => {
                    let mut link = Hyperlink::new(url, HyperlinkType::External);
                    for mut run in self.inlines_to_runs(children) {
                        // Apply the Hyperlink character style so text appears
                        // as blue, underlined and is clickable in Word.
                        run = run.style("Hyperlink");
                        link = link.add_run(run);
                    }
                    para = para.add_hyperlink(link);
                }
                other => {
                    for run in self.inline_to_runs(other) {
                        para = para.add_run(run);
                    }
                }
            }
        }
        para
    }

    fn inlines_to_runs(&self, inlines: Vec<InlineItem>) -> Vec<Run> {
        flatten_inlines(inlines)
            .into_iter()
            .flat_map(|item| self.inline_to_runs(item))
            .collect()
    }

    fn inline_to_runs(&self, item: InlineItem) -> Vec<Run> {
        match item {
            InlineItem::Text(text) => vec![Run::new().add_text(text)],
            InlineItem::Code(text) => vec![Run::new()
                .fonts(RunFonts::new().ascii("Courier New"))
                .shading(Shading::new().fill("EFEFEF"))
                .add_text(text)],
            InlineItem::Bold(children) => self
                .inlines_to_runs(children)
                .into_iter()
                .map(|mut run| {
                    run.run_property = run.run_property.bold();
                    run
                })
                .collect(),
            InlineItem::Italic(children) => self
                .inlines_to_runs(children)
                .into_iter()
                .map(|mut run| {
                    run.run_property = run.run_property.italic();
                    run
                })
                .collect(),
            InlineItem::Strikethrough(children) => self
                .inlines_to_runs(children)
                .into_iter()
                .map(|mut run| {
                    run.run_property = run.run_property.strike();
                    run
                })
                .collect(),
            InlineItem::Math { idx } => {
                vec![Run::new().add_text(format!("%%MATH_{}%%", idx))]
            }
            InlineItem::Image(pic, _alt) => vec![Run::new().add_image(pic)],
            InlineItem::HardBreak => vec![Run::new().add_break(BreakType::TextWrapping)],
            InlineItem::Link { .. } => {
                // Links are handled at paragraph level, not here.
                Vec::new()
            }
        }
    }
}

fn flatten_inlines(inlines: Vec<InlineItem>) -> Vec<InlineItem> {
    let mut result = Vec::new();
    for item in inlines {
        match item {
            InlineItem::Text(t) => {
                if let Some(InlineItem::Text(prev)) = result.last_mut() {
                    prev.push_str(&t);
                } else {
                    result.push(InlineItem::Text(t));
                }
            }
            other => result.push(other),
        }
    }
    result
}

/// Recursively extract plain text from inline items for caption detection.
fn inlines_to_plain_text(inlines: &[InlineItem]) -> String {
    let mut text = String::new();
    for item in inlines {
        match item {
            InlineItem::Text(t) | InlineItem::Code(t) => text.push_str(t),
            InlineItem::Bold(children)
            | InlineItem::Italic(children)
            | InlineItem::Strikethrough(children) => {
                text.push_str(&inlines_to_plain_text(children))
            }
            InlineItem::Link { children, .. } => text.push_str(&inlines_to_plain_text(children)),
            _ => {}
        }
    }
    text
}

/// Detect a table caption written as a preceding paragraph.
/// Matches "表1：描述" / "Table 1: description" and returns the description.
fn extract_table_caption(text: &str) -> Option<String> {
    static RE: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    let re = RE.get_or_init(|| Regex::new(r"^\s*(?:表|Table)\s*\d*\s*[:：]\s*(.*?)\s*$").unwrap());
    re.captures(text).map(|caps| caps[1].to_string())
}

// ============================================================================
// Markdown parser state
// ============================================================================

struct ParserState<'a> {
    base_dir: &'a Path,
    blocks: Vec<BlockItem>,
    block_stack: Vec<BlockBuilder>,
    inline_stack: Vec<InlineFrame>,
    list_stack: Vec<ListState>,
    pending_list_item: Option<ListItemAcc>,
    image_pending: Option<Pic>,
    last_image_alt: Option<String>,
    figure_counter: usize,
    blockquote_depth: usize,
    table_state: Option<TableState>,
    next_numbering_id: usize,
}

struct ListState {
    kind: ListKind,
    numbering_id: usize,
}

/// Accumulator for a list item's inline content.
/// Listed items' inline content is tracked here instead of on block_stack
/// so that Start/End(Paragraph) events inside a list item don't flush
/// the ListItem prematurely.
struct ListItemAcc {
    inlines: Vec<InlineItem>,
}

struct TableState {
    alignments: Vec<pulldown_cmark::Alignment>,
    rows: Vec<Vec<Vec<InlineItem>>>,
    current_row: Vec<Vec<InlineItem>>,
}

#[derive(Debug, Clone)]
enum BlockBuilder {
    Paragraph(Vec<InlineItem>),
    Heading(pulldown_cmark::HeadingLevel, Vec<InlineItem>),
    CodeBlock(String, String), // content, lang
}

#[derive(Debug, Clone)]
struct InlineFrame {
    kind: InlineFrameKind,
    text: String,
    items: Vec<InlineItem>,
}

#[derive(Debug, Clone)]
enum InlineFrameKind {
    Base,
    Bold,
    Italic,
    Strikethrough,
    Link(String),
}

#[derive(Debug, Clone)]
enum TextOrMath {
    Text(String),
    Math(usize),
}

impl<'a> ParserState<'a> {
    fn new(base_dir: &'a Path) -> Self {
        Self {
            base_dir,
            blocks: Vec::new(),
            block_stack: Vec::new(),
            inline_stack: vec![InlineFrame {
                kind: InlineFrameKind::Base,
                text: String::new(),
                items: Vec::new(),
            }],
            list_stack: Vec::new(),
            pending_list_item: None,
            image_pending: None,
            last_image_alt: None,
            figure_counter: 0,
            blockquote_depth: 0,
            table_state: None,
            next_numbering_id: 2,
        }
    }

    fn current_frame(&mut self) -> &mut InlineFrame {
        self.inline_stack
            .last_mut()
            .expect("inline_stack should never be empty")
    }

    fn flush_frame_text(frame: &mut InlineFrame) {
        if !frame.text.is_empty() {
            let text = std::mem::take(&mut frame.text);
            frame.items.push(InlineItem::Text(text));
        }
    }

    fn push_inline_item(&mut self, item: InlineItem) {
        Self::flush_frame_text(self.current_frame());
        self.current_frame().items.push(item);
    }

    fn enter_inline(&mut self, kind: InlineFrameKind) {
        Self::flush_frame_text(self.current_frame());
        self.inline_stack.push(InlineFrame {
            kind,
            text: String::new(),
            items: Vec::new(),
        });
    }

    fn leave_inline(&mut self) {
        if self.inline_stack.len() <= 1 {
            return;
        }
        Self::flush_frame_text(self.current_frame());
        let frame = self.inline_stack.pop().expect("inline_stack checked above");
        let item = match frame.kind {
            InlineFrameKind::Base => unreachable!(),
            InlineFrameKind::Bold => InlineItem::Bold(frame.items),
            InlineFrameKind::Italic => InlineItem::Italic(frame.items),
            InlineFrameKind::Strikethrough => InlineItem::Strikethrough(frame.items),
            InlineFrameKind::Link(url) => InlineItem::Link {
                url,
                children: frame.items,
            },
        };
        self.push_inline_item(item);
    }

    fn finish_inline_stack(&mut self) -> Vec<InlineItem> {
        while self.inline_stack.len() > 1 {
            self.leave_inline();
        }
        Self::flush_frame_text(self.current_frame());
        std::mem::take(&mut self.current_frame().items)
    }

    fn push_inlines_to_block(&mut self, items: Vec<InlineItem>) {
        if let Some(builder) = self.block_stack.last_mut() {
            match builder {
                BlockBuilder::Paragraph(inlines) | BlockBuilder::Heading(_, inlines) => {
                    inlines.extend(items);
                }
                BlockBuilder::CodeBlock(content, _) => {
                    for item in items {
                        if let InlineItem::Text(t) = item {
                            content.push_str(&t);
                        }
                    }
                }
            }
        }
    }

    fn flush_block(&mut self) {
        if let Some(builder) = self.block_stack.pop() {
            let block = match builder {
                BlockBuilder::Paragraph(inlines) => {
                    if let [InlineItem::Math { idx }] = inlines.as_slice() {
                        BlockItem::MathBlock { idx: *idx }
                    } else {
                        BlockItem::Paragraph(
                            inlines,
                            QuoteInfo {
                                depth: self.blockquote_depth,
                            },
                        )
                    }
                }
                BlockBuilder::Heading(level, inlines) => BlockItem::Heading(level, inlines),
                BlockBuilder::CodeBlock(content, lang) => BlockItem::CodeBlock(
                    content,
                    lang,
                    QuoteInfo {
                        depth: self.blockquote_depth,
                    },
                ),
            };
            self.blocks.push(block);
        }
    }

    fn handle(&mut self, event: Event) -> Result<(), String> {
        match event {
            Event::Start(tag) => self.start_tag(tag),
            Event::End(tag_end) => self.end_tag(tag_end),
            Event::Text(text) => {
                for piece in split_text_with_math(&text) {
                    match piece {
                        TextOrMath::Text(t) => self.current_frame().text.push_str(&t),
                        TextOrMath::Math(idx) => {
                            self.push_inline_item(InlineItem::Math { idx });
                        }
                    }
                }
            }
            Event::Code(code) => {
                self.push_inline_item(InlineItem::Code(code.to_string()));
            }
            Event::Html(_) | Event::InlineHtml(_) => {}
            Event::SoftBreak => {
                self.current_frame().text.push(' ');
            }
            Event::HardBreak => {
                self.push_inline_item(InlineItem::HardBreak);
            }
            Event::Rule => {
                self.flush_block();
                self.blocks.push(BlockItem::ThematicBreak);
            }
            Event::TaskListMarker(checked) => {
                self.current_frame()
                    .text
                    .push_str(if checked { "[x] " } else { "[ ] " });
            }
            Event::FootnoteReference(_) => {}
            Event::InlineMath(_) | Event::DisplayMath(_) => {
                // Math was already extracted by preprocess_math_skip_code_blocks.
            }
        }
        Ok(())
    }

    fn start_tag(&mut self, tag: Tag) {
        match tag {
            Tag::Paragraph => {
                // If inside a list item, paragraph content flows to the
                // pending_list_item accumulator — don't push a separate block.
                if self.pending_list_item.is_some() {
                    return;
                }
                self.flush_block();
                self.block_stack.push(BlockBuilder::Paragraph(Vec::new()));
            }
            Tag::Heading { level, .. } => {
                self.flush_block();
                self.block_stack
                    .push(BlockBuilder::Heading(level, Vec::new()));
            }
            Tag::BlockQuote(_) => {
                self.flush_block();
                self.blockquote_depth += 1;
                self.block_stack.push(BlockBuilder::Paragraph(Vec::new()));
            }
            Tag::CodeBlock(cb_kind) => {
                let lang = match cb_kind {
                    pulldown_cmark::CodeBlockKind::Indented => String::new(),
                    pulldown_cmark::CodeBlockKind::Fenced(lang) => lang.to_string(),
                };
                self.flush_block();
                self.block_stack
                    .push(BlockBuilder::CodeBlock(String::new(), lang));
            }
            Tag::List(kind) => {
                let list_kind = match kind {
                    None => ListKind::Bullet,
                    Some(start) => ListKind::Ordered(start),
                };
                let numbering_id = self.next_numbering_id;
                self.next_numbering_id += 1;
                self.list_stack.push(ListState {
                    kind: list_kind,
                    numbering_id,
                });
            }
            Tag::Item => {
                self.flush_block();
                // Flush any inline text that's still in the inline stack into
                // the pending_list_item BEFORE finalizing it.
                // pulldown-cmark does NOT emit Start/End(Paragraph) inside
                // list items, so inline text from the current item persists
                // in the inline stack until End(Item). When a nested list's
                // Start(Item) fires, we MUST flush the inline stack first,
                // otherwise the text gets orphaned from its list item.
                if self.pending_list_item.is_some() {
                    let inline_items = self.finish_inline_stack();
                    if let Some(ref mut acc) = self.pending_list_item {
                        acc.inlines.extend(inline_items);
                    }
                }
                // Finalize any pending list item from a parent list.
                // This handles nested lists: when an inner Start(Item) fires,
                // the outer item's inline content was accumulated in pending_list_item.
                if let Some(acc) = self.pending_list_item.take() {
                    let prev_level = self.list_stack.len().saturating_sub(2);
                    if let Some(state) = self.list_stack.get(prev_level) {
                        self.blocks.push(BlockItem::ListItem {
                            level: prev_level,
                            kind: state.kind,
                            numbering_id: state.numbering_id,
                            items: acc.inlines,
                            quote: QuoteInfo {
                                depth: self.blockquote_depth,
                            },
                        });
                    }
                }
                self.pending_list_item = Some(ListItemAcc {
                    inlines: Vec::new(),
                });
            }
            Tag::Table(alignments) => {
                self.flush_block();
                self.table_state = Some(TableState {
                    alignments: alignments.to_vec(),
                    rows: Vec::new(),
                    current_row: Vec::new(),
                });
            }
            Tag::TableHead => {}
            Tag::TableRow => {
                if let Some(ts) = &mut self.table_state {
                    ts.current_row = Vec::new();
                }
            }
            Tag::TableCell => {
                self.block_stack.push(BlockBuilder::Paragraph(Vec::new()));
            }
            Tag::Emphasis => self.enter_inline(InlineFrameKind::Italic),
            Tag::Strong => self.enter_inline(InlineFrameKind::Bold),
            Tag::Strikethrough => self.enter_inline(InlineFrameKind::Strikethrough),
            Tag::Link { dest_url, .. } => {
                self.enter_inline(InlineFrameKind::Link(dest_url.to_string()));
            }
            Tag::Image { dest_url, .. } => {
                // Don't push the image inline item yet — the alt text comes
                // in subsequent Text event(s) between Start(Image) and End(Image).
                let path = self.resolve_image_path(&dest_url);
                if let Ok(pic) = read_image(&path) {
                    self.image_pending = Some(pic);
                }
            }
            _ => {}
        }
    }

    fn end_tag(&mut self, tag: TagEnd) {
        match tag {
            TagEnd::Paragraph => {
                let items = self.finish_inline_stack();
                let had_image = self.last_image_alt.is_some();
                // If inside a list item, route content to the pending_item accumulator.
                if let Some(ref mut acc) = self.pending_list_item {
                    acc.inlines.extend(items);
                } else {
                    self.push_inlines_to_block(items);
                    self.flush_block();
                }
                // Add a Word-native caption (题注) with SEQ auto-numbering below the image.
                if had_image {
                    if self.pending_list_item.is_none() {
                        if let Some(alt) = self.last_image_alt.take() {
                            if !alt.is_empty() {
                                self.figure_counter += 1;
                                self.blocks
                                    .push(BlockItem::Caption(self.figure_counter, alt));
                            }
                        }
                    }
                } else {
                    self.last_image_alt = None;
                }
            }
            TagEnd::Heading(_) | TagEnd::CodeBlock => {
                let items = self.finish_inline_stack();
                self.push_inlines_to_block(items);
                self.flush_block();
            }
            TagEnd::BlockQuote(_) => {
                let items = self.finish_inline_stack();
                self.push_inlines_to_block(items);
                self.flush_block();
                self.blockquote_depth = self.blockquote_depth.saturating_sub(1);
            }
            TagEnd::Item => {
                let items = self.finish_inline_stack();
                if let Some(ref mut acc) = self.pending_list_item {
                    acc.inlines.extend(items);
                } else {
                    self.push_inlines_to_block(items);
                    self.flush_block();
                }
                // Finalize the list item accumulator.
                if let Some(acc) = self.pending_list_item.take() {
                    let level = self.list_stack.len().saturating_sub(1);
                    if let Some(state) = self.list_stack.last() {
                        self.blocks.push(BlockItem::ListItem {
                            level,
                            kind: state.kind,
                            numbering_id: state.numbering_id,
                            items: acc.inlines,
                            quote: QuoteInfo {
                                depth: self.blockquote_depth,
                            },
                        });
                    }
                }
            }
            TagEnd::List(_) => {
                self.list_stack.pop();
            }
            TagEnd::TableCell => {
                let items = self.finish_inline_stack();
                self.push_inlines_to_block(items);
                if let Some(BlockBuilder::Paragraph(inlines)) = self.block_stack.pop() {
                    if let Some(ts) = &mut self.table_state {
                        ts.current_row.push(inlines);
                    }
                }
            }
            TagEnd::TableRow => {
                if let Some(ts) = &mut self.table_state {
                    let row = std::mem::take(&mut ts.current_row);
                    ts.rows.push(row);
                }
            }
            TagEnd::TableHead => {
                if let Some(ts) = &mut self.table_state {
                    let row = std::mem::take(&mut ts.current_row);
                    if !row.is_empty() {
                        ts.rows.push(row);
                    }
                }
            }
            TagEnd::Table => {
                if let Some(ts) = self.table_state.take() {
                    self.blocks.push(BlockItem::Table {
                        rows: ts.rows,
                        alignments: ts.alignments,
                    });
                }
            }
            TagEnd::Emphasis | TagEnd::Strong | TagEnd::Strikethrough | TagEnd::Link => {
                self.leave_inline();
            }
            TagEnd::Image => {
                // Collect alt text from inline text events between Start/End Image.
                let alt = std::mem::take(&mut self.current_frame().text);
                if let Some(pic) = self.image_pending.take() {
                    self.last_image_alt = Some(alt.clone());
                    self.push_inline_item(InlineItem::Image(pic, alt));
                }
            }
            _ => {}
        }
    }

    fn resolve_image_path(&self, url: &str) -> String {
        if url.starts_with("http://") || url.starts_with("https://") {
            return url.to_string();
        }
        self.base_dir.join(url).to_string_lossy().to_string()
    }

    fn finish(&mut self) {
        self.flush_block();
    }
}

fn split_text_with_math(text: &str) -> Vec<TextOrMath> {
    static RE: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    let re = RE.get_or_init(|| Regex::new(r"%%MATH_(\d+)%%").unwrap());

    let mut result = Vec::new();
    let mut last_end = 0;
    for cap in re.captures_iter(text) {
        let m = cap.get(0).unwrap();
        if m.start() > last_end {
            result.push(TextOrMath::Text(text[last_end..m.start()].to_string()));
        }
        result.push(TextOrMath::Math(cap[1].parse().unwrap()));
        last_end = m.end();
    }
    if last_end < text.len() {
        result.push(TextOrMath::Text(text[last_end..].to_string()));
    }
    result
}

fn read_image(path: &str) -> Result<Pic, String> {
    let bytes = if path.starts_with("http://") || path.starts_with("https://") {
        fetch_image_bytes(path)?
    } else {
        std::fs::read(path).map_err(|e| format!("Cannot read image {}: {}", path, e))?
    };
    Ok(Pic::new(&bytes))
}

fn fetch_image_bytes(url: &str) -> Result<Vec<u8>, String> {
    let agent = ureq::AgentBuilder::new()
        .timeout_connect(std::time::Duration::from_secs(10))
        .timeout_read(std::time::Duration::from_secs(30))
        .build();
    let resp = agent
        .get(url)
        .call()
        .map_err(|e| format!("Failed to fetch image {}: {}", url, e))?;
    let mut bytes = Vec::new();
    resp.into_reader()
        .read_to_end(&mut bytes)
        .map_err(|e| format!("Failed to read image {}: {}", url, e))?;
    Ok(bytes)
}
