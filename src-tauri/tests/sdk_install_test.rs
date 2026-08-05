//! Integration tests for Pi SDK install progress helpers (`sdk_install.rs`).
//!
//! `extract_install_error` 把 npm install 的原始输出分类为用户可读的失败
//! 原因（网络 / 权限 / npm 缺失 / 通用尾部输出），供 `install_pi_sdk`
//! 命令在失败时返回给前端展示。
//!
//! The module is `#[path]`-included rather than imported via `app_lib`:
//! linking app_lib pulls in Tauri/WebView2 and the test exe fails to start
//! in some Windows environments.
//!
//! Run with: cargo test --test sdk_install_test

#[path = "../src/sdk_install.rs"]
mod sdk_install;

use sdk_install::{extract_install_error, is_network_failure, NPM_MIRROR_REGISTRY};

#[test]
fn network_error_is_classified() {
    let output = "npm ERR! code ENOTFOUND\nnpm ERR! errno ENOTFOUND\nnpm ERR! network request to https://registry.npmjs.org/@earendil-works%2fpi-coding-agent failed";
    let msg = extract_install_error(output, Some(1));
    assert!(
        msg.contains("网络连接失败"),
        "expected network classification, got: {}",
        msg
    );
}

#[test]
fn timeout_error_is_classified_as_network() {
    let output =
        "npm ERR! code ETIMEDOUT\nnpm ERR! network timeout at: https://registry.npmjs.org/";
    let msg = extract_install_error(output, Some(1));
    assert!(
        msg.contains("网络连接失败"),
        "expected network classification, got: {}",
        msg
    );
}

#[test]
fn permission_error_is_classified() {
    let output = "npm ERR! code EPERM\nnpm ERR! Error: EPERM: operation not permitted, rename 'C:\\Users\\x\\AppData\\...\\node_modules'";
    let msg = extract_install_error(output, Some(1));
    assert!(
        msg.contains("权限不足"),
        "expected permission classification, got: {}",
        msg
    );
}

#[test]
fn missing_npm_windows_message_is_classified() {
    // cmd on English Windows
    let output = "'npm' is not recognized as an internal or external command,\noperable program or batch file.";
    let msg = extract_install_error(output, Some(1));
    assert!(
        msg.contains("未检测到 npm"),
        "expected npm-missing classification, got: {}",
        msg
    );
}

#[test]
fn missing_npm_chinese_message_is_classified() {
    // cmd on Chinese Windows
    let output = "'npm' 不是内部或外部命令，也不是可运行的程序\n或批处理文件。";
    let msg = extract_install_error(output, Some(1));
    assert!(
        msg.contains("未检测到 npm"),
        "expected npm-missing classification, got: {}",
        msg
    );
}

#[test]
fn missing_npm_unix_message_is_classified() {
    let output = "/bin/sh: npm: command not found";
    let msg = extract_install_error(output, Some(127));
    assert!(
        msg.contains("未检测到 npm"),
        "expected npm-missing classification, got: {}",
        msg
    );
}

#[test]
fn empty_output_mentions_exit_code() {
    let msg = extract_install_error("", Some(42));
    assert!(
        msg.contains("42"),
        "expected exit code in message, got: {}",
        msg
    );
    assert!(
        msg.contains("无输出") || msg.contains("没有输出"),
        "expected no-output hint, got: {}",
        msg
    );
}

#[test]
fn generic_error_keeps_tail_lines() {
    let output = "line 1\nline 2\nline 3\nnpm ERR! weird custom failure";
    let msg = extract_install_error(output, Some(7));
    assert!(msg.contains("7"), "expected exit code, got: {}", msg);
    assert!(
        msg.contains("npm ERR! weird custom failure"),
        "expected tail line kept, got: {}",
        msg
    );
}

#[test]
fn generic_error_truncates_to_last_lines() {
    let mut lines: Vec<String> = (1..=20).map(|i| format!("noise line {}", i)).collect();
    lines.push("real error".to_string());
    let output = lines.join("\n");
    let msg = extract_install_error(&output, Some(1));
    assert!(
        msg.contains("real error"),
        "expected last line kept, got: {}",
        msg
    );
    assert!(
        !msg.contains("noise line 1\n"),
        "expected early lines truncated, got: {}",
        msg
    );
}

#[test]
fn blank_lines_are_ignored_in_tail() {
    let output = "error happened\n\n\n";
    let msg = extract_install_error(output, Some(1));
    assert!(
        msg.contains("error happened"),
        "expected non-blank line kept, got: {}",
        msg
    );
}

// ============================================
// 镜像兜底（sdk-install-mirror-fallback）：仅网络失败才重试
// ============================================

#[test]
fn network_failures_are_detected() {
    assert!(is_network_failure("npm ERR! code ENOTFOUND"));
    assert!(is_network_failure("npm ERR! code ETIMEDOUT"));
    assert!(is_network_failure(
        "npm ERR! network request failed, reason: connect ECONNRESET"
    ));
    assert!(is_network_failure("npm ERR! fetch failed"));
    assert!(is_network_failure("npm ERR! code EAI_AGAIN"));
    assert!(is_network_failure(
        "npm ERR! network timeout at: https://registry.npmjs.org/"
    ));
}

#[test]
fn non_network_failures_are_not_detected() {
    assert!(!is_network_failure("npm ERR! code EPERM"));
    assert!(!is_network_failure("npm ERR! code EACCES"));
    assert!(!is_network_failure(
        "npm ERR! 404 Not Found - GET https://registry.npmjs.org/x"
    ));
    assert!(!is_network_failure("npm ERR! weird custom failure"));
    assert!(!is_network_failure(""));
}

#[test]
fn mirror_registry_is_npmmirror() {
    assert_eq!(NPM_MIRROR_REGISTRY, "https://registry.npmmirror.com");
}
