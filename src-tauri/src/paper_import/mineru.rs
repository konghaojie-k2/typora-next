//! MinerU precise parsing API client.
//!
//! Endpoints (from https://mineru.net/apiManage/docs):
//! - URL submit:  POST /api/v4/extract/task
//! - File batch:  POST /api/v4/file-urls/batch  + PUT upload
//! - Poll task:   GET  /api/v4/extract/task/{task_id}
//! - Poll batch:  GET  /api/v4/extract-results/batch/{batch_id}

use std::path::{Path, PathBuf};
use std::time::Duration;

use serde_json::json;

use crate::AppConfig;

const DEFAULT_BASE_URL: &str = "https://mineru.net";
const DEFAULT_MODEL_VERSION: &str = "vlm";
const POLL_INTERVAL_SECS: u64 = 5;
const MAX_POLL_ATTEMPTS: u32 = 360; // 30 minutes

/// What to submit to minerU.
pub enum SubmitTarget {
    /// A remote file URL minerU should fetch.
    Url(String),
    /// A local file uploaded via the batch pre-signed URL flow.
    LocalFile { name: String, bytes: Vec<u8> },
}

/// Handle returned by `MineruClient::submit`.
pub struct TaskHandle {
    pub task_id: Option<String>,
    pub batch_id: Option<String>,
}

/// Result of a single poll call.
pub struct PollResult {
    pub state: String,
    pub full_zip_url: Option<String>,
    pub message: Option<String>,
}

/// MinerU precise parsing API client.
pub struct MineruClient {
    base_url: String,
    token: String,
    model_version: String,
}

impl MineruClient {
    /// Build a client from application config.
    pub fn from_config(config: &AppConfig) -> Result<Self, String> {
        let token = config
            .mineru_api_token
            .as_ref()
            .filter(|t| !t.is_empty())
            .ok_or("未设置 minerU API Token，请在设置中配置")?;

        let base_url = config
            .mineru_base_url
            .as_ref()
            .filter(|u| !u.is_empty())
            .map(|u| u.trim_end_matches('/').to_string())
            .unwrap_or_else(|| DEFAULT_BASE_URL.to_string());

        let model_version = config
            .mineru_model_version
            .as_ref()
            .filter(|m| !m.is_empty())
            .map(|m| m.to_string())
            .unwrap_or_else(|| DEFAULT_MODEL_VERSION.to_string());

        Ok(Self {
            base_url,
            token: token.to_string(),
            model_version,
        })
    }

    /// Create a test client directly (for integration tests).
    #[allow(dead_code)]
    pub fn new(base_url: String, token: String, model_version: String) -> Self {
        Self {
            base_url: base_url.trim_end_matches('/').to_string(),
            token,
            model_version,
        }
    }

    fn auth_header(&self) -> (&'static str, String) {
        ("Authorization", format!("Bearer {}", self.token))
    }

    /// Submit a URL or local file to minerU.
    pub fn submit(&self,
        target: SubmitTarget,
    ) -> Result<TaskHandle, String> {
        match target {
            SubmitTarget::Url(url) => self.submit_url(&url),
            SubmitTarget::LocalFile { name, bytes } => self.submit_local_file(&name, &bytes),
        }
    }

    fn submit_url(&self, url: &str) -> Result<TaskHandle, String> {
        let endpoint = format!("{}/api/v4/extract/task", self.base_url);
        let payload = json!({
            "url": url,
            "model_version": self.model_version,
        });

        let resp = ureq::post(&endpoint)
            .set("Content-Type", "application/json")
            .set(self.auth_header().0, &self.auth_header().1)
            .send_json(payload)
            .map_err(|e| format!("提交 minerU 任务失败: {}", e))?;

        let json: serde_json::Value = resp
            .into_json()
            .map_err(|e| format!("解析 minerU 响应失败: {}", e))?;

        self.parse_submit_response(&json)
    }

    fn submit_local_file(&self,
        name: &str,
        bytes: &[u8],
    ) -> Result<TaskHandle, String> {
        let endpoint = format!("{}/api/v4/file-urls/batch", self.base_url);
        let payload = json!({
            "files": [{ "name": name }],
            "model_version": self.model_version,
        });

        let resp = ureq::post(&endpoint)
            .set("Content-Type", "application/json")
            .set(self.auth_header().0, &self.auth_header().1)
            .send_json(payload)
            .map_err(|e| format!("申请 minerU 上传链接失败: {}", e))?;

        let json: serde_json::Value = resp
            .into_json()
            .map_err(|e| format!("解析 minerU 上传响应失败: {}", e))?;

        let batch_id = json
            .get("data")
            .and_then(|d| d.get("batch_id"))
            .and_then(|v| v.as_str())
            .ok_or("minerU 未返回 batch_id")?
            .to_string();

        let upload_url = json
            .get("data")
            .and_then(|d| d.get("file_urls"))
            .and_then(|v| v.as_array())
            .and_then(|arr| arr.first())
            .and_then(|v| v.as_str())
            .ok_or("minerU 未返回上传链接")?;

        let upload_resp = ureq::put(upload_url)
            .send_bytes(bytes)
            .map_err(|e| format!("上传 PDF 到 minerU 失败: {}", e))?;

        if upload_resp.status() != 200 {
            return Err(format!(
                "上传 PDF 失败，HTTP {}",
                upload_resp.status()
            ));
        }

        Ok(TaskHandle {
            task_id: None,
            batch_id: Some(batch_id),
        })
    }

