//! DOCX template application: ZIP-level post-processing that swaps in a
//! user-provided template's `word/styles.xml` and `word/numbering.xml`,
//! and remaps the generated document's style references to match the
//! template's actual styleIds.

use regex::Regex;
use std::collections::HashMap;
use std::io::{Cursor, Read, Write};
use std::path::Path;
use std::sync::OnceLock;
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

/// Max display width for a Mermaid/SVG diagram inside a Word document, in CSS
/// pixels. Matches `docx_export::MAX_IMAGE_WIDTH_PX` so the diagram fills the
/// page body without overflowing.
pub const DOCX_MERMAID_MAX_WIDTH_PX: u32 = 540;

/// Render an SVG diagram to a high-resolution PNG suitable for Word export.
///
/// The returned `MermaidImage` uses `DOCX_MERMAID_MAX_WIDTH_PX` as the target
/// display width (so small intrinsic SVG viewBoxes are scaled up to fill the
/// page) while the PNG itself is rendered at `RENDER_SCALE` × that size for
/// crisp output. Height is kept proportional to the SVG's intrinsic aspect
/// ratio.
pub fn render_svg_to_mermaid_image(svg: &str) -> Result<docx_export::MermaidImage, String> {
    const RENDER_SCALE: f32 = 3.0;

    let mut opts = usvg::Options::default();
    opts.fontdb = system_font_db();
    // Fallback font family when the SVG references an unavailable font.
    opts.font_family = "Arial".to_string();

    let tree = usvg::Tree::from_str(svg, &opts).map_err(|e| format!("SVG parse failed: {}", e))?;

    let original_width = tree.size().width();
    let original_height = tree.size().height();
    if original_width <= 0.0 || original_height <= 0.0 {
        return Err("SVG has zero size".to_string());
    }

    // Target display size in Word (CSS pixels).
    let display_width = DOCX_MERMAID_MAX_WIDTH_PX;
    let display_height =
        ((display_width as f32) * original_height / original_width).round() as u32;

    // High-resolution pixmap for crisp printing.
    let target_width = ((display_width as f32) * RENDER_SCALE).round() as u32;
    let target_height = ((display_height as f32) * RENDER_SCALE).round().max(1.0) as u32;

    let mut pixmap =
        tiny_skia::Pixmap::new(target_width, target_height).ok_or("Cannot create pixmap")?;
    // Render onto a transparent background so the image blends with the Word page
    // instead of carrying a white rectangle around the diagram.
    pixmap.fill(tiny_skia::Color::from_rgba8(0, 0, 0, 0));

    // Scale the tree so the diagram actually fills the high-res pixmap. An
    // identity transform draws at the SVG's intrinsic 1× size in the corner,
    // leaving the diagram occupying only 1/RENDER_SCALE of the image.
    let scale = target_width as f32 / original_width;
    let transform = tiny_skia::Transform::from_scale(scale, scale);
    resvg::render(&tree, transform, &mut pixmap.as_mut());

    let bytes = pixmap
        .encode_png()
        .map_err(|e| format!("PNG encode failed: {}", e))?;

    Ok(docx_export::MermaidImage {
        bytes,
        width_px: display_width,
        height_px: display_height,
    })
}

fn system_font_db() -> std::sync::Arc<fontdb::Database> {
    static DB: OnceLock<std::sync::Arc<fontdb::Database>> = OnceLock::new();
    DB.get_or_init(|| {
        let mut db = fontdb::Database::new();
        db.load_system_fonts();
        std::sync::Arc::new(db)
    })
    .clone()
}

/// docx-rs 生成的 styles.xml 基本是空的（Normal 无字体字号、docDefaults 空、
/// 标题只有加粗和字号），Word 会按 Calibri + 等线 + 单倍行距渲染，观感很差。
/// 这是一套内置的默认样式：导出未选择用户模板时自动套用，
/// 选中文字体（微软雅黑）、1.4 倍行距、带颜色和间距的标题层级。
/// styleId 与生成端一致（Normal/Heading1-6/Caption/Hyperlink），无需重写引用。
const DEFAULT_DOC_DEFAULTS: &str = r#"<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="微软雅黑" w:cs="Calibri" /><w:sz w:val="22" /><w:szCs w:val="22" /><w:lang w:val="en-US" w:eastAsia="zh-CN" /></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr /></w:pPrDefault></w:docDefaults>"#;

