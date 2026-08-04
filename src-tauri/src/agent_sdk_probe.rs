//! Agent SDK 轻量文件系统探测（GitHub issue #2）。
//!
//! 与 `ai_agent::check_agent_sdk` 不同，本模块不依赖 Tauri、不 spawn 任何
//! 进程、不触发 npm 自动安装，因此可以安全地在应用启动时调用，用于决定
//! 是否显示"SDK 缺失"引导 toast。
//!
//! 取舍：自定义 npm prefix 安装的全局 SDK 不会被发现（完整检测通过
//! `npm root -g` 覆盖这种情况）；误判的代价只是多弹一次可永久忽略的 toast。

/// 文件系统探测结果。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProbeResult {
    pub found: bool,
    /// 发现 SDK 的 node_modules 目录（未找到为 None）
    pub location: Option<std::path::PathBuf>,
}

/// 纯文件系统探测：候选目录中是否存在 `@earendil-works/pi-coding-agent`。
pub fn probe_agent_sdk_fs(bridge_path: Option<&std::path::Path>) -> ProbeResult {
    for dir in candidate_sdk_dirs(bridge_path) {
        if dir.join("@earendil-works").join("pi-coding-agent").exists() {
            return ProbeResult {
                found: true,
                location: Some(dir),
            };
        }
    }
    ProbeResult {
        found: false,
        location: None,
    }
}

/// Directories that may directly contain `@earendil-works/pi-coding-agent`
/// (i.e. each candidate itself is a node_modules directory).
pub fn candidate_sdk_dirs(bridge_path: Option<&std::path::Path>) -> Vec<std::path::PathBuf> {
    let mut dirs = Vec::new();

    // 1. Dev / bundled: node_modules next to agent-bridge.js
    if let Some(parent) = bridge_path.and_then(|p| p.parent()) {
        dirs.push(parent.join("node_modules"));
    }

    // 2. Auto-install target (see ai_agent::resolve_agent_node_path)
    if let Some(app_data) = agent_app_data_dir() {
        dirs.push(app_data.join("node_modules"));
    }

    // 3. Common default global npm prefixes (no spawn)
    if cfg!(windows) {
        if let Ok(appdata) = std::env::var("APPDATA") {
            dirs.push(
                std::path::PathBuf::from(appdata)
                    .join("npm")
                    .join("node_modules"),
            );
        }
    } else {
        dirs.push(std::path::PathBuf::from("/usr/local/lib/node_modules"));
        if cfg!(target_os = "macos") {
            dirs.push(std::path::PathBuf::from("/opt/homebrew/lib/node_modules"));
        }
        if let Ok(home) = std::env::var("HOME") {
            dirs.push(
                std::path::PathBuf::from(home)
                    .join(".npm-global")
                    .join("lib")
                    .join("node_modules"),
            );
        }
    }

    dirs
}

/// Get the platform-appropriate directory for auto-installing the Agent SDK.
/// `ai_agent::resolve_agent_node_path` 的自动安装也使用此目录。
pub fn agent_app_data_dir() -> Option<std::path::PathBuf> {
    if cfg!(windows) {
        let appdata = std::env::var("APPDATA").ok()?;
        Some(
            std::path::PathBuf::from(&appdata)
                .join("TyporaNext")
                .join("agent"),
        )
    } else if cfg!(target_os = "macos") {
        let home = std::env::var("HOME").ok()?;
        Some(
            std::path::PathBuf::from(&home)
                .join("Library")
                .join("Application Support")
                .join("com.typora-next.app")
                .join("agent"),
        )
    } else {
        // Linux / other Unix
        let home = std::env::var("HOME").ok()?;
        Some(
            std::path::PathBuf::from(&home)
                .join(".local")
                .join("share")
                .join("typora-next")
                .join("agent"),
        )
    }
}