    fn parse_submit_response(&self,
        json: &serde_json::Value,
    ) -> Result<TaskHandle, String> {
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

        Ok(TaskHandle { task_id, batch_id })
    }

    /// Poll once and return the current status.
    pub fn poll_status(&self,
        handle: &TaskHandle,
    ) -> Result<PollResult, String> {
        let endpoint = if let Some(task_id) = &handle.task_id {
            format!("{}/api/v4/extract/task/{}", self.base_url, task_id)
        } else if let Some(batch_id) = &handle.batch_id {
            format!(
                "{}/api/v4/extract-results/batch/{}",
                self.base_url, batch_id
            )
        } else {
            return Err("TaskHandle 缺少 task_id 和 batch_id".to_string());
        };

        let resp = ureq::get(&endpoint)
            .set(self.auth_header().0, &self.auth_header().1)
            .call()
            .map_err(|e| format!("查询 minerU 任务状态失败: {}", e))?;

        let json: serde_json::Value = resp
            .into_json()
            .map_err(|e| format!("解析 minerU 状态响应失败: {}", e))?;

        self.parse_poll_response(&json, handle.batch_id.is_some())
    }

    fn parse_poll_response(
        &self,
        json: &serde_json::Value,
        is_batch: bool,
    ) -> Result<PollResult, String> {
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

        Ok(PollResult {
            state,
            full_zip_url,
            message,
        })
    }

    /// Block and poll until the task reaches a terminal state.
    pub fn poll_until_done(
        &self,
        handle: &TaskHandle,
    ) -> Result<PollResult, String> {
        for attempt in 0..MAX_POLL_ATTEMPTS {
            let status = self.poll_status(handle)?;
            log::info!(
                "[minerU] poll attempt {}: state={}",
                attempt,
                status.state
            );

            match status.state.as_str() {
                "done" => return Ok(status),
                "failed" => {
                    return Err(format!(
                        "minerU 解析失败: {}",
                        status.message.unwrap_or_else(|| "未知原因".to_string())
                    ));
                }
                "pending" | "running" | "converting" | "uploading"
                | "waiting-file" => {
                    std::thread::sleep(Duration::from_secs(POLL_INTERVAL_SECS));
                }
                other => {
                    return Err(format!("minerU 返回未知状态: {}", other));
                }
            }
        }

        Err("minerU 解析超时，请稍后重试".to_string())
    }

    /// Download the result zip to `dest`.
    pub fn download_zip(
        &self,
        url: &str,
        dest: &Path,
    ) -> Result<(), String> {
        let resp = ureq::get(url)
            .call()
            .map_err(|e| format!("下载 minerU 结果失败: {}", e))?;

        let mut reader = resp.into_reader();
        let mut file = std::fs::File::create(dest)
            .map_err(|e| format!("创建临时 zip 文件失败: {}", e))?;

        std::io::copy(&mut reader, &mut file)
            .map_err(|e| format!("写入 zip 文件失败: {}", e))?;

        Ok(())
    }

    /// Extract the full minerU result archive to `extract_dir`, preserving the
    /// internal directory structure (including the `images/` folder referenced
    /// by `full.md`). Returns the path to the extracted `full.md`.
    pub fn extract_full_md(
        zip_path: &Path,
        extract_dir: &Path,
    ) -> Result<PathBuf, String> {
        std::fs::create_dir_all(extract_dir)
            .map_err(|e| format!("创建解压目录失败: {}", e))?;

        let file = std::fs::File::open(zip_path)
            .map_err(|e| format!("打开 zip 文件失败: {}", e))?;
        let mut archive = zip::ZipArchive::new(file)
            .map_err(|e| format!("读取 zip 文件失败: {}", e))?;

        let mut md_path: Option<PathBuf> = None;

        for i in 0..archive.len() {
            let mut entry = archive
                .by_index(i)
                .map_err(|e| format!("读取 zip 条目失败: {}", e))?;
            let name = entry.name().to_string();

            // Skip directory entries and macOS resource forks.
            if name.ends_with('/') || name.contains("__MACOSX") {
                continue;
            }

            let out_path = extract_dir.join(&name);
            if let Some(parent) = out_path.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| format!("创建解压子目录失败: {}", e))?;
            }

