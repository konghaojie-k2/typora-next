//! PDF 导出（跨平台统一入口）。
//!
//! - macOS：用 NSPrintOperation 走 WebKit 原生打印管线，弹出系统打印面板。
//!   WebKit 打印管线提供自动分页（A4/信纸）、系统页边距与 @media print 样式，
//!   输出效果与 Windows 的 window.print 对齐；用户可在面板左下角选"存储为 PDF"。
//!   背景：WKWebView 不支持 `window.print()`（静默无效，issue #4）；此前改用
//!   createPDF 直存，但只能产出单页、无边距 PDF（issue #5 留白问题），故弃用。
//!   已知限制：macOS 11 以下 WKWebView 打印分页有历史 bug，建议 macOS 11+。
//! - 其他平台：返回 "window-print"，由前端回退 `window.print()`。

use tauri::AppHandle;

/// 导出当前页面为 PDF。
///
/// 返回值约定：
/// - `"window-print"`：当前平台无原生实现，前端应回退 `window.print()`
/// - `"cancelled"`：用户取消了打印面板
/// - `"printed"`：打印面板流程完成（已发送打印任务或在面板内存储为 PDF）
#[tauri::command]
pub async fn export_pdf(
    app: AppHandle,
    suggested_name: String,
    content_width: f64,
    content_height: f64,
) -> Result<String, String> {
    #[cfg(target_os = "macos")]
    {
        macos::export_pdf(&app).await
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, suggested_name, content_width, content_height);
        Ok("window-print".to_string())
    }
}

#[cfg(target_os = "macos")]
mod macos {
    use std::sync::mpsc;

    use tauri::{AppHandle, Manager};

    pub async fn export_pdf(app: &AppHandle) -> Result<String, String> {
        let window = app.get_webview_window("main").ok_or("主窗口不存在")?;
        let (tx, rx) = mpsc::channel::<Result<bool, String>>();

        // with_webview 的闭包在主线程执行；-runModal 在闭包内运行模态打印面板，
        // 面板关闭后才返回（模态 runloop 期间 UI 事件正常处理），结果经 channel 传回。
        window
            .with_webview(move |webview| {
                use objc2::msg_send;
                use objc2_app_kit::NSPrintOperation;
                use objc2_web_kit::WKWebView;

                let wk = unsafe { &*(webview.inner() as *const WKWebView) };

                // WKWebView 实现了 NSView 分页协议（knowsPageRange:/rectForPage:），
                // NSPrintOperation 据此自动分页；页边距来自系统默认打印设置。
                let op = NSPrintOperation::printOperationWithView(wk);
                op.setShowsPrintPanel(true);
                op.setShowsProgressPanel(false);

                // objc2-app-kit 0.3 未绑定 -runModal（运行时存在），直接消息发送。
                // 返回 YES = 用户执行了打印/存储，NO = 取消。
                let ok: bool = unsafe { msg_send![&*op, runModal] };
                let _ = tx.send(Ok(ok));
            })
            .map_err(|e| format!("无法访问 WebView: {}", e))?;

        match rx.recv().map_err(|_| "打印流程被中断")?? {
            true => Ok("printed".to_string()),
            false => Ok("cancelled".to_string()),
        }
    }
}
