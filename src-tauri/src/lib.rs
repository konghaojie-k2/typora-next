use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::PathBuf;
use std::sync::Mutex;
use regex::Regex;
use std::io::Write;
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager};
use notify::{Config, EventKind, RecommendedWatcher, RecursiveMode, Watcher};

pub mod ai_agent;

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
    md2docx_pid: Mutex<Option<u32>>,
    agent_process: ai_agent::AgentProcess,
}

/// Kill all existing md2docx_service processes (Windows only)
#[cfg(windows)]
fn kill_md2docx_service_processes() {
    let mut cmd = std::process::Command::new("taskkill");
    cmd.args(["/F", "/IM", "md2docx_service-x86_64-pc-windows-gnu.exe"])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    cmd.creation_flags(CREATE_NO_WINDOW);
    let _ = cmd.status();
}

/// File result containing path and content
#[derive(Debug, Serialize, Deserialize)]
pub struct FileResult {
    path: String,
    content: String,
    base_dir: String,  // Directory of the file, for resolving relative paths
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

    let file_path = app.dialog()
        .file()
        .add_filter("Markdown", &["md", "markdown"])
        .blocking_pick_file();

    match file_path {
        Some(path) => {
            let path_ref = path.as_path().unwrap_or(&std::path::Path::new(""));
            let path_str = path_ref.display().to_string();
            let base_dir = path_ref.parent()
                .map(|p| p.display().to_string())
                .unwrap_or_default();
            let content = fs::read_to_string(path_ref)
                .map_err(|e| format!("Failed to read file: {}", e))?;
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

    let content = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read file: {}", e))?;

    let base_dir = path.parent()
        .map(|p| p.display().to_string())
        .unwrap_or_default();

    Ok(FileResult {
        path: path.display().to_string(),
        content,
        base_dir,
    })
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
    let title_html = title.map_or(String::new(), |t| format!("<div class=\"frontmatter-title\">{}</div>", escape_html(&t)));
    format!(
        "<div class=\"frontmatter-card\">{}<div class=\"frontmatter-body\">{}</div></div>",
        title_html, rows
    )
}

// ============================================================================
// Math Preprocessing - Protect math blocks from markdown parsing
// ============================================================================

/// Math expression types
#[derive(Debug, Clone, PartialEq)]
enum MathBlock {
    Inline(String),
    Block(String),
}

/// Extract math blocks from text, returning positions and content
///
/// Handles both inline ($...$) and block ($$...$$) math expressions.
/// Block math takes priority (detected first) to avoid partial matches.
fn extract_math_blocks(text: &str) -> Vec<(usize, usize, MathBlock)> {
    let mut results = Vec::new();
    let chars: Vec<char> = text.chars().collect();
    let len = chars.len();
    let mut i = 0;

    while i < len {
        // Check for $$ (block math) first
        if i + 1 < len && chars[i] == '$' && chars[i + 1] == '$' {
            let start = i;
            i += 2; // Skip opening $$

            // Skip leading whitespace/newline after $$
            while i < len && (chars[i] == ' ' || chars[i] == '\n') {
                i += 1;
            }

            let content_start = i;

            // Find closing $$
            while i + 1 < len {
                if chars[i] == '$' && chars[i + 1] == '$' {
                    // Check if it's not escaped
                    let mut backslash_count = 0;
                    let mut j = i - 1;
                    while j > content_start && chars[j] == '\\' {
                        backslash_count += 1;
                        j -= 1;
                    }
                    if backslash_count % 2 == 0 {
                        // Found closing $$ - use byte positions for slicing
                        let byte_content_start = text.char_indices().nth(content_start).map(|(b, _)| b).unwrap_or(0);
                        let byte_end = text.char_indices().nth(i).map(|(b, _)| b).unwrap_or(text.len());
                        let content = text[byte_content_start..byte_end].to_string();
                        let content = content.trim_end().to_string();
                        results.push((start, i + 2, MathBlock::Block(content)));
                        i += 2;
                        break;
                    }
                }
                i += 1;
            }

            if i >= len {
                i = start + 2;
            }
        }
        // Check for single $ (inline math)
        else if chars[i] == '$' {
            let start = i;
            i += 1;

            // Check if $ is followed by space (not inline math)
            if i < len && (chars[i] == ' ' || chars[i] == '\n') {
                i = start + 1;
                continue;
            }

            let content_start = i;

            // Find closing $
            while i < len {
                if chars[i] == '$' {
                    // Check if it's not escaped
                    let mut backslash_count = 0;
                    let mut j = i - 1;
                    while j > content_start && chars[j] == '\\' {
                        backslash_count += 1;
                        j -= 1;
                    }
                    if backslash_count % 2 == 0 {
                        // Use byte positions for slicing
                        let byte_content_start = text.char_indices().nth(content_start).map(|(b, _)| b).unwrap_or(0);
                        let byte_end = text.char_indices().nth(i).map(|(b, _)| b).unwrap_or(text.len());
                        let content = &text[byte_content_start..byte_end];
                        if !content.is_empty() && !content.contains('\n') {
                            results.push((start, i + 1, MathBlock::Inline(content.to_string())));
                            i += 1;
                            break;
                        }
                    }
                }
                i += 1;
            }

            if i >= len {
                i = start + 1;
            }
        } else {
            i += 1;
        }
    }

    results
}

/// Pre-process text to protect math blocks from markdown parsing
///
/// Returns (protected_text, math_blocks) where math_blocks is a vector
/// of (placeholder, original_content, is_block) tuples.
///
/// Uses safe placeholder %%MATH_BLOCK_N%% to avoid DOM truncation issues.
fn preprocess_math(text: &str) -> (String, Vec<(String, String, bool)>) {
    let math_blocks = extract_math_blocks(text);

    if math_blocks.is_empty() {
        return (text.to_string(), Vec::new());
    }

    // Build replacement map
    let mut replacements: Vec<(usize, usize, String, String, bool)> = Vec::new();

    for (idx, (start, end, block)) in math_blocks.into_iter().enumerate() {
        let (content, is_block) = match block {
            MathBlock::Inline(c) => (c, false),
            MathBlock::Block(c) => (c, true),
        };
        // Use safe placeholder (not control characters)
        let placeholder = format!("%%MATH_BLOCK_{}%%", idx);
        replacements.push((start, end, placeholder, content, is_block));
    }

    // Sort by position (descending) to replace from end to start
    replacements.sort_by(|a, b| b.0.cmp(&a.0));

    // Build new string with placeholders
    let mut result = text.to_string();
    let mut stored_blocks = Vec::new();

    for (char_start, char_end, placeholder, content, is_block) in replacements {
        // Convert char positions to byte positions
        let byte_start = result.char_indices().nth(char_start).map(|(b, _)| b).unwrap_or(0);
        let byte_end = result.char_indices().nth(char_end).map(|(b, _)| b).unwrap_or(result.len());

        let before = &result[..byte_start];
        let after = &result[byte_end..];
        stored_blocks.push((placeholder.clone(), content, is_block));
        result = format!("{}{}{}", before, placeholder, after);
    }

    (result, stored_blocks)
}

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
            let replacement = format!(
                "<div class=\"math-block\">$${}$$</div>",
                escaped_content
            );
            result = result.replace(placeholder, &replacement);
        } else {
            // Inline math: wrap in span with KaTeX class
            let replacement = format!(
                "<span class=\"math-inline\">${}$</span>",
                escaped_content
            );
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
    use pulldown_cmark::{Parser, Options, Event, Tag, TagEnd, html::push_html};

    let (frontmatter, body) = extract_frontmatter(text);

    // Step 1: Pre-process to protect math blocks
    let (protected_body, math_blocks) = preprocess_math(&body);

    // Debug log for math preprocessing
    #[cfg(debug_assertions)]
    {
        if !math_blocks.is_empty() {
            println!("[DEBUG render_markdown_body] Found {} math blocks", math_blocks.len());
            for (placeholder, content, is_block) in &math_blocks {
                println!("[DEBUG] {} {}: {}", if *is_block { "Block" } else { "Inline" }, placeholder, content);
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
    html = html.replace("<input disabled=\"\" type=\"checkbox\"", "<input type=\"checkbox\"");
    html = html.replace("<input disabled type=\"checkbox\"", "<input type=\"checkbox\"");
    html = html.replace("<input disabled=\"true\" type=\"checkbox\"", "<input type=\"checkbox\"");

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
#[tauri::command]
async fn open_folder_dialog(app: tauri::AppHandle) -> Result<String, String> {
    use tauri_plugin_dialog::DialogExt;

    let folder_path = app.dialog()
        .file()
        .blocking_pick_folder();

    match folder_path {
        Some(path) => {
            let path_ref = path.as_path().unwrap_or(&std::path::Path::new(""));
            Ok(path_ref.display().to_string())
        }
        None => Err("No folder selected".to_string()),
    }
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

    let entries = read_dir_recursive(&path_buf)
        .map_err(|e| format!("Failed to read directory: {}", e))?;

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
fn watch_file(path: String, app: tauri::AppHandle, state: tauri::State<AppState>) -> Result<(), String> {
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
        move |res: Result<notify::Event, notify::Error>| {
            match res {
                Ok(event) => {
                    if matches!(event.kind, EventKind::Modify(_)) {
                        let _ = app_clone.emit("file-changed", path_for_event.clone());
                    }
                }
                Err(e) => {
                    eprintln!("Watch error: {:?}", e);
                }
            }
        },
        Config::default(),
    ).map_err(|e| format!("Failed to create watcher: {}", e))?;

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
    let config_dir = app.path().app_config_dir()
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
    let content = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read config: {}", e))?;
    let config: AppConfig = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse config: {}", e))?;
    Ok(config)
}

/// Save application configuration
#[tauri::command]
fn set_config(config: AppConfig, app: tauri::AppHandle) -> Result<(), String> {
    let path = config_path(&app)?;
    let content = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;
    fs::write(&path, content)
        .map_err(|e| format!("Failed to write config: {}", e))?;
    Ok(())
}

/// Test LLM configuration by making a simple API call
#[tauri::command]
async fn test_llm_config(config: AppConfig) -> Result<(), String> {
    let api_key = config.api_key
        .filter(|k| !k.is_empty())
        .ok_or("未设置 API Key")?;

    let provider = config.ai_provider.unwrap_or_default();
    let base_url = config.ai_base_url
        .filter(|u| !u.is_empty())
        .unwrap_or_else(|| match provider {
            AiProvider::Anthropic => "https://api.anthropic.com".to_string(),
            AiProvider::Openai => "https://api.openai.com".to_string(),
        });

    let model = config.model
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

            let _json: serde_json::Value = resp.into_json()
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

            let _json: serde_json::Value = resp.into_json()
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

/// Show the given file in the system file manager
#[tauri::command]
fn show_in_folder(path: String) -> Result<(), String> {
    let path_buf = PathBuf::from(&path);
    let os = std::env::consts::OS;

    let result = match os {
        "windows" => {
            std::process::Command::new("explorer")
                .args(["/select,", &path])
                .spawn()
        }
        "macos" => {
            std::process::Command::new("open")
                .args(["-R", &path])
                .spawn()
        }
        _ => {
            // Linux and others: open the parent directory
            let dir = path_buf.parent()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_else(|| path.clone());
            std::process::Command::new("xdg-open")
                .arg(&dir)
                .spawn()
        }
    };

    result.map(|_| ()).map_err(|e| format!("无法打开文件夹: {}", e))
}

/// Resolve Obsidian WikiLink image path (mirrors frontend initObsidianEmbeds logic)
fn resolve_wikilink_path(target: &str, base_dir: &str) -> Option<PathBuf> {
    let base_normalized = base_dir.replace("\\", "/");
    let base_parts: Vec<&str> = base_normalized.split('/').filter(|s| !s.is_empty()).collect();
    let target_normalized = target.replace("\\", "/");
    let target_parts: Vec<&str> = target_normalized.split('/').filter(|s| !s.is_empty()).collect();

    if target_parts.is_empty() {
        return None;
    }

    for i in (0..base_parts.len()).rev() {
        if base_parts[i] == target_parts[0] {
            let mut match_len = 0;
            for j in 0..target_parts.len() {
                if i + j < base_parts.len() && base_parts[i + j] == target_parts[j] {
                    match_len += 1;
                } else {
                    break;
                }
            }
            if match_len > 0 {
                let vault_root = base_parts[..i].join("/");
                return Some(PathBuf::from(format!("{}/{}", vault_root, target)));
            }
        }
    }

    Some(PathBuf::from(base_dir).join(target))
}

/// Compute a relative path for an image within the share bundle
fn compute_share_relative_path(source: &std::path::Path, base_dir: &str, md_dir: &str) -> String {
    let source_str = source.to_string_lossy().replace("\\", "/");
    let base_str = base_dir.replace("\\", "/").trim_end_matches('/').to_string();
    let md_dir_str = md_dir.replace("\\", "/").trim_end_matches('/').to_string();

    if !base_str.is_empty() && source_str.starts_with(&base_str) {
        source_str[base_str.len()..].trim_start_matches('/').to_string()
    } else if !md_dir_str.is_empty() && source_str.starts_with(&md_dir_str) {
        source_str[md_dir_str.len()..].trim_start_matches('/').to_string()
    } else {
        source.file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "image".to_string())
    }
}

/// Export markdown to Word document via md2docx_service
#[tauri::command]
async fn export_word(markdown: String, file_name: String, app: tauri::AppHandle) -> Result<String, String> {
    let resp = ureq::post("http://127.0.0.1:6007/convert")
        .set("Content-Type", "text/plain; charset=utf-8")
        .send_string(&markdown)
        .map_err(|e| format!("md2docx_service 请求失败: {}", e))?;

    let mut bytes = Vec::new();
    resp.into_reader()
        .read_to_end(&mut bytes)
        .map_err(|e| format!("读取响应失败: {}", e))?;

    let default_name = file_name.replace(".md", ".docx").replace(".markdown", ".docx");

    use tauri_plugin_dialog::DialogExt;
    let file_path = app.dialog()
        .file()
        .add_filter("Word Document", &["docx"])
        .set_file_name(&default_name)
        .blocking_save_file();

    match file_path {
        Some(path) => {
            let path_ref = path.as_path().unwrap_or(std::path::Path::new(""));
            std::fs::write(path_ref, &bytes)
                .map_err(|e| format!("写入文件失败: {}", e))?;
            Ok(path_ref.display().to_string())
        }
        None => Err("用户取消了保存".to_string()),
    }
}

/// Share a markdown document with its embedded local images as a ZIP archive
#[tauri::command]
async fn share_document(content: String, file_path: String, base_dir: String, app: tauri::AppHandle) -> Result<String, String> {
    let md_path = PathBuf::from(&file_path);
    let md_name = md_path.file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "document.md".to_string());
    let md_dir = md_path.parent()
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
            let target = &original[3..original.len()-2];
            let name = PathBuf::from(target)
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| "image".to_string());
            let replacement = format!("![{}]({})", name, dest_rel);
            rewritten = rewritten.replace(original, &replacement);
        } else {
            let alt_end = original.find("](").unwrap_or(0);
            let alt = if alt_end > 2 { &original[2..alt_end] } else { "" };
            let replacement = format!("![{}]({})", alt, dest_rel);
            rewritten = rewritten.replace(original, &replacement);
        }
    }

    // Write rewritten markdown to temp directory
    let md_dest = temp_dir.join(&md_name);
    fs::write(&md_dest, rewritten).map_err(|e| format!("写入文件失败: {}", e))?;

    // Create zip archive
    let zip_name = format!("{}.zip", md_name.replace(".md", "").replace(".markdown", ""));
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
        let name = path.strip_prefix(&temp_dir)
            .map_err(|e| format!("路径处理失败: {}", e))?
            .to_string_lossy();
        if path.is_file() {
            zip.start_file(name, options).map_err(|e| format!("添加文件到zip失败: {}", e))?;
            let mut file = fs::File::open(path).map_err(|e| format!("打开文件失败: {}", e))?;
            let mut buffer = Vec::new();
            file.read_to_end(&mut buffer).map_err(|e| format!("读取文件失败: {}", e))?;
            zip.write_all(&buffer).map_err(|e| format!("写入zip失败: {}", e))?;
        }
    }
    zip.finish().map_err(|e| format!("完成zip失败: {}", e))?;

