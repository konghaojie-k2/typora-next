use notify::{Config, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::hash_map::DefaultHasher;
use std::collections::HashMap;
use std::fs;
use std::hash::{Hash, Hasher};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use tauri::{AppHandle, Emitter, Manager};

pub mod ai_agent;
pub mod paper_import;
mod docx_template;

pub use docx_export::{extract_math_blocks, preprocess_math, resolve_wikilink_path, MathBlock};

/// AI provider type
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum AiProvider {
    Anthropic,
    Openai,
}

impl Default for AiProvider {
    fn default() -> Self {
        AiProvider::Anthropic
    }
}

/// Application configuration
#[derive(Debug, Serialize, Deserialize, Default, Clone)]
pub struct AppConfig {
    #[serde(default)]
    pub api_key: Option<String>,
    #[serde(default)]
    pub ai_provider: Option<AiProvider>,
    #[serde(default)]
    pub ai_base_url: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub theme: Option<String>, // "light", "dark", or None for system
    #[serde(default)]
    pub custom_cursor: Option<String>,
    // MinerU paper import configuration
    #[serde(default)]
    pub mineru_api_token: Option<String>,
    #[serde(default)]
    pub mineru_base_url: Option<String>,
    #[serde(default)]
    pub mineru_model_version: Option<String>,
    // Window state
    #[serde(default)]
    pub window_width: Option<f64>,
    #[serde(default)]
    pub window_height: Option<f64>,
    #[serde(default)]
    pub window_x: Option<f64>,
    #[serde(default)]
    pub window_y: Option<f64>,
    #[serde(default)]
    pub window_maximized: Option<bool>,
    // UI state
    #[serde(default)]
    pub sidebar_collapsed: Option<bool>,
    #[serde(default)]
    pub sidebar_active_tab: Option<String>,
    #[serde(default)]
    pub last_file: Option<String>,
}

/// Application state for file watching and process management
pub struct AppState {
    watcher: Mutex<Option<RecommendedWatcher>>,
    watched_path: Mutex<Option<String>>,
    /// Serialize access to .learning/project.json to prevent read-modify-write races
    /// between concurrent commands (e.g. persist_quiz_result vs persist_chapter_file).
    project_json_lock: Mutex<()>,
    /// True while chapter generation is running in the background. Used to guard
    /// the main window close event so users don't accidentally abort generation.
    generation_in_progress: Mutex<bool>,
}

/// File result containing path and content
#[derive(Debug, Serialize, Deserialize)]
pub struct FileResult {
    path: String,
    content: String,
    base_dir: String, // Directory of the file, for resolving relative paths
}

/// Table of Contents item
#[derive(Debug, Serialize, Deserialize)]
pub struct TocItem {
    level: usize,
    text: String,
    slug: String,
}

/// Directory entry for file tree
#[derive(Debug, Serialize, Deserialize)]
pub struct DirEntry {
    name: String,
    path: String,
    is_dir: bool,
    children: Option<Vec<DirEntry>>,
}

/// Open a file dialog and return selected file content
#[tauri::command]
async fn open_file_dialog(app: tauri::AppHandle) -> Result<FileResult, String> {
    use tauri_plugin_dialog::DialogExt;

    let file_path = app
        .dialog()
        .file()
        .add_filter("Markdown", &["md", "markdown"])
        .blocking_pick_file();

    match file_path {
        Some(path) => {
            let path_ref = path.as_path().unwrap_or(&std::path::Path::new(""));
            let path_str = path_ref.display().to_string();
            let base_dir = path_ref
                .parent()
                .map(|p| p.display().to_string())
                .unwrap_or_default();
            let content =
                fs::read_to_string(path_ref).map_err(|e| format!("Failed to read file: {}", e))?;
            Ok(FileResult {
                path: path_str,
                content,
                base_dir,
            })
        }
        None => Err("No file selected".to_string()),
    }
}

/// Open a markdown file and return its content
#[tauri::command]
async fn open_file(path: PathBuf) -> Result<FileResult, String> {
    if !path.exists() {
        return Err(format!("File not found: {}", path.display()));
    }

    let content = fs::read_to_string(&path).map_err(|e| format!("Failed to read file: {}", e))?;

    let base_dir = path
        .parent()
        .map(|p| p.display().to_string())
        .unwrap_or_default();

    Ok(FileResult {
        path: path.display().to_string(),
        content,
        base_dir,
    })
}

/// Read the bundled demo file from resources
#[tauri::command]
async fn get_demo_file(app: tauri::AppHandle) -> Result<FileResult, String> {
    let resource_dir = app.path().resource_dir().map_err(|e| e.to_string())?;

    // Tauri 2 places resources under resource_dir/<relative-path from src-tauri/>
    // For "../samples/full.md", the file ends up at resource_dir/samples/full.md
    let demo_path = resource_dir.join("samples").join("full.md");

    if !demo_path.exists() {
        return Err(format!(
            "Demo file not found at: {} (resource dir: {})",
            demo_path.display(),
            resource_dir.display()
        ));
    }

    let content =
        fs::read_to_string(&demo_path).map_err(|e| format!("Failed to read demo file: {}", e))?;
    Ok(FileResult {
        path: demo_path.to_string_lossy().to_string(),
        content,
        base_dir: String::new(),
    })
}

/// Pure decision: should we request OS-level user attention for an externally
/// opened file? Returns true when the window is not focused.
///
/// Kept as a free function (not a method) so it can be unit-tested without
/// any Tauri runtime — see `tests/test_notify_external_open.rs`.
/// Conservative default: if focus state is unknown, request attention.
fn should_request_attention(is_focused: bool) -> bool {
    !is_focused
}

/// Request OS-level taskbar/Dock attention when a file is opened from the
/// OS (file association / command line) and the app window is not focused.
/// No-op when the window already has focus.
///
/// Frontend contract (Sprint 7):
///   - Called only from the `open-file-from-args` listener
///   - Called AFTER `addTab` succeeds (so we don't flash on failed open)
///   - Fire-and-forget: errors are swallowed to keep the main flow clean
#[tauri::command]
async fn notify_external_file_opened(window: tauri::Window) -> Result<(), String> {
    let focused = window.is_focused().unwrap_or(false);
    if should_request_attention(focused) {
        use tauri::UserAttentionType;
        let _ = window.request_user_attention(Some(UserAttentionType::Informational));
    }
    Ok(())
}

/// Render markdown content to HTML (body content only, for WebView injection)
#[tauri::command]
fn render_markdown(content: &str) -> String {
    render_markdown_body(content)
}

/// Extract YAML frontmatter from markdown content
fn extract_frontmatter(text: &str) -> (Option<String>, String) {
    let trimmed = text.trim_start();
    if !trimmed.starts_with("---") {
        return (None, text.to_string());
    }
    if let Some(end_pos) = trimmed[3..].find("\n---") {
        let yaml = trimmed[3..3 + end_pos].trim();
        let rest = trimmed[3 + end_pos + 4..].trim_start();
        return (Some(yaml.to_string()), rest.to_string());
    }
    (None, text.to_string())
}

/// Render YAML frontmatter as an HTML card
fn render_frontmatter_card(yaml: &str) -> String {
    let mut title = None;
    let mut rows = String::new();
    for line in yaml.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        if let Some((key, value)) = trimmed.split_once(':') {
            let key = key.trim();
            let value = value.trim().trim_matches('"').trim_matches('\'');
            if key.to_lowercase() == "title" {
                title = Some(value.to_string());
            } else {
                rows.push_str(&format!(
                    "<div class=\"frontmatter-row\"><span class=\"frontmatter-key\">{}</span><span class=\"frontmatter-value\">{}</span></div>",
                    escape_html(key), escape_html(value)
                ));
            }
        }
    }
    let title_html = title.map_or(String::new(), |t| {
        format!("<div class=\"frontmatter-title\">{}</div>", escape_html(&t))
    });
    format!(
        "<div class=\"frontmatter-card\">{}<div class=\"frontmatter-body\">{}</div></div>",
        title_html, rows
    )
}

// ============================================================================
// Math Post-processing - Restore math blocks as KaTeX markup
// ============================================================================

/// Post-process HTML to restore math blocks as KaTeX markup
fn postprocess_math(html: &str, math_blocks: &[(String, String, bool)]) -> String {
    let mut result = html.to_string();

    for (placeholder, content, is_block) in math_blocks {
        // Escape HTML in content
        let escaped_content = content
            .replace('&', "&amp;")
            .replace('<', "&lt;")
            .replace('>', "&gt;");

        if *is_block {
            // Block math: wrap in div with KaTeX class
            let replacement = format!("<div class=\"math-block\">$${}$$</div>", escaped_content);
            result = result.replace(placeholder, &replacement);
        } else {
            // Inline math: wrap in span with KaTeX class
            let replacement = format!("<span class=\"math-inline\">${}$</span>", escaped_content);
            result = result.replace(placeholder, &replacement);
        }
    }

    result
}

/// Escape HTML special characters
fn escape_html(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

/// Simple markdown to HTML renderer (body content only)
/// Now includes math preprocessing to protect LaTeX from markdown parsing
fn render_markdown_body(text: &str) -> String {
    use pulldown_cmark::{html::push_html, Event, Options, Parser, Tag, TagEnd};

    let (frontmatter, body) = extract_frontmatter(text);

    // Step 1: Pre-process to protect math blocks
    let (protected_body, math_blocks) = preprocess_math(&body);

    // Debug log for math preprocessing
    #[cfg(debug_assertions)]
    {
        if !math_blocks.is_empty() {
            println!(
                "[DEBUG render_markdown_body] Found {} math blocks",
                math_blocks.len()
            );
            for (placeholder, content, is_block) in &math_blocks {
                println!(
                    "[DEBUG] {} {}: {}",
                    if *is_block { "Block" } else { "Inline" },
                    placeholder,
                    content
                );
            }
        }
    }

    // Step 2: Parse protected text with GFM extensions
    let mut options = Options::empty();
    options.insert(Options::ENABLE_TABLES);
    options.insert(Options::ENABLE_STRIKETHROUGH);
    options.insert(Options::ENABLE_TASKLISTS);
    options.insert(Options::ENABLE_SMART_PUNCTUATION);

    let parser = Parser::new_ext(&protected_body, options);

    // Collect events and add fragment class to + list items for Reveal.js slides
    let mut events: Vec<Event> = Vec::new();
    let mut plus_list_stack: Vec<bool> = Vec::new();

    for (event, range) in parser.into_offset_iter() {
        match &event {
            Event::Start(Tag::List(None)) => {
                let is_plus = range.start < protected_body.len()
                    && protected_body[range.start..].starts_with("+ ");
                plus_list_stack.push(is_plus);
                events.push(event);
            }
            Event::Start(Tag::List(Some(_))) => {
                plus_list_stack.push(false);
                events.push(event);
            }
            Event::End(TagEnd::List(_)) => {
                plus_list_stack.pop();
                events.push(event);
            }
            Event::Start(Tag::Item) => {
                if plus_list_stack.last().copied().unwrap_or(false) {
                    events.push(Event::Html(r#"<li class="fragment">"#.into()));
                } else {
                    events.push(event);
                }
            }
            Event::End(TagEnd::Item) => {
                if plus_list_stack.last().copied().unwrap_or(false) {
                    events.push(Event::Html("</li>".into()));
                } else {
                    events.push(event);
                }
            }
            _ => {
                events.push(event);
            }
        }
    }

    let mut html = String::new();
    push_html(&mut html, events.into_iter());

    // Step 3: Post-process to restore math blocks
    html = postprocess_math(&html, &math_blocks);

    // Step 4: Process mermaid blocks
    html = postprocess_mermaid(&html);

    // Remove disabled attribute from task list checkboxes for interactivity
    html = html.replace(
        "<input disabled=\"\" type=\"checkbox\"",
        "<input type=\"checkbox\"",
    );
    html = html.replace(
        "<input disabled type=\"checkbox\"",
        "<input type=\"checkbox\"",
    );
    html = html.replace(
        "<input disabled=\"true\" type=\"checkbox\"",
        "<input type=\"checkbox\"",
    );

    if let Some(fm) = frontmatter {
        let card = render_frontmatter_card(&fm);
        return card + &html;
    }

    html
}

/// Extract Table of Contents from markdown content
#[tauri::command]
fn get_toc(content: &str) -> Vec<TocItem> {
    extract_toc(content)
}

/// Open a folder dialog and return selected folder path
/// Default location: ~/Documents/TyporaNext/Learning (created if missing)
#[tauri::command]
async fn open_folder_dialog(app: tauri::AppHandle) -> Result<String, String> {
    use tauri_plugin_dialog::DialogExt;

    // Best-effort default path: ~/Documents/TyporaNext/Learning
    // If unavailable (e.g. headless), fall back to the dialog's own default (cwd).
    let default_dir = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .ok()
        .map(|home| {
            std::path::PathBuf::from(home)
                .join("Documents")
                .join("TyporaNext")
                .join("Learning")
        });

    if let Some(ref dir) = default_dir {
        let _ = std::fs::create_dir_all(dir);
    }

    let builder = app.dialog().file();
    let builder = if let Some(ref dir) = default_dir {
        if dir.exists() {
            builder.set_directory(dir)
        } else {
            builder
        }
    } else {
        builder
    };

    let folder_path = builder.blocking_pick_folder();

    match folder_path {
        Some(path) => {
            let path_ref = path.as_path().unwrap_or(&std::path::Path::new(""));
            Ok(path_ref.display().to_string())
        }
        None => Err("No folder selected".to_string()),
    }
}

/// Sanitize a learning project slug into a safe ASCII directory name segment.
/// - Keep ASCII alphanumeric, dash, underscore
/// - Convert spaces to dashes
/// - Truncate to 60 chars
/// - Empty input → "learning-project"
fn sanitize_dir_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_' || *c == ' ')
        .collect();
    let collapsed = cleaned
        .split_whitespace()
        .collect::<Vec<_>>()
        .join("-")
        .to_ascii_lowercase();
    if collapsed.is_empty() {
        return "learning-project".to_string();
    }
    collapsed.chars().take(60).collect()
}

/// Create a dedicated subdirectory for a learning project under `parent_dir`.
/// Returns the absolute path of the created subdirectory.
/// If a directory with the same name already exists, appends a numeric suffix.
#[tauri::command]
async fn create_project_subdir(parent_dir: String, slug: String) -> Result<String, String> {
    let parent = std::path::PathBuf::from(&parent_dir);
    if !parent.exists() {
        return Err(format!("父目录不存在: {}", parent_dir));
    }
    if !parent.is_dir() {
        return Err(format!("不是目录: {}", parent_dir));
    }

    let base = sanitize_dir_name(&slug);
    let mut candidate = parent.join(&base);
    let mut suffix = 1;
    while candidate.exists() {
        suffix += 1;
        candidate = parent.join(format!("{}-{}", base, suffix));
    }

    std::fs::create_dir_all(&candidate).map_err(|e| format!("创建项目目录失败: {}", e))?;

    Ok(candidate.display().to_string())
}

/// List directory contents recursively (dirs + .md files)
#[tauri::command]
fn list_directory(path: String) -> Result<Vec<DirEntry>, String> {
    let path_buf = PathBuf::from(&path);
    if !path_buf.exists() {
        return Err(format!("Directory not found: {}", path));
    }
    if !path_buf.is_dir() {
        return Err(format!("Not a directory: {}", path));
    }

    let entries =
        read_dir_recursive(&path_buf).map_err(|e| format!("Failed to read directory: {}", e))?;

    Ok(entries)
}

fn read_dir_recursive(path: &std::path::Path) -> Result<Vec<DirEntry>, std::io::Error> {
    let mut entries = Vec::new();
    let mut dir_entries = Vec::new();

    for entry_result in fs::read_dir(path)? {
        let entry = entry_result?;
        let metadata = entry.metadata()?;
        let file_type = metadata.file_type();
        let name = entry.file_name().to_string_lossy().to_string();
        let child_path = entry.path().display().to_string();

        // Skip hidden files and directories
        if name.starts_with('.') {
            continue;
        }

        if file_type.is_dir() {
            dir_entries.push((name, child_path));
        } else if file_type.is_file() {
            // Only include markdown files
            if name.ends_with(".md") || name.ends_with(".markdown") {
                entries.push(DirEntry {
                    name,
                    path: child_path,
                    is_dir: false,
                    children: None,
                });
            }
        }
    }

    // Sort directories alphabetically and process them
    dir_entries.sort_by(|a, b| a.0.to_lowercase().cmp(&b.0.to_lowercase()));
    for (name, child_path) in dir_entries {
        let children = match read_dir_recursive(std::path::Path::new(&child_path)) {
            Ok(c) if !c.is_empty() => Some(c),
            _ => None,
        };
        entries.push(DirEntry {
            name,
            path: child_path,
            is_dir: true,
            children,
        });
    }

    // Sort files alphabetically (already sorted since we appended dirs first)
    // Actually, we need to sort the combined list
    entries.sort_by(|a, b| {
        // Directories first, then files
        match (a.is_dir, b.is_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
        }
    });

    Ok(entries)
}

/// Convert mermaid code blocks to proper format
fn postprocess_mermaid(html: &str) -> String {
    let start_marker = "<pre><code class=\"language-mermaid\">";
    let end_marker = "</code></pre>";

    let mut result = String::new();
    let mut remaining = html;

    while let Some(start_idx) = remaining.find(start_marker) {
        result.push_str(&remaining[..start_idx]);
        let after_start = &remaining[start_idx + start_marker.len()..];

        if let Some(end_idx) = after_start.find(end_marker) {
            result.push_str("<pre class=\"mermaid\">");
            result.push_str(&after_start[..end_idx]);
            result.push_str("</pre>");
            remaining = &after_start[end_idx + end_marker.len()..];
        } else {
            result.push_str(remaining);
            break;
        }
    }
    result.push_str(remaining);
    result
}

/// Extract headings from markdown as TOC
fn extract_toc(content: &str) -> Vec<TocItem> {
    let mut toc = Vec::new();

    for line in content.lines() {
        let trimmed = line.trim();

        // Check for heading markers
        if trimmed.starts_with('#') {
            let mut level = 0;
            for c in trimmed.chars() {
                if c == '#' {
                    level += 1;
                } else {
                    break;
                }
            }

            if level > 0 && level <= 6 {
                let text = trimmed[level..].trim().to_string();
                let slug = generate_slug(&text);
                toc.push(TocItem { level, text, slug });
            }
        }
    }

    toc
}

/// Generate a URL-safe slug from heading text
fn generate_slug(text: &str) -> String {
    text.to_lowercase()
        .chars()
        .map(|c| {
            if c.is_alphanumeric() {
                c
            } else if c == ' ' || c == '-' {
                '-'
            } else {
                ' '
            }
        })
        .collect::<String>()
        .replace(' ', "-")
        .trim_matches('-')
        .to_string()
}

/// Start watching a file for external changes
#[tauri::command]
fn watch_file(
    path: String,
    app: tauri::AppHandle,
    state: tauri::State<AppState>,
) -> Result<(), String> {
    // Stop any existing watcher first
    {
        let mut watcher_guard = state.watcher.lock().map_err(|e| e.to_string())?;
        *watcher_guard = None;
        let mut path_guard = state.watched_path.lock().map_err(|e| e.to_string())?;
        *path_guard = None;
    }

    let app_clone = app.clone();
    let path_for_event = path.clone();

    let watcher = RecommendedWatcher::new(
        move |res: Result<notify::Event, notify::Error>| match res {
            Ok(event) => {
                if matches!(event.kind, EventKind::Modify(_)) {
                    let _ = app_clone.emit("file-changed", path_for_event.clone());
                }
            }
            Err(e) => {
                eprintln!("Watch error: {:?}", e);
            }
        },
        Config::default(),
    )
    .map_err(|e| format!("Failed to create watcher: {}", e))?;

    let mut watcher_guard = state.watcher.lock().map_err(|e| e.to_string())?;
    let mut path_guard = state.watched_path.lock().map_err(|e| e.to_string())?;
    *watcher_guard = Some(watcher);
    *path_guard = Some(path.clone());

    // Now start watching
    if let Some(ref mut w) = watcher_guard.as_mut() {
        w.watch(PathBuf::from(&path).as_path(), RecursiveMode::NonRecursive)
            .map_err(|e| format!("Failed to watch file: {}", e))?;
    }

    Ok(())
}

/// Stop watching the current file
#[tauri::command]
fn unwatch_file(state: tauri::State<AppState>) -> Result<(), String> {
    let mut watcher_guard = state.watcher.lock().map_err(|e| e.to_string())?;
    *watcher_guard = None;
    let mut path_guard = state.watched_path.lock().map_err(|e| e.to_string())?;
    *path_guard = None;
    Ok(())
}

/// Get the config file path
fn config_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("Failed to get config dir: {}", e))?;
    std::fs::create_dir_all(&config_dir)
        .map_err(|e| format!("Failed to create config dir: {}", e))?;
    Ok(config_dir.join("config.json"))
}

