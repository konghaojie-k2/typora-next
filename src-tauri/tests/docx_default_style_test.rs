//! Integration tests for the built-in default Word export styling.
//!
//! Pure logic lives in src/docx_template.rs — included via `#[path]` because
//! app_lib-linked test exes fail to start on some machines
//! (STATUS_ENTRYPOINT_NOT_FOUND).
//!
//! Run with: cargo test --test docx_default_style_test

#[path = "../src/docx_template.rs"]
mod docx_template;

use docx_template::apply_default_styling;
use std::io::{Cursor, Write};
use zip::{ZipArchive, ZipWriter};

/// Build a fake "generated" DOCX mimicking docx-rs output: empty docDefaults,
/// empty Normal, a bare Heading1 (crate default), a TOC1 style (must survive),
/// and no Caption style (must be appended).
fn build_generated_docx_bytes() -> Vec<u8> {
    let styles = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults><w:rPrDefault><w:rPr /></w:rPrDefault></w:docDefaults>
  <w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal" /><w:rPr /><w:pPr><w:rPr /></w:pPr><w:qFormat /></w:style>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1" /><w:rPr><w:b /><w:sz w:val="32" /></w:rPr><w:qFormat /></w:style>
  <w:style w:type="paragraph" w:styleId="TOC1"><w:name w:val="toc 1" /><w:rPr><w:b /><w:sz w:val="24" /></w:rPr></w:style>
</w:styles>"#;

    let document = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body><w:p><w:pPr><w:pStyle w:val="Heading1" /></w:pPr><w:r><w:t>标题</w:t></w:r></w:p></w:body>
</w:document>"#;

    let cursor = Cursor::new(Vec::new());
    let mut zip = ZipWriter::new(cursor);
    let opts = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    zip.start_file("word/styles.xml", opts).unwrap();
    zip.write_all(styles.as_bytes()).unwrap();
    zip.start_file("word/document.xml", opts).unwrap();
    zip.write_all(document.as_bytes()).unwrap();
    zip.finish().expect("zip finish").into_inner()
}

/// Extract the `<w:style … w:styleId="ID">…</w:style>` block from styles.xml.
fn extract_style_block<'a>(xml: &'a str, style_id: &str) -> Option<&'a str> {
    let anchor = format!(r#"w:styleId="{}""#, style_id);
    let anchor_pos = xml.find(&anchor)?;
    let start = xml[..anchor_pos].rfind("<w:style ")?;
    let end = xml[start..].find("</w:style>")? + start + "</w:style>".len();
    Some(&xml[start..end])
}

fn read_styles_xml(docx_bytes: &[u8]) -> String {
    let mut archive = ZipArchive::new(Cursor::new(docx_bytes)).unwrap();
    let mut entry = archive.by_name("word/styles.xml").unwrap();
    let mut buf = String::new();
    std::io::Read::read_to_string(&mut entry, &mut buf).unwrap();
    buf
}

// ---------- 样式替换 ----------

#[test]
fn normal_style_gets_cjk_font_and_spacing() {
    let out = apply_default_styling(&build_generated_docx_bytes()).unwrap();
    let xml = read_styles_xml(&out);
    let block = extract_style_block(&xml, "Normal").expect("Normal 样式必须存在");
    assert!(block.contains("微软雅黑"), "Normal 应带中文字体: {}", block);
    assert!(
        block.contains(r#"<w:sz w:val="22""#),
        "正文 11pt: {}",
        block
    );
    assert!(
        block.contains(r#"w:line="336""#),
        "正文应带 1.4 倍行距: {}",
        block
    );
}

#[test]
fn heading1_style_replaced_with_designed_look() {
    let out = apply_default_styling(&build_generated_docx_bytes()).unwrap();
    let xml = read_styles_xml(&out);
    let block = extract_style_block(&xml, "Heading1").expect("Heading1 样式必须存在");
    assert!(block.contains(r#"<w:sz w:val="36""#), "H1 18pt: {}", block);
    assert!(
        block.contains(r#"<w:color w:val=""#),
        "H1 应带主题色: {}",
        block
    );
    assert!(block.contains("keepNext"), "标题应与后文同页: {}", block);
}

#[test]
fn all_six_heading_levels_present() {
    let out = apply_default_styling(&build_generated_docx_bytes()).unwrap();
    let xml = read_styles_xml(&out);
    for level in 1..=6 {
        let id = format!("Heading{}", level);
        assert!(extract_style_block(&xml, &id).is_some(), "{} 必须存在", id);
    }
    // 层级递减：H1 字号 > H3 字号
    let h1 = extract_style_block(&xml, "Heading1").unwrap();
    let h3 = extract_style_block(&xml, "Heading3").unwrap();
    assert!(
        h1.contains(r#"w:val="36""#) && h3.contains(r#"w:val="28""#),
        "H1 18pt / H3 14pt"
    );
}

// ---------- 不破坏生成端已有内容 ----------

#[test]
fn toc_styles_preserved() {
    let out = apply_default_styling(&build_generated_docx_bytes()).unwrap();
    let xml = read_styles_xml(&out);
    let toc1 = extract_style_block(&xml, "TOC1").expect("TOC1 必须保留（目录样式来自注入）");
    assert!(
        toc1.contains(r#"w:val="24""#),
        "TOC1 原有格式不变: {}",
        toc1
    );
}

#[test]
fn missing_style_appended() {
    let out = apply_default_styling(&build_generated_docx_bytes()).unwrap();
    let xml = read_styles_xml(&out);
    assert!(
        extract_style_block(&xml, "Caption").is_some(),
        "生成端缺 Caption 时必须追加"
    );
    assert!(
        extract_style_block(&xml, "Hyperlink").is_some(),
        "生成端缺 Hyperlink 时必须追加"
    );
}

#[test]
fn doc_defaults_get_cjk_font() {
    let out = apply_default_styling(&build_generated_docx_bytes()).unwrap();
    let xml = read_styles_xml(&out);
    let start = xml.find("<w:docDefaults>").expect("docDefaults 必须存在");
    let end = xml[start..].find("</w:docDefaults>").unwrap() + start;
    let dd = &xml[start..end];
    assert!(dd.contains("微软雅黑"), "docDefaults 应带中文字体: {}", dd);
}

#[test]
fn document_xml_untouched() {
    let src = build_generated_docx_bytes();
    let out = apply_default_styling(&src).unwrap();
    let read_doc = |bytes: &[u8]| -> String {
        let mut archive = ZipArchive::new(Cursor::new(bytes)).unwrap();
        let mut entry = archive.by_name("word/document.xml").unwrap();
        let mut buf = String::new();
        std::io::Read::read_to_string(&mut entry, &mut buf).unwrap();
        buf
    };
    assert_eq!(read_doc(&src), read_doc(&out), "document.xml 不应被改动");
}

// ---------- 错误处理 ----------

#[test]
fn non_zip_input_errors() {
    assert!(apply_default_styling(b"not a zip").is_err());
}

#[test]
fn styles_xml_missing_errors() {
    let cursor = Cursor::new(Vec::new());
    let mut zip = ZipWriter::new(cursor);
    let opts = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    zip.start_file("word/document.xml", opts).unwrap();
    zip.write_all(b"<w:document/>").unwrap();
    let bytes = zip.finish().expect("zip finish").into_inner();
    assert!(
        apply_default_styling(&bytes).is_err(),
        "缺 styles.xml 应报错"
    );
}
