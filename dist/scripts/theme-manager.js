/**
 * Theme Manager - pure functions for theme logic
 *
 * Extracted from main.js to enable Node.js unit tests + BDD step defs.
 * Mirrors the IIFE + dual-export pattern of mermaid-source-replace.js.
 *
 * Bug fix (2026-06-10): system dark mode + toggle to light
 *   Before: applyTheme('light') did removeAttribute('data-theme')
 *     → CSS @media (prefers-color-scheme: dark) :root:not([data-theme]) matched
 *     → kept showing dark even after user toggled to light
 *   After: applyTheme('light') does setAttribute('data-theme', 'light')
 *     → :root:not([data-theme]) never matches (data-theme is always present)
 *     → prefers-color-scheme media query cannot override explicit user choice
 *     → :root light defaults apply
 *
 * Invariant: <html data-theme="..."> is always present with a non-empty value
 * ('light' or 'dark'). The attribute is never absent after initTheme runs.
 */
(function() {
  'use strict';

  // Node.js compatibility
  if (typeof window === 'undefined') {
    global.window = {};
  }

  /**
   * Pure: compute the theme a toggle should switch to, given the current state.
   * Mirrors the old toggleTheme body: 'dark' → 'light', anything else → 'dark'.
   *
   * @param {string|null} currentAttr - value of <html data-theme>, or null if absent
   * @returns {string} 'dark' | 'light'
   */
  function computeToggledTheme(currentAttr) {
    return currentAttr === 'dark' ? 'light' : 'dark';
  }

  /**
   * Pure: resolve the initial theme at app start.
   *   1. saved value wins (user previously picked light/dark)
   *   2. otherwise follow system preference
   *
   * @param {string|null} saved - 'dark' | 'light' | null/undefined
   * @param {boolean} systemPrefersDark - matchMedia('(prefers-color-scheme: dark)').matches
   * @returns {string} 'dark' | 'light'
   */
  function resolveInitialTheme(saved, systemPrefersDark) {
    if (saved === 'dark' || saved === 'light') return saved;
    return systemPrefersDark ? 'dark' : 'light';
  }

  /**
   * Pure: the DOM mutation that applyTheme should issue for a given theme.
   * The key invariant: data-theme is always set (never removed) so that
   * `:root:not([data-theme])` cannot match and the prefers-color-scheme
   * media query cannot override the explicit user choice.
   *
   * @param {string} theme - 'dark' | 'light'
   * @returns {{action: 'setAttribute', attr: 'data-theme', value: string}}
   * @throws if theme is not 'dark' or 'light'
   */
  function domCommandForTheme(theme) {
    if (theme !== 'dark' && theme !== 'light') {
      throw new Error('Invalid theme: ' + theme);
    }
    return { action: 'setAttribute', attr: 'data-theme', value: theme };
  }

  // Browser export
  if (typeof window !== 'undefined') {
    window.ThemeManager = {
      computeToggledTheme: computeToggledTheme,
      resolveInitialTheme: resolveInitialTheme,
      domCommandForTheme: domCommandForTheme
    };
  }

  // Node.js export (for unit + BDD tests)
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      computeToggledTheme: computeToggledTheme,
      resolveInitialTheme: resolveInitialTheme,
      domCommandForTheme: domCommandForTheme
    };
  }
})();
