/**
 * Markdown Utils — lightweight Markdown → HTML conversion for chat/render use.
 *
 * This is NOT a full CommonMark implementation. It handles the subset needed
 * for AI-generated chat content and dynamic UI snippets. Full-document rendering
 * goes through the Rust backend (pulldown-cmark).
 *
 * Math handling mirrors the main preview pipeline (Rust preprocess_math +
 * initMathRendering): $...$ / $$...$$ are extracted into placeholders BEFORE
 * the markdown transforms (so LaTeX survives *, &, _, and \n→<br>), then
 * restored as KaTeX HTML. Without katex (Node tests) or on render error,
 * the raw text is kept as-is.
 *
 * Usage:
 *   markdownToHtml('**bold** and `code`')
 *   // → '<strong>bold</strong> and <code>code</code>'
 */

(function () {
  'use strict';

  /**
   * Escape HTML special characters in a string.
   * @param {string} s
   * @returns {string}
   */
  function escapeHtml(s) {
    if (!s) return '';
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  /**
   * Resolve the global katex (script tag in browser; injectable in tests).
   * @returns {object|null}
   */
  function getKatex() {
    if (typeof katex !== 'undefined' && katex && katex.renderToString) return katex;
    if (typeof window !== 'undefined' && window.katex && window.katex.renderToString) return window.katex;
    return null;
  }

  /**
   * Render a math block via KaTeX; fall back to the raw text on any failure.
   * Same semantics as the main preview's initMathRendering (throwOnError: false).
   * @param {{tex: string, display: boolean}} m
   * @returns {string} HTML
   */
  function renderMathBlock(m) {
    const katex = getKatex();
    if (katex) {
      try {
        return katex.renderToString(m.tex, { displayMode: m.display, throwOnError: false });
      } catch (e) {
        // fall through to raw text
      }
    }
    return escapeHtml((m.display ? '$$' : '$') + m.tex + (m.display ? '$$' : '$'));
  }

  /**
   * Convert lightweight markdown to HTML.
   * Block-level elements are processed first, then inline formatting.
   *
   * @param {string} content — raw markdown text
   * @returns {string} safe HTML
   */
  function markdownToHtml(content) {
    if (!content) return '';

    // Step 0: pull fenced code blocks out of the raw text (their $ must not
    // become math), then extract math into placeholders so the markdown
    // transforms below cannot touch the LaTeX source.
    const codeBlocks = [];
    let text = String(content).replace(/```(\w*)\n?([\s\S]*?)```/g, function (_, lang, code) {
      codeBlocks.push(code);
      return '\n%%CHATCODE_' + (codeBlocks.length - 1) + '%%\n';
    });

    const mathBlocks = [];
    // Block math first ($$ takes priority, same as Rust extract_math_blocks)
    text = text.replace(/(?<!\\)\$\$([\s\S]+?)(?<!\\)\$\$/g, function (_, tex) {
      mathBlocks.push({ tex: tex.trim(), display: true });
      return '\n%%CHATMATH_' + (mathBlocks.length - 1) + '%%\n';
    });
    // Inline math: no newline inside, must not start/end with whitespace,
    // opening $ must not be escaped (aligns with KaTeX auto-render rules)
    text = text.replace(/(?<!\\)\$(?!\s)([^$\n]+?)(?<!\s)\$/g, function (_, tex) {
      mathBlocks.push({ tex: tex, display: false });
      return '%%CHATMATH_' + (mathBlocks.length - 1) + '%%';
    });

    // Step 1: escape HTML entities
    let html = escapeHtml(text);

    // Step 2: block-level elements

    // Fenced code blocks (```) — must be before other formatting
    // Match ```lang? \n content ```
    html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, function (_, lang, code) {
      return '<pre><code>' + escapeHtml(code.trim()) + '</code></pre>';
    });

    // Headings (#### → #)
    html = html.replace(/^#### (.+)$/gm, '<h4>$1</h4>');
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

    // Horizontal rule
    html = html.replace(/^---$/gm, '<hr>');

    // Blockquote
    html = html.replace(/^> (.+)$/gm, '<blockquote><p>$1</p></blockquote>');

    // Unordered list: lines starting with - or *
    html = html.replace(/^[-*] (.+)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');

    // Ordered list: lines starting with digit.
    html = html.replace(/^\d+\.\s(.+)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>\n?)+/g, function (match) {
      // Avoid double-wrapping if already inside <ul>
      if (/<ul[>]/.test(match)) return match;
      return '<ol>' + match + '</ol>';
    });

    // Tables: | H1 | H2 |\n |---| ---|\n | C1 | C2 |
    html = html.replace(
      /^\|(.+)\|\n\|[-:| ]+\|\n((?:\|.+\|\n?)*)/gm,
      function (_, headerRow, bodyRows) {
        var headers = headerRow.split('|').map(function (c) { return c.trim(); }).filter(Boolean);
        var thead = '<thead><tr>' + headers.map(function (h) { return '<th>' + h + '</th>'; }).join('') + '</tr></thead>';
        var tbody = '<tbody>';
        bodyRows.split('\n').forEach(function (line) {
          line = line.trim();
          if (!line || !line.startsWith('|')) return;
          var cells = line.split('|').map(function (c) { return c.trim(); }).filter(Boolean);
          if (!cells.length) return;
          tbody += '<tr>' + cells.map(function (c) { return '<td>' + c + '</td>'; }).join('') + '</tr>';
        });
        tbody += '</tbody>';
        return '<table>' + thead + tbody + '</table>';
      }
    );

    // Step 3: inline formatting

    // Bold
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

    // Italic
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

    // Strikethrough
    html = html.replace(/~~(.+?)~~/g, '<del>$1</del>');

    // Inline code (not inside a <pre> — safe because we process block first)
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Links
    html = html.replace(
      /\[([^\]]+)]\(([^)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener">$1</a>'
    );

    // Images
    html = html.replace(
      /!\[([^\]]*)]\(([^)]+)\)/g,
      '<img src="$2" alt="$1" style="max-width:100%">'
    );

    // Step 4: line breaks
    // Double newline = paragraph break
    html = html.replace(/\n\n/g, '<br><br>');
    // Single newline = line break
    html = html.replace(/\n/g, '<br>');

    // Step 5: restore code blocks (escaped) and math (KaTeX or raw fallback)
    // Display math is block-level — drop the line breaks hugging it first,
    // while the placeholder is still plain text.
    html = html.replace(/<br>%%CHATMATH_(\d+)%%<br>/g, function (_, i) {
      return mathBlocks[+i] && mathBlocks[+i].display ? '%%CHATMATH_' + i + '%%' : '<br>%%CHATMATH_' + i + '%%<br>';
    });
    html = html.replace(/%%CHATCODE_(\d+)%%/g, function (_, i) {
      return '<pre><code>' + escapeHtml(String(codeBlocks[+i] || '').trim()) + '</code></pre>';
    });
    html = html.replace(/%%CHATMATH_(\d+)%%/g, function (_, i) {
      return renderMathBlock(mathBlocks[+i]);
    });

    return html;
  }

  // ============================================
  // Exports
  // ============================================
  window.markdownToHtml = markdownToHtml;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { markdownToHtml };
  }
})();
