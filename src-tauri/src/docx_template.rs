//! DOCX template application: ZIP-level post-processing that swaps in a
//! user-provided template's `word/styles.xml` and `word/numbering.xml`,
//! and remaps the generated document's style references to match the
//! template's actual styleIds.

use regex::Regex;
use std::collections::HashMap;
use std::io::{Cursor, Read, Write};
use std::path::Path;
use zip::{ZipArchive, ZipWriter};

/// Apply a user-supplied template DOCX to a generated DOCX.
///
/// * `word/styles.xml` and `word/numbering.xml` are replaced from the template.
/// * The generated `word/document.xml` is rewritten so every paragraph/run/table
///   reference to a style name (Heading1, Caption, …) points at the template's
///   actual styleId for that style (often a numeric ID in Chinese Word exports).
/// * Direct font / size overrides on heading runs are stripped so the
///   template's heading style determines the visual weight.
pub fn apply_template(docx_bytes: &[u8], template_path: &Path) -> Result<Vec<u8>, String> {
    let mut src = ZipArchive::new(Cursor::new(docx_bytes))
        .map_err(|e| format!("无法读取生成的 DOCX: {}", e))?;
    let tmpl_file =
        std::fs::File::open(template_path).map_err(|e| format!("无法打开模板文件: {}", e))?;
    let mut tmpl = ZipArchive::new(tmpl_file).map_err(|e| format!("无法读取模板 DOCX: {}", e))?;

    let tmpl_styles = read_zip_entry(&mut tmpl, "word/styles.xml")?;
    let tmpl_numbering = read_zip_entry(&mut tmpl, "word/numbering.xml").ok();

    // Build a name → styleId map from the template's styles.xml so we can
    // rewrite `w:pStyle val="Heading1"` references in our generated
    // document.xml to whatever styleId the template uses for "heading 1"
    // (often a numeric ID like "3" in Chinese Word exports).
    let name_to_id = parse_template_style_names(&tmpl_styles);

    // Collect all entries from source DOCX first, replacing styles/numbering.
    let total = src.len();
    let mut entries: Vec<(String, Vec<u8>)> = Vec::with_capacity(total);
    for i in 0..total {
        let entry = src
            .by_index(i)
            .map_err(|e| format!("ZIP 读取错误: {}", e))?;
        let name = entry.name().to_string();
        drop(entry); // release the borrow on src

        let mut data = Vec::new();
        src.by_name(&name)
            .map_err(|e| format!("ZIP 读取 {} 失败: {}", name, e))?
            .read_to_end(&mut data)
            .map_err(|e| format!("ZIP 读取 {} 失败: {}", name, e))?;

        if name == "word/styles.xml" {
            data = tmpl_styles.clone();
        } else if name == "word/numbering.xml" {
            if let Some(ref n) = tmpl_numbering {
                data = n.clone();
            }
        } else if name == "word/document.xml" {
            if let Ok(mut xml) = std::str::from_utf8(&data).map(str::to_string) {
                rewrite_style_references(&mut xml, &name_to_id);
                data = xml.into_bytes();
            }
        }

        entries.push((name, data));
    }

    let mut out_buf = Cursor::new(Vec::new());
    {
        let mut out = ZipWriter::new(&mut out_buf);
        for (name, data) in &entries {
            let options =
                zip::write::SimpleFileOptions::default().compression_method(if data.len() > 0 {
                    zip::CompressionMethod::Deflated
                } else {
                    zip::CompressionMethod::Stored
                });
            out.start_file(name, options)
                .map_err(|e| format!("ZIP 写入 {} 失败: {}", name, e))?;
            out.write_all(data)
                .map_err(|e| format!("ZIP 写入 {} 失败: {}", name, e))?;
        }
        out.finish().map_err(|e| format!("ZIP 封包失败: {}", e))?;
    }

    Ok(out_buf.into_inner())
}

