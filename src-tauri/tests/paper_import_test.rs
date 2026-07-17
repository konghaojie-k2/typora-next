//! Paper import tests — mirror pure logic from src/paper_import/*.
//!
//! These tests avoid linking app_lib directly because Windows cdylib
//! integration tests hit STATUS_ENTRYPOINT_NOT_FOUND issues.

use regex::Regex;
use serde_json::json;
use std::path::{Path, PathBuf};

// ============================================
// Copied from src/paper_import/arxiv.rs
// ============================================

fn normalize_paper_url(url: &str) -> Result<String, String> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return Err("URL 不能为空".to_string());
    }

    let abs_re =
        Regex::new(r"https?://arxiv\.org/abs/(\d+\.\d+(?:v\d+)?)").map_err(|e| e.to_string())?;
    if let Some(caps) = abs_re.captures(trimmed) {
        let id = caps.get(1).map(|m| m.as_str()).unwrap_or("");
        return Ok(format!("https://arxiv.org/pdf/{}.pdf", id));
    }

    let pdf_re =
        Regex::new(r"https?://arxiv\.org/pdf/(\d+\.\d+(?:v\d+)?)").map_err(|e| e.to_string())?;
    if let Some(caps) = pdf_re.captures(trimmed) {
        let id = caps.get(1).map(|m| m.as_str()).unwrap_or("");
        return Ok(format!("https://arxiv.org/pdf/{}.pdf", id));
    }

    if trimmed.to_lowercase().ends_with(".pdf") {
        return Ok(trimmed.to_string());
    }

    Err("目前仅支持 arXiv 页面或直接 PDF 链接，请先下载 PDF 后再导入".to_string())
}

fn source_name_from_url(url: &str) -> String {
    let trimmed = url.trim();
    let re = Regex::new(r"arxiv\.org/(?:abs|pdf)/(\d+\.\d+(?:v\d+)?)").ok();
    if let Some(caps) = re.as_ref().and_then(|r| r.captures(trimmed)) {
        if let Some(id) = caps.get(1) {
            return format!("arxiv-{}", id.as_str());
        }
    }
    trimmed
        .split('/')
        .next_back()
        .unwrap_or("paper")
        .split('?')
        .next()
        .unwrap_or("paper")
        .to_string()
}

// ============================================
// Copied from src/paper_import/storage.rs
// ============================================

fn sanitize_filename(input: &str, max_len: usize) -> String {
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

fn generate_paper_filename(title_hint: Option<&str>, source_name: &str) -> String {
    title_hint
        .filter(|t| !t.trim().is_empty())
        .map(|t| sanitize_filename(t.trim(), 80))
        .unwrap_or_else(|| {
            let without_ext = Path::new(source_name)
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or(source_name);
            sanitize_filename(without_ext, 80)
        })
}

fn unique_md_path(dir: &Path, stem: &str) -> PathBuf {
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
    dir.join(format!(
        "{}-{}.md",
        stem,
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0)
    ))
}

// ============================================
// MinerU response parsing (mirrored logic)
// ============================================

struct MineruClient;

impl MineruClient {
    fn parse_submit_response(json: &serde_json::Value) -> Result<(String, Option<String>), String> {
        let code = json.get("code").and_then(|v| v.as_i64()).unwrap_or(-1);
        if code != 0 {
            let msg = json
                .get("msg")
                .and_then(|v| v.as_str())
                .unwrap_or("未知错误");
            return Err(format!("minerU 提交失败 ({}): {}", code, msg));
        }

        let task_id = json
            .get("data")
            .and_then(|d| d.get("task_id"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let batch_id = json
            .get("data")
            .and_then(|d| d.get("batch_id"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        if task_id.is_none() && batch_id.is_none() {
            return Err("minerU 响应中缺少 task_id / batch_id".to_string());
        }

        Ok((task_id.unwrap_or_default(), batch_id))
    }

    fn parse_poll_response(
        json: &serde_json::Value,
        is_batch: bool,
    ) -> Result<(String, Option<String>, Option<String>), String> {
        let code = json.get("code").and_then(|v| v.as_i64()).unwrap_or(-1);
        if code != 0 {
            let msg = json
                .get("msg")
                .and_then(|v| v.as_str())
                .unwrap_or("未知错误");
            return Err(format!("minerU 查询失败 ({}): {}", code, msg));
        }

        let data = json.get("data").ok_or("minerU 响应缺少 data")?;

        let (state, full_zip_url, message) = if is_batch {
            let result = data
                .get("extract_result")
                .and_then(|v| v.as_array())
                .and_then(|arr| arr.first())
                .ok_or("minerU 批量响应缺少 extract_result")?;
            (
                result
                    .get("state")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                result
                    .get("full_zip_url")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string()),
                result
                    .get("err_msg")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string()),
            )
        } else {
            (
                data.get("state")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                data.get("full_zip_url")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string()),
                data.get("err_msg")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string()),
            )
        };

        Ok((state, full_zip_url, message))
    }

