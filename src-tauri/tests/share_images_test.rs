//! Integration tests for share_images (pure-std module, #[path] include —
//! linking the full app_lib pulls in WebView2 and the test exe fails to start
//! on some Windows environments).
//!
//! Covers the reference forms that silently dropped images from share ZIPs:
//! - ![alt](path "title")        — title must be stripped from the destination
//! - ![alt](<path with spaces>)  — angle-bracket destinations
//! - ![a](my%20pic.png)          — percent-encoded paths (Typora writes these)
//! - ![[img.png|300]]            — Obsidian size/alias suffix is not part of the path
//! - <img src="...">             — raw HTML image tags

#[path = "../src/share_images.rs"]
mod share_images;

use share_images::{extract_image_refs, is_remote, percent_decode, ImageRefKind};

fn targets(content: &str) -> Vec<String> {
    extract_image_refs(content)
        .into_iter()
        .map(|r| r.target)
        .collect()
}

#[test]
fn plain_markdown_image() {
    let refs = extract_image_refs("![alt](images/a.png)");
    assert_eq!(refs.len(), 1);
    assert_eq!(refs[0].target, "images/a.png");
    assert!(matches!(refs[0].kind, ImageRefKind::Markdown));
    assert_eq!(refs[0].original, "![alt](images/a.png)");
}

