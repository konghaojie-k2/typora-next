//! Tests for translation label cleanup.
//!
//! Regression: `translate_text` sends segments labeled `段落 N:` and the model
//! echoes those labels into its translations ("段落 1: 1. 引言"), which then
//! render verbatim in the preview. The prompt forbids echoing; this strip is
//! the defensive second layer and also repairs entries already poisoned in
//! `translation_cache.json`.
//!
//! The module is `#[path]`-included rather than imported via `app_lib`:
//! linking app_lib pulls in Tauri/WebView2 and the test exe fails to start
//! in some Windows environments.

#[path = "../src/translation_clean.rs"]
mod translation_clean;

use translation_clean::strip_translation_label;

#[test]
fn strips_halfwidth_colon_label() {
    assert_eq!(strip_translation_label("段落 1: 1. 引言"), "1. 引言");
}

#[test]
fn strips_fullwidth_colon_label() {
    assert_eq!(
        strip_translation_label("段落 2：本体论彻底改变了信息科学"),
        "本体论彻底改变了信息科学"
    );
}

#[test]
fn strips_label_followed_by_newline() {
    // Model echoes the input layout: label on its own line.
    assert_eq!(
        strip_translation_label("段落 3:\n本文旨在理解信息科学中的本体论"),
        "本文旨在理解信息科学中的本体论"
    );
}

#[test]
fn strips_no_space_between_keyword_and_number() {
    assert_eq!(strip_translation_label("段落4: 译文"), "译文");
}

#[test]
fn strips_english_paragraph_label() {
    assert_eq!(
        strip_translation_label("Paragraph 2: Ontology has revolutionized information science"),
        "Ontology has revolutionized information science"
    );
}

#[test]
fn leaves_unlabeled_translation_untouched() {
    let body = "本体论彻底改变了信息科学，我们必须感谢所有帮助发展这一领域的哲学家。";
    assert_eq!(strip_translation_label(body), body);
}

#[test]
fn leaves_mention_without_number_untouched() {
    // "段落" alone (no number+colon) is real content, not an echoed label.
    let body = "段落之间的衔接需要更自然。";
    assert_eq!(strip_translation_label(body), body);
}

#[test]
fn leaves_number_without_colon_untouched() {
    let body = "段落 3 是全文的核心。";
    assert_eq!(strip_translation_label(body), body);
}