    fn extract_full_md(zip_path: &Path, extract_dir: &Path) -> Result<PathBuf, String> {
        std::fs::create_dir_all(extract_dir).map_err(|e| format!("创建解压目录失败: {}", e))?;

        let file =
            std::fs::File::open(zip_path).map_err(|e| format!("打开 zip 文件失败: {}", e))?;
        let mut archive =
            zip::ZipArchive::new(file).map_err(|e| format!("读取 zip 文件失败: {}", e))?;

        for i in 0..archive.len() {
            let mut entry = archive
                .by_index(i)
                .map_err(|e| format!("读取 zip 条目失败: {}", e))?;
            let name = entry.name();
            if name.ends_with("full.md") {
                let out_path = extract_dir.join(name.split('/').next_back().unwrap_or("full.md"));
                let mut out_file = std::fs::File::create(&out_path)
                    .map_err(|e| format!("创建解压文件失败: {}", e))?;
                std::io::copy(&mut entry, &mut out_file)
                    .map_err(|e| format!("解压文件失败: {}", e))?;
                return Ok(out_path);
            }
        }

        Err("minerU 结果中未找到 full.md".to_string())
    }
}

// ============================================
// Tests
// ============================================

#[test]
fn test_normalize_arxiv_abs_to_pdf() {
    assert_eq!(
        normalize_paper_url("https://arxiv.org/abs/2401.12345").unwrap(),
        "https://arxiv.org/pdf/2401.12345.pdf"
    );
}

#[test]
fn test_normalize_arxiv_with_version() {
    assert_eq!(
        normalize_paper_url("https://arxiv.org/abs/2401.12345v2").unwrap(),
        "https://arxiv.org/pdf/2401.12345v2.pdf"
    );
}

#[test]
fn test_normalize_direct_pdf_unchanged() {
    assert_eq!(
        normalize_paper_url("https://example.com/paper.pdf").unwrap(),
        "https://example.com/paper.pdf"
    );
}

#[test]
fn test_normalize_unsupported_url() {
    assert!(normalize_paper_url("https://example.com/paper").is_err());
}

#[test]
fn test_source_name_from_arxiv() {
    assert_eq!(
        source_name_from_url("https://arxiv.org/abs/2401.12345"),
        "arxiv-2401.12345"
    );
}

#[test]
fn test_sanitize_filename_simple() {
    assert_eq!(sanitize_filename("Hello World", 80), "Hello-World");
}

#[test]
fn test_sanitize_filename_special_chars() {
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
    assert_eq!(unique_md_path(&tmp, "paper"), tmp.join("paper-1.md"));
    let _ = std::fs::remove_dir_all(&tmp);
}

#[test]
fn test_parse_submit_url_response() {
    let resp = json!({
        "code": 0,
        "data": { "task_id": "t1" },
        "msg": "ok"
    });
    let (task_id, batch_id) = MineruClient::parse_submit_response(&resp).unwrap();
    assert_eq!(task_id, "t1");
    assert!(batch_id.is_none());
}

#[test]
fn test_parse_submit_batch_response() {
    let resp = json!({
        "code": 0,
        "data": { "batch_id": "b1", "file_urls": ["https://upload"] },
        "msg": "ok"
    });
    let (task_id, batch_id) = MineruClient::parse_submit_response(&resp).unwrap();
    assert!(task_id.is_empty());
    assert_eq!(batch_id, Some("b1".to_string()));
}

#[test]
fn test_parse_submit_error_response() {
    let resp = json!({ "code": -500, "msg": "传参错误" });
    assert!(MineruClient::parse_submit_response(&resp).is_err());
}

#[test]
fn test_parse_poll_task_done() {
    let resp = json!({
        "code": 0,
        "data": { "task_id": "t1", "state": "done", "full_zip_url": "https://z.zip", "err_msg": "" },
        "msg": "ok"
    });
    let (state, url, msg) = MineruClient::parse_poll_response(&resp, false).unwrap();
    assert_eq!(state, "done");
    assert_eq!(url, Some("https://z.zip".to_string()));
    assert_eq!(msg, Some("".to_string()));
}

#[test]
fn test_parse_poll_batch_done() {
    let resp = json!({
        "code": 0,
        "data": {
            "batch_id": "b1",
            "extract_result": [
                { "file_name": "demo.pdf", "state": "done", "full_zip_url": "https://z.zip", "err_msg": "" }
            ]
        },
        "msg": "ok"
    });
    let (state, url, msg) = MineruClient::parse_poll_response(&resp, true).unwrap();
    assert_eq!(state, "done");
    assert_eq!(url, Some("https://z.zip".to_string()));
    assert_eq!(msg, Some("".to_string()));
}

#[test]
fn test_parse_poll_failed() {
    let resp = json!({
        "code": 0,
        "data": { "task_id": "t1", "state": "failed", "err_msg": "页数超限" },
        "msg": "ok"
    });
    let (state, _url, msg) = MineruClient::parse_poll_response(&resp, false).unwrap();
    assert_eq!(state, "failed");
    assert_eq!(msg, Some("页数超限".to_string()));
}

#[test]
fn test_extract_full_md_from_zip() {
    use std::io::Write;

    let tmp = std::env::temp_dir().join(format!(
        "typora_mineru_zip_{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs()
    ));
    std::fs::create_dir_all(&tmp).unwrap();

    let zip_path = tmp.join("result.zip");
    let extract_dir = tmp.join("extracted");

    let zip_file = std::fs::File::create(&zip_path).unwrap();
    let mut zip = zip::ZipWriter::new(zip_file);
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    zip.start_file("t1/full.md", options).unwrap();
    zip.write_all(b"# Hello MinerU").unwrap();
    zip.finish().unwrap();

    let md_path = MineruClient::extract_full_md(&zip_path, &extract_dir).unwrap();
    let content = std::fs::read_to_string(&md_path).unwrap();
    assert_eq!(content, "# Hello MinerU");

    let _ = std::fs::remove_dir_all(&tmp);
}
