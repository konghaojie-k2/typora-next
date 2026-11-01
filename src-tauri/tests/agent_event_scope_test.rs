//! Integration tests for agent-event project scoping (Rust side).
//!
//! Bug (2026-10-29): forwarded agent events carried no project identity;
//! every live frontend bridge persisted chapter_complete to its own
//! project.json, so a background course's events polluted the foreground
//! course. tag_event_with_project stamps data.projectPath at the single
//! forwarding point in run_agent_bridge.
//!
//! Run with: cargo test --test agent_event_scope_test

#[path = "../src/agent_event_scope.rs"]
mod agent_event_scope;

use agent_event_scope::tag_event_with_project;
use serde_json::json;

#[test]
fn tags_event_data_with_project_path() {
    let mut event = json!({ "type": "chapter_complete", "data": { "index": 0, "file": "00-a.md" } });
    tag_event_with_project("C:/proj-a", &mut event);
    assert_eq!(event["data"]["projectPath"], "C:/proj-a");
    // 原有字段不受影响
    assert_eq!(event["data"]["index"], 0);
    assert_eq!(event["data"]["file"], "00-a.md");
}

#[test]
fn does_not_overwrite_existing_project_path() {
    // bridge 若已自带 projectPath（未来），以 bridge 的为准
    let mut event = json!({ "type": "chapter_complete", "data": { "index": 0, "projectPath": "C:/from-bridge" } });
    tag_event_with_project("C:/proj-a", &mut event);
    assert_eq!(event["data"]["projectPath"], "C:/from-bridge");
}

#[test]
fn creates_data_object_when_missing() {
    let mut event = json!({ "type": "status" });
    tag_event_with_project("C:/proj-a", &mut event);
    assert_eq!(event["data"]["projectPath"], "C:/proj-a");
}

#[test]
fn empty_project_path_is_noop() {
    let mut event = json!({ "type": "chapter_complete", "data": { "index": 0 } });
    tag_event_with_project("", &mut event);
    assert!(event["data"].get("projectPath").is_none());
}

#[test]
fn non_object_data_is_left_untouched() {
    let mut event = json!({ "type": "x", "data": "not-an-object" });
    tag_event_with_project("C:/proj-a", &mut event);
    assert_eq!(event["data"], "not-an-object");
}
