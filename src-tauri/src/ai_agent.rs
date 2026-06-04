use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::io::{BufRead, BufReader};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, State};

use crate::{get_config, AppConfig};

/// Agent message types emitted to frontend
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "data")]
pub enum AgentEvent {
    #[serde(rename = "outline")]
    Outline { outline: Value },
    #[serde(rename = "progress")]
    Progress {
        current: usize,
        total: usize,
        chapter_title: String,
        status: String,
    },
    #[serde(rename = "chapter_complete")]
    ChapterComplete {
        index: usize,
        file: String,
        title: String,
    },
    #[serde(rename = "chapter_failed")]
    ChapterFailed {
        index: usize,
        title: String,
        error: String,
    },
    #[serde(rename = "status")]
    Status { message: String },
    #[serde(rename = "complete")]
    Complete { total_generated: usize },
    #[serde(rename = "error")]
    Error { message: String },
}

/// Shared agent process handle - stores PID for external kill
#[derive(Default, Clone)]
pub struct AgentProcess {
    pid: Arc<Mutex<Option<u32>>>,
}

impl AgentProcess {
    pub fn set_pid(&self, pid: u32) {
        let mut guard = self.pid.lock().unwrap();
        *guard = Some(pid);
    }

    pub fn clear(&self) {
        let mut guard = self.pid.lock().unwrap();
        *guard = None;
    }

    pub fn kill(&self) {
        if let Some(pid) = *self.pid.lock().unwrap() {
            kill_process_by_pid(pid);
        }
        let mut guard = self.pid.lock().unwrap();
        *guard = None;
    }

    pub fn is_running(&self) -> bool {
        self.pid.lock().unwrap().is_some()
    }
}

/// Kill a process by PID (Windows only)
#[cfg(windows)]
fn kill_process_by_pid(pid: u32) {
    let mut cmd = std::process::Command::new("taskkill");
    cmd.args(["/F", "/PID", &pid.to_string()])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    cmd.creation_flags(CREATE_NO_WINDOW);
    let _ = cmd.status();
}

#[cfg(not(windows))]
fn kill_process_by_pid(_pid: u32) {
    // Unix kill not implemented for this prototype
}

/// Build the path to agent-bridge.js
fn get_agent_bridge_path() -> Result<std::path::PathBuf, String> {
    // Try multiple possible locations
    let possible_paths = [
        // exe 同目录
        std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|p| p.join("agent-bridge.js"))),
        // exe 父目录的父目录 (target/release/ -> target/)
        std::env::current_exe()
            .ok()
            .and_then(|p| {
                let parent = p.parent()?;
                let grandparent = parent.parent()?;
                Some(grandparent.join("agent-bridge.js"))
            }),
        // exe 父目录的父目录的父目录 (target/release/ -> src-tauri/)
        std::env::current_exe()
            .ok()
            .and_then(|p| {
                let parent = p.parent()?;
                let grandparent = parent.parent()?;
                let great_grandparent = grandparent.parent()?;
                Some(great_grandparent.join("agent-bridge.js"))
            }),
        // exe 父目录的父目录的父目录的父目录 (target/release/ -> worktree root)
        std::env::current_exe()
            .ok()
            .and_then(|p| {
                let parent = p.parent()?;
                let grandparent = parent.parent()?;
                let great_grandparent = grandparent.parent()?;
                let great_great_grandparent = great_grandparent.parent()?;
                Some(great_great_grandparent.join("agent-bridge.js"))
            }),
        // 当前工作目录
        Some(std::path::PathBuf::from("agent-bridge.js")),
        Some(std::path::PathBuf::from("../agent-bridge.js")),
    ];

    for path_opt in &possible_paths {
        if let Some(path) = path_opt {
            if path.exists() {
                return Ok(path.clone());
            }
        }
    }

    Err("agent-bridge.js not found. Please ensure it's in the same directory as the executable or project root.".to_string())
}

