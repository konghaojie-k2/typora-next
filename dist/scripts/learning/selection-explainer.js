/**
 * Selection Explainer
 * Text selection → AI explanation workflow
 *
 * Sprint 3 task 3.5
 */

(function() {
  'use strict';

  // Node.js compatibility
  if (typeof window === 'undefined') global.window = {};
  if (typeof document === 'undefined') {
    global.document = {
      createElement: (tag) => ({
        tagName: tag.toUpperCase(),
        children: [],
        _classes: [],
        _attrs: {},
        classList: {
          _set: [],
          add(c) { if (!this._set.includes(c)) this._set.push(c); },
          remove(c) { this._set = this._set.filter(x => x !== c); },
          contains(c) { return this._set.includes(c); },
          toggle(c) { this.contains(c) ? this.remove(c) : this.add(c); }
        },
        setAttribute(k, v) { this._attrs[k] = v; },
        getAttribute(k) { return this._attrs[k]; },
        appendChild(c) { this.children.push(c); return c; },
        querySelector() { return null; },
        querySelectorAll() { return []; },
        addEventListener(ev, fn) { (this._listeners[ev] = this._listeners[ev] || []).push(fn); },
        removeEventListener() {},
        get innerHTML() { return this._innerHTML; },
        set innerHTML(v) { this._innerHTML = v; this.children = []; },
        get textContent() { return this._textContent; },
        set textContent(v) { this._textContent = v; }
      })
    };
  }

  const MAX_SELECTION_LENGTH = 200;
  const EXPLANATION_MAX_LENGTH = 300;  // Sprint 3 decision

  // UI element classes that should be excluded from "in learning content" check
  const EXCLUDED_PARENT_CLASSES = [
    'toolbar', 'learning-toolbar', 'learning-progress-panel', 'modal',
    'quiz-panel', 'selection-toolbar', 'learning-mode-orb', 'badge',
    'nav', 'menu', 'sidebar', 'header', 'footer'
  ];

  // ============================================
  // SelectionExplainer
  // ============================================

  class SelectionExplainer {
    constructor() {
      this._currentSelection = '';
      this._toolbarVisible = false;
      this._explanation = '';
      this._isExplaining = false;
      this._callbacks = {
        onExplain: null,
        onError: null
      };
    }

    // ============================================
    // Selection detection
    // ============================================

    /**
     * Extract the selected text from a Selection object
     * @param {object} selection - window.getSelection() result
     * @returns {string} selected text (truncated)
     */
    extractSelectedText(selection) {
      if (!selection) return '';
      const text = (selection.toString && selection.toString()) || '';
      if (text.length > MAX_SELECTION_LENGTH) {
        return text.substring(0, MAX_SELECTION_LENGTH);
      }
      return text;
    }

    /**
     * Check if the selection is within learning content (not in UI)
     * @param {object} selection
     * @returns {boolean}
     */
    isInLearningContent(selection) {
      if (!selection || !selection.rangeCount) return false;
      try {
        const range = selection.getRangeAt(0);
        if (!range || !range.startContainer) return false;
        let parent = range.startContainer.parentNode;
        while (parent) {
          if (parent.classList && parent.classList.contains) {
            for (const cls of EXCLUDED_PARENT_CLASSES) {
              if (parent.classList.contains(cls)) return false;
            }
            if (parent.classList.contains('learning-content')) return true;
            if (parent.classList.contains('markdown-body')) return true;
          }
          parent = parent.parentNode;
        }
        // Default: not in learning content if no positive marker found
        return false;
      } catch (e) {
        return false;
      }
    }

    // ============================================
    // Toolbar visibility
    // ============================================

    showToolbar() {
      this._toolbarVisible = true;
    }

    hideToolbar() {
      this._toolbarVisible = false;
    }

    isToolbarVisible() {
      return this._toolbarVisible;
    }

    // ============================================
    // Explanation flow
    // ============================================

    setExplaining(value) {
      this._isExplaining = !!value;
    }

    isExplaining() {
      return this._isExplaining;
    }

    setExplanation(text) {
      this._explanation = text || '';
    }

    getExplanation() {
      return this._explanation;
    }

    getMaxExplanationLength() {
      return EXPLANATION_MAX_LENGTH;
    }

    isOverLengthLimit() {
      return this._explanation.length > EXPLANATION_MAX_LENGTH;
    }

    getTruncatedExplanation() {
      if (this.isOverLengthLimit()) {
        return this._explanation.substring(0, EXPLANATION_MAX_LENGTH) + '…';
      }
      return this._explanation;
    }

    /**
     * Get the explanation request payload (for sending to Rust/Agent)
     * @returns {{text: string, maxLength: number, promptTemplate: string}}
     */
    buildExplanationRequest() {
      return {
        text: this._currentSelection,
        maxLength: EXPLANATION_MAX_LENGTH,
        promptTemplate: '用生活化类比解释"{{text}}"，300 字以内，深入浅出。'
      };
    }

    // ============================================
    // Current state
    // ============================================

    getCurrentSelection() {
      return this._currentSelection;
    }

    setCurrentSelection(text) {
      this._currentSelection = text || '';
    }
  }

  // ============================================
  // Public API
  // ============================================

  window.SelectionExplainer = SelectionExplainer;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      SelectionExplainer,
      MAX_SELECTION_LENGTH,
      EXPLANATION_MAX_LENGTH
    };
  }
})();
