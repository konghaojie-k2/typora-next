//! Pi SDK 安装进度的纯函数辅助（不依赖 Tauri、不 spawn 进程）。
//!
//! 抽成独立模块以便用 `#[path]` include 测试：link app_lib 的集成测试
//! exe 在部分 Windows 环境起不来（见 create_project_subdir_test.rs 同类处理）。

/// 错误上下文中最多保留的原始输出行数
const TAIL_LINES: usize = 5;

/// 国内镜像兜底源（仅主源网络失败后才使用，sdk-install-mirror-fallback）
pub const NPM_MIRROR_REGISTRY: &str = "https://registry.npmmirror.com";

/// 判定 npm 输出是否属于网络类失败（ENOTFOUND/超时/连接重置等）。
/// 网络失败才值得换镜像重试；权限/缺 npm 等换了也没用。
pub fn is_network_failure(output: &str) -> bool {
    output.contains("ENOTFOUND")
        || output.contains("ETIMEDOUT")
        || output.contains("ECONNRESET")
        || output.contains("ECONNREFUSED")
        || output.contains("EAI_AGAIN")
        || output.contains("fetch failed")
        || output.contains("network timeout")
}

/// 保留最后 n 条非空行（去除首尾空白）
fn tail_nonempty_lines(text: &str, n: usize) -> String {
    let lines: Vec<&str> = text
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .collect();
    let start = lines.len().saturating_sub(n);
    lines[start..].join("\n")
}

/// 退出码的可读表示（None = 进程未能正常退出/未知）
fn exit_code_text(code: Option<i32>) -> String {
    match code {
        Some(c) => c.to_string(),
        None => "未知".to_string(),
    }
}

/// 把 npm install 的原始输出分类为用户可读的失败原因。
///
/// `install_pi_sdk` 命令失败时返回给前端展示；分类优先级：
/// 网络 → 权限 → npm 缺失 → 无输出 → 通用尾部原文。
pub fn extract_install_error(output: &str, exit_code: Option<i32>) -> String {
    let tail = tail_nonempty_lines(output, TAIL_LINES);

    if is_network_failure(output) {
        return format!(
            "网络连接失败，无法访问 npm 仓库。请检查网络后重试。\n{}",
            tail
        );
    }

    if output.contains("EPERM") || output.contains("EACCES") || output.contains("EBUSY") {
        return format!(
            "权限不足或文件被占用。请关闭占用文件的程序（如杀毒软件）后重试。\n{}",
            tail
        );
    }

    // Windows 中文控制台的 cmd 报错是 GBK 编码，经 UTF-8 转换后可能乱码，
    // 因此 Windows 上 npm 缺失主要由 run_npm_install 的 npm --version 预检判定；
    // 这里保留英文/Unix 场景的文本兜底。
    if output.contains("not recognized")
        || output.contains("不是内部或外部命令")
        || output.contains("command not found")
        || output.contains("npm: not found")
    {
        return "未检测到 npm。请先安装 Node.js（https://nodejs.org），然后重试。".to_string();
    }

    if tail.is_empty() {
        return format!(
            "npm install 失败（退出码 {}），且无输出。请确认 npm 可用后重试。",
            exit_code_text(exit_code)
        );
    }

    format!(
        "npm install 失败（退出码 {}）：\n{}",
        exit_code_text(exit_code),
        tail
    )
}
