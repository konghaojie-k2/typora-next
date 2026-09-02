//! Cross-course learner memory (Sprint 21).
//!
//! On course completion a compact profile is written into the course's own
//! `.learning/completion-profile.json` (travels with the course directory),
//! and a rebuildable global index (`learning-index.json` in the app data
//! dir) records where completed courses live. At plan time the index is
//! aggregated into a compact text block injected into the plan prompt.
//!
//! Everything here is best-effort: memory is an enhancement, never a
//! dependency. Corrupt/missing files degrade to `None`, never to errors
//! surfaced to the user.
//!
//! Self-contained (no tauri deps) so tests can `#[path]`-include this file.

use serde_json::Value;
use std::collections::HashSet;
use std::path::{Path, PathBuf};

/// Max courses injected into the plan prompt (newest first)
const MAX_COURSES: usize = 5;
/// Max mastered concepts listed per course
const MAX_MASTERED_PER_COURSE: usize = 15;

/// Platform-appropriate path for the global learning index.
/// Mirrors `agent_sdk_probe::agent_app_data_dir` roots (parent of `agent/`).
pub fn learner_index_path() -> Option<PathBuf> {
    if cfg!(windows) {
        let appdata = std::env::var("APPDATA").ok()?;
        Some(
            PathBuf::from(&appdata)
                .join("TyporaNext")
                .join("learning-index.json"),
        )
    } else if cfg!(target_os = "macos") {
        let home = std::env::var("HOME").ok()?;
        Some(
            PathBuf::from(&home)
                .join("Library")
                .join("Application Support")
                .join("com.typora-next.app")
                .join("learning-index.json"),
        )
    } else {
        let home = std::env::var("HOME").ok()?;
        Some(
            PathBuf::from(&home)
                .join(".config")
                .join("typora-next")
                .join("learning-index.json"),
        )
    }
}

/// Build a completion profile from a course directory's `.learning/` data.
///
/// Sources: project.json (name/course_type), knowledge-graph.json
/// (node_status), quiz-history.json (struggling ratings). Returns None only
/// when project.json is unreadable — everything else degrades to empty.
pub fn build_completion_profile(course_path: &Path, completed_at: u64) -> Option<Value> {
    let learning = course_path.join(".learning");
    let project: Value =
        serde_json::from_str(&std::fs::read_to_string(learning.join("project.json")).ok()?).ok()?;

    let course_name = project
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or("Untitled")
        .to_string();

    // Concept mastery from the knowledge graph (mastered / struggling only)
    let mut concepts: Vec<Value> = Vec::new();
    if let Ok(content) = std::fs::read_to_string(learning.join("knowledge-graph.json")) {
        if let Ok(graph) = serde_json::from_str::<Value>(&content) {
            if let Some(nodes) = graph.get("nodes").and_then(|v| v.as_array()) {
                for node in nodes {
                    let status = node
                        .get("node_status")
                        .and_then(|v| v.as_str())
                        .unwrap_or("");
                    if status != "mastered" && status != "struggling" {
                        continue;
                    }
                    let name = node.get("name").and_then(|v| v.as_str()).unwrap_or("");
                    if name.is_empty() {
                        continue;
                    }
                    concepts.push(serde_json::json!({"name": name, "status": status}));
                }
            }
        }
    }

    // Weak points: count struggling-rated quiz entries per weak concept
    let mut weak_points: Vec<Value> = Vec::new();
    if let Ok(content) = std::fs::read_to_string(learning.join("quiz-history.json")) {
        if let Ok(history) = serde_json::from_str::<Value>(&content) {
            if let Some(entries) = history.get("entries").and_then(|v| v.as_array()) {
                let mut counts: Vec<(String, String, u32)> = Vec::new(); // (concept, chapter, count)
                for entry in entries {
                    if entry.get("rating").and_then(|v| v.as_str()) != Some("struggling") {
                        continue;
                    }
                    let chapter = entry
                        .get("chapter_file")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .trim_end_matches(".md")
                        .to_string();
                    if let Some(weak) = entry.get("weak_concepts").and_then(|v| v.as_array()) {
                        for c in weak.iter().filter_map(|v| v.as_str()) {
                            if let Some(existing) = counts.iter_mut().find(|(name, _, _)| name == c)
                            {
                                existing.1 = chapter.clone();
                                existing.2 += 1;
                            } else {
                                counts.push((c.to_string(), chapter.clone(), 1));
                            }
                        }
                    }
                }
                for (concept, chapter, count) in counts {
                    weak_points.push(serde_json::json!({
                        "concept": concept,
                        "chapter": chapter,
                        "detail": format!("quiz {} 次评级 struggling", count),
                    }));
                }
            }
        }
    }

    let mut profile = serde_json::json!({
        "version": 1,
        "course_name": course_name,
        "completed_at": completed_at,
        "concepts": concepts,
        "weak_points": weak_points,
    });
    if let Some(ct) = project.get("course_type").and_then(|v| v.as_str()) {
        profile["course_type"] = serde_json::json!(ct);
    }
    Some(profile)
}

