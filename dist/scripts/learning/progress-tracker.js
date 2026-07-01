/**
 * Learning Progress Tracker
 * Manages chapter status state machine, progress bar, and agent-event handling
 *
 * State Machine:
 *   not_generated → generating → ready → completed
 *                                → failed → generating (retry)
 */

(function() {
  'use strict';

  // Node.js compatibility: provide window/document if not defined
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
  // Valid Status Transitions
  // ============================================
  const VALID_TRANSITIONS = {
    'not_generated': ['generating'],
    'generating': ['ready', 'failed'],
    'ready': ['completed', 'generating'],
    'completed': [],
    'failed': ['generating', 'not_generated']  // not_generated = reset for sliding-window retry
  };

  // Status display config
  const STATUS_ICONS = {
    'not_generated': '⚪',
    'generating': '🔄',
    'ready': '⏳',
    'completed': '✅',
    'failed': '❌'
  };

  const STATUS_LABELS = {
    'not_generated': '未生成',
    'generating': '生成中',
    'ready': '就绪',
    'completed': '已完成',
    'failed': '失败'
  };

  // ============================================
  // ChapterStatusManager (exported for testing)
  // ============================================
  class ChapterStatusManager {
    constructor(chapters) {
      this.chapters = chapters.map((ch, i) => ({
        title: ch.title || `第 ${i + 1} 章`,
        duration_minutes: ch.duration_minutes || 0,
        concepts: ch.concepts || [],
        status: 'not_generated',
        file: null,
        rating: null           // set after quiz: 'mastered'|'learning'|'struggling'
      }));
    }

    /**
     * Get chapter status
     * @param {number} index
     * @returns {string}
     */
    getStatus(index) {
      this._validateIndex(index);
      return this.chapters[index].status;
    }

    /**
     * Set chapter status (validates transition)
     * @param {number} index
     * @param {string} newStatus
     */
    setStatus(index, newStatus) {
      this._validateIndex(index);
      const current = this.chapters[index].status;
      const valid = VALID_TRANSITIONS[current] || [];

      if (!valid.includes(newStatus)) {
        throw new Error(`Invalid transition: ${current} → ${newStatus}`);
      }

      this.chapters[index].status = newStatus;
    }

    /**
     * Get progress counts
     * @returns {{ total, completed, ready, generating, not_generated, failed }}
     */
    getProgress() {
      const counts = {
        total: this.chapters.length,
        completed: 0,
        ready: 0,
        generating: 0,
        not_generated: 0,
        failed: 0
      };

      this.chapters.forEach(ch => {
        counts[ch.status]++;
      });

      return counts;
    }

    /**
     * Get progress as percentage (0-100)
     * @returns {number}
     */
    getProgressPercentage() {
      const p = this.getProgress();
      return Math.round((p.completed / p.total) * 100);
    }

    /**
     * Handle agent-event from Rust backend
     * @param {{ type: string, data: object }} event
     */
    handleAgentEvent(event) {
      switch (event.type) {
        case 'progress':
          if (event.data.status === 'generating' && event.data.current) {
            const idx = event.data.current - 1;
            if (idx >= 0 && idx < this.chapters.length) {
              try {
                this.setStatus(idx, 'generating');
              } catch (e) {
                // Already generating, ignore
              }
            }
          }
          break;

        case 'chapter_complete':
          if (typeof event.data.index === 'number') {
            try {
              this.setStatus(event.data.index, 'ready');
            } catch (e) {
              // Invalid transition, ignore
            }
            if (event.data.file) {
              // event.data.file is just the filename from agent-bridge.
              // Prepend the project path so _openChapterFile can resolve it.
              const projPath = this.ui && this.ui.projectPath;
              const fullPath = _joinProjectPath(projPath, event.data.file);
              this.setChapterFile(event.data.index, fullPath);

              // Persist file + status to project.json so it survives app restart.
              // Previously file was only in memory → resume relied on guess-the-filename
              // sync, which was fragile and caused "cannot open chapter" bugs.
              if (window.__TAURI__ && projPath) {
                const basename = (event.data.file || '').split(/[/\\]/).pop();
                if (basename) {
                  window.__TAURI__.core.invoke('persist_chapter_file', {
                    projectPath: projPath,
                    chapterIndex: event.data.index,
                    fileBasename: basename,
                    status: 'ready'
                  }).catch(err => console.warn('[ProgressTracker] persist_chapter_file failed:', err));
                }
              }
            }
          }
          // Refresh file tree so new files appear in sidebar immediately
          if (window.TyporaNext && window.TyporaNext.refreshFileTree) {
            window.TyporaNext.refreshFileTree();
          }
          break;

        case 'chapter_failed':
          if (typeof event.data.index === 'number') {
            try {
              this.setStatus(event.data.index, 'failed');
            } catch (e) {
              // Invalid transition, ignore
            }
          }
          break;
      }
    }

    /**
     * Get index of next chapter to generate
     * @returns {number|null}
     */
    getNextToGenerate() {
      const idx = this.chapters.findIndex(ch => ch.status === 'not_generated');
      return idx === -1 ? null : idx;
    }

    /**
     * Check if a chapter can be retried
     * @param {number} index
     * @returns {boolean}
     */
    canRetry(index) {
      this._validateIndex(index);
      return this.chapters[index].status === 'failed';
    }

    /**
     * Get chapter file path
     * @param {number} index
     * @returns {string|null}
     */
    getChapterFile(index) {
      this._validateIndex(index);
      return this.chapters[index].file;
    }

    /**
     * Set chapter file path
     * @param {number} index
     * @param {string} file
     */
    setChapterFile(index, file) {
      this._validateIndex(index);
      this.chapters[index].file = file;
    }

    /**
     * Set chapter quiz rating (affects icon/color in chapter list)
     * @param {number} index
     * @param {'mastered'|'learning'|'struggling'} rating
     */
    setRating(index, rating) {
      this._validateIndex(index);
      const VALID = ['mastered', 'learning', 'struggling'];
      if (rating && !VALID.includes(rating)) {
        console.warn('[ChapterStatusManager] invalid rating:', rating);
        return;
      }
      this.chapters[index].rating = rating;
    }

    /**
     * Get chapter quiz rating
     * @param {number} index
     * @returns {string|null}
     */
    getRating(index) {
      this._validateIndex(index);
      return this.chapters[index].rating;
    }

    /**
     * Validate chapter index
     * @param {number} index
     */
    _validateIndex(index) {
      if (index < 0 || index >= this.chapters.length) {
        throw new Error(`Invalid chapter index: ${index}`);
      }
    }
  }

  // ============================================
  // ProgressUI - DOM rendering
  // ============================================
  class ProgressUI {
    constructor(container) {
      this.container = container;
      this.manager = null;
      this.onChapterClick = null;
      this.onRetryClick = null;
      this.onAbortClick = null;
      this.onStartLearningClick = null;
      this.onGenerateClick = null;
      this.onExitLearningClick = null;
      this.onOpenDashboard = null;
      this.projectPath = null;
    }

    /**
     * Initialize with a ChapterStatusManager
     * @param {ChapterStatusManager} manager
     */
    init(manager) {
      this.manager = manager;
      this.render();
    }

    /**
     * Render the full progress UI
     */
    render() {
      if (!this.container || !this.manager) return;

      const progress = this.manager.getProgress();
      const pct = this.manager.getProgressPercentage();

      // Find first chapter that can be read (ready or completed)
      const firstReadableIndex = this.manager.chapters.findIndex(ch =>
        ch.status === 'ready' || ch.status === 'completed'
      );
      const hasReadable = firstReadableIndex >= 0;
      const hasNotGenerated = this.manager.chapters.some(ch =>
        ch.status === 'not_generated' || ch.status === 'failed'
      );

      // Determine primary action button
      let actionBtn = '';
      if (hasReadable) {
        actionBtn = `<button class="learning-start-btn" id="learningStartBtn">📖 开始学习</button>`;
      } else if (hasNotGenerated) {
        actionBtn = `<button class="learning-start-btn" id="learningGenerateBtn">🔄 开始生成</button>`;
      } else {
        actionBtn = `<button class="learning-start-btn disabled" id="learningStartBtn" disabled>⏳ 先生成内容</button>`;
      }

      this.container.innerHTML = `
        <div class="learning-progress-header-row">
          <div class="learning-progress-title">学习进度</div>
          <div style="display:flex;gap:8px;align-items:center;">
            ${actionBtn}
            <button class="learning-kg-btn" id="learningKGBtn" title="知识图谱">🧠 图谱</button>
            <button class="learning-exit-btn" id="learningExitBtn" title="退出课程模式">退出</button>
            <button class="learning-progress-close-btn" id="learningProgressClose">×</button>
          </div>
        </div>
        <div class="learning-progress-bar">
          <div class="learning-progress-fill" style="width: ${pct}%"></div>
          <span class="learning-progress-text">${progress.completed}/${progress.total} 章已完成</span>
        </div>
        ${this._renderRatingStatusBar()}
        <div class="learning-chapter-list">
          ${this.manager.chapters.map((ch, i) => this._renderChapterItem(ch, i)).join('')}
        </div>
      `;


      this._bindEvents();
    }

    /**
     * Render a single chapter item, with rating-aware icon/color when completed.
     * Rating (set after quiz) gives the user immediate visual feedback:
     *   mastered  → ✅ green    (流利掌握)
     *   learning  → 📖 blue     (基本理解)
     *   struggling → ⚠️ red     (有待加强)
     *   no rating → ✅ gray     (无测验记录)
     */
    _renderChapterItem(chapter, index) {
      const clickable = chapter.status === 'ready' || chapter.status === 'completed';
      const retryable = chapter.status === 'failed';
      const generating = chapter.status === 'generating';

      // Compute icon: completed chapters get rating-aware icons
      let icon;
      if (chapter.status === 'completed' && chapter.rating) {
        const RATING_ICONS = { mastered: '✅', learning: '📖', struggling: '⚠️' };
        icon = RATING_ICONS[chapter.rating] || '✅';
      } else {
        icon = STATUS_ICONS[chapter.status] || '⚪';
      }

      const label = STATUS_LABELS[chapter.status] || '';
      const ratingClass = chapter.rating ? `rating-${chapter.rating}` : '';
      const ratingBadge = (chapter.status === 'completed' && chapter.rating)
        ? `<span class="learning-chapter-rating rating-${chapter.rating}">${chapter.rating}</span>`
        : '';

      return `
        <div class="learning-chapter-item ${clickable ? 'clickable' : ''} ${retryable ? 'retryable' : ''} ${generating ? 'generating' : ''} ${ratingClass}"
             data-index="${index}" data-status="${chapter.status}" data-rating="${chapter.rating || ''}">
          <span class="learning-chapter-icon">${icon}</span>
          <span class="learning-chapter-title">${this._escapeHtml(chapter.title)}</span>
          ${ratingBadge}
          <span class="learning-chapter-label">${label}</span>
          ${retryable ? '<button class="learning-retry-btn" data-index="' + index + '">重试</button>' : ''}
        </div>
      `;
    }

    /**
     * Render a thin rating-status bar between the progress bar and chapter list.
     * Shows:
     * - "struggling" chapter + pending next chapter → warning line
     * - Otherwise → legend showing what the colored icons mean
     */
    _renderRatingStatusBar() {
      if (!this.manager) return '';

      // Collect ALL struggling completed chapters (any of them blocks sliding)
      const strugglingChapters = this.manager.chapters
        .map((ch, i) => ({ ch, i }))
        .filter(({ ch }) => ch.status === 'completed' && ch.rating === 'struggling');

      if (strugglingChapters.length > 0) {
        const nums = strugglingChapters.map(({ i }) => `第 ${i + 1} 章`).join('、');
        const hasPending = this.manager.chapters.some(ch => ch.status === 'not_generated');
        const actionHint = hasPending ? '，重学掌握后解锁后续章节生成' : '';
        return `
          <div class="learning-rating-status warning">
            ⚠️ ${nums} 评分 struggling${actionHint}
          </div>`;
      }

      // Any rating at all? Show legend
      const hasRating = this.manager.chapters.some(ch => ch.rating);
      if (hasRating) {
        return `
          <div class="learning-rating-status legend">
            <span>✅ 掌握</span><span>📖 理解</span><span>⚠️ 薄弱</span>
          </div>`;
      }

      return '';
    }

    /**
     * Bind click events
     */
    _bindEvents() {
      // Close button → hide panel, show orb
      const closeBtn = this.container.querySelector('#learningProgressClose');
      const orb = document.getElementById('learningModeOrb');
      if (closeBtn) {
        closeBtn.addEventListener('click', () => {
          this.container.style.display = 'none';
          if (orb) orb.style.display = 'flex';
        });
      }

      // Exit learning mode button
      const exitBtn = this.container.querySelector('#learningExitBtn');
      if (exitBtn) {
        exitBtn.addEventListener('click', () => {
          if (this.onExitLearningClick) this.onExitLearningClick();
        });
      }

      // Knowledge graph dashboard button
      const kgBtn = this.container.querySelector('#learningKGBtn');
      if (kgBtn) {
        kgBtn.addEventListener('click', () => {
          if (this.onOpenDashboard) this.onOpenDashboard();
        });
      }

      // "Start Learning" button
      const startBtn = this.container.querySelector('#learningStartBtn');
      if (startBtn && !startBtn.disabled) {
        startBtn.addEventListener('click', () => {
          if (this.onStartLearningClick) this.onStartLearningClick();
        });
      }

      // "Generate" button
      const genBtn = this.container.querySelector('#learningGenerateBtn');
      if (genBtn) {
        genBtn.addEventListener('click', () => {
          if (this.onGenerateClick) this.onGenerateClick();
        });
      }

      // Chapter click (open for reading)
      this.container.querySelectorAll('.learning-chapter-item.clickable').forEach(el => {
        el.addEventListener('click', () => {
          const index = parseInt(el.dataset.index, 10);
          if (this.onChapterClick) this.onChapterClick(index);
        });
      });

      // Retry button
      this.container.querySelectorAll('.learning-retry-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const index = parseInt(btn.dataset.index, 10);
          if (this.onRetryClick) this.onRetryClick(index);
        });
      });
    }

    /**
     * Update a single chapter item without full re-render
     */
    updateChapter(index) {
      if (!this.manager) return;
      const el = this.container.querySelector(`[data-index="${index}"]`);
      if (!el) return;

      const chapter = this.manager.chapters[index];
      const prevStatus = el.dataset.status;

      // Compute icon: completed chapters get rating-aware icons
      let icon;
      if (chapter.status === 'completed' && chapter.rating) {
        const RATING_ICONS = { mastered: '✅', learning: '📖', struggling: '⚠️' };
        icon = RATING_ICONS[chapter.rating] || '✅';
      } else {
        icon = STATUS_ICONS[chapter.status] || '⚪';
      }
      const label = STATUS_LABELS[chapter.status];

      el.querySelector('.learning-chapter-icon').textContent = icon;
      el.querySelector('.learning-chapter-label').textContent = label;
      el.dataset.status = chapter.status;
      el.dataset.rating = chapter.rating || '';

      // Update rating class
      ['rating-mastered', 'rating-learning', 'rating-struggling'].forEach(cls =>
        el.classList.toggle(cls, chapter.rating === cls.replace('rating-', ''))
      );

      // Update or create rating badge
      let badge = el.querySelector('.learning-chapter-rating');
      if (chapter.status === 'completed' && chapter.rating) {
        if (!badge) {
          badge = document.createElement('span');
          badge.className = 'learning-chapter-rating';
          el.insertBefore(badge, el.querySelector('.learning-chapter-label'));
        }
        badge.textContent = chapter.rating;
        badge.className = `learning-chapter-rating rating-${chapter.rating}`;
      } else if (badge) {
        badge.remove();
      }

      // Update the rating status bar
      const oldBar = this.container.querySelector('.learning-rating-status');
      if (oldBar) oldBar.remove();
      const progressBar = this.container.querySelector('.learning-progress-bar');
      const chapterList = this.container.querySelector('.learning-chapter-list');
      if (progressBar && chapterList) {
        const barHtml = this._renderRatingStatusBar();
        if (barHtml) {
          const temp = document.createElement('div');
          temp.innerHTML = barHtml;
          const newBar = temp.firstElementChild;
          progressBar.parentNode.insertBefore(newBar, chapterList);
        }
      }

      // Update chapter item clickability
      const clickable = chapter.status === 'ready' || chapter.status === 'completed';
      el.classList.toggle('clickable', clickable);

      // Update progress bar
      const pct = this.manager.getProgressPercentage();
      const fill = this.container.querySelector('.learning-progress-fill');
      const text = this.container.querySelector('.learning-progress-text');
      if (fill) fill.style.width = `${pct}%`;
      if (text) {
        const progress = this.manager.getProgress();
        text.textContent = `${progress.completed}/${progress.total} 章已完成`;
      }

      // Notify listeners of state transitions
      if (prevStatus !== chapter.status) {
        if (this.onChapterStatusChange) {
          this.onChapterStatusChange(index, prevStatus, chapter.status);
        }
      }
    }

    /**
     * Append a streamed log line to the progress panel's log box.
     * Lines are kept in memory (max 100) so they survive ui.render() cycles.
     */
    appendProgressLog(text) {
      // Log lines are now shown exclusively via the centered overlay
      // (GenerationOverlay.appendLog). The bottom-right panel no longer
      // has a log area — clean and focused on the chapter list.
      if (!text) return;
      if (!Array.isArray(this._progressLogLines)) {
        this._progressLogLines = [];
      }
      this._progressLogLines.push(text);
      while (this._progressLogLines.length > 100) {
        this._progressLogLines.shift();
      }
    }

    /**
     * Show inline progress during generation — a prominent, styled log area
     * that appears above the chapter list. Styled to match init-status-panel.
     * Each line shows tool activity: "📖 正在读 SKILL.md" / "✓ 正在写 01-xxx.md"
     */
    showInlineProgress(text) {
      if (!text) return;
      // Find or create the inline progress container
      let inlineEl = this.container.querySelector('.gen-progress-inline');
      if (!inlineEl) {
        inlineEl = document.createElement('div');
        inlineEl.className = 'gen-progress-inline';
        // Insert before the chapter list so it's prominent
        const chapterList = this.container.querySelector('.learning-chapter-list');
        if (chapterList) {
          chapterList.parentNode.insertBefore(inlineEl, chapterList);
        } else {
          this.container.appendChild(inlineEl);
        }
      }
      // Determine line style: ✓ → done, 📖/🔍 → active
      const isDone = text.startsWith('✓');
      const isActive = text.startsWith('📖') || text.startsWith('🔍');
      const line = document.createElement('div');
      line.className = 'log-line' + (isDone ? ' done' : isActive ? ' active' : '');
      if (isActive) {
        line.innerHTML = '<span class="spinner-inline"></span> ' + this._escapeHtml(text);
      } else {
        line.textContent = text;
      }
      inlineEl.appendChild(line);
      inlineEl.scrollTop = inlineEl.scrollHeight;
      // Cap at 20 lines
      while (inlineEl.children.length > 20) {
        inlineEl.removeChild(inlineEl.firstChild);
      }
    }

    _escapeHtml(text) {
      if (!text) return '';
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }
  }

  // ============================================
  // Agent Event Bridge
  // ============================================
  class AgentEventBridge {
    constructor(manager, ui, overlay) {
      this.manager = manager;
      this.ui = ui;
      this.overlay = overlay; // GenerationOverlay (centered progress)
      this._bound = false;
      this._generationDone = false;
      this._graphRebuildTimer = null;
    }

    /**
     * Start listening for Tauri agent-events
     */
    bind() {
      if (this._bound) return;
      this._bound = true;

      // Use Tauri event system, not DOM events
      if (window.__TAURI__ && window.__TAURI__.event) {
        window.__TAURI__.event.listen('agent-event', (event) => {
          this.handleEvent(event.payload);
        });
      }
    }

    /**
     * Handle a single agent event
     * @param {{ type: string, data: object }} payload
     */
    handleEvent(payload) {
      if (!payload || !payload.type) return;

      this.manager.handleAgentEvent(payload);

      // Update UI for the affected chapter
      if (payload.type === 'progress' && payload.data.current) {
        this.ui.updateChapter(payload.data.current - 1);
        if (this.overlay) this.overlay.updateChapter(payload.data.current - 1, 'active');
      } else if (payload.type === 'chapter_complete' && typeof payload.data.index === 'number') {
        this.ui.updateChapter(payload.data.index);
        if (this.overlay) this.overlay.updateChapter(payload.data.index, 'done');
        // After a chapter finishes, the knowledge graph is missing the new
        // concepts/edges. Trigger a background rebuild so the dashboard
        // shows the new graph the next time the user opens it. We do this
        // async (no await) so the UI update isn't blocked.
        if (this.ui && this.ui.projectPath && window.KnowledgeGraphManager) {
          const projectPath = this.ui.projectPath;
          // Debounce: if multiple chapter_complete arrive in quick succession,
          // skip rebuilds until 1.5s of quiet. Last one wins.
          if (this._graphRebuildTimer) clearTimeout(this._graphRebuildTimer);
          this._graphRebuildTimer = setTimeout(async () => {
            if (this.overlay) this.overlay.appendLog('正在重建知识图谱...');
            try {
              const kgm = new window.KnowledgeGraphManager(projectPath);
              await kgm.buildGraph();
              if (this.overlay) this.overlay.appendLog('✓ 知识图谱已更新');
            } catch (e) {
              const errMsg = e?.message || String(e);
              console.warn('[ProgressTracker] background graph rebuild failed:', errMsg);
              if (this.overlay) this.overlay.appendLog('❌ 知识图谱重建失败: ' + errMsg.slice(0, 100));
            }
          }, 1500);
        }
      } else if (payload.type === 'chapter_failed' && typeof payload.data.index === 'number') {
        this.ui.updateChapter(payload.data.index);
        if (this.overlay) this.overlay.updateChapter(payload.data.index, 'failed');
      } else if (payload.type === 'complete') {
        this.ui.render();
        // Final refresh of file tree to ensure all generated files appear
        if (window.TyporaNext && window.TyporaNext.refreshFileTree) {
          window.TyporaNext.refreshFileTree();
        }
        // Force a final graph rebuild once all chapters are done.
        if (this.ui && this.ui.projectPath && window.KnowledgeGraphManager) {
          if (this._graphRebuildTimer) clearTimeout(this._graphRebuildTimer);
          (async () => {
            if (this.overlay) this.overlay.appendLog('正在重建知识图谱...');
            try {
              const kgm = new window.KnowledgeGraphManager(this.ui.projectPath);
              await kgm.buildGraph();
              if (this.overlay) this.overlay.appendLog('✓ 知识图谱已更新');
            } catch (e) {
              const errMsg = e?.message || String(e);
              console.warn('[ProgressTracker] final graph rebuild failed:', errMsg);
              if (this.overlay) this.overlay.appendLog('❌ 知识图谱重建失败: ' + errMsg.slice(0, 100));
            }
          })();
        }
        // Mark generation as done — stop the inline progress animation
        this._generationDone = true;
        // Auto-minimize the centered overlay to orb after a short delay.
        // Mark as done so subsequent orb clicks restore the bottom-right
        // learning progress panel instead of the overlay.
        if (this.overlay) {
          this.overlay.done();
          setTimeout(() => this.overlay.minimize(), 3000);
        }
      } else if (payload.type === 'progress_log' && payload.data && payload.data.text) {
        // Streamed log line (used by both planning and chapter generation)
        if (this.ui && this.ui.appendProgressLog) {
          this.ui.appendProgressLog(payload.data.text);
        }
        // Also show in the centered overlay
        if (this.overlay) {
          this.overlay.appendLog(payload.data.text);
        }
      }

      // Always re-sync UI from manager state to handle missed events when panel was hidden
      this._refreshPanel();
    }

    /**
     * Re-render panel if it's currently visible so the user always sees
     * the latest state, even after reopening the panel from the orb.
     */
    _refreshPanel() {
      if (!this.ui || !this.ui.container) return;
      const visible = this.ui.container.style.display !== 'none';
      if (visible) {
        // Update the progress bar / counters (which updateChapter doesn't touch)
        const progress = this.manager.getProgress();
        const fill = this.ui.container.querySelector('.learning-progress-fill');
        const text = this.ui.container.querySelector('.learning-progress-text');
        if (fill) fill.style.width = `${this.manager.getProgressPercentage()}%`;
        if (text) text.textContent = `${progress.completed}/${progress.total} 章已完成`;
      }
    }
  }

  /**
   * GenerationOverlay — centered progress overlay during chapter generation.
   * Shows chapter list + streaming log in a card similar to init status panel.
   * Can be minimized to the orb; auto-minimizes on completion.
   */
  class GenerationOverlay {
    constructor(chapters, projectPath) {
      this.chapters = chapters;
      this.projectPath = projectPath;
      this.overlay = document.getElementById('generationProgressOverlay');
      this.orb = document.getElementById('learningModeOrb');
      this._logLines = [];
      this._done = false;
      this._chapterStatuses = chapters.map(() => 'pending'); // pending | active | done | failed
      this._init();
    }

    _init() {
      if (!this.overlay) return;

      // Render chapter list
      const chaptersEl = this.overlay.querySelector('#genProgressChapters');
      if (chaptersEl) {
        chaptersEl.innerHTML = this.chapters.map((ch, i) => `
          <div class="gen-progress-chapter-item pending" data-index="${i}">
            <div class="gen-progress-chapter-icon">${i + 1}</div>
            <div>${this._escapeHtml(ch.title)}</div>
          </div>
        `).join('');
      }

      // Update progress count
      this._updateCount();

      // Minimize button
      const minBtn = this.overlay.querySelector('#genProgressMinimize');
      if (minBtn) {
        minBtn.addEventListener('click', () => this.minimize());
      }

      // Show overlay
      this.overlay.style.display = 'flex';
      if (this.orb) this.orb.style.display = 'none';
    }

    /**
     * Update a chapter's status in the overlay
     * @param {number} index
     * @param {'pending'|'active'|'done'|'failed'} status
     */
    updateChapter(index, status) {
      if (!this.overlay) return;
      this._chapterStatuses[index] = status;
      const item = this.overlay.querySelector(`.gen-progress-chapter-item[data-index="${index}"]`);
      if (!item) return;

      item.className = `gen-progress-chapter-item ${status}`;
      const icon = item.querySelector('.gen-progress-chapter-icon');
      if (icon) {
        if (status === 'done') {
          icon.textContent = '✓';
        } else if (status === 'failed') {
          icon.textContent = '✗';
        } else if (status === 'active') {
          icon.innerHTML = '<div class="gen-progress-chapter-spinner"></div>';
        } else {
          icon.textContent = String(index + 1);
        }
      }
      this._updateCount();
      this._updateFill();
    }

    /**
     * Append a log line to the progress log area
     */
    appendLog(text) {
      if (!this.overlay || !text) return;
      this._logLines.push(text);
      const logEl = this.overlay.querySelector('#genProgressLog');
      if (!logEl) return;

      const isDone = text.startsWith('✓');
      const isActive = text.startsWith('📖') || text.startsWith('🔍');
      const line = document.createElement('div');
      line.className = 'log-line' + (isDone ? ' done' : isActive ? ' active' : '');
      if (isActive) {
        line.innerHTML = '<span class="spinner-inline"></span> ' + this._escapeHtml(text);
      } else {
        line.textContent = text;
      }
      logEl.appendChild(line);
      logEl.scrollTop = logEl.scrollHeight;
      while (logEl.children.length > 30) {
        logEl.removeChild(logEl.firstChild);
      }
    }

    /**
     * Minimize overlay to orb
     */
    minimize() {
      if (this.overlay) this.overlay.style.display = 'none';
      if (this.orb) this.orb.style.display = 'flex';
    }

    /**
     * Restore overlay from orb
     */
    restore() {
      if (this.overlay) this.overlay.style.display = 'flex';
      if (this.orb) this.orb.style.display = 'none';
    }

    /**
     * Mark overlay as "generation done". After this, orb click will restore
     * the bottom-right learning progress panel instead of the centered overlay.
     */
    done() {
      this._done = true;
    }

    /**
     * Hide overlay completely (after generation is done and user has seen the result)
     */
    hide() {
      if (this.overlay) this.overlay.style.display = 'none';
    }

    _updateCount() {
      const countEl = this.overlay && this.overlay.querySelector('#genProgressCount');
      if (!countEl) return;
      const done = this._chapterStatuses.filter(s => s === 'done').length;
      countEl.textContent = `${done}/${this.chapters.length} 章已完成`;
    }

    _updateFill() {
      const fillEl = this.overlay && this.overlay.querySelector('#genProgressFill');
      if (!fillEl) return;
      const done = this._chapterStatuses.filter(s => s === 'done').length;
      fillEl.style.width = `${(done / this.chapters.length) * 100}%`;
    }

    _escapeHtml(s) {
      return String(s).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
      }[c]));
    }
  }

  // ============================================
  // Filesystem Polling (fallback for missed agent-events)
  // ============================================

  /**
   * Poll the project directory every POLL_INTERVAL_MS to detect chapter .md files
   * that exist on disk but are not yet marked ready in our state machine.
   * Stops once every chapter is in a terminal state (ready/completed/failed).
   */
  const POLL_INTERVAL_MS = 3000;
  function startFileSystemPolling(projectPath, manager, ui, bridge) {
    if (!window.__TAURI__ || !projectPath) return;
    if (startFileSystemPolling._interval) clearInterval(startFileSystemPolling._interval);

    async function pollOnce() {
      // Stop if all chapters are in a terminal state
      const progress = manager.getProgress();
      const unfinished = progress.not_generated + progress.generating + progress.failed;
      if (unfinished === 0) {
        if (startFileSystemPolling._interval) {
          clearInterval(startFileSystemPolling._interval);
          startFileSystemPolling._interval = null;
        }
        return;
      }

      try {
        const entries = await window.__TAURI__.core.invoke('list_directory', { path: projectPath });
        const filesOnDisk = new Set(
          (entries || [])
            .filter(e => e.is_file && /\.md$/i.test(e.name))
            .map(e => e.name)
        );

        let anyChange = false;
        for (let i = 0; i < manager.chapters.length; i++) {
          const ch = manager.chapters[i];
          if (ch.status === 'ready' || ch.status === 'completed' || ch.status === 'failed') continue;

          // Try to find a chapter file on disk matching this chapter
          const expectedFile = _guessChapterFileName(i, ch.title);
          if (filesOnDisk.has(expectedFile)) {
            // Replay a synthetic chapter_complete event so the rest of the pipeline (UI + hub) runs
            console.log(`[ProgressTracker] FS poll: found ${expectedFile} for chapter ${i}, syncing state`);
            try {
              manager.setStatus(i, 'ready');
            } catch (_) {
              // Already in a non-pending state, skip
              continue;
            }
            manager.setChapterFile(i, _joinProjectPath(projectPath, expectedFile));
            ui.updateChapter(i);
            anyChange = true;

            // Persist progress into learning hub so resume works
            if (window.LearningHub && window.LearningHub.updateProjectProgress) {
              const updated = manager.getProgress();
              window.LearningHub.updateProjectProgress(projectPath, updated.completed, updated.total).catch(() => {});
            }
          }
        }

        if (anyChange) {
          // Re-render panel if visible so progress bar updates
          if (ui.container.style.display !== 'none') {
            const fill = ui.container.querySelector('.learning-progress-fill');
            const text = ui.container.querySelector('.learning-progress-text');
            const updated = manager.getProgress();
            if (fill) fill.style.width = `${manager.getProgressPercentage()}%`;
            if (text) text.textContent = `${updated.completed}/${updated.total} 章已完成`;
          }
        }
      } catch (err) {
        console.warn('[ProgressTracker] FS poll failed:', err);
      }
    }

    // Kick off after a short delay so the first batch of agent-events can land first
    setTimeout(pollOnce, 2000);
    startFileSystemPolling._interval = setInterval(pollOnce, POLL_INTERVAL_MS);
  }

  /**
   * Mirror agent-bridge.js generateFilename() to predict the on-disk name.
   * Format: NN-{sanitized-title}.md (zero-padded index)
   */
  /**
   * Build a full path from a project directory + bare filename.
   * Returns the filename unchanged if it's already absolute or if projectPath
   * is missing. Used by chapter_complete handler and FS polling to normalize
   * chapter.file into a full path that _openChapterFile can resolve.
   */
  function _joinProjectPath(projectPath, fileName) {
    if (!fileName) return fileName;
    // Already absolute (Windows drive letter or Unix root)
    if (/^([A-Za-z]:[\\/]|\/)/.test(fileName)) return fileName;
    if (!projectPath) return fileName;
    const sep = String(projectPath).includes('\\') ? '\\' : '/';
    const cleanedBase = String(projectPath).replace(/[\\/]+$/, '');
    const cleanedFile = String(fileName).replace(/^[\\/]+/, '');
    return cleanedBase + sep + cleanedFile;
  }

  function _guessChapterFileName(index, title) {
    const paddedIndex = String(index).padStart(2, '0');
    const safeTitle = (title || `chapter-${index}`)
      .replace(/[^一-龥a-zA-Z0-9]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    return `${paddedIndex}-${safeTitle}.md`;
  }

  // ============================================
  // Sliding-Window Pre-Generation
  // ============================================
  // Strategy: when the user starts a project, pre-generate the first N chapters
  // (N=2 by default). As the user completes chapters (status → 'completed'),
  // the next pending chapter is automatically enqueued for generation, so the
  // user never waits more than the time for one chapter to become ready.
  //
  // Why sliding-window: a project with 11 chapters (e.g. "扩散模型") would
  // otherwise take 5-15 minutes to pre-generate everything. With the window
  // the user starts reading in ~1 chapter-time.
  const DEFAULT_WINDOW_SIZE = 2;
  const windowState = {
    projectPath: null,
    totalChapters: 0,
    windowSize: DEFAULT_WINDOW_SIZE,
    inFlight: false  // serialize to avoid concurrent generate_chapters calls
  };

  /**
   * Initialize sliding-window for a new project.
   * @param {string} projectPath
   * @param {number} totalChapters
   * @param {number} windowSize - how many chapters to pre-generate (default 2)
   */
  function initSlidingWindow(projectPath, totalChapters, windowSize) {
    windowState.projectPath = projectPath;
    windowState.totalChapters = totalChapters || 0;
    windowState.windowSize = (typeof windowSize === 'number' && windowSize > 0)
      ? windowSize
      : DEFAULT_WINDOW_SIZE;
    windowState.inFlight = false;
  }

  /**
   * Compute which chapter indices are currently "in the window" and need to
   * exist on disk. These are the chapters that are either pending generation
   * (not_generated) OR the next-N unstarted chapters ahead of the highest
   * completed chapter.
   */
  function _computeWindowIndices(manager) {
    if (!manager && window.LearningProgress && window.LearningProgress._manager) {
      manager = window.LearningProgress._manager;
    }
    if (!manager) {
      // No manager available: trigger the first windowSize chapters
      const total = windowState.totalChapters;
      const indices = [];
      const limit = Math.min(total, windowState.windowSize);
      for (let i = 0; i < limit; i++) indices.push(i);
      return indices;
    }
    const total = manager.chapters.length;
    // Highest completed index (-1 if none completed yet)
    const completedIdx = manager.chapters.reduce((max, ch, i) =>
      ch.status === 'completed' ? Math.max(max, i) : max, -1);
    // Window end (exclusive): completedIdx + 1 + windowSize
    const windowEnd = Math.min(total, completedIdx + 1 + windowState.windowSize);
    // Window start: at least the first chapter, or 0 if nothing is completed
    const windowStart = completedIdx + 1;
    const indices = [];
    for (let i = windowStart; i < windowEnd; i++) {
      if (manager.chapters[i].status === 'not_generated') {
        indices.push(i);
      }
    }
    return indices;
  }

  /**
   * Trigger generation of the current sliding-window chapters.
   * Safe to call repeatedly: it bails out if a request is already in flight.
   * @param {object} manager - ChapterStatusManager
   * @param {object} outline - full outline (needed for chapter titles/concepts)
   * @param {string} projectPath
   */
  async function triggerSlidingWindow(manager, projectPath) {
    if (windowState.inFlight) {
      console.log('[SlidingWindow] Already in flight, skipping');
      return;
    }
    if (!window.__TAURI__) return;

    // Use the manager if available; otherwise fall back to window state.
    const mgr = manager || (window.LearningProgress && window.LearningProgress._manager);
    if (!mgr) {
      console.warn('[SlidingWindow] triggerSlidingWindow called without manager');
      return;
    }
    const indices = _computeWindowIndices(mgr);
    if (indices.length === 0) {
      console.log('[SlidingWindow] Nothing to generate, window satisfied');
      return;
    }

    windowState.inFlight = true;
    console.log(`[SlidingWindow] Triggering generation for chapters [${indices.join(', ')}]`);

    // Mark them as 'generating' optimistically so the UI shows progress
    for (const i of indices) {
      try {
        mgr.setStatus(i, 'generating');
      } catch (_) {
        // May already be in a different state (e.g. ready) due to FS poll
      }
    }
    // Refresh UI
    if (window.LearningProgress && window.LearningProgress._ui) {
      const ui = window.LearningProgress._ui;
      for (const i of indices) {
        if (ui.updateChapter) ui.updateChapter(i);
      }
    }

    try {
      // Phase B: read session_id from .learning/agent-session.json so the
      // agent has project memory across chapter generations. If the file
      // is missing (legacy project) or unreadable, fall through with no
      // session_id — agent will start fresh for this project.
      let sessionId = null;
      try {
        const { exists, readTextFile } = window.__TAURI__.fs;
        const sessionPath = (projectPath || windowState.projectPath) + '/.learning/agent-session.json';
        if (await exists(sessionPath)) {
          const data = JSON.parse(await readTextFile(sessionPath));
          sessionId = data.session_id || null;
        }
      } catch (e) {
        console.warn('[SlidingWindow] failed to read session, falling back to fresh:', e);
      }

      await window.__TAURI__.core.invoke('generate_chapters', {
        projectPath: projectPath || windowState.projectPath,
        outline: { chapters: mgr.chapters },
        chapterIndices: indices,
        sessionId  // null is fine — Rust passes Option<String>
      });
      console.log('[SlidingWindow] generate_chapters returned', { sessionId: !!sessionId });
    } catch (err) {
      console.error('[SlidingWindow] generate_chapters failed:', err);
    } finally {
      windowState.inFlight = false;
    }
  }

  // ============================================
  // Public API
  // ============================================
  window.LearningProgress = {
    ChapterStatusManager,
    ProgressUI,
    AgentEventBridge,
    GenerationOverlay,
    STATUS_ICONS,
    STATUS_LABELS,

    /**
     * Configure the sliding-window pre-generation size.
     * Must be called BEFORE startGeneration() to take effect.
     * @param {number} totalChapters
     * @param {number} windowSize - how many chapters to pre-generate (default 2)
     */
    setInitialWindow(totalChapters, windowSize) {
      initSlidingWindow(null, totalChapters, windowSize);
    },

    /**
     * Manually trigger the next batch of windowed generations.
     * Unified entry used by first-time generation, resume, chapter completion,
     * and the "继续生成" button.
     */
    triggerNextChapters(projectPath) {
      const mgr = (window.LearningProgress && window.LearningProgress._manager) || null;
      if (!mgr) {
        console.warn('[SlidingWindow] triggerNextChapters called without manager');
        return Promise.resolve();
      }
      // Make sure windowState has up-to-date projectPath + totalChapters
      // (startGeneration normally sets this; resume may bypass it)
      if (projectPath && !windowState.projectPath) {
        windowState.projectPath = projectPath;
      }
      if (!windowState.totalChapters) {
        windowState.totalChapters = mgr.chapters.length;
      }
      return triggerSlidingWindow(mgr, projectPath);
    },

    /**
     * Start generation flow (called from project-manager.js)
     * @param {object} outline - { chapters: [...] }
     * @param {string} projectPath
     */
    startGeneration(outline, projectPath) {
      console.log('[ProgressTracker] startGeneration called, chapters:', outline.chapters?.length, 'path:', projectPath);

      // Point the sidebar file tree to the project directory so new chapters
      // appear as they are generated, and refreshFileTree() on chapter_complete
      // has the correct currentFolder context.
      if (window.TyporaNext && window.TyporaNext.loadFolderPath) {
        window.TyporaNext.loadFolderPath(projectPath);
      }

      const manager = new ChapterStatusManager(outline.chapters);
      const container = document.getElementById('learningProgressPanel');

      const orb = document.getElementById('learningModeOrb');

      if (container) {
        console.log('[ProgressPanel] Found container, initializing UI');
        // During generation, only the centered overlay is visible.
        // The bottom-right panel stays hidden until post-generation (orb click).
        container.style.display = 'none';
        if (orb) orb.style.display = 'none';
        const ui = new ProgressUI(container);
        ui.projectPath = projectPath;
        ui.init(manager);

        // Bind chapter click → open file for reading
        ui.onChapterClick = (index) => {
          const chapter = manager.chapters[index];
          console.log('[ProgressTracker] Chapter clicked:', index, chapter.title, 'file:', chapter.file);
          if (chapter.file) {
            _openChapterFile(chapter.file);
          } else {
            // Fallback: construct expected filename from project path
            const fallbackPath = _guessChapterPath(projectPath, index, chapter.title);
            if (fallbackPath) {
              _openChapterFile(fallbackPath);
            } else {
              alert('章节文件尚未生成，请等待生成完成');
            }
          }
        };

        // Bind "Start Learning" button → open first readable chapter
        ui.onStartLearningClick = () => {
          const firstIndex = manager.chapters.findIndex(ch =>
            ch.status === 'ready' || ch.status === 'completed'
          );
          if (firstIndex >= 0) {
            ui.onChapterClick(firstIndex);
          }
        };

        // Bind "Generate" button → start chapter generation (sliding window)
        ui.onGenerateClick = () => {
          const genBtn = container.querySelector('#learningGenerateBtn');
          if (genBtn) {
            genBtn.disabled = true;
            genBtn.textContent = '生成中...';
          }
          window.LearningProgress.triggerNextChapters(projectPath).then(() => {
            if (genBtn) {
              genBtn.disabled = false;
              genBtn.textContent = '🔄 重新生成';
            }
          }).catch(err => {
            console.error('[ProgressTracker] Sliding window trigger failed:', err);
            if (genBtn) {
              genBtn.disabled = false;
              genBtn.textContent = '🔄 开始生成';
            }
          });
        };

        // Bind "图谱" button → open knowledge graph dashboard
        ui.onOpenDashboard = async () => {
          if (!window.KnowledgeGraphManager || !window.KnowledgeGraphDashboard) return;
          try {
            const kgBtn = container.querySelector('#learningKGBtn');
            const originalText = kgBtn ? kgBtn.textContent : '';
            if (kgBtn) kgBtn.textContent = '⏳ 图谱';

            const kgm = new window.KnowledgeGraphManager(projectPath);
            // Check freshness first — rebuild only if chapters were added.
            const needsRebuild = await kgm.needsRebuild();
            if (needsRebuild) {
              await kgm.buildGraph();
            }
            const graph = await kgm.loadGraph();
            const stats = graph ? kgm.computeStats(graph, null) : { total: 0, mastered: 0, learning: 0, struggling: 0, notStarted: 0 };
            const projectName = projectPath.split(/[/\\]/).pop() || projectPath;
            if (kgBtn) kgBtn.textContent = originalText;
            const dashboard = new window.KnowledgeGraphDashboard({
              onClose: () => dashboard.close()
            });
            dashboard.show({ graph, stats, chapters: manager.chapters, projectName });
          } catch (e) {
            console.warn('[ProgressTracker] Failed to open KG dashboard:', e);
            if (container.querySelector('#learningKGBtn')) {
              container.querySelector('#learningKGBtn').textContent = '🧠 图谱';
            }
          }
        };

        // Bind "Retry" button on a failed chapter — reset to not_generated
        // and re-trigger the sliding window. The sliding window only picks
        // up not_generated chapters, so without this reset a failed chapter
        // would stay failed forever.
        ui.onRetryClick = (index) => {
          console.log(`[ProgressTracker] Retry requested for chapter ${index}`);
          try {
            manager.setStatus(index, 'not_generated');
          } catch (e) {
            console.error('[ProgressTracker] Failed to reset chapter status:', e);
            return;
          }
          if (ui.updateChapter) ui.updateChapter(index);
          window.LearningProgress.triggerNextChapters(projectPath);
        };

        // Sliding window: when a chapter becomes 'completed', enqueue the next
        // unstarted chapter for generation. This is the core of "按需生成" —
        // we never pre-generate more than the next N chapters.
        ui.onChapterStatusChange = (index, prevStatus, newStatus) => {
          console.log(`[ProgressTracker] Chapter ${index}: ${prevStatus} → ${newStatus} rating=${manager.chapters[index].rating}`);
          if (newStatus === 'completed') {
            // Per state matrix: struggling → ❌ 不触发滑窗
            if (manager.chapters[index].rating === 'struggling') {
              console.log('[ProgressTracker] struggling → skip sliding window');
              return;
            }
            // The user just finished a chapter. Slide the window forward.
            window.LearningProgress.triggerNextChapters(projectPath);
          }
        };

        // Enter learning mode
        if (window.TyporaNext && window.TyporaNext.setLearningMode) {
          window.TyporaNext.setLearningMode(true, projectPath);
        }
        // Trigger Agent SDK check now that we're in learning mode
        if (window.TyporaNext && window.TyporaNext.checkAgentSdk) {
          window.TyporaNext.checkAgentSdk();
        }

        // Create centered generation overlay (like init status panel)
        const overlay = new GenerationOverlay(outline.chapters, projectPath);

        const bridge = new AgentEventBridge(manager, ui, overlay);
        bridge.bind();

        // Orb click: if generation still in progress, restore centered overlay;
        // otherwise (post-generation), restore the bottom-right panel.
        if (orb) {
          orb.onclick = () => {
            if (overlay._done) {
              container.style.display = 'flex';
              orb.style.display = 'none';
              ui.render();
            } else {
              overlay.restore();
            }
          };
        }

        // Exit learning mode handler
        ui.onExitLearningClick = () => {
          overlay.hide();
          container.style.display = 'none';
          if (orb) orb.style.display = 'none';
          if (window.TyporaNext) {
            if (window.TyporaNext.setLearningMode) window.TyporaNext.setLearningMode(false);
            if (window.TyporaNext.unloadFolder) window.TyporaNext.unloadFolder();
          }
        };

        // Store references for external access
        this._manager = manager;
        this._ui = ui;
        this._bridge = bridge;

        // Filesystem polling fallback — if an agent-event was missed while
        // the panel was hidden, this brings the UI back in sync with reality.
        startFileSystemPolling(projectPath, manager, ui, bridge);
      } else {
        console.error('[ProgressPanel] Container #learningProgressPanel not found!');
      }

      // Call Rust to start generation — sliding window (first N chapters)
      console.log('[ProgressTracker] Sliding window: triggering initial generation');
      initSlidingWindow(projectPath, outline.chapters?.length || 0, windowState.windowSize);
      window.LearningProgress.triggerNextChapters(projectPath).catch(err => {
        console.error('[ProgressTracker] Initial sliding window trigger failed:', err);
      });
    },

    /**
     * Get current manager (for testing)
     */
    getManager() {
      return this._manager;
    },

    /**
     * Open a chapter file (exposed for project-resume.js)
     */
    openChapterFile: _openChapterFile,

    /**
     * Guess chapter file path from project path (exposed for project-resume.js)
     */
    guessChapterPath: _guessChapterPath
  };

  // ============================================
  // Helpers: open chapter file
  // ============================================
  async function _openChapterFile(filePath) {
    if (!window.__TAURI__) {
      console.warn('[ProgressTracker] Tauri not available, cannot open file');
      return;
    }
    try {
      const { invoke } = window.__TAURI__.core;
      const result = await invoke('open_file', { path: filePath });
      if (result && result.content) {
        // Use TyporaNext global API to open file as a tab
        if (window.TyporaNext && window.TyporaNext.addTab) {
          window.TyporaNext.addTab(result.path, result.content, result.base_dir || '');
        } else {
          console.error('[ProgressTracker] window.TyporaNext.addTab not available');
          alert('文件已读取但无法打开，请检查控制台');
        }
      }
    } catch (err) {
      console.error('[ProgressTracker] Failed to open chapter:', err);
      alert('无法打开章节: ' + err);
    }
  }

  function _guessChapterPath(projectPath, index, title) {
    if (!projectPath) return null;
    // Normalize path separator
    const base = projectPath.replace(/\\/g, '/');
    // Generate filename similar to Rust backend: 00-title.md
    const safeTitle = (title || '')
      .replace(/[^\w一-鿿]/g, '-')
      .replace(/--+/g, '-')
      .replace(/^-|-$/g, '');
    const fileName = `${String(index).padStart(2, '0')}-${safeTitle}.md`;
    return base + '/' + fileName;
  }

  // Export for Node.js testing
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ChapterStatusManager, ProgressUI, AgentEventBridge, STATUS_ICONS, STATUS_LABELS };
  }
})();
