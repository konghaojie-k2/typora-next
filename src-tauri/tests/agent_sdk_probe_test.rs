//! Integration tests for Agent SDK startup probe (GitHub issue #2).
//!
//! `probe_agent_sdk` 是纯文件系统探测（不 spawn 进程、不自动安装），
//! 用于启动时决定是否显示 SDK 缺失引导。这里验证其候选目录逻辑。
//!
//! Run with: cargo test --test agent_sdk_probe_test

use std::path::{Path, PathBuf};

// ============================================
// Mirrored implementation (must stay in sync with
// src-tauri/src/agent_sdk_probe.rs)
// ============================================
fn agent_app_data_dir() -> Option<PathBuf> {
    if cfg!(windows) {
        let appdata = std::env::var("APPDATA").ok()?;
        Some(PathBuf::from(&appdata).join("TyporaNext").join("agent"))
    } else if cfg!(target_os = "macos") {
        let home = std::env::var("HOME").ok()?;
        Some(
            PathBuf::from(&home)
                .join("Library")
                .join("Application Support")
                .join("com.typora-next.app")
                .join("agent"),
        )
    } else {
        let home = std::env::var("HOME").ok()?;
        Some(
            PathBuf::from(&home)
                .join(".local")
                .join("share")
                .join("typora-next")
                .join("agent"),
        )
    }
}

fn candidate_sdk_dirs(bridge_path: Option<&Path>) -> Vec<PathBuf> {
    let mut dirs = Vec::new();

    if let Some(parent) = bridge_path.and_then(|p| p.parent()) {
        dirs.push(parent.join("node_modules"));
    }

    if let Some(app_data) = agent_app_data_dir() {
        dirs.push(app_data.join("node_modules"));
    }

    if cfg!(windows) {
        if let Ok(appdata) = std::env::var("APPDATA") {
            dirs.push(PathBuf::from(appdata).join("npm").join("node_modules"));
        }
    } else {
        dirs.push(PathBuf::from("/usr/local/lib/node_modules"));
        if cfg!(target_os = "macos") {
            dirs.push(PathBuf::from("/opt/homebrew/lib/node_modules"));
        }
        if let Ok(home) = std::env::var("HOME") {
            dirs.push(
                PathBuf::from(home)
                    .join(".npm-global")
                    .join("lib")
                    .join("node_modules"),
            );
        }
    }

    dirs
}

// ============================================
// Tests
// ============================================
#[test]
fn includes_node_modules_next_to_bridge() {
    let bridge = Path::new("/app/agent-bridge.js");
    let dirs = candidate_sdk_dirs(Some(bridge));
    assert!(
        dirs.contains(&PathBuf::from("/app/node_modules")),
        "should include bridge-sibling node_modules, got {:?}",
        dirs
    );
}

#[test]
fn includes_app_data_auto_install_dir() {
    let dirs = candidate_sdk_dirs(None);
    let has_app_data = dirs.iter().any(|d| {
        let s = d.to_string_lossy();
        s.contains("TyporaNext") || s.contains("typora-next") || s.contains("com.typora-next.app")
    });
    assert!(has_app_data, "should include app data dir, got {:?}", dirs);
}

#[test]
fn includes_a_global_npm_prefix() {
    let dirs = candidate_sdk_dirs(None);
    let has_global = dirs.iter().any(|d| {
        let s = d.to_string_lossy();
        s.contains("npm\\node_modules") || s.contains("/lib/node_modules")
    });
    assert!(
        has_global,
        "should include a global npm prefix, got {:?}",
        dirs
    );
}

#[test]
fn probe_finds_sdk_in_real_temp_dir() {
    // 真实文件系统验证：构造 bridge 旁 node_modules 里的 SDK 目录
    let tmp = std::env::temp_dir().join("typora_probe_test");
    let sdk = tmp
        .join("node_modules")
        .join("@anthropic-ai")
        .join("claude-agent-sdk");
    std::fs::create_dir_all(&sdk).unwrap();

    let bridge = tmp.join("agent-bridge.js");
    let dirs = candidate_sdk_dirs(Some(&bridge));
    let found = dirs
        .iter()
        .any(|d| d.join("@anthropic-ai").join("claude-agent-sdk").exists());

    std::fs::remove_dir_all(&tmp).ok();
    assert!(found, "should find SDK next to bridge");
}
