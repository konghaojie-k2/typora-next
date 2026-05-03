//! HTML renderer from markdown events

use pulldown_cmark::Event;
use pulldown_cmark::html::push_html;
use crate::core::syntax::{extract_math, MathBlock};

/// Placeholder prefix for math blocks (unlikely to appear in normal text)
const MATH_PLACEHOLDER_PREFIX: &str = "\x00MATH_BLOCK_";
const MATH_PLACEHOLDER_SUFFIX: &str = "\x00";

/// Base CSS styles with variables for typography and colors
const BASE_CSS: &str = r#"
:root {
  /* Typography */
  --font-main: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans SC', Roboto, sans-serif;
  --font-mono: 'JetBrains Mono', 'SF Mono', 'Fira Code', Consolas, 'Liberation Mono', Menlo, monospace;

  /* Font Sizes */
  --font-size-xs: 0.75rem;
  --font-size-sm: 0.875rem;
  --font-size-base: 1rem;
  --font-size-lg: 1.125rem;
  --font-size-xl: 1.25rem;
  --font-size-2xl: 1.5rem;

  /* Line Heights */
  --line-height-tight: 1.25;
  --line-height-normal: 1.6;
  --line-height-relaxed: 1.75;

  /* Spacing */
  --spacing-xs: 0.25rem;
  --spacing-sm: 0.5rem;
  --spacing-md: 1rem;
  --spacing-lg: 1.5rem;
  --spacing-xl: 2rem;
  --spacing-2xl: 3rem;

  /* Colors - Light Theme */
  --color-text-primary: #1a1a2e;
  --color-text-secondary: #4a4a68;
  --color-text-muted: #9ca3af;

  --color-bg-primary: #ffffff;
  --color-bg-secondary: #f8fafc;
  --color-bg-tertiary: #f1f5f9;

  --color-border: #e2e8f0;
  --color-accent: #3b82f6;

  /* Shadows */
  --shadow-sm: 0 1px 2px 0 rgb(0 0 0 / 0.05);
  --shadow-lg: 0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1);

  /* Border Radius */
  --radius-sm: 0.25rem;
  --radius-md: 0.5rem;
  --radius-lg: 0.75rem;

  /* Transitions */
  --transition-fast: 150ms ease;
}

@media (prefers-color-scheme: dark) {
  :root {
    --color-text-primary: #f1f5f9;
    --color-text-secondary: #cbd5e1;
    --color-text-muted: #64748b;
    --color-bg-primary: #0f172a;
    --color-bg-secondary: #1e293b;
    --color-bg-tertiary: #334155;
    --color-border: #334155;
    --color-accent: #60a5fa;
  }
}

/* Base styles */
body {
    font-family: var(--font-main);
    line-height: var(--line-height-normal);
    max-width: 860px;
    margin: 0 auto;
    padding: 40px 24px;
    color: var(--color-text-primary);
    background-color: var(--color-bg-primary);
}

/* Headings */
h1, h2, h3, h4, h5, h6 {
    margin-top: 24px;
    margin-bottom: 16px;
    font-weight: 600;
    line-height: var(--line-height-tight);
}
h1 { font-size: 2.25em; border-bottom: 2px solid var(--color-border); padding-bottom: 8px; }
h2 { font-size: 1.875em; border-bottom: 1px solid var(--color-border); padding-bottom: 4px; }
h3 { font-size: 1.5em; }
h4 { font-size: 1.25em; }
h5 { font-size: 1.125em; }
h6 { font-size: 1em; color: var(--color-text-secondary); }

/* Paragraphs and text */
p {
    margin-top: 0;
    margin-bottom: 16px;
}

/* Links */
a {
    color: var(--color-accent);
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
    margin-bottom: 4px;
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
    padding: 8px 16px;
    border: 1px solid var(--color-border);
}
table th {
    font-weight: 600;
    background-color: var(--color-bg-secondary);
}
table tr:nth-child(2n) {
    background-color: var(--color-bg-tertiary);
}

/* Inline Code */
code:not(pre code) {
  font-family: var(--font-mono);
  font-size: 0.9em;
  padding: 0.2em 0.4em;
  background-color: var(--color-bg-tertiary);
  border-radius: var(--radius-sm);
  color: #d946ef;
}

@media (prefers-color-scheme: dark) {
  code:not(pre code) {
    color: #f0abfc;
  }
}

