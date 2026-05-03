//! Extended syntax handlers for math, diagrams, etc.

/// Math expression types
pub enum MathBlock {
    Inline(String),
    Block(String),
}

/// Diagram types supported
pub enum DiagramKind {
    Mermaid,
    // Future: Graphviz, PlantUML, etc.
}

/// Extract math blocks from text, returning positions and content
pub fn extract_math(text: &str) -> Vec<(usize, usize, MathBlock)> {
    // TODO: Parse $...$ and $$...$$ patterns
    Vec::new()
}

/// Extract diagram code blocks
pub fn extract_diagrams(text: &str) -> Vec<(usize, usize, DiagramKind, String)> {
    // TODO: Parse ```mermaid blocks
    Vec::new()
}