/// Load application configuration
#[tauri::command]
fn get_config(app: tauri::AppHandle) -> Result<AppConfig, String> {
    let path = config_path(&app)?;
    if !path.exists() {
        return Ok(AppConfig::default());
    }
    let content = fs::read_to_string(&path).map_err(|e| format!("Failed to read config: {}", e))?;
    let config: AppConfig =
        serde_json::from_str(&content).map_err(|e| format!("Failed to parse config: {}", e))?;
    Ok(config)
}

/// Save application configuration
#[tauri::command]
fn set_config(config: AppConfig, app: tauri::AppHandle) -> Result<(), String> {
    let path = config_path(&app)?;
    let content = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;
    fs::write(&path, content).map_err(|e| format!("Failed to write config: {}", e))?;
    Ok(())
}

/// Test LLM configuration by making a simple API call
#[tauri::command]
async fn test_llm_config(config: AppConfig) -> Result<(), String> {
    let api_key = config
        .api_key
        .filter(|k| !k.is_empty())
        .ok_or("未设置 API Key")?;

    let provider = config.ai_provider.unwrap_or_default();
    let base_url = config
        .ai_base_url
        .filter(|u| !u.is_empty())
        .unwrap_or_else(|| match provider {
            AiProvider::Anthropic => "https://api.anthropic.com".to_string(),
            AiProvider::Openai => "https://api.openai.com".to_string(),
        });

    let model = config
        .model
        .filter(|m| !m.is_empty())
        .unwrap_or_else(|| match provider {
            AiProvider::Anthropic => "claude-3-5-haiku-20241022".to_string(),
            AiProvider::Openai => "gpt-4o-mini".to_string(),
        });

    let test_message = "Hello";

    match provider {
        AiProvider::Anthropic => {
            let url = format!("{}/v1/messages", base_url.trim_end_matches('/'));
            let req = serde_json::json!({
                "model": model,
                "max_tokens": 1,
                "messages": [{"role": "user", "content": test_message}]
            });
            let resp = ureq::post(&url)
                .set("Content-Type", "application/json")
                .set("x-api-key", &api_key)
                .set("anthropic-version", "2023-06-01")
                .send_json(req)
                .map_err(|e| format!("API 请求失败: {}", e))?;

            let _json: serde_json::Value = resp
                .into_json()
                .map_err(|e| format!("解析响应失败: {}", e))?;
        }
        AiProvider::Openai => {
            let url = format!("{}/v1/chat/completions", base_url.trim_end_matches('/'));
            let req = serde_json::json!({
                "model": model,
                "max_tokens": 1,
                "messages": [{"role": "user", "content": test_message}]
            });
            let resp = ureq::post(&url)
                .set("Content-Type", "application/json")
                .set("Authorization", &format!("Bearer {}", api_key))
                .send_json(req)
                .map_err(|e| format!("API 请求失败: {}", e))?;

            let _json: serde_json::Value = resp
                .into_json()
                .map_err(|e| format!("解析响应失败: {}", e))?;
        }
    };

    Ok(())
}

/// Get the current platform (windows, macos, linux)
#[tauri::command]
fn get_platform() -> String {
    std::env::consts::OS.to_string()
}

/// Application info for the About dialog
#[derive(Debug, Serialize)]
struct AppInfo {
    version: String,
    name: String,
    identifier: String,
    platform: String,
}

/// Get application version and metadata for the About dialog
#[tauri::command]
fn get_app_info(app: tauri::AppHandle) -> AppInfo {
    let package = app.package_info();
    AppInfo {
        version: package.version.to_string(),
        name: package.name.to_string(),
        identifier: app.config().identifier.clone(),
        platform: std::env::consts::OS.to_string(),
    }
}

/// Show the given file in the system file manager
#[tauri::command]
fn show_in_folder(path: String) -> Result<(), String> {
    let path_buf = PathBuf::from(&path);
    let os = std::env::consts::OS;

    let result = match os {
        "windows" => std::process::Command::new("explorer")
            .args(["/select,", &path])
            .spawn(),
        "macos" => std::process::Command::new("open")
            .args(["-R", &path])
            .spawn(),
        _ => {
            // Linux and others: open the parent directory
            let dir = path_buf
                .parent()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_else(|| path.clone());
            std::process::Command::new("xdg-open").arg(&dir).spawn()
        }
    };

    result
        .map(|_| ())
        .map_err(|e| format!("无法打开文件夹: {}", e))
}

/// Compute a relative path for an image within the share bundle
fn compute_share_relative_path(source: &std::path::Path, base_dir: &str, md_dir: &str) -> String {
    let source_str = source.to_string_lossy().replace("\\", "/");
    let base_str = base_dir
        .replace("\\", "/")
        .trim_end_matches('/')
        .to_string();
    let md_dir_str = md_dir.replace("\\", "/").trim_end_matches('/').to_string();

    if !base_str.is_empty() && source_str.starts_with(&base_str) {
        source_str[base_str.len()..]
            .trim_start_matches('/')
            .to_string()
    } else if !md_dir_str.is_empty() && source_str.starts_with(&md_dir_str) {
        source_str[md_dir_str.len()..]
            .trim_start_matches('/')
            .to_string()
    } else {
        source
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "image".to_string())
    }
}

/// SVG payload for a pre-rendered Mermaid diagram sent by the frontend.
#[derive(Debug, Deserialize)]
struct MermaidSvgInfo {
    svg: String,
    width: u32,
    height: u32,
}

fn system_font_db() -> Arc<fontdb::Database> {
    static DB: OnceLock<Arc<fontdb::Database>> = OnceLock::new();
    DB.get_or_init(|| {
        let mut db = fontdb::Database::new();
        db.load_system_fonts();
        Arc::new(db)
    })
    .clone()
}

/// Render an SVG string to a high-resolution PNG byte vector.
fn render_svg_to_png(svg: &str, logical_width: u32) -> Result<Vec<u8>, String> {
    const RENDER_SCALE: f32 = 3.0;

    let mut opts = usvg::Options::default();
    opts.fontdb = system_font_db();
    // Fallback font family when the SVG references an unavailable font.
    opts.font_family = "Arial".to_string();

    let tree = usvg::Tree::from_str(svg, &opts)
        .map_err(|e| format!("SVG parse failed: {}", e))?;

    let original_width = tree.size().width();
    let original_height = tree.size().height();
    if original_width <= 0.0 || original_height <= 0.0 {
        return Err("SVG has zero size".to_string());
    }

    let target_width = ((logical_width.max(1) as f32) * RENDER_SCALE).round() as u32;
    let target_height =
        ((target_width as f32) * original_height / original_width).round() as u32;

    let mut pixmap = tiny_skia::Pixmap::new(target_width, target_height.max(1))
        .ok_or("Cannot create pixmap")?;
    // Render onto a transparent background so the image blends with the Word page
    // instead of carrying a white rectangle around the diagram.
    pixmap.fill(tiny_skia::Color::from_rgba8(0, 0, 0, 0));

    // Scale the tree so the diagram actually fills the high-res pixmap. An
    // identity transform draws at the SVG's intrinsic 1× size in the corner,
    // leaving the diagram occupying only 1/RENDER_SCALE of the image.
    let scale = target_width as f32 / original_width;
    let transform = tiny_skia::Transform::from_scale(scale, scale);
    resvg::render(&tree, transform, &mut pixmap.as_mut());

    pixmap
        .encode_png()
        .map_err(|e| format!("PNG encode failed: {}", e))
}

/// Export markdown to Word document using the cross-platform Rust converter.
#[tauri::command]
async fn export_word(
    markdown: String,
    file_name: String,
    file_path: String,
    mermaid_images: Option<HashMap<String, MermaidSvgInfo>>,
    template_path: Option<String>,
    app: tauri::AppHandle,
) -> Result<String, String> {
    // Prepare local log
    let log_dir = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir());
    let _ = std::fs::create_dir_all(&log_dir);
    let log_path = log_dir.join("export.log");
    let log_export = |msg: &str| {
        if let Ok(mut f) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&log_path)
        {
            use std::io::Write;
            let _ = writeln!(f, "[{}] {}", chrono::Local::now().format("%H:%M:%S"), msg);
        }
    };

    log_export(&format!("[export_word] 开始导出: {}", file_name));

    let base_dir = std::path::Path::new(&file_path)
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| {
            std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("."))
        });

    let mermaid_bytes: HashMap<String, docx_export::MermaidImage> = mermaid_images
        .unwrap_or_default()
        .into_iter()
        .filter_map(|(source, info)| {
            let bytes = render_svg_to_png(&info.svg, info.width).ok()?;
            Some((
                source,
                docx_export::MermaidImage {
                    bytes,
                    width_px: info.width,
                    height_px: info.height,
                },
            ))
        })
        .collect();

    log_export(&format!(
        "[export_word] Mermaid 图片 {} 个",
        mermaid_bytes.len()
    ));

    let _ = app.emit(
        "export-progress",
        serde_json::json!({"stage": "docx", "percent": 60, "message": "正在生成 Word 文档..."}),
    );

    log_export("[export_word] 开始 markdown_to_docx...");

    use tokio::time::timeout;
    let docx_future = tokio::task::spawn_blocking(move || {
        docx_export::markdown_to_docx_with_mermaid(&markdown, &base_dir, &mermaid_bytes)
    });
    let bytes = timeout(std::time::Duration::from_secs(120), docx_future)
        .await
        .map_err(|_| {
            log_export("[export_word] 超时（>2分钟）");
            "DOCX 生成超时（超过 2 分钟），请检查文档是否包含过大表格或过多图片".to_string()
        })?
        .map_err(|e| {
            log_export(&format!("[export_word] 线程失败: {}", e));
            format!("DOCX 生成线程失败: {}", e)
        })?
        .map_err(|e| {
            log_export(&format!("[export_word] DOCX 生成失败: {}", e));
            format!("DOCX 生成失败: {}", e)
        })?;

    log_export(&format!(
        "[export_word] DOCX 生成完成: {} 字节",
        bytes.len()
    ));

    // Apply template styles/numbering if a template was provided.
    let bytes = if let Some(tp) = &template_path {
        log_export(&format!("[export_word] 应用模板: {}", tp));
        let tp_path = Path::new(tp);
        if tp_path.exists() {
            match docx_template::apply_template(&bytes, tp_path) {
                Ok(b) => {
                    log_export("[export_word] 模板应用成功");
                    b
                }
                Err(e) => {
                    log_export(&format!("[export_word] 模板应用失败: {}", e));
                    return Err(format!("模板应用失败: {}", e));
                }
            }
        } else {
            log_export("[export_word] 模板文件不存在，跳过");
            bytes
        }
    } else {
        bytes
    };

    let _ = app.emit(
        "export-progress",
        serde_json::json!({"stage": "dialog", "percent": 85, "message": "正在选择保存路径..."}),
    );

    let default_name = file_name
        .replace(".md", ".docx")
        .replace(".markdown", ".docx");

    use tauri_plugin_dialog::DialogExt;
    use tokio::sync::oneshot;

    let (tx, rx) = oneshot::channel();
    app.dialog()
        .file()
        .add_filter("Word Document", &["docx"])
        .set_file_name(&default_name)
        .save_file(move |path| {
            let _ = tx.send(path);
        });

    let file_path = rx.await.map_err(|_| "对话框通信失败".to_string())?;
    match file_path {
        Some(path) => {
            log_export(&format!("[export_word] 保存路径: {:?}", path.as_path()));
            let path_ref = path.as_path().unwrap_or(std::path::Path::new(""));
            std::fs::write(path_ref, &bytes).map_err(|e| format!("写入文件失败: {}", e))?;
            log_export("[export_word] 写入完成");
            let _ = app.emit(
                "export-progress",
                serde_json::json!({"stage": "done", "percent": 100, "message": "导出完成 ✓"}),
            );
            Ok(path_ref.display().to_string())
        }
        None => {
            log_export("[export_word] 用户取消");
            Err("用户取消了保存".to_string())
        }
    }
}