/* Blockquotes */
blockquote {
    padding: 0 1em;
    color: var(--color-text-secondary);
    border-left: 0.25em solid var(--color-accent);
    margin: 0 0 16px 0;
    background-color: var(--color-bg-secondary);
}

/* Horizontal rule */
hr {
    height: 0.25em;
    padding: 0;
    margin: 24px 0;
    background-color: var(--color-border);
    border: 0;
}

/* Images */
img {
    max-width: 100%;
    box-sizing: content-box;
    background-color: #fff;
}
"#;

/// Code block CSS styles for Prism.js integration
const CODE_CSS: &str = r#"
/* Code Block Container */
pre {
  position: relative;
  margin: var(--spacing-lg) 0;
  padding: 0;
  border-radius: var(--radius-lg);
  background: #1e1e2e;
  box-shadow: var(--shadow-lg);
  overflow: hidden;
}

pre code {
  display: block;
  padding: var(--spacing-lg);
  overflow-x: auto;
  font-family: var(--font-mono);
  font-size: var(--font-size-sm);
  line-height: var(--line-height-relaxed);
  color: #cdd6f4;
  background: transparent;
}

/* Code Block Header */
pre[data-language]::before {
  content: attr(data-language);
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  padding: var(--spacing-xs) var(--spacing-md);
  font-family: var(--font-main);
  font-size: var(--font-size-xs);
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #6c7086;
  background: linear-gradient(to bottom, rgba(255,255,255,0.05), transparent);
  border-bottom: 1px solid rgba(255,255,255,0.05);
}

pre[data-language] code {
  padding-top: calc(var(--spacing-lg) + var(--spacing-md));
}

/* Line Numbers */
pre.line-numbers {
  position: relative;
}

pre.line-numbers code {
  padding-left: calc(var(--spacing-lg) + 2.5rem);
}

.line-numbers .line-numbers-rows {
  position: absolute;
  top: 0;
  left: 0;
  padding: var(--spacing-lg) 0;
  width: 2.5rem;
  background: rgba(0, 0, 0, 0.15);
  border-right: 1px solid rgba(255, 255, 255, 0.05);
  pointer-events: none;
  font-family: var(--font-mono);
  font-size: var(--font-size-sm);
  line-height: var(--line-height-relaxed);
}

pre[data-language] .line-numbers-rows {
  padding-top: calc(var(--spacing-lg) + var(--spacing-md) + var(--spacing-xs));
}

.line-numbers-rows > span::before {
  content: counter(line);
  counter-increment: line;
  display: block;
  text-align: right;
  padding-right: var(--spacing-sm);
  color: #6c7086;
}

pre.line-numbers code {
  counter-reset: line;
}

/* Code Block Actions (Copy Button) */
.code-block-actions {
  position: absolute;
  top: var(--spacing-sm);
  right: var(--spacing-sm);
  display: flex;
  gap: var(--spacing-xs);
  opacity: 0;
  transition: opacity var(--transition-fast);
}

pre:hover .code-block-actions {
  opacity: 1;
}

