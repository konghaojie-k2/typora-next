//! Markdown parser using pulldown-cmark with extensions

use pulldown_cmark::{Parser, Options, Event};

/// Parse markdown text into events
pub fn parse_markdown(text: &str) -> Vec<Event<'_>> {
    let mut options = Options::empty();
    options.insert(Options::ENABLE_TABLES);
    options.insert(Options::ENABLE_STRIKETHROUGH);
    options.insert(Options::ENABLE_TASKLISTS);
    options.insert(Options::ENABLE_SMART_PUNCTUATION);

    Parser::new_ext(text, options).collect()
}

/// Parse with math/diagram extensions (custom handling)
#[allow(dead_code)]
pub fn parse_with_extensions(text: &str) -> Vec<Event<'_>> {
    // TODO: Pre-process for $$ math blocks and mermaid diagrams
    parse_markdown(text)
}