/// Share a markdown document with its embedded local images as a ZIP archive
#[tauri::command]
async fn share_document(
    content: String,
    file_path: String,
    base_dir: String,
    app: tauri::AppHandle,
) -> Result<String, String> {
    let md_path = PathBuf::from(&file_path);
    let md_name = md_path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "document.md".to_string());
    let md_dir = md_path
        .parent()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|| base_dir.clone());

    // Extract image references from markdown
    let md_img_re = Regex::new(r"!\[([^\]]*)\]\(([^)]+)\)").map_err(|e| e.to_string())?;
    let wiki_img_re = Regex::new(r"!\[\[([^\]]+)\]\]").map_err(|e| e.to_string())?;

    let mut image_refs: Vec<(String, String, String)> = Vec::new(); // (original, source_path, dest_relative)

    // Standard markdown images: ![alt](path)
    for cap in md_img_re.captures_iter(&content) {
        let original = cap[0].to_string();
        let path_str = cap[2].trim().to_string();
        if path_str.starts_with("http://") || path_str.starts_with("https://") {
            continue;
        }
        let source = if PathBuf::from(&path_str).is_absolute() {
            PathBuf::from(&path_str)
        } else {
            PathBuf::from(&md_dir).join(&path_str)
        };
        if source.exists() {
            let rel = compute_share_relative_path(&source, &base_dir, &md_dir);
            image_refs.push((original, source.to_string_lossy().to_string(), rel));
        }
    }

    // Obsidian WikiLink images: ![[path]]
    for cap in wiki_img_re.captures_iter(&content) {
        let original = cap[0].to_string();
        let target = cap[1].trim().to_string();
        if let Some(source) = resolve_wikilink_path(&target, &base_dir) {
            if source.exists() {
                let rel = compute_share_relative_path(&source, &base_dir, &md_dir);
                image_refs.push((original, source.to_string_lossy().to_string(), rel));
            }
        }
    }

    // Create temp directory
    let temp_dir = std::env::temp_dir().join(format!("typora-share-{}", std::process::id()));
    fs::create_dir_all(&temp_dir).map_err(|e| format!("创建临时目录失败: {}", e))?;

    // Copy images to temp directory maintaining relative structure
    for (_, source_path, dest_rel) in &image_refs {
        let source = PathBuf::from(source_path);
        let dest = temp_dir.join(dest_rel);
        if let Some(parent) = dest.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
        }
        fs::copy(&source, &dest).map_err(|e| format!("复制文件失败 {}: {}", source_path, e))?;
    }

    // Rewrite markdown content with relative image paths
    let mut rewritten = content.clone();
    for (original, _, dest_rel) in &image_refs {
        if original.starts_with("![[") {
            let target = &original[3..original.len() - 2];
            let name = PathBuf::from(target)
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| "image".to_string());
            let replacement = format!("![{}]({})", name, dest_rel);
            rewritten = rewritten.replace(original, &replacement);
        } else {
            let alt_end = original.find("](").unwrap_or(0);
            let alt = if alt_end > 2 {
                &original[2..alt_end]
            } else {
                ""
            };
            let replacement = format!("![{}]({})", alt, dest_rel);
            rewritten = rewritten.replace(original, &replacement);
        }
    }

    // Write rewritten markdown to temp directory
    let md_dest = temp_dir.join(&md_name);
    fs::write(&md_dest, rewritten).map_err(|e| format!("写入文件失败: {}", e))?;

    // Create zip archive
    let zip_name = format!(
        "{}.zip",
        md_name.replace(".md", "").replace(".markdown", "")
    );
    let zip_path = temp_dir.join(&zip_name);
    let zip_file = fs::File::create(&zip_path).map_err(|e| format!("创建zip文件失败: {}", e))?;
    let mut zip = zip::ZipWriter::new(zip_file);
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);

    use std::io::Read;
    for entry in walkdir::WalkDir::new(&temp_dir) {
        let entry = entry.map_err(|e| format!("遍历目录失败: {}", e))?;
        let path = entry.path();
        if path == temp_dir || path == zip_path {
            continue;
        }
        let name = path
            .strip_prefix(&temp_dir)
            .map_err(|e| format!("路径处理失败: {}", e))?
            .to_string_lossy();
        if path.is_file() {
            zip.start_file(name, options)
                .map_err(|e| format!("添加文件到zip失败: {}", e))?;
            let mut file = fs::File::open(path).map_err(|e| format!("打开文件失败: {}", e))?;
            let mut buffer = Vec::new();
            file.read_to_end(&mut buffer)
                .map_err(|e| format!("读取文件失败: {}", e))?;
            zip.write_all(&buffer)
                .map_err(|e| format!("写入zip失败: {}", e))?;
        }
    }
    zip.finish().map_err(|e| format!("完成zip失败: {}", e))?;

    // Show save dialog
    use tauri_plugin_dialog::DialogExt;
    let save_path = app
        .dialog()
        .file()
        .add_filter("ZIP 文件", &["zip"])
        .set_file_name(&zip_name)
        .blocking_save_file();

    match save_path {
        Some(path_ref) => {
            let dest = path_ref.as_path().unwrap_or(std::path::Path::new(""));
            fs::copy(&zip_path, dest).map_err(|e| format!("保存文件失败: {}", e))?;
            let _ = fs::remove_dir_all(&temp_dir);
            Ok(dest.display().to_string())
        }
        None => {
            let _ = fs::remove_dir_all(&temp_dir);
            Err("用户取消保存".to_string())
        }
    }
}

// ============================================
// Paper import: PDF / URL → Markdown
// ============================================

/// Import a local PDF file as a paper Markdown.
#[tauri::command]
async fn import_paper_from_pdf(
    app_handle: tauri::AppHandle,
) -> Result<paper_import::PaperImportResult, String> {
    use tauri_plugin_dialog::DialogExt;

    let file_path = app_handle
        .dialog()
        .file()
        .add_filter("PDF", &["pdf"])
        .blocking_pick_file();

    let path_ref = match file_path {
        Some(path) => path.as_path().map(|p| p.to_path_buf()).unwrap_or_default(),
        None => return Err("No file selected".to_string()),
    };

    if !path_ref.exists() {
        return Err("选择的文件不存在".to_string());
    }

    let bytes = std::fs::read(&path_ref).map_err(|e| format!("读取 PDF 文件失败: {}", e))?;

    let source_name = path_ref
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("paper.pdf")
        .to_string();

    let project_dir = path_ref.parent().map(|p| p.display().to_string());

    import_paper_inner(
        paper_import::mineru::SubmitTarget::LocalFile {
            name: source_name.clone(),
            bytes,
        },
        &source_name,
        project_dir.as_deref(),
        &app_handle,
    )
    .await
}

/// Import a paper from a URL (arXiv or direct PDF link).
#[tauri::command]
async fn import_paper_from_url(
    url: String,
    app_handle: tauri::AppHandle,
) -> Result<paper_import::PaperImportResult, String> {
    let normalized_url =
        paper_import::arxiv::normalize_paper_url(&url).map_err(|e| format!("URL 不支持: {}", e))?;

    let source_name = paper_import::arxiv::source_name_from_url(&normalized_url);

    import_paper_inner(
        paper_import::mineru::SubmitTarget::Url(normalized_url),
        &source_name,
        None,
        &app_handle,
    )
    .await
}

/// Query the status of an in-flight import task.
///
/// Currently the import commands block until completion, so this command
/// mostly exists for future async progress reporting.
#[tauri::command]
async fn get_paper_import_status(task_id: String) -> Result<paper_import::ImportStatus, String> {
    log::info!("[paper_import] get_paper_import_status: {}", task_id);
    Ok(paper_import::ImportStatus::unknown())
}

/// Recursively copy the contents of `src` into `dst`, preserving the
/// directory structure. Overwrites existing files.
fn copy_dir_all(src: &std::path::Path, dst: &std::path::Path) -> Result<(), String> {
    std::fs::create_dir_all(dst).map_err(|e| format!("创建目标目录失败: {}", e))?;

    for entry in std::fs::read_dir(src).map_err(|e| format!("读取源目录失败: {}", e))? {
        let entry = entry.map_err(|e| format!("读取目录项失败: {}", e))?;
        let path = entry.path();
        let target = dst.join(entry.file_name());

        if path.is_dir() {
            copy_dir_all(&path, &target)?;
        } else {
            std::fs::copy(&path, &target).map_err(|e| {
                format!(
                    "复制文件失败 {} -> {}: {}",
                    path.display(),
                    target.display(),
                    e
                )
            })?;
        }
    }

    Ok(())
}

async fn import_paper_inner(
    target: paper_import::mineru::SubmitTarget,
    source_name: &str,
    project_dir: Option<&str>,
    app_handle: &tauri::AppHandle,
) -> Result<paper_import::PaperImportResult, String> {
    let config = get_config(app_handle.clone())?;
    let client = paper_import::mineru::MineruClient::from_config(&config)
        .map_err(|e| format!("配置错误: {}", e))?;

    log::info!("[paper_import] submitting {} to minerU", source_name);
    let handle = client
        .submit(target)
        .map_err(|e| paper_import::user_facing_error("提交 minerU 任务失败", Some(&e)))?;

    log::info!("[paper_import] polling minerU task...");
    let poll_result = client
        .poll_until_done(&handle)
        .map_err(|e| paper_import::user_facing_error("解析失败", Some(&e)))?;

    let zip_url = poll_result
        .full_zip_url
        .ok_or_else(|| "minerU 未返回结果下载链接".to_string())?;

    let temp_dir = std::env::temp_dir().join(format!(
        "typora-paper-import-{}-{}",
        std::process::id(),
        chrono::Local::now().format("%Y%m%d%H%M%S")
    ));

    let cleanup = |dir: &std::path::Path| {
        if let Err(e) = std::fs::remove_dir_all(dir) {
            log::warn!(
                "[paper_import] failed to cleanup temp dir {}: {}",
                dir.display(),
                e
            );
        }
    };

    let result = async {
        std::fs::create_dir_all(&temp_dir).map_err(|e| format!("创建临时目录失败: {}", e))?;

        let zip_path = temp_dir.join("result.zip");
        let extract_dir = temp_dir.join("extracted");

        log::info!("[paper_import] downloading result zip...");
        client
            .download_zip(&zip_url, &zip_path)
            .map_err(|e| paper_import::user_facing_error("下载解析结果失败", Some(&e)))?;

        log::info!("[paper_import] extracting full.md...");
        let md_path_in_zip =
            paper_import::mineru::MineruClient::extract_full_md(&zip_path, &extract_dir)
                .map_err(|e| paper_import::user_facing_error("解压解析结果失败", Some(&e)))?;

        let md_content = std::fs::read_to_string(&md_path_in_zip)
            .map_err(|e| format!("读取解析后的 Markdown 失败: {}", e))?;

        let papers_dir = paper_import::resolve_papers_dir(app_handle, project_dir)?;
        let saved_path = paper_import::storage::save_paper_md(
            &papers_dir,
            None, // TODO: extract title from PDF metadata or first heading
            source_name,
            &md_content,
        )
        .map_err(|e| format!("保存论文 Markdown 失败: {}", e))?;

        // Copy any extracted assets (e.g. images/) next to the saved markdown so
        // relative references like ![](images/xxx.jpg) resolve correctly.
        if let Some(md_parent) = md_path_in_zip.parent() {
            let images_dir = md_parent.join("images");
            if images_dir.is_dir() {
                let target_images_dir = saved_path
                    .parent()
                    .map(|p| p.join("images"))
                    .unwrap_or_else(|| papers_dir.join("images"));
                if let Err(e) = copy_dir_all(&images_dir, &target_images_dir) {
                    log::warn!("[paper_import] failed to copy images dir: {}", e);
                } else {
                    log::info!(
                        "[paper_import] copied images to {}",
                        target_images_dir.display()
                    );
                }
            }
        }

        log::info!("[paper_import] saved paper to {}", saved_path.display());

        Ok(paper_import::PaperImportResult {
            md_path: saved_path.display().to_string(),
            md_content,
            title: None,
        })
    }
    .await;

    cleanup(&temp_dir);
    result
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
struct RecentFileEntry {
    path: String,
    #[serde(default = "default_recent_mode")]
    mode: String,
}

fn default_recent_mode() -> String {
    "normal".to_string()
}

/// Get list of recently opened files
#[tauri::command]
async fn get_recent_files(app: tauri::AppHandle) -> Result<Vec<RecentFileEntry>, String> {
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("无法获取配置目录: {}", e))?;
    let file_path = config_dir.join("recent_files.json");

    if !file_path.exists() {
        return Ok(Vec::new());
    }

    let content =
        std::fs::read_to_string(&file_path).map_err(|e| format!("读取最近文件列表失败: {}", e))?;

    // Try new format first, fall back to legacy flat string array.
    let mut entries: Vec<RecentFileEntry> =
        match serde_json::from_str::<Vec<RecentFileEntry>>(&content) {
            Ok(entries) => entries,
            Err(_) => {
                let legacy: Vec<String> = serde_json::from_str(&content)
                    .map_err(|e| format!("解析最近文件列表失败: {}", e))?;
                legacy
                    .into_iter()
                    .map(|path| RecentFileEntry {
                        path,
                        mode: "normal".to_string(),
                    })
                    .collect()
            }
        };

    // Infer mode for legacy/normal entries that point to learning projects.
    for entry in entries.iter_mut() {
        if entry.mode == "normal" && is_learning_project(&entry.path) {
            entry.mode = "learning".to_string();
        }
    }

    Ok(entries)
}

/// Check whether a path belongs to a learning project.
/// For directories: checks for a `.learning/project.json` file directly inside.
/// For files: walks up parent directories looking for `.learning/project.json`.
fn is_learning_project(path: &str) -> bool {
    let p = std::path::PathBuf::from(path);
    if !p.exists() {
        return false;
    }
    if p.is_dir() {
        return p.join(".learning").join("project.json").is_file();
    }
    // File path: walk up until we find a learning project root.
    let mut dir = match p.parent() {
        Some(parent) => parent.to_path_buf(),
        None => return false,
    };
    loop {
        if dir.join(".learning").join("project.json").is_file() {
            return true;
        }
        match dir.parent() {
            Some(parent) => dir = parent.to_path_buf(),
            None => return false,
        }
    }
}

/// Add a file to recent files list
#[tauri::command]
async fn add_recent_file(
    path: String,
    mode: Option<String>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("无法获取配置目录: {}", e))?;
    let file_path = config_dir.join("recent_files.json");

    let mut entries: Vec<RecentFileEntry> = if file_path.exists() {
        let content = std::fs::read_to_string(&file_path)
            .map_err(|e| format!("读取最近文件列表失败: {}", e))?;
        match serde_json::from_str::<Vec<RecentFileEntry>>(&content) {
            Ok(entries) => entries,
            Err(_) => {
                let legacy: Vec<String> = serde_json::from_str(&content)
                    .map_err(|e| format!("解析最近文件列表失败: {}", e))?;
                legacy
                    .into_iter()
                    .map(|path| RecentFileEntry {
                        path,
                        mode: "normal".to_string(),
                    })
                    .collect()
            }
        }
    } else {
        Vec::new()
    };

    // Infer mode for legacy/normal entries that point to learning projects.
    for entry in entries.iter_mut() {
        if entry.mode == "normal" && is_learning_project(&entry.path) {
            entry.mode = "learning".to_string();
        }
    }

    let mode = mode.unwrap_or_else(|| "normal".to_string());
    // Remove existing entry if present
    entries.retain(|e| e.path != path);
    // Add to front
    entries.insert(0, RecentFileEntry { path, mode });
    // Limit to 20
    if entries.len() > 20 {
        entries.truncate(20);
    }

    let json = serde_json::to_string_pretty(&entries)
        .map_err(|e| format!("序列化最近文件列表失败: {}", e))?;

    std::fs::write(&file_path, json).map_err(|e| format!("保存最近文件列表失败: {}", e))?;

    Ok(())
}

/// Clear recent files list
#[tauri::command]
async fn clear_recent_files(app: tauri::AppHandle) -> Result<(), String> {
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("无法获取配置目录: {}", e))?;
    let file_path = config_dir.join("recent_files.json");

    let files: Vec<RecentFileEntry> = Vec::new();
    let json = serde_json::to_string_pretty(&files)
        .map_err(|e| format!("序列化最近文件列表失败: {}", e))?;

    std::fs::write(&file_path, json).map_err(|e| format!("保存最近文件列表失败: {}", e))?;

    Ok(())
}

/// Write content to a file
#[tauri::command]
async fn write_file(path: String, content: String, encoding: Option<String>) -> Result<(), String> {
    match encoding.as_deref() {
        Some("base64") => {
            use base64::Engine;
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(&content)
                .map_err(|e| format!("Failed to decode base64: {}", e))?;
            fs::write(&path, bytes).map_err(|e| format!("Failed to write file: {}", e))?;
        }
        _ => {
            fs::write(&path, content).map_err(|e| format!("Failed to write file: {}", e))?;
        }
    }
    Ok(())
}

/// Simple file-based logger for slides debugging
fn log_to_file(msg: &str) {
    if let Ok(exe) = std::env::current_exe() {
        let log_path = exe
            .parent()
            .unwrap_or(std::path::Path::new("."))
            .join("slides_debug.log");
        let line = format!("{}\n", msg);
        let _ = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&log_path)
            .and_then(|mut f| std::io::Write::write_all(&mut f, line.as_bytes()));
    }
}

/// Open a new window for slide presentation
#[tauri::command]
fn open_slides_window(content: String, app: tauri::AppHandle) -> Result<(), String> {
    log_to_file(&format!(
        "[SLIDES] open_slides_window called, content len={}",
        content.len()
    ));

    // Serialize content as JSON string to safely inject into JS
    let json_content = serde_json::to_string(&content)
        .map_err(|e| format!("Failed to serialize content: {}", e))?;
    let script = format!("window.__slides_content = {};", json_content);
    log_to_file(&format!("[SLIDES] injection script len={}", script.len()));

    // If slides window already exists, update content and focus it
    if let Some(window) = app.get_webview_window("slides") {
        log_to_file("[SLIDES] existing window found, updating content");
        let _ = window.eval(&script);
        let _ = window
            .eval("if (typeof window.__reloadSlides === 'function') { window.__reloadSlides(); }");
        window.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }

    log_to_file("[SLIDES] creating new window");

    // Try to find the correct resource path
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("Failed to get resource dir: {}", e))?;
    log_to_file(&format!("[SLIDES] resource_dir={:?}", resource_dir));

    // Try multiple possible paths (cargo build --release puts exe in target/release/)
    let possible_paths = [
        resource_dir.join("../../../dist/slides.html"), // from src-tauri/target/release/
        resource_dir.join("../../dist/slides.html"),    // from target/release/
        resource_dir.join("dist/slides.html"),          // from project root
    ];
    let slides_path = possible_paths
        .iter()
        .find(|path| {
            let clean = path.to_string_lossy().replace("\\\\?\\", "");
            log_to_file(&format!("[SLIDES] trying path={}", clean));
            path.exists()
        })
        .map(|p| p.to_string_lossy().replace("\\\\?\\", ""));

    if let Some(ref p) = slides_path {
        log_to_file(&format!("[SLIDES] found slides.html at {}", p));
    }

    // Build window with App URL (file:// crashes WebView2)
    log_to_file("[SLIDES] building WebviewWindowBuilder with App URL");
    // DEBUG: try index.html first to isolate the issue
    let test_url = "index.html";
    log_to_file(&format!("[SLIDES] using WebviewUrl::App({})", test_url));
    let builder =
        tauri::WebviewWindowBuilder::new(&app, "slides", tauri::WebviewUrl::App(test_url.into()))
            .title("幻灯片放映")
            .inner_size(1280.0, 720.0)
            .min_inner_size(800.0, 600.0);

    log_to_file("[SLIDES] calling build()...");
    let window = builder
        .build()
        .map_err(|e| format!("无法创建幻灯片窗口: {}", e))?;

    log_to_file(&format!(
        "[SLIDES] window created OK, label={}",
        window.label()
    ));

    // Inject content via eval after a short delay (avoid initialization_script crash)
    let window_clone = window.clone();
    let script_clone = script.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(500));
        let _ = window_clone.eval(&script_clone);
        let _ = window_clone
            .eval("if (typeof window.__reloadSlides === 'function') { window.__reloadSlides(); }");
    });

    Ok(())
}

