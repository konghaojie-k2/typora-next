//! PDF 导出（跨平台统一入口）。
//!
//! - macOS 主路径：headless_chrome（Chromium 打印管线，与 Windows WebView2 同引擎）。
//!   前端生成自包含 HTML（内联 CSS + 字体 base64），Rust 写临时文件 → Chrome
//!   `Page.printToPDF`（A4、边距、自动分页、背景色）→ 保存。
//! - macOS 回退：WKWebView.createPDF（Chrome 未安装 / HTML 生成失败时）。
//!   单页、CSS padding 模拟边距。
//! - 其他平台：返回 "window-print"，由前端回退 `window.print()`（WebView2 = Chromium）。
//!
//! 健壮性：createPDF 路径的 AppKit 调用包在 `objc2::exception::catch` 里（ObjC
//! 异常穿过 Rust 帧 → abort）。Chrome 路径无此风险（独立进程）。

use tauri::AppHandle;

/// 导出当前页面为 PDF。
///
/// 返回值约定：
/// - `"window-print"`：当前平台无原生实现，前端应回退 `window.print()`
/// - `"cancelled"`：用户取消了保存对话框
/// - 文件路径字符串：PDF 已保存到该路径
#[tauri::command]
pub async fn export_pdf(
    app: AppHandle,
    suggested_name: String,
    content_width: f64,
    content_height: f64,
    html: Option<String>,
) -> Result<String, String> {
    #[cfg(target_os = "macos")]
    {
        let _ = (content_width, content_height);
        macos::export_pdf(&app, &suggested_name, html.as_deref()).await
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, suggested_name, content_width, content_height, html);
        Ok("window-print".to_string())
    }
}

#[cfg(target_os = "macos")]
mod macos {
    use std::ffi::{c_char, CStr};
    use std::io::Write;
    use std::panic::AssertUnwindSafe;
    use std::sync::mpsc;

    use objc2::msg_send;
    use objc2::runtime::AnyObject;
    use tauri::{AppHandle, Manager};

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

    pub async fn export_pdf(
        app: &AppHandle,
        suggested_name: &str,
        html: Option<&str>,
    ) -> Result<String, String> {
        // 1. 文件保存对话框
        use tauri_plugin_dialog::DialogExt;
        let save_path = app
            .dialog()
            .file()
            .add_filter("PDF Document", &["pdf"])
            .set_file_name(suggested_name)
            .blocking_save_file();

        let Some(path_ref) = save_path else {
            return Ok("cancelled".to_string());
        };
        let dest = path_ref
            .as_path()
            .unwrap_or(std::path::Path::new(""))
            .to_path_buf();

        // 2. 主路径：headless_chrome（Chromium 打印管线）
        if let Some(html) = html {
            match export_via_chrome(html) {
                Ok(pdf_data) => {
                    std::fs::write(&dest, &pdf_data).map_err(|e| format!("写入文件失败: {}", e))?;
                    return Ok(dest.display().to_string());
                }
                Err(e) => {
                    // Chrome 不可用（未安装 / 启动失败），回退 createPDF
                    eprintln!("[pdf] Chrome 导出失败，回退 createPDF: {}", e);
                }
            }
        }

        // 3. 回退：WKWebView.createPDF
        let pdf_data = export_via_createpdf(app).await?;
        std::fs::write(&dest, &pdf_data).map_err(|e| format!("写入文件失败: {}", e))?;
        Ok(dest.display().to_string())
    }