.code-block-btn {
  padding: var(--spacing-xs) var(--spacing-sm);
  font-size: var(--font-size-xs);
  font-weight: 500;
  color: #6c7086;
  background: rgba(255, 255, 255, 0.1);
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.code-block-btn:hover {
  background: rgba(255, 255, 255, 0.2);
  color: #cdd6f4;
}

.code-block-btn.copied {
  color: #a6e3a1;
}

/* Syntax Highlighting Enhancements */
.token.comment,
.token.prolog,
.token.doctype,
.token.cdata {
  color: #6c7086;
  font-style: italic;
}

.token.punctuation {
  color: #9399b2;
}

.token.property,
.token.tag,
.token.boolean,
.token.number,
.token.constant,
.token.symbol,
.token.deleted {
  color: #f38ba8;
}

.token.selector,
.token.attr-name,
.token.string,
.token.char,
.token.builtin,
.token.inserted {
  color: #a6e3a1;
}

.token.operator,
.token.entity,
.token.url,
.language-css .token.string,
.style .token.string {
  color: #89dceb;
}

.token.atrule,
.token.attr-value,
.token.keyword {
  color: #cba6f7;
}

.token.function,
.token.class-name {
  color: #89b4fa;
}

.token.regex,
.token.important,
.token.variable {
  color: #f9e2af;
}

.token.important,
.token.bold {
  font-weight: bold;
}

.token.italic {
  font-style: italic;
}

/* Terminal/Console Style */
pre.language-shell,
pre.language-bash,
pre.language-zsh,
pre.language-terminal {
  background: #0d0d0d;
}

pre.language-shell code,
pre.language-bash code,
pre.language-zsh code,
pre.language-terminal code {
  color: #50fa7b;
}

/* Copy Animation */
@keyframes copySuccess {
  0% { transform: scale(1); }
  50% { transform: scale(1.1); }
  100% { transform: scale(1); }
}

.code-block-btn.copied {
  animation: copySuccess 0.3s ease;
}

/* Responsive Code Blocks */
@media (max-width: 768px) {
  pre {
    margin-left: -24px;
    margin-right: -24px;
    border-radius: 0;
  }

  pre code {
    font-size: var(--font-size-xs);
  }
}

/* Print Styles */
@media print {
  pre {
    background: #f5f5f5 !important;
    box-shadow: none !important;
    border: 1px solid #ddd;
  }

  pre code {
    color: #333 !important;
  }

  .code-block-actions {
    display: none !important;
  }
}
"#;

/// Prism.js initialization script for code highlighting and copy functionality
const PRISM_INIT_JS: &str = r#"
(function() {
  'use strict';

  const CONFIG = {
    languageAliases: {
      'js': 'javascript',
      'ts': 'typescript',
      'py': 'python',
      'rb': 'ruby',
      'sh': 'bash',
      'shell': 'bash',
      'yml': 'yaml',
      'md': 'markdown',
      'docker': 'dockerfile',
      'k8s': 'yaml'
    },
    lineNumbersLanguages: ['javascript', 'typescript', 'python', 'rust', 'go', 'java'],
    showCopyButton: true,
    showLanguageLabel: true,
    codeBlockClass: 'code-block-enhanced'
  };

  function initPrism() {
    if (typeof Prism === 'undefined') {
      console.warn('Prism.js not loaded');
      return;
    }

    Object.entries(CONFIG.languageAliases).forEach(([alias, language]) => {
      if (Prism.languages[language]) {
        Prism.languages[alias] = Prism.languages[language];
      }
    });

    if (Prism.plugins && Prism.plugins.autoloader) {
      Prism.plugins.autoloader.languages_path =
        'https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/components/';
    }

    processCodeBlocks();
  }

  function processCodeBlocks() {
    const codeBlocks = document.querySelectorAll('pre code[class*="language-"]');

    codeBlocks.forEach(codeBlock => {
      const pre = codeBlock.parentElement;
      if (!pre || pre.classList.contains(CONFIG.codeBlockClass)) return;
      enhanceCodeBlock(pre, codeBlock);
    });
  }

  function enhanceCodeBlock(pre, codeBlock) {
    pre.classList.add(CONFIG.codeBlockClass);

    const language = getLanguageFromClass(codeBlock.className);

    if (CONFIG.showLanguageLabel && language) {
      pre.setAttribute('data-language', language);
    }

    if (CONFIG.lineNumbersLanguages.includes(language)) {
      pre.classList.add('line-numbers');
    }

    if (CONFIG.showCopyButton) {
      addCopyButton(pre, codeBlock);
    }

    if (typeof Prism !== 'undefined') {
      Prism.highlightElement(codeBlock);
    }
  }

  function getLanguageFromClass(className) {
    const match = className.match(/language-(\w+)/);
    return match ? match[1].toLowerCase() : null;
  }

  function addCopyButton(pre, codeBlock) {
    let actionsContainer = pre.querySelector('.code-block-actions');
    if (!actionsContainer) {
      actionsContainer = document.createElement('div');
      actionsContainer.className = 'code-block-actions';
      pre.appendChild(actionsContainer);
    }

    const copyButton = document.createElement('button');
    copyButton.className = 'code-block-btn';
    copyButton.textContent = 'Copy';
    copyButton.type = 'button';
    copyButton.setAttribute('aria-label', 'Copy code to clipboard');

    copyButton.addEventListener('click', async () => {
      try {
        await copyToClipboard(codeBlock.textContent);
        copyButton.textContent = 'Copied!';
        copyButton.classList.add('copied');

        setTimeout(() => {
          copyButton.textContent = 'Copy';
          copyButton.classList.remove('copied');
        }, 2000);
      } catch (err) {
        copyButton.textContent = 'Failed';
        console.error('Copy failed:', err);
        setTimeout(() => {
          copyButton.textContent = 'Copy';
        }, 2000);
      }
    });

    actionsContainer.appendChild(copyButton);
  }

  async function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPrism);
  } else {
    initPrism();
  }

  window.PrismInit = { processCodeBlocks, CONFIG };
})();
"#;

