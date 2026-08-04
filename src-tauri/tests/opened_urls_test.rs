//! Tests for is_markdown_path pure function
//!
//! macOS file-association fix: Finder "Open With" / double-click delivers
//! the file via RunEvent::Opened (not argv). handle_opened_urls filters
//! incoming URLs through is_markdown_path before buffering/emitting.
//!
//! The filter is intentionally a pure function so the policy can be tested
//! without mocking the Tauri runtime. Keep this file in sync with lib.rs.

use std::path::Path;

/// True for .md / .markdown paths (case-insensitive).
fn is_markdown_path(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("md") || e.eq_ignore_ascii_case("markdown"))
        .unwrap_or(false)
}

#[test]
fn accepts_md_and_markdown() {
    assert!(is_markdown_path(Path::new("/tmp/notes.md")));
    assert!(is_markdown_path(Path::new("/tmp/notes.markdown")));
}

#[test]
fn accepts_uppercase_and_mixed_case_extensions() {
    // macOS Finder happily passes .MD / .Markdown from downloads.
    assert!(is_markdown_path(Path::new("/tmp/NOTES.MD")));
    assert!(is_markdown_path(Path::new("/tmp/Notes.Markdown")));
}

#[test]
fn rejects_non_markdown_files() {
    assert!(!is_markdown_path(Path::new("/tmp/image.png")));
    assert!(!is_markdown_path(Path::new("/tmp/doc.txt")));
    assert!(!is_markdown_path(Path::new("/tmp/archive.zip")));
}

#[test]
fn rejects_files_without_extension() {
    assert!(!is_markdown_path(Path::new("/tmp/README")));
    assert!(!is_markdown_path(Path::new("/tmp/.md")));
}

#[test]
fn extension_only_matters_not_filename() {
    // "md" appearing in the stem must not match.
    assert!(!is_markdown_path(Path::new("/tmp/md_notes.txt")));
    // Trailing ".md" as the real extension must match even with dots in stem.
    assert!(is_markdown_path(Path::new("/tmp/my.notes.v2.md")));
}