    // Show save dialog
    use tauri_plugin_dialog::DialogExt;
    let save_path = app.dialog()
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

/// Get list of recently opened files
#[tauri::command]
async fn get_recent_files(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let config_dir = app.path().app_config_dir()
        .map_err(|e| format!("无法获取配置目录: {}", e))?;
    let file_path = config_dir.join("recent_files.json");

    if !file_path.exists() {
        return Ok(Vec::new());
    }

    let content = std::fs::read_to_string(&file_path)
        .map_err(|e| format!("读取最近文件列表失败: {}", e))?;

    let files: Vec<String> = serde_json::from_str(&content)
        .map_err(|e| format!("解析最近文件列表失败: {}", e))?;

    Ok(files)
}

/// Add a file to recent files list
#[tauri::command]
async fn add_recent_file(path: String, app: tauri::AppHandle) -> Result<(), String> {
    let config_dir = app.path().app_config_dir()
        .map_err(|e| format!("无法获取配置目录: {}", e))?;
    let file_path = config_dir.join("recent_files.json");

    let mut files: Vec<String> = if file_path.exists() {
        let content = std::fs::read_to_string(&file_path)
            .map_err(|e| format!("读取最近文件列表失败: {}", e))?;
        serde_json::from_str(&content)
            .map_err(|e| format!("解析最近文件列表失败: {}", e))?
    } else {
        Vec::new()
    };

    // Remove existing entry if present
    files.retain(|p| p != &path);
    // Add to front
    files.insert(0, path);
    // Limit to 20
    if files.len() > 20 {
        files.truncate(20);
    }

    let json = serde_json::to_string_pretty(&files)
        .map_err(|e| format!("序列化最近文件列表失败: {}", e))?;

    std::fs::write(&file_path, json)
        .map_err(|e| format!("保存最近文件列表失败: {}", e))?;

    Ok(())
}

/// Clear recent files list
#[tauri::command]
async fn clear_recent_files(app: tauri::AppHandle) -> Result<(), String> {
    let config_dir = app.path().app_config_dir()
        .map_err(|e| format!("无法获取配置目录: {}", e))?;
    let file_path = config_dir.join("recent_files.json");

    let files: Vec<String> = Vec::new();
    let json = serde_json::to_string_pretty(&files)
        .map_err(|e| format!("序列化最近文件列表失败: {}", e))?;

    std::fs::write(&file_path, json)
        .map_err(|e| format!("保存最近文件列表失败: {}", e))?;

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
            fs::write(&path, bytes)
                .map_err(|e| format!("Failed to write file: {}", e))?;
        }
        _ => {
            fs::write(&path, content)
                .map_err(|e| format!("Failed to write file: {}", e))?;
        }
    }
    Ok(())
}

