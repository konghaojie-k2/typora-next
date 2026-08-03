//! Integration tests for mermaid_fix_log (#[path] include — see
//! share_images_test.rs for why app_lib linking is avoided).

#[path = "../src/mermaid_fix_log.rs"]
mod mermaid_fix_log;

use mermaid_fix_log::{append_entry, format_entry, log_path};

#[test]
fn success_entry_has_ok_true_and_no_error() {
    let line = format_entry("2026-08-03 15:20:11", "anthropic", "claude-haiku", 1234, None);
    let v: serde_json::Value = serde_json::from_str(&line).unwrap();
    assert_eq!(v["ok"], true);
    assert_eq!(v["error"], serde_json::Value::Null);
    assert_eq!(v["provider"], "anthropic");
    assert_eq!(v["model"], "claude-haiku");
    assert_eq!(v["duration_ms"], 1234);
    assert_eq!(v["ts"], "2026-08-03 15:20:11");
}

#[test]
fn failure_entry_escapes_error_text() {
    // Error text with quotes + newline must survive JSON round-trip
    let err = "API 请求失败: \"timeout\"\nconnection reset";
    let line = format_entry("2026-08-03 15:25:00", "openai", "gpt-4o-mini", 120033, Some(err));
    let v: serde_json::Value = serde_json::from_str(&line).unwrap();
    assert_eq!(v["ok"], false);
    assert_eq!(v["error"], err);
    assert_eq!(v["duration_ms"], 120033);
}

#[test]
fn append_creates_file_and_appends_lines() {
    let dir = std::env::temp_dir().join(format!("mermaid-log-test-{}", std::process::id()));
    let line1 = format_entry("t1", "anthropic", "m1", 100, None);
    let line2 = format_entry("t2", "openai", "m2", 200, Some("boom"));

    append_entry(&dir, &line1).unwrap();
    append_entry(&dir, &line2).unwrap();

    let content = std::fs::read_to_string(log_path(&dir)).unwrap();
    let lines: Vec<&str> = content.lines().collect();
    assert_eq!(lines.len(), 2);
    assert!(lines[0].contains("\"t1\""));
    assert!(lines[1].contains("\"t2\""));

    std::fs::remove_dir_all(&dir).unwrap();
}