/// Fix Mermaid syntax errors using AI
#[tauri::command]
async fn fix_mermaid(code: String, error: String, app: tauri::AppHandle) -> Result<String, String> {
    let config = get_config(app)?;
    let api_key = config
        .api_key
        .filter(|k| !k.is_empty())
        .ok_or("未设置 API Key，请在设置中配置")?;

    let provider = config.ai_provider.unwrap_or_default();
    let base_url = config
        .ai_base_url
        .filter(|u| !u.is_empty())
        .unwrap_or_else(|| match provider {
            AiProvider::Anthropic => "https://api.anthropic.com".to_string(),
            AiProvider::Openai => "https://api.openai.com".to_string(),
        });

    let model = config
        .model
        .filter(|m| !m.is_empty())
        .unwrap_or_else(|| match provider {
            AiProvider::Anthropic => "claude-3-5-haiku-20241022".to_string(),
            AiProvider::Openai => "gpt-4o-mini".to_string(),
        });

    let prompt = format!(
        "你是 Mermaid 图表专家。以下 Mermaid 代码有语法错误，请修复它。\n\n错误信息: {}\n\n原始代码:\n```mermaid\n{}\n```\n\n请只返回修复后的 Mermaid 代码（不要包含 ```mermaid 标记，不要解释，只返回纯代码）。",
        error, code
    );

    // Build request based on provider
    let (response, is_anthropic) = match provider {
        AiProvider::Anthropic => {
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
        AiProvider::Openai => {
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

    let json: serde_json::Value = response
        .into_json()
        .map_err(|e| format!("解析响应失败: {}", e))?;

    let fixed_code = if is_anthropic {
        json["content"][0]["text"].as_str()
    } else {
        json["choices"][0]["message"]["content"].as_str()
    }
    .ok_or("响应中没有内容")?;

    // Clean up markdown code fences if present
    let cleaned = fixed_code
        .trim()
        .trim_start_matches("```mermaid")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim();

    Ok(cleaned.to_string())
}

// ============================================
// Translation Cache
// ============================================

fn text_hash(text: &str) -> String {
    let mut hasher = DefaultHasher::new();
    text.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

fn cache_key(file_path: &str, target_lang: &str, text: &str) -> String {
    format!("{}|{}|{}", file_path, target_lang, text_hash(text))
}

fn get_translation_cache_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let cache_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("无法获取应用数据目录: {}", e))?;
    Ok(cache_dir.join("translation_cache.json"))
}

fn load_translation_cache(
    app: &tauri::AppHandle,
) -> Result<serde_json::Map<String, serde_json::Value>, String> {
    let path = get_translation_cache_path(app)?;
    if !path.exists() {
        return Ok(serde_json::Map::new());
    }
    let content = fs::read_to_string(&path).map_err(|e| format!("读取翻译缓存失败: {}", e))?;
    let value: serde_json::Value =
        serde_json::from_str(&content).map_err(|e| format!("解析翻译缓存失败: {}", e))?;
    match value {
        serde_json::Value::Object(map) => Ok(map),
        _ => Ok(serde_json::Map::new()),
    }
}

fn save_translation_cache(
    app: &tauri::AppHandle,
    cache: &serde_json::Map<String, serde_json::Value>,
) -> Result<(), String> {
    let path = get_translation_cache_path(app)?;
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let value = serde_json::Value::Object(cache.clone());
    let content =
        serde_json::to_string_pretty(&value).map_err(|e| format!("序列化翻译缓存失败: {}", e))?;
    fs::write(&path, content).map_err(|e| format!("写入翻译缓存失败: {}", e))
}

/// Translate multiple text segments using AI
#[tauri::command]
async fn translate_text(
    texts: Vec<String>,
    target_lang: String,
    file_path: Option<String>,
    app: tauri::AppHandle,
) -> Result<Vec<String>, String> {
    if texts.is_empty() {
        return Ok(Vec::new());
    }

    let mut cache = if file_path.is_some() {
        load_translation_cache(&app).unwrap_or_else(|_| serde_json::Map::new())
    } else {
        serde_json::Map::new()
    };

    let mut result = vec![String::new(); texts.len()];
    let mut uncached_indices = Vec::new();
    let mut uncached_texts = Vec::new();

    if let Some(ref path) = file_path {
        for (i, text) in texts.iter().enumerate() {
            let key = cache_key(path, &target_lang, text);
            if let Some(cached) = cache.get(&key).and_then(|v| v.as_str()) {
                result[i] = cached.to_string();
            } else {
                uncached_indices.push(i);
                uncached_texts.push(text.clone());
            }
        }
    } else {
        uncached_indices = (0..texts.len()).collect();
        uncached_texts = texts.clone();
    }

    if uncached_texts.is_empty() {
        return Ok(result);
    }

    let config = get_config(app.clone())?;
    let api_key = config
        .api_key
        .filter(|k| !k.is_empty())
        .ok_or("未设置 API Key，请在设置中配置")?;

    let provider = config.ai_provider.unwrap_or_default();
    let base_url = config
        .ai_base_url
        .filter(|u| !u.is_empty())
        .unwrap_or_else(|| match provider {
            AiProvider::Anthropic => "https://api.anthropic.com".to_string(),
            AiProvider::Openai => "https://api.openai.com".to_string(),
        });

    let model = config
        .model
        .filter(|m| !m.is_empty())
        .unwrap_or_else(|| match provider {
            AiProvider::Anthropic => "claude-3-5-haiku-20241022".to_string(),
            AiProvider::Openai => "gpt-4o-mini".to_string(),
        });

    let joined_texts = uncached_texts
        .iter()
        .enumerate()
        .map(|(i, text)| format!("段落 {}:\n{}", i + 1, text))
        .collect::<Vec<_>>()
        .join("\n\n");

    let prompt = format!(
        "请将以下文本翻译成 {}。保持 Markdown 格式、代码块标签和特殊符号不变。按顺序逐条返回译文，每条之间用 ---TRANSLATION--- 分隔。\n\n{}",
        target_lang, joined_texts
    );

    let (response, is_anthropic) = match provider {
        AiProvider::Anthropic => {
            let url = format!("{}/v1/messages", base_url.trim_end_matches('/'));
            let req = serde_json::json!({
                "model": model,
                "max_tokens": 4096,
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
        AiProvider::Openai => {
            let url = format!("{}/v1/chat/completions", base_url.trim_end_matches('/'));
            let req = serde_json::json!({
                "model": model,
                "max_tokens": 4096,
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

    let json: serde_json::Value = response
        .into_json()
        .map_err(|e| format!("解析响应失败: {}", e))?;

    let content = if is_anthropic {
        json["content"][0]["text"].as_str()
    } else {
        json["choices"][0]["message"]["content"].as_str()
    }
    .ok_or("响应中没有内容")?;

    let api_translations: Vec<String> = content
        .split("---TRANSLATION---")
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();

    if api_translations.len() != uncached_texts.len() {
        for &i in &uncached_indices {
            result[i] = texts[i].clone();
        }
        return Ok(result);
    }

    for (j, &i) in uncached_indices.iter().enumerate() {
        result[i] = api_translations[j].clone();
        if let Some(ref path) = file_path {
            let key = cache_key(path, &target_lang, &texts[i]);
            cache.insert(key, serde_json::Value::String(api_translations[j].clone()));
        }
    }

    if file_path.is_some() {
        let _ = save_translation_cache(&app, &cache);
    }

    Ok(result)
}

// ============================================
// Annotations
// ============================================

#[derive(Debug, Serialize, Deserialize, Clone)]
struct Annotation {
    id: String,
    text: String,
    #[serde(rename = "textHash", default)]
    text_hash: String,
    #[serde(default = "default_color")]
    color: String,
    #[serde(default = "default_style")]
    style: String,
    #[serde(default)]
    note: String,
    #[serde(rename = "createdAt")]
    created_at: String,
}

fn default_color() -> String {
    "#ffeb3b".to_string()
}

fn default_style() -> String {
    "highlight".to_string()
}

fn get_annotations_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("无法获取应用数据目录: {}", e))?;
    let dir = data_dir.join("annotations");
    let _ = fs::create_dir_all(&dir);
    Ok(dir)
}

fn annotations_file_path(app: &tauri::AppHandle, file_path: &str) -> Result<PathBuf, String> {
    let dir = get_annotations_dir(app)?;
    let file_hash = format!("{:016x}", {
        let mut hasher = DefaultHasher::new();
        file_path.hash(&mut hasher);
        hasher.finish()
    });
    let path = dir.join(format!("{}.json", file_hash));
    println!(
        "[DEBUG annotations_file_path] input='{}' hash='{}' path='{}'",
        file_path,
        file_hash,
        path.display()
    );
    Ok(path)
}

fn load_annotations(app: &tauri::AppHandle, file_path: &str) -> Result<Vec<Annotation>, String> {
    let path = annotations_file_path(app, file_path)?;
    if !path.exists() {
        println!(
            "[DEBUG load_annotations] file not exists, returning empty. path='{}'",
            path.display()
        );
        return Ok(Vec::new());
    }
    let content = fs::read_to_string(&path).map_err(|e| format!("读取批注失败: {}", e))?;
    println!(
        "[DEBUG load_annotations] raw content length={}, path='{}'",
        content.len(),
        path.display()
    );
    let value: serde_json::Value =
        serde_json::from_str(&content).map_err(|e| format!("解析批注失败: {}", e))?;
    match value.get("annotations") {
        Some(arr) => {
            let anns: Vec<Annotation> = serde_json::from_value(arr.clone())
                .map_err(|e| format!("解析批注数组失败: {}", e))?;
            println!("[DEBUG load_annotations] loaded {} annotations", anns.len());
            for (i, ann) in anns.iter().enumerate() {
                println!(
                    "[DEBUG load_annotations] #{} id='{}' text_len={} text_hash='{}' note_len={}",
                    i,
                    ann.id,
                    ann.text.len(),
                    ann.text_hash,
                    ann.note.len()
                );
            }
            Ok(anns)
        }
        None => {
            println!("[DEBUG load_annotations] no 'annotations' key found");
            Ok(Vec::new())
        }
    }
}

fn save_annotations_file(
    app: &tauri::AppHandle,
    file_path: &str,
    annotations: &[Annotation],
) -> Result<(), String> {
    let path = annotations_file_path(app, file_path)?;
    let value = serde_json::json!({ "annotations": annotations });
    let content =
        serde_json::to_string_pretty(&value).map_err(|e| format!("序列化批注失败: {}", e))?;
    println!(
        "[DEBUG save_annotations_file] writing {} annotations to '{}'",
        annotations.len(),
        path.display()
    );
    fs::write(&path, content).map_err(|e| format!("写入批注失败: {}", e))?;
    println!("[DEBUG save_annotations_file] write ok");
    Ok(())
}

#[tauri::command]
async fn get_annotations(
    file_path: String,
    app: tauri::AppHandle,
) -> Result<Vec<Annotation>, String> {
    println!("[DEBUG get_annotations] file_path='{}'", file_path);
    let result = load_annotations(&app, &file_path);
    match &result {
        Ok(anns) => println!(
            "[DEBUG get_annotations] returning {} annotations",
            anns.len()
        ),
        Err(e) => println!("[DEBUG get_annotations] error: {}", e),
    }
    result
}

#[tauri::command]
async fn add_annotation(
    file_path: String,
    mut annotation: Annotation,
    app: tauri::AppHandle,
) -> Result<(), String> {
    println!(
        "[DEBUG add_annotation] file_path='{}' id='{}' text_len={}",
        file_path,
        annotation.id,
        annotation.text.len()
    );
    annotation.text_hash = text_hash(&annotation.text);
    println!(
        "[DEBUG add_annotation] computed text_hash='{}'",
        annotation.text_hash
    );
    let mut annotations = load_annotations(&app, &file_path)?;
    annotations.push(annotation);
    save_annotations_file(&app, &file_path, &annotations)
}

#[tauri::command]
async fn delete_annotation(
    file_path: String,
    id: String,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let mut annotations = load_annotations(&app, &file_path)?;
    annotations.retain(|a| a.id != id);
    save_annotations_file(&app, &file_path, &annotations)
}

#[tauri::command]
async fn update_annotation_note(
    file_path: String,
    id: String,
    note: String,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let mut annotations = load_annotations(&app, &file_path)?;
    if let Some(ann) = annotations.iter_mut().find(|a| a.id == id) {
        ann.note = note;
    }
    save_annotations_file(&app, &file_path, &annotations)
}

#[tauri::command]
async fn update_annotation(
    file_path: String,
    id: String,
    color: Option<String>,
    style: Option<String>,
    note: Option<String>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    println!(
        "[DEBUG update_annotation] id='{}' color={:?} style={:?} note_len={:?}",
        id,
        color,
        style,
        note.as_ref().map(|n| n.len())
    );
    let mut annotations = load_annotations(&app, &file_path)?;
    if let Some(ann) = annotations.iter_mut().find(|a| a.id == id) {
        if let Some(c) = color {
            ann.color = c;
        }
        if let Some(s) = style {
            ann.style = s;
        }
        if let Some(n) = note {
            ann.note = n;
        }
    }
    save_annotations_file(&app, &file_path, &annotations)
}

/// Create .learning/project.json for a learning project
#[tauri::command]
fn create_learning_project(
    project_path: String,
    outline: serde_json::Value,
    goal: Option<String>,
) -> Result<String, String> {
    let path = std::path::PathBuf::from(&project_path);
    let learning_dir = path.join(".learning");
    let json_path = learning_dir.join("project.json");

    // Don't overwrite existing project
    if json_path.exists() {
        return Ok(json_path.to_string_lossy().to_string());
    }

    std::fs::create_dir_all(&learning_dir)
        .map_err(|e| format!("Failed to create .learning directory: {}", e))?;

    let chapters = outline["chapters"]
        .as_array()
        .ok_or("outline.chapters must be an array")?;

    let project = serde_json::json!({
        "name": goal.unwrap_or_else(|| {
            chapters.first()
                .and_then(|c| c["title"].as_str())
                .unwrap_or("Learning Project")
                .to_string()
        }),
        "created": std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0),
        "chapters": chapters.iter().enumerate().map(|(i, ch)| {
            serde_json::json!({
                "title": ch["title"].as_str().unwrap_or(&format!("第 {} 章", i + 1)),
                "duration_minutes": ch["duration_minutes"].as_u64().unwrap_or(0),
                "concepts": ch["concepts"].as_array().map(|arr| {
                    arr.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect::<Vec<_>>()
                }).unwrap_or_default(),
                // Note: v2 schema — status is stored in chapters_status map, NOT here
                "file": null
            })
        }).collect::<Vec<_>>(),
        "total_duration": outline["total_duration"].as_u64().unwrap_or_else(|| {
            chapters.iter().map(|c| c["duration_minutes"].as_u64().unwrap_or(0)).sum()
        })
    });

    let json_str = serde_json::to_string_pretty(&project)
        .map_err(|e| format!("Failed to serialize project: {}", e))?;

    std::fs::write(&json_path, json_str)
        .map_err(|e| format!("Failed to write project.json: {}", e))?;

    Ok(json_path.to_string_lossy().to_string())
}

// ============================================
// Sprint N+1: create_project_with_session (Phase B)
// Atomically: create project folder + project.json + initialize agent session
// Returns the agent's session_id (host persists to .learning/agent-session.json)
// ============================================

/// Create a learning project AND initialize the agent session in one call.
/// Combines `create_learning_project` (folder + project.json) with
/// `init_agent_session` (spawn agent to establish session_id).
///
/// Atomicity: if the session init fails, the project.json is rolled back
/// (folder is left in place — user can retry or delete manually).
#[tauri::command]
async fn setup_project_with_session(
    project_path: String,
    outline: serde_json::Value,
    goal: Option<String>,
    app_handle: AppHandle,
) -> Result<String, String> {
    log::info!("[setup_project_with_session] project_path={}", project_path);

    // Emit status before any work so the UI shows progress immediately.
    let _ = app_handle.emit(
        "session-init-status",
        serde_json::json!({
            "step": "creating_project",
            "message": "正在创建项目文件夹...",
        }),
    );

    // Step 1: create folder + project.json
    let json_path_str = create_learning_project(project_path.clone(), outline, goal)?;
    log::info!(
        "[setup_project_with_session] project.json created at {}",
        json_path_str
    );

    let _ = app_handle.emit(
        "session-init-status",
        serde_json::json!({
            "step": "copying_skills",
            "message": "正在加载技能模板...",
        }),
    );

    // Step 2: copy bundled skills into the project's .claude/skills/ so
    // the agent SDK discovers them on first invocation.
    if let Err(e) = ai_agent::copy_bundled_skills_to_project(&project_path) {
        // Non-fatal: project works without skills, just no skill-based
        // guidance. Log so the user can investigate.
        log::warn!("[setup_project_with_session] skills copy failed: {}", e);
    }

    let _ = app_handle.emit(
        "session-init-status",
        serde_json::json!({
            "step": "initializing_agent",
            "message": "正在调用 AI API 初始化项目...",
        }),
    );

    // Step 3: initialize agent session (synchronous ureq-like via cmd.output())
    let config = get_config(app_handle.clone()).map_err(|e| e.to_string())?;
    let session_id = ai_agent::init_agent_session(&config, &project_path).await?;

    log::info!("[setup_project_with_session] session_id={}", session_id);

    // Step 4: write session to .learning/agent-session.json so the host
    // (JS) can pass it to subsequent invocations.
    let session_path = std::path::PathBuf::from(&project_path)
        .join(".learning")
        .join("agent-session.json");
    let session_json = serde_json::json!({
        "session_id": session_id,
        "created_at": now_local_string(),
        "last_used_at": now_local_string(),
    });
    if let Err(e) = std::fs::write(
        &session_path,
        serde_json::to_string_pretty(&session_json)
            .map_err(|e| format!("serialize session.json: {}", e))?,
    ) {
        // Non-fatal: host can still use session_id in-memory for this session
        log::warn!(
            "[setup_project_with_session] failed to write agent-session.json: {}",
            e
        );
    }

    let _ = app_handle.emit(
        "session-init-status",
        serde_json::json!({
            "step": "agent_ready",
            "message": "Agent 就绪，开始生成章节...",
        }),
    );

    Ok(session_id)
}

/// Single quiz answer record for persistence
#[derive(Debug, Serialize, Deserialize)]
struct QuizAnswerRecord {
    question_id: String,
    qtype: String,
    user_answer: Option<serde_json::Value>,
    is_correct: Option<bool>,
}

/// Persist quiz result: update project.json concepts + append quiz-history.json
#[tauri::command]
async fn persist_quiz_result(
    project_path: String,
    chapter_file: String,
    rating: String,
    score: f32,
    weak_concepts: Vec<String>,
    answers: Vec<QuizAnswerRecord>,
    timestamp: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let learning_dir = std::path::PathBuf::from(&project_path).join(".learning");
    std::fs::create_dir_all(&learning_dir)
        .map_err(|e| format!("创建 .learning 目录失败: {}", e))?;

    // Extract basename for matching against project.json "file" field
    let chapter_basename = std::path::Path::new(&chapter_file)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| chapter_file.clone());

    // Load *.concepts.json for this chapter to get id ↔ name mapping
    // (chapter.concepts.json is the source of truth for concept identities)
    let chapter_md_stem = chapter_basename.trim_end_matches(".md");
    let concepts_json_path =
        std::path::PathBuf::from(&project_path).join(format!("{}.concepts.json", chapter_md_stem));
    let id_by_name: std::collections::HashMap<String, String> = if concepts_json_path.exists() {
        let content = std::fs::read_to_string(&concepts_json_path)
            .map_err(|e| format!("读取 concepts.json 失败: {}", e))?;
        let parsed: serde_json::Value = serde_json::from_str(&content)
            .map_err(|e| format!("解析 concepts.json 失败: {}", e))?;
        parsed
            .get("concepts")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|c| {
                        let id = c.get("id").and_then(|v| v.as_str())?;
                        let name = c.get("name").and_then(|v| v.as_str())?;
                        Some((name.to_string(), id.to_string()))
                    })
                    .collect()
            })
            .unwrap_or_default()
    } else {
        std::collections::HashMap::new()
    };

    // 1. Update project.json — write chapter status to top-level chapters_status map
    //    (chapter.concepts is {id, name} only, no status fields)
    //    Hold the project.json lock for the entire read-modify-write to avoid races
    //    with persist_chapter_file / syncProjectStatus.
    let _project_guard = state
        .project_json_lock
        .lock()
        .map_err(|e| format!("获取 project.json 锁失败: {}", e))?;
    let project_json_path = learning_dir.join("project.json");
    let mut project: serde_json::Value = if project_json_path.exists() {
        let content = std::fs::read_to_string(&project_json_path)
            .map_err(|e| format!("读取 project.json 失败: {}", e))?;
        serde_json::from_str(&content).map_err(|e| format!("解析 project.json 失败: {}", e))?
    } else {
        serde_json::json!({
            "name": "Learning Project",
            "created": std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs())
                    .unwrap_or(0),
            "chapters": [],
            "chapters_status": {}
        })
    };

    // Ensure top-level chapters_status map exists
    if project.get("chapters_status").is_none() {
        project["chapters_status"] = serde_json::json!({});
    }

    // Update chapter status to "completed" and strip legacy chapter.status / last_quiz_*
    // (those move to chapters_status metadata later if needed; for now just record the
    // completed state at the chapters_status map level)
    if let Some(chapters) = project.get_mut("chapters").and_then(|v| v.as_array_mut()) {
        for ch in chapters.iter_mut() {
            let ch_file = ch.get("file").and_then(|v| v.as_str()).unwrap_or("");
            if ch_file == chapter_basename || ch_file == chapter_file {
                // Strip legacy fields (status, last_quiz_rating, last_quiz_at)
                ch.as_object_mut().map(|o| {
                    o.remove("status");
                    o.remove("last_quiz_rating");
                    o.remove("last_quiz_at");
                });
                break;
            }
        }
    }

    // Write chapter_status entry
    if let Some(status_map) = project
        .get_mut("chapters_status")
        .and_then(|v| v.as_object_mut())
    {
        status_map.insert(chapter_basename.clone(), serde_json::json!("completed"));
    }
    // Strip chapter.concepts down to {id, name} only (no status, no updated_at)
    if let Some(chapters) = project.get_mut("chapters").and_then(|v| v.as_array_mut()) {
        for ch in chapters.iter_mut() {
            if let Some(concepts_arr) = ch.get_mut("concepts").and_then(|v| v.as_array_mut()) {
                let cleaned: Vec<serde_json::Value> = concepts_arr
                    .iter()
                    .map(|item| {
                        if let Some(s) = item.as_str() {
                            // Legacy: string entry — convert to {id, name}
                            let id = id_by_name.get(s).cloned().unwrap_or_else(|| s.to_string());
                            serde_json::json!({"id": id, "name": s})
                        } else if let Some(obj) = item.as_object() {
                            // Object entry — keep only id and name
                            let id = obj
                                .get("id")
                                .and_then(|v| v.as_str())
                                .map(|s| s.to_string())
                                .or_else(|| {
                                    let name = obj.get("name").and_then(|v| v.as_str())?;
                                    id_by_name.get(name).cloned()
                                })
                                .unwrap_or_else(|| {
                                    obj.get("name")
                                        .and_then(|v| v.as_str())
                                        .unwrap_or("")
                                        .to_string()
                                });
                            let name = obj
                                .get("name")
                                .and_then(|v| v.as_str())
                                .unwrap_or(&id)
                                .to_string();
                            serde_json::json!({"id": id, "name": name})
                        } else {
                            serde_json::json!({})
                        }
                    })
                    .collect();
                *concepts_arr = cleaned;
            }
        }
    }

    // Remove legacy top-level "concepts" map if present (one-time cleanup)
    if let Some(obj) = project.as_object_mut() {
        if obj.contains_key("concepts") {
            log::info!("[persist_quiz_result] removing legacy top-level 'concepts' map");
            obj.remove("concepts");
        }
    }

    let project_str = serde_json::to_string_pretty(&project)
        .map_err(|e| format!("序列化 project.json 失败: {}", e))?;
    std::fs::write(&project_json_path, project_str)
        .map_err(|e| format!("写入 project.json 失败: {}", e))?;

    // 1b. Update knowledge-graph.json nodes' node_status
    //     Build the same id ↔ name map we use above to know which nodes belong to this chapter.
    //     Chapter file basename → node.chapter: *.concepts.json lists concepts with chapter field
    //     matching the chapter file stem.
    let _chapter_stem = chapter_basename.trim_end_matches(".md").to_string();
    let chapter_node_ids: Vec<String> = if concepts_json_path.exists() {
        let content = std::fs::read_to_string(&concepts_json_path)
            .map_err(|e| format!("读取 concepts.json 失败: {}", e))?;
        let parsed: serde_json::Value = serde_json::from_str(&content)
            .map_err(|e| format!("解析 concepts.json 失败: {}", e))?;
        parsed
            .get("concepts")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|c| c.get("id").and_then(|v| v.as_str()).map(String::from))
                    .collect()
            })
            .unwrap_or_default()
    } else {
        Vec::new()
    };

    let graph_path = learning_dir.join("knowledge-graph.json");
    if graph_path.exists() && !chapter_node_ids.is_empty() {
        let content = std::fs::read_to_string(&graph_path)
            .map_err(|e| format!("读取 knowledge-graph.json 失败: {}", e))?;
        let mut graph: serde_json::Value = serde_json::from_str(&content)
            .map_err(|e| format!("解析 knowledge-graph.json 失败: {}", e))?;

        let non_weak_status = if rating == "mastered" {
            "mastered"
        } else {
            "learning"
        };
        if let Some(nodes) = graph.get_mut("nodes").and_then(|v| v.as_array_mut()) {
            for node in nodes.iter_mut() {
                let id = node
                    .get("id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                if !chapter_node_ids.contains(&id) {
                    continue;
                }
                let status = if weak_concepts.contains(&id) {
                    match rating.as_str() {
                        "struggling" => "struggling",
                        _ => "learning",
                    }
                } else {
                    non_weak_status
                };
                if let Some(obj) = node.as_object_mut() {
                    obj.insert("node_status".to_string(), serde_json::json!(status));
                }
            }
        }

        let graph_str = serde_json::to_string_pretty(&graph)
            .map_err(|e| format!("序列化 knowledge-graph.json 失败: {}", e))?;
        std::fs::write(&graph_path, graph_str)
            .map_err(|e| format!("写入 knowledge-graph.json 失败: {}", e))?;
    }

    // 2. Append to quiz-history.json
    let history_path = learning_dir.join("quiz-history.json");
    let mut history: serde_json::Value = if history_path.exists() {
        let content = std::fs::read_to_string(&history_path)
            .map_err(|e| format!("读取 quiz-history.json 失败: {}", e))?;
        serde_json::from_str(&content)
            .unwrap_or_else(|_| serde_json::json!({ "version": "1.0", "entries": [] }))
    } else {
        serde_json::json!({ "version": "1.0", "entries": [] })
    };

    let entries = history
        .get_mut("entries")
        .and_then(|v| v.as_array_mut())
        .ok_or("quiz-history.json entries 字段必须是数组")?;

    let answer_json: Vec<serde_json::Value> = answers
        .into_iter()
        .map(|a| {
            serde_json::json!({
                "question_id": a.question_id,
                "qtype": a.qtype,
                "user_answer": a.user_answer,
                "is_correct": a.is_correct,
            })
        })
        .collect();

    entries.push(serde_json::json!({
        "chapter_file": chapter_basename,
        "timestamp": timestamp,
        "score": score,
        "rating": rating,
        "weak_concepts": weak_concepts,
        "answers": answer_json,
    }));

    let history_str = serde_json::to_string_pretty(&history)
        .map_err(|e| format!("序列化 quiz-history.json 失败: {}", e))?;
    std::fs::write(&history_path, history_str)
        .map_err(|e| format!("写入 quiz-history.json 失败: {}", e))?;

    Ok(())
}

