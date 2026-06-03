/**
 * Quiz Panel
 * Chapter-end mastery check + adaptive feedback
 *
 * Sprint 3 task 3.2 + 3.4
 *
 * State machine:
 *   hidden → loading → ready → answering → submitting → graded
 *              ↑                                       ↓
 *              └────────── reset ─────────────────────┘
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

  const VALID_STATES = ['hidden', 'loading', 'ready', 'answering', 'submitting', 'graded'];
  const VALID_RATINGS = ['mastered', 'learning', 'struggling'];

  // Valid state transitions
  const TRANSITIONS = {
    hidden: ['loading', 'ready'],
    loading: ['ready', 'hidden'],
    ready: ['answering', 'hidden'],
    answering: ['submitting', 'ready'],
    submitting: ['graded', 'answering'],
    graded: ['hidden', 'loading', 'ready']
  };

  // ============================================
  // QuizPanel
  // ============================================

  class QuizPanel {
    constructor(options) {
      options = options || {};
      this._chapterFile = options.chapterFile || '';
      this._state = 'hidden';
      this._questions = [];
      this._answers = {};
      this._result = null;
      this._scrollProgress = 0;
      this._triggers = 0.8;  // Show when 80% scrolled

      // Callbacks
      this.onAdaptRequested = null;
      this.onSaveHistory = null;
      this.onError = null;
    }

    // ============================================
    // State management
    // ============================================

    getState() {
      return this._state;
    }

    _setState(newState) {
      if (!VALID_STATES.includes(newState)) {
        throw new Error(`Invalid state: ${newState}`);
      }
      const current = this._state;
      const allowed = TRANSITIONS[current] || [];
      if (!allowed.includes(newState)) {
        throw new Error(`Invalid transition: ${current} → ${newState}`);
      }
      this._state = newState;
    }

    reset() {
      this._state = 'hidden';
      this._questions = [];
      this._answers = {};
      this._result = null;
      this._scrollProgress = 0;
    }

    // ============================================
    // Scroll detection
    // ============================================

    notifyScrollProgress(progress) {
      this._scrollProgress = progress;
      if (this._state === 'hidden' && progress >= this._triggers) {
        this._setState('loading');
      }
    }

    // ============================================
    // Question management
    // ============================================

    getQuestions() {
      return this._questions;
    }

    setQuestions(questions) {
      if (!Array.isArray(questions)) {
        throw new Error('Questions must be an array');
      }
      this._questions = questions;
      // If we have questions, advance to ready (works from hidden or loading)
      if (questions.length > 0 && (this._state === 'hidden' || this._state === 'loading')) {
        this._setState('ready');
      }
    }

    // ============================================
    // Answer management
    // ============================================

    getAnswer(questionId) {
      return this._answers[questionId];
    }

    setAnswer(questionId, answer) {
      this._answers[questionId] = answer;
    }

    getAllAnswers() {
      return { ...this._answers };
    }

    // ============================================
    // Answering flow
    // ============================================

    startAnswering() {
      if (this._state !== 'ready' && this._state !== 'graded') {
        throw new Error(`Cannot start answering from state: ${this._state}`);
      }
      // Reset answers when re-entering answering from graded
      if (this._state === 'graded') {
        this._answers = {};
      }
      this._setState('answering');
    }

    submit() {
      if (this._state !== 'answering') {
        throw new Error(`Cannot submit from state: ${this._state}`);
      }
      this._setState('submitting');
    }

    // ============================================
    // Result management
    // ============================================

    getResult() {
      return this._result;
    }

    setResult(result) {
      // Allow setResult from submitting OR graded (for re-grading on retry)
      if (this._state !== 'submitting' && this._state !== 'graded' && this._state !== 'answering') {
        throw new Error(`Cannot set result from state: ${this._state}`);
      }
      if (!result || !VALID_RATINGS.includes(result.rating)) {
        throw new Error(`Invalid rating: ${result && result.rating}`);
      }
      this._result = {
        rating: result.rating,
        score: result.score || 0,
        weak_concepts: result.weak_concepts || [],
        suggestions: result.suggestions || []
      };
      this._setState('graded');

      // Trigger adaptive feedback (Sprint 3 task 3.4)
      // mastered → skip adapt; learning/struggling → request adapt
      if (this.onAdaptRequested && this._result.rating !== 'mastered') {
        this.onAdaptRequested({
          chapter: this._chapterFile,
          rating: this._result.rating,
          weak_concepts: this._result.weak_concepts
        });
      }

      // Persist to quiz history (Sprint 3 decision: 持久化到 quiz-history.json)
      if (this.onSaveHistory) {
        this.onSaveHistory({
          chapter: this._chapterFile,
          timestamp: new Date().toISOString(),
          questions: this._questions,
          answers: { ...this._answers },
          result: this._result
        });
      }
    }

    // ============================================
    // Getters
    // ============================================

    getChapterFile() {
      return this._chapterFile;
    }

    getScrollProgress() {
      return this._scrollProgress;
    }
  }

  // ============================================
  // Public API
  // ============================================

  window.QuizPanel = QuizPanel;
  window.QUIZ_VALID_RATINGS = VALID_RATINGS;
  window.QUIZ_VALID_STATES = VALID_STATES;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      QuizPanel,
      VALID_RATINGS,
      VALID_STATES,
      TRANSITIONS
    };
  }
})();
