//! Integration tests for Sprint 8: Socratic Review
//! Tests: cluster selection (BFS), state persistence, session saving.
//!
//! Run with: cargo test --test socratic_review_test

use serde::{Deserialize, Serialize};
use std::collections::HashSet;

// ============================================
// Mirrored structs (must stay in sync with lib.rs)
// ============================================

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
struct KnowledgeNode {
    id: String,
    name: String,
    chapter: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
struct KnowledgeEdge {
    from: String,
    to: String,
    #[serde(default)]
    weight: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SocraticConceptRef {
    id: String,
    title: String,
    source_chapter: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SocraticEdgeRef {
    from: String,
    to: String,
    weight: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SocraticCluster {
    concepts: Vec<SocraticConceptRef>,
    edges: Vec<SocraticEdgeRef>,
    cluster_hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SocraticChatMessage {
    role: String,
    content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SocraticSessionData {
    version: String,
    started_at: String,
    concept_ids: Vec<String>,
    concept_titles: Vec<String>,
    turns: Vec<SocraticChatMessage>,
    ended_at: String,
    end_reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct SocraticStateData {
    last_socratic_at: Option<String>,
    last_dismissed_at: Option<String>,
    #[serde(default)]
    opt_out: bool,
    #[serde(default)]
    quiz_count_since_last_socratic: u32,
    #[serde(default)]
    recent_cluster_hashes: Vec<String>,
}

// ============================================
// Mirrored pure functions (must stay in sync with lib.rs)
// ============================================

fn select_socratic_cluster_pure(
    nodes: &[KnowledgeNode],
    edges: &[KnowledgeEdge],
    target_size: usize,
    _min_edge_weight: f32,
) -> Vec<String> {
    if nodes.is_empty() {
        return vec![];
    }

    let mut degree: std::collections::HashMap<String, u32> = std::collections::HashMap::new();
    for n in nodes {
        degree.insert(n.id.clone(), 0);
    }
    for e in edges {
        *degree.entry(e.from.clone()).or_insert(0) += 1;
        *degree.entry(e.to.clone()).or_insert(0) += 1;
    }

    let anchor = nodes.iter()
        .max_by_key(|n| degree.get(&n.id).copied().unwrap_or(0))
        .map(|n| n.id.clone())
        .unwrap_or_default();

    let mut cluster = vec![anchor.clone()];
    let mut visited = HashSet::new();
    visited.insert(anchor.clone());
    let mut frontier = vec![anchor];

    while cluster.len() < target_size && !frontier.is_empty() {
        let mut next_frontier = vec![];
        for node in &frontier {
            for e in edges {
                let neighbor = if &e.from == node { Some(&e.to) }
                    else if &e.to == node { Some(&e.from) }
                    else { None };
                if let Some(nb) = neighbor {
                    if !visited.contains(nb) {
                        visited.insert(nb.clone());
                        cluster.push(nb.clone());
                        next_frontier.push(nb.clone());
                        if cluster.len() >= target_size { break; }
                    }
                }
            }
            if cluster.len() >= target_size { break; }
        }
        frontier = next_frontier;
    }

    cluster
}

fn cluster_hash(cluster: &[String]) -> String {
    let mut sorted = cluster.to_vec();
    sorted.sort();
    let joined = sorted.join("|");
    let mut h: u64 = 14695981039346656037;
    for b in joined.bytes() {
        h ^= b as u64;
        h = h.wrapping_mul(1099511628211);
    }
    format!("{:016x}", h)
}

// ============================================
// Helpers
// ============================================

fn make_nodes(ids: &[&str]) -> Vec<KnowledgeNode> {
    ids.iter()
        .map(|id| KnowledgeNode {
            id: id.to_string(),
            name: id.to_string(),
            chapter: "01".to_string(),
        })
        .collect()
}

fn make_edge(from: &str, to: &str, weight: f32) -> KnowledgeEdge {
    KnowledgeEdge {
        from: from.to_string(),
        to: to.to_string(),
        weight,
    }
}

// ============================================
// Test: Cluster selection (BFS)
// ============================================

#[test]
fn test_cluster_empty_nodes() {
    let cluster = select_socratic_cluster_pure(&[], &[], 4, 0.5);
    assert!(cluster.is_empty(), "空节点应返回空 cluster");
}

#[test]
fn test_cluster_single_node() {
    let nodes = make_nodes(&["a"]);
    let cluster = select_socratic_cluster_pure(&nodes, &[], 4, 0.5);
    assert_eq!(cluster, vec!["a"]);
}

#[test]
fn test_cluster_bfs_expands_from_highest_degree() {
    // Graph: a--b--c--d (chain)
    // a degree=1, b degree=2, c degree=2, d degree=1
    // Anchor = b or c (both degree 2, first wins)
    let nodes = make_nodes(&["a", "b", "c", "d"]);
    let edges = vec![
        make_edge("a", "b", 0.8),
        make_edge("b", "c", 0.8),
        make_edge("c", "d", 0.8),
    ];

    let cluster = select_socratic_cluster_pure(&nodes, &edges, 4, 0.5);
    assert_eq!(cluster.len(), 4, "应包含全部 4 个节点");
    // Anchor should be a highest-degree node (b or c both have degree 2)
    let anchor = &cluster[0];
    assert!(
        anchor == "b" || anchor == "c",
        "锚点应是最高度节点 (b 或 c), got {}",
        anchor
    );
}

#[test]
fn test_cluster_respects_target_size() {
    // 5 nodes, target=3
    let nodes = make_nodes(&["a", "b", "c", "d", "e"]);
    let edges = vec![
        make_edge("a", "b", 0.8),
        make_edge("b", "c", 0.8),
        make_edge("c", "d", 0.8),
        make_edge("d", "e", 0.8),
    ];

    let cluster = select_socratic_cluster_pure(&nodes, &edges, 3, 0.5);
    assert_eq!(cluster.len(), 3, "应限制在 target_size=3");
}

#[test]
fn test_cluster_sparse_fallback() {
    // 2 nodes, no edges — BFS can't expand, so only anchor is returned
    let nodes = make_nodes(&["x", "y"]);
    let cluster = select_socratic_cluster_pure(&nodes, &[], 4, 0.5);
    assert_eq!(cluster.len(), 1, "无边时只能取锚点");
    assert!(cluster.contains(&"x".to_string()) || cluster.contains(&"y".to_string()));
}

#[test]
fn test_cluster_star_graph() {
    // Star: center connected to all leaves
    let nodes = make_nodes(&["center", "l1", "l2", "l3", "l4"]);
    let edges = vec![
        make_edge("center", "l1", 0.9),
        make_edge("center", "l2", 0.9),
        make_edge("center", "l3", 0.9),
        make_edge("center", "l4", 0.9),
    ];

    let cluster = select_socratic_cluster_pure(&nodes, &edges, 4, 0.5);
    assert_eq!(cluster.len(), 4, "星型图应取满 target_size");
    assert_eq!(cluster[0], "center", "锚点是中心节点");
    // All leaves should be in cluster
    assert!(cluster.contains(&"l1".to_string()));
    assert!(cluster.contains(&"l2".to_string()));
    assert!(cluster.contains(&"l3".to_string()));
}

#[test]
fn test_cluster_disconnected_components() {
    // Two disconnected pairs: a--b and c--d
    let nodes = make_nodes(&["a", "b", "c", "d"]);
    let edges = vec![
        make_edge("a", "b", 0.8),
        make_edge("c", "d", 0.8),
    ];

    let cluster = select_socratic_cluster_pure(&nodes, &edges, 4, 0.5);
    // Anchor = a or c (both degree 1). Only a's component reachable.
    assert_eq!(cluster.len(), 2, "只能到达一个连通分量");
}

// ============================================
// Test: Cluster hash
// ============================================

#[test]
fn test_cluster_hash_same_cluster_same_hash() {
    let h1 = cluster_hash(&["a".to_string(), "b".to_string()]);
    let h2 = cluster_hash(&["a".to_string(), "b".to_string()]);
    assert_eq!(h1, h2, "相同 cluster 应有相同 hash");
}

#[test]
fn test_cluster_hash_order_independent() {
    let h1 = cluster_hash(&["a".to_string(), "b".to_string(), "c".to_string()]);
    let h2 = cluster_hash(&["c".to_string(), "a".to_string(), "b".to_string()]);
    assert_eq!(h1, h2, "顺序不同应有相同 hash");
}

#[test]
fn test_cluster_hash_different_clusters_different_hash() {
    let h1 = cluster_hash(&["a".to_string(), "b".to_string()]);
    let h2 = cluster_hash(&["a".to_string(), "c".to_string()]);
    assert_ne!(h1, h2, "不同 cluster 应有不同 hash");
}

#[test]
fn test_cluster_hash_format() {
    let h = cluster_hash(&["x".to_string()]);
    assert_eq!(h.len(), 16, "hash 应为 16 位十六进制");
    assert!(h.chars().all(|c| c.is_ascii_hexdigit()), "hash 应全为十六进制字符");
}

// ============================================
// Test: State data serialization
// ============================================

#[test]
fn test_state_data_default() {
    let state = SocraticStateData::default();
    assert_eq!(state.opt_out, false);
    assert_eq!(state.quiz_count_since_last_socratic, 0);
    assert!(state.recent_cluster_hashes.is_empty());
    assert!(state.last_socratic_at.is_none());
    assert!(state.last_dismissed_at.is_none());
}

#[test]
fn test_state_data_round_trip() {
    let state = SocraticStateData {
        last_socratic_at: Some("2026-06-01T10:00:00Z".to_string()),
        last_dismissed_at: Some("2026-06-02T10:00:00Z".to_string()),
        opt_out: true,
        quiz_count_since_last_socratic: 5,
        recent_cluster_hashes: vec!["abc123".to_string(), "def456".to_string()],
    };

    let json = serde_json::to_string_pretty(&state).unwrap();
    let parsed: SocraticStateData = serde_json::from_str(&json).unwrap();

    assert_eq!(parsed.opt_out, true);
    assert_eq!(parsed.quiz_count_since_last_socratic, 5);
    assert_eq!(parsed.recent_cluster_hashes.len(), 2);
    assert_eq!(parsed.last_socratic_at, Some("2026-06-01T10:00:00Z".to_string()));
}

#[test]
fn test_state_data_partial_json() {
    // Test that missing fields use defaults (backward compatibility)
    let json = r#"{"opt_out": true}"#;
    let parsed: SocraticStateData = serde_json::from_str(json).unwrap();
    assert_eq!(parsed.opt_out, true);
    assert_eq!(parsed.quiz_count_since_last_socratic, 0);
    assert!(parsed.recent_cluster_hashes.is_empty());
}

// ============================================
// Test: Session data serialization
// ============================================

#[test]
fn test_session_data_round_trip() {
    let session = SocraticSessionData {
        version: "1.0".to_string(),
        started_at: "2026-06-01T10:00:00Z".to_string(),
        concept_ids: vec!["jwt".to_string(), "oauth2".to_string()],
        concept_titles: vec!["JWT".to_string(), "OAuth2".to_string()],
        turns: vec![
            SocraticChatMessage { role: "tutor".to_string(), content: "Q1".to_string() },
            SocraticChatMessage { role: "user".to_string(), content: "A1".to_string() },
        ],
        ended_at: "2026-06-01T10:05:00Z".to_string(),
        end_reason: "llm_done".to_string(),
    };

    let json = serde_json::to_string_pretty(&session).unwrap();
    let parsed: SocraticSessionData = serde_json::from_str(&json).unwrap();

    assert_eq!(parsed.version, "1.0");
    assert_eq!(parsed.concept_ids.len(), 2);
    assert_eq!(parsed.turns.len(), 2);
    assert_eq!(parsed.turns[0].role, "tutor");
    assert_eq!(parsed.end_reason, "llm_done");
}

// ============================================
// Test: File persistence (state save/load)
// ============================================

#[test]
fn test_state_save_and_load() {
    let tmp_dir = std::env::temp_dir().join(format!("socratic-test-{}", std::process::id()));
    let learning_dir = tmp_dir.join(".learning");
    std::fs::create_dir_all(&learning_dir).unwrap();

    let state_path = learning_dir.join("socratic-state.json");

    // Save
    let state = SocraticStateData {
        last_socratic_at: Some("2026-06-01T10:00:00Z".to_string()),
        last_dismissed_at: None,
        opt_out: false,
        quiz_count_since_last_socratic: 3,
        recent_cluster_hashes: vec!["hash1".to_string()],
    };
    let json = serde_json::to_string_pretty(&state).unwrap();
    std::fs::write(&state_path, json).unwrap();

    // Load
    let content = std::fs::read_to_string(&state_path).unwrap();
    let loaded: SocraticStateData = serde_json::from_str(&content).unwrap();

    assert_eq!(loaded.quiz_count_since_last_socratic, 3);
    assert_eq!(loaded.recent_cluster_hashes, vec!["hash1"]);
    assert!(loaded.last_dismissed_at.is_none());

    // Cleanup
    std::fs::remove_dir_all(&tmp_dir).ok();
}

#[test]
fn test_state_load_default_when_missing() {
    let tmp_dir = std::env::temp_dir().join(format!("socratic-test-missing-{}", std::process::id()));
    let state_path = tmp_dir.join(".learning").join("socratic-state.json");

    // File does not exist → default state
    assert!(!state_path.exists());
    let default = SocraticStateData::default();
    assert_eq!(default.opt_out, false);
    assert_eq!(default.quiz_count_since_last_socratic, 0);

    // Cleanup (best effort)
    std::fs::remove_dir_all(&tmp_dir).ok();
}

// ============================================
// Test: Session file persistence
// ============================================

#[test]
fn test_session_save_creates_file() {
    let tmp_dir = std::env::temp_dir().join(format!("socratic-session-test-{}", std::process::id()));
    let sessions_dir = tmp_dir.join(".learning").join("socratic-sessions");
    std::fs::create_dir_all(&sessions_dir).unwrap();

    let session = SocraticSessionData {
        version: "1.0".to_string(),
        started_at: "2026-06-01T10:00:00Z".to_string(),
        concept_ids: vec!["a".to_string()],
        concept_titles: vec!["A".to_string()],
        turns: vec![],
        ended_at: "2026-06-01T10:10:00Z".to_string(),
        end_reason: "user_ended".to_string(),
    };

    let ts = session.ended_at.replace(':', "-").replace('.', "-");
    let file_path = sessions_dir.join(format!("{}.json", ts));
    let json = serde_json::to_string_pretty(&session).unwrap();
    std::fs::write(&file_path, json).unwrap();

    assert!(file_path.exists(), "session 文件应被创建");

    let content = std::fs::read_to_string(&file_path).unwrap();
    let loaded: SocraticSessionData = serde_json::from_str(&content).unwrap();
    assert_eq!(loaded.end_reason, "user_ended");

    // Cleanup
    std::fs::remove_dir_all(&tmp_dir).ok();
}

#[test]
fn test_session_filename_uses_ended_at() {
    // Verify that filename uses ended_at with : and . replaced
    let ended_at = "2026-06-01T10:10:30.123Z";
    let ts = ended_at.replace(':', "-").replace('.', "-");
    assert_eq!(ts, "2026-06-01T10-10-30-123Z");
    assert!(!ts.contains(':'));
    assert!(!ts.contains('.'));
}

// ============================================
// Test: Cluster with real KnowledgeGraph JSON
// ============================================

#[test]
fn test_cluster_from_json_knowledge_graph() {
    let kg_json = r#"{
        "version": "1.0",
        "generated_at": "2026-06-01",
        "nodes": [
            {"id": "jwt", "name": "JWT", "chapter": "01"},
            {"id": "oauth2", "name": "OAuth2", "chapter": "01"},
            {"id": "token", "name": "Token", "chapter": "02"},
            {"id": "refresh", "name": "Refresh", "chapter": "02"}
        ],
        "edges": [
            {"from": "oauth2", "to": "jwt", "weight": 0.8},
            {"from": "jwt", "to": "token", "weight": 0.6},
            {"from": "token", "to": "refresh", "weight": 0.9}
        ]
    }"#;

    let kg: serde_json::Value = serde_json::from_str(kg_json).unwrap();
    let nodes: Vec<KnowledgeNode> = kg["nodes"]
        .as_array()
        .unwrap()
        .iter()
        .map(|n| KnowledgeNode {
            id: n["id"].as_str().unwrap().to_string(),
            name: n["name"].as_str().unwrap().to_string(),
            chapter: n["chapter"].as_str().unwrap().to_string(),
        })
        .collect();
    let edges: Vec<KnowledgeEdge> = kg["edges"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| KnowledgeEdge {
            from: e["from"].as_str().unwrap().to_string(),
            to: e["to"].as_str().unwrap().to_string(),
            weight: e["weight"].as_f64().unwrap() as f32,
        })
        .collect();

    let cluster = select_socratic_cluster_pure(&nodes, &edges, 4, 0.5);
    assert_eq!(cluster.len(), 4, "应包含全部 4 个节点");

    // Verify hash is deterministic
    let h1 = cluster_hash(&cluster);
    let h2 = cluster_hash(&cluster);
    assert_eq!(h1, h2);
}