/// Read quiz history for a project
#[tauri::command]
async fn read_quiz_history(project_path: String) -> Result<serde_json::Value, String> {
    let path = std::path::PathBuf::from(&project_path)
        .join(".learning")
        .join("quiz-history.json");
    if !path.exists() {
        return Ok(serde_json::json!({ "version": "1.0", "entries": [] }));
    }
    let content = std::fs::read_to_string(&path)
        .map_err(|e| format!("读取 quiz-history.json 失败: {}", e))?;
    let value: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| format!("解析 quiz-history.json 失败: {}", e))?;
    Ok(value)
}

/// Read any text file by absolute path (used by review-scheduler.js and other modules)
#[tauri::command]
async fn read_text_file(file_path: String) -> Result<String, String> {
    let content =
        std::fs::read_to_string(&file_path).map_err(|e| format!("读取文件失败: {}", e))?;
    Ok(content)
}

/// Persist a generated chapter's file field back to project.json.
/// Called on chapter_complete so the file path is durable across app restarts,
/// instead of relying on resume-time sync to guess the filename.
#[tauri::command]
async fn persist_chapter_file(
    project_path: String,
    chapter_index: usize,
    file_basename: String,
    status: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let project_json_path = std::path::PathBuf::from(&project_path)
        .join(".learning")
        .join("project.json");
    if !project_json_path.exists() {
        return Err("project.json not found".to_string());
    }

    // Serialize project.json access to prevent read-modify-write races with
    // persist_quiz_result / other commands.
    let _project_guard = state
        .project_json_lock
        .lock()
        .map_err(|e| format!("获取 project.json 锁失败: {}", e))?;

    let content = std::fs::read_to_string(&project_json_path)
        .map_err(|e| format!("读取 project.json 失败: {}", e))?;
    let mut project: serde_json::Value =
        serde_json::from_str(&content).map_err(|e| format!("解析 project.json 失败: {}", e))?;

    // Backfill chapters[index].file
    if let Some(chapters) = project.get_mut("chapters").and_then(|v| v.as_array_mut()) {
        if chapter_index < chapters.len() {
            chapters[chapter_index]["file"] = serde_json::json!(file_basename);
        }
    }

    // Update chapters_status map, but never downgrade a completed chapter.
    // This protects against race windows where the lock holder reads a state
    // just before persist_quiz_result writes "completed".
    if project.get("chapters_status").is_none() {
        project["chapters_status"] = serde_json::json!({});
    }
    if let Some(status_map) = project
        .get_mut("chapters_status")
        .and_then(|v| v.as_object_mut())
    {
        let current = status_map
            .get(&file_basename)
            .and_then(|v| v.as_str())
            .unwrap_or("");
        if current == "completed" {
            log::info!(
                "[persist_chapter_file] {} already completed, skipping status update",
                file_basename
            );
        } else {
            status_map.insert(file_basename, serde_json::json!(status));
        }
    }

    let json_str = serde_json::to_string_pretty(&project)
        .map_err(|e| format!("序列化 project.json 失败: {}", e))?;
    std::fs::write(&project_json_path, json_str)
        .map_err(|e| format!("写入 project.json 失败: {}", e))?;
    Ok(())
}

/// Exit the application immediately. Used by the generation close guard when the
/// user confirms they want to close despite generation being in progress.
#[tauri::command]
fn exit_app(app_handle: tauri::AppHandle) {
    app_handle.exit(0);
}

/// Hide the main window so generation can continue in the background.
#[tauri::command]
fn hide_main_window(window: tauri::WebviewWindow) -> Result<(), String> {
    window.hide().map_err(|e| format!("隐藏窗口失败: {}", e))
}

