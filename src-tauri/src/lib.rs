use std::fs;
use std::path::PathBuf;
use serde::{Deserialize, Serialize};
use tauri::Manager;

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
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
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            open_file_dialog, open_file, render_markdown, get_toc,
            open_folder_dialog, list_directory
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}