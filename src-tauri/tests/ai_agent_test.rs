//! Integration tests for AI Agent module
//! Run with: cargo test --test ai_agent_test

use std::sync::{Arc, Mutex};

// ============================================
// AgentProcess (copied from ai_agent.rs for testing)
// ============================================

#[derive(Default, Clone)]
pub struct AgentProcess {
    pid: Arc<Mutex<Option<u32>>>,
}

impl AgentProcess {
    pub fn set_pid(&self, pid: u32) {
        let mut guard = self.pid.lock().unwrap();
        *guard = Some(pid);
    }

    pub fn clear(&self) {
        let mut guard = self.pid.lock().unwrap();
        *guard = None;
    }

    pub fn kill(&self) {
        let mut guard = self.pid.lock().unwrap();
        *guard = None;
    }

    pub fn is_running(&self) -> bool {
        self.pid.lock().unwrap().is_some()
    }
}

// ============================================
// Helper functions (mirroring agent-bridge logic)
// ============================================

fn extract_json(text: &str) -> serde_json::Value {
    // Try code block first
    let code_block = text
        .split("```json")
        .nth(1)
        .and_then(|s| s.split("```").next());
    if let Some(json_str) = code_block {
        return serde_json::from_str(json_str.trim()).expect("Invalid JSON in code block");
    }
    // Try to find JSON object in text using regex-like approach
    if let Some(start) = text.find('{') {
        // Find matching closing brace
        let mut depth = 0;
        let mut end = start;
        for (i, c) in text[start..].char_indices() {
            match c {
                '{' => depth += 1,
                '}' => {
                    depth -= 1;
                    if depth == 0 {
                        end = start + i + 1;
                        break;
                    }
                }
                _ => {}
            }
        }
        let json_str = &text[start..end];
        if let Ok(val) = serde_json::from_str(json_str) {
            return val;
        }
    }
    panic!("No JSON found")
}

fn generate_filename(index: usize, title: &str) -> String {
    let safe = title
        .replace(
            |c: char| !c.is_alphanumeric() && !('\u{4e00}'..='\u{9fff}').contains(&c),
            "-",
        )
        .replace("---", "-")
        .replace("--", "-")
        .trim_matches('-')
        .to_string();
    format!("{:02}-{}.md", index, safe)
}

// ============================================
// Tests
// ============================================

#[test]
fn test_agent_process_default() {
    let process = AgentProcess::default();
    assert!(!process.is_running());
}

#[test]
fn test_agent_process_set_and_kill() {
    let process = AgentProcess::default();
    process.set_pid(12345);
    assert!(process.is_running());
    process.kill();
    assert!(!process.is_running());
}

#[test]
fn test_agent_process_clear() {
    let process = AgentProcess::default();
    process.set_pid(99999);
    assert!(process.is_running());
    process.clear();
    assert!(!process.is_running());
}

#[test]
fn test_extract_json_from_code_block() {
    let text = r#"Some text
```json
{"key": "value"}
```
More text"#;
    let result = extract_json(text);
    assert_eq!(result["key"], "value");
}

#[test]
fn test_extract_json_raw() {
    let text = r#"Response: {"chapters": [{"title": "Test"}]}"#;
    let result = extract_json(text);
    assert_eq!(result["chapters"][0]["title"], "Test");
}

#[test]
#[should_panic(expected = "No JSON found")]
fn test_extract_json_no_json() {
    let text = "No JSON here";
    extract_json(text);
}

#[test]
#[should_panic(expected = "Invalid JSON in code block")]
fn test_extract_json_malformed() {
    let text = "```json\n{invalid}\n```";
    extract_json(text);
}

#[test]
fn test_generate_filename() {
    assert_eq!(generate_filename(0, "注意力机制"), "00-注意力机制.md");
    assert_eq!(
        generate_filename(5, "Self-Attention 详解！"),
        "05-Self-Attention-详解.md"
    );
    assert_eq!(generate_filename(1, ""), "01-.md");
}
