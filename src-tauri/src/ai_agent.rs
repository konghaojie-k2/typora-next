use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::process::{Command, Stdio};
use tauri::Manager;
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

/// Resolve the directory where agent-bridge.js should write its logs.
/// On MSI install → app_log_dir() (e.g. AppData\Local\<id>\logs).
/// On dev / cargo run → falls back to the script's parent dir.
/// agent-bridge.js reads TYPORA_NEXT_LOG_DIR from this.
fn _agent_log_dir(app_handle: &AppHandle) -> std::path::PathBuf {
    if let Ok(log_dir) = app_handle.path().app_log_dir() {
        let _ = std::fs::create_dir_all(&log_dir);
        return log_dir;
    }
    // Fallback: same dir as the bridge script
    if let Some(parent) = get_agent_bridge_path()
        .ok()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()))
    {
        return parent;
    }
    std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("."))
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

    // First pass: collect all existing candidates
    let existing: Vec<std::path::PathBuf> = possible_paths
        .iter()
        .filter_map(|p| p.as_ref())
        .filter(|p| p.exists())
        .cloned()
        .collect();

    if existing.is_empty() {
        return Err("agent-bridge.js not found. Please ensure it's in the same directory as the executable or project root.".to_string());
    }

    // Prefer the candidate with the LATEST mtime — guards against stale
    // copies in the exe directory that predate updates to the source.
    // Without this, a leftover `target/release/agent-bridge.js` from an
    // earlier workflow silently shadows the fresh source.
    let chosen = existing
        .iter()
        .max_by_key(|p| {
            std::fs::metadata(p)
                .and_then(|m| m.modified())
                .unwrap_or(std::time::SystemTime::UNIX_EPOCH)
        })
        .expect("at least one candidate exists");

    Ok(chosen.clone())
}

/// Find the directory containing bundled skills (src-tauri/skills/).
/// Mirrors `get_agent_bridge_path`'s candidate search.
pub fn get_bundled_skills_dir() -> Result<std::path::PathBuf, String> {
    let exe = std::env::current_exe().map_err(|e| format!("current_exe: {}", e))?;
    let exe_dir = exe.parent().ok_or("exe has no parent")?;

    let candidates = [
        exe_dir.join("skills"),
        exe_dir.join("..").join("skills"),       // target/release/../skills = target/skills
        exe_dir.join("..").join("..").join("skills"),  // target/release/../../skills = src-tauri/skills
        exe_dir.join("..").join("..").join("..").join("skills"),  // project root/skills (fallback)
    ];

    for c in &candidates {
        if c.exists() && c.is_dir() {
            return Ok(c.clone());
        }
    }

    Err(format!(
        "Bundled skills directory not found. Tried: {:?}",
        candidates
    ))
}

/// Copy bundled skills into a project's `.claude/skills/` so the agent SDK
/// discovers them. Called at project-setup time (alongside
/// `setup_project_with_session`). Each skill is a subdirectory containing
/// `SKILL.md` — we mirror that layout under `{project}/.claude/skills/`.
pub fn copy_bundled_skills_to_project(project_path: &str) -> Result<(), String> {
    let src_dir = get_bundled_skills_dir()?;
    let dst_dir = std::path::PathBuf::from(project_path).join(".claude").join("skills");

    std::fs::create_dir_all(&dst_dir)
        .map_err(|e| format!("Failed to create {}: {}", dst_dir.display(), e))?;

    // Iterate top-level skill directories
    for entry in std::fs::read_dir(&src_dir)
        .map_err(|e| format!("Failed to read {}: {}", src_dir.display(), e))?
    {
        let entry = entry.map_err(|e| format!("Dir entry error: {}", e))?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let skill_name = match path.file_name().and_then(|n| n.to_str()) {
            Some(n) => n.to_string(),
            None => continue,
        };
        let dst_skill_dir = dst_dir.join(&skill_name);
        std::fs::create_dir_all(&dst_skill_dir)
            .map_err(|e| format!("Failed to create {}: {}", dst_skill_dir.display(), e))?;

        // Copy all files in the skill dir (typically just SKILL.md)
        for file_entry in std::fs::read_dir(&path)
            .map_err(|e| format!("Failed to read skill {}: {}", path.display(), e))?
        {
            let file_entry = file_entry.map_err(|e| format!("File entry error: {}", e))?;
            let src_file = file_entry.path();
            if !src_file.is_file() {
                continue;
            }
            let dst_file = dst_skill_dir.join(
                file_entry.file_name().to_string_lossy().to_string(),
            );
            std::fs::copy(&src_file, &dst_file)
                .map_err(|e| format!("Failed to copy {} -> {}: {}", src_file.display(), dst_file.display(), e))?;
        }
    }

    log::info!(
        "[copy_bundled_skills_to_project] copied from {} to {}",
        src_dir.display(),
        dst_dir.display()
    );
    Ok(())
}