/// Spawn the agent bridge process and stream events to frontend
async fn run_agent_bridge(
    stage: &str,
    config: &AppConfig,
    args: Value,
    app_handle: AppHandle,
    agent_process: AgentProcess,
) -> Result<(), String> {
    eprintln!("[ai_agent] Starting agent bridge, stage={}", stage);
    let bridge_path = get_agent_bridge_path()?;
    eprintln!("[ai_agent] Agent bridge path: {:?}", bridge_path);

    // Build config JSON for agent bridge
    let config_json = serde_json::json!({
        "config": {
            "ai_provider": config.ai_provider.as_ref().map(|p| format!("{:?}", p).to_lowercase()).unwrap_or_else(|| "anthropic".to_string()),
            "ai_base_url": config.ai_base_url,
            "api_key": config.api_key,
            "model": config.model,
        },
        "args": args
    });

    let mut cmd = Command::new("node");
    cmd.arg("--no-warnings")
        .arg(&bridge_path)
        .arg(stage)
        .arg(config_json.to_string())
        .stdout(Stdio::piped())
        .env("NODE_NO_WARNINGS", "1");

    // Redirect stderr to a debug file
    let stderr_log = std::path::PathBuf::from(&bridge_path).parent().unwrap_or(std::path::Path::new(".")).join("agent-stderr.log");
    let stderr_file = std::fs::File::create(&stderr_log).map_err(|e| format!("Failed to create stderr log: {}", e))?;
    cmd.stderr(stderr_file);

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    eprintln!("[ai_agent] Spawning node process...");
    let mut child = cmd.spawn().map_err(|e| {
        eprintln!("[ai_agent] Failed to spawn agent bridge: {}", e);
        format!(
            "Failed to start agent bridge. Is Node.js installed? Error: {}",
            e
        )
    })?;

    // Store PID for potential kill
    agent_process.set_pid(child.id());

    let stdout = child.stdout.take().ok_or("Failed to capture stdout")?;

    // Stream JSON lines to frontend
    let debug_log = std::path::PathBuf::from(&bridge_path).parent().unwrap_or(std::path::Path::new(".")).join("rust-debug.log");
    let log_msg = |msg: &str| {
        if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&debug_log) {
            use std::io::Write;
            let _ = writeln!(f, "{}", msg);
        }
    };
    log_msg(&format!("[start] stage={} bridge_path={:?}", stage, bridge_path));

    // Read raw bytes from stdout instead of using BufReader::lines()
    use std::io::Read;
    let mut stdout = stdout;
    let mut stdout_bytes = Vec::new();
    let mut buf = [0u8; 4096];
    loop {
        match Read::read(&mut stdout, &mut buf) {
            Ok(0) => {
                log_msg("[read] EOF reached");
                break;
            }
            Ok(n) => {
                log_msg(&format!("[read-bytes] {} bytes", n));
                stdout_bytes.extend_from_slice(&buf[..n]);
            }
            Err(e) => {
                log_msg(&format!("[read-error] {}", e));
                break;
            }
        }
    }

    let stdout_str = String::from_utf8_lossy(&stdout_bytes);
    log_msg(&format!("[total] {} bytes, {} lines", stdout_bytes.len(), stdout_str.lines().count()));

    // Dump raw content to file for debugging
    let dump_path = std::path::PathBuf::from(&bridge_path).parent().unwrap_or(std::path::Path::new(".")).join("stdout-dump.txt");
    let _ = std::fs::write(&dump_path, &*stdout_str);

    for (i, line) in stdout_str.lines().enumerate() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        log_msg(&format!("[parse-line-{}] len={} preview={}", i, line.len(), &line[..std::cmp::min(100, line.len())]));

        // Parse as generic JSON to forward
        match serde_json::from_str::<Value>(&line) {
            Ok(event) => {
                let event_type = event.get("type").and_then(|v| v.as_str()).unwrap_or("unknown");
                log_msg(&format!("[emit] type={}", event_type));
                if let Err(e) = app_handle.emit("agent-event", &event) {
                    log_msg(&format!("[emit-error] {}", e));
                }
            }
            Err(e) => {
                log_msg(&format!("[parse-error] {} — raw: {}", e, &line[..std::cmp::min(100, line.len())]));
            }
        }
    }

    // Wait for process to finish
    log_msg("[wait] Waiting for process to finish...");
    let status = child.wait().map_err(|e| e.to_string())?;
    agent_process.clear();
    log_msg(&format!("[done] exit={:?}", status.code()));

    if !status.success() {
        return Err(format!("Agent bridge exited with code: {:?}", status.code()));
    }

    Ok(())
}

// ============================================
// Tauri Commands
// ============================================

