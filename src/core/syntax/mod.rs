//! Extended syntax handlers for math, diagrams, etc.

/// Math expression types
#[derive(Debug, Clone, PartialEq)]
pub enum MathBlock {
    Inline(String),
    Block(String),
}

/// Diagram types supported
#[allow(dead_code)]
pub enum DiagramKind {
    Mermaid,
    // Future: Graphviz, PlantUML, etc.
}

/// Extract math blocks from text, returning positions and content
///
/// Handles both inline ($...$) and block ($$...$$) math expressions.
/// Block math takes priority (detected first) to avoid partial matches.
pub fn extract_math(text: &str) -> Vec<(usize, usize, MathBlock)> {
    let mut results = Vec::new();
    let chars: Vec<char> = text.chars().collect();
    let len = chars.len();
    let mut i = 0;

    while i < len {
        // Check for $$ (block math) first
        if i + 1 < len && chars[i] == '$' && chars[i + 1] == '$' {
            // Find closing $$
            let start = i;
            i += 2; // Skip opening $$

            // Skip leading whitespace/newline after $$
            while i < len && (chars[i] == ' ' || chars[i] == '\n') {
                i += 1;
            }

            let content_start = i;

            // Find closing $$
            while i + 1 < len {
                if chars[i] == '$' && chars[i + 1] == '$' {
                    // Check if it's not escaped
                    let mut backslash_count = 0;
                    let mut j = i - 1;
                    while j > content_start && chars[j] == '\\' {
                        backslash_count += 1;
                        j -= 1;
                    }
                    if backslash_count % 2 == 0 {
                        // Found closing $$
                        let content = text[content_start..i].to_string();
                        let content = content.trim_end().to_string();
                        results.push((start, i + 2, MathBlock::Block(content)));
                        i += 2;
                        break;
                    }
                }
                i += 1;
            }

            if i >= len {
                // No closing $$ found, skip
                i = start + 2;
            }
        }
        // Check for single $ (inline math)
        else if chars[i] == '$' {
            let start = i;
            i += 1; // Skip opening $

            // Check if $ is followed by space (not inline math)
            if i < len && (chars[i] == ' ' || chars[i] == '\n') {
                i = start + 1;
                continue;
            }

            let content_start = i;

            // Find closing $
            while i < len {
                if chars[i] == '$' {
                    // Check if it's not escaped
                    let mut backslash_count = 0;
                    let mut j = i - 1;
                    while j > content_start && chars[j] == '\\' {
                        backslash_count += 1;
                        j -= 1;
                    }
                    if backslash_count % 2 == 0 {
                        // Check content is not empty and doesn't contain newlines
                        let content = &text[content_start..i];
                        if !content.is_empty() && !content.contains('\n') {
                            results.push((start, i + 1, MathBlock::Inline(content.to_string())));
                            i += 1;
                            break;
                        }
                    }
                }
                i += 1;
            }

            if i >= len {
                // No closing $ found, skip
                i = start + 1;
            }
        } else {
            i += 1;
        }
    }

    results
}

/// Extract diagram code blocks
#[allow(dead_code)]
pub fn extract_diagrams(_text: &str) -> Vec<(usize, usize, DiagramKind, String)> {
    // TODO: Parse ```mermaid blocks
    Vec::new()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_inline_math() {
        let text = "The equation $E = mc^2$ is famous.";
        let result = extract_math(text);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].0, 13); // start position (after "The equation ")
        assert_eq!(result[0].1, 23); // end position (after closing $)
        if let MathBlock::Inline(content) = &result[0].2 {
            assert_eq!(content, "E = mc^2");
        } else {
            panic!("Expected Inline math");
        }
    }

    #[test]
    fn test_block_math() {
        let text = r"Here is a formula:
$$
x^2 + y^2 = z^2
$$
End.";
        let result = extract_math(text);
        assert_eq!(result.len(), 1);
        if let MathBlock::Block(content) = &result[0].2 {
            assert_eq!(content, "x^2 + y^2 = z^2");
        } else {
            panic!("Expected Block math");
        }
    }

    #[test]
    fn test_multiple_inline() {
        let text = "$a$ and $b$ make $a + b$";
        let result = extract_math(text);
        assert_eq!(result.len(), 3);
    }

    #[test]
    fn test_mixed_math() {
        let text = r"Inline $x^2$ and block:
$$
y = mx + b
$$";
        let result = extract_math(text);
        assert_eq!(result.len(), 2);
        assert!(matches!(result[0].2, MathBlock::Inline(_)));
        assert!(matches!(result[1].2, MathBlock::Block(_)));
    }
}