#[test]
fn markdown_image_with_double_quoted_title() {
    // Regression: the old regex captured `path "title"` as the path → exists() failed
    assert_eq!(
        targets(r#"![本地截图](../../PixPin.png "本地测试图片")"#),
        vec!["../../PixPin.png"]
    );
}

#[test]
fn markdown_image_with_single_quoted_title() {
    assert_eq!(targets("![a](img.png 'the title')"), vec!["img.png"]);
}

#[test]
fn markdown_image_with_paren_title() {
    assert_eq!(targets("![a](img.png (the title))"), vec!["img.png"]);
}

#[test]
fn markdown_image_angle_bracket_destination_with_spaces() {
    assert_eq!(targets("![a](<my pic.png>)"), vec!["my pic.png"]);
}

#[test]
fn markdown_image_percent_encoded_path() {
    let refs = extract_image_refs("![a](my%20pic.png)");
    assert_eq!(refs.len(), 1);
    assert_eq!(percent_decode(&refs[0].target), "my pic.png");
}

#[test]
fn wiki_image_plain() {
    let refs = extract_image_refs("![[assets/img.png]]");
    assert_eq!(refs.len(), 1);
    assert_eq!(refs[0].target, "assets/img.png");
    assert!(matches!(refs[0].kind, ImageRefKind::Wiki));
}

#[test]
fn wiki_image_with_size_suffix() {
    // Obsidian ![[img.png|300]] — the |300 is display size, not part of the path
    assert_eq!(targets("![[img.png|300]]"), vec!["img.png"]);
}

#[test]
fn wiki_image_with_alias() {
    assert_eq!(targets("![[img.png|some alias]]"), vec!["img.png"]);
}

#[test]
fn html_img_tag_double_quotes() {
    let refs = extract_image_refs(r#"<img src="pics/a.png" alt="x">"#);
    assert_eq!(refs.len(), 1);
    assert_eq!(refs[0].target, "pics/a.png");
    assert!(matches!(refs[0].kind, ImageRefKind::Html));
}

#[test]
fn html_img_tag_single_quotes() {
    assert_eq!(targets("<img src='pics/b.png'>"), vec!["pics/b.png"]);
}

#[test]
fn html_img_src_not_first_attribute() {
    assert_eq!(
        targets(r#"<img alt="x" src="pics/c.png" width="100">"#),
        vec!["pics/c.png"]
    );
}

#[test]
fn remote_targets_detected() {
    assert!(is_remote("https://example.com/a.png"));
    assert!(is_remote("http://example.com/a.png"));
    assert!(is_remote("data:image/png;base64,AAAA"));
    assert!(!is_remote("images/a.png"));
    assert!(!is_remote("../a.png"));
}

#[test]
fn percent_decode_utf8() {
    assert_eq!(percent_decode("%E4%B8%AD%E6%96%87.png"), "中文.png");
    assert_eq!(percent_decode("plain.png"), "plain.png");
}

#[test]
fn mixed_content_extracts_all_kinds() {
    let content = r#"
# Title
![one](a.png "title")
![[b.png|300]]
<img src="c.png">
![remote](https://example.com/d.png)
"#;
    let refs = extract_image_refs(content);
    assert_eq!(refs.len(), 4);
    assert_eq!(refs[0].target, "a.png");
    assert_eq!(refs[1].target, "b.png");
    assert_eq!(refs[2].target, "c.png");
    assert_eq!(refs[3].target, "https://example.com/d.png");
}

#[test]
fn no_images_returns_empty() {
    assert!(extract_image_refs("# just a heading\nsome text").is_empty());
}

#[test]
fn chinese_text_around_images_does_not_panic() {
    // Regression: the scanner indexed content[i..] by BYTE, so a multibyte
    // UTF-8 char (Chinese) before an image panicked with
    // "byte index is not a char boundary" → share_document died silently.
    let content = "# 中文标题\n\n这是一段中文正文。\n\n![截图](images/a.png \"标题\")\n\n更多中文。\n\n![[b.png|300]]\n\n<img src=\"c.png\">\n\n结尾。";
    let refs = extract_image_refs(content);
    assert_eq!(refs.len(), 3);
    assert_eq!(refs[0].target, "images/a.png");
    assert_eq!(refs[1].target, "b.png");
    assert_eq!(refs[2].target, "c.png");
}

// ============================================
// Path normalization + share-relative paths
// ============================================
//
// Regression (2026-08-03, user report "ZIP 包没有图片"):
// doc at `<root>/<sub>/doc.md` referencing `../assets/img.png` resolved to
// `<root>/<sub>/../assets/img.png` — compute_share_relative_path stripped
// the `<root>/<sub>` prefix STRING, leaving `../assets/img.png` as the
// "relative" dest path. temp_dir.join("../assets/...") ESCAPED the temp
// dir, so WalkDir(temp_dir) never saw the images → ZIP had no images.

use share_images::{normalize_path, share_relative_path};
use std::path::{Path, PathBuf};

#[test]
fn normalize_resolves_parent_components() {
    let p = PathBuf::from("D:/notes/gongsun/../assets/gongsun-illustrations/01.png");
    assert_eq!(
        normalize_path(&p),
        PathBuf::from("D:/notes/assets/gongsun-illustrations/01.png")
    );
}

#[test]
fn normalize_resolves_dot_components() {
    let p = PathBuf::from("D:/notes/./assets/./01.png");
    assert_eq!(normalize_path(&p), PathBuf::from("D:/notes/assets/01.png"));
}

#[test]
fn normalize_keeps_relative_leading_parent() {
    // Can't pop above the start of a relative path — keep the ..
    let p = PathBuf::from("../assets/01.png");
    assert_eq!(normalize_path(&p), PathBuf::from("../assets/01.png"));
}

#[test]
fn share_relative_path_user_scenario_with_base_dir() {
    // User's real layout: doc in a subdir, images in sibling assets/,
    // base_dir = workspace root → rel should be assets/... (no ..)
    let source = normalize_path(&PathBuf::from(
        "D:/notes/gongsun/../assets/gongsun-illustrations/01-watching-disciple.png",
    ));
    let rel = share_relative_path(&source, "D:/notes", "D:/notes/gongsun");
    assert_eq!(rel, "assets/gongsun-illustrations/01-watching-disciple.png");
    assert!(!rel.starts_with(".."), "rel must never escape the temp dir");
}

#[test]
fn share_relative_path_user_scenario_single_file() {
    // Single-file open (base_dir = md_dir): image outside that subtree →
    // fall back to the bare file name, NEVER a ../ escape
    let source = normalize_path(&PathBuf::from(
        "D:/notes/gongsun/../assets/gongsun-illustrations/01-watching-disciple.png",
    ));
    let rel = share_relative_path(&source, "D:/notes/gongsun", "D:/notes/gongsun");
    assert_eq!(rel, "01-watching-disciple.png");
    assert!(!rel.starts_with(".."), "rel must never escape the temp dir");
}

#[test]
fn share_relative_path_inside_md_dir() {
    let source = PathBuf::from("D:/notes/gongsun/images/a.png");
    let rel = share_relative_path(&source, "D:/notes", "D:/notes/gongsun");
    assert_eq!(rel, "gongsun/images/a.png");
}

#[test]
fn normalized_source_actually_exists_on_disk() {
    // End-to-end sanity: create the user's layout in a real temp dir and
    // verify join+normalize finds the file (exists() on a path with ..
    // works, but the REL path must not)
    let root = std::env::temp_dir().join(format!("share-img-test-{}", std::process::id()));
    let sub = root.join("gongsun");
    let assets = root.join("assets").join("gongsun-illustrations");
    std::fs::create_dir_all(&sub).unwrap();
    std::fs::create_dir_all(&assets).unwrap();
    std::fs::write(assets.join("01-watching-disciple.png"), b"png").unwrap();

    let joined = sub.join("../assets/gongsun-illustrations/01-watching-disciple.png");
    let source = normalize_path(&joined);
    assert!(source.exists(), "normalized source should exist");

    let rel = share_relative_path(&source, &root.to_string_lossy(), &sub.to_string_lossy());
    assert_eq!(rel, "assets/gongsun-illustrations/01-watching-disciple.png");

    std::fs::remove_dir_all(&root).unwrap();
}

#[test]
fn path_with_forward_slashes_on_windows() {
    let p = Path::new("D:/notes/a/../../b/c.png");
    assert_eq!(normalize_path(p), PathBuf::from("D:/b/c.png"));
}
