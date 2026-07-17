//! Storage helpers for imported paper Markdown files.

use std::path::{Path, PathBuf};

/// Sanitize a string so it can be used as a file name.
///
/// - keeps CJK characters, ASCII alphanumerics, spaces, `-`, `_`
/// - replaces spaces with `-`
/// - removes other punctuation/symbols
/// - truncates to `max_len`
pub fn sanitize_filename(input: &str, max_len: usize) -> String {
    let mut result: Vec<char> = Vec::new();
    for ch in input.chars() {
        let cp = ch as u32;
        if ch.is_alphanumeric()
            || ch.is_whitespace()
            || ch == '-'
            || ch == '_'
            || (0x4e00..=0x9fff).contains(&cp)
            || (0x3040..=0x309f).contains(&cp)
            || (0x30a0..=0x30ff).contains(&cp)
            || (0xac00..=0xd7af).contains(&cp)
        {
            result.push(ch);
        }
    }

    let joined: String = result.into_iter().collect();
    let normalized = joined.split_whitespace().collect::<Vec<_>>().join("-");
    let normalized = normalized.replace("--", "-").replace("__", "_");

    if normalized.is_empty() {
        return "paper".to_string();
    }

    let mut out = normalized;
    if out.len() > max_len {
        // Try to cut at a character boundary.
        let mut cut = max_len;
        while cut > 0 && !out.is_char_boundary(cut) {
            cut -= 1;
        }
        if cut == 0 {
            cut = max_len;
        }
        out.truncate(cut);
        out = out.trim_end_matches('-').trim_end_matches('_').to_string();
    }

    if out.is_empty() {
        out = "paper".to_string();
    }

    out
}

/// Generate a stable file stem for the imported Markdown.
///
/// Priority:
/// 1. provided title hint
/// 2. source_name with extension stripped
pub fn generate_paper_filename(title_hint: Option<&str>, source_name: &str) -> String {
    let base = title_hint
        .filter(|t| !t.trim().is_empty())
        .map(|t| sanitize_filename(t.trim(), 80))
        .unwrap_or_else(|| {
            let without_ext = Path::new(source_name)
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or(source_name);
            sanitize_filename(without_ext, 80)
        });

    base
}

/// Find a non-conflicting file path inside `dir`.
///
/// If `{dir}/{stem}.md` exists, tries `{stem}-1.md`, `{stem}-2.md`...
pub fn unique_md_path(dir: &Path, stem: &str) -> PathBuf {
    let candidate = dir.join(format!("{}.md", stem));
    if !candidate.exists() {
        return candidate;
    }

    for n in 1..10000u32 {
        let candidate = dir.join(format!("{}-{}.md", stem, n));
        if !candidate.exists() {
            return candidate;
        }
    }

    // Fallback with timestamp to avoid collision.
    dir.join(format!(
        "{}-{}.md",
        stem,
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0)
    ))
}

/// Save imported Markdown content to disk.
///
/// Returns the absolute path written.
pub fn save_paper_md(
    base_dir: &Path,
    title_hint: Option<&str>,
    source_name: &str,
    content: &str,
) -> Result<PathBuf, String> {
    let now = chrono::Local::now();
    let month_dir = base_dir.join(now.format("%Y-%m").to_string());

    std::fs::create_dir_all(&month_dir).map_err(|e| format!("创建论文目录失败: {}", e))?;

    let stem = generate_paper_filename(title_hint, source_name);
    let target = unique_md_path(&month_dir, &stem);

    std::fs::write(&target, content).map_err(|e| format!("写入论文 Markdown 失败: {}", e))?;

    Ok(target)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sanitize_filename_simple() {
        assert_eq!(sanitize_filename("Hello World", 80), "Hello-World");
    }

    #[test]
    fn test_sanitize_filename_with_special_chars() {
        assert_eq!(
            sanitize_filename("Attention Is All You Need (NIPS 2017)!", 80),
            "Attention-Is-All-You-Need-NIPS-2017"
        );
    }

    #[test]
    fn test_sanitize_filename_cjk() {
        assert_eq!(
            sanitize_filename("深度学习 论文 标题？", 80),
            "深度学习-论文-标题"
        );
    }

    #[test]
    fn test_sanitize_filename_truncation() {
        assert_eq!(
            sanitize_filename("a very long title that should be cut somewhere", 20),
            "a-very-long-title-th"
        );
    }

    #[test]
    fn test_generate_paper_filename_title_priority() {
        assert_eq!(
            generate_paper_filename(Some("My Title"), "old.pdf"),
            "My-Title"
        );
    }

    #[test]
    fn test_generate_paper_filename_source_fallback() {
        assert_eq!(generate_paper_filename(None, "my-paper.pdf"), "my-paper");
    }

    #[test]
    fn test_unique_md_path_no_conflict() {
        let tmp = std::env::temp_dir().join(format!(
            "typora_test_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs()
        ));
        std::fs::create_dir_all(&tmp).unwrap();
        let path = unique_md_path(&tmp, "paper");
        assert_eq!(path, tmp.join("paper.md"));
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn test_unique_md_path_conflict() {
        let tmp = std::env::temp_dir().join(format!(
            "typora_test_conflict_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs()
        ));
        std::fs::create_dir_all(&tmp).unwrap();
        std::fs::write(tmp.join("paper.md"), "x").unwrap();
        let path = unique_md_path(&tmp, "paper");
        assert_eq!(path, tmp.join("paper-1.md"));
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn test_save_paper_md() {
        let tmp = std::env::temp_dir().join(format!(
            "typora_save_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs()
        ));
        let _ = std::fs::remove_dir_all(&tmp);

        let path = save_paper_md(&tmp, Some("Test Paper"), "source.pdf", "# Hello").unwrap();

        assert!(path.exists());
        let content = std::fs::read_to_string(&path).unwrap();
        assert_eq!(content, "# Hello");

        let _ = std::fs::remove_dir_all(&tmp);
    }
}
