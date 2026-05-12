use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager};
use notify::{Config, EventKind, RecommendedWatcher, RecursiveMode, Watcher};

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

/// Application state for file watching
pub struct AppState {
    watcher: Mutex<Option<RecommendedWatcher>>,
    watched_path: Mutex<Option<String>>,
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

/// Escape HTML special characters
fn escape_html(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

/// Simple markdown to HTML renderer (body content only)
fn render_markdown_body(text: &str) -> String {
    use pulldown_cmark::{Parser, Options, html::push_html};

    let (frontmatter, body) = extract_frontmatter(text);

    // Parse with GFM extensions
    let mut options = Options::empty();
    options.insert(Options::ENABLE_TABLES);
    options.insert(Options::ENABLE_STRIKETHROUGH);
    options.insert(Options::ENABLE_TASKLISTS);
    options.insert(Options::ENABLE_SMART_PUNCTUATION);

    let parser = Parser::new_ext(&body, options);
    let mut html = String::new();
    push_html(&mut html, parser);

    // Process mermaid blocks
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
    let mut found_path = None;
    for (i, path) in possible_paths.iter().enumerate() {
        let clean = path.to_string_lossy().replace("\\\\?\\", "");
        log_to_file(&format!("[SLIDES] trying path[{}]={}", i, clean));
        if path.exists() {
            found_path = Some(clean);
            log_to_file(&format!("[SLIDES] found slides.html at path[{}]", i));
            break;
        }
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
        })
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;

                let window = app.get_webview_window("main").unwrap();
                window.open_devtools();
            }

            // Start md2docx_service for Word export
            let app_handle = app.handle().clone();
            std::thread::spawn(move || {
                // Try to find the service binary
                let possible_paths = [
                    app_handle.path().resource_dir().ok().map(|p| p.join("bin/md2docx_service-x86_64-pc-windows-gnu.exe")),
                    std::env::current_exe().ok().and_then(|p| p.parent().map(|p| p.join("md2docx_service-x86_64-pc-windows-gnu.exe"))),
                ];

                for path_opt in &possible_paths {
                    if let Some(path) = path_opt {
                        if path.exists() {
                            let mut cmd = std::process::Command::new(path);
                            cmd.stdout(std::process::Stdio::null())
                                .stderr(std::process::Stdio::null());
                            #[cfg(windows)]
                            {
                                use std::os::windows::process::CommandExt;
                                const CREATE_NO_WINDOW: u32 = 0x08000000;
                                cmd.creation_flags(CREATE_NO_WINDOW);
                            }
                            let _ = cmd.spawn();
                            break;
                        }
                    }
                }
            });

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
            fix_mermaid, get_config, set_config, test_llm_config, export_word,
            get_recent_files, add_recent_file, clear_recent_files, write_file,
            open_slides_window
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}