/// Prism.js CDN links for HTML document
const PRISM_CDN_CSS: &str = r#"
  <link href="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/themes/prism-tomorrow.min.css" rel="stylesheet">
  <link href="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/plugins/line-numbers/prism-line-numbers.min.css" rel="stylesheet">
"#;

const PRISM_CDN_JS: &str = r#"
  <script src="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/prism.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/plugins/autoloader/prism-autoloader.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/plugins/line-numbers/prism-line-numbers.min.js"></script>
"#;

/// Render markdown events to HTML string (body content only)
pub fn render_html(events: &[Event<'_>]) -> String {
    let mut html = String::new();
    push_html(&mut html, events.iter().cloned());
    html
}

/// Render markdown events to a complete HTML document with Prism.js code highlighting
pub fn render_html_document(events: &[Event<'_>]) -> String {
    let body_html = render_html(events);

    format!(
        r#"<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Markdown Document</title>
    {}
    <style>
{}
{}
    </style>
</head>
<body>
{}
{}
    <script>
{}
    </script>
</body>
</html>"#,
        PRISM_CDN_CSS,
        BASE_CSS,
        CODE_CSS,
        body_html,
        PRISM_CDN_JS,
        PRISM_INIT_JS
    )
}

/// Render with KaTeX/Mermaid preprocessing (legacy function, kept for API compatibility)
#[allow(dead_code)]
pub fn render_with_plugins(html: &str) -> String {
    html.to_string()
}

/// KaTeX CSS styles for math rendering
const KATEX_CSS: &str = r#"
/* Math Formula Styles - KaTeX Enhancement */

/* Inline Math */
.katex-inline,
.katex {
  font-size: 1.1em;
}

/* Display Math */
.katex-display {
  margin: var(--spacing-lg) 0;
  padding: var(--spacing-md) var(--spacing-lg);
  overflow-x: auto;
  overflow-y: hidden;
  background: var(--color-bg-secondary);
  border-radius: var(--radius-md);
  border-left: 3px solid var(--color-accent);
}

/* Center display math */
.katex-display > .katex {
  text-align: center;
}

/* Math Block Container */
.math-block {
  margin: var(--spacing-lg) 0;
  padding: var(--spacing-lg);
  background: linear-gradient(
    135deg,
    var(--color-bg-secondary) 0%,
    var(--color-bg-tertiary) 100%
  );
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-sm);
  overflow-x: auto;
}

.math-block .katex-display {
  margin: 0;
  padding: 0;
  background: transparent;
  border: none;
}

.math-inline {
  display: inline;
}

/* Math Error Styling */
.katex-error {
  color: #cb2431;
  background: rgba(203, 36, 49, 0.1);
  padding: 2px 4px;
  border-radius: 3px;
  font-family: var(--font-mono);
  font-size: var(--font-size-sm);
}

/* Responsive Math */
@media (max-width: 768px) {
  .katex-display {
    font-size: 0.9em;
    padding: var(--spacing-sm);
  }

  .math-block {
    padding: var(--spacing-md);
    margin-left: -24px;
    margin-right: -24px;
    border-radius: 0;
  }
}

/* Print Styles */
@media print {
  .katex-display,
  .math-block {
    background: transparent !important;
    box-shadow: none !important;
    border: 1px solid #ddd !important;
  }
}

/* Dark Theme Adjustments */
@media (prefers-color-scheme: dark) {
  .katex {
    color: var(--color-text-primary);
  }

  .katex-display {
    background: var(--color-bg-secondary);
    border-left-color: var(--color-accent);
  }

  .math-block {
    background: linear-gradient(
      135deg,
      var(--color-bg-secondary) 0%,
      rgba(30, 41, 59, 0.8) 100%
    );
  }
}
"#;

/// KaTeX CDN links for HTML document
const KATEX_CDN_CSS: &str = r#"
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">
"#;

const KATEX_CDN_JS: &str = r#"
  <script src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/contrib/auto-render.min.js"></script>
"#;

/// KaTeX initialization script
const KATEX_INIT_JS: &str = r#"
(function() {
  'use strict';

  // Render math when DOM is ready
  function renderMath() {
    if (typeof renderMathInElement === 'undefined') {
      console.warn('KaTeX auto-render not loaded');
      return;
    }

    // Render in body or main content area
    const contentAreas = document.querySelectorAll('body, .markdown-body, article, .content, main');
    contentAreas.forEach(area => {
      renderMathInElement(area, {
        delimiters: [
          { left: '$$', right: '$$', display: true },
          { left: '\\[', right: '\\]', display: true },
          { left: '$', right: '$', display: false },
          { left: '\\(', right: '\\)', display: false }
        ],
        katexOptions: {
          throwOnError: false,
          displayMode: false,
          output: 'html',
          strict: 'warn'
        }
      });
    });
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderMath);
  } else {
    renderMath();
  }
})();
"#;

