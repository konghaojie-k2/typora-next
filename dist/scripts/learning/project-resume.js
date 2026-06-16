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
      return project.chapters.filter(ch =>
        ch.status === '未生成' || ch.status === '失败' || ch.status === 'failed' || ch.status === 'not_generated'
      );
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

        loadProjectUI(project, path);
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
   */
  async function syncProjectStatus(project, basePath) {
    if (!window.__TAURI__) return;

    try {
      const { exists, writeTextFile } = window.__TAURI__.fs;
      let modified = false;
      const normalizedBase = basePath.replace(/\\/g, '/');

      for (let i = 0; i < project.chapters.length; i++) {
        const ch = project.chapters[i];
        const isNotGenerated = ch.status === 'not_generated' || ch.status === '未生成';
        if (!isNotGenerated) continue;

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
          project.chapters[i].status = 'ready';
          if (!project.chapters[i].file) {
            project.chapters[i].file = filePath.split('/').pop();
          }
          modified = true;
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

      // Load review schedule
      let reviewSchedule = null;
      if (window.__TAURI__) {
        try {
          const { exists, readTextFile } = window.__TAURI__.fs;
          const schedulePath = basePath + '/.learning/review-schedule.json';
          if (await exists(schedulePath)) {
            reviewSchedule = JSON.parse(await readTextFile(schedulePath));
          }
        } catch (e) {
          // no schedule yet, that's fine
        }
      }

      // Compute stats and merge status
      let mergedGraph = graph;
      let stats = null;
      if (graph) {
        stats = kgm.computeStats(graph, reviewSchedule);
        mergedGraph = kgm.mergeReviewStatus(graph, reviewSchedule);
      }

      // Build chapters list from project
      const chapters = ((project && project.chapters) || []).map((ch, i) => ({
        file: ch.file || '',
        title: ch.title || ('第' + (i + 1) + '章'),
        status: ch.status || 'not_generated'
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
          }
        });
        dashboard.show({
          graph: mergedGraph,
          stats,
          chapters,
          projectName: (project && project.name) || '学习项目'
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
  function loadProjectUI(project, basePath) {
    // Set up progress tracker with existing project
    if (window.LearningProgress) {
      const { ChapterStatusManager, ProgressUI, AgentEventBridge } = window.LearningProgress;

      const manager = new ChapterStatusManager(project.chapters);
      // Restore actual statuses from project.json
      project.chapters.forEach((ch, i) => {
        if (ch.status && ch.status !== 'not_generated' && ch.status !== '未生成') {
          // Map Chinese status names to English
          const statusMap = {
            '已完成': 'completed', '完成': 'completed',
            '就绪': 'ready',
            '生成中': 'generating',
            '失败': 'failed',
            '未生成': 'not_generated'
          };
          const engStatus = statusMap[ch.status] || ch.status;
          try {
            // Set directly (bypass transition validation for restore)
            manager.chapters[i].status = engStatus;
          } catch (e) {
            console.warn('[ProjectResume] Failed to restore status for chapter', i, e);
          }
        }
      });

      const container = document.getElementById('learningProgressPanel');
      const orb = document.getElementById('learningModeOrb');
      if (container) {
        container.style.display = 'flex';
        if (orb) orb.style.display = 'none';
        const ui = new ProgressUI(container);
        ui.projectPath = basePath;
        ui.init(manager);

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
            const triggerNext = window.LearningProgress && window.LearningProgress.triggerNextChapters;
            if (triggerNext) {
              triggerNext({ chapters: project.chapters }, basePath);
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
          window.TyporaNext.setLearningMode(true, basePath);
        }

        const bridge = new AgentEventBridge(manager, ui);
        bridge.bind();

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
            const stats = graph ? kgm.computeStats(graph, null) : null;
            const chapters = (project && project.chapters || []).map((ch, i) => ({
              file: ch.file || '',
              title: ch.title || '第' + (i + 1) + '章',
              status: ch.status || 'not_generated'
            }));
            const dashboard = new window.KnowledgeGraphDashboard({
              onClose: () => dashboard.close()
            });
            dashboard.show({
              graph,
              stats,
              chapters,
              projectName: (project && project.name) || '学习项目'
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
        ui.onExitLearningClick = () => {
          container.style.display = 'none';
          if (orb) orb.style.display = 'none';
          document.removeEventListener('click', onClickOutside);
          if (window.TyporaNext) {
            if (window.TyporaNext.setLearningMode) window.TyporaNext.setLearningMode(false);
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