/// Write `.learning/completion-profile.json` and upsert the global index.
pub fn record_course_completion(
    course_path: &Path,
    index_path: &Path,
    completed_at: u64,
) -> Result<(), String> {
    let profile = build_completion_profile(course_path, completed_at)
        .ok_or_else(|| "project.json 不可读，无法生成结课档案".to_string())?;

    let profile_path = course_path
        .join(".learning")
        .join("completion-profile.json");
    let profile_str =
        serde_json::to_string_pretty(&profile).map_err(|e| format!("序列化结课档案失败: {}", e))?;
    std::fs::write(&profile_path, profile_str).map_err(|e| format!("写入结课档案失败: {}", e))?;

    // Upsert index entry
    let mut index = read_index(index_path);
    let courses = index["courses"].as_array_mut().unwrap();
    let path_str = course_path.to_string_lossy().to_string();
    let name = profile["course_name"]
        .as_str()
        .unwrap_or("Untitled")
        .to_string();
    courses.retain(|c| c.get("course_path").and_then(|v| v.as_str()) != Some(&path_str));
    courses.push(serde_json::json!({
        "course_path": path_str,
        "course_name": name,
        "completed_at": completed_at,
    }));
    write_index(index_path, &index)
}

/// Aggregate the global index into a compact text block for the plan prompt.
///
/// Newest 5 courses, mastered ≤15 per course, cross-course dedup (newest
/// status wins). Lazily prunes stale entries and backfills missing profiles.
/// Returns None when nothing usable remains.
pub fn aggregate_learner_context(index_path: &Path) -> Option<String> {
    if !index_path.exists() {
        return None;
    }
    let mut index: Value = serde_json::from_str(&std::fs::read_to_string(index_path).ok()?).ok()?;
    let mut courses = index["courses"].as_array().cloned().unwrap_or_default();

    // Prune entries whose course directory is gone (lazy cleanup)
    let before = courses.len();
    courses.retain(|c| {
        c.get("course_path")
            .and_then(|v| v.as_str())
            .map(|p| Path::new(p).is_dir())
            .unwrap_or(false)
    });
    if courses.len() != before {
        index["courses"] = serde_json::json!(courses.clone());
        let _ = write_index(index_path, &index); // best-effort
    }

    // Newest first, truncate
    courses.sort_by_key(|c| {
        std::cmp::Reverse(c.get("completed_at").and_then(|v| v.as_u64()).unwrap_or(0))
    });
    courses.truncate(MAX_COURSES);

    let mut seen: HashSet<String> = HashSet::new();
    let mut blocks: Vec<String> = Vec::new();

    for entry in &courses {
        let Some(path) = entry.get("course_path").and_then(|v| v.as_str()) else {
            continue;
        };
        let course_path = Path::new(path);
        let name = entry
            .get("course_name")
            .and_then(|v| v.as_str())
            .unwrap_or("Untitled");

        // Read profile; backfill from source data when missing/corrupt
        let Some(profile) = read_profile(course_path).or_else(|| {
            let at = entry
                .get("completed_at")
                .and_then(|v| v.as_u64())
                .unwrap_or(0);
            let rebuilt = build_completion_profile(course_path, at)?;
            let p = course_path.join(".learning/completion-profile.json");
            if let Ok(s) = serde_json::to_string_pretty(&rebuilt) {
                let _ = std::fs::write(p, s); // best-effort
            }
            Some(rebuilt)
        }) else {
            continue;
        };

        let course_type = profile
            .get("course_type")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown");

        let mut mastered: Vec<String> = Vec::new();
        let mut weak: Vec<String> = Vec::new();
        if let Some(concepts) = profile.get("concepts").and_then(|v| v.as_array()) {
            for c in concepts {
                let cname = c.get("name").and_then(|v| v.as_str()).unwrap_or("");
                let status = c.get("status").and_then(|v| v.as_str()).unwrap_or("");
                if cname.is_empty() || !seen.insert(cname.to_string()) {
                    continue; // dedup: newest status wins
                }
                match status {
                    "mastered" if mastered.len() < MAX_MASTERED_PER_COURSE => {
                        mastered.push(cname.to_string())
                    }
                    "struggling" => {
                        let detail = profile
                            .get("weak_points")
                            .and_then(|v| v.as_array())
                            .and_then(|wps| {
                                wps.iter().find(|w| {
                                    w.get("concept").and_then(|v| v.as_str()) == Some(cname)
                                })
                            })
                            .and_then(|w| w.get("detail").and_then(|v| v.as_str()))
                            .map(|d| format!("（{}）", d))
                            .unwrap_or_default();
                        weak.push(format!("{}{}", cname, detail));
                    }
                    _ => {}
                }
            }
        }

        if mastered.is_empty() && weak.is_empty() {
            continue;
        }

        let mut block = format!("{}（{}，已完结）：\n", name, course_type);
        block.push_str(&format!(
            "  已掌握：{}\n",
            if mastered.is_empty() {
                "（无）".to_string()
            } else {
                mastered.join("、")
            }
        ));
        block.push_str(&format!(
            "  薄弱：{}",
            if weak.is_empty() {
                "（无）".to_string()
            } else {
                weak.join("、")
            }
        ));
        blocks.push(block);
    }

    if blocks.is_empty() {
        None
    } else {
        Some(blocks.join("\n\n"))
    }
}