/// Plan a learning course: generate outline from goal/level/hours
#[tauri::command]
pub async fn plan_course(
    goal: String,
    level: String,
    hours: u32,
    app_handle: AppHandle,
    agent_process: State<'_, AgentProcess>,
) -> Result<(), String> {
    eprintln!("[ai_agent] plan_course called: goal={}, level={}, hours={}", goal, level, hours);
    let config = get_config(app_handle.clone()).map_err(|e| e.to_string())?;
    eprintln!("[ai_agent] Config loaded, spawning agent bridge...");

    let args = serde_json::json!({
        "goal": goal,
        "level": level,
        "hours": hours
    });

    let process: AgentProcess = (*agent_process).clone();
    tauri::async_runtime::spawn(async move {
        match run_agent_bridge("plan", &config, args, app_handle.clone(), process).await {
            Ok(()) => {
                let _ = app_handle.emit(
                    "agent-event",
                    serde_json::json!({
                        "type": "status",
                        "data": { "message": "大纲生成完成" }
                    }),
                );
            }
            Err(e) => {
                let _ = app_handle.emit(
                    "agent-event",
                    serde_json::json!({
                        "type": "error",
                        "data": { "message": e }
                    }),
                );
            }
        }
    });

    Ok(())
}

/// Generate chapters from outline
#[tauri::command]
pub async fn generate_chapters(
    project_path: String,
    outline: Value,
    app_handle: AppHandle,
    agent_process: State<'_, AgentProcess>,
) -> Result<(), String> {
    let config = get_config(app_handle.clone()).map_err(|e| e.to_string())?;

    let args = serde_json::json!({
        "project_path": project_path,
        "outline": outline
    });

    let process: AgentProcess = (*agent_process).clone();
    tauri::async_runtime::spawn(async move {
        match run_agent_bridge("generate", &config, args, app_handle.clone(), process).await
        {
            Ok(()) => {
                let _ = app_handle.emit(
                    "agent-event",
                    serde_json::json!({
                        "type": "complete",
                        "data": { "message": "所有章节生成完成" }
                    }),
                );
            }
            Err(e) => {
                let _ = app_handle.emit(
                    "agent-event",
                    serde_json::json!({
                        "type": "error",
                        "data": { "message": e }
                    }),
                );
            }
        }
    });

    Ok(())
}

// ============================================
// Tests
// ============================================
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_agent_process_default() {
        let process = AgentProcess::default();
        assert!(!process.is_running());
    }

    #[test]
    fn test_agent_process_set_and_kill() {
        let process = AgentProcess::default();
        process.set_pid(12345);
        assert!(process.is_running());
        process.kill();
        assert!(!process.is_running());
    }

    #[test]
    fn test_agent_process_clear() {
        let process = AgentProcess::default();
        process.set_pid(99999);
        assert!(process.is_running());
        process.clear();
        assert!(!process.is_running());
    }

    #[test]
    fn test_extract_json_from_code_block() {
        let text = r#"Some text
```json
{"key": "value"}
```
More text"#;
        let result = extract_json(text);
        assert_eq!(result["key"], "value");
    }

    #[test]
    fn test_extract_json_raw() {
        let text = r#"Response: {"chapters": [{"title": "Test"}]}"#;
        let result = extract_json(text);
        assert_eq!(result["chapters"][0]["title"], "Test");
    }

    #[test]
    #[should_panic(expected = "No JSON found")]
    fn test_extract_json_no_json() {
        let text = "No JSON here";
        extract_json(text);
    }

    #[test]
    #[should_panic(expected = "Invalid JSON")]
    fn test_extract_json_malformed() {
        let text = "```json\n{invalid}\n```";
        extract_json(text);
    }

    #[test]
    fn test_generate_filename() {
        assert_eq!(generate_filename(0, "注意力机制"), "00-注意力机制.md");
        assert_eq!(generate_filename(5, "Self-Attention 详解！"), "05-Self-Attention-详解.md");
        assert_eq!(generate_filename(1, ""), "01-.md");
    }

    // Helper: extract JSON from text (mirrors agent-bridge logic)
    fn extract_json(text: &str) -> serde_json::Value {
        let code_block = text.split("```json").nth(1)
            .and_then(|s| s.split("```").next());
        if let Some(json_str) = code_block {
            return serde_json::from_str(json_str.trim()).expect("Valid JSON in code block");
        }
        let raw_json = text.split('{').nth(1)
            .map(|s| format!("{{{}}}", s));
        if let Some(json_str) = raw_json {
            return serde_json::from_str(&json_str).expect("Valid raw JSON");
        }
        panic!("No JSON found")
    }

    fn generate_filename(index: usize, title: &str) -> String {
        let safe = title
            .replace(|c: char| !c.is_alphanumeric() && !('\u{4e00}'..='\u{9fff}').contains(&c), "-")
            .replace("---", "-")
            .replace("--", "-")
            .trim_matches('-')
            .to_string();
        format!("{:02}-{}.md", index, safe)
    }
}

