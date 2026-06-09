//! Integration tests for save_explanation / get_chapter_explanations (Sprint 6 PB3)
//! Run with: cargo test --test explanation_persistence_test
//!
//! NOTE: Uses real filesystem (temp dir) — mirrors the actual file I/O logic.

use std::path::PathBuf;

// ============================================
// Temp dir helper (no external crate)
// ============================================

use std::sync::atomic::{AtomicU64, Ordering};

static COUNTER: AtomicU64 = AtomicU64::new(0);

fn make_temp_project_dir() -> PathBuf {
    let base = std::env::temp_dir().join("typora-next-test");
    let n = COUNTER.fetch_add(1, Ordering::SeqCst);
    let sub = base.join(format!("test-{}-{}", std::process::id(), n));
    let _ = std::fs::remove_dir_all(&sub);
    std::fs::create_dir_all(&sub).expect("create temp dir");
    sub
}

// ============================================
// Mirrored data types (must stay in sync with lib.rs)
// ============================================

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq)]
struct ExplanationAnchor {
    paragraph_index: i32,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq)]
struct ExplanationQAEntry {
    q: String,
    a: String,
    ts: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq)]
struct ExplanationConversation {
    id: String,
    selected_text: String,
    anchor: Option<ExplanationAnchor>,
    qa_history: Vec<ExplanationQAEntry>,
    created_at: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq)]
struct ChapterExplanations {
    chapter: String,
    conversations: Vec<ExplanationConversation>,
}

// ============================================
// Mirrored helper functions
// ============================================

fn get_explanations_dir(project_path: &str) -> PathBuf {
    PathBuf::from(project_path).join(".learning").join("explanations")
}

fn get_explanation_file_path(project_path: &str, chapter: &str) -> PathBuf {
    get_explanations_dir(project_path).join(format!("{}.json", chapter))
}

fn save_explanation_sync(
    project_path: &str,
    chapter: &str,
    conversation: ExplanationConversation,
) -> Result<(), String> {
    let dir = get_explanations_dir(project_path);
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("创建目录失败: {}", e))?;

    let path = get_explanation_file_path(project_path, chapter);

    let mut data: ChapterExplanations = if path.exists() {
        let content = std::fs::read_to_string(&path)
            .map_err(|e| format!("读取失败: {}", e))?;
        serde_json::from_str(&content)
            .map_err(|e| format!("解析失败: {}", e))?
    } else {
        ChapterExplanations {
            chapter: chapter.to_string(),
            conversations: vec![],
        }
    };

    // Update or append
    if let Some(idx) = data.conversations.iter().position(|c| c.id == conversation.id) {
        data.conversations[idx] = conversation;
    } else {
        data.conversations.push(conversation);
    }

    // Cap at 20
    const MAX_CUES: usize = 20;
    if data.conversations.len() > MAX_CUES {
        data.conversations.sort_by(|a, b| a.created_at.cmp(&b.created_at));
        let excess = data.conversations.len() - MAX_CUES;
        data.conversations.drain(0..excess);
    }

    let json = serde_json::to_string_pretty(&data)
        .map_err(|e| format!("序列化失败: {}", e))?;
    let temp_path = path.with_extension("tmp");
    std::fs::write(&temp_path, json)
        .map_err(|e| format!("写临时文件失败: {}", e))?;
    std::fs::rename(&temp_path, &path)
        .map_err(|e| format!("重命名失败: {}", e))?;

    Ok(())
}

fn get_chapter_explanations_sync(
    project_path: &str,
    chapter: &str,
) -> Result<ChapterExplanations, String> {
    let path = get_explanation_file_path(project_path, chapter);
    if !path.exists() {
        return Ok(ChapterExplanations {
            chapter: chapter.to_string(),
            conversations: vec![],
        });
    }
    let content = std::fs::read_to_string(&path)
        .map_err(|e| format!("读取失败: {}", e))?;
    let data: ChapterExplanations = serde_json::from_str(&content)
        .map_err(|e| format!("解析失败: {}", e))?;
    Ok(data)
}

// ============================================
// TDD Tests
// ============================================