/// Simple file-based logger for slides debugging
fn log_to_file(msg: &str) {
    if let Ok(exe) = std::env::current_exe() {
        let log_path = exe.parent().unwrap_or(std::path::Path::new(".")).join("slides_debug.log");
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
    log_to_file(&format!("[SLIDES] open_slides_window called, content len={}", content.len()));

    // Serialize content as JSON string to safely inject into JS
    let json_content = serde_json::to_string(&content)
        .map_err(|e| format!("Failed to serialize content: {}", e))?;
    let script = format!("window.__slides_content = {};", json_content);
    log_to_file(&format!("[SLIDES] injection script len={}", script.len()));

    // If slides window already exists, update content and focus it
    if let Some(window) = app.get_webview_window("slides") {
        log_to_file("[SLIDES] existing window found, updating content");
        let _ = window.eval(&script);
        let _ = window.eval("if (typeof window.__reloadSlides === 'function') { window.__reloadSlides(); }");
        window.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }

    log_to_file("[SLIDES] creating new window");

    // Try to find the correct resource path
    let resource_dir = app.path().resource_dir()
        .map_err(|e| format!("Failed to get resource dir: {}", e))?;
    log_to_file(&format!("[SLIDES] resource_dir={:?}", resource_dir));

    // Try multiple possible paths (cargo build --release puts exe in target/release/)
    let possible_paths = [
        resource_dir.join("../../../dist/slides.html"),  // from src-tauri/target/release/
        resource_dir.join("../../dist/slides.html"),      // from target/release/
        resource_dir.join("dist/slides.html"),            // from project root
    ];
    let slides_path = possible_paths.iter().find(|path| {
        let clean = path.to_string_lossy().replace("\\\\?\\", "");
        log_to_file(&format!("[SLIDES] trying path={}", clean));
        path.exists()
    }).map(|p| p.to_string_lossy().replace("\\\\?\\", ""));

    if let Some(ref p) = slides_path {
        log_to_file(&format!("[SLIDES] found slides.html at {}", p));
    }

    // Build window with App URL (file:// crashes WebView2)
    log_to_file("[SLIDES] building WebviewWindowBuilder with App URL");
    // DEBUG: try index.html first to isolate the issue
    let test_url = "index.html";
    log_to_file(&format!("[SLIDES] using WebviewUrl::App({})", test_url));
    let builder = tauri::WebviewWindowBuilder::new(
        &app,
        "slides",
        tauri::WebviewUrl::App(test_url.into())
    )
    .title("幻灯片放映")
    .inner_size(1280.0, 720.0)
    .min_inner_size(800.0, 600.0);

    log_to_file("[SLIDES] calling build()...");
    let window = builder.build()
        .map_err(|e| format!("无法创建幻灯片窗口: {}", e))?;

    log_to_file(&format!("[SLIDES] window created OK, label={}", window.label()));

    // Inject content via eval after a short delay (avoid initialization_script crash)
    let window_clone = window.clone();
    let script_clone = script.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(500));
        let _ = window_clone.eval(&script_clone);
        let _ = window_clone.eval("if (typeof window.__reloadSlides === 'function') { window.__reloadSlides(); }");
    });

    Ok(())
}

