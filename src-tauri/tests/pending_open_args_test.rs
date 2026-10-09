//! Integration tests for pending_open (pure-std module, #[path] include —
//! linking the full app_lib pulls in WebView2 and the test exe fails to start
//! on some Windows environments).
//!
//! 可执行规格：tests/features/cold_start_file_open.feature（issue #6）
//! 每个 #[test] 与 feature 中的场景一一对应，场景名即测试名。

#[path = "../src/pending_open.rs"]
mod pending_open;

use pending_open::markdown_from_argv;
use std::path::Path;

/// 场景: argv 中的 .md 路径进入待打开缓冲
#[test]
fn argv_markdown_path_is_collected() {
    let args = vec![
        r"C:\app\app.exe".to_string(),
        r"C:\docs\note.md".to_string(),
    ];
    assert_eq!(markdown_from_argv(&args), vec![r"C:\docs\note.md"]);
}

/// 场景: argv[0] 程序自身路径被跳过
#[test]
fn argv0_is_skipped() {
    let args = vec![r"C:\app\app.exe".to_string()];
    assert!(markdown_from_argv(&args).is_empty());
}

/// 场景: 非 markdown 参数被忽略
#[test]
fn non_markdown_args_are_ignored() {
    let args = vec![
        r"C:\app\app.exe".to_string(),
        r"C:\docs\note.txt".to_string(),
    ];
    assert!(markdown_from_argv(&args).is_empty());
}

/// 场景: 扩展名大小写不敏感
#[test]
fn extension_is_case_insensitive() {
    let args = vec![
        r"C:\app\app.exe".to_string(),
        r"C:\docs\NOTE.MD".to_string(),
    ];
    assert_eq!(markdown_from_argv(&args), vec![r"C:\docs\NOTE.MD"]);

    let args = vec![
        r"C:\app\app.exe".to_string(),
        r"C:\docs\note.Markdown".to_string(),
    ];
    assert_eq!(markdown_from_argv(&args), vec![r"C:\docs\note.Markdown"]);
}

/// .markdown 长扩展名同样可打开（与 single-instance 回调的过滤口径一致）
#[test]
fn markdown_long_extension_is_collected() {
    let args = vec![
        r"C:\app\app.exe".to_string(),
        r"C:\docs\note.markdown".to_string(),
    ];
    assert_eq!(markdown_from_argv(&args), vec![r"C:\docs\note.markdown"]);
}

/// 无扩展名 / 点目录等边缘输入不得误判
#[test]
fn edge_cases_are_rejected() {
    let args = vec![
        r"C:\app\app.exe".to_string(),
        r"C:\docs\README".to_string(), // 无扩展名
        r"C:\some.md\dir".to_string(), // .md 是目录名而非扩展名
    ];
    assert!(markdown_from_argv(&args).is_empty());
    // Path::extension 对 "C:\some.md\dir" 返回 None（dir 无扩展名），必须被忽略
    assert!(!pending_open::is_markdown_path(Path::new(
        r"C:\some.md\dir"
    )));
}

/// 场景: 排空后缓冲永久关闭，运行期写入被忽略
///
/// 缓冲是「前端 init 时一次性排空」的设计。macOS 热启动（RunEvent::Opened
/// 打到已运行实例）走 emit 即时打开；若同时写入缓冲，该条目要等下次冷
/// 启动才被排空 → 幽灵文件。因此第一次 drain 后缓冲必须关闭。
#[test]
fn buffer_closes_after_first_drain() {
    let mut buf = pending_open::PendingOpenBuffer::default();

    // 冷启动窗口期：写入正常累积
    buf.push(r"C:\docs\a.md".to_string());
    buf.push(r"C:\docs\b.md".to_string());

    // 前端 init 排空：取走全部，窗口关闭
    let drained = buf.drain();
    assert_eq!(drained, vec![r"C:\docs\a.md", r"C:\docs\b.md"]);

    // 运行期写入（热启动双投递的缓冲侧）必须被忽略
    buf.push(r"C:\docs\stale.md".to_string());
    assert!(buf.drain().is_empty(), "排空后写入的路径不得残留");
}

/// 空缓冲 drain 也应关闭窗口（用户直接启动应用、无文件参数的场景：
/// 之后的运行期写入同样不该残留）
#[test]
fn drain_on_empty_buffer_still_closes_window() {
    let mut buf = pending_open::PendingOpenBuffer::default();
    assert!(buf.drain().is_empty());
    buf.push(r"C:\docs\stale.md".to_string());
    assert!(buf.drain().is_empty());
}