/// Initialize an agent session in the given project workspace.
/// Synchronous (cmd.output()): spawns node, captures stdout, returns the
/// session_id from the JSON line emitted by agent-bridge.js's init stage.
///
/// Used by `create_project_with_session` (Phase B) on first project creation.
/// The returned session_id is then persisted by the host to
/// `.learning/agent-session.json` for use in subsequent invocations.
pub async fn init_agent_session(config: &AppConfig, project_path: &str) -> Result<String, String> {
    log::info!("[init_agent_session] project_path={}", project_path);
    let bridge_path = get_agent_bridge_path()?;

    let config_json = serde_json::json!({
        "config": {
            "ai_provider": config.ai_provider.as_ref().map(|p| format!("{:?}", p).to_lowercase()).unwrap_or_else(|| "anthropic".to_string()),
            "ai_base_url": config.ai_base_url,
            "api_key": config.api_key,
            "model": config.model,
        },
        "args": { "project_path": project_path }
    });

    let mut cmd = Command::new("node");
    cmd.arg("--no-warnings")
        .arg(&bridge_path)
        .arg("init")
        .arg(config_json.to_string())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env("NODE_NO_WARNINGS", "1")
        .env("TYPORA_NEXT_LOG_DIR", _agent_log_dir_for_path(&bridge_path));

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let output = cmd.output()
        .map_err(|e| format!("Failed to spawn agent-bridge init: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Init stage failed (exit {:?}): {}", output.status.code(), stderr));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    // Find the last line starting with '{' (the init result JSON)
    let json_line = stdout.lines()
        .map(|l| l.trim())
        .filter(|l| l.starts_with('{') && l.ends_with('}'))
        .last()
        .ok_or_else(|| {
            format!("No JSON in init output. Raw stdout: {}", &stdout[..stdout.len().min(200)])
        })?;

    let parsed: Value = serde_json::from_str(json_line)
        .map_err(|e| format!("Failed to parse init result: {} — raw: {}", e, json_line))?;

    let session_id = parsed
        .get("session_id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| format!("init result missing session_id: {}", json_line))?
        .to_string();

    log::info!("[init_agent_session] SUCCESS: session_id={}", session_id);
    Ok(session_id)
}

/// Helper: compute TYPORA_NEXT_LOG_DIR from bridge_path parent (for init stage
/// which doesn't have an AppHandle).
fn _agent_log_dir_for_path(bridge_path: &std::path::Path) -> String {
    bridge_path
        .parent()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|| ".".to_string())
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
        .env("NODE_NO_WARNINGS", "1")
        // Tell agent-bridge.js where to write logs (MSI install → app_log_dir,
        // dev → script dir). Falls back to __dirname if unset.
        .env("TYPORA_NEXT_LOG_DIR", _agent_log_dir(&app_handle).to_string_lossy().to_string());

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

    // Streaming: read JSON lines from stdout one by one and emit each to
    // the frontend immediately (not batched). This lets the user see
    // progress_log events and chapter status in real time during long
    // AI generation tasks, reducing perceived wait time.
    use std::io::{BufRead, BufReader};
    let reader = BufReader::new(stdout);
    let mut stdout_lines: Vec<String> = Vec::new();
    for line_result in reader.lines() {
        match line_result {
            Ok(line) => {
                let trimmed = line.trim().to_string();
                stdout_lines.push(trimmed.clone());
                if trimmed.is_empty() {
                    continue;
                }

                log_msg(&format!("[stream-line] len={}", trimmed.len()));

                // Parse as generic JSON and forward immediately
                match serde_json::from_str::<Value>(&trimmed) {
                    Ok(event) => {
                        let event_type = event.get("type").and_then(|v| v.as_str()).unwrap_or("unknown");
                        log_msg(&format!("[emit] type={}", event_type));
                        if let Err(e) = app_handle.emit("agent-event", &event) {
                            log_msg(&format!("[emit-error] {}", e));
                        }
                    }
                    Err(e) => {
                        log_msg(&format!("[parse-error] {} — raw: {}", e, &trimmed[..std::cmp::min(100, trimmed.len())]));
                    }
                }
            }
            Err(e) => {
                log_msg(&format!("[read-error] {}", e));
                break;
            }
        }
    }

    log_msg(&format!("[total] {} lines", stdout_lines.len()));

    // Dump raw content to file for debugging
    let dump_path = std::path::PathBuf::from(&bridge_path).parent().unwrap_or(std::path::Path::new(".")).join("stdout-dump.txt");
    let _ = std::fs::write(&dump_path, stdout_lines.join("\n"));

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

// ============================================
// Sprint N+1: plan_course_llm — direct ureq LLM call
// (replaces plan_course Agent SDK path; plan is a simple JSON-out task)
// ============================================

/// Pure function — extracted for testability.
/// Mirrors the prompt that previously lived in agent-bridge.js planCourse().
pub fn build_plan_prompt(goal: &str, level: &str, hours: u32) -> String {
    let level_names = [
        ("beginner", "小白（零基础）"),
        ("intermediate", "有编程基础"),
        ("advanced", "专业进阶"),
    ];
    let level_label = level_names
        .iter()
        .find(|(k, _)| *k == level)
        .map(|(_, v)| *v)
        .unwrap_or(level);

    format!(
        r#"你是一个资深的学习设计师。请根据以下信息设计一个结构化的学习大纲。

学习目标：{goal}
难度级别：{level_label}
预计投入时间：{hours} 小时

要求：
1. 大纲要深入浅出、逻辑连贯
2. 从基础到进阶，循序渐进
3. 每章包含：标题、预计时长（分钟）、涉及的核心概念
4. 总时长控制在用户指定范围内（允许 ±20% 偏差）
5. 章节数量：1小时≈2-3章，3小时≈6-8章，8小时≈12-16章

输出格式（必须是纯 JSON）：
```json
{{
  "project_slug": "diffusion-model",
  "chapters": [
    {{
      "title": "章节标题",
      "duration_minutes": 25,
      "concepts": ["概念1", "概念2"]
    }}
  ],
  "total_duration": 170
}}
```

注意：
- project_slug 是用英文小写字母和短横线组成的目录名（kebab-case），用于作为文件系统目录名，比如 "diffusion-model" / "attention-mechanism" / "react-basics"。最多 50 字符。"#,
        goal = goal,
        level_label = level_label,
        hours = hours,
    )
}

/// Pure function — extracted for testability.
/// Strips markdown code block wrappers if present, then parses JSON.
/// Mirrors `extractJSON` from agent-bridge.js plus normalization that
/// previously lived there.
pub fn parse_plan_response(raw: &str) -> Result<Value, String> {
    // Strip markdown code block wrappers
    let cleaned = raw.trim();
    let cleaned = if cleaned.starts_with("```") {
        cleaned
            .lines()
            .skip(1) // skip ```json or ```
            .take_while(|l| !l.trim_start().starts_with("```"))
            .collect::<Vec<_>>()
            .join("\n")
    } else {
        cleaned.to_string()
    };

    // Parse JSON
    let mut outline: Value = serde_json::from_str(&cleaned)
        .map_err(|e| format!("解析大纲 JSON 失败: {} — 原始响应: {}", e, &raw[..raw.len().min(200)]))?;

    // Validate chapters
    let chapters = outline
        .get("chapters")
        .and_then(|v| v.as_array())
        .ok_or_else(|| "大纲格式错误：缺少 chapters 数组".to_string())?;

    // Normalize chapters (fill in defaults for missing fields)
    let normalized: Vec<Value> = chapters
        .iter()
        .enumerate()
        .map(|(i, ch)| {
            let title = ch
                .get("title")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
                .unwrap_or_else(|| format!("第 {} 章", i + 1));
            let duration_minutes = ch
                .get("duration_minutes")
                .and_then(|v| v.as_u64())
                .unwrap_or(20) as u32;
            let concepts: Vec<String> = ch
                .get("concepts")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|v| v.as_str().map(String::from))
                        .collect()
                })
                .unwrap_or_default();
            serde_json::json!({
                "title": title,
                "duration_minutes": duration_minutes,
                "concepts": concepts,
            })
        })
        .collect();

    let total_duration: u32 = normalized
        .iter()
        .map(|ch| ch.get("duration_minutes").and_then(|v| v.as_u64()).unwrap_or(0) as u32)
        .sum();

    outline["chapters"] = Value::Array(normalized);
    outline["total_duration"] = Value::Number(total_duration.into());

    // Sanitize project_slug (English kebab-case). Fallback to a safe default.
    let slug_is_valid = outline
        .get("project_slug")
        .and_then(|v| v.as_str())
        .map(|s| {
            !s.is_empty()
                && s.len() <= 50
                && s.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
                && s.chars().next().map(|c| c.is_ascii_alphanumeric()).unwrap_or(false)
        })
        .unwrap_or(false);
    if !slug_is_valid {
        outline["project_slug"] = Value::String("learning-project".to_string());
    }

    Ok(outline)
}