/// Fix Mermaid syntax errors using AI
#[tauri::command]
async fn fix_mermaid(code: String, error: String, app: tauri::AppHandle) -> Result<String, String> {
    let config = get_config(app)?;
    let api_key = config.api_key
        .filter(|k| !k.is_empty())
        .ok_or("未设置 API Key，请在设置中配置")?;

    let provider = config.ai_provider.unwrap_or_default();
    let base_url = config.ai_base_url
        .filter(|u| !u.is_empty())
        .unwrap_or_else(|| match provider {
            AiProvider::Anthropic => "https://api.anthropic.com".to_string(),
            AiProvider::Openai => "https://api.openai.com".to_string(),
        });

    let model = config.model
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

    let json: serde_json::Value = response.into_json()
        .map_err(|e| format!("解析响应失败: {}", e))?;

    let fixed_code = if is_anthropic {
        json["content"][0]["text"].as_str()
    } else {
        json["choices"][0]["message"]["content"].as_str()
    }.ok_or("响应中没有内容")?;

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
    let content = serde_json::to_string_pretty(&value)
        .map_err(|e| format!("序列化翻译缓存失败: {}", e))?;
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
    let api_key = config.api_key
        .filter(|k| !k.is_empty())
        .ok_or("未设置 API Key，请在设置中配置")?;

    let provider = config.ai_provider.unwrap_or_default();
    let base_url = config.ai_base_url
        .filter(|u| !u.is_empty())
        .unwrap_or_else(|| match provider {
            AiProvider::Anthropic => "https://api.anthropic.com".to_string(),
            AiProvider::Openai => "https://api.openai.com".to_string(),
        });

    let model = config.model
        .filter(|m| !m.is_empty())
        .unwrap_or_else(|| match provider {
            AiProvider::Anthropic => "claude-3-5-haiku-20241022".to_string(),
            AiProvider::Openai => "gpt-4o-mini".to_string(),
        });

    let joined_texts = uncached_texts.iter().enumerate()
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

    let json: serde_json::Value = response.into_json()
        .map_err(|e| format!("解析响应失败: {}", e))?;

    let content = if is_anthropic {
        json["content"][0]["text"].as_str()
    } else {
        json["choices"][0]["message"]["content"].as_str()
    }.ok_or("响应中没有内容")?;

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
    println!("[DEBUG annotations_file_path] input='{}' hash='{}' path='{}'", file_path, file_hash, path.display());
    Ok(path)
}

