//! Knowledge Graph logic tests
//! Tests concept merging, edge building, deduplication, chapter extraction.
//!
//! Sprint 4: 知识图谱模块

use serde::{Deserialize, Serialize};
use std::collections::HashSet;

// ============================================
// Structs (mirror lib.rs)
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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct KnowledgeGraph {
    version: String,
    generated_at: String,
    nodes: Vec<KnowledgeNode>,
    edges: Vec<KnowledgeEdge>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ChapterConcepts {
    chapter: String,
    concepts: Vec<ChapterConcept>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ChapterConcept {
    id: String,
    name: String,
    #[serde(default)]
    depends_on: Vec<String>,
}

// ============================================
// Pure merge logic (extracted for testing)
// ============================================

struct GraphBuilder {
    nodes: Vec<KnowledgeNode>,
    edges: Vec<KnowledgeEdge>,
    seen_ids: HashSet<String>,
}

impl GraphBuilder {
    fn new() -> Self {
        Self {
            nodes: vec![],
            edges: vec![],
            seen_ids: HashSet::new(),
        }
    }

    fn add_chapter(&mut self, chapter_file: &str, concepts: ChapterConcepts) {
        // Extract chapter name from filename: "01.concepts.json" → "01"
        let chapter = chapter_file
            .replace(".concepts.json", "");

        for concept in concepts.concepts {
            if self.seen_ids.insert(concept.id.clone()) {
                self.nodes.push(KnowledgeNode {
                    id: concept.id.clone(),
                    name: concept.name,
                    chapter: chapter.clone(),
                });
            }
            for dep in concept.depends_on {
                self.edges.push(KnowledgeEdge {
                    from: dep,
                    to: concept.id.clone(),
                });
            }
        }
    }

    fn build(self, generated_at: String) -> KnowledgeGraph {
        KnowledgeGraph {
            version: "1.0".to_string(),
            generated_at,
            nodes: self.nodes,
            edges: self.edges,
        }
    }
}

// ============================================
// Helper
// ============================================

fn make_concepts(concepts: Vec<(&str, &str, Vec<&str>)>) -> ChapterConcepts {
    ChapterConcepts {
        chapter: String::new(),
        concepts: concepts
            .into_iter()
            .map(|(id, name, deps)| ChapterConcept {
                id: id.to_string(),
                name: name.to_string(),
                depends_on: deps.into_iter().map(String::from).collect(),
            })
            .collect(),
    }
}

// ============================================
// Test: Basic merge
// ============================================

#[test]
fn test_merge_single_chapter() {
    let mut builder = GraphBuilder::new();
    builder.add_chapter(
        "01.concepts.json",
        make_concepts(vec![
            ("attn", "注意力机制", vec![]),
            ("qkv", "QKV投影", vec!["attn"]),
        ]),
    );
    let graph = builder.build("2026-06-06 12:00:00".to_string());

    assert_eq!(graph.nodes.len(), 2);
    assert_eq!(graph.edges.len(), 1);
    assert_eq!(graph.version, "1.0");
}

#[test]
fn test_merge_multiple_chapters() {
    let mut builder = GraphBuilder::new();
    builder.add_chapter(
        "01.concepts.json",
        make_concepts(vec![("attn", "注意力机制", vec![])]),
    );
    builder.add_chapter(
        "02.concepts.json",
        make_concepts(vec![("pos-enc", "位置编码", vec!["attn"])]),
    );
    let graph = builder.build("2026-06-06 12:00:00".to_string());

    assert_eq!(graph.nodes.len(), 2);
    assert_eq!(graph.edges.len(), 1);
    assert_eq!(graph.edges[0].from, "attn");
    assert_eq!(graph.edges[0].to, "pos-enc");
}

// ============================================
// Test: Deduplication
// ============================================

#[test]
fn test_dedup_same_id_across_chapters() {
    let mut builder = GraphBuilder::new();
    builder.add_chapter(
        "01.concepts.json",
        make_concepts(vec![("attn", "注意力机制", vec![])]),
    );
    builder.add_chapter(
        "02.concepts.json",
        make_concepts(vec![("attn", "注意力机制v2", vec![])]),  // same id, different name
    );
    let graph = builder.build("2026-06-06 12:00:00".to_string());

    // Should keep first occurrence, skip duplicate
    assert_eq!(graph.nodes.len(), 1);
    assert_eq!(graph.nodes[0].name, "注意力机制");  // first one wins
}

#[test]
fn test_dedup_preserves_edges_from_both_chapters() {
    let mut builder = GraphBuilder::new();
    builder.add_chapter(
        "01.concepts.json",
        make_concepts(vec![("attn", "注意力机制", vec![])]),
    );
    builder.add_chapter(
        "02.concepts.json",
        make_concepts(vec![
            ("attn", "注意力机制", vec![]),  // duplicate
            ("pos-enc", "位置编码", vec!["attn"]),
        ]),
    );
    builder.add_chapter(
        "03.concepts.json",
        make_concepts(vec![("transformer", "Transformer", vec!["attn", "pos-enc"])]),
    );
    let graph = builder.build("2026-06-06 12:00:00".to_string());

    assert_eq!(graph.nodes.len(), 3);  // attn, pos-enc, transformer
    assert_eq!(graph.edges.len(), 3);  // attn→pos-enc, attn→transformer, pos-enc→transformer
}

// ============================================
// Test: Edge building
// ============================================

#[test]
fn test_no_edges_when_no_depends() {
    let mut builder = GraphBuilder::new();
    builder.add_chapter(
        "01.concepts.json",
        make_concepts(vec![
            ("a", "概念A", vec![]),
            ("b", "概念B", vec![]),
        ]),
    );
    let graph = builder.build("2026-06-06 12:00:00".to_string());

    assert_eq!(graph.edges.len(), 0);
}

#[test]
fn test_multiple_depends_on_creates_multiple_edges() {
    let mut builder = GraphBuilder::new();
    builder.add_chapter(
        "01.concepts.json",
        make_concepts(vec![
            ("a", "A", vec![]),
            ("b", "B", vec![]),
            ("c", "C", vec!["a", "b"]),
        ]),
    );
    let graph = builder.build("2026-06-06 12:00:00".to_string());

    assert_eq!(graph.edges.len(), 2);
    assert!(graph.edges.iter().any(|e| e.from == "a" && e.to == "c"));
    assert!(graph.edges.iter().any(|e| e.from == "b" && e.to == "c"));
}

#[test]
fn test_edge_direction_from_dep_to_concept() {
    let mut builder = GraphBuilder::new();
    builder.add_chapter(
        "02.concepts.json",
        make_concepts(vec![("pos-enc", "位置编码", vec!["attn"])]),
    );
    let graph = builder.build("2026-06-06 12:00:00".to_string());

    assert_eq!(graph.edges.len(), 1);
    assert_eq!(graph.edges[0].from, "attn");   // dependency (upstream)
    assert_eq!(graph.edges[0].to, "pos-enc");  // dependent (downstream)
}

// ============================================
// Test: Chapter extraction from filename
// ============================================

#[test]
fn test_chapter_extraction_basic() {
    let mut builder = GraphBuilder::new();
    builder.add_chapter(
        "01.concepts.json",
        make_concepts(vec![("x", "X", vec![])]),
    );
    let graph = builder.build("2026-06-06 12:00:00".to_string());

    assert_eq!(graph.nodes[0].chapter, "01");
}

#[test]
fn test_chapter_extraction_with_title() {
    let mut builder = GraphBuilder::new();
    builder.add_chapter(
        "03-attention.concepts.json",
        make_concepts(vec![("x", "X", vec![])]),
    );
    let graph = builder.build("2026-06-06 12:00:00".to_string());

    assert_eq!(graph.nodes[0].chapter, "03-attention");
}

// ============================================
// Test: Empty input
// ============================================

#[test]
fn test_empty_chapter_produces_empty_graph() {
    let mut builder = GraphBuilder::new();
    builder.add_chapter(
        "01.concepts.json",
        make_concepts(vec![]),
    );
    let graph = builder.build("2026-06-06 12:00:00".to_string());

    assert_eq!(graph.nodes.len(), 0);
    assert_eq!(graph.edges.len(), 0);
}

#[test]
fn test_no_chapters_produces_empty_graph() {
    let builder = GraphBuilder::new();
    let graph = builder.build("2026-06-06 12:00:00".to_string());

    assert_eq!(graph.nodes.len(), 0);
    assert_eq!(graph.edges.len(), 0);
}

// ============================================
// Test: Serialization round-trip
// ============================================

#[test]
fn test_json_round_trip() {
    let mut builder = GraphBuilder::new();
    builder.add_chapter(
        "01.concepts.json",
        make_concepts(vec![
            ("attn", "注意力机制", vec![]),
            ("qkv", "QKV投影", vec!["attn"]),
        ]),
    );
    let graph = builder.build("2026-06-06 12:00:00".to_string());

    let json = serde_json::to_string_pretty(&graph).unwrap();
    let parsed: KnowledgeGraph = serde_json::from_str(&json).unwrap();

    assert_eq!(parsed.nodes.len(), 2);
    assert_eq!(parsed.edges.len(), 1);
    assert_eq!(parsed.version, "1.0");
    assert_eq!(parsed.nodes[0].id, "attn");
}

// ============================================
// Test: depends_on defaults to empty vec
// ============================================

#[test]
fn test_depends_on_defaults_to_empty() {
    let json = r#"{"id": "x", "name": "X"}"#;
    let concept: ChapterConcept = serde_json::from_str(json).unwrap();
    assert_eq!(concept.depends_on.len(), 0);
}

// ============================================
// Test: Large graph
// ============================================

#[test]
fn test_large_graph_no_duplicates() {
    let mut builder = GraphBuilder::new();

    // Simulate 10 chapters, each with 5 concepts
    for ch in 0..10 {
        let concepts: Vec<(&str, String, Vec<&str>)> = (0..5)
            .map(|i| {
                let id = format!("ch{}-c{}", ch, i);
                let deps = if i > 0 {
                    vec![format!("ch{}-c{}", ch, i - 1).leak() as &str]
                } else {
                    vec![]
                };
                // Leak is needed for lifetime; acceptable in tests
                (id.leak() as &str, format!("Concept {}", i), deps)
            })
            .collect();

        let cc = ChapterConcepts {
            chapter: String::new(),
            concepts: concepts
                .into_iter()
                .map(|(id, name, deps)| ChapterConcept {
                    id: id.to_string(),
                    name,
                    depends_on: deps.into_iter().map(String::from).collect(),
                })
                .collect(),
        };
        builder.add_chapter(&format!("{:02}.concepts.json", ch), cc);
    }

    let graph = builder.build("2026-06-06 12:00:00".to_string());

    assert_eq!(graph.nodes.len(), 50);  // 10 * 5
    assert_eq!(graph.edges.len(), 40);  // 10 * 4 (each chapter has 4 deps)

    // Verify no duplicate IDs
    let mut ids: Vec<&str> = graph.nodes.iter().map(|n| n.id.as_str()).collect();
    ids.sort();
    ids.dedup();
    assert_eq!(ids.len(), 50);
}
