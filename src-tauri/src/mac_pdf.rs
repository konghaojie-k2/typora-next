//! PDF 导出（跨平台统一入口）。
//!
//! - macOS：调用 WKWebView 原生 `createPDFWithConfiguration:completionHandler:`
//!   生成矢量 PDF（走 `@media print` 样式），保存对话框由 tauri-plugin-dialog 提供。
//!   背景：WKWebView 不支持 `window.print()`，调用静默无效（GitHub issue #4）。
//! - 其他平台：返回 "window-print"，由前端回退 `window.print()`。

use tauri::AppHandle;

/// 导出当前页面为 PDF。
///
/// 返回值约定：
/// - `"window-print"`：当前平台无原生实现，前端应回退 `window.print()`
/// - `"cancelled"`：用户取消了保存对话框
/// - 其他字符串：保存成功的文件绝对路径
#[tauri::command]
pub async fn export_pdf(
    app: AppHandle,
    suggested_name: String,
    content_width: f64,
    content_height: f64,
) -> Result<String, String> {
    #[cfg(target_os = "macos")]
    {
        macos::export_pdf(&app, &suggested_name, content_width, content_height).await
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
    use tauri_plugin_dialog::DialogExt;

    pub async fn export_pdf(
        app: &AppHandle,
        suggested_name: &str,
        content_width: f64,
        content_height: f64,
    ) -> Result<String, String> {
        // 保存对话框（blocking API 要求从非主线程调用，内部自行切回主线程；
        // async command 运行在后台线程，满足要求）
        let file_path = app
            .dialog()
            .file()
            .add_filter("PDF", &["pdf"])
            .set_file_name(suggested_name)
            .blocking_save_file();
        let Some(file_path) = file_path else {
            return Ok("cancelled".to_string());
        };
        let path = file_path
            .into_path()
            .map_err(|e| format!("无效的保存路径: {}", e))?;

        let window = app.get_webview_window("main").ok_or("主窗口不存在")?;
        let (tx, rx) = mpsc::channel::<Result<Vec<u8>, String>>();

        // with_webview 的闭包在主线程执行；createPDF 完成后经 channel 把字节传回
        window
            .with_webview(move |webview| {
                use block2::RcBlock;
                use objc2::runtime::NSObjectProtocol;
                use objc2::{sel, MainThreadMarker};
                use objc2_core_graphics::{CGPoint, CGRect, CGSize};
                use objc2_foundation::{NSData, NSError};
                use objc2_web_kit::{WKPDFConfiguration, WKWebView};

                let wk = unsafe { &*(webview.inner() as *const WKWebView) };

                // createPDF 与 WKPDFConfiguration 均为 macOS 11+ 引入，
                // 老系统（minimumSystemVersion 10.13）优雅降级
                if !wk.respondsToSelector(sel!(createPDFWithConfiguration:completionHandler:)) {
                    let _ = tx.send(Err(
                        "PDF 导出需要 macOS 11 或更高版本，请升级系统".to_string()
                    ));
                    return;
                }
                let Some(mtm) = MainThreadMarker::new() else {
                    let _ = tx.send(Err("无法访问主线程".to_string()));
                    return;
                };

                // 显式指定完整内容区域：config 传 nil 时只捕获当前可视范围
                let config = unsafe { WKPDFConfiguration::new(mtm) };
                unsafe {
                    config.setRect(CGRect::new(
                        CGPoint::new(0.0, 0.0),
                        CGSize::new(content_width, content_height),
                    ));
                }

                let handler = RcBlock::new(move |data: *mut NSData, error: *mut NSError| {
                    let result = if !data.is_null() {
                        Ok(unsafe { &*data }.as_bytes_unchecked().to_vec())
                    } else if !error.is_null() {
                        Err(format!(
                            "PDF 生成失败: {}",
                            unsafe { &*error }.localizedDescription().to_string()
                        ))
                    } else {
                        Err("PDF 生成失败: 未知错误".to_string())
                    };
                    let _ = tx.send(result);
                });
                unsafe {
                    wk.createPDFWithConfiguration_completionHandler(Some(&config), &handler);
                }
            })
            .map_err(|e| format!("无法访问 WebView: {}", e))?;

        // 后台线程阻塞等待主线程的 createPDF 回调，无死锁
        let bytes = rx.recv().map_err(|_| "PDF 生成被中断".to_string())??;
        std::fs::write(&path, &bytes).map_err(|e| format!("写入文件失败: {}", e))?;
        Ok(path.to_string_lossy().to_string())
    }
}
