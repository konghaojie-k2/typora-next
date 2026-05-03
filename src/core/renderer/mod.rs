//! HTML renderer from markdown events

use pulldown_cmark::Event;
use pulldown_cmark::html::push_html;

/// Default CSS styles for rendered HTML
const DEFAULT_CSS: &str = r#"
/* Base styles */
body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
    line-height: 1.6;
    max-width: 800px;
    margin: 0 auto;
    padding: 20px;
    color: #333;
}

/* Headings */
h1, h2, h3, h4, h5, h6 {
    margin-top: 24px;
    margin-bottom: 16px;
    font-weight: 600;
    line-height: 1.25;
}
h1 { font-size: 2em; border-bottom: 1px solid #eaecef; padding-bottom: 0.3em; }
h2 { font-size: 1.5em; border-bottom: 1px solid #eaecef; padding-bottom: 0.3em; }
h3 { font-size: 1.25em; }
h4 { font-size: 1em; }
h5 { font-size: 0.875em; }
h6 { font-size: 0.85em; color: #6a737d; }

/* Paragraphs and text */
p {
    margin-top: 0;
    margin-bottom: 16px;
}

/* Links */
a {
    color: #0366d6;
    text-decoration: none;
}
a:hover {
    text-decoration: underline;
}

/* Lists */
ul, ol {
    padding-left: 2em;
    margin-top: 0;
    margin-bottom: 16px;
}
li {
    margin-bottom: 0.25em;
}
li + li {
    margin-top: 0.25em;
}

/* Task lists */
.task-list-item {
    list-style-type: none;
    margin-left: -1.5em;
}
.task-list-item input[type="checkbox"] {
    margin: 0 0.5em 0.25em -1.6em;
    vertical-align: middle;
}

/* Tables */
table {
    border-spacing: 0;
    border-collapse: collapse;
    margin-bottom: 16px;
    width: 100%;
}
table th,
table td {
    padding: 6px 13px;
    border: 1px solid #dfe2e5;
}
table th {
    font-weight: 600;
    background-color: #f6f8fa;
}
table tr {
    background-color: #ffffff;
}
table tr:nth-child(2n) {
    background-color: #f6f8fa;
}

/* Code */
code {
    padding: 0.2em 0.4em;
    margin: 0;
    font-size: 85%;
    background-color: rgba(27, 31, 35, 0.05);
    border-radius: 3px;
    font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
}
pre {
    padding: 16px;
    overflow: auto;
    font-size: 85%;
    line-height: 1.45;
    background-color: #f6f8fa;
    border-radius: 6px;
    margin-bottom: 16px;
}
pre code {
    background-color: transparent;
    padding: 0;
    font-size: 100%;
}

/* Blockquotes */
blockquote {
    padding: 0 1em;
    color: #6a737d;
    border-left: 0.25em solid #dfe2e5;
    margin: 0 0 16px 0;
}

/* Horizontal rule */
hr {
    height: 0.25em;
    padding: 0;
    margin: 24px 0;
    background-color: #e1e4e8;
    border: 0;
}

/* Images */
img {
    max-width: 100%;
    box-sizing: content-box;
    background-color: #fff;
}

/* Strikethrough */
del {
    text-decoration: line-through;
}
"#;

/// Render markdown events to HTML string (body content only)
pub fn render_html(events: &[Event<'_>]) -> String {
    let mut html = String::new();
    push_html(&mut html, events.iter().cloned());
    html
}

/// Render markdown events to a complete HTML document with embedded CSS
pub fn render_html_document(events: &[Event<'_>]) -> String {
    let body_html = render_html(events);

    format!(
        r#"<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Markdown Document</title>
    <style>
{}
    </style>
</head>
<body>
{}
</body>
</html>"#,
        DEFAULT_CSS,
        body_html
    )
}

/// Render with KaTeX/Mermaid preprocessing
pub fn render_with_plugins(html: &str) -> String {
    // TODO: Post-process HTML for:
    // - Inline math ($...$) -> KaTeX spans
    // - Block math ($$...$$) -> KaTeX divs
    // - Mermaid code blocks -> Mermaid diagrams
    html.to_string()
}