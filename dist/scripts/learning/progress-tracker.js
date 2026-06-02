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
    'failed': ['generating']
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
        file: null
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
              this.setChapterFile(event.data.index, event.data.file);
            }
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
            <button class="learning-exit-btn" id="learningExitBtn" title="退出学习模式">退出</button>
            <button class="learning-progress-close-btn" id="learningProgressClose">×</button>
          </div>
        </div>
        <div class="learning-progress-bar">
          <div class="learning-progress-fill" style="width: ${pct}%"></div>
          <span class="learning-progress-text">${progress.completed}/${progress.total} 章已完成</span>
        </div>
        <div class="learning-chapter-list">
          ${this.manager.chapters.map((ch, i) => this._renderChapterItem(ch, i)).join('')}
        </div>
      `;

      this._bindEvents();
    }

    /**
     * Render a single chapter item
     */
    _renderChapterItem(chapter, index) {
      const icon = STATUS_ICONS[chapter.status] || '⚪';
      const label = STATUS_LABELS[chapter.status] || '';
      const clickable = chapter.status === 'ready' || chapter.status === 'completed';
      const retryable = chapter.status === 'failed';
      const generating = chapter.status === 'generating';

      return `
        <div class="learning-chapter-item ${clickable ? 'clickable' : ''} ${retryable ? 'retryable' : ''} ${generating ? 'generating' : ''}"
             data-index="${index}" data-status="${chapter.status}">
          <span class="learning-chapter-icon">${icon}</span>
          <span class="learning-chapter-title">${this._escapeHtml(chapter.title)}</span>
          <span class="learning-chapter-label">${label}</span>
          ${retryable ? '<button class="learning-retry-btn" data-index="' + index + '">重试</button>' : ''}
        </div>
      `;
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
      const icon = STATUS_ICONS[chapter.status];
      const label = STATUS_LABELS[chapter.status];

      el.querySelector('.learning-chapter-icon').textContent = icon;
      el.querySelector('.learning-chapter-label').textContent = label;
      el.dataset.status = chapter.status;

      // Update clickability
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
    constructor(manager, ui) {
      this.manager = manager;
      this.ui = ui;
      this._bound = false;
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
      } else if (payload.type === 'chapter_complete' && typeof payload.data.index === 'number') {
        this.ui.updateChapter(payload.data.index);
      } else if (payload.type === 'chapter_failed' && typeof payload.data.index === 'number') {
        this.ui.updateChapter(payload.data.index);
      } else if (payload.type === 'complete') {
        this.ui.render();
      }
    }
  }

  // ============================================
  // Public API
  // ============================================
  window.LearningProgress = {
    ChapterStatusManager,
    ProgressUI,
    AgentEventBridge,
    STATUS_ICONS,
    STATUS_LABELS,

    /**
     * Start generation flow (called from project-manager.js)
     * @param {object} outline - { chapters: [...] }
     * @param {string} projectPath
     */
    startGeneration(outline, projectPath) {
      console.log('[ProgressTracker] startGeneration called, chapters:', outline.chapters?.length, 'path:', projectPath);
      const manager = new ChapterStatusManager(outline.chapters);
      const container = document.getElementById('learningProgressPanel');

      const orb = document.getElementById('learningModeOrb');

      if (container) {
        console.log('[ProgressPanel] Found container, initializing UI');
        container.style.display = 'flex';
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

        // Bind "Generate" button → start chapter generation
        ui.onGenerateClick = () => {
          const genBtn = container.querySelector('#learningGenerateBtn');
          if (genBtn) {
            genBtn.disabled = true;
            genBtn.textContent = '生成中...';
          }
          if (window.__TAURI__) {
            const { invoke } = window.__TAURI__.core;
            invoke('generate_chapters', {
              projectPath,
              outline: { chapters: manager.chapters }
            }).catch(err => {
              console.error('[ProgressTracker] Failed to start generation:', err);
              if (genBtn) {
                genBtn.disabled = false;
                genBtn.textContent = '🔄 开始生成';
              }
            });
          }
        };

        // Enter learning mode
        if (window.TyporaNext && window.TyporaNext.setLearningMode) {
          window.TyporaNext.setLearningMode(true);
        }

        const bridge = new AgentEventBridge(manager, ui);
        bridge.bind();

        // Click outside to close panel → show orb
        const onClickOutside = (e) => {
          if (!container.contains(e.target) && !orb.contains(e.target)) {
            container.style.display = 'none';
            orb.style.display = 'flex';
            document.removeEventListener('click', onClickOutside);
          }
        };
        // Delay to avoid immediate close from the same click that opened it
        setTimeout(() => {
          document.addEventListener('click', onClickOutside);
        }, 100);

        // Exit learning mode handler
        ui.onExitLearningClick = () => {
          container.style.display = 'none';
          if (orb) orb.style.display = 'none';
          document.removeEventListener('click', onClickOutside);
          if (window.TyporaNext) {
            if (window.TyporaNext.setLearningMode) window.TyporaNext.setLearningMode(false);
            if (window.TyporaNext.unloadFolder) window.TyporaNext.unloadFolder();
          }
        };

        // Orb click → restore panel
        if (orb) {
          orb.onclick = () => {
            container.style.display = 'flex';
            orb.style.display = 'none';
          };
        }

        // Store references for external access
        this._manager = manager;
        this._ui = ui;
        this._bridge = bridge;
      } else {
        console.error('[ProgressPanel] Container #learningProgressPanel not found!');
      }

      // Call Rust to start generation
      if (window.__TAURI__) {
        const { invoke } = window.__TAURI__.core;
        console.log('[ProgressTracker] Calling generate_chapters...');
        invoke('generate_chapters', {
          projectPath,
          outline
        }).then(() => {
          console.log('[ProgressTracker] generate_chapters invoke returned OK');
        }).catch(err => {
          console.error('[ProgressTracker] Failed to start generation:', err);
        });
      } else {
        console.error('[ProgressTracker] No Tauri available');
      }
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