/// Plan a learning course via direct LLM call (no Agent SDK).
/// Returns the outline JSON synchronously — simpler and faster than the
/// Agent SDK path (`plan_course`), which had 500ms cold-start overhead and
/// unnecessary tool/skill machinery for a pure JSON-out task.
#[tauri::command]
pub async fn plan_course_llm(
    goal: String,
    level: String,
    hours: u32,
    app_handle: AppHandle,
) -> Result<Value, String> {
    log::info!("[plan_llm] plan_course_llm START: goal_len={}, level={}, hours={}", goal.len(), level, hours);

    // Get config
    let config = crate::get_config(app_handle).map_err(|e| e.to_string())?;
    let api_key = config
        .api_key
        .filter(|k| !k.is_empty())
        .ok_or("未设置 API Key，请在设置中配置")?;

    let provider = config.ai_provider.unwrap_or_default();
    let base_url = config
        .ai_base_url
        .filter(|u| !u.is_empty())
        .unwrap_or_else(|| match provider {
            crate::AiProvider::Anthropic => "https://api.anthropic.com".to_string(),
            crate::AiProvider::Openai => "https://api.openai.com".to_string(),
        });

    let model = config
        .model
        .filter(|m| !m.is_empty())
        .unwrap_or_else(|| match provider {
            crate::AiProvider::Anthropic => "claude-3-5-haiku-20241022".to_string(),
            crate::AiProvider::Openai => "gpt-4o-mini".to_string(),
        });

    let prompt = build_plan_prompt(&goal, &level, hours);

    // Call LLM via ureq (mirrors explain_selection pattern)
    let (response, is_anthropic) = match provider {
        crate::AiProvider::Anthropic => {
            let url = format!("{}/v1/messages", base_url.trim_end_matches('/'));
            let req = serde_json::json!({
                "model": model,
                "max_tokens": 2048,
                "messages": [{"role": "user", "content": prompt}]
            });
            let resp = ureq::post(&url)
                .set("Content-Type", "application/json")
                .set("x-api-key", &api_key)
                .set("anthropic-version", "2023-06-01")
                .send_json(req)
                .map_err(|e| format!("API 请求失败: {}", e))?;
            (resp, true)
        }
        crate::AiProvider::Openai => {
            let url = format!("{}/v1/chat/completions", base_url.trim_end_matches('/'));
            let req = serde_json::json!({
                "model": model,
                "max_tokens": 2048,
                "messages": [{"role": "user", "content": prompt}]
            });
            let resp = ureq::post(&url)
                .set("Content-Type", "application/json")
                .set("Authorization", &format!("Bearer {}", api_key))
                .send_json(req)
                .map_err(|e| format!("API 请求失败: {}", e))?;
            (resp, false)
        }
    };

    let json: Value = response
        .into_json()
        .map_err(|e| format!("解析响应失败: {}", e))?;

    let raw_content = if is_anthropic {
        json["content"][0]["text"].as_str()
    } else {
        json["choices"][0]["message"]["content"].as_str()
    }
    .ok_or("响应中没有内容")?;

    // Parse + normalize
    let outline = parse_plan_response(raw_content)?;

    log::info!(
        "[plan_llm] SUCCESS: chapters={}, total_duration={}",
        outline.get("chapters").and_then(|v| v.as_array()).map(|a| a.len()).unwrap_or(0),
        outline.get("total_duration").and_then(|v| v.as_u64()).unwrap_or(0)
    );
    Ok(outline)
}

