//! PDF 导出（跨平台统一入口）。
//!
//! - macOS：用 NSPrintOperation 走 WebKit 原生打印管线，弹出系统打印面板。
//!   WebKit 打印管线提供自动分页（A4/信纸）、系统页边距与 @media print 样式，
//!   输出效果与 Windows 的 window.print 对齐；用户可在面板左下角选"存储为 PDF"。
//!   背景：WKWebView 不支持 `window.print()`（静默无效，issue #4）；此前改用
//!   createPDF 直存，但只能产出单页、无边距 PDF（issue #5 留白问题），故弃用。
//!   已知限制：macOS 11 以下 WKWebView 打印分页有历史 bug，建议 macOS 11+。
//! - 其他平台：返回 "window-print"，由前端回退 `window.print()`。
//!
//! 健壮性：整段 AppKit 调用包在 `objc2::exception::catch` 里。ObjC 异常
//! （NSException）若穿过 Rust 帧，Rust 无法展开 → 整个 app 直接 abort
//! （2026-07-28 macOS 26.5.2 实机闪退根因）。catch 住后转成错误文本经
//! 前端 toast 展示，既保活进程，也把诊断信息带回给测试者。

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
        // 打印面板方案不需要前端测量的尺寸（WebKit 打印管线自行分页布局）
        let _ = (suggested_name, content_width, content_height);
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
    use std::ffi::{c_char, CStr};
    use std::panic::AssertUnwindSafe;
    use std::sync::mpsc;

    use objc2::msg_send;
    use objc2::runtime::AnyObject;
    use tauri::{AppHandle, Manager};

    /// 提取 NSException 的描述文本（不依赖 objc2-foundation，直接走
    /// description → UTF8String 消息发送）。
    fn exception_description(exc: &AnyObject) -> String {
        unsafe {
            let desc: *mut AnyObject = msg_send![exc, description];
            if desc.is_null() {
                return "NSException（无法获取描述）".to_string();
            }
            let utf8: *const c_char = msg_send![desc, UTF8String];
            if utf8.is_null() {
                "NSException（无法获取描述）".to_string()
            } else {
                CStr::from_ptr(utf8).to_string_lossy().into_owned()
            }
        }
    }

    pub async fn export_pdf(app: &AppHandle) -> Result<String, String> {
        let window = app.get_webview_window("main").ok_or("主窗口不存在")?;
        let (tx, rx) = mpsc::channel::<Result<bool, String>>();

        // with_webview 的闭包在主线程执行；打印面板流程阻塞其中，
        // 面板关闭后结果经 channel 传回。
        window
            .with_webview(move |webview| {
                use objc2::exception;
                use objc2_app_kit::NSPrintOperation;
                use objc2_web_kit::WKWebView;

                let wk = unsafe { &*(webview.inner() as *const WKWebView) };

                // WKWebView 实现 NSView 分页协议（knowsPageRange:/rectForPage:），
                // NSPrintOperation 据此自动分页；页边距来自系统默认打印设置。
                //
                // 不用 -runModal：objc2-app-kit 0.3 绑定缺失（按新版 SDK 生成，
                // 疑似 macOS 26 已移除），msg_send 直发触发 "unrecognized
                // selector" NSException = 2026-07-28 闪退主嫌疑。改用绑定内、
                // 文档在列的 runOperation（同步运行，显示面板，阻塞至关闭）。
                let result = exception::catch(AssertUnwindSafe(|| {
                    let op = NSPrintOperation::printOperationWithView(wk);
                    op.setShowsPrintPanel(true);
                    op.setShowsProgressPanel(false);
                    op.runOperation()
                }));
                let outcome = match result {
                    Ok(ok) => Ok(ok),
                    // catch 住 NSException：转成错误文本，避免 app abort
                    Err(Some(exc)) => Err(exception_description(&exc)),
                    Err(None) => Err("PDF 导出被中断（未获取异常对象）".to_string()),
                };
                let _ = tx.send(outcome);
            })
            .map_err(|e| format!("无法访问 WebView: {}", e))?;

        match rx.recv().map_err(|_| "打印流程被中断")?? {
            true => Ok("printed".to_string()),
            false => Ok("cancelled".to_string()),
        }
    }
}
