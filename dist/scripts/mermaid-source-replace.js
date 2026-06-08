/**
 * Mermaid Source Replace
 *
 * Pure functions for locating and replacing Mermaid code blocks in markdown
 * source text. Used by showMermaidFixUI to apply AI-generated fixes to the
 * source .md file (option A: user-confirmed persistence).
 *
 * Why a separate module:
 * - Pure function = trivially testable with Node.js (no DOM / Tauri required)
 * - Reused by main.js, unit tests, and BDD acceptance tests
 * - Mirrors the IIFE + dual-export pattern of dist/scripts/learning/*.js
 */

(function() {
  'use strict';

  // Node.js compatibility: provide window if not defined
  if (typeof window === 'undefined') {
    global.window = {};
  }

  /**
   * Normalize mermaid code for comparison: trim outer whitespace and
   * normalize CRLF to LF. Inner content/indentation is preserved.
   *
   * @param {string} code
   * @returns {string}
   */
  function normalizeForMatch(code) {
    if (!code) return '';
    return String(code)
      .replace(/\r\n/g, '\n')
      .replace(/^\s+|\s+$/g, '');
  }

  /**
   * Find and replace a Mermaid code block in markdown source.
   *
   * @param {string} source     - Full markdown source text
   * @param {string} brokenCode - Inner content of the broken Mermaid block
   *                              (the code that was sent to AI for fixing)
   * @param {string} fixedCode  - New inner content returned by AI
   * @returns {{
   *   ok: boolean,
   *   newSource?: string,
   *   replacements?: number,
   *   warning?: string,
   *   reason?: 'empty' | 'not_found'
   * }}
   */
  function replaceMermaidInSource(source, brokenCode, fixedCode) {
    if (!source || !brokenCode) {
      return { ok: false, reason: 'empty' };
    }

    const normalizedBroken = normalizeForMatch(brokenCode);
    if (!normalizedBroken) {
      return { ok: false, reason: 'empty' };
    }

    // Match ```mermaid fence blocks. Capture the leading newline (or BOF) and
    // the indent on the opening fence so we can preserve it on replacement.
    //   group 1: leading newline (or empty at BOF)
    //   group 2: indent on opening fence line
    //   group 3: "```mermaid\n" (or with CRLF)
    //   group 4: inner content (non-greedy, [\s\S] so newlines are allowed)
    //   group 5: closing "\n```" (or with CRLF and optional indent)
    const fenceRegex = /(^|\n)([ \t]*)(```mermaid[ \t]*\r?\n)([\s\S]*?)(\r?\n[ \t]*```)/g;

    const matches = [];
    let m;
    while ((m = fenceRegex.exec(source)) !== null) {
      const inner = m[4];
      if (normalizeForMatch(inner) === normalizedBroken) {
        matches.push({
          start: m.index,
          fullMatch: m[0],
          prefix: m[1],
          indent: m[2],
          fenceOpen: m[3],
          inner: m[4],
          fenceClose: m[5]
        });
      }
    }

    if (matches.length === 0) {
      return { ok: false, reason: 'not_found' };
    }

    const first = matches[0];

    // Sanitize fixedCode: normalize line endings and strip leading/trailing
    // newlines so we don't break the surrounding fence structure.
    const cleanFixed = String(fixedCode == null ? '' : fixedCode)
      .replace(/\r\n/g, '\n')
      .replace(/^\n+|\n+$/g, '');

    const replacement =
      first.prefix + first.indent + first.fenceOpen + cleanFixed + first.fenceClose;
    const newSource =
      source.slice(0, first.start) +
      replacement +
      source.slice(first.start + first.fullMatch.length);

    const result = {
      ok: true,
      newSource,
      replacements: 1
    };
    if (matches.length > 1) {
      result.warning =
        '已找到 ' + matches.length +
        ' 处相同的 Mermaid 块，仅替换了第一处';
    }
    return result;
  }

  // Browser export
  if (typeof window !== 'undefined') {
    window.MermaidSourceReplace = {
      replaceMermaidInSource: replaceMermaidInSource,
      normalizeForMatch: normalizeForMatch
    };
  }

  // Node.js export (for unit + BDD tests)
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      replaceMermaidInSource: replaceMermaidInSource,
      normalizeForMatch: normalizeForMatch
    };
  }
})();