fn make_conversation(id: &str, selected: &str, created_at: &str) -> ExplanationConversation {
    ExplanationConversation {
        id: id.to_string(),
        selected_text: selected.to_string(),
        anchor: None,
        qa_history: vec![
            ExplanationQAEntry {
                q: selected.to_string(),
                a: format!("解释 for {}", selected),
                ts: created_at.to_string(),
            },
        ],
        created_at: created_at.to_string(),
    }
}

#[test]
fn test_save_and_read_single_conversation() {
    let tmp = make_temp_project_dir();
    let project = tmp.to_str().unwrap();

    let conv = make_conversation("c1", "位置编码", "2026-06-09T10:00:00");
    save_explanation_sync(project, "05-positional-encoding.md", conv.clone()).unwrap();

    let data = get_chapter_explanations_sync(project, "05-positional-encoding.md").unwrap();
    assert_eq!(data.chapter, "05-positional-encoding.md");
    assert_eq!(data.conversations.len(), 1);
    assert_eq!(data.conversations[0].id, "c1");
    assert_eq!(data.conversations[0].selected_text, "位置编码");
}

#[test]
fn test_read_nonexistent_returns_empty() {
    let tmp = make_temp_project_dir();
    let project = tmp.to_str().unwrap();

    let data = get_chapter_explanations_sync(project, "99-future.md").unwrap();
    assert_eq!(data.chapter, "99-future.md");
    assert!(data.conversations.is_empty());
}

#[test]
fn test_append_multiple_conversations() {
    let tmp = make_temp_project_dir();
    let project = tmp.to_str().unwrap();

    save_explanation_sync(project, "ch1.md", make_conversation("c1", "注意力", "2026-06-09T10:00:00")).unwrap();
    save_explanation_sync(project, "ch1.md", make_conversation("c2", "位置编码", "2026-06-09T10:01:00")).unwrap();

    let data = get_chapter_explanations_sync(project, "ch1.md").unwrap();
    assert_eq!(data.conversations.len(), 2);
}

#[test]
fn test_update_existing_conversation() {
    let tmp = make_temp_project_dir();
    let project = tmp.to_str().unwrap();

    let conv1 = make_conversation("c1", "注意力", "2026-06-09T10:00:00");
    save_explanation_sync(project, "ch1.md", conv1).unwrap();

    let mut conv2 = make_conversation("c1", "注意力机制", "2026-06-09T10:00:00");
    conv2.qa_history.push(ExplanationQAEntry {
        q: "和 RNN 区别？".to_string(),
        a: "RNN 串行，注意力并行".to_string(),
        ts: "2026-06-09T10:05:00".to_string(),
    });
    save_explanation_sync(project, "ch1.md", conv2.clone()).unwrap();

    let data = get_chapter_explanations_sync(project, "ch1.md").unwrap();
    assert_eq!(data.conversations.len(), 1);
    assert_eq!(data.conversations[0].selected_text, "注意力机制");
    assert_eq!(data.conversations[0].qa_history.len(), 2);
}

#[test]
fn test_cap_at_20_cues() {
    let tmp = make_temp_project_dir();
    let project = tmp.to_str().unwrap();

    // Save 25 conversations
    for i in 0..25 {
        let conv = make_conversation(
            &format!("c{}", i),
            &format!("概念{}", i),
            &format!("2026-06-09T10:{:02}:00", i),
        );
        save_explanation_sync(project, "ch1.md", conv).unwrap();
    }

    let data = get_chapter_explanations_sync(project, "ch1.md").unwrap();
    assert_eq!(data.conversations.len(), 20, "应截断到 20 条");
    // Oldest (c0-c4) should be dropped, newest (c5-c24) kept
    assert!(data.conversations.iter().all(|c| {
        if !c.id.starts_with('c') { return true; }
        let num: u32 = c.id[1..].parse().unwrap();
        num >= 5
    }));
}

#[test]
fn test_file_path_construction() {
    let path = get_explanation_file_path("/tmp/project", "05-positional-encoding.md");
    assert_eq!(
        path.to_str().unwrap().replace('\\', "/"),
        "/tmp/project/.learning/explanations/05-positional-encoding.md.json"
    );
}