/// PB1: Generate review cards (quiz questions + key points) for each concept in a chapter.
/// Round 2: Calls agent-bridge "review-gen" stage with review-generation skill.
/// Falls back to stub if agent fails.
#[tauri::command]
async fn generate_review_content(
    project_path: String,
    chapter_file: String,
    weak_concepts: Vec<String>,
    app_handle: tauri::AppHandle,
) -> Result<serde_json::Value, String> {
    // Ensure all bundled skills (including review-generation) are available in project
    let _ = ai_agent::copy_bundled_skills_to_project(&project_path);

    let learning_dir = std::path::PathBuf::from(&project_path).join(".learning");
    std::fs::create_dir_all(&learning_dir)
        .map_err(|e| format!("创建 .learning 目录失败: {}", e))?;

    // Read chapter's concepts.json
    let chapter_stem = chapter_file.trim_end_matches(".md");
    let concepts_json_path =
        std::path::PathBuf::from(&project_path).join(format!("{}.concepts.json", chapter_stem));
    let concepts: Vec<serde_json::Value> = if concepts_json_path.exists() {
        let content = std::fs::read_to_string(&concepts_json_path)
            .map_err(|e| format!("读取 concepts.json 失败: {}", e))?;
        let parsed: serde_json::Value = serde_json::from_str(&content)
            .map_err(|e| format!("解析 concepts.json 失败: {}", e))?;
        parsed
            .get("concepts")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default()
    } else {
        vec![]
    };

    // Read existing review-cards.json (create if not exists)
    let cards_path = learning_dir.join("review-cards.json");
    let mut cards: serde_json::Value = if cards_path.exists() {
        let content = std::fs::read_to_string(&cards_path)
            .map_err(|e| format!("读取 review-cards.json 失败: {}", e))?;
        serde_json::from_str(&content)
            .unwrap_or_else(|_| serde_json::json!({ "version": "1.0", "cards": {} }))
    } else {
        serde_json::json!({ "version": "1.0", "cards": {} })
    };

    // Ensure cards.cards is an object
    if !cards.get("cards").and_then(|v| v.as_object()).is_some() {
        cards["cards"] = serde_json::json!({});
    }

    // Filter to only concepts that don't already have a card (idempotent)
    let existing_card_ids: std::collections::HashSet<String> = cards["cards"]
        .as_object()
        .map(|o| o.keys().cloned().collect())
        .unwrap_or_default();

    let new_concepts: Vec<serde_json::Value> = concepts
        .into_iter()
        .filter(|c| {
            let cid = c.get("id").and_then(|v| v.as_str()).unwrap_or("");
            !existing_card_ids.contains(cid)
        })
        .collect();

    if new_concepts.is_empty() {
        return Ok(
            serde_json::json!({ "success": true, "cards_count": 0, "note": "all concepts already have cards" }),
        );
    }

    let now = now_local_string();
    let chapter_basename = std::path::Path::new(&chapter_file)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| chapter_file.clone());

    // Try agent-generated content first, fall back to stub
    let agent_result = ai_agent::generate_review_content_agent(
        project_path.clone(),
        chapter_file.clone(),
        new_concepts.clone(),
        weak_concepts.clone(),
        app_handle,
        None,
    )
    .await;

    let weak_set: std::collections::HashSet<String> = weak_concepts.into_iter().collect();
    let mut added_count = 0u32;

    match agent_result {
        Ok(agent_cards) => {
            // Agent succeeded — merge returned cards into review-cards.json
            if let Some(returned_cards) = agent_cards.get("cards").and_then(|v| v.as_object()) {
                let cards_obj = cards["cards"]
                    .as_object_mut()
                    .ok_or("cards is not object")?;
                for (cid, card_value) in returned_cards {
                    if !cards_obj.contains_key(cid) {
                        let mut card = card_value.clone();
                        // Ensure metadata fields are set
                        if card
                            .get("source_chapter")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .is_empty()
                        {
                            card["source_chapter"] = serde_json::json!(chapter_basename);
                        }
                        if card
                            .get("generated_at")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .is_empty()
                        {
                            card["generated_at"] = serde_json::json!(now);
                        }
                        if card.get("from_weak").is_none() {
                            card["from_weak"] = serde_json::json!(weak_set.contains(cid));
                        }
                        cards_obj.insert(cid.clone(), card);
                        added_count += 1;
                    }
                }
            }

            // Fill any concepts the agent skipped with stub content
            for c in &new_concepts {
                let cid = c
                    .get("id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                if cid.is_empty() {
                    continue;
                }
                let cards_obj = cards["cards"]
                    .as_object_mut()
                    .ok_or("cards is not object")?;
                if cards_obj.contains_key(&cid) {
                    continue;
                }
                let cname = c
                    .get("name")
                    .and_then(|v| v.as_str())
                    .unwrap_or(&cid)
                    .to_string();
                let is_weak = weak_set.contains(&cid);
                cards_obj.insert(cid.clone(), serde_json::json!({
                    "concept_name": cname,
                    "source_chapter": chapter_basename,
                    "quiz_questions": [
                        { "type": "choice", "question": format!("{} 的核心思想是什么？", cname), "options": ["待生成", "待补充", "待定", "未知"], "answer": 0 }
                    ],
                    "key_points": [ format!("{} 是本章的核心概念", cname) ],
                    "generated_at": now,
                    "from_weak": is_weak
                }));
                added_count += 1;
            }
        }
        Err(e) => {
            log::warn!("[PB1] Agent review generation failed, using stub: {}", e);
            // Fall back to stub: write hardcoded content
            for c in &new_concepts {
                let cid = c
                    .get("id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                if cid.is_empty() {
                    continue;
                }
                let cname = c
                    .get("name")
                    .and_then(|v| v.as_str())
                    .unwrap_or(&cid)
                    .to_string();
                let is_weak = weak_set.contains(&cid);
                let cards_obj = cards["cards"]
                    .as_object_mut()
                    .ok_or("cards is not object")?;
                if cards_obj.contains_key(&cid) {
                    continue;
                }
                cards_obj.insert(cid.clone(), serde_json::json!({
                    "concept_name": cname,
                    "source_chapter": chapter_basename,
                    "quiz_questions": [
                        {
                            "type": "choice",
                            "question": format!("{} 的核心思想是什么？", cname),
                            "options": ["尚未生成（Agent不可用）", "请重试生成", "待Agent补充", "待定"],
                            "answer": 0
                        }
                    ],
                    "key_points": [
                        format!("{} 是本章的核心概念（Agent不可用，此为临时内容）", cname),
                        format!("{} 的理解对掌握后续内容很重要", cname)
                    ],
                    "generated_at": now,
                    "from_weak": is_weak
                }));
                added_count += 1;
            }
        }
    }

    let json_str = serde_json::to_string_pretty(&cards)
        .map_err(|e| format!("序列化 review-cards.json 失败: {}", e))?;
    std::fs::write(&cards_path, json_str)
        .map_err(|e| format!("写入 review-cards.json 失败: {}", e))?;

    Ok(serde_json::json!({ "success": true, "cards_count": added_count }))
}

/// PB1 Batch: Generate review cards for multiple concepts across chapters in one agent call.
/// Each concept must have an `id`, `name`, and `source_chapter`. The agent reads the
/// relevant chapter files and returns cards for all concepts in a single JSON object.
#[tauri::command]
async fn generate_review_content_batch(
    project_path: String,
    concepts: Vec<serde_json::Value>,
    app_handle: tauri::AppHandle,
) -> Result<serde_json::Value, String> {
    log::info!(
        "[PB1-Batch] generate_review_content_batch START: project={}, concepts={}",
        project_path,
        concepts.len()
    );

    if concepts.is_empty() {
        return Ok(serde_json::json!({ "success": true, "cards_count": 0 }));
    }

    let _ = ai_agent::copy_bundled_skills_to_project(&project_path);

    let learning_dir = std::path::PathBuf::from(&project_path).join(".learning");
    std::fs::create_dir_all(&learning_dir)
        .map_err(|e| format!("创建 .learning 目录失败: {}", e))?;

    // Read existing review-cards.json (create if not exists)
    let cards_path = learning_dir.join("review-cards.json");
    let mut cards: serde_json::Value = if cards_path.exists() {
        let content = std::fs::read_to_string(&cards_path)
            .map_err(|e| format!("读取 review-cards.json 失败: {}", e))?;
        serde_json::from_str(&content)
            .unwrap_or_else(|_| serde_json::json!({ "version": "1.0", "cards": {} }))
    } else {
        serde_json::json!({ "version": "1.0", "cards": {} })
    };

    if !cards.get("cards").and_then(|v| v.as_object()).is_some() {
        cards["cards"] = serde_json::json!({});
    }

    // Filter to concepts that don't already have a card
    let existing_ids: std::collections::HashSet<String> = cards["cards"]
        .as_object()
        .map(|o| o.keys().cloned().collect())
        .unwrap_or_default();

    let new_concepts: Vec<serde_json::Value> = concepts
        .into_iter()
        .filter(|c| {
            let cid = c.get("id").and_then(|v| v.as_str()).unwrap_or("");
            !cid.is_empty() && !existing_ids.contains(cid)
        })
        .collect();

    if new_concepts.is_empty() {
        return Ok(
            serde_json::json!({ "success": true, "cards_count": 0, "note": "all concepts already have cards" }),
        );
    }

    // Call agent-bridge review-gen-batch
    let agent_result = ai_agent::generate_review_content_batch_agent(
        project_path.clone(),
        new_concepts.clone(),
        app_handle,
        None,
    )
    .await;

    let now = now_local_string();
    let mut added_count = 0u32;

    match agent_result {
        Ok(agent_cards) => {
            if let Some(returned_cards) = agent_cards.get("cards").and_then(|v| v.as_object()) {
                let cards_obj = cards["cards"]
                    .as_object_mut()
                    .ok_or("cards is not object")?;
                for (cid, card_value) in returned_cards {
                    if !cards_obj.contains_key(cid) {
                        let mut card = card_value.clone();
                        if card
                            .get("generated_at")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .is_empty()
                        {
                            card["generated_at"] = serde_json::json!(now);
                        }
                        cards_obj.insert(cid.clone(), card);
                        added_count += 1;
                    }
                }
            }

            // Fill any concepts the agent skipped with stub content
            for c in &new_concepts {
                let cid = c
                    .get("id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                if cid.is_empty() {
                    continue;
                }
                let cards_obj = cards["cards"]
                    .as_object_mut()
                    .ok_or("cards is not object")?;
                if cards_obj.contains_key(&cid) {
                    continue;
                }
                let cname = c
                    .get("name")
                    .and_then(|v| v.as_str())
                    .unwrap_or(&cid)
                    .to_string();
                let source = c
                    .get("source_chapter")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                cards_obj.insert(cid.clone(), serde_json::json!({
                    "concept_name": cname,
                    "source_chapter": source,
                    "quiz_questions": [
                        {
                            "type": "choice",
                            "question": format!("{} 的核心思想是什么？", cname),
                            "options": ["尚未生成（Agent不可用）", "请重试生成", "待Agent补充", "待定"],
                            "answer": 0
                        }
                    ],
                    "key_points": [
                        format!("{} 是本章的核心概念（Agent不可用，此为临时内容）", cname),
                        format!("{} 的理解对掌握后续内容很重要", cname)
                    ],
                    "generated_at": now,
                    "from_weak": c.get("weak").and_then(|v| v.as_bool()).unwrap_or(false)
                }));
                added_count += 1;
            }
        }
        Err(e) => {
            log::warn!(
                "[PB1-Batch] Agent review generation failed, using stub: {}",
                e
            );
            for c in &new_concepts {
                let cid = c
                    .get("id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                if cid.is_empty() {
                    continue;
                }
                let cards_obj = cards["cards"]
                    .as_object_mut()
                    .ok_or("cards is not object")?;
                if cards_obj.contains_key(&cid) {
                    continue;
                }
                let cname = c
                    .get("name")
                    .and_then(|v| v.as_str())
                    .unwrap_or(&cid)
                    .to_string();
                let source = c
                    .get("source_chapter")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                cards_obj.insert(cid.clone(), serde_json::json!({
                    "concept_name": cname,
                    "source_chapter": source,
                    "quiz_questions": [
                        {
                            "type": "choice",
                            "question": format!("{} 的核心思想是什么？", cname),
                            "options": ["尚未生成（Agent不可用）", "请重试生成", "待Agent补充", "待定"],
                            "answer": 0
                        }
                    ],
                    "key_points": [
                        format!("{} 是本章的核心概念（Agent不可用，此为临时内容）", cname),
                        format!("{} 的理解对掌握后续内容很重要", cname)
                    ],
                    "generated_at": now,
                    "from_weak": c.get("weak").and_then(|v| v.as_bool()).unwrap_or(false)
                }));
                added_count += 1;
            }
        }
    }

    let json_str = serde_json::to_string_pretty(&cards)
        .map_err(|e| format!("序列化 review-cards.json 失败: {}", e))?;
    std::fs::write(&cards_path, json_str)
        .map_err(|e| format!("写入 review-cards.json 失败: {}", e))?;

    Ok(serde_json::json!({ "success": true, "cards_count": added_count }))
}

/// PB5: Check for concepts that are missing from review-cards.json.
/// Scans project.json for completed chapters, then checks review-cards.json
/// for each concept. Returns the list of missing concepts grouped by chapter.
#[tauri::command]
async fn check_missing_review_cards(
    project_path: String,
) -> Result<Vec<serde_json::Value>, String> {
    let learning_dir = std::path::PathBuf::from(&project_path).join(".learning");
    let project_json_path = learning_dir.join("project.json");
    if !project_json_path.exists() {
        return Ok(vec![]);
    }

    let content = std::fs::read_to_string(&project_json_path)
        .map_err(|e| format!("读取 project.json 失败: {}", e))?;
    let project: serde_json::Value =
        serde_json::from_str(&content).map_err(|e| format!("解析 project.json 失败: {}", e))?;

    // Read existing review-cards.json
    let cards_path = learning_dir.join("review-cards.json");
    let existing_ids: std::collections::HashSet<String> = if cards_path.exists() {
        if let Ok(c) = std::fs::read_to_string(&cards_path) {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&c) {
                v.get("cards")
                    .and_then(|o| o.as_object())
                    .map(|o| o.keys().cloned().collect())
                    .unwrap_or_default()
            } else {
                std::collections::HashSet::new()
            }
        } else {
            std::collections::HashSet::new()
        }
    } else {
        std::collections::HashSet::new()
    };

    // Check chapters_status for completed chapters
    let status_map = project.get("chapters_status").and_then(|v| v.as_object());
    if status_map.is_none() {
        return Ok(vec![]);
    }

    let mut missing: Vec<serde_json::Value> = vec![];

    if let Some(chapters) = project.get("chapters").and_then(|v| v.as_array()) {
        for ch in chapters {
            let ch_file = ch.get("file").and_then(|v| v.as_str()).unwrap_or("");
            if ch_file.is_empty() {
                continue;
            }

            // Skip if chapter is not completed
            let is_completed = status_map
                .and_then(|m| m.get(ch_file))
                .and_then(|v| v.as_str())
                .map(|s| s == "completed")
                .unwrap_or(false);
            if !is_completed {
                continue;
            }

            // Check each concept
            let mut missing_concepts: Vec<String> = vec![];
            if let Some(concepts) = ch.get("concepts").and_then(|v| v.as_array()) {
                for c in concepts {
                    let cid = c
                        .get("id")
                        .and_then(|v| v.as_str())
                        .or_else(|| c.as_str())
                        .unwrap_or("");
                    if !cid.is_empty() && !existing_ids.contains(cid) {
                        missing_concepts.push(cid.to_string());
                    }
                }
            }

            if !missing_concepts.is_empty() {
                missing.push(serde_json::json!({
                    "chapter_file": ch_file,
                    "missing_concepts": missing_concepts,
                }));
            }
        }
    }

    Ok(missing)
}

mod explanation_persistence {
    use serde::{Deserialize, Serialize};
    use std::path::{Path, PathBuf};

    pub const MAX_CUES_PER_CHAPTER: usize = 20;

    #[derive(Debug, Clone, Serialize, Deserialize)]
    pub struct ExplanationAnchor {
        pub paragraph_index: i32,
    }

    #[derive(Debug, Clone, Serialize, Deserialize)]
    pub struct ExplanationQAEntry {
        pub q: String,
        pub a: String,
        pub ts: String,
    }

    #[derive(Debug, Clone, Serialize, Deserialize)]
    pub struct ExplanationConversation {
        pub id: String,
        pub selected_text: String,
        pub anchor: Option<ExplanationAnchor>,
        pub qa_history: Vec<ExplanationQAEntry>,
        pub created_at: String,
    }

    #[derive(Debug, Clone, Serialize, Deserialize)]
    pub struct ChapterExplanations {
        pub chapter: String,
        pub conversations: Vec<ExplanationConversation>,
    }

    pub fn get_explanations_dir(project_path: &str) -> PathBuf {
        PathBuf::from(project_path)
            .join(".learning")
            .join("explanations")
    }