/// Abort the running agent process
#[tauri::command]
pub async fn abort_generation(agent_process: State<'_, AgentProcess>) -> Result<(), String> {
    agent_process.kill();
    Ok(())
}

/// Check if agent is currently running
#[tauri::command]
pub async fn is_agent_running(agent_process: State<'_, AgentProcess>) -> Result<bool, String> {
    Ok(agent_process.is_running())
}

// ============================================
// Sprint 3: Learning Elements, Quiz, Explanation
// ============================================

use std::collections::HashMap;

/// Quiz question generated by AI (Sprint 3 task 3.3)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuizQuestion {
    pub id: String,
    #[serde(rename = "qtype")]
    pub qtype: String,           // "single" | "multiple" | "short"
    pub question: String,
    pub options: Vec<QuizOption>,
    pub correct: Value,          // String for single, Vec<String> for multiple, null for short
    #[serde(default)]
    pub weak_concepts: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuizOption {
    pub label: String,
    pub text: String,
}

/// Quiz evaluation result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuizResult {
    pub rating: String,          // "mastered" | "learning" | "struggling"
    pub score: f32,
    pub weak_concepts: Vec<String>,
    pub suggestions: Vec<String>,
}

/// Read quiz questions from pre-generated .quiz.json (Sprint 3 refactored: no real-time AI)
#[tauri::command]
pub async fn generate_chapter_quiz(
    chapter_file: String,
    _agent_process: State<'_, AgentProcess>,
) -> Result<Vec<QuizQuestion>, String> {
    log::info!("[Sprint3] generate_chapter_quiz for: {}", chapter_file);

    // Infer quiz.json path: replace .md with .quiz.json
    // Normalize path separators for Windows
    let chapter_file_norm = chapter_file.replace('/', "\\");
    let quiz_path = if chapter_file_norm.ends_with(".md") {
        format!("{}.quiz.json", &chapter_file_norm[..chapter_file_norm.len() - 3])
    } else {
        format!("{}.quiz.json", chapter_file_norm)
    };
    log::info!("[Sprint3] reading quiz.json: {}", quiz_path);

    // Also log what files exist in the parent directory for debugging
    let parent = std::path::Path::new(&quiz_path).parent();
    if let Some(p) = parent {
        match std::fs::read_dir(p) {
            Ok(entries) => {
                let files: Vec<String> = entries.filter_map(|e| e.ok())
                    .map(|e| e.file_name().to_string_lossy().to_string())
                    .collect();
                log::info!("[Sprint3] files in dir {:?}: {:?}", p, files);
            }
            Err(e) => log::warn!("[Sprint3] cannot read dir {:?}: {}", p, e),
        }
    }

    let quiz_content = std::fs::read_to_string(&quiz_path)
        .map_err(|e| format!("找不到测验文件 '{}': {}。请先生成 quiz.json 或检查文件路径。", quiz_path, e))?;

    let quiz_json: serde_json::Value = serde_json::from_str(&quiz_content)
        .map_err(|e| format!("解析 quiz.json 失败: {}", e))?;

    let questions: Vec<QuizQuestion> = quiz_json["questions"]
        .as_array()
        .ok_or("quiz.json 缺少 questions 字段")?
        .iter()
        .map(|q| serde_json::from_value(q.clone()))
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("解析题目失败: {}", e))?;

    if questions.is_empty() || questions.len() > 5 {
        return Err(format!("Invalid question count: {} (expected 3-5)", questions.len()));
    }

    log::info!("[Sprint3] loaded {} questions from quiz.json", questions.len());
    Ok(questions)
}

