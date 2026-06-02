/**
 * Learning Renderer
 * Handles learning mode detection, header bar rendering, and chapter navigation
 *
 * Responsibilities:
 * - Detect if current file is in a learning project
 * - Render learning mode header bar (project name, chapter info, mark complete)
 * - Chapter navigation (next/prev, double-click to open)
 * - Learning element rendering (!concept, !question, !quiz)
 */

(function() {
  'use strict';

  // Node.js compatibility
  if (typeof window === 'undefined') {
    global.window = {};
  }
  if (typeof document === 'undefined') {
    global.document = {
      createElement: (tag) => ({
        textContent: '',
        get innerHTML() { return this.textContent.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
      })
    };
  }

  // ============================================
  // LearningRenderer (exported for testing)
  // ============================================
  class LearningRenderer {
    constructor() {
      this._project = null;
      this._currentChapter = 0;
      this._projectExists = false;
      this._headerContainer = null;
      this._onChapterChange = null;
    }

    /**
     * Check if learning mode is active
     * @returns {boolean}
     */
    isLearningMode() {
      return this._projectExists;
    }

    /**
     * Set the learning project data
     * @param {object} project - { name, chapters: [{ title, status, duration_minutes, file }], currentChapter }
     */
    setProject(project) {
      this._project = project;
      this._currentChapter = project.currentChapter || 0;
      this._projectExists = true;
    }

    /**
     * Get the current project
     * @returns {object|null}
     */
    getProject() {
      return this._project;
    }

    /**
     * Get current chapter index
     * @returns {number}
     */
    getCurrentChapter() {
      return this._currentChapter;
    }

    /**
     * Render the header bar HTML
     * @returns {string}
     */
    renderHeader() {
      if (!this._project) return '';

      const chapters = this._project.chapters;
      const idx = this._currentChapter;
      const ch = chapters[idx];

      if (!ch) return '';

      const duration = ch.duration_minutes ? `${ch.duration_minutes} 分钟` : '';
      const completed = ch.status === 'completed' ? ' ✓' : '';
      const progress = `${idx + 1}/${chapters.length}`;

      return `${this._escapeHtml(this._project.name)} | 第 ${progress} 章 | ${duration}${completed}`;
    }

    /**
     * Get next chapter index
     * @returns {number|null}
     */
    getNextChapter() {
      if (!this._project || this._currentChapter >= this._project.chapters.length - 1) return null;
      return this._currentChapter + 1;
    }

    /**
     * Get previous chapter index
     * @returns {number|null}
     */
    getPrevChapter() {
      if (!this._project || this._currentChapter <= 0) return null;
      return this._currentChapter - 1;
    }

    /**
     * Check if a chapter can be opened for reading
     * @param {number} index
     * @returns {boolean}
     */
    canOpenChapter(index) {
      if (!this._project) return false;
      const ch = this._project.chapters[index];
      if (!ch) return false;
      return ch.status === 'ready' || ch.status === 'completed';
    }

    /**
     * Load a chapter for reading
     * @param {number} index
     */
    loadChapter(index) {
      if (!this.canOpenChapter(index)) {
        throw new Error(`Cannot open chapter ${index}: status is ${this._project.chapters[index]?.status}`);
      }
      this._currentChapter = index;

      if (this._onChapterChange) {
        this._onChapterChange(index);
      }
    }

    /**
     * Mark a chapter as completed
     * @param {number} index
     */
    markComplete(index) {
      if (this._project && this._project.chapters[index]) {
        this._project.chapters[index].status = 'completed';
      }
    }

    /**
     * Render the full header bar into a container
     * @param {HTMLElement} container
     */
    renderInto(container) {
      if (!container) return;
      this._headerContainer = container;

      const headerHtml = this.renderHeader();
      if (!headerHtml) {
        container.style.display = 'none';
        return;
      }

      container.style.display = 'flex';
      container.innerHTML = `
        <div class="learning-header-info">
          <span class="learning-header-title">${headerHtml}</span>
        </div>
        <div class="learning-header-actions">
          <button class="learning-nav-btn learning-prev-btn" title="上一章">◀</button>
          <button class="learning-complete-btn" title="标记完成">✓ 标记完成</button>
          <button class="learning-nav-btn learning-next-btn" title="下一章">▶</button>
        </div>
      `;

      this._bindHeaderEvents(container);
    }

    /**
     * Bind header bar events
     */
    _bindHeaderEvents(container) {
      const prevBtn = container.querySelector('.learning-prev-btn');
      const nextBtn = container.querySelector('.learning-next-btn');
      const completeBtn = container.querySelector('.learning-complete-btn');

      if (prevBtn) {
        prevBtn.addEventListener('click', () => {
          const prev = this.getPrevChapter();
          if (prev !== null) this.loadChapter(prev);
        });
        prevBtn.disabled = this.getPrevChapter() === null;
      }

      if (nextBtn) {
        nextBtn.addEventListener('click', () => {
          const next = this.getNextChapter();
          if (next !== null) this.loadChapter(next);
        });
        nextBtn.disabled = this.getNextChapter() === null;
      }

      if (completeBtn) {
        completeBtn.addEventListener('click', () => {
          this.markComplete(this._currentChapter);
          this.renderInto(this._headerContainer);
        });
      }
    }

    /**
     * Escape HTML
     */
    _escapeHtml(text) {
      if (!text) return '';
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }
  }

  // ============================================
  // Public API
  // ============================================
  window.LearningRenderer = LearningRenderer;

  // Export for Node.js testing
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { LearningRenderer };
  }
})();