const DEFAULT_NORMAL_STYLE: &str = r#"<w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal" /><w:qFormat /><w:pPr><w:spacing w:before="0" w:after="120" w:line="336" w:lineRule="auto" /></w:pPr><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="微软雅黑" w:cs="Calibri" /><w:sz w:val="22" /><w:szCs w:val="22" /></w:rPr></w:style>"#;

const DEFAULT_CAPTION_STYLE: &str = r#"<w:style w:type="paragraph" w:styleId="Caption"><w:name w:val="caption" /><w:basedOn w:val="Normal" /><w:next w:val="Normal" /><w:qFormat /><w:pPr><w:jc w:val="center" /><w:spacing w:before="60" w:after="160" /></w:pPr><w:rPr><w:color w:val="595959" /><w:sz w:val="18" /><w:szCs w:val="18" /></w:rPr></w:style>"#;

const DEFAULT_HYPERLINK_STYLE: &str = r#"<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink" /><w:qFormat /><w:rPr><w:color w:val="0563C1" /><w:u w:val="single" /></w:rPr></w:style>"#;

/// Generate one heading style block. `sz` in half-points, `color` may be
/// empty (inherit text color).
fn heading_style_xml(level: u8, sz: u32, color: &str, before: u32, after: u32) -> String {
    let color_pr = if color.is_empty() {
        String::new()
    } else {
        format!(r#"<w:color w:val="{}" />"#, color)
    };
    // H1 加底部细线，其余层级仅靠颜色/字号区分
    let border_pr = if level == 1 {
        r#"<w:pBdr><w:bottom w:val="single" w:sz="4" w:space="2" w:color="1F4E79" /></w:pBdr>"#
    } else {
        ""
    };
    format!(
        r#"<w:style w:type="paragraph" w:styleId="Heading{level}"><w:name w:val="heading {level}" /><w:basedOn w:val="Normal" /><w:next w:val="Normal" /><w:qFormat /><w:pPr>{border}<w:keepNext /><w:spacing w:before="{before}" w:after="{after}" /><w:outlineLvl w:val="{outline}" /></w:pPr><w:rPr>{fonts}<w:b /><w:bCs />{color}<w:sz w:val="{sz}" /><w:szCs w:val="{sz}" /></w:rPr></w:style>"#,
        level = level,
        border = border_pr,
        before = before,
        after = after,
        outline = level as u32 - 1,
        fonts = r#"<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="微软雅黑" w:cs="Calibri" />"#,
        color = color_pr,
        sz = sz,
    )
}

/// All built-in default styles as (styleId, XML fragment) pairs.
fn default_style_fragments() -> Vec<(String, String)> {
    let frags: Vec<(String, String)> = vec![
        ("Normal".into(), DEFAULT_NORMAL_STYLE.into()),
        (
            "Heading1".into(),
            heading_style_xml(1, 36, "1F4E79", 360, 160),
        ),
        (
            "Heading2".into(),
            heading_style_xml(2, 32, "1F4E79", 320, 140),
        ),
        (
            "Heading3".into(),
            heading_style_xml(3, 28, "2E74B5", 280, 120),
        ),
        (
            "Heading4".into(),
            heading_style_xml(4, 26, "2E74B5", 240, 100),
        ),
        ("Heading5".into(), heading_style_xml(5, 24, "", 240, 100)),
        ("Heading6".into(), heading_style_xml(6, 22, "", 240, 100)),
        ("Caption".into(), DEFAULT_CAPTION_STYLE.into()),
        ("Hyperlink".into(), DEFAULT_HYPERLINK_STYLE.into()),
    ];
    frags
}

/// Replace-or-append each built-in style into the generated styles.xml.
/// Styles not covered here (e.g. the injected TOC1-5) are preserved as-is.
fn patch_default_styles(xml: &str) -> String {
    let mut out = xml.to_string();

    if let Ok(re) = Regex::new(r"(?s)<w:docDefaults>.*?</w:docDefaults>") {
        out = re.replace(&out, DEFAULT_DOC_DEFAULTS).into_owned();
    }

    for (style_id, fragment) in default_style_fragments() {
        let pattern = format!(
            r#"(?s)<w:style\b[^>]*w:styleId="{}"[^>]*>.*?</w:style>"#,
            regex::escape(&style_id)
        );
        let replaced = Regex::new(&pattern).ok().and_then(|re| {
            if re.is_match(&out) {
                Some(re.replace(&out, fragment.as_str()).into_owned())
            } else {
                None
            }
        });
        match replaced {
            Some(next) => out = next,
            None => {
                // 生成端没有这个样式 → 追加到根元素末尾
                if let Some(pos) = out.rfind("</w:styles>") {
                    out.insert_str(pos, &fragment);
                }
            }
        }
    }
    out
}

/// Apply the built-in default styling to a generated DOCX (used when the
/// user exports Word without choosing a template file). Only
/// `word/styles.xml` is patched; the document body is untouched.
pub fn apply_default_styling(docx_bytes: &[u8]) -> Result<Vec<u8>, String> {
    let mut src = ZipArchive::new(Cursor::new(docx_bytes))
        .map_err(|e| format!("无法读取生成的 DOCX: {}", e))?;
    let styles = read_zip_entry(&mut src, "word/styles.xml")?;
    let xml = std::str::from_utf8(&styles)
        .map_err(|_| "styles.xml 不是有效 UTF-8".to_string())?
        .to_string();
    let patched = patch_default_styles(&xml).into_bytes();

    let total = src.len();
    let mut entries: Vec<(String, Vec<u8>)> = Vec::with_capacity(total);
    for i in 0..total {
        let mut entry = src.by_index(i).map_err(|e| e.to_string())?;
        let name = entry.name().to_string();
        let mut data = Vec::new();
        entry
            .read_to_end(&mut data)
            .map_err(|e| format!("ZIP 读取 {} 失败: {}", name, e))?;
        if name == "word/styles.xml" {
            data = patched.clone();
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

/// Build a map of style **name** (normalized: lowercased, whitespace
/// stripped, e.g. "heading1") → template **styleId** (e.g. "3") from a
/// template styles.xml. Normalization is required because our generated
/// documents reference styleIds like "Heading1" while Word templates name
/// the same style "heading 1" (with a space) — lowercase alone won't match.
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
            // Normalize: lowercase + strip whitespace, so the template's
            // "heading 1" matches our generated styleId "Heading1" looked
            // up as "heading1".
            let key = name_cap[1].to_lowercase();
            let key: String = key.split_whitespace().collect();
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
        // Keys are normalized: lowercased, whitespace stripped.
        assert_eq!(map.get("heading1").map(String::as_str), Some("3"));
        assert_eq!(map.get("heading2").map(String::as_str), Some("4"));
    }

    #[test]
    fn rewrites_pStyle_references_to_template_ids() {
        let mut xml = String::from(
            r#"<w:p><w:pPr><w:pStyle w:val="Heading1"/><w:outlineLvl w:val="0"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="32"/></w:rPr><w:t>Hello</w:t></w:r></w:p>"#,
        );
        let mut map = HashMap::new();
        map.insert("heading1".to_string(), "3".to_string());
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
        let hello_pos = xml.find("Hello").unwrap();
        let heading_block = &xml[hello_pos.saturating_sub(200)..(hello_pos + 50).min(xml.len())];
        assert!(
            !heading_block.contains("<w:b/>"),
            "heading run should have <w:b/> stripped"
        );
        assert!(
            !heading_block.contains(r#"<w:sz w:val="32"/>"#),
            "heading run should have explicit size stripped"
        );

        // Normal paragraph run should be untouched.
        let body_pos = xml.find("Body").unwrap();
        let body_block = &xml[body_pos.saturating_sub(200)..(body_pos + 50).min(xml.len())];
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