/// Generate chapters from outline.
/// If `chapter_indices` is provided, only those chapters are generated (sliding-window mode).
/// Otherwise the full outline is generated (legacy full-batch mode).
#[tauri::command]
pub async fn generate_chapters(
    project_path: String,
    outline: Value,
    app_handle: AppHandle,
    agent_process: State<'_, AgentProcess>,
    chapter_indices: Option<Vec<usize>>,
    session_id: Option<String>,
) -> Result<(), String> {
    let config = get_config(app_handle.clone()).map_err(|e| e.to_string())?;

    let args = serde_json::json!({
        "project_path": project_path,
        "outline": outline,
        "chapter_indices": chapter_indices,
        "session_id": session_id,
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

    // ============================================
    // Sprint N+1: plan_course_llm tests
    // ============================================

    #[test]
    fn test_build_plan_prompt_includes_goal_level_hours() {
        let p = build_plan_prompt("学 Rust", "beginner", 3);
        assert!(p.contains("学 Rust"), "prompt should include goal");
        assert!(p.contains("小白（零基础）"), "prompt should translate beginner to label");
        assert!(p.contains("3 小时"), "prompt should include hours");
        assert!(p.contains("project_slug"), "prompt should describe the output schema");
    }

    #[test]
    fn test_build_plan_prompt_falls_back_to_raw_level_when_unknown() {
        let p = build_plan_prompt("goal", "unknown-level", 1);
        // Unknown level should be passed through verbatim
        assert!(p.contains("unknown-level"));
    }

    #[test]
    fn test_parse_plan_response_strips_code_block() {
        let raw = "```json\n{\"project_slug\":\"demo\",\"chapters\":[{\"title\":\"A\",\"duration_minutes\":10,\"concepts\":[\"x\"]}],\"total_duration\":10}\n```";
        let v = parse_plan_response(raw).expect("should parse");
        assert_eq!(v["project_slug"], "demo");
        assert_eq!(v["chapters"].as_array().unwrap().len(), 1);
        assert_eq!(v["chapters"][0]["title"], "A");
    }

    #[test]
    fn test_parse_plan_response_normalizes_missing_chapter_fields() {
        let raw = r#"{"chapters":[{"title":""},{"duration_minutes":15,"concepts":["a","b"]}]}"#;
        let v = parse_plan_response(raw).expect("should parse");
        let chapters = v["chapters"].as_array().unwrap();
        // Empty title → fallback
        assert_eq!(chapters[0]["title"], "第 1 章");
        // Missing duration → default 20
        assert_eq!(chapters[0]["duration_minutes"], 20);
        assert_eq!(chapters[1]["duration_minutes"], 15);
        // Missing concepts → empty array
        assert_eq!(chapters[0]["concepts"].as_array().unwrap().len(), 0);
    }

    #[test]
    fn test_parse_plan_response_recomputes_total_duration() {
        let raw = r#"{"chapters":[{"title":"A","duration_minutes":10},{"title":"B","duration_minutes":15}],"total_duration":999}"#;
        let v = parse_plan_response(raw).expect("should parse");
        // Recomputed, not the model's claim
        assert_eq!(v["total_duration"], 25);
    }

    #[test]
    fn test_parse_plan_response_sanitizes_invalid_slug() {
        // Empty slug
        let v = parse_plan_response(r#"{"chapters":[],"project_slug":""}"#).unwrap();
        assert_eq!(v["project_slug"], "learning-project");
        // Slug with uppercase
        let v = parse_plan_response(r#"{"chapters":[],"project_slug":"FooBar"}"#).unwrap();
        assert_eq!(v["project_slug"], "learning-project");
        // Slug too long
        let v = parse_plan_response(&format!(r#"{{"chapters":[],"project_slug":"{}"}}"#, "a".repeat(60))).unwrap();
        assert_eq!(v["project_slug"], "learning-project");
        // Slug starts with hyphen
        let v = parse_plan_response(r#"{"chapters":[],"project_slug":"-bad"}"#).unwrap();
        assert_eq!(v["project_slug"], "learning-project");
        // Valid slug should be preserved
        let v = parse_plan_response(r#"{"chapters":[],"project_slug":"diffusion-model"}"#).unwrap();
        assert_eq!(v["project_slug"], "diffusion-model");
    }

    #[test]
    fn test_parse_plan_response_rejects_missing_chapters() {
        let raw = r#"{"project_slug":"demo"}"#;
        assert!(parse_plan_response(raw).is_err(), "should reject without chapters");
    }

    #[test]
    fn test_parse_plan_response_rejects_malformed_json() {
        assert!(parse_plan_response("not json at all").is_err());
        assert!(parse_plan_response("```json\n{invalid}\n```").is_err());
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

/// Check whether the Claude Agent SDK is available
#[tauri::command]
pub async fn check_agent_sdk() -> Result<serde_json::Value, String> {
    log::info!("[ai_agent] check_agent_sdk called");

    let bridge_path = get_agent_bridge_path()?;
    let payload = serde_json::json!({
        "config": {},
        "args": {}
    });

    let mut cmd = std::process::Command::new("node");
    cmd.arg("--no-warnings")
        .arg(&bridge_path)
        .arg("check")
        .arg(payload.to_string())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .env("NODE_NO_WARNINGS", "1");

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let output = cmd.output()
        .map_err(|e| format!("Failed to spawn agent-bridge check: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);

    log::info!("[ai_agent] check_agent_sdk exit={:?} stdout={} stderr={}", output.status.code(), stdout.trim(), stderr.trim());

    if !output.status.success() {
        return Ok(serde_json::json!({
            "available": false,
            "error": format!("Agent bridge exited with code {:?}: {}", output.status.code(), stderr.trim())
        }));
    }

    // Parse the last non-empty JSON line from stdout (in case logs leak)
    let last_json_line = stdout.lines()
        .map(|l| l.trim())
        .filter(|l| !l.is_empty() && (l.starts_with('{') || l.starts_with('[')))
        .last()
        .unwrap_or("{}");

    match serde_json::from_str::<serde_json::Value>(last_json_line) {
        Ok(result) => Ok(result),
        Err(e) => Ok(serde_json::json!({
            "available": false,
            "error": format!("Failed to parse check result: {}. Raw: {}", e, stdout.trim())
        })),
    }
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

/// Build an extra quiz question from a concept + its AI explanation (Sprint 6 PB4)
/// Pure function — extracted for testability
pub fn build_extra_question(idx: usize, concept: &str, explanation: &str) -> QuizQuestion {
    let summary = if explanation.chars().count() > 100 {
        explanation.chars().take(100).collect::<String>() + "..."
    } else {
        explanation.to_string()
    };
    QuizQuestion {
        id: format!("extra_{}", idx + 1),
        qtype: "single".to_string(),
        question: format!("你在本章中询问过「{}」的含义。以下哪项描述最准确？", concept),
        options: vec![
            QuizOption { label: "A".to_string(), text: summary },
            QuizOption { label: "B".to_string(), text: "这是一种数据压缩算法".to_string() },
            QuizOption { label: "C".to_string(), text: "这是数据库查询优化技术".to_string() },
            QuizOption { label: "D".to_string(), text: "这是前端 UI 渲染框架".to_string() },
        ],
        correct: serde_json::Value::String("A".to_string()),
        weak_concepts: vec![concept.to_string()],
    }
}

/// Heuristic repair for a common agent bug: bare ASCII `"` inside JSON string
/// values where Chinese quotes were intended.  Only escapes `"` when BOTH the
/// preceding AND following bytes are non-ASCII (CJK characters), which reliably
/// identifies inner Chinese quotes without touching structural JSON quotes.
///
/// Example input:  `"question": "...被称为"破坏过程"？"`
/// Example output: `"question": "...被称为\"破坏过程\"？"`
///             only the two inner `"` between CJK chars are escaped.
fn repair_json_quotes(raw: &str) -> String {
    let b = raw.as_bytes();
    let len = b.len();
    let mut result = String::with_capacity(len + 32);
    for i in 0..len {
        if b[i] == b'"' {
            // Escape `"` only when sandwiched between non-ASCII bytes.
            // This catches CJK inner quotes without touching structural `"`.
            let prev_non_ascii = i > 0 && b[i - 1] >= 0x80;
            let next_non_ascii = i + 1 < len && b[i + 1] >= 0x80;
            // Also catch `"？` where `？` is CJK punctuation (EF BC 9F)
            let next_is_cjk_punct = i + 3 < len
                && b[i + 1] == 0xef && b[i + 2] == 0xbc
                && prev_non_ascii;
            if (prev_non_ascii && next_non_ascii) || next_is_cjk_punct {
                result.push('\\');
            }
        }
        result.push(b[i] as char);
    }
    result
}

/// Read quiz questions from pre-generated .quiz.json (Sprint 3 refactored: no real-time AI)
/// Sprint 6 PB4: append 1-2 extra questions based on explanations/<chapter>.json
#[tauri::command]
pub async fn generate_chapter_quiz(
    chapter_file: String,
    project_path: Option<String>,
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

    // Attempt to parse — if the agent wrote bare ASCII `"` inside string values
    // (e.g. `"...被称为"破坏过程"？"` instead of `"...被称为\"破坏过程\"？"`),
    // serde_json will fail.  Heuristic repair: escape `"` that sit between a
    // non-whitespace, non-quote char and another such char, which catches the
    // common case of Chinese quotes written as bare ASCII `"`.
    let quiz_json: serde_json::Value = match serde_json::from_str(&quiz_content) {
        Ok(v) => v,
        Err(_) => {
            log::warn!("[Sprint3] quiz.json parse failed, attempting heuristic repair");
            let repaired = repair_json_quotes(&quiz_content);
            serde_json::from_str(&repaired).map_err(|e| {
                format!(
                    "解析 quiz.json 失败: {}。自动修复也失败了——最常见的原因是 agent 写的 JSON 内\
                     包含未转义的引号，如 `\"破坏过程\"` 而非 `\\\"破坏过程\\\"`。\n\
                     原始文件路径: {}",
                    e, quiz_path
                )
            })?
        }
    };

    // Provide a diagnostic when the schema is wrong so the agent (or human)
    // can see what fields were actually present.
    let questions_value = quiz_json.get("questions").ok_or_else(|| {
        let actual_keys: Vec<&str> = quiz_json
            .as_object()
            .map(|o| o.keys().map(|k| k.as_str()).collect())
            .unwrap_or_default();
        format!(
            "quiz.json 缺少 questions 字段。当前的顶层字段是: [{}]。请参考 content-format.md §4 让 agent 重写文件。",
            actual_keys.join(", ")
        )
    })?;

    let questions_arr = questions_value.as_array().ok_or_else(|| {
        format!(
            "quiz.json 的 questions 字段不是数组，实际类型: {}",
            match questions_value {
                serde_json::Value::Null => "null",
                serde_json::Value::Bool(_) => "boolean",
                serde_json::Value::Number(_) => "number",
                serde_json::Value::String(_) => "string",
                serde_json::Value::Array(_) => "array (unexpected)",
                serde_json::Value::Object(_) => "object",
            }
        )
    })?;

    if questions_arr.is_empty() {
        return Err(format!(
            "quiz.json 的 questions 数组为空（需要 3-5 道题）。文件路径: {}",
            quiz_path
        ));
    }

    let mut questions: Vec<QuizQuestion> = questions_arr
        .iter()
        .enumerate()
        .map(|(idx, q)| serde_json::from_value(q.clone()).map_err(|e| {
            // Show first failing question's keys for fast diagnosis
            let q_keys: Vec<&str> = q
                .as_object()
                .map(|o| o.keys().map(|k| k.as_str()).collect())
                .unwrap_or_default();
            format!(
                "解析第 {} 道题失败: {}。该题的字段是: [{}]。QuizQuestion 需要的字段: id, qtype, question, options, correct, weak_concepts",
                idx + 1, e, q_keys.join(", ")
            )
        }))
        .collect::<Result<Vec<_>, _>>()?;

    // Sprint 6 PB4: append extra questions from explanations
    if let Some(proj) = project_path.as_ref().filter(|p| !p.is_empty()) {
        if let Some(basename) = std::path::Path::new(&chapter_file).file_name() {
            let basename_str = basename.to_string_lossy().to_string();
            // Try project_path directly, then parent dir (in case baseDir is chapters/ subdir)
            let start_dir = std::path::PathBuf::from(proj);
            let mut exp_path = start_dir.join(".learning").join("explanations").join(format!("{}.json", basename_str));
            if !exp_path.exists() {
                if let Some(parent) = start_dir.parent() {
                    exp_path = parent.join(".learning").join("explanations").join(format!("{}.json", basename_str));
                }
            }
            log::info!("[Sprint6] checking explanations for extra quiz: {:?} exists={}", exp_path, exp_path.exists());
            if exp_path.exists() {
                match std::fs::read_to_string(&exp_path) {
                    Ok(exp_content) => {
                        match serde_json::from_str::<crate::explanation_persistence::ChapterExplanations>(&exp_content) {
                            Ok(exp_data) => {
                                let max_extra = std::cmp::min(2, 9usize.saturating_sub(questions.len()));
                                log::info!("[Sprint6] found {} conversations, max_extra={}", exp_data.conversations.len(), max_extra);
                                let extras: Vec<(String, String)> = exp_data.conversations
                                    .iter()
                                    .filter_map(|c| {
                                        let concept = c.selected_text.trim();
                                        if concept.is_empty() { return None; }
                                        // Skip if existing quiz already mentions this concept
                                        let concept_lower = concept.to_lowercase();
                                        let already_covered = questions.iter().any(|q| {
                                            q.question.to_lowercase().contains(&concept_lower)
                                        });
                                        if already_covered {
                                            log::info!("[Sprint6] skipping extra for '{}': already in quiz", concept);
                                            return None;
                                        }
                                        let ans = c.qa_history.first().map(|qa| qa.a.clone()).unwrap_or_default();
                                        if !ans.is_empty() {
                                            Some((concept.to_string(), ans))
                                        } else {
                                            None
                                        }
                                    })
                                    .take(max_extra)
                                    .collect();
                                log::info!("[Sprint6] selected {} extras from conversations", extras.len());
                                for (idx, (concept, explanation)) in extras.iter().enumerate() {
                                    let q = build_extra_question(idx, concept, explanation);
                                    questions.push(q);
                                    log::info!("[Sprint6] appended extra quiz question for concept: {}", concept);
                                }
                            }
                            Err(e) => log::warn!("[Sprint6] failed to parse explanations json: {}", e),
                        }
                    }
                    Err(e) => log::warn!("[Sprint6] failed to read explanations file: {}", e),
                }
            }
        } else {
            log::warn!("[Sprint6] could not extract basename from chapter_file: {}", chapter_file);
        }
    } else {
        log::info!("[Sprint6] project_path is empty or None, skipping extra questions");
    }

    if questions.is_empty() || questions.len() > 9 {
        return Err(format!("Invalid question count: {} (expected 3-9)", questions.len()));
    }

    log::info!("[Sprint3] loaded {} questions (including extras)", questions.len());
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

// ============================================
// Sprint 6 PB1/PB2: explain_selection
// Direct ureq LLM call (replaced Sprint 3 agent-bridge approach)
// ============================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QAItem {
    pub q: String,
    pub a: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExplainV2Response {
    pub explanation: String,
    pub suggested_questions: Vec<String>,
}

/// Build LLM prompt for explain_selection
/// Pure function — extracted for testability
pub fn build_explain_prompt(text: &str, context: Option<&str>, previous_qa: Option<&[QAItem]>) -> String {
    let mut parts: Vec<String> = Vec::new();

    if let Some(ctx) = context {
        parts.push(format!("当前章节：{}", ctx));
    }

    if let Some(qa_list) = previous_qa {
        parts.push("之前的对话：".to_string());
        for (i, qa) in qa_list.iter().enumerate() {
            parts.push(format!("  Q{}: {}", i + 1, qa.q));
            parts.push(format!("  A{}: {}", i + 1, qa.a));
        }
    }

    parts.push(String::new());
    parts.push("请用学术摘要风格简洁解释以下概念（严格150字以内）：".to_string());
    parts.push("要求：".to_string());
    parts.push("- 直接给出定义 + 核心机制 + 为什么重要".to_string());
    parts.push("- 禁止讲故事、禁止层层递进比喻、禁止冗余修饰".to_string());
    parts.push("- 一句话说完的事不要拆成三段".to_string());
    parts.push(String::new());
    parts.push("同时给出3-4个用户可能想追问的问题（作为JSON数组）。".to_string());
    parts.push(String::new());
    parts.push("返回格式（合法JSON）：".to_string());
    parts.push("{\"explanation\": \"...\", \"suggestedQuestions\": [\"...\", \"...\"]}".to_string());
    parts.push(String::new());

    let truncated = if text.chars().count() > 197 {
        text.chars().take(197).collect::<String>() + "..."
    } else {
        text.to_string()
    };
    parts.push(format!("概念：{}", truncated));

    parts.join("\n")
}

/// Parse LLM response into structured ExplainV2Response
/// Pure function — extracted for testability
pub fn parse_explain_response(raw: &str) -> ExplainV2Response {
    // Strip markdown code block wrappers if present (LLM sometimes wraps JSON in ```json ... ```)
    let cleaned = raw.trim();
    let cleaned = if cleaned.starts_with("```") {
        cleaned.lines()
            .skip(1) // skip ```json or ```
            .take_while(|l| !l.trim_start().starts_with("```"))
            .collect::<Vec<_>>()
            .join("\n")
    } else {
        cleaned.to_string()
    };

    // Try to parse as JSON
    if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&cleaned) {
        let mut explanation = parsed
            .get("explanation")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        // Hard truncate to 200 chars as safety net (prompt asks for 150)
        if explanation.chars().count() > 200 {
            explanation = explanation.chars().take(197).collect::<String>() + "...";
        }
        let suggested_questions = parsed
            .get("suggestedQuestions")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(String::from))
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        return ExplainV2Response {
            explanation,
            suggested_questions,
        };
    }

    // Fallback: treat raw as explanation, use hardcoded questions
    let fallback = vec![
        "这是什么意思？".to_string(),
        "举个例子".to_string(),
        "有什么应用场景？".to_string(),
        "需要注意什么陷阱？".to_string(),
    ];
    ExplainV2Response {
        explanation: raw.to_string(),
        suggested_questions: fallback,
    }
}

#[tauri::command]
pub async fn explain_selection(
    text: String,
    context: Option<String>,
    previous_qa: Option<Vec<QAItem>>,
    app_handle: AppHandle,
) -> Result<ExplainV2Response, String> {
    log::info!("[Sprint6] explain_selection START: text_len={}", text.len());

    // Get config
    let config = crate::get_config(app_handle).map_err(|e| e.to_string())?;
    let api_key = config.api_key
        .filter(|k| !k.is_empty())
        .ok_or("未设置 API Key，请在设置中配置")?;

    let provider = config.ai_provider.unwrap_or_default();
    let base_url = config.ai_base_url
        .filter(|u| !u.is_empty())
        .unwrap_or_else(|| match provider {
            crate::AiProvider::Anthropic => "https://api.anthropic.com".to_string(),
            crate::AiProvider::Openai => "https://api.openai.com".to_string(),
        });

    let model = config.model
        .filter(|m| !m.is_empty())
        .unwrap_or_else(|| match provider {
            crate::AiProvider::Anthropic => "claude-3-5-haiku-20241022".to_string(),
            crate::AiProvider::Openai => "gpt-4o-mini".to_string(),
        });

    // Build prompt
    let prompt = build_explain_prompt(&text, context.as_deref(), previous_qa.as_deref());

    // Call LLM via ureq (mirrors fix_mermaid pattern)
    let (response, is_anthropic) = match provider {
        crate::AiProvider::Anthropic => {
            let url = format!("{}/v1/messages", base_url.trim_end_matches('/'));
            let req = serde_json::json!({
                "model": model,
                "max_tokens": 1024,
                "messages": [{"role": "user", "content": prompt}]
            });
            let resp = ureq::post(&url)
                .set("Content-Type", "application/json")
                .set("x-api-key", &api_key)
                .set("anthropic-version", "2023-06-01")
                .send_json(req)
                .map_err(|e| format!("API 请求失败: {}", e))?;
            (resp, true)
        }
        crate::AiProvider::Openai => {
            let url = format!("{}/v1/chat/completions", base_url.trim_end_matches('/'));
            let req = serde_json::json!({
                "model": model,
                "max_tokens": 1024,
                "messages": [{"role": "user", "content": prompt}]
            });
            let resp = ureq::post(&url)
                .set("Content-Type", "application/json")
                .set("Authorization", &format!("Bearer {}", api_key))
                .send_json(req)
                .map_err(|e| format!("API 请求失败: {}", e))?;
            (resp, false)
        }
    };

    let json: serde_json::Value = response.into_json()
        .map_err(|e| format!("解析响应失败: {}", e))?;

    let raw_content = if is_anthropic {
        json["content"][0]["text"].as_str()
    } else {
        json["choices"][0]["message"]["content"].as_str()
    }.ok_or("响应中没有内容")?;

    // Parse structured response
    let result = parse_explain_response(raw_content);

    log::info!("[Sprint6] explain_selection SUCCESS: explanation_len={}, questions={}",
        result.explanation.len(), result.suggested_questions.len());
    Ok(result)
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

// ============================================
// Sprint 6 PB3: Explanation Persistence Commands
// ============================================

#[tauri::command]
pub async fn persist_explanation(
    project_path: String,
    chapter: String,
    conversation: crate::explanation_persistence::ExplanationConversation,
) -> Result<(), String> {
    crate::explanation_persistence::save(&project_path, &chapter, conversation)
}

#[tauri::command]
pub async fn load_chapter_explanations(
    project_path: String,
    chapter: String,
) -> Result<crate::explanation_persistence::ChapterExplanations, String> {
    crate::explanation_persistence::load(&project_path, &chapter)
}

// ============================================
// Sprint 8b: Socratic Review via Agent SDK
// ============================================

#[tauri::command]
pub async fn socratic_chat(
    project_path: String,
    concept_titles: Vec<String>,
    app_handle: tauri::AppHandle,
    session_id: Option<String>,
) -> Result<crate::SocraticChatResponse, String> {
    log::info!("[Sprint8b] socratic_chat START: project={}, concepts={:?}, session_id={}",
        project_path, concept_titles, session_id.as_deref().unwrap_or("(none)"));

    let config = crate::get_config(app_handle).map_err(|e| e.to_string())?;
    let bridge_path = get_agent_bridge_path()?;
    log::info!("[Sprint8b] socratic_chat: bridge_path={:?}", bridge_path);

    let payload = serde_json::json!({
        "config": {
            "ai_provider": config.ai_provider.as_ref().map(|p| format!("{:?}", p).to_lowercase()).unwrap_or_else(|| "anthropic".to_string()),
            "ai_base_url": config.ai_base_url,
            "api_key": config.api_key,
            "model": config.model,
        },
        "args": {
            "project_path": project_path,
            "concept_titles": concept_titles,
            "session_id": session_id,
        }
    });
    log::info!("[Sprint8b] socratic_chat: payload={}", payload);

    let mut cmd = std::process::Command::new("node");
    cmd.arg(&bridge_path)
        .arg("socratic")
        .arg(payload.to_string())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    log::info!("[Sprint8b] socratic_chat: spawning node process...");
    let output = cmd.output()
        .map_err(|e| {
            log::error!("[Sprint8b] socratic_chat: spawn failed: {}", e);
            format!("Failed to spawn agent-bridge: {}", e)
        })?;

    log::info!("[Sprint8b] socratic_chat: exit_code={:?}, stdout_len={}, stderr_len={}",
        output.status.code(), output.stdout.len(), output.stderr.len());

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        log::error!("[Sprint8b] socratic_chat: agent failed: stderr={}", stderr);
        return Err(format!("Agent socratic review failed: {}", stderr));
    }

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    log::info!("[Sprint8b] socratic_chat: raw_stdout={}", stdout);

    // Parse JSON response: { "content": "...", "done": true/false }
    let result: crate::SocraticChatResponse = serde_json::from_str(&stdout)
        .map_err(|e| {
            log::error!("[Sprint8b] socratic_chat: parse failed: {} — raw: {}", e, stdout);
            format!("Failed to parse socratic response: {}. Raw: {}", e, &stdout[..std::cmp::min(200, stdout.len())])
        })?;

    log::info!("[Sprint8b] socratic_chat SUCCESS: content_len={}, done={}", result.content.len(), result.done);
    Ok(result)
}

// ============================================
// Sprint 9: Exploration Mode Chat via Agent SDK
// ============================================

/// Free-form AI dialogue about an article (exploration mode)
#[tauri::command]
pub async fn explore_chat(
    article: String,
    history: Vec<serde_json::Value>,
    message: String,
    app_handle: tauri::AppHandle,
    session_id: Option<String>,
) -> Result<String, String> {
    log::info!("[Sprint9] explore_chat START: article_len={}, history_len={}, message_len={}, session_id={}",
        article.len(), history.len(), message.len(), session_id.as_deref().unwrap_or("(none)"));

    let config = crate::get_config(app_handle.clone()).map_err(|e| e.to_string())?;
    let bridge_path = get_agent_bridge_path()?;
    log::info!("[Sprint9] explore_chat: bridge_path={:?}", bridge_path);

    let payload = serde_json::json!({
        "config": {
            "ai_provider": config.ai_provider.as_ref().map(|p| format!("{:?}", p).to_lowercase()).unwrap_or_else(|| "anthropic".to_string()),
            "ai_base_url": config.ai_base_url,
            "api_key": config.api_key,
            "model": config.model,
        },
        "args": {
            "article": article,
            "history": history,
            "message": message,
            "session_id": session_id,
        }
    });
    log::info!("[Sprint9] explore_chat: payload_len={}", payload.to_string().len());

    let mut cmd = std::process::Command::new("node");
    cmd.arg(&bridge_path)
        .arg("explore")
        .arg(payload.to_string())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    log::info!("[Sprint9] explore_chat: spawning node process...");
    let output = cmd.output()
        .map_err(|e| {
            log::error!("[Sprint9] explore_chat: spawn failed: {}", e);
            format!("Failed to spawn agent-bridge: {}", e)
        })?;

    log::info!("[Sprint9] explore_chat: exit_code={:?}, stdout_len={}, stderr_len={}",
        output.status.code(), output.stdout.len(), output.stderr.len());

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        log::error!("[Sprint9] explore_chat: agent failed: stderr={}", stderr);
        return Err(format!("Agent exploration chat failed: {}", stderr));
    }

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    log::info!("[Sprint9] explore_chat: raw_stdout_len={}", stdout.len());

    if stdout.is_empty() {
        return Err("Agent returned empty exploration response".to_string());
    }

    log::info!("[Sprint9] explore_chat SUCCESS: response_len={}", stdout.len());
    Ok(stdout)
}