/// Pre-process text to protect math blocks from markdown parsing
///
/// Returns (protected_text, math_blocks) where math_blocks is a vector
/// of (placeholder, original_content, is_block) tuples.
pub fn preprocess_math(text: &str) -> (String, Vec<(String, String, bool)>) {
    let math_blocks = extract_math(text);

    if math_blocks.is_empty() {
        return (text.to_string(), Vec::new());
    }

    // Build replacement map
    let mut replacements: Vec<(usize, usize, String, String, bool)> = Vec::new();

    for (idx, (start, end, block)) in math_blocks.into_iter().enumerate() {
        let (content, is_block) = match block {
            MathBlock::Inline(c) => (c, false),
            MathBlock::Block(c) => (c, true),
        };
        let placeholder = format!("{}{}{}", MATH_PLACEHOLDER_PREFIX, idx, MATH_PLACEHOLDER_SUFFIX);
        replacements.push((start, end, placeholder, content, is_block));
    }

    // Sort by position (descending) to replace from end to start
    replacements.sort_by(|a, b| b.0.cmp(&a.0));

    // Build new string with placeholders
    let mut result = text.to_string();
    let mut stored_blocks = Vec::new();

    for (start, end, placeholder, content, is_block) in replacements {
        let before = &result[..start];
        let after = &result[end..];
        stored_blocks.push((placeholder.clone(), content, is_block));
        result = format!("{}{}{}", before, placeholder, after);
    }

    (result, stored_blocks)
}

/// Post-process HTML to restore math blocks as KaTeX markup
pub fn postprocess_math(html: &str, math_blocks: &[(String, String, bool)]) -> String {
    let mut result = html.to_string();

    for (placeholder, content, is_block) in math_blocks {
        // HTML entity decode the placeholder (in case it got encoded)
        let encoded_placeholder = placeholder.replace('\x00', "&#0;");

        // Escape HTML in content
        let escaped_content = content
            .replace('&', "&amp;")
            .replace('<', "&lt;")
            .replace('>', "&gt;");

        if *is_block {
            // Block math: wrap in div with class
            let replacement = format!(
                r#"<div class="math-block">$${}$$</div>"#,
                escaped_content
            );
            result = result.replace(placeholder, &replacement);
            result = result.replace(&encoded_placeholder, &replacement);
        } else {
            // Inline math: wrap in span with class
            let replacement = format!(
                r#"<span class="math-inline">${}$</span>"#,
                escaped_content
            );
            result = result.replace(placeholder, &replacement);
            result = result.replace(&encoded_placeholder, &replacement);
        }
    }

    result
}

/// Render markdown text with math preprocessing
///
/// This function:
/// 1. Extracts math blocks and replaces with placeholders
/// 2. Parses the protected text as markdown
/// 3. Renders to HTML
/// 4. Restores math blocks with KaTeX markup
pub fn render_markdown_with_math(text: &str) -> String {
    use crate::core::parser::parse_markdown;

    // Step 1: Pre-process to protect math
    let (protected_text, math_blocks) = preprocess_math(text);

    // Step 2: Parse protected text
    let events = parse_markdown(&protected_text);

    // Step 3: Render to HTML
    let html = render_html(&events);

    // Step 4: Post-process to restore math
    let html = postprocess_math(&html, &math_blocks);

    // Step 5: Wrap in full document with KaTeX and Prism.js
    format!(
        r#"<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Markdown Document</title>
    {}
    {}
    <style>
{}
{}
{}
    </style>
</head>
<body>
{}
{}
{}
    <script>
{}
{}
    </script>
</body>
</html>"#,
        PRISM_CDN_CSS,
        KATEX_CDN_CSS,
        BASE_CSS,
        CODE_CSS,
        KATEX_CSS,
        html,
        PRISM_CDN_JS,
        KATEX_CDN_JS,
        PRISM_INIT_JS,
        KATEX_INIT_JS
    )
}