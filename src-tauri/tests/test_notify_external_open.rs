//! Tests for should_request_attention pure function
//!
//! Sprint 7: Taskbar attention for OS file-association open
//!
//! The decision logic is intentionally a pure function so the policy
//! (focused → no flash, unfocused → flash) can be tested without mocking
//! the Tauri Window API. Keep this file in sync with lib.rs.

/// Returns true if the OS should request user attention (taskbar flash /
/// dock bounce) for an externally opened file.
///
/// Conservative: if `is_focused` is false (or unknown), we request attention.
/// The cost of an unnecessary single flash is much lower than the cost of
/// the user not noticing a file was opened.
fn should_request_attention(is_focused: bool) -> bool {
    !is_focused
}

#[test]
fn focused_window_should_not_request_attention() {
    assert_eq!(should_request_attention(true), false);
}

#[test]
fn unfocused_window_should_request_attention() {
    assert_eq!(should_request_attention(false), true);
}

#[test]
fn defensive_default_when_focus_state_unknown_is_to_attempt() {
    // Mirrors unwrap_or(false) in the command: is_focused error → treat as
    // unfocused → request attention. This is the safe fallback.
    let is_focused: bool = false; // simulates unwrap_or(false) on error
    assert_eq!(should_request_attention(is_focused), true);
}

#[test]
fn policy_is_symmetric_and_pure() {
    // No side effects, no global state. Two calls with the same input
    // must produce the same output.
    assert_eq!(
        should_request_attention(true),
        should_request_attention(true)
    );
    assert_eq!(
        should_request_attention(false),
        should_request_attention(false)
    );
}