/// Evaluate user answers using Agent SDK
#[tauri::command]
pub async fn evaluate_quiz(
    chapter: String,
    questions: Vec<QuizQuestion>,
    answers: HashMap<String, Value>,
    _agent_process: State<'_, AgentProcess>,
) -> Result<QuizResult, String> {
    log::info!("[Sprint3] evaluate_quiz for: {}", chapter);

    let bridge_path = get_agent_bridge_path()?;
    let payload = serde_json::json!({
        "chapter": chapter,
        "questions": questions,
        "answers": answers,
    });

    let mut cmd = std::process::Command::new("node");
    cmd.arg(&bridge_path)
        .arg("evaluate")
        .arg(payload.to_string())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let output = cmd.output()
        .map_err(|e| format!("Failed to spawn agent-bridge: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        // Sprint 3 decision: Agent failure → explicit error, no silent fallback
        return Err(format!("Agent evaluation failed: {}", stderr));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let result: QuizResult = serde_json::from_str(&stdout)
        .map_err(|e| format!("Failed to parse evaluation result: {}", e))?;

    // Validate rating
    match result.rating.as_str() {
        "mastered" | "learning" | "struggling" => {},
        _ => return Err(format!("Invalid rating: {}", result.rating))
    }

    Ok(result)
}

/// Explain selected text using Agent SDK (Sprint 3 task 3.5)
/// Decision: max 300 characters per explanation (生活化类比)
#[tauri::command]
pub async fn explain_selection(
    text: String,
    context: String,
    app_handle: AppHandle,
    _agent_process: State<'_, AgentProcess>,
) -> Result<String, String> {
    log::info!("[Sprint3] explain_selection START: text_len={}, context_len={}", text.len(), context.len());

    // Limit input size to prevent abuse
    let text = if text.len() > 200 {
        log::info!("[Sprint3] explain_selection: text truncated from {} to 200 chars", text.len());
        text.chars().take(200).collect()
    } else {
        text
    };

    let config = get_config(app_handle.clone()).map_err(|e| e.to_string())?;
    let bridge_path = get_agent_bridge_path()?;
    log::info!("[Sprint3] explain_selection: bridge_path={:?}", bridge_path);

    // Use nested { config, args } format consistent with plan/generate stages
    let payload = serde_json::json!({
        "config": {
            "ai_provider": config.ai_provider.as_ref().map(|p| format!("{:?}", p).to_lowercase()).unwrap_or_else(|| "anthropic".to_string()),
            "ai_base_url": config.ai_base_url,
            "api_key": config.api_key,
            "model": config.model,
        },
        "args": {
            "text": text,
            "context": context,
            "maxLength": 300,
        }
    });
    log::info!("[Sprint3] explain_selection: payload={}", payload);

    let mut cmd = std::process::Command::new("node");
    cmd.arg(&bridge_path)
        .arg("explain")
        .arg(payload.to_string())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    log::info!("[Sprint3] explain_selection: spawning node process...");
    let output = cmd.output()
        .map_err(|e| {
            log::error!("[Sprint3] explain_selection: spawn failed: {}", e);
            format!("Failed to spawn agent-bridge: {}", e)
        })?;

    log::info!("[Sprint3] explain_selection: exit_code={:?}, stdout_len={}, stderr_len={}",
        output.status.code(), output.stdout.len(), output.stderr.len());

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        log::error!("[Sprint3] explain_selection: agent failed: stderr={}", stderr);
        return Err(format!("Agent explanation failed: {}", stderr));
    }

    let explanation = String::from_utf8_lossy(&output.stdout).trim().to_string();
    log::info!("[Sprint3] explain_selection: explanation_len={}", explanation.len());

    if explanation.is_empty() {
        log::error!("[Sprint3] explain_selection: agent returned empty output");
        return Err("Agent returned empty explanation".to_string());
    }

    log::info!("[Sprint3] explain_selection SUCCESS");
    Ok(explanation)
}

/// Adapt subsequent chapters based on quiz result (Sprint 3 task 3.4)
/// Decision: struggling/learning → request add-on chapter; mastered → no-op
#[tauri::command]
pub async fn adapt_subsequent_chapters(
    project_path: String,
    chapter_index: usize,
    rating: String,
    weak_concepts: Vec<String>,
    _agent_process: State<'_, AgentProcess>,
) -> Result<Value, String> {
    log::info!("[Sprint3] adapt_subsequent: rating={}, weak={:?}", rating, weak_concepts);

    if rating == "mastered" {
        // No adaptation needed for mastered chapters
        return Ok(serde_json::json!({ "adapted": false, "reason": "mastered" }));
    }

    let bridge_path = get_agent_bridge_path()?;
    let payload = serde_json::json!({
        "projectPath": project_path,
        "chapterIndex": chapter_index,
        "rating": rating,
        "weakConcepts": weak_concepts,
    });

    let mut cmd = std::process::Command::new("node");
    cmd.arg(&bridge_path)
        .arg("adapt")
        .arg(payload.to_string())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let output = cmd.output()
        .map_err(|e| format!("Failed to spawn agent-bridge: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Agent adaptation failed: {}", stderr));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let result: Value = serde_json::from_str(&stdout)
        .map_err(|e| format!("Failed to parse adaptation result: {}", e))?;

    Ok(serde_json::json!({
        "adapted": true,
        "addedChapter": result,
        "rating": rating,
    }))
}
