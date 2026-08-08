/**
 * Project Resume - Detect and load existing learning projects
 *
 * On app startup, scans for .learning/project.json in common locations.
 * If found, restores project state and shows progress panel.
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

  const fs = typeof require !== 'undefined' ? require('fs') : null;
  const path = typeof require !== 'undefined' ? require('path') : null;

  // ============================================
  // ProjectDetector (exported for testing)
  // ============================================
  class ProjectDetector {
    constructor(basePath) {
      this.basePath = basePath;
      this.jsonPath = path ? path.join(basePath, '.learning', 'project.json') : basePath + '/.learning/project.json';
    }

      /**
     * Detect if a learning project exists at this path (async, uses Tauri FS)
     * @returns {Promise<object|null>} Project data or null
     */
    detect() {
      // Node.js test environment fallback: synchronous fs
      if (!window.__TAURI__ && fs) {
        try {
          if (!fs.existsSync(this.jsonPath)) return null;
          const data = JSON.parse(fs.readFileSync(this.jsonPath, 'utf-8'));
          if (!data.chapters || !Array.isArray(data.chapters)) return null;
          return data;
        } catch (e) {
          return null;
        }
      }

      // Tauri async path
      return this._detectAsync();
    }

    async _detectAsync() {
      if (!window.__TAURI__) return null;

      try {
        const { exists, readTextFile } = window.__TAURI__.fs;
        const jsonPath = this.basePath + '/.learning/project.json';

        const fileExists = await exists(jsonPath);
        if (!fileExists) return null;

        const content = await readTextFile(jsonPath);
        const data = JSON.parse(content);
        if (!data.chapters || !Array.isArray(data.chapters)) {
          return null;
        }
        return data;
      } catch (e) {
        console.warn('[ProjectResume] detect error:', e);
        return null;
      }
    }

    /**
     * Get chapters that need to be generated (not_generated or failed)
     * @param {object} project
     * @returns {Array}
     */
    getChaptersToGenerate(project) {
      if (!project || !project.chapters) return [];
      const cs = project.chapters_status || {};
      return project.chapters.filter(ch => {
        const s = getChapterStatus(ch, cs);
        return s === '未生成' || s === '失败' || s === 'failed' || s === 'not_generated';
      });
    }

    /**
     * Get the project path
     * @returns {string}
     */
    getPath() {
      return this.jsonPath;
    }
  }

  // ============================================
  // Helpers
  // ============================================
  /**
   * Read chapter status from project.chapters_status[file] map.
   * v2 schema: chapter status is at top level, not on the chapter object.
   * @param {Object} ch - { file, title, ... }
   * @param {Object} chaptersStatus - project.chapters_status map
   * @returns {string}
   */
  function getChapterStatus(ch, chaptersStatus) {
    if (!ch) return 'not_generated';
    if (chaptersStatus) {
      if (ch.file && chaptersStatus[ch.file]) return chaptersStatus[ch.file];
    }
    // Fallback to legacy ch.status for backwards compatibility (tests, old project.json).
    return ch.status || 'not_generated';
  }

  /**
   * Read quiz-history.json and build a { chapterFile: rating } map,
   * using the MOST RECENT entry per chapter (entries are appended in order).
   * Used to restore chapter rating badges + gate sliding window on resume.
   * @param {string} basePath - project root
   * @returns {Promise<Object>} { "01-foo.md": "mastered", ... }
   */
  async function _loadChapterRatings(basePath) {
    if (!window.__TAURI__ || !window.__TAURI__.fs) return {};
    try {
      const { exists, readTextFile } = window.__TAURI__.fs;
      const histPath = basePath.replace(/[\\/]+$/, '') + '/.learning/quiz-history.json';
      if (!await exists(histPath)) return {};
      const data = JSON.parse(await readTextFile(histPath));
      const entries = (data && data.entries) || [];
      const ratings = {};
      for (const e of entries) {
        const f = e.chapter_file || '';
        if (!f) continue;
        // Last entry wins (most recent), matching append order
        ratings[f] = e.rating || null;
      }
      return ratings;
    } catch (e) {
      console.warn('[ProjectResume] _loadChapterRatings failed:', e);
      return {};
    }
  }

  // ============================================
  // Auto-detect on startup
  // ============================================
  /**
   * Load a specific project by path
   * Called from LearningHub when user clicks a project
   */
  async function loadProject(path) {
    if (!window.__TAURI__) return null;

    try {
      const detector = new ProjectDetector(path);
      const project = await detector.detect();
      if (project) {
        console.log('[ProjectResume] Loaded project:', project.name, 'chapters:', project.chapters.length);

        // Sync actual file status with project.json (files may have been generated externally)
        await syncProjectStatus(project, path);

        // Load file tree in sidebar
        if (window.TyporaNext && window.TyporaNext.loadFolderPath) {
          window.TyporaNext.loadFolderPath(path);
        }

        // Auto-show KG dashboard on entry (builds graph if needed)
        showProjectDashboard(project, path).catch(e =>
          console.warn('[ProjectDashboard] Error:', e)
        );

        // Pre-fetch chapter ratings from quiz-history.json so loadProjectUI
        // can restore struggling/learning/mastered badges + gate sliding window.
        // v2 schema: rating is NOT on chapter, must derive from quiz-history.
        project._ratingsByFile = await _loadChapterRatings(path);

        await loadProjectUI(project, path);
        return project;
      }
    } catch (e) {
      console.error('[ProjectResume] Error loading project:', e);
    }
    return null;
  }

  /**
   * Sync project.json chapter statuses with actual files on disk.
   * If a .md file exists but status is 'not_generated', mark as 'ready'.
   * v2: writes to project.chapters_status[file], not project.chapters[i].status.
   */
  async function syncProjectStatus(project, basePath) {
    if (!window.__TAURI__) return;

    try {
      const { exists, writeTextFile } = window.__TAURI__.fs;
      let modified = false;
      const normalizedBase = basePath.replace(/\\/g, '/');

      // Ensure chapters_status map exists
      if (!project.chapters_status) project.chapters_status = {};

      for (let i = 0; i < project.chapters.length; i++) {
        const ch = project.chapters[i];
        const currentStatus = getChapterStatus(ch, project.chapters_status);
        const isNotGenerated = currentStatus === 'not_generated' || currentStatus === '未生成';

        // Case 1: not_generated chapter — file may exist on disk (generated externally)
        // Case 2: generated chapter but file field is null (Rust never回写 chapters[i].file)
        //         → try to match the file by guessed name and backfill ch.file
        if (isNotGenerated) {
          // Determine possible file path
          let filePath = null;
          if (ch.file) {
            filePath = normalizedBase + '/' + ch.file;
          } else {
            // Guess filename using same logic as agent-bridge.js
            const safeTitle = (ch.title || '')
              .replace(/[^\w一-龥]/g, '-')
              .replace(/--+/g, '-')
              .replace(/^-|-$/g, '');
            const guessedFile = `${String(i).padStart(2, '0')}-${safeTitle}.md`;
            filePath = normalizedBase + '/' + guessedFile;
          }

          if (filePath && await exists(filePath)) {
            console.log('[ProjectResume] File exists, marking as ready:', filePath);
            const basename = filePath.split('/').pop();
            // Write to top-level chapters_status (v2 schema)
            project.chapters_status[basename] = 'ready';
            if (!ch.file) {
              ch.file = basename;
            }
            modified = true;
          }
        } else if (!ch.file) {
          // Generated chapter with null file field — backfill from guessed name
          const safeTitle = (ch.title || '')
            .replace(/[^\w一-龥]/g, '-')
            .replace(/--+/g, '-')
            .replace(/^-|-$/g, '');
          const guessedFile = `${String(i).padStart(2, '0')}-${safeTitle}.md`;
          const filePath = normalizedBase + '/' + guessedFile;
          if (await exists(filePath)) {
            console.log('[ProjectResume] Backfilling file for chapter', i, ':', guessedFile);
            ch.file = guessedFile;
            modified = true;
          }
        }
      }

      // Clean up legacy dirty keys in chapters_status — early code wrote
      // chapter titles (without .md) as keys. Keep only keys that end with .md
      // (the canonical basename form) OR match a known chapter file.
      if (project.chapters_status) {
        const validFiles = new Set(
          project.chapters.map(ch => ch.file).filter(f => f && f.endsWith('.md'))
        );
        for (const key of Object.keys(project.chapters_status)) {
          if (!key.endsWith('.md') && !validFiles.has(key)) {
            console.log('[ProjectResume] Removing dirty chapters_status key:', key);
            delete project.chapters_status[key];
            modified = true;
          }
        }
      }

      if (modified) {
        const jsonPath = normalizedBase + '/.learning/project.json';
        await writeTextFile(jsonPath, JSON.stringify(project, null, 2));
        console.log('[ProjectResume] Updated project.json with synced statuses');
      }
    } catch (e) {
      console.warn('[ProjectResume] syncProjectStatus error:', e);
    }
  }

  /**
   * Show knowledge graph dashboard modal for a project.
   * Loads graph data (builds if needed), computes stats, shows modal.
   * Returns a promise that resolves when the user closes the modal or clicks "进入阅读".
   */
  // Guard: prevent re-entrance when both auto-show (line 125) and button click
  // call showProjectDashboard simultaneously.
  let _showProjectDashboardBusy = false;

  async function showProjectDashboard(project, basePath) {
    // Compatibility: called as showProjectDashboard(basePath) from review-summary-modal
    if (typeof project === 'string' && !basePath) {
      basePath = project;
      project = null;
    }
    console.log('[ProjectDashboard] showProjectDashboard called, basePath:', basePath, 'modules:',
      !!window.KnowledgeGraphManager, !!window.KnowledgeGraphDashboard);
    if (!window.KnowledgeGraphManager || !window.KnowledgeGraphDashboard) {
      console.warn('[ProjectDashboard] Modules not loaded, skipping');
      return;
    }
    if (_showProjectDashboardBusy) {
      console.log('[ProjectDashboard] Already busy, skipping duplicate call');
      return;
    }

    try {
      _showProjectDashboardBusy = true;
      const kgm = new window.KnowledgeGraphManager(basePath);

      // Check if graph needs rebuild
      console.log('[ProjectDashboard] Checking freshness...');
      const needsRebuild = await kgm.needsRebuild();
      console.log('[ProjectDashboard] needsRebuild:', needsRebuild);
      if (needsRebuild) {
        console.log('[ProjectDashboard] Building graph...');
        await kgm.buildGraph();
      }

      // Load graph
      console.log('[ProjectDashboard] Loading graph...');
      const graph = await kgm.loadGraph();
      console.log('[ProjectDashboard] Graph loaded:', graph ? graph.nodes.length + ' nodes' : 'null');

      // Get today's due review count (project-level)
      let dueCount = 0;
      try {
        if (window.ReviewScheduler) {
          const scheduler = new window.ReviewScheduler();
          const dueItems = await scheduler.getDueItems(basePath);
          dueCount = (dueItems || []).length;
          console.log('[ProjectDashboard] due review items:', dueCount);
        }
      } catch (e) {
        console.warn('[ProjectDashboard] failed to get due items:', e);
      }

      // Knowledge graph nodes already carry node_status. No merge needed.
      let mergedGraph = graph;
      let stats = null;
      if (graph) {
        stats = kgm.computeStats(graph);
        mergedGraph = kgm.mergeReviewStatus(graph);
      }

      // Build chapters list from project
      const chaptersStatus = (project && project.chapters_status) || {};
      const chapters = ((project && project.chapters) || []).map((ch, i) => ({
        file: ch.file || '',
        title: ch.title || ('第' + (i + 1) + '章'),
        status: getChapterStatus(ch, chaptersStatus)
      }));

      // Show dashboard modal
      console.log('[ProjectDashboard] Showing dashboard, stats:', stats);
      return new Promise((resolve) => {
        const dashboard = new window.KnowledgeGraphDashboard({
          onEnterReading: () => {
            dashboard.close();
            resolve();
          },
          onClose: () => {
            resolve();
          },
          onReview: () => {
            dashboard.close();
            if (window.LearningModeIntegration && window.LearningModeIntegration.checkAndShowDailyReview) {
              window.LearningModeIntegration.checkAndShowDailyReview(basePath);
            } else {
              console.warn('[ProjectDashboard] LearningModeIntegration not ready');
            }
          }
        });
        dashboard.show({
          graph: mergedGraph,
          stats,
          chapters,
          projectName: (project && project.name) || '学习项目',
          dueCount
        });
      });
    } catch (e) {
      console.warn('[ProjectResume] showProjectDashboard error:', e);
      if (window.showToast) {
        window.showToast('❌ ' + (e.message || String(e)), 'error');
      }
    } finally {
      _showProjectDashboardBusy = false;
    }
  }

  /**
   * Load project into UI - show progress panel with existing state
   */
  async function loadProjectUI(project, basePath) {
    // Set up progress tracker with existing project
    if (window.LearningProgress) {
      const { ChapterStatusManager, ProgressUI, AgentEventBridge } = window.LearningProgress;

      const manager = new ChapterStatusManager(project.chapters);
      // Restore actual statuses AND file paths from project.json.
      // v2 schema: chapter status is in project.chapters_status[file], not on chapter.
      const cs = project.chapters_status || {};
      const ratingsByFile = project._ratingsByFile || {};
      // Map Chinese status names to English
      const statusMap = {
        '已完成': 'completed', '完成': 'completed',
        '就绪': 'ready',
        '生成中': 'generating',
        '失败': 'failed',
        '未生成': 'not_generated'
      };
      project.chapters.forEach((ch, i) => {
        const statusFromMap = getChapterStatus(ch, cs);
        if (statusFromMap && statusFromMap !== 'not_generated' && statusFromMap !== '未生成') {
          const engStatus = statusMap[statusFromMap] || statusFromMap;
          try {
            // Set directly (bypass transition validation for restore)
            manager.chapters[i].status = engStatus;
          } catch (e) {
            console.warn('[ProjectResume] Failed to restore status for chapter', i, e);
          }
        }
        // Restore the on-disk file path so chapter.file lookups work after
        // resume. Store the FULL path (basePath + filename) so _openChapterFile
        // can find the file via Rust's open_file command.
        if (ch.file) {
          const sep = basePath.includes('\\') ? '\\' : '/';
          const cleanedBase = basePath.replace(/[\\/]+$/, '');
          const cleanedFile = ch.file.replace(/^[\\/]+/, '');
          manager.chapters[i].file = cleanedBase + sep + cleanedFile;
        }
        // Restore rating from quiz-history (v2 schema: rating not on chapter).
        // Needed for struggling→block-sliding-window logic + rating badges.
        if (ch.file && ratingsByFile[ch.file]) {
          manager.chapters[i].rating = ratingsByFile[ch.file];
        }
      });

      // Post-restore: trigger sliding window to fill any gaps
      // (restored statuses bypass onChapterStatusChange, so completed chapters
      // from a previous session won't auto-trigger next-chapter generation)
      //
      // Per state matrix (decisions.md 课程模式状态机):
      //   resume + 有 completed(struggling) 章节 → ❌ 不自动滑窗
      //   resume + 全部 completed(mastered/learning) → ✅ 可生成
      const _postTrigger = window.LearningProgress && window.LearningProgress.triggerNextChapters;
      const hasPending = manager.chapters.some(ch => ch.status === 'not_generated');
      const hasStruggling = manager.chapters.some(ch =>
        ch.status === 'completed' && ch.rating === 'struggling'
      );
      if (_postTrigger && hasPending && !hasStruggling) {
        setTimeout(() => {
          _postTrigger(basePath).catch(err =>
            console.warn('[ProjectResume] post-restore triggerNextChapters:', err)
          );
        }, 500);
      } else if (hasStruggling) {
        console.log('[ProjectResume] struggling chapter found → skip auto sliding window');
      }

      const container = document.getElementById('learningProgressPanel');
      const orb = document.getElementById('learningModeOrb');
      if (container) {
        container.style.display = 'flex';
        if (orb) orb.style.display = 'none';
        const ui = new ProgressUI(container);
        ui.projectPath = basePath;
        ui.init(manager);

        // Create centered generation overlay (hidden until user clicks
        // "继续生成"). Passed to AgentEventBridge so progress_log events
        // appear when generation runs.
        const GenOverlay = window.LearningProgress && window.LearningProgress.GenerationOverlay;
        const overlay = GenOverlay ? new GenOverlay(project.chapters, basePath) : null;
        if (overlay) overlay.hide();

        // State matrix: "继续生成" button conditions.
        //   Row 3: not_generated→resume + 全部 completed(mastered/learning) → ✅
        //   Row 8: completed→resume + 全部 completed/failed → ✅
        //   Row 2/7: 有 ready 或 completed(struggling) → ❌
        const hasAdvanceable = manager.chapters.some(ch =>
          ch.status === 'completed' && (!ch.rating || ch.rating !== 'struggling')
        );
        const hasStuck = manager.chapters.some(ch =>
          ch.status === 'ready' ||
          (ch.status === 'completed' && ch.rating === 'struggling')
        );
        const hasPending = manager.chapters.some(ch => ch.status === 'not_generated');
        if (hasAdvanceable && !hasStuck && hasPending) {
          const genContainer = container.querySelector('.learning-chapter-list');
          if (genContainer && !container.querySelector('.learning-resume-gen-btn')) {
            const resumeBtn = document.createElement('button');
            resumeBtn.className = 'learning-resume-gen-btn';
            const pendingCount = manager.chapters.filter(ch => ch.status === 'not_generated').length;
            resumeBtn.textContent = '📦 继续生成 (' + pendingCount + ' 章待生成)';
            resumeBtn.addEventListener('click', () => {
              resumeBtn.disabled = true;
              resumeBtn.textContent = '生成中...';
              if (overlay) overlay.restore();
              const triggerNext = window.LearningProgress && window.LearningProgress.triggerNextChapters;
              if (triggerNext) {
                triggerNext(basePath).catch(err => {
                  console.error('[ProjectResume] triggerNextChapters failed:', err);
                  resumeBtn.disabled = false;
                  resumeBtn.textContent = '📦 继续生成 (' + pendingCount + ' 章待生成)';
                  if (overlay) overlay.hide();
                });
              }
            });
            genContainer.after(resumeBtn);
          }
        }

        // Bind chapter click → open file for reading
        ui.onChapterClick = (index) => {
          const chapter = manager.chapters[index];
          console.log('[ProjectResume] Chapter clicked:', index, chapter.title, 'file:', chapter.file);
          const openFile = window.LearningProgress && window.LearningProgress.openChapterFile;
          const guessPath = window.LearningProgress && window.LearningProgress.guessChapterPath;
          if (chapter.file && openFile) {
            openFile(chapter.file);
          } else if (guessPath) {
            const fallbackPath = guessPath(basePath, index, chapter.title);
            if (fallbackPath) {
              openFile(fallbackPath);
            } else {
              alert('章节文件尚未生成，请等待生成完成');
            }
          }
        };

        // Bind "Start Learning" button → open first unfinished (ready) chapter
        ui.onStartLearningClick = () => {
          const firstReady = manager.chapters.findIndex(ch => ch.status === 'ready');
          if (firstReady >= 0) {
            ui.onChapterClick(firstReady);
            return;
          }
          // All completed: open the last completed (most recently studied)
          for (let i = manager.chapters.length - 1; i >= 0; i--) {
            if (manager.chapters[i].status === 'completed') {
              ui.onChapterClick(i);
              return;
            }
          }
        };

        // Sliding window: when a chapter becomes 'completed', enqueue the next
        // unstarted chapter for generation. Same hook as progress-tracker.js
        // so resume benefits from the same window logic.
        ui.onChapterStatusChange = (index, prevStatus, newStatus) => {
          if (newStatus === 'completed') {
            // Per state matrix: struggling → ❌ 不触发滑窗
            if (manager.chapters[index].rating === 'struggling') {
              console.log('[ProjectResume] struggling → skip sliding window');
              return;
            }
            const triggerNext = window.LearningProgress && window.LearningProgress.triggerNextChapters;
            if (triggerNext) {
              triggerNext(basePath);
            }
            // Course completion → show summary button + offer slide summary (once)
            if (window.CourseSummary && window.CourseSummary.isCourseCompleted(manager)) {
              ui.render();
              window.CourseSummary.maybeOfferSummary(basePath, manager);
            }
          }
        };

        // Bind "Generate" button → start chapter generation (sliding window)
        ui.onGenerateClick = () => {
          const genBtn = container.querySelector('#learningGenerateBtn');
          if (genBtn) {
            genBtn.disabled = true;
            genBtn.textContent = '生成中...';
          }
          const triggerNext = window.LearningProgress && window.LearningProgress.triggerNextChapters;
          if (triggerNext) {
            triggerNext({ chapters: project.chapters }, basePath)
              .catch(err => {
                console.error('[ProjectResume] Failed to start generation:', err);
                if (genBtn) {
                  genBtn.disabled = false;
                  genBtn.textContent = '🔄 开始生成';
                }
              });
          }
        };

        // Enter learning mode
        if (window.TyporaNext && window.TyporaNext.setLearningMode) {
          await window.TyporaNext.setLearningMode(true, basePath);
        }
        // Trigger Agent SDK check now that we're in learning mode
        if (window.TyporaNext && window.TyporaNext.checkAgentSdk) {
          window.TyporaNext.checkAgentSdk();
        }

        const bridge = new AgentEventBridge(manager, ui, overlay);
        bridge.bind();

        // Stash manager/ui on the global so triggerSlidingWindow() (called
        // from triggerNextChapters below, and from the onChapterStatusChange
        // hook) can locate them without re-deriving. In startGeneration this
        // is done automatically; resume bypasses startGeneration.
        if (window.LearningProgress) {
          window.LearningProgress._manager = manager;
          window.LearningProgress._ui = ui;
          window.LearningProgress._bridge = bridge;
        }

        // Click outside to close panel → show orb
        const onClickOutside = (e) => {
          if (!container.contains(e.target) && !orb.contains(e.target)) {
            container.style.display = 'none';
            if (orb) orb.style.display = 'flex';
            document.removeEventListener('click', onClickOutside);
          }
        };
        setTimeout(() => {
          document.addEventListener('click', onClickOutside);
        }, 100);

        // Orb click → restore panel
        if (orb) {
          orb.onclick = () => {
            container.style.display = 'flex';
            orb.style.display = 'none';
          };
        }

        // Knowledge graph dashboard button — direct open without rebuild
        // check (auto-show at project entry handles the initial graph build).
        // This just loads the existing graph file and opens the modal.
        ui.onOpenDashboard = async () => {
          const btn = container.querySelector('#learningKGBtn');
          if (btn) btn.textContent = '⏳ 图谱';
          try {
            if (!window.KnowledgeGraphManager || !window.KnowledgeGraphDashboard) {
              console.warn('[ProjectResume] KG modules not loaded');
              return;
            }
            const kgm = new window.KnowledgeGraphManager(basePath);
            let graph = await kgm.loadGraph();
            // If no graph exists yet, wait a moment then force rebuild
            if (!graph) {
              await new Promise(r => setTimeout(r, 2000));
              graph = await kgm.loadGraph();
            }
            if (!graph) {
              await kgm.buildGraph();
              graph = await kgm.loadGraph();
            }
            const stats = graph ? kgm.computeStats(graph) : null;
            const mergedGraph = graph ? kgm.mergeReviewStatus(graph) : graph;
            const chaptersStatus = (project && project.chapters_status) || {};
            const chapters = (project && project.chapters || []).map((ch, i) => ({
              file: ch.file || '',
              title: ch.title || '第' + (i + 1) + '章',
              status: (ch.file && chaptersStatus[ch.file]) || 'not_generated'
            }));

            // Compute today's due review count for project-level entry
            let dueCount = 0;
            try {
              if (window.ReviewScheduler) {
                const scheduler = new window.ReviewScheduler();
                const dueItems = await scheduler.getDueItems(basePath);
                dueCount = (dueItems || []).length;
              }
            } catch (e) {
              console.warn('[ProjectResume] failed to get due items for dashboard:', e);
            }

            const dashboard = new window.KnowledgeGraphDashboard({
              onClose: () => dashboard.close(),
              onReview: () => {
                dashboard.close();
                if (window.LearningModeIntegration && window.LearningModeIntegration.checkAndShowDailyReview) {
                  window.LearningModeIntegration.checkAndShowDailyReview(basePath);
                }
              }
            });
            dashboard.show({
              graph: mergedGraph,
              stats,
              chapters,
              projectName: (project && project.name) || '学习项目',
              dueCount
            });
          } catch (e) {
            console.error('[ProjectResume] KG open error:', e);
            if (window.showToast) {
              window.showToast('❌ 知识图谱加载失败', 'error');
            }
          } finally {
            if (btn) btn.textContent = '🧠 图谱';
          }
        };

        // Exit learning mode handler
        ui.onExitLearningClick = async () => {
          container.style.display = 'none';
          if (orb) orb.style.display = 'none';
          document.removeEventListener('click', onClickOutside);
          if (window.TyporaNext) {
            if (window.TyporaNext.setLearningMode) await window.TyporaNext.setLearningMode(false);
            if (window.TyporaNext.unloadFolder) window.TyporaNext.unloadFolder();
          }
        };

        // Store references
        window.LearningProgress._manager = manager;
        window.LearningProgress._ui = ui;
        window.LearningProgress._bridge = bridge;
      }
    }
  }

  /**
   * Add a "继续生成" button to the progress panel
   */
  function addResumeButton(container, project, basePath, manager, ui) {
    const existingBtn = container.querySelector('.learning-resume-btn');
    if (existingBtn) return;

    const btn = document.createElement('button');
    btn.className = 'learning-resume-btn';
    btn.textContent = '继续生成';
    btn.style.cssText = `
      margin: 8px 16px;
      padding: 8px 16px;
      background: #4f46e5;
      color: white;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-size: 13px;
      font-weight: 500;
    `;
    btn.addEventListener('click', () => {
      btn.disabled = true;
      btn.textContent = '生成中...';

      // Sliding window: only generate the next pending chapters
      const triggerNext = window.LearningProgress && window.LearningProgress.triggerNextChapters;
      if (triggerNext) {
        console.log('[ProjectResume] Calling triggerNextChapters (sliding window)...');
        triggerNext({ chapters: project.chapters }, basePath)
          .then(() => {
            console.log('[ProjectResume] triggerNextChapters returned OK');
          })
          .catch(err => {
            console.error('[ProjectResume] Failed:', err);
            btn.disabled = false;
            btn.textContent = '继续生成';
          });
      }
    });

    // Insert before chapter list
    const chapterList = container.querySelector('.learning-chapter-list') || document.getElementById('learningChapterList');
    if (chapterList) {
      container.insertBefore(btn, chapterList);
    } else {
      container.appendChild(btn);
    }
  }

  // ============================================
  // Public API
  // ============================================
  window.LearningProjectResume = {
    ProjectDetector,
    loadProject,
    loadProjectUI,
    showDashboard: showProjectDashboard
  };

  // Export for Node.js testing
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ProjectDetector };
  }
})();
