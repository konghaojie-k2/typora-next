//! AgentEvent serialization contract tests
//! Verifies that Rust-emitted events match JS-expected { type, data } shape.
//!
//! Lesson from Sprint 3: ai_agent.rs emitted raw serde_json::Value instead of
//! using the AgentEvent enum, so there was no compile-time guarantee that
//! emitted events matched JS expectations.
//!
//! NOTE: AgentEvent is copied here (not imported from app_lib) to avoid
//! linking the full app_lib crate which causes DLL loading issues in this
//! Windows test environment. Keep this definition in sync with ai_agent.rs.

use serde::{Deserialize, Serialize};
use serde_json::json;

/// Copied from src/ai_agent.rs — KEEP IN SYNC
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "data")]
pub enum AgentEvent {
    #[serde(rename = "outline")]
    Outline { outline: serde_json::Value },
    #[serde(rename = "progress")]
    Progress {
        current: usize,
        total: usize,
        chapter_title: String,
        status: String,
    },
    #[serde(rename = "chapter_complete")]
    ChapterComplete {
        index: usize,
        file: String,
        title: String,
    },
    #[serde(rename = "chapter_failed")]
    ChapterFailed {
        index: usize,
        title: String,
        error: String,
    },
    #[serde(rename = "status")]
    Status { message: String },
    #[serde(rename = "complete")]
    Complete { total_generated: usize },
    #[serde(rename = "error")]
    Error { message: String },
    // Sprint 15 (course-completion slide summary): emitted by the Node bridge
    // (agent-bridge.mjs summary stage), not by Rust. Kept here as the contract
    // the frontend's CourseSummary listener depends on.
    #[serde(rename = "summary_complete")]
    SummaryComplete { file: String },
    #[serde(rename = "summary_failed")]
    SummaryFailed { message: String },
}

#[test]
fn test_agent_event_outline_shape() {
    let event = AgentEvent::Outline {
        outline: json!({"chapters": [{"title": "Test"}]}),
    };
    let value = serde_json::to_value(&event).unwrap();
    assert_eq!(value["type"], "outline");
    assert!(value["data"]["outline"].is_object());
}

#[test]
fn test_agent_event_progress_shape() {
    let event = AgentEvent::Progress {
        current: 1,
        total: 5,
        chapter_title: "Chapter 1".to_string(),
        status: "generating".to_string(),
    };
    let value = serde_json::to_value(&event).unwrap();
    assert_eq!(value["type"], "progress");
    assert_eq!(value["data"]["current"], 1);
    assert_eq!(value["data"]["total"], 5);
    assert_eq!(value["data"]["chapter_title"], "Chapter 1");
    assert_eq!(value["data"]["status"], "generating");
}

#[test]
fn test_agent_event_chapter_complete_shape() {
    let event = AgentEvent::ChapterComplete {
        index: 0,
        file: "00-test.md".to_string(),
        title: "Test".to_string(),
    };
    let value = serde_json::to_value(&event).unwrap();
    assert_eq!(value["type"], "chapter_complete");
    assert_eq!(value["data"]["index"], 0);
    assert_eq!(value["data"]["file"], "00-test.md");
    assert_eq!(value["data"]["title"], "Test");
}

#[test]
fn test_agent_event_chapter_failed_shape() {
    let event = AgentEvent::ChapterFailed {
        index: 1,
        title: "Failed Chapter".to_string(),
        error: "timeout".to_string(),
    };
    let value = serde_json::to_value(&event).unwrap();
    assert_eq!(value["type"], "chapter_failed");
    assert_eq!(value["data"]["index"], 1);
    assert_eq!(value["data"]["error"], "timeout");
}

#[test]
fn test_agent_event_status_shape() {
    let event = AgentEvent::Status {
        message: "Working...".to_string(),
    };
    let value = serde_json::to_value(&event).unwrap();
    assert_eq!(value["type"], "status");
    assert_eq!(value["data"]["message"], "Working...");
}

#[test]
fn test_agent_event_complete_shape() {
    let event = AgentEvent::Complete { total_generated: 3 };
    let value = serde_json::to_value(&event).unwrap();
    assert_eq!(value["type"], "complete");
    assert_eq!(value["data"]["total_generated"], 3);
}

#[test]
fn test_agent_event_error_shape() {
    let event = AgentEvent::Error {
        message: "Something went wrong".to_string(),
    };
    let value = serde_json::to_value(&event).unwrap();
    assert_eq!(value["type"], "error");
    assert_eq!(value["data"]["message"], "Something went wrong");
}

#[test]
fn test_agent_event_summary_complete_shape() {
    let event = AgentEvent::SummaryComplete {
        file: "99-课程总结.md".to_string(),
    };
    let value = serde_json::to_value(&event).unwrap();
    assert_eq!(value["type"], "summary_complete");
    assert_eq!(value["data"]["file"], "99-课程总结.md");
}

#[test]
fn test_agent_event_summary_failed_shape() {
    let event = AgentEvent::SummaryFailed {
        message: "Agent did not write expected file".to_string(),
    };
    let value = serde_json::to_value(&event).unwrap();
    assert_eq!(value["type"], "summary_failed");
    assert_eq!(value["data"]["message"], "Agent did not write expected file");
}

#[test]
fn test_all_variant_types_are_strings_and_data_is_object() {
    let events = vec![
        AgentEvent::Outline { outline: json!({}) },
        AgentEvent::Progress {
            current: 0,
            total: 0,
            chapter_title: "".into(),
            status: "".into(),
        },
        AgentEvent::ChapterComplete {
            index: 0,
            file: "".into(),
            title: "".into(),
        },
        AgentEvent::ChapterFailed {
            index: 0,
            title: "".into(),
            error: "".into(),
        },
        AgentEvent::Status { message: "".into() },
        AgentEvent::Complete { total_generated: 0 },
        AgentEvent::Error { message: "".into() },
        AgentEvent::SummaryComplete { file: "".into() },
        AgentEvent::SummaryFailed { message: "".into() },
    ];

    for event in events {
        let value = serde_json::to_value(&event).unwrap();
        assert!(
            value["type"].is_string(),
            "Event type must be a string, got: {:?} for {:?}",
            value["type"],
            event
        );
        assert!(
            value["data"].is_object(),
            "Event data must be an object, got: {:?} for {:?}",
            value["data"],
            event
        );
    }
}