/// Names of indexed courses whose directories still exist (for the
/// create-course dialog hint line). Same pruning rules as aggregation.
pub fn list_valid_course_names(index_path: &Path) -> Vec<String> {
    if !index_path.exists() {
        return Vec::new();
    }
    let index = read_index(index_path);
    let mut courses = index["courses"].as_array().cloned().unwrap_or_default();
    courses.retain(|c| {
        c.get("course_path")
            .and_then(|v| v.as_str())
            .map(|p| Path::new(p).is_dir())
            .unwrap_or(false)
    });
    courses.sort_by_key(|c| {
        std::cmp::Reverse(c.get("completed_at").and_then(|v| v.as_u64()).unwrap_or(0))
    });
    courses.truncate(MAX_COURSES);
    courses
        .iter()
        .filter_map(|c| {
            c.get("course_name")
                .and_then(|v| v.as_str())
                .map(String::from)
        })
        .collect()
}

fn read_profile(course_path: &Path) -> Option<Value> {
    let content = std::fs::read_to_string(
        course_path
            .join(".learning")
            .join("completion-profile.json"),
    )
    .ok()?;
    serde_json::from_str(&content).ok()
}

fn read_index(index_path: &Path) -> Value {
    std::fs::read_to_string(index_path)
        .ok()
        .and_then(|c| serde_json::from_str::<Value>(&c).ok())
        .filter(|v| v.get("courses").and_then(|c| c.as_array()).is_some())
        .unwrap_or_else(|| serde_json::json!({"version": 1, "courses": []}))
}

fn write_index(index_path: &Path, index: &Value) -> Result<(), String> {
    if let Some(parent) = index_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建索引目录失败: {}", e))?;
    }
    let s = serde_json::to_string_pretty(index).map_err(|e| format!("序列化索引失败: {}", e))?;
    std::fs::write(index_path, s).map_err(|e| format!("写入索引失败: {}", e))
}