    /// Strip the .md (or any) extension to get the chapter stem used as the per-chapter directory name.
    fn chapter_stem(chapter: &str) -> String {
        Path::new(chapter)
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| chapter.to_string())
    }

    pub fn get_explanations_chapter_dir(project_path: &str, chapter: &str) -> PathBuf {
        get_explanations_dir(project_path).join(chapter_stem(chapter))
    }

    pub fn get_explanation_cue_path(project_path: &str, chapter: &str, cue_id: &str) -> PathBuf {
        get_explanations_chapter_dir(project_path, chapter).join(format!("{}.json", cue_id))
    }

    /// Per-chapter extras directory: .learning/extras/{chapter_stem}/
    pub fn get_extras_chapter_dir(project_path: &str, chapter: &str) -> PathBuf {
        PathBuf::from(project_path)
            .join(".learning")
            .join("extras")
            .join(chapter_stem(chapter))
    }

    pub fn get_extra_cue_path(project_path: &str, chapter: &str, cue_id: &str) -> PathBuf {
        get_extras_chapter_dir(project_path, chapter).join(format!("{}.json", cue_id))
    }

    /// Legacy single-file extras path from the old model: .learning/extras/{chapter_stem}.json
    /// Used only for one-time cleanup; new model writes per-cue files in get_extras_chapter_dir.
    pub fn get_legacy_extras_file_path(project_path: &str, chapter: &str) -> PathBuf {
        PathBuf::from(project_path)
            .join(".learning")
            .join("extras")
            .join(format!("{}.json", chapter_stem(chapter)))
    }

    /// One-time lazy migration from the old single-file explanations format.
    /// If `.learning/explanations/{chapter}.json` exists and the new per-cue dir is missing or empty,
    /// split it into per-cue files and delete the old file. Idempotent.
    fn maybe_migrate_old_file(project_path: &str, chapter: &str) -> Result<(), String> {
        let old_path = get_explanations_dir(project_path).join(format!("{}.json", chapter));
        if !old_path.exists() {
            return Ok(());
        }
        let new_dir = get_explanations_chapter_dir(project_path, chapter);
        // If new dir already has any json file, skip migration (assume already migrated) and remove old
        if new_dir.exists() {
            let has_any = std::fs::read_dir(&new_dir)
                .map(|rd| {
                    rd.filter_map(|e| e.ok())
                        .any(|e| e.path().extension().and_then(|s| s.to_str()) == Some("json"))
                })
                .unwrap_or(false);
            if has_any {
                let _ = std::fs::remove_file(&old_path);
                return Ok(());
            }
        }

        let content = std::fs::read_to_string(&old_path)
            .map_err(|e| format!("读取旧 explanations 文件失败: {}", e))?;
        let data: ChapterExplanations = serde_json::from_str(&content)
            .map_err(|e| format!("解析旧 explanations 文件失败: {}", e))?;

        std::fs::create_dir_all(&new_dir)
            .map_err(|e| format!("创建 explanations 章节目录失败: {}", e))?;

        for conv in &data.conversations {
            let cue_path = get_explanation_cue_path(project_path, chapter, &conv.id);
            let json = serde_json::to_string_pretty(conv)
                .map_err(|e| format!("序列化 cue 失败: {}", e))?;
            std::fs::write(&cue_path, json).map_err(|e| format!("写入 cue 文件失败: {}", e))?;
        }

        let _ = std::fs::remove_file(&old_path);
        Ok(())
    }

    /// Save a single cue. Writes to `{chapter_stem}/{cue_id}.json`. Evicts oldest cues if over MAX.
    /// Also invalidates the per-cue extras file (the cue's quiz is now stale).
    pub fn save(
        project_path: &str,
        chapter: &str,
        conversation: ExplanationConversation,
    ) -> Result<(), String> {
        let chapter_dir = get_explanations_chapter_dir(project_path, chapter);
        std::fs::create_dir_all(&chapter_dir)
            .map_err(|e| format!("创建 explanations 章节目录失败: {}", e))?;

        let cue_path = get_explanation_cue_path(project_path, chapter, &conversation.id);
        let json = serde_json::to_string_pretty(&conversation)
            .map_err(|e| format!("序列化 cue 失败: {}", e))?;
        std::fs::write(&cue_path, json).map_err(|e| format!("写入 cue 文件失败: {}", e))?;

        evict_oldest_if_over_limit(project_path, chapter)?;

        // Per-cue extras invalidation: cue content changed -> its quiz is stale
        let extras_path = get_extra_cue_path(project_path, chapter, &conversation.id);
        if extras_path.exists() {
            let _ = std::fs::remove_file(&extras_path);
        }

        Ok(())
    }

    fn evict_oldest_if_over_limit(project_path: &str, chapter: &str) -> Result<(), String> {
        let chapter_dir = get_explanations_chapter_dir(project_path, chapter);
        let entries = match std::fs::read_dir(&chapter_dir) {
            Ok(rd) => rd
                .filter_map(|e| e.ok())
                .map(|e| e.path())
                .collect::<Vec<_>>(),
            Err(_) => return Ok(()),
        };
        let cue_files: Vec<PathBuf> = entries
            .into_iter()
            .filter(|p| p.extension().and_then(|s| s.to_str()) == Some("json"))
            .collect();

        if cue_files.len() <= MAX_CUES_PER_CHAPTER {
            return Ok(());
        }

        // Read each cue's created_at for sorting
        let mut cues: Vec<(PathBuf, String)> = Vec::new();
        for path in &cue_files {
            if let Ok(content) = std::fs::read_to_string(path) {
                if let Ok(conv) = serde_json::from_str::<ExplanationConversation>(&content) {
                    cues.push((path.clone(), conv.created_at));
                }
            }
        }
        cues.sort_by(|a, b| a.1.cmp(&b.1));

        let excess = cues.len() - MAX_CUES_PER_CHAPTER;
        for (path, _) in cues.iter().take(excess) {
            // Delete the evicted cue's extras file too
            if let Ok(content) = std::fs::read_to_string(path) {
                if let Ok(conv) = serde_json::from_str::<ExplanationConversation>(&content) {
                    let extras_path = get_extra_cue_path(project_path, chapter, &conv.id);
                    if extras_path.exists() {
                        let _ = std::fs::remove_file(&extras_path);
                    }
                }
            }
            let _ = std::fs::remove_file(path);
        }
        Ok(())
    }

    /// Read all conversations for a chapter, aggregating from per-cue files.
    /// Lazy-migrates from the old single-file format on first call.
    pub fn load(project_path: &str, chapter: &str) -> Result<ChapterExplanations, String> {
        maybe_migrate_old_file(project_path, chapter)?;

        let chapter_dir = get_explanations_chapter_dir(project_path, chapter);
        if !chapter_dir.exists() {
            return Ok(ChapterExplanations {
                chapter: chapter.to_string(),
                conversations: vec![],
            });
        }

        let mut conversations: Vec<ExplanationConversation> = Vec::new();
        let entries = std::fs::read_dir(&chapter_dir)
            .map_err(|e| format!("读取 explanations 章节目录失败: {}", e))?;
        for entry in entries.filter_map(|e| e.ok()) {
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) != Some("json") {
                continue;
            }
            let content =
                std::fs::read_to_string(&path).map_err(|e| format!("读取 cue 文件失败: {}", e))?;
            if let Ok(conv) = serde_json::from_str::<ExplanationConversation>(&content) {
                conversations.push(conv);
            }
        }
        conversations.sort_by(|a, b| a.created_at.cmp(&b.created_at));

        Ok(ChapterExplanations {
            chapter: chapter.to_string(),
            conversations,
        })
    }

    /// Remove a cue by id. Deletes both the explanations per-cue file and the extras per-cue file.
    pub fn remove(project_path: &str, chapter: &str, conversation_id: &str) -> Result<(), String> {
        let cue_path = get_explanation_cue_path(project_path, chapter, conversation_id);
        if cue_path.exists() {
            std::fs::remove_file(&cue_path).map_err(|e| format!("删除 cue 文件失败: {}", e))?;
        }
        let extras_path = get_extra_cue_path(project_path, chapter, conversation_id);
        if extras_path.exists() {
            let _ = std::fs::remove_file(&extras_path);
        }
        Ok(())
    }
}

// ============================================
// Sprint 9: Exploration Mode Session Persistence
// ============================================

mod exploration_persistence {
    use std::path::PathBuf;
    use tauri::Manager;

    pub fn get_exploration_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
        let data_dir = app
            .path()
            .app_local_data_dir()
            .map_err(|e| format!("无法获取应用数据目录: {}", e))?;
        let dir = data_dir.join("exploration-sessions");
        let _ = std::fs::create_dir_all(&dir);
        Ok(dir)
    }

    pub fn session_file_path(app: &tauri::AppHandle, file_name: &str) -> Result<PathBuf, String> {
        let dir = get_exploration_dir(app)?;
        Ok(dir.join(format!("{}.json", file_name)))
    }
}

#[tauri::command]
async fn read_exploration_session(
    file_name: String,
    app: tauri::AppHandle,
) -> Result<String, String> {
    let path = exploration_persistence::session_file_path(&app, &file_name)?;
    if !path.exists() {
        return Ok(String::new());
    }
    std::fs::read_to_string(&path).map_err(|e| format!("读取探索会话失败: {}", e))
}

#[tauri::command]
async fn write_exploration_session(
    file_name: String,
    content: String,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let path = exploration_persistence::session_file_path(&app, &file_name)?;
    std::fs::write(&path, content).map_err(|e| format!("写入探索会话失败: {}", e))
}

#[tauri::command]
async fn delete_exploration_session(
    file_name: String,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let path = exploration_persistence::session_file_path(&app, &file_name)?;
    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| format!("删除探索会话失败: {}", e))?;
    }
    Ok(())
}

// Commands defined in ai_agent.rs to avoid macro issues
// ============================================
// Sprint 4: Forgetting Curve Review System
// ============================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReviewItem {
    pub concept: String,
    pub source_chapter: String,
    pub review_count: u32,
    pub last_reviewed: String,
    pub next_review_at: String,
    pub last_rating: String,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ReviewSchedule {
    version: String,
    items: Vec<ReviewItem>,
}

fn read_review_schedule(project_path: &str) -> Result<ReviewSchedule, String> {
    let path = std::path::PathBuf::from(project_path)
        .join(".learning")
        .join("review-schedule.json");
    if !path.exists() {
        return Ok(ReviewSchedule {
            version: "1.0".to_string(),
            items: vec![],
        });
    }
    let content = std::fs::read_to_string(&path)
        .map_err(|e| format!("读取 review-schedule.json 失败: {}", e))?;
    let schedule: ReviewSchedule = serde_json::from_str(&content)
        .map_err(|e| format!("解析 review-schedule.json 失败: {}", e))?;
    Ok(schedule)
}

fn write_review_schedule(project_path: &str, schedule: &ReviewSchedule) -> Result<(), String> {
    let learning_dir = std::path::PathBuf::from(project_path).join(".learning");
    std::fs::create_dir_all(&learning_dir)
        .map_err(|e| format!("创建 .learning 目录失败: {}", e))?;
    let path = learning_dir.join("review-schedule.json");
    let json = serde_json::to_string_pretty(schedule)
        .map_err(|e| format!("序列化 review-schedule.json 失败: {}", e))?;
    std::fs::write(&path, json).map_err(|e| format!("写入 review-schedule.json 失败: {}", e))?;
    Ok(())
}

fn now_local_string() -> String {
    chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string()
}

fn days_to_ymd(mut days: i64) -> (i32, u32, u32) {
    let mut year = 1970i32;
    loop {
        let yd = if is_leap_year(year) { 366 } else { 365 };
        if days < yd {
            break;
        }
        days -= yd;
        year += 1;
    }
    let md = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    let mut month = 1u32;
    for (i, &d) in md.iter().enumerate() {
        let d = if i == 1 && is_leap_year(year) { 29 } else { d };
        if days < d {
            month = (i + 1) as u32;
            break;
        }
        days -= d;
        month = (i + 2) as u32;
    }
    (year, month, (days + 1) as u32)
}

fn is_leap_year(year: i32) -> bool {
    (year % 4 == 0 && year % 100 != 0) || (year % 400 == 0)
}

fn add_days_to_string(date_str: &str, days: i32) -> String {
    // Parse "YYYY-MM-DD HH:MM:SS"
    let parts: Vec<&str> = date_str
        .split(|c| c == '-' || c == ' ' || c == ':')
        .collect();
    if parts.len() != 6 {
        return now_local_string();
    }
    let y: i32 = parts[0].parse().unwrap_or(2024);
    let m: u32 = parts[1].parse().unwrap_or(1);
    let d: u32 = parts[2].parse().unwrap_or(1);
    let h: u32 = parts[3].parse().unwrap_or(0);
    let min: u32 = parts[4].parse().unwrap_or(0);
    let s: u32 = parts[5].parse().unwrap_or(0);

    // Approximate: add days
    let ts = ymd_to_days(y, m, d) + days as i64;
    let (ny, nm, nd) = days_to_ymd(ts);
    format!("{:04}-{:02}-{:02} {:02}:{:02}:{:02}", ny, nm, nd, h, min, s)
}

fn ymd_to_days(year: i32, month: u32, day: u32) -> i64 {
    let mut days = 0i64;
    for y in 1970..year {
        days += if is_leap_year(y) { 366 } else { 365 };
    }
    let md = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    for m in 1..month {
        let d = if m == 2 && is_leap_year(year) {
            29
        } else {
            md[(m - 1) as usize]
        };
        days += d as i64;
    }
    days += (day - 1) as i64;
    days
}

fn compute_next_interval(review_count: u32, rating: &str) -> u32 {
    let intervals = [1u32, 2, 4, 7, 15, 30];
    let base = intervals[std::cmp::min(review_count as usize, intervals.len() - 1)];
    match rating {
        "struggling" => std::cmp::max(1, base / 2),
        "learning" => std::cmp::max(1, (base as f32 * 0.75) as u32),
        _ => base,
    }
}

fn is_due(next_review_at: &str) -> bool {
    // New data is written in local time; compare directly.
    if next_review_at <= now_local_string().as_str() {
        return true;
    }
    // Backward compatibility: previously review-schedule.json stored UTC
    // timestamps. If parsing next_review_at as UTC yields a local time that
    // is already past, treat it as due so legacy schedules don't get stuck.
    if let Ok(utc_dt) = chrono::NaiveDateTime::parse_from_str(next_review_at, "%Y-%m-%d %H:%M:%S") {
        let local_from_utc: chrono::DateTime<chrono::Local> =
            chrono::TimeZone::from_utc_datetime(&chrono::Local, &utc_dt);
        if local_from_utc.format("%Y-%m-%d %H:%M:%S").to_string() <= now_local_string() {
            return true;
        }
    }
    false
}

/// Get review items that are due today
/// PB2: No longer rebuilds from project.json — relies on init_review_schedule being
/// called at quiz time. Returns empty if no schedule exists (legacy projects will
/// have their schedule populated on next quiz submission).
#[tauri::command]
async fn get_review_items(project_path: String) -> Result<Vec<ReviewItem>, String> {
    let schedule = read_review_schedule(&project_path)?;

    // Filter due items
    let due_items: Vec<ReviewItem> = schedule
        .items
        .into_iter()
        .filter(|item| item.status == "due" || is_due(&item.next_review_at))
        .collect();

    Ok(due_items)
}

/// PB2: Initialize review schedule for a chapter's concepts when quiz is submitted.
/// Writes initial next_review_at for each concept (1 day from now, or shorter for weak concepts).
/// Idempotent: skips concepts that already have a schedule entry.
#[tauri::command]
async fn init_review_schedule(
    project_path: String,
    chapter_file: String,
    weak_concepts: Vec<String>,
) -> Result<serde_json::Value, String> {
    let chapter_stem = chapter_file.trim_end_matches(".md");
    let concepts_json_path =
        std::path::PathBuf::from(&project_path).join(format!("{}.concepts.json", chapter_stem));
    let concepts: Vec<(String, String)> = if concepts_json_path.exists() {
        let content = std::fs::read_to_string(&concepts_json_path)
            .map_err(|e| format!("读取 concepts.json 失败: {}", e))?;
        let parsed: serde_json::Value = serde_json::from_str(&content)
            .map_err(|e| format!("解析 concepts.json 失败: {}", e))?;
        parsed
            .get("concepts")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|c| {
                        let id = c.get("id").and_then(|v| v.as_str())?;
                        let name = c.get("name").and_then(|v| v.as_str())?;
                        Some((id.to_string(), name.to_string()))
                    })
                    .collect()
            })
            .unwrap_or_default()
    } else {
        vec![]
    };

    if concepts.is_empty() {
        return Ok(
            serde_json::json!({ "success": true, "items_added": 0, "note": "no concepts found" }),
        );
    }

    let mut schedule = read_review_schedule(&project_path)?;
    let weak_set: std::collections::HashSet<String> = weak_concepts.into_iter().collect();
    let now = now_local_string();
    let mut added = 0u32;

    for (cid, _cname) in &concepts {
        if schedule.items.iter().any(|item| item.concept == *cid) {
            continue; // Idempotent
        }

        let is_weak = weak_set.contains(cid);
        let initial_interval = if is_weak { 1u32 } else { 1u32 };
        // weak concepts get same initial 1-day interval; the review system will
        // shorten subsequent intervals based on node_status=struggling

        schedule.items.push(ReviewItem {
            concept: cid.clone(),
            source_chapter: chapter_file.clone(),
            review_count: 0,
            last_reviewed: String::new(),
            next_review_at: add_days_to_string(&now, initial_interval as i32),
            last_rating: "learning".to_string(),
            status: "upcoming".to_string(),
        });
        added += 1;
    }

    write_review_schedule(&project_path, &schedule)?;
    Ok(serde_json::json!({ "success": true, "items_added": added }))
}

/// PB3: Submit review result — one command updates three files atomically:
/// 1. knowledge-graph.json → node_status (全局唯一概念状态)
/// 2. review-schedule.json → review_count, last_rating, next_review_at
/// 3. review-history.json → append entry
#[tauri::command]
async fn submit_review_result(
    project_path: String,
    concept_id: String,
    rating: String,
    answers: Vec<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    let learning_dir = std::path::PathBuf::from(&project_path).join(".learning");
    let now = now_local_string();
    let correct = rating == "mastered";

    // 1. Update review-schedule.json
    let mut schedule = read_review_schedule(&project_path)?;
    let interval = compute_next_interval(
        schedule
            .items
            .iter()
            .find(|i| i.concept == concept_id)
            .map(|i| i.review_count)
            .unwrap_or(0)
            + 1,
        &rating,
    );
    if let Some(item) = schedule.items.iter_mut().find(|i| i.concept == concept_id) {
        item.review_count += 1;
        item.last_rating = rating.clone();
        item.last_reviewed = now.clone();
        item.next_review_at = add_days_to_string(&now, interval as i32);
        item.status = "upcoming".to_string();
    }
    write_review_schedule(&project_path, &schedule)?;

    // 2. Append to review-history.json
    let history_path = learning_dir.join("review-history.json");
    let mut history: serde_json::Value = if history_path.exists() {
        let content = std::fs::read_to_string(&history_path)
            .map_err(|e| format!("读取 review-history.json 失败: {}", e))?;
        serde_json::from_str(&content)
            .unwrap_or_else(|_| serde_json::json!({ "version": "1.0", "entries": [] }))
    } else {
        serde_json::json!({ "version": "1.0", "entries": [] })
    };

    let entries = history
        .get_mut("entries")
        .and_then(|v| v.as_array_mut())
        .ok_or("review-history.json entries 字段必须是数组")?;
    entries.push(serde_json::json!({
        "concept_id": concept_id,
        "timestamp": now,
        "correct": correct,
        "rating": rating,
        "answers": answers,
    }));
    let history_str = serde_json::to_string_pretty(&history)
        .map_err(|e| format!("序列化 review-history.json 失败: {}", e))?;
    std::fs::write(&history_path, history_str)
        .map_err(|e| format!("写入 review-history.json 失败: {}", e))?;

    // 3. Update knowledge-graph.json node_status
    let graph_path = learning_dir.join("knowledge-graph.json");
    if graph_path.exists() {
        if let Ok(content) = std::fs::read_to_string(&graph_path) {
            if let Ok(mut graph) = serde_json::from_str::<serde_json::Value>(&content) {
                if let Some(nodes) = graph.get_mut("nodes").and_then(|v| v.as_array_mut()) {
                    for node in nodes.iter_mut() {
                        let id = node.get("id").and_then(|v| v.as_str()).unwrap_or("");
                        if id == concept_id {
                            node["node_status"] = serde_json::json!(rating);
                            break;
                        }
                    }
                    if let Ok(json_str) = serde_json::to_string_pretty(&graph) {
                        let _ = std::fs::write(&graph_path, json_str);
                    }
                }
            }
        }
    }

    Ok(serde_json::json!({ "success": true, "concept_id": concept_id, "rating": rating }))
}

