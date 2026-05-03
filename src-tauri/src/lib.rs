use std::fs;
use std::path::PathBuf;
use serde::{Deserialize, Serialize};
use tauri::Manager;

/// File result containing path and content
#[derive(Debug, Serialize, Deserialize)]
pub struct FileResult {
    path: String,
    content: String,
}

/// Table of Contents item
#[derive(Debug, Serialize, Deserialize)]
pub struct TocItem {
    level: usize,
    text: String,
    slug: String,
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
            let content = fs::read_to_string(&path)
                .map_err(|e| format!("Failed to read file: {}", e))?;
            Ok(FileResult {
                path: path.to_string(),
                content,
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

    Ok(FileResult {
        path: path.to_string(),
        content,
    })
}

/// Render markdown content to HTML (body content only, for WebView injection)
#[tauri::command]
fn render_markdown(content: &str) -> String {
    render_markdown_body(content)
}

/// Simple markdown to HTML renderer (body content only)
fn render_markdown_body(text: &str) -> String {
    use pulldown_cmark::{Parser, Options, html::push_html};

    // Parse with GFM extensions
    let mut options = Options::empty();
    options.insert(Options::ENABLE_TABLES);
    options.insert(Options::ENABLE_STRIKETHROUGH);
    options.insert(Options::ENABLE_TASKLISTS);
    options.insert(Options::ENABLE_SMART_PUNCTUATION);

    let parser = Parser::new_ext(text, options);
    let mut html = String::new();
    push_html(&mut html, parser);

    // Process mermaid blocks
    html = postprocess_mermaid(&html);

    html
}

/// Extract Table of Contents from markdown content
#[tauri::command]
fn get_toc(content: &str) -> Vec<TocItem> {
    extract_toc(content)
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::Builder::new().build())
        .plugin(tauri_plugin_fs::Builder::new().build())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;

                // Open devtools in debug mode
                let window = app.get_webview_window("main").unwrap();
                window.open_devtools();
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![open_file_dialog, open_file, render_markdown, get_toc])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
