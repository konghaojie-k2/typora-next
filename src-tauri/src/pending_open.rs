//! Cold-start "open file" path collection (pure logic, no Tauri deps).
//!
//! Windows 冷启动经文件关联双击打开时，文件路径在进程 argv 里。
//! 历史上 setup 用 sleep 500ms 后 emit 投递给前端——listener 晚于
//! 500ms 注册时事件丢失（issue #6：双击不加载、二次点击才加载）。
//! 现改为推入 AppState::pending_open_paths 缓冲，前端 init 时经
//! take_pending_open_files 排空，与 macOS RunEvent::Opened 路径同构。
//!
//! 本模块不含 IO / Tauri 类型，供 src-tauri/tests/pending_open_args_test.rs
//! 以 #[path] include 方式测试（避免链接 app_lib 起不来测试 exe）。

use std::path::Path;

/// True for .md / .markdown paths (case-insensitive).
pub fn is_markdown_path(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("md") || e.eq_ignore_ascii_case("markdown"))
        .unwrap_or(false)
}

/// Extract markdown file paths from process argv (file-association cold
/// start: `app.exe <file.md>`). Skips argv[0] (the executable itself).
/// Pure filter — callers decide on existence checks / buffering.
pub fn markdown_from_argv(args: &[String]) -> Vec<String> {
    args.iter()
        .skip(1)
        .filter(|a| is_markdown_path(Path::new(a)))
        .cloned()
        .collect()
}

/// Buffer for markdown paths that arrive before the frontend listener is
/// registered (cold start). The frontend drains it once at init via
/// take_pending_open_files.
///
/// After that first drain the buffer closes permanently: later arrivals
/// (macOS warm start, RunEvent::Opened on a running instance) reach the
/// frontend through the event channel, and buffering them too would leave
/// a stale entry that the NEXT cold start's drain would resurrect as a
/// ghost open.
#[derive(Default)]
pub struct PendingOpenBuffer {
    paths: Vec<String>,
    drained: bool,
}

impl PendingOpenBuffer {
    /// Buffer a path for the init-time drain. No-op once the frontend has
    /// drained (the event channel covers delivery from then on).
    pub fn push(&mut self, path: String) {
        if !self.drained {
            self.paths.push(path);
        }
    }

    /// Take all buffered paths and close the buffer.
    pub fn drain(&mut self) -> Vec<String> {
        self.drained = true;
        std::mem::take(&mut self.paths)
    }
}