    /// Chromium 打印管线：写临时 HTML → 启动 headless Chrome → printToPDF（A4 + 边距 + 分页）
    fn export_via_chrome(html: &str) -> Result<Vec<u8>, String> {
        use headless_chrome::types::PrintToPdfOptions;
        use headless_chrome::Browser;

        // 写临时文件（Chrome 通过 file:// 加载）
        let temp_dir = std::env::temp_dir();
        let html_path = temp_dir.join(format!("typora-next-pdf-{}.html", std::process::id()));
        {
            let mut f = std::fs::File::create(&html_path).map_err(|e| e.to_string())?;
            f.write_all(html.as_bytes()).map_err(|e| e.to_string())?;
        }
        let html_url = format!("file://{}", html_path.display());

        let result = (|| -> Result<Vec<u8>, String> {
            let browser = Browser::default().map_err(|e| format!("Chrome 启动失败: {}", e))?;
            let tab = browser
                .new_tab()
                .map_err(|e| format!("无法创建标签页: {}", e))?;
            tab.navigate_to(&html_url)
                .map_err(|e| format!("无法加载页面: {}", e))?;
            tab.wait_until_navigated()
                .map_err(|e| format!("页面加载超时: {}", e))?;

            // A4 尺寸（英寸）+ 边距（20mm 上下 / 15mm 左右）
            let pdf = tab
                .print_to_pdf(Some(PrintToPdfOptions {
                    landscape: Some(false),
                    paper_width: Some(8.27),
                    paper_height: Some(11.69),
                    margin_top: Some(0.787),
                    margin_bottom: Some(0.787),
                    margin_left: Some(0.591),
                    margin_right: Some(0.591),
                    print_background: Some(true),
                    prefer_css_page_size: Some(false),
                    ..Default::default()
                }))
                .map_err(|e| format!("PDF 生成失败: {}", e))?;

            drop(browser);
            Ok(pdf)
        })();

        let _ = std::fs::remove_file(&html_path);
        result
    }

    /// WKWebView.createPDF 回退（Chrome 不可用时）
    async fn export_via_createpdf(app: &AppHandle) -> Result<Vec<u8>, String> {
        let window = app.get_webview_window("main").ok_or("主窗口不存在")?;
        let (tx, rx) = mpsc::channel::<Result<Vec<u8>, String>>();

        window
            .with_webview(move |webview| {
                use objc2::exception;
                use objc2_web_kit::WKWebView;

                let wk = unsafe { &*(webview.inner() as *const WKWebView) };
                // block 内捕获 tx 的 clone，保留原始 tx 给 exception 路径
                let tx_block = tx.clone();

                let block =
                    block2::RcBlock::new(move |data: *mut AnyObject, error: *mut AnyObject| {
                        if !data.is_null() {
                            unsafe {
                                let bytes: *const u8 = msg_send![data, bytes];
                                let length: usize = msg_send![data, length];
                                if !bytes.is_null() && length > 0 {
                                    let slice = std::slice::from_raw_parts(bytes, length);
                                    let _ = tx_block.send(Ok(slice.to_vec()));
                                } else {
                                    let _ = tx_block.send(Err("PDF 数据为空".to_string()));
                                }
                            }
                        } else {
                            let msg = if !error.is_null() {
                                unsafe {
                                    let desc: *mut AnyObject =
                                        msg_send![error, localizedDescription];
                                    if !desc.is_null() {
                                        let utf8: *const c_char = msg_send![desc, UTF8String];
                                        if !utf8.is_null() {
                                            CStr::from_ptr(utf8).to_string_lossy().into_owned()
                                        } else {
                                            "PDF 创建失败（未知错误）".to_string()
                                        }
                                    } else {
                                        "PDF 创建失败（未知错误）".to_string()
                                    }
                                }
                            } else {
                                "PDF 创建失败（无错误信息）".to_string()
                            };
                            let _ = tx_block.send(Err(msg));
                        }
                    });

                let result = exception::catch(AssertUnwindSafe(|| unsafe {
                    let _: () = msg_send![wk, createPDFWithCompletionHandler: &*block];
                }));

                match result {
                    Ok(()) => {}
                    Err(Some(exc)) => {
                        let _ = tx.send(Err(exception_description(&exc)));
                    }
                    Err(None) => {
                        let _ = tx.send(Err("PDF 导出被中断（未获取异常对象）".to_string()));
                    }
                }
            })
            .map_err(|e| format!("无法访问 WebView: {}", e))?;

        rx.recv().map_err(|_| "PDF 创建被中断")?
    }
}
