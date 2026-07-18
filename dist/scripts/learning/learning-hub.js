/**
 * Learning Hub - Project List Management
 * Central entry point for learning mode: shows existing projects, create new ones
 */

(function() {
  'use strict';

  // ============================================
  // ProjectList (exported for testing)
  // ============================================
  // Default config path: ~/.typora-next/learning-projects.json
  const DEFAULT_CONFIG_DIR = '.typora-next';
  const CONFIG_FILE = 'learning-projects.json';

  class ProjectList {
    constructor(filePath) {
      this.projects = [];
      this.filePath = filePath || null;
    }

    /**
     * Initialize the config path (call once on startup)
     */
    async initPath() {
      if (this.filePath) return;
      if (!window.__TAURI__) return;

      try {
        const homeDir = await window.__TAURI__.path.homeDir();
        // Normalize backslashes to forward slashes for consistent path handling
        const normalized = homeDir.replace(/\\/g, '/').replace(/\/+$/, '');
        this.filePath = normalized + '/' + DEFAULT_CONFIG_DIR + '/' + CONFIG_FILE;
      } catch (e) {
        console.warn('[LearningHub] Failed to get home dir:', e);
      }
    }

    getAll() {
      return this.projects.map(p => ({
        ...p,
        progress: p.chapters > 0 ? Math.round(p.completed / p.chapters * 100) : 0
      }));
    }

    add(project) {
      const existing = this.projects.findIndex(p => p.path === project.path);
      if (existing >= 0) {
        this.projects[existing] = { ...this.projects[existing], ...project };
      } else {
        this.projects.push({ ...project, created: new Date().toISOString() });
      }
    }

    remove(path) {
      this.projects = this.projects.filter(p => p.path !== path);
    }

    get(path) {
      const p = this.projects.find(p => p.path === path);
      return p ? {
        ...p,
        progress: p.chapters > 0 ? Math.round(p.completed / p.chapters * 100) : 0
      } : null;
    }

    async save() {
      if (!this.filePath || !window.__TAURI__) return;

      try {
        const { writeTextFile, mkdir } = window.__TAURI__.fs;
        // Ensure parent directory exists (normalize backslashes for Windows)
        const normalizedPath = this.filePath.replace(/\\/g, '/');
        const dir = normalizedPath.substring(0, normalizedPath.lastIndexOf('/'));
        await mkdir(dir, { recursive: true });
        await writeTextFile(this.filePath, JSON.stringify(this.projects, null, 2));
        console.log('[LearningHub] Saved', this.projects.length, 'projects to', this.filePath);
      } catch (e) {
        console.error('[LearningHub] Failed to save project list:', e);
        throw e; // Re-throw so caller knows it failed
      }
    }

    async load() {
      if (!this.filePath || !window.__TAURI__) {
        this.projects = [];
        return;
      }

      try {
        const { exists, readTextFile } = window.__TAURI__.fs;
        const fileExists = await exists(this.filePath);
        if (!fileExists) {
          this.projects = [];
          return;
        }
        const data = await readTextFile(this.filePath);
        this.projects = JSON.parse(data);
        console.log('[LearningHub] Loaded', this.projects.length, 'projects from', this.filePath);
      } catch (e) {
        console.warn('[LearningHub] Failed to load project list:', e);
        this.projects = [];
      }
    }
  }

  // ============================================
  // Hub UI
  // ============================================
  let currentList = null;

  async function openHub() {
    currentList = new ProjectList();
    await currentList.initPath();
    await currentList.load();

    // Refresh progress from project.json chapters_status (not cached chapters[i].status)
    for (const p of currentList.projects) {
      try {
        const info = await detectProjectAt(p.path);
        if (info) {
          p.chapters = info.chapters;
          p.completed = info.completed;
        }
      } catch (_) { /* keep cached value */ }
    }

    // Create overlay
    let overlay = document.getElementById('learningHubOverlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'learningHubOverlay';
      overlay.className = 'learning-hub-overlay';
      document.body.appendChild(overlay);
    }

    overlay.innerHTML = `
      <div class="learning-hub">
        <div class="learning-hub-header">
          <h2>课程模式</h2>
          <button class="learning-hub-close" id="learningHubClose">×</button>
        </div>
        <div class="learning-hub-list" id="learningHubList"></div>
        <div class="learning-hub-footer">
          <button class="learning-hub-new-btn" id="learningHubNew">+ 新建学习项目</button>
          <button class="learning-hub-import-btn" id="learningHubImport">📂 导入已有项目</button>
        </div>
      </div>
    `;

    overlay.style.display = 'flex';

    renderProjectList();

    // Bind events
    document.getElementById('learningHubClose').addEventListener('click', closeHub);
    document.getElementById('learningHubNew').addEventListener('click', () => {
      closeHub();
      if (window.LearningProject) {
        window.LearningProject.open();
      }
    });
    document.getElementById('learningHubImport').addEventListener('click', importProject);
    // Overlay click does NOT close hub (prevent accidental close)
    // Only X button can close the hub
  }

  function closeHub() {
    const overlay = document.getElementById('learningHubOverlay');
    if (overlay) overlay.style.display = 'none';
  }

  function renderProjectList() {
    const container = document.getElementById('learningHubList');
    if (!container || !currentList) return;

    const projects = currentList.getAll();

    if (projects.length === 0) {
      container.innerHTML = `
        <div class="learning-hub-empty">
          <p>还没有学习项目</p>
          <p class="learning-hub-empty-hint">点击下方按钮开始你的第一个学习项目</p>
        </div>
      `;
      return;
    }

    container.innerHTML = projects.map(project => `
      <div class="learning-hub-card" data-path="${escapeAttr(project.path)}">
        <div class="learning-hub-card-info">
          <div class="learning-hub-card-name">${escapeHtml(project.name)}</div>
          <div class="learning-hub-card-meta">${project.chapters} 章 · ${project.progress}% 完成</div>
          <div class="learning-hub-card-progress">
            <div class="learning-hub-card-progress-bar">
              <div class="learning-hub-card-progress-fill" style="width: ${project.progress}%"></div>
            </div>
          </div>
        </div>
        <button class="learning-hub-card-delete" data-path="${escapeAttr(project.path)}" title="删除项目">🗑️</button>
      </div>
    `).join('');

    // Bind click events
    container.querySelectorAll('.learning-hub-card').forEach(card => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('.learning-hub-card-delete')) return;
        const path = card.dataset.path;
        openProject(path);
      });
    });

    container.querySelectorAll('.learning-hub-card-delete').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const path = btn.dataset.path;
        deleteProject(path);
      });
    });
  }

  function openProject(path) {
    closeHub();
    console.log('[LearningHub] Opening project at:', path);

    // Load project via resume module
    if (window.LearningProjectResume) {
      window.LearningProjectResume.loadProject(path);
    }
  }

  async function deleteProject(path) {
    if (!confirm('确定要删除这个学习项目吗？（不会删除磁盘文件）')) return;

    if (currentList) {
      currentList.remove(path);
      await currentList.save();
      renderProjectList();
    }
  }

  async function importProject() {
    if (!window.__TAURI__) {
      alert('导入功能需要 Tauri 环境');
      return;
    }

    try {
      const { invoke } = window.__TAURI__.core;
      const folderPath = await invoke('open_folder_dialog');
      if (!folderPath) return; // User cancelled

      // Detect if this folder contains a learning project
      const projectInfo = await detectProjectAt(folderPath);
      if (!projectInfo) {
        alert('所选文件夹不是学习项目（未找到 .learning/project.json）');
        return;
      }

      // Check if already in list
      if (currentList && currentList.get(folderPath)) {
        alert(`"${projectInfo.name}" 已经在项目列表中`);
        return;
      }

      // Register
      if (currentList) {
        currentList.add({
          path: folderPath,
          name: projectInfo.name,
          chapters: projectInfo.chapters,
          completed: projectInfo.completed
        });
        await currentList.save();
        renderProjectList();
        console.log('[LearningHub] Imported project:', projectInfo.name, 'at', folderPath);
      }
    } catch (err) {
      console.error('[LearningHub] Failed to import project:', err);
      alert('导入失败: ' + (err.message || err));
    }
  }

  async function detectProjectAt(folderPath) {
    if (!window.__TAURI__) return null;

    try {
      const { exists, readTextFile } = window.__TAURI__.fs;
      const normalizedPath = folderPath.replace(/\\/g, '/');
      const jsonPath = normalizedPath + '/.learning/project.json';

      const fileExists = await exists(jsonPath);
      if (!fileExists) return null;

      const content = await readTextFile(jsonPath);
      const data = JSON.parse(content);

      if (!data.chapters || !Array.isArray(data.chapters)) {
        return null;
      }

      // v2 schema: chapter status is in chapters_status map (not chapters[i].status)
      const cs = data.chapters_status || {};
      const completed = Object.values(cs).filter(v =>
        v === 'completed' || v === '已完成'
      ).length;

      return {
        name: data.name || '未命名项目',
        chapters: data.chapters.length,
        completed: completed
      };
    } catch (e) {
      console.warn('[LearningHub] detectProjectAt error:', e);
      return null;
    }
  }

  async function registerProject(path, name, chapters, completed) {
    const list = new ProjectList();
    await list.initPath();
    await list.load();
    list.add({ path, name, chapters, completed });
    await list.save();
  }

  // ============================================
  // Helpers
  // ============================================
  function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function escapeAttr(text) {
    if (!text) return '';
    return text.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // ============================================
  // Public API
  // ============================================
  window.LearningHub = {
    ProjectList,
    open: openHub,
    close: closeHub,
    registerProject,
    importProject
  };

  // Export for Node.js testing
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ProjectList };
  }
})();