            let mut out_file = std::fs::File::create(&out_path)
                .map_err(|e| format!("创建解压文件失败: {}", e))?;
            std::io::copy(&mut entry, &mut out_file)
                .map_err(|e| format!("解压文件失败: {}", e))?;

            if name.ends_with("full.md") {
                md_path = Some(out_path);
            }
        }

        md_path.ok_or_else(|| "minerU 结果中未找到 full.md".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_done_task() -> serde_json::Value {
        json!({
            "code": 0,
            "data": {
                "task_id": "t1",
                "state": "done",
                "full_zip_url": "https://example.com/result.zip",
                "err_msg": ""
            },
            "msg": "ok"
        })
    }

    fn sample_running_task() -> serde_json::Value {
        json!({
            "code": 0,
            "data": {
                "task_id": "t1",
                "state": "running",
                "extract_progress": { "extracted_pages": 1, "total_pages": 10 }
            },
            "msg": "ok"
        })
    }

    fn sample_failed_task() -> serde_json::Value {
        json!({
            "code": 0,
            "data": {
                "task_id": "t1",
                "state": "failed",
                "err_msg": "页数超限"
            },
            "msg": "ok"
        })
    }

    fn sample_done_batch() -> serde_json::Value {
        json!({
            "code": 0,
            "data": {
                "batch_id": "b1",
                "extract_result": [
                    {
                        "file_name": "demo.pdf",
                        "state": "done",
                        "full_zip_url": "https://example.com/result.zip",
                        "err_msg": ""
                    }
                ]
            },
            "msg": "ok"
        })
    }

    #[test]
    fn test_parse_submit_url_response() {
        let client = MineruClient::new(
            "https://mineru.net".to_string(),
            "token".to_string(),
            "vlm".to_string(),
        );
        let resp = json!({
            "code": 0,
            "data": { "task_id": "t1" },
            "msg": "ok"
        });
        let handle = client.parse_submit_response(&resp).unwrap();
        assert_eq!(handle.task_id, Some("t1".to_string()));
        assert!(handle.batch_id.is_none());
    }

    #[test]
    fn test_parse_submit_error_response() {
        let client = MineruClient::new(
            "https://mineru.net".to_string(),
            "token".to_string(),
            "vlm".to_string(),
        );
        let resp = json!({
            "code": -500,
            "msg": "传参错误"
        });
        assert!(client.parse_submit_response(&resp).is_err());
    }

    #[test]
    fn test_parse_poll_task_done() {
        let client = MineruClient::new(
            "https://mineru.net".to_string(),
            "token".to_string(),
            "vlm".to_string(),
        );
        let result = client.parse_poll_response(&sample_done_task(), false).unwrap();
        assert_eq!(result.state, "done");
        assert_eq!(result.full_zip_url, Some("https://example.com/result.zip".to_string()));
    }

    #[test]
    fn test_parse_poll_task_running() {
        let client = MineruClient::new(
            "https://mineru.net".to_string(),
            "token".to_string(),
            "vlm".to_string(),
        );
        let result = client
            .parse_poll_response(&sample_running_task(), false)
            .unwrap();
        assert_eq!(result.state, "running");
        assert!(result.full_zip_url.is_none());
    }

    #[test]
    fn test_parse_poll_batch_done() {
        let client = MineruClient::new(
            "https://mineru.net".to_string(),
            "token".to_string(),
            "vlm".to_string(),
        );
        let result = client.parse_poll_response(&sample_done_batch(), true).unwrap();
        assert_eq!(result.state, "done");
        assert_eq!(result.full_zip_url, Some("https://example.com/result.zip".to_string()));
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

        // Create a minimal zip containing task/full.md and task/images/fig.jpg
        let zip_file = std::fs::File::create(&zip_path).unwrap();
        let mut zip = zip::ZipWriter::new(zip_file);
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);
        zip.start_file("t1/full.md", options).unwrap();
        zip.write_all(b"# Hello MinerU").unwrap();
        zip.start_file("t1/images/fig.jpg", options).unwrap();
        zip.write_all(b"fake-image").unwrap();
        zip.finish().unwrap();

        let md_path = MineruClient::extract_full_md(&zip_path, &extract_dir).unwrap();
        assert!(md_path.ends_with("t1/full.md"), "expected t1/full.md, got {:?}", md_path);
        let content = std::fs::read_to_string(&md_path).unwrap();
        assert_eq!(content, "# Hello MinerU");

        // Images should also be extracted, preserving directory structure.
        let image_path = extract_dir.join("t1/images/fig.jpg");
        assert!(image_path.exists(), "image should be extracted");

        let _ = std::fs::remove_dir_all(&tmp);
    }
}
