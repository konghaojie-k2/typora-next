//! HTML renderer from markdown events

use pulldown_cmark::Event;
use pulldown_cmark::html::push_html;

/// Render markdown events to HTML string
pub fn render_html(events: &[Event<'_>]) -> String {
    let mut html = String::new();
    push_html(&mut html, events.iter().cloned());
    html
}

/// Render with KaTeX/Mermaid preprocessing
pub fn render_with_plugins(html: &str) -> String {
    // TODO: Post-process HTML for:
    // - Inline math ($...$) -> KaTeX spans
    // - Block math ($$...$$) -> KaTeX divs
    // - Mermaid code blocks -> Mermaid diagrams
    html.to_string()
}