/// Build a map of style **name** (lowercased, e.g. "heading 1") → template
/// **styleId** (e.g. "3") from a template styles.xml.
fn parse_template_style_names(styles_xml: &[u8]) -> HashMap<String, String> {
    let mut map = HashMap::new();
    let s = match std::str::from_utf8(styles_xml) {
        Ok(s) => s,
        Err(_) => return map,
    };
    let re = Regex::new(r#"(?s)<w:style\s[^>]*w:styleId="([^"]+)"[^>]*>(.*?)</w:style>"#).unwrap();
    for cap in re.captures_iter(s) {
        let id = cap[1].to_string();
        let inner = &cap[2];
        let name_re = Regex::new(r#"<w:name\s+w:val="([^"]+)""#).unwrap();
        if let Some(name_cap) = name_re.captures(inner) {
            let key = name_cap[1].to_lowercase();
            map.entry(key).or_insert(id);
        }
    }
    map
}

/// Rewrite `w:pStyle val="X"` / `w:rStyle val="X"` / `w:tblStyle val="X"`
/// references in document.xml so they point at the template's styleId values.
/// Then strip direct run formatting from heading paragraphs.
fn rewrite_style_references(xml: &mut String, name_to_id: &HashMap<String, String>) {
    const OUR_STYLES: &[&str] = &[
        "Normal",
        "Heading1",
        "Heading2",
        "Heading3",
        "Heading4",
        "Heading5",
        "Heading6",
        "Caption",
        "Hyperlink",
        "TOC1",
        "TOC2",
        "TOC3",
        "TOC4",
        "TOC5",
    ];

    for style_name in OUR_STYLES {
        let template_id = match name_to_id.get(&style_name.to_lowercase()) {
            Some(id) => id,
            None => continue,
        };
        let pattern = format!(
            r#"(?P<attr>\b(?:p|r|tbl)Style\s+)w:val="(?P<val>{})""#,
            regex::escape(style_name)
        );
        let re = Regex::new(&pattern).unwrap();
        let mut replacement = String::with_capacity(template_id.len() + 24);
        replacement.push_str("${attr}w:val=\"");
        replacement.push_str(template_id);
        replacement.push('"');
        *xml = re.replace_all(xml, replacement.as_str()).into_owned();
    }

    *xml = strip_direct_formatting_from_headings(xml);
}

/// Remove `<w:b/>`, `<w:b w:val="1"/>` and `<w:sz w:val=".."/>` (size in half-points)
/// from runs that live inside paragraphs using a heading pStyle. This lets the
/// template's heading style determine the visual weight and size.
fn strip_direct_formatting_from_headings(xml: &str) -> String {
    static P_RE: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    let p_re = P_RE.get_or_init(|| Regex::new(r#"(?s)(<w:p\b[^>]*>)(.*?)(</w:p>)"#).unwrap());

    static HEADING_RE: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    let heading_re = HEADING_RE
        .get_or_init(|| Regex::new(r#"<w:pStyle\s+w:val="(?:Heading\d|[3-8])""#).unwrap());

    let run_re = Regex::new(r#"<w:rPr>(.*?)</w:rPr>"#).unwrap();
    let b_self = Regex::new(r#"<w:b\s*/>"#).unwrap();
    let b_val = Regex::new(r#"<w:b\s+w:val="(?:1|true)""\s*/>"#).unwrap();
    let sz_re = Regex::new(r#"<w:sz\s+w:val="\d+"\s*/>"#).unwrap();
    let szcs_re = Regex::new(r#"<w:szCs\s+w:val="\d+"\s*/>"#).unwrap();

    let mut result = String::with_capacity(xml.len());
    let mut last_end = 0;
    for cap in p_re.captures_iter(xml) {
        let m = cap.get(0).unwrap();
        let inner = &cap[2];
        if heading_re.is_match(inner) {
            let new_inner = run_re.replace_all(inner, |rcap: &regex::Captures| {
                let mut rpr = rcap[1].to_string();
                rpr = b_self.replace_all(&rpr, "").into_owned();
                rpr = b_val.replace_all(&rpr, "").into_owned();
                rpr = sz_re.replace_all(&rpr, "").into_owned();
                rpr = szcs_re.replace_all(&rpr, "").into_owned();
                if rpr.trim().is_empty() {
                    String::new()
                } else {
                    format!("<w:rPr>{}</w:rPr>", rpr)
                }
            });
            let new_inner = b_self.replace_all(&new_inner, "").into_owned();
            let new_inner = sz_re.replace_all(&new_inner, "").into_owned();

            result.push_str(&xml[last_end..m.start()]);
            result.push_str(&cap[1]);
            result.push_str(&new_inner);
            result.push_str(&cap[3]);
        } else {
            result.push_str(&xml[last_end..m.end()]);
        }
        last_end = m.end();
    }
    result.push_str(&xml[last_end..]);
    result
}

/// Read a named entry from a ZIP archive into a byte vector.
fn read_zip_entry<R: std::io::Read + std::io::Seek>(
    archive: &mut ZipArchive<R>,
    name: &str,
) -> Result<Vec<u8>, String> {
    let mut entry = archive
        .by_name(name)
        .map_err(|e| format!("ZIP 中找不到 '{}': {}", name, e))?;
    let mut buf = Vec::new();
    entry
        .read_to_end(&mut buf)
        .map_err(|e| format!("读取 '{}' 失败: {}", name, e))?;
    Ok(buf)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    /// Build a minimal "Word-style" template in memory with numeric styleIds
    /// matching Chinese Word output.
    fn build_template_docx_bytes() -> Vec<u8> {
        let styles = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:default="1" w:styleId="1">
    <w:name w:val="Normal"/>
    <w:rPr><w:sz w:val="24"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="3">
    <w:name w:val="heading 1"/>
    <w:rPr><w:b/><w:sz w:val="40"/><w:color w:val="1F4E79"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="4">
    <w:name w:val="heading 2"/>
    <w:rPr><w:b/><w:sz w:val="32"/><w:color w:val="2E74B5"/></w:rPr>
  </w:style>
  <w:style w:type="character" w:default="1" w:styleId="143">
    <w:name w:val="Default Paragraph Font"/>
  </w:style>
</w:styles>"#;

        let cursor = Cursor::new(Vec::new());
        let mut zip = ZipWriter::new(cursor);
        let opts = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);
        zip.start_file("word/styles.xml", opts).unwrap();
        zip.write_all(styles.as_bytes()).unwrap();
        // finish() returns the inner writer (our Cursor<Vec<u8>>); .into_inner() extracts the Vec.
        zip.finish().expect("zip finish").into_inner()
    }

    #[test]
    fn parses_template_style_names() {
        let template_bytes = build_template_docx_bytes();
        let mut tmpl = ZipArchive::new(Cursor::new(&template_bytes)).unwrap();
        let styles = read_zip_entry(&mut tmpl, "word/styles.xml").unwrap();
        let map = parse_template_style_names(&styles);

        assert_eq!(map.get("normal").map(String::as_str), Some("1"));
        assert_eq!(map.get("heading 1").map(String::as_str), Some("3"));
        assert_eq!(map.get("heading 2").map(String::as_str), Some("4"));
    }

    #[test]
    fn rewrites_pStyle_references_to_template_ids() {
        let mut xml = String::from(
            r#"<w:p><w:pPr><w:pStyle w:val="Heading1"/><w:outlineLvl w:val="0"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="32"/></w:rPr><w:t>Hello</w:t></w:r></w:p>"#,
        );
        let mut map = HashMap::new();
        map.insert("heading 1".to_string(), "3".to_string());
        rewrite_style_references(&mut xml, &map);

        assert!(
            xml.contains(r#"w:pStyle w:val="3""#),
            "Heading1 pStyle should be remapped to template id 3, got: {}",
            xml
        );
        assert!(
            !xml.contains(r#"w:pStyle w:val="Heading1""#),
            "original Heading1 reference must be gone"
        );
    }

    #[test]
    fn strips_heading_direct_formatting() {
        let mut xml = String::from(
            r#"<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="32"/><w:color w:val="FF0000"/></w:rPr><w:t>Hello</w:t></w:r></w:p><w:p><w:pPr><w:pStyle w:val="Normal"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="24"/></w:rPr><w:t>Body</w:t></w:r></w:p>"#,
        );
        let map = HashMap::new();
        rewrite_style_references(&mut xml, &map);

        // Heading run: b and sz stripped, color stays.
        let heading_block = &xml[xml.find("Hello").unwrap() - 200..xml.find("Hello").unwrap() + 50];
        assert!(
            !heading_block.contains("<w:b/>"),
            "heading run should have <w:b/> stripped"
        );
        assert!(
            !heading_block.contains(r#"<w:sz w:val="32"/>"#),
            "heading run should have explicit size stripped"
        );

        // Normal paragraph run should be untouched.
        let body_block = &xml[xml.find("Body").unwrap() - 200..xml.find("Body").unwrap() + 50];
        assert!(
            body_block.contains("<w:b/>"),
            "normal run should keep its <w:b/>"
        );
    }

    #[test]
    fn end_to_end_apply_template_remaps_styles() {
        // Use docx-export to generate a real DOCX with Heading1 references,
        // then apply our (in-memory) template.
        let md = "# Title One\n\n## Title Two\n\nBody paragraph.\n";
        let generated = docx_export::markdown_to_docx(md, std::path::Path::new(".")).unwrap();
        let template_bytes = build_template_docx_bytes();

        // Save template to a temp file (apply_template takes a path).
        let tmpl_path = std::env::temp_dir().join("typora_apply_template_test.docx");
        std::fs::write(&tmpl_path, &template_bytes).unwrap();

        let result = apply_template(&generated, &tmpl_path).unwrap();

        // Read back the resulting document.xml and check the heading
        // references now point at the template's numeric styleIds.
        let mut archive = ZipArchive::new(Cursor::new(&result)).unwrap();
        let mut doc_xml = String::new();
        Read::read_to_string(
            &mut archive.by_name("word/document.xml").unwrap(),
            &mut doc_xml,
        )
        .unwrap();

        assert!(
            doc_xml.contains(r#"w:pStyle w:val="3""#),
            "Heading1 should be remapped to template id 3"
        );
        assert!(
            doc_xml.contains(r#"w:pStyle w:val="4""#),
            "Heading2 should be remapped to template id 4"
        );
        assert!(
            !doc_xml.contains(r#"w:pStyle w:val="Heading1""#),
            "raw Heading1 reference must be gone after apply_template"
        );

        // The template's styles.xml must have been substituted in (size 40
        // comes from the template's heading 1 style).
        let mut styles_xml = String::new();
        Read::read_to_string(
            &mut archive.by_name("word/styles.xml").unwrap(),
            &mut styles_xml,
        )
        .unwrap();
        assert!(
            styles_xml.contains(r#"w:sz w:val="40""#),
            "template styles.xml must be substituted in"
        );

        let _ = std::fs::remove_file(&tmpl_path);
    }
}