fn load_annotations(app: &tauri::AppHandle, file_path: &str) -> Result<Vec<Annotation>, String> {
    let path = annotations_file_path(app, file_path)?;
    if !path.exists() {
        println!("[DEBUG load_annotations] file not exists, returning empty. path='{}'", path.display());
        return Ok(Vec::new());
    }
    let content = fs::read_to_string(&path).map_err(|e| format!("读取批注失败: {}", e))?;
    println!("[DEBUG load_annotations] raw content length={}, path='{}'", content.len(), path.display());
    let value: serde_json::Value =
        serde_json::from_str(&content).map_err(|e| format!("解析批注失败: {}", e))?;
    match value.get("annotations") {
        Some(arr) => {
            let anns: Vec<Annotation> = serde_json::from_value(arr.clone())
                .map_err(|e| format!("解析批注数组失败: {}", e))?;
            println!("[DEBUG load_annotations] loaded {} annotations", anns.len());
            for (i, ann) in anns.iter().enumerate() {
                println!("[DEBUG load_annotations] #{} id='{}' text_len={} text_hash='{}' note_len={}",
                         i, ann.id, ann.text.len(), ann.text_hash, ann.note.len());
            }
            Ok(anns)
        }
        None => {
            println!("[DEBUG load_annotations] no 'annotations' key found");
            Ok(Vec::new())
        },
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
    println!("[DEBUG save_annotations_file] writing {} annotations to '{}'", annotations.len(), path.display());
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
        Ok(anns) => println!("[DEBUG get_annotations] returning {} annotations", anns.len()),
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
    println!("[DEBUG add_annotation] file_path='{}' id='{}' text_len={}", file_path, annotation.id, annotation.text.len());
    annotation.text_hash = text_hash(&annotation.text);
    println!("[DEBUG add_annotation] computed text_hash='{}'", annotation.text_hash);
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
    println!("[DEBUG update_annotation] id='{}' color={:?} style={:?} note_len={:?}", id, color, style, note.as_ref().map(|n| n.len()));
    let mut annotations = load_annotations(&app, &file_path)?;
    if let Some(ann) = annotations.iter_mut().find(|a| a.id == id) {
        if let Some(c) = color { ann.color = c; }
        if let Some(s) = style { ann.style = s; }
        if let Some(n) = note { ann.note = n; }
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
                "status": "not_generated",
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
) -> Result<(), String> {
    let learning_dir = std::path::PathBuf::from(&project_path).join(".learning");
    std::fs::create_dir_all(&learning_dir)
        .map_err(|e| format!("创建 .learning 目录失败: {}", e))?;

    // Extract basename for matching against project.json "file" field
    let chapter_basename = std::path::Path::new(&chapter_file)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| chapter_file.clone());

    // 1. Update project.json
    let project_json_path = learning_dir.join("project.json");
    let mut project: serde_json::Value = if project_json_path.exists() {
        let content = std::fs::read_to_string(&project_json_path)
            .map_err(|e| format!("读取 project.json 失败: {}", e))?;
        serde_json::from_str(&content)
            .map_err(|e| format!("解析 project.json 失败: {}", e))?
    } else {
        serde_json::json!({
            "name": "Learning Project",
            "created": std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0),
            "chapters": [],
            "concepts": {}
        })
    };

    // Mark chapter completed + record last quiz info
    if let Some(chapters) = project.get_mut("chapters").and_then(|v| v.as_array_mut()) {
        let mut chapter_concepts: Vec<String> = Vec::new();
        for ch in chapters.iter_mut() {
            let ch_file = ch.get("file").and_then(|v| v.as_str()).unwrap_or("");
            if ch_file == chapter_basename || ch_file == chapter_file {
                ch["status"] = serde_json::json!("completed");
                ch["last_quiz_rating"] = serde_json::json!(&rating);
                ch["last_quiz_at"] = serde_json::json!(&timestamp);
                if let Some(concepts) = ch.get("concepts").and_then(|v| v.as_array()) {
                    chapter_concepts = concepts.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect();
                }
                break;
            }
        }

        // Update concept mastery states
        if project.get("concepts").is_none() {
            project["concepts"] = serde_json::json!({});
        }
        let concepts_obj = project.get_mut("concepts")
            .and_then(|v| v.as_object_mut())
            .ok_or("project.json concepts 字段必须是对象")?;

        // Weak concepts get status based on rating (never mastered if explicitly weak)
        for concept in &weak_concepts {
            let status = match rating.as_str() {
                "mastered" | "learning" => "learning",
                "struggling" => "struggling",
                _ => "learning",
            };
            concepts_obj.insert(concept.clone(), serde_json::json!({
                "status": status,
                "source_chapter": chapter_basename,
                "updated_at": timestamp
            }));
        }

        // Non-weak chapter concepts: mastered if overall mastered, otherwise learning
        let non_weak_status = if rating == "mastered" { "mastered" } else { "learning" };
        for concept in chapter_concepts {
            if !weak_concepts.contains(&concept) {
                concepts_obj.insert(concept.clone(), serde_json::json!({
                    "status": non_weak_status,
                    "source_chapter": chapter_basename,
                    "updated_at": timestamp
                }));
            }
        }
    }

    let project_str = serde_json::to_string_pretty(&project)
        .map_err(|e| format!("序列化 project.json 失败: {}", e))?;
    std::fs::write(&project_json_path, project_str)
        .map_err(|e| format!("写入 project.json 失败: {}", e))?;

    // 2. Append to quiz-history.json
    let history_path = learning_dir.join("quiz-history.json");
    let mut history: serde_json::Value = if history_path.exists() {
        let content = std::fs::read_to_string(&history_path)
            .map_err(|e| format!("读取 quiz-history.json 失败: {}", e))?;
        serde_json::from_str(&content).unwrap_or_else(|_| {
            serde_json::json!({ "version": "1.0", "entries": [] })
        })
    } else {
        serde_json::json!({ "version": "1.0", "entries": [] })
    };

    let entries = history.get_mut("entries").and_then(|v| v.as_array_mut())
        .ok_or("quiz-history.json entries 字段必须是数组")?;

    let answer_json: Vec<serde_json::Value> = answers.into_iter().map(|a| {
        serde_json::json!({
            "question_id": a.question_id,
            "qtype": a.qtype,
            "user_answer": a.user_answer,
            "is_correct": a.is_correct,
        })
    }).collect();

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
    let path = std::path::PathBuf::from(&project_path).join(".learning").join("quiz-history.json");
    if !path.exists() {
        return Ok(serde_json::json!({ "version": "1.0", "entries": [] }));
    }
    let content = std::fs::read_to_string(&path)
        .map_err(|e| format!("读取 quiz-history.json 失败: {}", e))?;
    let value: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| format!("解析 quiz-history.json 失败: {}", e))?;
    Ok(value)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
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
            md2docx_pid: Mutex::new(None),
            agent_process: ai_agent::AgentProcess::default(),
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

            // Start md2docx_service for Word export (Windows only)
            #[cfg(windows)]
            {
                let state: tauri::State<AppState> = app.state();
                let possible_paths = [
                    app.path().resource_dir().ok().map(|p| p.join("bin/md2docx_service-x86_64-pc-windows-gnu.exe")),
                    std::env::current_exe().ok().and_then(|p| p.parent().map(|p| p.join("md2docx_service-x86_64-pc-windows-gnu.exe"))),
                ];

                for path_opt in &possible_paths {
                    if let Some(path) = path_opt {
                        if path.exists() {
                            let mut cmd = std::process::Command::new(&path);
                            cmd.stdout(std::process::Stdio::null())
                                .stderr(std::process::Stdio::null());
                            use std::os::windows::process::CommandExt;
                            const CREATE_NO_WINDOW: u32 = 0x08000000;
                            cmd.creation_flags(CREATE_NO_WINDOW);
                            if let Ok(child) = cmd.spawn() {
                                let pid = child.id();
                                let mut pid_guard = state.md2docx_pid.lock().unwrap();
                                *pid_guard = Some(pid);
                                println!("[DEBUG] Started md2docx_service with PID: {}", pid);
                            }
                            break;
                        }
                    }
                }
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
            open_file_dialog, open_file, render_markdown, get_toc,
            open_folder_dialog, list_directory, watch_file, unwatch_file,
            fix_mermaid, translate_text, get_config, set_config, test_llm_config, export_word,
            get_recent_files, add_recent_file, clear_recent_files, write_file,
            open_slides_window, get_platform, show_in_folder, share_document,
            get_annotations, add_annotation, delete_annotation, update_annotation_note, update_annotation,
            ai_agent::plan_course, ai_agent::generate_chapters, ai_agent::abort_generation, ai_agent::is_agent_running,
            ai_agent::generate_chapter_quiz, ai_agent::evaluate_quiz, ai_agent::explain_selection,
            create_learning_project, persist_quiz_result, read_quiz_history
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                #[cfg(windows)]
                {
                    println!("[DEBUG] Killing all md2docx_service processes on exit");
                    kill_md2docx_service_processes();
                }
            }
        });
}