/// Update a review item after reviewing
#[tauri::command]
async fn update_review_schedule(
    project_path: String,
    concept: String,
    rating: String,
) -> Result<(), String> {
    let mut schedule = read_review_schedule(&project_path)?;

    if let Some(item) = schedule.items.iter_mut().find(|i| i.concept == concept) {
        item.review_count += 1;
        item.last_rating = rating.clone();
        item.last_reviewed = now_local_string();
        let interval = compute_next_interval(item.review_count, &rating);
        item.next_review_at = add_days_to_string(&item.last_reviewed, interval as i32);
        item.status = "upcoming".to_string();
    }

    write_review_schedule(&project_path, &schedule)?;
    Ok(())
}

/// Postpone a review item to tomorrow
#[tauri::command]
async fn postpone_review_item(project_path: String, concept: String) -> Result<(), String> {
    let mut schedule = read_review_schedule(&project_path)?;

    if let Some(item) = schedule.items.iter_mut().find(|i| i.concept == concept) {
        item.next_review_at = add_days_to_string(&now_local_string(), 1);
        item.status = "upcoming".to_string();
    }

    write_review_schedule(&project_path, &schedule)?;
    Ok(())
}

// ============================================
// Sprint 4: Knowledge Graph Data
// ============================================

#[derive(Debug, Clone, Serialize, Deserialize)]
struct KnowledgeGraph {
    version: String,
    generated_at: String,
    nodes: Vec<KnowledgeNode>,
    edges: Vec<KnowledgeEdge>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct KnowledgeNode {
    id: String,
    name: String,
    chapter: String,
    #[serde(default = "default_node_status")]
    node_status: String,
}

fn default_node_status() -> String {
    "not_started".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct KnowledgeEdge {
    from: String,
    to: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ChapterConcepts {
    chapter: String,
    concepts: Vec<ChapterConcept>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ChapterConcept {
    id: String,
    name: String,
    #[serde(default)]
    depends_on: Vec<String>,
}

/// Check if knowledge-graph.json needs rebuild (any .concepts.json is newer)
#[tauri::command]
async fn check_graph_freshness(project_path: String) -> Result<bool, String> {
    let project_dir = std::path::PathBuf::from(&project_path);
    let graph_path = project_dir.join(".learning").join("knowledge-graph.json");

    // If graph doesn't exist, needs rebuild
    let graph_meta = match std::fs::metadata(&graph_path) {
        Ok(m) => m,
        Err(_) => return Ok(true),
    };
    let graph_mtime = graph_meta
        .modified()
        .unwrap_or(std::time::SystemTime::UNIX_EPOCH);

    // Scan for *.concepts.json files newer than graph
    for entry in std::fs::read_dir(&project_dir).map_err(|e| format!("读取项目目录失败: {}", e))?
    {
        let entry = entry.map_err(|e| format!("目录条目错误: {}", e))?;
        let path = entry.path();
        if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
            if name.ends_with(".concepts.json") {
                if let Ok(meta) = std::fs::metadata(&path) {
                    if let Ok(mtime) = meta.modified() {
                        if mtime > graph_mtime {
                            return Ok(true);
                        }
                    }
                }
            }
        }
    }
    Ok(false)
}

/// Scan project for *.concepts.json files and merge into knowledge-graph.json
/// Preserves existing node_status (keyed by node id) so rebuilding doesn't reset progress.
#[tauri::command]
async fn build_knowledge_graph(project_path: String) -> Result<(), String> {
    let project_dir = std::path::PathBuf::from(&project_path);
    let mut nodes = vec![];
    let mut edges = vec![];
    let mut seen_ids = std::collections::HashSet::new();

    // Read existing knowledge-graph.json to preserve node_status by id
    let learning_dir = project_dir.join(".learning");
    std::fs::create_dir_all(&learning_dir)
        .map_err(|e| format!("创建 .learning 目录失败: {}", e))?;
    let graph_path = learning_dir.join("knowledge-graph.json");
    let mut existing_status: std::collections::HashMap<String, String> =
        std::collections::HashMap::new();
    if graph_path.exists() {
        if let Ok(content) = std::fs::read_to_string(&graph_path) {
            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&content) {
                if let Some(arr) = parsed.get("nodes").and_then(|v| v.as_array()) {
                    for n in arr {
                        if let (Some(id), Some(status)) = (
                            n.get("id").and_then(|v| v.as_str()),
                            n.get("node_status").and_then(|v| v.as_str()),
                        ) {
                            existing_status.insert(id.to_string(), status.to_string());
                        }
                    }
                }
            }
        }
    }

    // Scan for *.concepts.json files
    for entry in std::fs::read_dir(&project_dir).map_err(|e| format!("读取项目目录失败: {}", e))?
    {
        let entry = entry.map_err(|e| format!("目录条目错误: {}", e))?;
        let path = entry.path();
        if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
            if name.ends_with(".concepts.json") {
                let content = std::fs::read_to_string(&path)
                    .map_err(|e| format!("读取 {} 失败: {}", name, e))?;
                let chapter_concepts: ChapterConcepts = serde_json::from_str(&content)
                    .map_err(|e| format!("解析 {} 失败: {}", name, e))?;

                // Extract chapter number from filename
                let chapter = path
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .map(|s| s.replace(".concepts", ""))
                    .unwrap_or_default();

                for concept in chapter_concepts.concepts {
                    if seen_ids.insert(concept.id.clone()) {
                        let status = existing_status
                            .get(&concept.id)
                            .cloned()
                            .unwrap_or_else(default_node_status);
                        nodes.push(KnowledgeNode {
                            id: concept.id.clone(),
                            name: concept.name,
                            chapter: chapter.clone(),
                            node_status: status,
                        });
                    }
                    for dep in concept.depends_on {
                        edges.push(KnowledgeEdge {
                            from: dep,
                            to: concept.id.clone(),
                        });
                    }
                }
            }
        }
    }

    let graph = KnowledgeGraph {
        version: "1.0".to_string(),
        generated_at: now_local_string(),
        nodes,
        edges,
    };

    let json = serde_json::to_string_pretty(&graph)
        .map_err(|e| format!("序列化 knowledge-graph.json 失败: {}", e))?;
    std::fs::write(&graph_path, json)
        .map_err(|e| format!("写入 knowledge-graph.json 失败: {}", e))?;

    Ok(())
}

// ============================================
// Sprint 8: Socratic Review commands
// Pure cluster-selection algorithm + state/session IO + LLM chat
// PHYSICALLY ISOLATED from quiz-history.json and project.json
// ============================================

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SocraticConceptRef {
    id: String,
    title: String,
    source_chapter: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SocraticEdgeRef {
    from: String,
    to: String,
    weight: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SocraticCluster {
    concepts: Vec<SocraticConceptRef>,
    edges: Vec<SocraticEdgeRef>,
    cluster_hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SocraticChatMessage {
    role: String, // "user" | "tutor"
    content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SocraticChatResponse {
    content: String,
    done: bool,
    #[serde(default)]
    session_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SocraticSessionData {
    version: String,
    started_at: String,
    concept_ids: Vec<String>,
    concept_titles: Vec<String>,
    turns: Vec<SocraticChatMessage>,
    ended_at: String,
    end_reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct SocraticStateData {
    last_socratic_at: Option<String>,
    last_dismissed_at: Option<String>,
    #[serde(default)]
    opt_out: bool,
    #[serde(default)]
    quiz_count_since_last_socratic: u32,
    #[serde(default)]
    recent_cluster_hashes: Vec<String>,
}

/// Pure function: BFS from highest-degree node + strong-edge filter (weight >= 0.5).
/// Testable in isolation (no Tauri runtime needed).
fn select_socratic_cluster_pure(
    nodes: &[KnowledgeNode],
    edges: &[KnowledgeEdge],
    target_size: usize,
    min_edge_weight: f32,
) -> Vec<String> {
    if nodes.is_empty() {
        return vec![];
    }

    // Compute degree using weight filter
    let mut degree: std::collections::HashMap<String, u32> = std::collections::HashMap::new();
    for n in nodes {
        degree.insert(n.id.clone(), 0);
    }
    for e in edges {
        // No weight field in current KnowledgeEdge → treat all as 1.0 (passes >= 0.5)
        let _w = min_edge_weight; // suppress unused warning if no weights
        *degree.entry(e.from.clone()).or_insert(0) += 1;
        *degree.entry(e.to.clone()).or_insert(0) += 1;
    }

    // Find anchor = highest-degree node
    let anchor = nodes
        .iter()
        .max_by_key(|n| degree.get(&n.id).copied().unwrap_or(0))
        .map(|n| n.id.clone())
        .unwrap_or_default();

    let mut cluster = vec![anchor.clone()];
    let mut visited = std::collections::HashSet::new();
    visited.insert(anchor.clone());
    let mut frontier = vec![anchor];

    while cluster.len() < target_size && !frontier.is_empty() {
        let mut next_frontier = vec![];
        for node in &frontier {
            for e in edges {
                let neighbor = if &e.from == node {
                    Some(&e.to)
                } else if &e.to == node {
                    Some(&e.from)
                } else {
                    None
                };
                if let Some(nb) = neighbor {
                    if !visited.contains(nb) {
                        visited.insert(nb.clone());
                        cluster.push(nb.clone());
                        next_frontier.push(nb.clone());
                        if cluster.len() >= target_size {
                            break;
                        }
                    }
                }
            }
            if cluster.len() >= target_size {
                break;
            }
        }
        frontier = next_frontier;
    }

    cluster
}

fn cluster_hash(cluster: &[String]) -> String {
    let mut sorted = cluster.to_vec();
    sorted.sort();
    let joined = sorted.join("|");
    // Simple FNV-like hash (avoid pulling md5 crate)
    let mut h: u64 = 14695981039346656037;
    for b in joined.bytes() {
        h ^= b as u64;
        h = h.wrapping_mul(1099511628211);
    }
    format!("{:016x}", h)
}

#[tauri::command]
async fn socratic_select_cluster(project_path: String) -> Result<SocraticCluster, String> {
    let project_dir = std::path::PathBuf::from(&project_path);
    let graph_path = project_dir.join(".learning").join("knowledge-graph.json");

    if !graph_path.exists() {
        // Sparse KG fallback: return empty cluster
        return Ok(SocraticCluster {
            concepts: vec![],
            edges: vec![],
            cluster_hash: "empty".to_string(),
        });
    }

    let content = std::fs::read_to_string(&graph_path)
        .map_err(|e| format!("读取 knowledge-graph.json 失败: {}", e))?;
    let kg: KnowledgeGraph = serde_json::from_str(&content)
        .map_err(|e| format!("解析 knowledge-graph.json 失败: {}", e))?;

    let cluster_ids = select_socratic_cluster_pure(&kg.nodes, &kg.edges, 4, 0.5);

    let concept_refs: Vec<SocraticConceptRef> = cluster_ids
        .iter()
        .filter_map(|id| kg.nodes.iter().find(|n| &n.id == id).cloned())
        .map(|n| SocraticConceptRef {
            id: n.id,
            title: n.name,
            source_chapter: n.chapter,
        })
        .collect();

    let cluster_edges: Vec<SocraticEdgeRef> = kg
        .edges
        .iter()
        .filter(|e| cluster_ids.contains(&e.from) && cluster_ids.contains(&e.to))
        .map(|e| SocraticEdgeRef {
            from: e.from.clone(),
            to: e.to.clone(),
            weight: 1.0,
        })
        .collect();

    Ok(SocraticCluster {
        concepts: concept_refs,
        edges: cluster_edges,
        cluster_hash: cluster_hash(&cluster_ids),
    })
}

#[tauri::command]
async fn socratic_load_state(project_path: String) -> Result<SocraticStateData, String> {
    let state_path = std::path::PathBuf::from(&project_path)
        .join(".learning")
        .join("socratic-state.json");

    if !state_path.exists() {
        return Ok(SocraticStateData::default());
    }

    let content = std::fs::read_to_string(&state_path)
        .map_err(|e| format!("读取 socratic-state.json 失败: {}", e))?;
    serde_json::from_str(&content).map_err(|e| format!("解析 socratic-state.json 失败: {}", e))
}

#[tauri::command]
async fn socratic_save_state(project_path: String, state: SocraticStateData) -> Result<(), String> {
    let learning_dir = std::path::PathBuf::from(&project_path).join(".learning");
    std::fs::create_dir_all(&learning_dir)
        .map_err(|e| format!("创建 .learning 目录失败: {}", e))?;
    let state_path = learning_dir.join("socratic-state.json");
    let json = serde_json::to_string_pretty(&state)
        .map_err(|e| format!("序列化 socratic-state 失败: {}", e))?;
    std::fs::write(&state_path, json)
        .map_err(|e| format!("写入 socratic-state.json 失败: {}", e))?;
    Ok(())
}

#[tauri::command]
async fn socratic_save_session(
    project_path: String,
    session: SocraticSessionData,
) -> Result<String, String> {
    let sessions_dir = std::path::PathBuf::from(&project_path)
        .join(".learning")
        .join("socratic-sessions");
    std::fs::create_dir_all(&sessions_dir)
        .map_err(|e| format!("创建 socratic-sessions 目录失败: {}", e))?;

    let ts = session.ended_at.replace(':', "-").replace('.', "-");
    let file_path = sessions_dir.join(format!("{}.json", ts));
    let json = serde_json::to_string_pretty(&session)
        .map_err(|e| format!("序列化 session 失败: {}", e))?;
    std::fs::write(&file_path, json).map_err(|e| format!("写入 session 文件失败: {}", e))?;
    Ok(file_path.display().to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            // When a new instance is launched while one is already running,
            // emit the file path to the existing instance
            if args.len() > 1 {
                let file_path = &args[1];
                if file_path.ends_with(".md") || file_path.ends_with(".markdown") {
                    let _ = app.emit("open-file-from-args", file_path.clone());
                }
            }
        }))
        .manage(AppState {
            watcher: Mutex::new(None),
            watched_path: Mutex::new(None),
            project_json_lock: Mutex::new(()),
            generation_in_progress: Mutex::new(false),
        })
        .manage(ai_agent::AgentProcess::default())
        .setup(|app| {
            // Log plugin: always active (debug + release) so users can diagnose issues
            app.handle().plugin(
                tauri_plugin_log::Builder::default()
                    .level(log::LevelFilter::Info)
                    .build(),
            )?;

            if cfg!(debug_assertions) {
                let window = app.get_webview_window("main").unwrap();
                window.open_devtools();
            }

            // Check command line arguments for .md file path (file association)
            let args: Vec<String> = std::env::args().collect();
            if args.len() > 1 {
                let file_path = &args[1];
                if file_path.ends_with(".md") || file_path.ends_with(".markdown") {
                    let path = std::path::PathBuf::from(file_path);
                    if path.exists() {
                        let app_handle = app.handle().clone();
                        let path_str = file_path.clone();
                        // Emit event to frontend after a short delay to ensure window is ready
                        std::thread::spawn(move || {
                            std::thread::sleep(std::time::Duration::from_millis(500));
                            let _ = app_handle.emit("open-file-from-args", path_str);
                        });
                    }
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            open_file_dialog,
            open_file,
            render_markdown,
            get_toc,
            notify_external_file_opened,
            open_folder_dialog,
            list_directory,
            watch_file,
            unwatch_file,
            fix_mermaid,
            translate_text,
            get_config,
            set_config,
            test_llm_config,
            export_word,
            get_recent_files,
            add_recent_file,
            clear_recent_files,
            write_file,
            open_slides_window,
            get_platform,
            show_in_folder,
            share_document,
            get_annotations,
            add_annotation,
            delete_annotation,
            update_annotation_note,
            update_annotation,
            ai_agent::plan_course,
            ai_agent::plan_course_llm,
            ai_agent::generate_chapters,
            ai_agent::abort_generation,
            ai_agent::is_agent_running,
            ai_agent::generate_chapter_quiz,
            ai_agent::evaluate_quiz,
            ai_agent::explain_selection,
            ai_agent::check_agent_sdk,
            ai_agent::ensure_extra_questions,
            ai_agent::load_extra_questions,
            create_learning_project,
            setup_project_with_session,
            persist_quiz_result,
            read_quiz_history,
            read_text_file,
            persist_chapter_file,
            exit_app,
            hide_main_window,
            ai_agent::persist_explanation,
            ai_agent::load_chapter_explanations,
            ai_agent::delete_explanation,
            get_review_items,
            update_review_schedule,
            postpone_review_item,
            build_knowledge_graph,
            check_graph_freshness,
            generate_review_content,
            generate_review_content_batch,
            init_review_schedule,
            submit_review_result,
            check_missing_review_cards,
            socratic_select_cluster,
            socratic_load_state,
            socratic_save_state,
            socratic_save_session,
            ai_agent::socratic_chat,
            read_exploration_session,
            write_exploration_session,
            delete_exploration_session,
            ai_agent::explore_chat,
            ai_agent::generate_paper_reader_guide,
            ai_agent::submit_paper_reader_feedback,
            import_paper_from_pdf,
            import_paper_from_url,
            get_paper_import_status,
            create_project_subdir,
            get_demo_file,
            get_app_info
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| match event {
            tauri::RunEvent::WindowEvent {
                label,
                event: tauri::WindowEvent::CloseRequested { api, .. },
                ..
            } if label == "main" => {
                let state = app_handle.state::<AppState>();
                let generation_running = state
                    .generation_in_progress
                    .lock()
                    .map(|g| *g)
                    .unwrap_or(false);
                if generation_running {
                    api.prevent_close();
                    let _ = app_handle.emit("generation-close-requested", ());
                }
            }
            _ => {}
        });
}

// apply_template lives in docx_template module — see src/docx_template.rs
