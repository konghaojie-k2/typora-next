/**
 * Typora Next - Main JavaScript
 * WebView frontend for Tauri backend
 */

// ============================================
// Agent Bridge (frontend adapter)
// Engine-agnostic pure-function interface. Replace the implementation
// (or the underlying agent-bridge.js stage) to swap LLM backends without
// touching call sites.
// ============================================
window.agentBridge = {
  async chatWithAgent({ article, history, message }) {
    if (!window.__TAURI__) {
      throw new Error('AI backend unavailable in web preview');
    }
    const { invoke } = window.__TAURI__.core;
    return await invoke('explore_chat', { article, history, message });
  }
};

(function() {
  'use strict';

  // ============================================
  // Configuration
  // ============================================
  const CONFIG = {
    scrollSyncDelay: 100,
    tocMinItems: 2,
    mermaidTheme: {
      light: 'default',
      dark: 'dark'
    }
  };

  // Theme logic extracted to theme-manager.js (loaded before this script in index.html).
  // Always-present data-theme invariant guards against prefers-color-scheme: dark
  // overriding the explicit user choice. See dist/scripts/theme-manager.js + tests/.
  const TM = window.ThemeManager;

  // ============================================
  // State Management
  // ============================================
  const state = {
    tabs: [],           // {path, content, baseDir, name, scrollTop, mode}
    activeTab: -1,      // index of active tab
    sourceMode: false,
    sidebarCollapsed: false,
    sidebarActiveTab: 'files',   // 'files' | 'toc'
    isTranslated: false,
    currentFolder: null,
    headings: [],
    refreshPromptVisible: false,
    selfChangePending: false,
    recentFiles: [],
    searchQuery: '',
    searchMatches: [],
    searchCurrentIndex: -1,
    workspace: {
      current: 'normal',  // 'normal' | 'course' | 'paper'
      context: {
        projectPath: null,       // course
        activePaperPath: null,   // paper
        paperProjectPath: null   // paper
      }
    }
  };
  let paperReaderSidebarWasCollapsed = null;

  // ============================================
  // DOM Elements
  // ============================================
  const elements = {
    sidebar: document.getElementById('sidebar'),
    sidebarToggle: document.getElementById('sidebarToggle'),
    tabFiles: document.getElementById('tabFiles'),
    tabToc: document.getElementById('tabToc'),
    filesPanel: document.getElementById('filesPanel'),
    tocPanel: document.getElementById('tocPanel'),
    tocTree: document.getElementById('tocTree'),
    fileTree: document.getElementById('fileTree'),
    sidebarMinimap: document.getElementById('sidebarMinimap'),
    openFolderBtn: document.getElementById('openFolderBtn'),
    openFolderToolbarBtn: document.getElementById('openFolderToolbarBtn'),
    fileTreeSearch: document.getElementById('fileTreeSearch'),
    contentArea: document.getElementById('contentArea'),
    contentMainWrapper: document.getElementById('contentMainWrapper'),
    markdownBody: document.getElementById('markdownBody'),
    sourceView: document.getElementById('sourceView'),
    sourceCode: document.getElementById('sourceCode'),
    tabsBar: document.getElementById('tabsBar'),
    tabsList: document.getElementById('tabsList'),
    openFileBtn: document.getElementById('openFileBtn'),
    paperReaderBtn: document.getElementById('paperReaderBtn'),
    sourceToggle: document.getElementById('sourceToggle'),
    exportPdfBtn: document.getElementById('exportPdfBtn'),
    exportWordBtn: document.getElementById('exportWordBtn'),
    shareBtn: document.getElementById('shareBtn'),
    slidesBtn: document.getElementById('slidesBtn'),
    translateBtn: document.getElementById('translateBtn'),
    themeToggle: document.getElementById('themeToggle'),
    themeIconLight: document.getElementById('themeIconLight'),
    themeIconDark: document.getElementById('themeIconDark'),
    settingsBtn: document.getElementById('settingsBtn'),
    settingsModal: document.getElementById('settingsModal'),
    settingAiProvider: document.getElementById('settingAiProvider'),
    settingAiBaseUrl: document.getElementById('settingAiBaseUrl'),
    settingModel: document.getElementById('settingModel'),
    settingApiKey: document.getElementById('settingApiKey'),
    settingMineruToken: document.getElementById('settingMineruToken'),
    settingMineruBaseUrl: document.getElementById('settingMineruBaseUrl'),
    settingMineruModel: document.getElementById('settingMineruModel'),
    settingTheme: document.getElementById('settingTheme'),
    settingCustomCursor: document.getElementById('settingCustomCursor'),
    settingWordTemplate: document.getElementById('settingWordTemplate'),
    settingsModalClose: document.getElementById('settingsModalClose'),
    settingsCancel: document.getElementById('settingsCancel'),
    settingsSave: document.getElementById('settingsSave'),
    settingsTest: document.getElementById('settingsTest'),
    testResult: document.getElementById('testResult'),
    restartOnboardingBtn: document.getElementById('restartOnboardingBtn'),
    recentFilesSection: document.getElementById('recentFilesSection'),
    recentFilesList: document.getElementById('recentFilesList'),
    clearRecentFiles: document.getElementById('clearRecentFiles'),
    searchBar: document.getElementById('searchBar'),
    searchInput: document.getElementById('searchInput'),
    searchCount: document.getElementById('searchCount'),
    searchPrev: document.getElementById('searchPrev'),
    searchNext: document.getElementById('searchNext'),
    searchClose: document.getElementById('searchClose'),
    agentStatusChip: document.getElementById('agentStatusChip'),
    agentStatusDot: document.querySelector('#agentStatusChip .agent-status-dot'),
    agentStatusText: document.querySelector('#agentStatusChip .agent-status-text'),

    // About modal
    settingsAboutBtn: document.getElementById('settingsAboutBtn'),
    aboutModal: document.getElementById('aboutModal'),
    aboutModalClose: document.getElementById('aboutModalClose'),
    aboutModalCloseBtn: document.getElementById('aboutModalCloseBtn'),
    aboutVersion: document.getElementById('aboutVersion'),
    aboutPlatform: document.getElementById('aboutPlatform'),
    aboutIdentifier: document.getElementById('aboutIdentifier'),

    // Update
    updateBadge: document.getElementById('updateBadge'),
    checkUpdateBtn: document.getElementById('checkUpdateBtn'),
    updateStatus: document.getElementById('updateStatus')
  };

  // ============================================
  // Tauri IPC Integration
  // ============================================
  async function invoke(command, args = {}) {
    // Check if running in Tauri environment
    console.log('[DEBUG] Checking Tauri environment:', !!window.__TAURI__, window.__TAURI__ ? 'AVAILABLE' : 'NOT AVAILABLE');

    if (window.__TAURI__) {
      console.log('[DEBUG] Invoking Tauri command:', command, args);
      const { invoke: tauriInvoke } = window.__TAURI__.core;
      try {
        const result = await tauriInvoke(command, args);
        console.log('[DEBUG] Tauri result:', result);
        return result;
      } catch (err) {
        console.error('[DEBUG] Tauri error:', err);
        throw err;
      }
    } else {
      // Fallback for web preview (mock responses)
      console.warn('[DEBUG] Tauri not available, using mock data');
      return mockInvoke(command, args);
    }
  }

  // Mock IPC for web preview/testing
  function mockInvoke(command, args) {
    switch (command) {
      case 'open_file_dialog':
        return Promise.resolve({
          path: 'sample.md',
          content: '# Sample Document\n\nThis is a sample markdown content.\n\n## Section 1\n\nSome content here.\n\n### Subsection\n\nMore details.\n\n## Section 2\n\nAnother section.\n\n```javascript\nconsole.log("Hello World");\n```'
        });
      case 'open_file':
        return Promise.resolve({
          path: args.path || 'sample.md',
          content: '# Sample Document\n\nContent from path.'
        });
      case 'render_markdown':
        return Promise.resolve(renderMarkdownMock(args.content));
      case 'get_toc':
        return Promise.resolve([]);
      case 'check_agent_sdk':
        // Mock: in web preview, pretend SDK is available
        return Promise.resolve({ available: true, error: null });
      case 'probe_agent_sdk':
        // Mock: in web preview, pretend SDK exists (no guidance toast)
        return Promise.resolve({ found: true, location: '/mock/project/node_modules' });
      case 'open_folder_dialog':
        return Promise.resolve('/mock/project');
      case 'list_directory':
        return Promise.resolve([
          { name: 'docs', path: '/mock/project/docs', is_dir: true, children: [
            { name: 'readme.md', path: '/mock/project/docs/readme.md', is_dir: false, children: null }
          ]},
          { name: 'src', path: '/mock/project/src', is_dir: true, children: null },
          { name: 'main.md', path: '/mock/project/main.md', is_dir: false, children: null }
        ]);
      case 'import_paper_from_pdf':
        return Promise.resolve({
          md_path: '/mock/project/.learning/papers/2026-07/mock-paper.md',
          md_content: '# Mock Imported Paper\n\nThis was imported from PDF.',
          title: 'Mock Imported Paper'
        });
      case 'import_paper_from_url':
        return Promise.resolve({
          md_path: '/mock/project/.learning/papers/2026-07/mock-url-paper.md',
          md_content: '# Mock URL Paper\n\nThis was imported from URL.',
          title: 'Mock URL Paper'
        });
      case 'export_pdf':
        // Mock: 浏览器预览环境回退 window.print()
        return Promise.resolve('window-print');
      default:
        return Promise.resolve(null);
    }
  }

  // Mock markdown renderer for web preview
  function renderMarkdownMock(content) {
    // Simple mock: wrap in paragraphs and handle headings
    let html = content
      .replace(/^### (.*$)/gim, '<h3>$1</h3>')
      .replace(/^## (.*$)/gim, '<h2>$1</h2>')
      .replace(/^# (.*$)/gim, '<h1>$1</h1>')
      .replace(/\*\*(.*)\*\*/gim, '<strong>$1</strong>')
      .replace(/\*(.*)\*/gim, '<em>$1</em>')
      .replace(/```(\w+)?\n([\s\S]*?)```/gim, '<pre><code class="language-$1">$2</code></pre>')
      .replace(/\n/gim, '<br>');
    return `<div class="markdown-content">${html}</div>`;
  }

  // ============================================
  // File Operations
  // ============================================
  async function openFile() {
    try {
      const result = await invoke('open_file_dialog');
      if (result && result.content) {
        addTab(result.path, result.content, result.base_dir || '');
      }
    } catch (err) {
      if (err !== 'No file selected') {
        console.error('Failed to open file:', err);
        showError('无法打开文件: ' + err);
      }
    }
  }

  // Sprint 10 PB1: Open paper reader workspace
  async function openPaperReader() {
    if (!window.__TAURI__) {
      showError('论文导读需要在桌面应用中使用');
      return;
    }
    if (!window.PaperReader || !window.PaperReaderIntegration) {
      showError('论文导读模块未加载');
      return;
    }
    await AppWorkspace.switchTo('paper');
  }

  /**
   * Open a specific paper file in the paper workspace.
   * If called without a path, prompts the user via file dialog.
   */
  async function openPaperFile(paperFile) {
    if (!window.__TAURI__) {
      showError('论文导读需要在桌面应用中使用');
      return;
    }
    if (!window.PaperReader || !window.PaperReaderIntegration) {
      showError('论文导读模块未加载');
      return;
    }

    if (!paperFile) {
      try {
        const result = await invoke('open_file_dialog');
        if (!result || !result.path) return;
        paperFile = result.path;
      } catch (err) {
        if (err !== 'No file selected') {
          console.error('Failed to select paper:', err);
          showError('选择论文失败: ' + err);
        }
        return;
      }
    }

    // Ensure we are in the paper workspace.
    if (!AppWorkspace.isIn('paper')) {
      const switched = await AppWorkspace.switchTo('paper', {
        context: { activePaperPath: paperFile }
      });
      if (!switched) return;
    }

    // Add or switch to the paper tab.
    const existingIndex = state.tabs.findIndex(t => t.path === paperFile);
    if (existingIndex >= 0) {
      await switchTab(existingIndex);
      return;
    }

    try {
      showToast('正在生成导读...', 'info', 0);
      const result = await invoke('open_file', { path: paperFile });
      hideToast();
      if (result && result.content) {
        await addTab(result.path, result.content, result.base_dir || '', {
          mode: 'paper',
          workspaceContext: {
            activePaperPath: result.path,
            paperProjectPath: result.base_dir || ''
          }
        });
        invoke('add_recent_file', { path: paperFile, mode: 'paper' }).then(() => {
          loadRecentFiles();
        }).catch(err => console.error('Failed to add recent paper file:', err));
      }
    } catch (err) {
      hideToast();
      console.error('Failed to open paper file:', err);
      showError('无法打开论文文件: ' + err);
    }
  }

  // Legacy paper-reader overlay functions (renderPaperReaderWelcome,
  // startPaperReaderFileSelection, renderPaperReaderLoading,
  // ensurePaperReaderWrapper, closePaperReader) were removed in Phase 2.
  // Paper reader now uses the tab enhancement model via PaperReaderIntegration
  // and openPaperFile(). Keep minimal compatibility shims for external callers.
  window.isPaperReaderActive = function () {
    return AppWorkspace.isIn('paper') && state.tabs.some(t => t.mode === 'paper');
  };

  /**
   * Import a local PDF file as a paper and open it.
   */
  async function openPaperPdf() {
    if (!window.__TAURI__) {
      showError('论文导读需要在桌面应用中使用');
      return;
    }
    if (!window.PaperReader || !window.PaperReaderIntegration || !window.PaperImport) {
      showError('论文导读模块未加载');
      return;
    }

    if (!AppWorkspace.isIn('paper')) {
      const switched = await AppWorkspace.switchTo('paper');
      if (!switched) return;
    }

    const container = document.getElementById('markdownBody');
    window.PaperImport.showProgress(container, 'submit', '正在导入 PDF，请稍候...');

    try {
      const result = await invoke('import_paper_from_pdf');
      window.PaperImport.hideProgress(container);
      if (!result || !result.md_path) {
        showError('导入失败：未返回文件路径');
        if (window.PaperReaderIntegration) {
          window.PaperReaderIntegration.showWelcome(container);
        }
        return;
      }
      await openImportedPaper(result);
    } catch (err) {
      window.PaperImport.hideProgress(container);
      console.error('Failed to import PDF:', err);
      showError('PDF 导入失败: ' + err);
      // Restore welcome screen so the user can retry or pick another source.
      if (window.PaperReaderIntegration) {
        window.PaperReaderIntegration.showWelcome(container);
      }
    }
  }

  /**
   * Import a paper from a URL and open it.
   */
  async function openPaperUrl() {
    if (!window.__TAURI__) {
      showError('论文导读需要在桌面应用中使用');
      return;
    }
    if (!window.PaperReader || !window.PaperReaderIntegration || !window.PaperImport) {
      showError('论文导读模块未加载');
      return;
    }

    const container = document.getElementById('markdownBody');
    const urlInput = container ? container.querySelector('#paper-reader-url-input') : null;
    const url = urlInput ? urlInput.value.trim() : '';
    if (!url) {
      showError('请输入论文 URL');
      return;
    }

    if (!AppWorkspace.isIn('paper')) {
      const switched = await AppWorkspace.switchTo('paper');
      if (!switched) return;
    }

    window.PaperImport.showProgress(container, 'submit', '正在从 URL 导入论文，请稍候...');

    try {
      const result = await invoke('import_paper_from_url', { url });
      window.PaperImport.hideProgress(container);
      if (!result || !result.md_path) {
        showError('导入失败：未返回文件路径');
        if (window.PaperReaderIntegration) {
          window.PaperReaderIntegration.showWelcome(container);
        }
        return;
      }
      await openImportedPaper(result);
    } catch (err) {
      window.PaperImport.hideProgress(container);
      console.error('Failed to import paper from URL:', err);
      showError('URL 导入失败: ' + err);
      if (window.PaperReaderIntegration) {
        window.PaperReaderIntegration.showWelcome(container);
      }
    }
  }

  /**
   * Open an already-imported Markdown paper as a paper tab.
   */
  async function openImportedPaper(result) {
    if (!result || !result.md_path) return;

    const baseDir = result.md_path.replace(/[^\\/]+$/, '');
    const existingIndex = state.tabs.findIndex(t => t.path === result.md_path);
    if (existingIndex >= 0) {
      await switchTab(existingIndex);
      return;
    }

    try {
      showToast('正在生成导读...', 'info', 0);
      await addTab(result.md_path, result.md_content, baseDir, {
        mode: 'paper',
        workspaceContext: {
          activePaperPath: result.md_path,
          paperProjectPath: baseDir
        }
      });
      hideToast();
      invoke('add_recent_file', { path: result.md_path, mode: 'paper' }).then(() => {
        loadRecentFiles();
      }).catch(err => console.error('Failed to add recent paper file:', err));
    } catch (err) {
      hideToast();
      console.error('Failed to open imported paper:', err);
      showError('无法打开导入的论文: ' + err);
    }
  }

  window.confirmPaperReaderSwitch = function (message) {
    return _showConfirm(message);
  };

  window.closePaperReader = async function () {
    if (AppWorkspace.isIn('paper')) {
      await AppWorkspace.switchTo('normal');
    }
  };

  // ============================================
  // File Watch
  // ============================================
  async function watchCurrentFile(path) {
    if (!window.__TAURI__) return;
    try {
      await invoke('watch_file', { path });
    } catch (err) {
      console.error('Failed to watch file:', err);
    }
  }

  async function unwatchCurrentFile() {
    if (!window.__TAURI__) return;
    try {
      await invoke('unwatch_file');
    } catch (err) {
      console.error('Failed to unwatch file:', err);
    }
  }

  function setupFileWatcher() {
    if (!window.__TAURI__) return;
    const { listen } = window.__TAURI__.event;
    listen('file-changed', (event) => {
      const changedPath = event.payload;
      if (state.selfChangePending) {
        state.selfChangePending = false;
        return;
      }
      const activeTab = state.tabs[state.activeTab];
      if (activeTab && activeTab.path === changedPath && !state.refreshPromptVisible) {
        showRefreshPrompt(changedPath);
      }
    });

    // Listen for file open from command line args (file association)
    listen('open-file-from-args', (event) => {
      const filePath = event.payload;
      if (filePath) {
        invoke('open_file', { path: filePath }).then(result => {
          if (result && result.content) {
            addTab(result.path, result.content, result.base_dir || '');
            // Sprint 7: ask Rust to flash taskbar / bounce Dock if the user
            // is not currently looking at the app window. No-op when focused.
            // Fire-and-forget: don't pollute the main flow on failure.
            invoke('notify_external_file_opened').catch(err =>
              console.warn('[Attention] notify_external_file_opened failed:', err)
            );
          }
        }).catch(err => {
          console.error('Failed to open file from args:', err);
        });
      }
    });
  }

  /**
   * Generation close guard: when the user tries to close the main window while
   * chapter generation is running in the background, show a DOM confirmation
   * because WebView confirm()/alert() are not available in Tauri.
   */
  function setupGenerationCloseGuard() {
    if (!window.__TAURI__) return;
    const { listen } = window.__TAURI__.event;
    listen('generation-close-requested', () => {
      if (document.getElementById('generationCloseGuardModal')) return;

      const overlay = document.createElement('div');
      overlay.id = 'generationCloseGuardModal';
      overlay.style.cssText = `
        position: fixed; inset: 0;
        background: rgba(15, 23, 42, 0.55);
        backdrop-filter: blur(4px);
        display: flex; align-items: center; justify-content: center;
        z-index: 99999; padding: 24px;
      `;

      const panel = document.createElement('div');
      panel.style.cssText = `
        background: #fff; border-radius: 16px;
        max-width: 420px; width: 100%;
        padding: 24px;
        box-shadow: 0 25px 80px rgba(0,0,0,0.25);
        font-family: inherit;
      `;
      panel.innerHTML = `
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;">
          <span style="font-size:28px;">⚠️</span>
          <div style="font-size:18px;font-weight:700;color:#111827;">生成尚未完成</div>
        </div>
        <div style="font-size:14px;color:#4b5563;line-height:1.6;margin-bottom:20px;">
          当前有章节正在后台生成中。关闭窗口会中断生成，已生成的进度可能丢失。
        </div>
        <div style="display:flex;gap:10px;justify-content:flex-end;">
          <button id="genGuardCancel" style="padding:8px 16px;border-radius:8px;border:1px solid #e5e7eb;background:#fff;color:#374151;font-size:13px;cursor:pointer;">取消</button>
          <button id="genGuardBackground" style="padding:8px 16px;border-radius:8px;border:1px solid #c4b5fd;background:#f5f3ff;color:#7c3aed;font-size:13px;cursor:pointer;">后台继续</button>
          <button id="genGuardClose" style="padding:8px 16px;border-radius:8px;border:none;background:#ef4444;color:#fff;font-size:13px;cursor:pointer;">仍要关闭</button>
        </div>
      `;

      overlay.appendChild(panel);
      document.body.appendChild(overlay);

      document.getElementById('genGuardCancel').addEventListener('click', () => {
        overlay.remove();
      });

      document.getElementById('genGuardBackground').addEventListener('click', () => {
        window.__TAURI__.core.invoke('hide_main_window').catch(err =>
          console.error('[GenerationGuard] hide_main_window failed:', err)
        );
        overlay.remove();
      });

      document.getElementById('genGuardClose').addEventListener('click', () => {
        window.__TAURI__.core.invoke('exit_app').catch(err =>
          console.error('[GenerationGuard] exit_app failed:', err)
        );
      });
    });
  }

  function showRefreshPrompt(path) {
    state.refreshPromptVisible = true;
    const existing = document.getElementById('refresh-prompt');
    if (existing) existing.remove();

    const prompt = document.createElement('div');
    prompt.id = 'refresh-prompt';
    prompt.innerHTML = `
      <span class="refresh-text">${escapeHtml(getFileName(path))} 已在外部修改</span>
      <button class="refresh-btn" id="refreshBtn">刷新</button>
      <button class="refresh-dismiss" id="dismissRefreshBtn">忽略</button>
    `;
    document.body.appendChild(prompt);

    document.getElementById('refreshBtn').addEventListener('click', () => {
      refreshCurrentFile();
      prompt.remove();
      state.refreshPromptVisible = false;
    });
    document.getElementById('dismissRefreshBtn').addEventListener('click', () => {
      prompt.remove();
      state.refreshPromptVisible = false;
    });
  }

  async function refreshCurrentFile() {
    const tab = state.tabs[state.activeTab];
    if (!tab) return;
    try {
      const savedScrollTop = elements.markdownBody ? elements.markdownBody.scrollTop : 0;
      const result = await invoke('open_file', { path: tab.path });
      if (result && result.content) {
        tab.content = result.content;
        tab.baseDir = result.base_dir || '';
        // Close search before refreshing content
        closeSearch();
        await loadTabContent(state.activeTab);
        if (elements.markdownBody) {
          elements.markdownBody.scrollTop = savedScrollTop;
        }
        showToast('文件已刷新');
      }
    } catch (err) {
      console.error('Failed to refresh file:', err);
      showError('刷新失败: ' + err);
    }
  }

  // ============================================
  // Tab Management
  // ============================================
  async function addTab(path, content, baseDir, options = {}) {
    // Determine target workspace mode. Default to current workspace for
    // backward compatibility (e.g. chapter files opened while in course mode).
    let mode = options.mode || AppWorkspace.getCurrent();
    // Rust backend uses 'learning' for course projects; normalize to frontend id.
    if (mode === 'learning') mode = 'course';

    // Switch workspace if needed.
    if (mode !== AppWorkspace.getCurrent()) {
      const switched = await AppWorkspace.switchTo(mode, { context: options.workspaceContext });
      if (!switched) return;
    }

    // Course scope guard: opening a file outside the current project exits
    // course workspace and opens it as a normal tab.
    if (AppWorkspace.isIn('course')) {
      const projectPath = AppWorkspace.getContext().projectPath;
      if (projectPath) {
        const projectNorm = projectPath.replace(/\//g, '\\').toLowerCase();
        const fileNorm = path.replace(/\//g, '\\').toLowerCase();
        if (!fileNorm.startsWith(projectNorm)) {
          const switched = await AppWorkspace.switchTo('normal');
          if (!switched) return;
          mode = 'normal';
        }
      }
    }

    const existingIndex = state.tabs.findIndex(t => t.path === path);
    if (existingIndex >= 0) {
      // Tab already open, switch to it
      await switchTab(existingIndex);
      return;
    }

    // Save scroll position of current tab before adding new one
    const currentTab = state.tabs[state.activeTab];
    if (currentTab && elements.markdownBody) {
      currentTab.scrollTop = elements.markdownBody.scrollTop;
    }

    const tab = {
      path,
      content,
      baseDir,
      name: getFileName(path),
      scrollTop: 0,
      mode
    };

    state.tabs.push(tab);
    state.activeTab = state.tabs.length - 1;
    renderTabs();
    await loadTabContent(state.activeTab);

    // Reset DOM scroll to the new tab's saved position (0 for new tabs).
    if (elements.markdownBody) {
      elements.markdownBody.scrollTop = tab.scrollTop || 0;
    }

    watchCurrentFile(path);
    showToast('已打开: ' + tab.name);

    // Add to recent files with the correct workspace mode
    invoke('add_recent_file', { path, mode }).then(() => {
      loadRecentFiles();
    }).catch(err => {
      console.error('Failed to add recent file:', err);
    });

    saveUIState();
  }

  // Read the scroll position for a tab. Paper tabs scroll inside
  // #paper-reader-main; everything else scrolls on #markdownBody.
  function _readTabScroll(tab) {
    if (!tab) return 0;
    if (tab.mode === 'paper') {
      const main = document.getElementById('paper-reader-main');
      return main ? main.scrollTop : 0;
    }
    return elements.markdownBody ? elements.markdownBody.scrollTop : 0;
  }

  async function switchTab(index) {
    if (index < 0 || index >= state.tabs.length) return;

    // Close search when switching tabs
    closeSearch();

    // Save scroll position of current tab before switching
    const currentTab = state.tabs[state.activeTab];
    if (currentTab) {
      currentTab.scrollTop = _readTabScroll(currentTab);
    }

    // Unmount the outgoing paper reader so its DOM/interval does not linger
    // while the incoming tab renders into #markdownBody.
    if (currentTab && currentTab.mode === 'paper' && window.PaperReaderIntegration) {
      window.PaperReaderIntegration.unmountTab(currentTab);
    }

    state.activeTab = index;
    renderTabs();
    await loadTabContent(index);

    // Restore scroll position of the new tab after render completes.
    // Paper reader restores its own scroll inside #paper-reader-main.
    const tab = state.tabs[index];
    if (tab && tab.mode !== 'paper' && elements.markdownBody) {
      elements.markdownBody.scrollTop = tab.scrollTop || 0;
    }

    if (tab) {
      watchCurrentFile(tab.path);
    }
  }

  async function closeTab(index) {
    if (index < 0 || index >= state.tabs.length) return;

    // Save scroll position of current tab before closing
    const closingTab = state.tabs[state.activeTab];
    if (closingTab) {
      closingTab.scrollTop = _readTabScroll(closingTab);
    }

    const closedTab = state.tabs[index];
    const closedPath = closedTab.path;

    // Tear down the paper reader for the tab being closed (frees DOM/listeners).
    if (closedTab.mode === 'paper' && window.PaperReaderIntegration) {
      window.PaperReaderIntegration.unmountTab(closedTab);
    }

    state.tabs.splice(index, 1);

    // If no other tab still references this file, tear down its exploration panel
    const stillOpen = state.tabs.some(t => t.path === closedPath);
    if (!stillOpen) {
      closeExplorationPanelForFile(closedPath);
    }

    if (state.tabs.length === 0) {
      state.activeTab = -1;
      renderTabs();
      unwatchCurrentFile();
      // When the last tab of a specialized workspace is closed, the user has
      // already expressed the intent to leave that workspace. Exit silently
      // without another confirmation dialog.
      if (AppWorkspace.isIn('course')) {
        await AppWorkspace.switchTo('normal', { skipConfirm: true });
      } else if (AppWorkspace.isIn('paper')) {
        // Stay in the paper workspace and show the welcome screen so the user
        // can import/open another paper without re-entering the workspace.
        if (window.PaperReaderIntegration) {
          window.PaperReaderIntegration.showWelcome(elements.markdownBody);
        }
        if (elements.tocTree) {
          elements.tocTree.innerHTML = '<p class="toc-empty">打开文件以显示目录</p>';
        }
      } else {
        showWelcome();
      }
    } else {
      // Adjust active tab
      if (index <= state.activeTab) {
        state.activeTab = Math.max(0, state.activeTab - 1);
      }
      renderTabs();
      await loadTabContent(state.activeTab);
      const activeTab = state.tabs[state.activeTab];
      if (activeTab) {
        if (activeTab.mode !== 'paper' && elements.markdownBody) {
          elements.markdownBody.scrollTop = activeTab.scrollTop || 0;
        }
        watchCurrentFile(activeTab.path);
      }
    }

    // Remove refresh prompt if visible
    const prompt = document.getElementById('refresh-prompt');
    if (prompt) {
      prompt.remove();
      state.refreshPromptVisible = false;
    }

    saveUIState();
  }

  async function closeOtherTabs(keepIndex) {
    if (keepIndex < 0 || keepIndex >= state.tabs.length) return;
    const keepTab = state.tabs[keepIndex];
    state.tabs = [keepTab];
    state.activeTab = 0;
    renderTabs();
    await loadTabContent(0);
    if (elements.markdownBody) {
      elements.markdownBody.scrollTop = keepTab.scrollTop || 0;
    }
    watchCurrentFile(keepTab.path);
    saveUIState();
  }

  function closeAllTabs() {
    state.tabs = [];
    state.activeTab = -1;
    renderTabs();
    showWelcome();
    unwatchCurrentFile();
    saveUIState();
  }

  let activeContextMenu = null;

  function showTabContextMenu(event, index) {
    // Remove existing menu
    if (activeContextMenu) {
      activeContextMenu.remove();
      activeContextMenu = null;
    }

    const menu = document.createElement('div');
    menu.className = 'tab-context-menu';
    menu.style.left = event.clientX + 'px';
    menu.style.top = event.clientY + 'px';

    const tab = state.tabs[index];
    const inLearningMode = AppWorkspace.isIn('course');
    const items = [
      { label: '在文件夹中显示', action: () => {
        if (tab && tab.path) {
          invoke('show_in_folder', { path: tab.path }).catch(err => {
            console.error('打开文件夹失败:', err);
          });
        }
      }}
    ];

    if (tab && tab.path.toLowerCase().endsWith('.md') && !inLearningMode) {
      const panel = explorationPanels.get(tab.path);
      items.push({
        label: panel && panel.isOpen() ? '关闭探索面板' : '打开探索面板',
        action: () => toggleExplorationPanel(tab.path)
      });
    }

    items.push(
      { label: '分享打包', action: () => shareDocument(index) },
      { label: '关闭', action: () => closeTab(index) },
      { label: '关闭其他', action: () => closeOtherTabs(index) },
      { label: '关闭全部', action: () => closeAllTabs() }
    );

    items.forEach((item, i) => {
      if (i > 0) {
        const sep = document.createElement('div');
        sep.className = 'tab-context-menu-separator';
        menu.appendChild(sep);
      }
      const el = document.createElement('div');
      el.className = 'tab-context-menu-item' + (item.disabled ? ' disabled' : '');
      el.textContent = item.label;
      if (!item.disabled) {
        el.addEventListener('click', () => {
          item.action();
          menu.remove();
          activeContextMenu = null;
        });
      }
      menu.appendChild(el);
    });

    document.body.appendChild(menu);
    activeContextMenu = menu;

    // Close menu on click elsewhere
    const closeMenu = (e) => {
      if (!menu.contains(e.target)) {
        menu.remove();
        activeContextMenu = null;
        document.removeEventListener('click', closeMenu);
        document.removeEventListener('contextmenu', closeMenu);
      }
    };
    setTimeout(() => {
      document.addEventListener('click', closeMenu);
      document.addEventListener('contextmenu', closeMenu);
    }, 0);
  }

  function showFileTreeContextMenu(event, filePath) {
    // Remove existing menu
    if (activeContextMenu) {
      activeContextMenu.remove();
      activeContextMenu = null;
    }

    const menu = document.createElement('div');
    menu.className = 'tab-context-menu file-tree-context-menu';
    menu.style.left = event.clientX + 'px';
    menu.style.top = event.clientY + 'px';

    const inLearningMode = AppWorkspace.isIn('course');
    const items = [
      { label: '打开', action: () => openTreeFile(filePath) }
    ];

    if (!inLearningMode) {
      const panel = explorationPanels.get(filePath);
      items.push({
        label: panel && panel.isOpen() ? '关闭探索面板' : '打开探索面板',
        action: () => openFileInExplorationMode(filePath)
      });
    }

    items.push(
      { label: '在文件夹中显示', action: () => {
        if (filePath) {
          invoke('show_in_folder', { path: filePath }).catch(err => {
            console.error('打开文件夹失败:', err);
          });
        }
      }}
    );

    items.forEach((item, i) => {
      if (i > 0) {
        const sep = document.createElement('div');
        sep.className = 'tab-context-menu-separator';
        menu.appendChild(sep);
      }
      const el = document.createElement('div');
      el.className = 'tab-context-menu-item' + (item.disabled ? ' disabled' : '');
      el.textContent = item.label;
      if (!item.disabled) {
        el.addEventListener('click', () => {
          item.action();
          menu.remove();
          activeContextMenu = null;
        });
      }
      menu.appendChild(el);
    });

    document.body.appendChild(menu);
    activeContextMenu = menu;

    // Close menu on click elsewhere
    const closeMenu = (e) => {
      if (!menu.contains(e.target)) {
        menu.remove();
        activeContextMenu = null;
        document.removeEventListener('click', closeMenu);
        document.removeEventListener('contextmenu', closeMenu);
      }
    };
    setTimeout(() => {
      document.addEventListener('click', closeMenu);
      document.addEventListener('contextmenu', closeMenu);
    }, 0);
  }

  function showMarkdownContextMenu(event) {
    const tab = state.tabs[state.activeTab];
    if (!tab || !tab.path.toLowerCase().endsWith('.md')) return;
    if (AppWorkspace.isIn('course')) return;

    event.preventDefault();

    if (activeContextMenu) {
      activeContextMenu.remove();
      activeContextMenu = null;
    }

    const menu = document.createElement('div');
    menu.className = 'tab-context-menu markdown-context-menu';
    menu.style.left = event.clientX + 'px';
    menu.style.top = event.clientY + 'px';

    const panel = explorationPanels.get(tab.path);
    const items = [
      {
        label: panel && panel.isOpen() ? '关闭探索面板' : '打开探索面板',
        action: () => toggleExplorationPanel(tab.path)
      }
    ];

    items.forEach((item) => {
      const el = document.createElement('div');
      el.className = 'tab-context-menu-item' + (item.disabled ? ' disabled' : '');
      el.textContent = item.label;
      if (!item.disabled) {
        el.addEventListener('click', () => {
          item.action();
          menu.remove();
          activeContextMenu = null;
        });
      }
      menu.appendChild(el);
    });

    document.body.appendChild(menu);
    activeContextMenu = menu;

    const closeMenu = (e) => {
      if (!menu.contains(e.target)) {
        menu.remove();
        activeContextMenu = null;
        document.removeEventListener('click', closeMenu);
        document.removeEventListener('contextmenu', closeMenu);
      }
    };
    setTimeout(() => {
      document.addEventListener('click', closeMenu);
      document.addEventListener('contextmenu', closeMenu);
    }, 0);
  }

  function renderTabs() {
    elements.tabsList.innerHTML = '';

    state.tabs.forEach((tab, index) => {
      const tabEl = document.createElement('div');
      tabEl.className = 'tab-item' +
        (index === state.activeTab ? ' active' : '');

      const label = document.createElement('span');
      label.className = 'tab-label';
      label.textContent = tab.name;
      label.title = tab.path;

      const closeBtn = document.createElement('button');
      closeBtn.className = 'tab-close';
      closeBtn.innerHTML = '×';
      closeBtn.title = '关闭';

      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        closeTab(index);
      });

      tabEl.appendChild(label);
      tabEl.appendChild(closeBtn);

      tabEl.addEventListener('click', async () => await switchTab(index));
      tabEl.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        showTabContextMenu(e, index);
      });

      elements.tabsList.appendChild(tabEl);
    });
  }

  async function loadTabContent(index) {
    if (index < 0 || index >= state.tabs.length) return;
    const tab = state.tabs[index];

    // Paper tabs render through the PaperReader integration, not the normal
    // markdown pipeline. The reader renders into #markdownBody directly.
    if (tab.mode === 'paper' && window.PaperReaderIntegration) {
      await window.PaperReaderIntegration.enhancePaperTab(tab);
      // Keep the source view in sync so the source toggle still works for papers.
      if (elements.sourceCode) {
        elements.sourceCode.textContent = tab.paperContent || tab.content || '';
      }
      elements.fileTree.querySelectorAll('.file-tree-item').forEach(item => {
        item.classList.toggle('active', item.dataset.path === tab.path);
      });
      return;
    }

    await renderMarkdown(tab.content, tab.baseDir);

    // Update file tree active state
    elements.fileTree.querySelectorAll('.file-tree-item').forEach(item => {
      item.classList.toggle('active', item.dataset.path === tab.path);
    });
  }

  function showWelcome() {
    elements.markdownBody.innerHTML = `
      <div class="welcome-message">
        <h1>Typora Next</h1>
        <p>一个现代化的 Markdown 编辑器</p>
        <p>按 <kbd>Ctrl+O</kbd> 打开文件，或拖拽文件到此处</p>
      </div>
    `;
    elements.sourceCode.textContent = '';
    elements.tocTree.innerHTML = '<p class="toc-empty">打开文件以显示目录</p>';
  }

  async function renderMarkdown(content, baseDir = '') {
    try {
      // Reset exploration mode styling when rendering normal markdown
      elements.markdownBody.classList.remove('exploration-mode');
      elements.markdownBody.style.display = state.sourceMode ? 'none' : 'block';

      const html = await invoke('render_markdown', { content });
      elements.markdownBody.innerHTML = html;

      // Resolve relative image paths based on file directory
      if (baseDir) {
        resolveImagePaths(baseDir);
      }

      // Initialize code highlighting
      initCodeHighlighting();

      // Initialize math rendering
      initMathRendering();

      // Initialize mermaid diagrams (async, must complete before download buttons)
      await initMermaid();

      // Initialize image handling
      initImageHandling();

      // Initialize GFM Alerts styling
      initGFMAlerts();

      // Extract and build TOC
      buildTOC();

      // Initialize task list checkbox interactivity
      initTaskListInteraction();

      // Initialize Obsidian syntax support
      initObsidianHighlight();
      initObsidianTags();
      initObsidianCallouts();
      initWikiLinks();
      initObsidianEmbeds(baseDir);
      initDownloadButtons();

      // Sprint 3: Enhance learning elements (concept/question/quiz cards)
      console.log('[Sprint3-MAIN] checking LearningModeIntegration:', typeof window.LearningModeIntegration, 'course-mode:', AppWorkspace.isIn('course'));
      if (window.LearningModeIntegration) {
        try {
          window.LearningModeIntegration.enhanceLearningElements();
        } catch (e) {
          console.warn('[Sprint3] enhanceLearningElements failed:', e);
        }
      }

      console.log('[DEBUG renderMarkdown] about to call applyAnnotations');
      await applyAnnotations();
      console.log('[DEBUG renderMarkdown] applyAnnotations done');

      // Sprint 3: Setup quiz panel + selection explainer (only in learning mode)
      if (AppWorkspace.isIn('course') && window.LearningModeIntegration) {
        try {
          // Get current chapter file path and project base dir
          const activeTab = state.tabs[state.activeTab];
          const chapterFile = activeTab ? activeTab.path : '';
          const projectPath = activeTab ? activeTab.baseDir : '';
          window.LearningModeIntegration.setupQuizPanel(chapterFile, projectPath);
          window.LearningModeIntegration.setupSelectionExplainer();
        } catch (e) {
          console.warn('[Sprint3] mode integration setup failed:', e);
        }
      }

      // Reset translation state on re-render
      state.isTranslated = false;
      if (elements.translateBtn) {
        elements.translateBtn.title = '翻译';
        elements.translateBtn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`;
      }

      // Update source view
      elements.sourceCode.textContent = content;

    } catch (err) {
      console.error('Failed to render markdown:', err);
      elements.markdownBody.innerHTML = `<p class="error">渲染失败: ${err.message}</p>`;
    }
  }

  /**
   * Apply the normal markdown post-processing pipeline to an arbitrary
   * container. Used by the paper reader so its content gets the same
   * enhancements (image paths, lightbox, code highlighting, math, mermaid,
   * GFM alerts, Obsidian syntax, download buttons) as regular tabs.
   */
  async function enhanceReaderContent(container, baseDir = '') {
    if (!container) return;

    // Resolve relative image paths before any other processing touches src.
    if (baseDir) {
      resolveImagePaths(baseDir, container);
    }

    initCodeHighlighting(container);
    initMathRendering(container);
    await initMermaid(container);
    initImageHandling(container);
    initGFMAlerts(container);
    initObsidianHighlight(container);
    initObsidianTags(container);
    initObsidianCallouts(container);
    initWikiLinks(container);
    initDownloadButtons(container);
  }

  // ============================================
  // Exploration Panel (floating, per-file, fully decoupled from Tab mode)
  // ============================================
  // The panel is an independent tool — Tab is always a plain Tab. The user
  // opens/closes the panel from any of three context-menu entries; the panel
  // keeps its position/size per file. Closing the panel is not "leaving
  // exploration" — the next right-click shows the same panel toggle again.
  const explorationPanels = new Map();

  function getOrCreateExplorationPanel(tab) {
    if (!tab || !tab.path.toLowerCase().endsWith('.md')) return null;
    let panel = explorationPanels.get(tab.path);
    if (!panel) {
      panel = new window.ExplorationUI({
        filePath: tab.path,
        fileContent: tab.content
      });
      explorationPanels.set(tab.path, panel);
    } else {
      panel.fileContent = tab.content;
    }
    return panel;
  }

  function closeExplorationPanelForFile(filePath) {
    const panel = explorationPanels.get(filePath);
    if (panel) {
      panel.unmount();
      explorationPanels.delete(filePath);
    }
  }

  function closeAllExplorationPanels() {
    for (const [filePath, panel] of explorationPanels) {
      panel.unmount();
    }
    explorationPanels.clear();
  }

  /**
   * Toggle the exploration panel for a given file.
   * Opens it if closed, closes it if open. The Tab itself is not modified.
   */
  function toggleExplorationPanel(filePath) {
    if (!filePath || !filePath.toLowerCase().endsWith('.md')) return;
    let panel = explorationPanels.get(filePath);
    if (!panel) {
      // Find the tab for this file to get current content
      const tab = state.tabs.find(t => t.path === filePath);
      if (!tab) return;
      panel = getOrCreateExplorationPanel(tab);
    }
    if (!panel) return;
    if (panel.isOpen()) {
      panel.close();
    } else {
      panel.open();
    }
  }

  /**
   * Open the file in a normal Tab AND open the exploration panel for it.
   * Used by the file-tree right-click "Open exploration panel".
   */
  function openFileInExplorationMode(filePath) {
    const existingIndex = state.tabs.findIndex(t => t.path === filePath);
    if (existingIndex >= 0) {
      state.activeTab = existingIndex;
      renderTabs();
      loadTabContent(existingIndex);
      toggleExplorationPanel(filePath);
      return;
    }

    invoke('open_file', { path: filePath }).then(result => {
      if (result && result.content) {
        const tab = {
          path: result.path,
          content: result.content,
          baseDir: result.base_dir || '',
          name: getFileName(result.path),
          scrollTop: 0
        };
        state.tabs.push(tab);
        state.activeTab = state.tabs.length - 1;
        renderTabs();
        loadTabContent(state.activeTab);
        watchCurrentFile(result.path);
        saveUIState();
        toggleExplorationPanel(filePath);
      }
    }).catch(err => {
      console.error('Failed to open file in exploration mode:', err);
      showError('无法打开文件: ' + err);
    });
  }

  // ============================================
  // TOC (Table of Contents)
  // ============================================
  function buildTOC() {
    const headings = elements.markdownBody.querySelectorAll('h1, h2, h3, h4, h5, h6');
    state.headings = [];

    if (headings.length < CONFIG.tocMinItems) {
      elements.tocTree.innerHTML = '<p class="toc-empty">无目录内容</p>';
      return;
    }

    let tocHTML = '';
    headings.forEach((heading, index) => {
      const level = parseInt(heading.tagName.charAt(1));
      const text = heading.textContent.trim();
      const id = `heading-${index}`;

      // Add ID to heading for anchor linking
      heading.id = id;

      state.headings.push({ id, level, text, element: heading });

      tocHTML += `<a class="toc-item" data-level="${level}" data-id="${id}" href="#${id}">${escapeHtml(text)}</a>`;
    });

    elements.tocTree.innerHTML = tocHTML;

    // Add click handlers
    elements.tocTree.querySelectorAll('.toc-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        const targetId = item.dataset.id;
        const targetElement = document.getElementById(targetId);
        if (targetElement) {
          targetElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
          updateActiveTOCItem(targetId);
        }
      });
    });

    buildMinimap();
  }

  function buildMinimap() {
    if (!elements.sidebarMinimap) return;

    if (!state.headings.length) {
      elements.sidebarMinimap.innerHTML = '';
      return;
    }

    const docHeight = elements.markdownBody.scrollHeight;
    const minimapHeight = elements.sidebarMinimap.clientHeight || 400;
    const MIN_GAP = 3; // px

    let html = '';
    let lastBottom = -MIN_GAP;

    state.headings.forEach(h => {
      const pct = docHeight > 0 ? h.element.offsetTop / docHeight : 0;
      let top = Math.round(pct * minimapHeight);
      // Prevent overlapping
      if (top < lastBottom + MIN_GAP) {
        top = lastBottom + MIN_GAP;
      }
      lastBottom = top + 4; // approximate item height
      html += `<div class="minimap-item" data-level="${h.level}" data-id="${h.id}" title="${escapeHtml(h.text)}" style="top:${top}px"></div>`;
    });

    elements.sidebarMinimap.innerHTML = html;

    let tooltip = document.getElementById('minimap-tooltip');
    if (!tooltip) {
      tooltip = document.createElement('div');
      tooltip.id = 'minimap-tooltip';
      tooltip.className = 'minimap-tooltip';
      document.body.appendChild(tooltip);
    }

    elements.sidebarMinimap.querySelectorAll('.minimap-item').forEach(item => {
      item.addEventListener('click', () => {
        const target = document.getElementById(item.dataset.id);
        if (target) {
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
          updateActiveTOCItem(item.dataset.id);
        }
      });

      item.addEventListener('mouseenter', () => {
        tooltip.textContent = item.getAttribute('title');
        tooltip.classList.add('visible');
        positionMinimapTooltip(tooltip, item);
      });

      item.addEventListener('mouseleave', () => {
        tooltip.classList.remove('visible');
      });
    });
  }

  function positionMinimapTooltip(tooltip, item) {
    const rect = item.getBoundingClientRect();
    tooltip.style.left = (rect.right + 8) + 'px';
    tooltip.style.top = (rect.top + rect.height / 2) + 'px';
    tooltip.style.transform = 'translateY(-50%)';
  }

  function updateActiveTOCItem(activeId) {
    elements.tocTree.querySelectorAll('.toc-item').forEach(item => {
      item.classList.toggle('active', item.dataset.id === activeId);
    });
  }

  function handleScrollSync() {
    // Find the heading closest to the current scroll position
    const scrollTop = elements.markdownBody.scrollTop;
    let closestHeading = null;
    let closestDistance = Infinity;

    state.headings.forEach(h => {
      const distance = Math.abs(h.element.offsetTop - scrollTop);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestHeading = h;
      }
    });

    if (closestHeading) {
      updateActiveTOCItem(closestHeading.id);
    }
  }

  // ============================================
  // View Mode Toggle
  // ============================================
  function toggleSourceMode() {
    state.sourceMode = !state.sourceMode;

    // Close search when entering source mode
    if (state.sourceMode) {
      closeSearch();
    }

    elements.sourceToggle.classList.toggle('active', state.sourceMode);
    elements.markdownBody.style.display = state.sourceMode ? 'none' : 'block';
    elements.sourceView.style.display = state.sourceMode ? 'block' : 'none';

    // Update toggle button label
    const label = elements.sourceToggle.querySelector('.toggle-label');
    if (label) {
      label.textContent = state.sourceMode ? '渲染' : '源码';
    }
  }

  function toggleSidebar() {
    state.sidebarCollapsed = !state.sidebarCollapsed;
    elements.sidebar.classList.toggle('collapsed', state.sidebarCollapsed);
    saveUIState();
  }

  function toggleZenMode() {
    document.body.classList.toggle('zen-mode');
    const isZen = document.body.classList.contains('zen-mode');
    showToast(isZen ? '进入专注模式 (F11 退出)' : '退出专注模式');
  }

  function switchSidebarTab(tab) {
    state.sidebarActiveTab = tab;
    elements.tabFiles.classList.toggle('active', tab === 'files');
    elements.tabToc.classList.toggle('active', tab === 'toc');
    elements.filesPanel.classList.toggle('active', tab === 'files');
    elements.tocPanel.classList.toggle('active', tab === 'toc');
    saveUIState();
  }

  // ============================================
  // Recent Files
  // ============================================
  async function loadRecentFiles() {
    try {
      const files = await invoke('get_recent_files');
      state.recentFiles = files || [];
      renderRecentFiles();
    } catch (err) {
      console.error('Failed to load recent files:', err);
    }
  }

  function getModeIcon(mode) {
    switch (mode) {
      case 'learning': return '🎓';
      case 'paper': return '📄';
      case 'normal':
      default: return '📄';
    }
  }

  function getModeLabel(mode) {
    switch (mode) {
      case 'learning': return '课程';
      case 'paper': return '论文';
      case 'normal':
      default: return '';
    }
  }

  function renderRecentFiles() {
    if (!elements.recentFilesList || !elements.recentFilesSection) return;

    if (state.recentFiles.length === 0) {
      elements.recentFilesSection.style.display = 'none';
      return;
    }

    elements.recentFilesSection.style.display = '';
    elements.recentFilesList.innerHTML = '';

    state.recentFiles.forEach(entry => {
      const path = entry.path || entry;
      const mode = entry.mode || 'normal';
      const item = document.createElement('div');
      item.className = 'recent-file-item';
      item.title = path;

      const icon = document.createElement('span');
      icon.className = 'recent-file-mode-icon';
      icon.textContent = getModeIcon(mode);
      item.appendChild(icon);

      const name = document.createElement('span');
      name.className = 'recent-file-name';
      name.textContent = getFileName(path);
      item.appendChild(name);

      const label = getModeLabel(mode);
      if (label) {
        const tag = document.createElement('span');
        tag.className = 'recent-file-mode-tag';
        tag.textContent = label;
        item.appendChild(tag);
      }

      item.addEventListener('click', () => openRecentFile(entry));
      elements.recentFilesList.appendChild(item);
    });
  }

  // Pure routing logic for recent files: normalizes the backend mode label and
  // builds the workspace context for addTab. Extracted so it can be unit-tested.
  function resolveRecentFileRoute(entry, openResult) {
    const path = (entry && entry.path) || (typeof entry === 'string' ? entry : '');
    let mode = (entry && entry.mode) || 'normal';
    // Rust backend uses 'learning' for course projects.
    if (mode === 'learning') mode = 'course';
    if (mode !== 'normal' && mode !== 'course' && mode !== 'paper') {
      mode = 'normal';
    }
    const baseDir = (openResult && openResult.base_dir) || '';
    const workspaceContext = mode === 'course'
      // Course recent entries point at either the project folder or a chapter
      // file. projectPath must be the project ROOT (the chapter's parent dir),
      // not the chapter file — otherwise the course-scope guard in addTab
      // misfires on sibling chapters and switches back to normal mode.
      ? { projectPath: baseDir || path }
      : mode === 'paper'
        ? { activePaperPath: path, paperProjectPath: baseDir }
        : {};
    return { path, mode, baseDir, workspaceContext };
  }

  async function openRecentFile(entry) {
    try {
      const route = resolveRecentFileRoute(entry, null);

      // Course recent entries point at either the project folder or a chapter
      // file. Clicking one must (1) enter course mode with the project ROOT
      // as projectPath, and (2) if the entry is a chapter file, open that
      // chapter as a course tab. We must NOT call open_file on a folder path
      // (it fails with "no corresponding file").
      if (route.mode === 'course') {
        let projectPath = route.path;
        let chapterResult = null;
        try {
          const result = await invoke('open_file', { path: route.path });
          if (result && result.content) {
            // path is a chapter file — project root is its parent directory.
            projectPath = result.base_dir || route.path;
            chapterResult = result;
          }
        } catch (_) {
          // path is likely the project folder itself; open_file fails — fine.
        }
        const switched = await AppWorkspace.switchTo('course', {
          context: { projectPath }
        });
        if (!switched) return;
        // Restore the progress panel + orb + chapter list. Course onEnter
        // only loads the folder tree and badge; the bottom-right panel is
        // set up by project-resume. Without this, re-entering course from
        // recent leaves the panel hidden (it was hidden by course onExit)
        // until the user clicks the toolbar course button to toggle it.
        // loadProject's internal setLearningMode→switchTo('course') is a
        // no-op here (already in course), so no re-entry loop.
        if (window.LearningProjectResume && window.LearningProjectResume.loadProject) {
          await window.LearningProjectResume.loadProject(projectPath);
        }
        if (chapterResult) {
          await addTab(route.path, chapterResult.content, chapterResult.base_dir || '', {
            mode: 'course'
          });
        }
        return;
      }

      // Normal / paper: open the file and add a tab.
      const result = await invoke('open_file', { path: route.path });
      if (result && result.content) {
        const finalRoute = resolveRecentFileRoute(entry, result);
        addTab(finalRoute.path, result.content, finalRoute.baseDir, {
          mode: finalRoute.mode,
          workspaceContext: finalRoute.workspaceContext
        });
      }
    } catch (err) {
      console.error('Failed to open recent file:', err);
      showError('无法打开文件: ' + err);
    }
  }

  async function clearRecentFiles() {
    try {
      await invoke('clear_recent_files');
      state.recentFiles = [];
      renderRecentFiles();
    } catch (err) {
      console.error('Failed to clear recent files:', err);
    }
  }

  // ============================================
  // File Tree
  // ============================================
  async function openFolder() {
    try {
      const folderPath = await invoke('open_folder_dialog');
      if (folderPath) {
        state.currentFolder = folderPath;
        await loadFileTree(folderPath);
      }
    } catch (err) {
      if (err !== 'No folder selected') {
        console.error('Failed to open folder:', err);
        showError('无法打开文件夹: ' + err);
      }
    }
  }

  async function loadFileTree(folderPath) {
    try {
      const entries = await invoke('list_directory', { path: folderPath });
      renderFileTree(entries);
    } catch (err) {
      console.error('Failed to load file tree:', err);
      showError('无法加载文件树: ' + err);
    }
  }

  /**
   * Load a folder directly (without dialog) - used by learning mode
   */
  async function loadFolderPath(folderPath) {
    if (!folderPath) return;
    try {
      state.currentFolder = folderPath;
      await loadFileTree(folderPath);
      // Switch to files tab
      switchSidebarTab('files');
    } catch (err) {
      console.error('[loadFolderPath] Failed:', err);
    }
  }

  /**
   * Unload current folder and clear file tree - used when exiting learning mode
   */
  function unloadFolder() {
    state.currentFolder = null;
    if (elements.fileTree) {
      elements.fileTree.innerHTML = '<p class="file-tree-empty">未打开文件夹</p>';
    }
  }

  /**
   * Toggle learning mode visual indicator
   */
  // DOM-based confirm dialog (reliable in Tauri WebView where browser confirm() may not work)
  // Workspace accent colors, used by the confirm dialog chips and the
  // toolbar badges. Keep in sync with the CSS for body.{learning,paper}-mode.
  const WORKSPACE_COLORS = {
    normal: '#6b7280',
    course: '#8b5cf6',
    paper: '#f97316'
  };

  function _workspaceChip(label, workspaceId) {
    const chip = document.createElement('span');
    chip.className = 'workspace-chip';
    const color = WORKSPACE_COLORS[workspaceId] || '#6b7280';
    chip.style.cssText = `display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:9999px;font-size:13px;font-weight:600;color:#fff;background:${color};white-space:nowrap;`;
    chip.textContent = label;
    return chip;
  }

  // Render a confirmation dialog. Accepts either a plain string (legacy) or
  // a structured payload { from, fromId, to, toId, impact } so the current
  // and target workspaces can be visually emphasized.
  function _showConfirm(payload) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:99999;';
      const box = document.createElement('div');
      box.style.cssText = 'background:var(--color-bg-primary,#fff);border-radius:12px;padding:24px;max-width:460px;box-shadow:0 20px 60px rgba(0,0,0,0.3);font-family:inherit;';

      if (payload && typeof payload === 'object' && payload.from && payload.to) {
        // Structured: title + from→to chips + impact line.
        const title = document.createElement('div');
        title.style.cssText = 'margin:0 0 14px;font-size:15px;font-weight:600;color:var(--color-text-primary,#1f2937);';
        title.textContent = '切换工作区';
        box.appendChild(title);

        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;gap:10px;margin-bottom:16px;flex-wrap:wrap;';
        row.appendChild(_workspaceChip(payload.from, payload.fromId));
        const arrow = document.createElement('span');
        arrow.style.cssText = 'color:var(--color-text-tertiary,#9ca3af);font-size:16px;';
        arrow.textContent = '→';
        row.appendChild(arrow);
        row.appendChild(_workspaceChip(payload.to, payload.toId));
        box.appendChild(row);

        if (payload.impact) {
          const impact = document.createElement('p');
          impact.style.cssText = 'margin:0 0 20px;font-size:13px;line-height:1.6;color:var(--color-text-secondary,#4a4a68);white-space:pre-wrap;';
          impact.textContent = payload.impact;
          box.appendChild(impact);
        }
      } else {
        // Legacy plain-text message.
        const msg = typeof payload === 'string' ? payload : String(payload);
        const p = document.createElement('p');
        p.style.cssText = 'margin:0 0 20px;font-size:14px;line-height:1.6;color:var(--color-text-primary,#1f2937);white-space:pre-wrap;';
        p.textContent = msg;
        box.appendChild(p);
      }

      const btnRow = document.createElement('div');
      btnRow.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;';
      const cancelBtn = document.createElement('button');
      cancelBtn.textContent = '取消';
      cancelBtn.style.cssText = 'padding:8px 16px;border-radius:6px;border:1px solid var(--color-border,#e5e7eb);background:var(--color-bg-primary,#fff);cursor:pointer;font-size:14px;font-family:inherit;color:var(--color-text-primary,#1f2937);';
      const okBtn = document.createElement('button');
      okBtn.textContent = '确认切换';
      okBtn.style.cssText = 'padding:8px 16px;border-radius:6px;border:none;background:#2563eb;color:#fff;cursor:pointer;font-size:14px;font-family:inherit;';
      btnRow.appendChild(cancelBtn);
      btnRow.appendChild(okBtn);
      box.appendChild(btnRow);
      overlay.appendChild(box);
      document.body.appendChild(overlay);
      cancelBtn.focus();
      cancelBtn.addEventListener('click', () => { overlay.remove(); resolve(false); });
      okBtn.addEventListener('click', () => { overlay.remove(); resolve(true); });
    });
  }

  // ============================================
  // AppWorkspace State Machine
  // ============================================
  // Unified workspace management for Normal / Course / Paper modes.
  // Each workspace registers lifecycle hooks; transitions are driven by a
  // declarative rule table so adding a new workspace only requires a new
  // registry entry.
  const AppWorkspace = {
    registry: new Map(),
    switching: false,

    register(spec) {
      if (!spec || !spec.id) throw new Error('Workspace spec must have an id');
      this.registry.set(spec.id, spec);
    },

    getCurrent() {
      return state.workspace.current;
    },

    isIn(workspaceId) {
      return state.workspace.current === workspaceId;
    },

    getContext() {
      return state.workspace.context;
    },

    setContext(patch) {
      Object.assign(state.workspace.context, patch);
    },

    _getRule(from, to) {
      // Exact match first, then wildcard rules
      const exact = TransitionRules.find(r => r.from === from && r.to === to);
      if (exact) return exact;
      const fromWildcard = TransitionRules.find(r => r.from === '*' && r.to === to);
      if (fromWildcard) return fromWildcard;
      const toWildcard = TransitionRules.find(r => r.from === from && r.to === '*');
      if (toWildcard) return toWildcard;
      const bothWildcard = TransitionRules.find(r => r.from === '*' && r.to === '*');
      return bothWildcard || null;
    },

    async switchTo(targetId, options = {}) {
      if (this.switching) return false;
      const fromId = state.workspace.current;
      if (fromId === targetId) return true;

      const spec = this.registry.get(targetId);
      if (!spec) {
        console.error('[AppWorkspace] Unknown workspace:', targetId);
        return false;
      }

      const context = options.context || {};
      if (spec.canEnter && !spec.canEnter(context)) {
        showError(`无法进入 ${spec.displayName || targetId} 工作区`);
        return false;
      }

      const rule = this._getRule(fromId, targetId);
      if (rule && (rule.confirm || rule.impact) && !options.skipConfirm) {
        const fromSpec = this.registry.get(fromId);
        const payload = {
          from: fromSpec ? fromSpec.displayName : fromId,
          fromId,
          to: spec.displayName || targetId,
          toId: targetId,
          impact: typeof rule.impact === 'function'
            ? rule.impact(fromId, targetId, options)
            : rule.impact
        };
        // Legacy string rule (confirm) — pass through as plain text.
        const legacy = typeof rule.confirm === 'function'
          ? rule.confirm(fromId, targetId, options)
          : rule.confirm;
        const ok = legacy
          ? await _showConfirm(legacy)
          : await _showConfirm(payload);
        if (!ok) return false;
      }

      this.switching = true;
      try {
        // Exit current workspace
        const fromSpec = this.registry.get(fromId);
        if (fromSpec && fromSpec.onExit) {
          await fromSpec.onExit(targetId);
        }

        // Clean up exploration panels when leaving Normal workspace
        closeAllExplorationPanels();

        // Close all tabs from previous workspace
        closeAllTabs();

        // Switch state
        state.workspace.current = targetId;
        state.workspace.context = { ...context };

        // Apply body class for CSS
        document.body.classList.remove('learning-mode', 'paper-reader-mode');
        if (spec.bodyClass) {
          document.body.classList.add(spec.bodyClass);
        }

        // Enter target workspace
        if (spec.onEnter) {
          await spec.onEnter(fromId, options);
        }

        return true;
      } catch (err) {
        console.error('[AppWorkspace] Failed to switch workspace:', err);
        showError('工作区切换失败: ' + err.message);
        return false;
      } finally {
        this.switching = false;
      }
    }
  };

  // Expose globally for sub-modules
  window.AppWorkspace = AppWorkspace;

  // Transition rule table: define which workspace switches need confirmation.
  // The confirm value can be a string or a function returning a string.
  // Transition rule table. `impact` describes the consequence of the switch
  // (the from→to pair is rendered separately as colored chips). The chips
  // already say "常规模式 → 课程模式", so impact only needs to explain *what
  // happens to the current content*.
  const TransitionRules = [
    { from: 'normal', to: 'course', impact: '当前常规文档将被关闭，你可以在最近打开里找回它们。课程模式会加载选定项目的章节树与学习进度。' },
    { from: 'course', to: 'normal', impact: '将关闭当前课程的所有章节标签。若章节生成仍在进行，会被中断；项目进度已保存，下次进入课程可继续。' },
    { from: 'normal', to: 'paper', impact: '当前常规文档将被关闭，你可以在最近打开里找回它们。论文导读会为论文生成或加载 AI 导读。' },
    { from: 'paper', to: 'normal', impact: '将关闭当前论文标签。你的阅读进度与导读已保留，下次打开同一篇论文会恢复。' },
    { from: 'course', to: 'paper', impact: '将关闭当前课程的所有章节标签（项目进度已保存）。随后进入论文导读。' },
    { from: 'paper', to: 'course', impact: '将关闭当前论文标签（阅读进度已保留）。随后进入课程模式。' }
  ];

  function closeAllTabs() {
    state.tabs = [];
    state.activeTab = -1;
    renderTabs();
    showWelcome();
  }

  async function setLearningMode(enabled, projectPath) {
    // Compatibility wrapper around the unified AppWorkspace state machine.
    if (enabled && projectPath) {
      await AppWorkspace.switchTo('course', { context: { projectPath } });
    } else if (!enabled) {
      await AppWorkspace.switchTo('normal');
    }
  }

  function _updateSocraticButtonState(forceVisible = false) {
    const socraticBtn = document.getElementById('openSocraticBtn');
    if (!socraticBtn) return;
    const devOn = window.SocraticTrigger?.isDevQuickTriggerEnabled?.();
    const inLearning = AppWorkspace.isIn('course');
    const visible = devOn || (inLearning && forceVisible);

    socraticBtn.style.display = visible ? '' : 'none';
    socraticBtn.title = devOn
      ? '立即 Socratic 复习 (Ctrl+Shift+S) — DEV 已启用'
      : 'Socratic 快捷入口';
    socraticBtn.style.opacity = devOn ? '1' : '0.7';
  }

  function registerWorkspaces() {
    AppWorkspace.register({
      id: 'normal',
      displayName: '常规模式',
      bodyClass: null,
      canEnter() { return true; },
      async onEnter() {
        // Normal workspace is the default; nothing special to set up.
      },
      async onExit() {
        // Cleanup is handled by closeAllTabs and closeAllExplorationPanels.
      }
    });

    AppWorkspace.register({
      id: 'course',
      displayName: '课程模式',
      bodyClass: 'learning-mode',
      canEnter(ctx) { return !!ctx.projectPath; },
      async onEnter(fromId, options) {
        const projectPath = options.context?.projectPath;
        if (!projectPath) return;

        // Track learning project in recent files with the correct mode badge.
        invoke('add_recent_file', { path: projectPath, mode: 'learning' })
          .then(() => loadRecentFiles())
          .catch(err => console.error('Failed to track learning project:', err));

        // Load project folder tree.
        await loadFolderPath(projectPath);

        // Insert course badge in toolbar.
        let badge = document.getElementById('learningModeBadge');
        if (!badge) {
          badge = document.createElement('span');
          badge.id = 'learningModeBadge';
          badge.className = 'workspace-badge learning-mode-badge';
          badge.textContent = '🎓 课程模式';
          const toolbarRight = document.querySelector('.toolbar-right');
          if (toolbarRight) {
            toolbarRight.insertBefore(badge, toolbarRight.firstChild);
          }
        }
        badge.title = '点击退出课程模式';
        badge.onclick = () => AppWorkspace.switchTo('normal');

        _updateSocraticButtonState();
      },
      async onExit(toId) {
        // Hide progress panel and orb.
        const panel = document.getElementById('learningProgressPanel');
        const orb = document.getElementById('learningModeOrb');
        if (panel) panel.style.display = 'none';
        if (orb) orb.style.display = 'none';

        // Remove course badge.
        const badge = document.getElementById('learningModeBadge');
        if (badge) badge.remove();

        // Teardown learning mode integrations.
        if (window.LearningModeIntegration) {
          window.LearningModeIntegration.teardown();
        }

        // Unload folder tree.
        unloadFolder();

        _updateSocraticButtonState();
      }
    });

    AppWorkspace.register({
      id: 'paper',
      displayName: '论文导读',
      bodyClass: 'paper-reader-mode',
      canEnter() { return true; },
      async onEnter(fromId, options) {
        // The paper reader's reading-order nav is hosted in the left TOC
        // panel, so we want the sidebar VISIBLE and on the TOC tab (the
        // opposite of the old overlay model which collapsed the sidebar).
        paperReaderSidebarWasCollapsed = state.sidebarCollapsed;
        if (state.sidebarCollapsed) toggleSidebar();
        switchSidebarTab('toc');

        // Insert paper badge in toolbar (orange accent, mirrors course badge).
        let badge = document.getElementById('paperReaderBadge');
        if (!badge) {
          badge = document.createElement('span');
          badge.id = 'paperReaderBadge';
          badge.className = 'workspace-badge paper-reader-badge';
          badge.textContent = '📄 论文导读';
          const toolbarRight = document.querySelector('.toolbar-right');
          if (toolbarRight) {
            toolbarRight.insertBefore(badge, toolbarRight.firstChild);
          }
        }
        badge.title = '点击退出论文导读';
        badge.onclick = () => AppWorkspace.switchTo('normal');

        const ctx = options.context || {};
        AppWorkspace.setContext(ctx);

        if (ctx.activePaperPath) {
          // Opened from recent files or direct invocation: create a paper tab.
          try {
            const result = await invoke('open_file', { path: ctx.activePaperPath });
            if (result && result.content) {
              await addTab(result.path, result.content, result.base_dir || '', {
                mode: 'paper',
                workspaceContext: {
                  activePaperPath: result.path,
                  paperProjectPath: result.base_dir || ''
                }
              });
              return;
            }
          } catch (err) {
            console.error('[PaperWorkspace] Failed to open paper file:', err);
            showError('无法打开论文文件: ' + err);
          }
        }

        // No paper file specified: show welcome screen.
        if (window.PaperReaderIntegration) {
          window.PaperReaderIntegration.showWelcome(elements.markdownBody);
        }
      },
      async onExit(toId) {
        // Remove paper badge.
        const badge = document.getElementById('paperReaderBadge');
        if (badge) badge.remove();

        if (window.PaperReaderIntegration) {
          window.PaperReaderIntegration.teardown();
        }
        // Restore the TOC panel placeholder (the paper reader sidebar was
        // hosted there; teardown already detached it via reader.close()).
        if (elements.tocTree) {
          elements.tocTree.innerHTML = '<p class="toc-empty">打开文件以显示目录</p>';
        }
        // Re-collapse the sidebar if it was collapsed before entry (we
        // expanded it on enter to host the reading-order nav).
        if (paperReaderSidebarWasCollapsed === true && !state.sidebarCollapsed) {
          toggleSidebar();
        }
        paperReaderSidebarWasCollapsed = null;
      }
    });
  }

  function renderFileTree(entries, container = null, depth = 0) {
    const target = container || elements.fileTree;

    if (!entries || entries.length === 0) {
      if (!container) {
        target.innerHTML = '<p class="file-tree-empty">此文件夹为空</p>';
      }
      return;
    }

    if (!container) {
      target.innerHTML = '';
    }

    const ul = document.createElement('ul');
    ul.className = 'file-tree-list';
    ul.style.margin = '0';
    ul.style.padding = '0';

    const basePadding = 12;
    const indent = 16;

    entries.forEach(entry => {
      const li = document.createElement('li');
      li.style.listStyle = 'none';

      const item = document.createElement('div');
      item.className = 'file-tree-item' + (entry.is_dir ? ' is-dir' : ' is-file');
      item.dataset.path = entry.path;
      item.dataset.isDir = entry.is_dir;

      const itemPadding = basePadding + (depth * indent);
      item.style.paddingLeft = `${itemPadding}px`;

      let iconHtml = '';
      if (entry.is_dir) {
        const hasChildren = entry.children && entry.children.length > 0;
        iconHtml = hasChildren
          ? '<span class="tree-chevron">▶</span>'
          : '<span class="tree-chevron" style="visibility:hidden">▶</span>';
        iconHtml += '<span class="tree-icon">📁</span>';
      } else {
        iconHtml = '<span class="tree-icon">📄</span>';
      }

      item.innerHTML = iconHtml + `<span class="tree-label">${escapeHtml(entry.name)}</span>`;

      item.addEventListener('click', (e) => {
        e.stopPropagation();
        if (entry.is_dir) {
          toggleDir(item);
        } else {
          openTreeFile(entry.path);
        }
      });

      if (!entry.is_dir && entry.path.toLowerCase().endsWith('.md')) {
        item.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          showFileTreeContextMenu(e, entry.path);
        });
      }

      li.appendChild(item);

      if (entry.is_dir && entry.children && entry.children.length > 0) {
        const childrenContainer = document.createElement('div');
        childrenContainer.className = 'file-tree-children';
        renderFileTree(entry.children, childrenContainer, depth + 1);
        li.appendChild(childrenContainer);
      }

      ul.appendChild(li);
    });

    target.appendChild(ul);
  }

  function toggleDir(item) {
    const li = item.closest('li');
    if (!li) return;
    const children = li.querySelector('.file-tree-children');
    const chevron = item.querySelector('.tree-chevron');

    if (children) {
      const isExpanded = children.classList.toggle('expanded');
      if (chevron) {
        chevron.textContent = isExpanded ? '▼' : '▶';
      }
    }
  }

  async function openTreeFile(filePath) {
    try {
      const result = await invoke('open_file', { path: filePath });
      if (result && result.content) {
        addTab(result.path, result.content, result.base_dir || '');
      }
    } catch (err) {
      console.error('Failed to open file from tree:', err);
      showError('无法打开文件: ' + err);
    }
  }

  // ============================================
  // File Tree Search Filter
  // ============================================
  function filterFileTree(query) {
    const items = elements.fileTree.querySelectorAll('.file-tree-item');
    const lowerQuery = query.toLowerCase().trim();

    if (!lowerQuery) {
      items.forEach(item => {
        item.style.display = '';
        const li = item.closest('li');
        if (li) li.style.display = '';
      });
      // Collapse all directories when clearing search
      elements.fileTree.querySelectorAll('.file-tree-children.expanded').forEach(children => {
        children.classList.remove('expanded');
        const chevron = children.closest('li').querySelector('.tree-chevron');
        if (chevron) chevron.textContent = '▶';
      });
      return;
    }

    // Track which directories have visible descendants
    const dirHasMatch = new Map();

    items.forEach(item => {
      const isDir = item.classList.contains('is-dir');
      const label = item.querySelector('.tree-label');
      const name = label ? label.textContent.toLowerCase() : '';
      const matches = name.includes(lowerQuery);

      if (isDir) {
        dirHasMatch.set(item, matches);
      } else {
        item.style.display = matches ? '' : 'none';
        const li = item.closest('li');
        if (li) li.style.display = matches ? '' : 'none';
      }
    });

    // Second pass: determine directory visibility based on children
    // Process from deepest to shallowest by sorting path depth descending
    const dirItems = Array.from(items).filter(item => item.classList.contains('is-dir'));
    dirItems.sort((a, b) => {
      const depthA = (a.dataset.path.match(/[\/]/g) || []).length;
      const depthB = (b.dataset.path.match(/[\/]/g) || []).length;
      return depthB - depthA;
    });

    dirItems.forEach(dirItem => {
      const li = dirItem.closest('li');
      if (!li) return;

      const childrenContainer = li.querySelector('.file-tree-children');
      let hasVisibleChild = false;

      if (childrenContainer) {
        const childItems = childrenContainer.querySelectorAll('.file-tree-item');
        hasVisibleChild = Array.from(childItems).some(child => child.style.display !== 'none');
      }

      const selfMatches = dirHasMatch.get(dirItem) || false;
      const shouldShow = selfMatches || hasVisibleChild;

      dirItem.style.display = shouldShow ? '' : 'none';
      li.style.display = shouldShow ? '' : 'none';

      if (shouldShow && childrenContainer) {
        childrenContainer.classList.add('expanded');
        const chevron = dirItem.querySelector('.tree-chevron');
        if (chevron) chevron.textContent = '▼';
      }
    });
  }

  // ============================================
  // Initialization Functions
  // ============================================
  function initCodeHighlighting(container = elements.markdownBody) {
    if (typeof Prism !== 'undefined') {
      // Process all code blocks
      const codeBlocks = container.querySelectorAll('pre code[class*="language-"]');
      codeBlocks.forEach(code => {
        const pre = code.parentElement;
        const language = getLanguageFromClass(code.className);

        if (language && language !== 'mermaid') {
          pre.setAttribute('data-language', language);
          addCodeBlockActions(pre, code);
          Prism.highlightElement(code);
        }
      });
    }
  }

  function getLanguageFromClass(className) {
    const match = className.match(/language-(\w+)/);
    return match ? match[1].toLowerCase() : null;
  }

  function addCodeBlockActions(pre, code) {
    const actions = document.createElement('div');
    actions.className = 'code-block-actions';

    // Download button
    const downloadBtn = document.createElement('button');
    downloadBtn.className = 'code-block-btn';
    downloadBtn.textContent = '⬇️';
    downloadBtn.title = '下载代码块';
    downloadBtn.type = 'button';
    downloadBtn.addEventListener('click', () => {
      const language = pre.getAttribute('data-language') || 'txt';
      const ext = getLanguageExtension(language);
      const content = code.textContent;
      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
      triggerDownload(blob, `code.${ext}`);
    });

    // Copy button
    const copyBtn = document.createElement('button');
    copyBtn.className = 'code-block-btn';
    copyBtn.textContent = 'Copy';
    copyBtn.type = 'button';

    copyBtn.addEventListener('click', async () => {
      try {
        await copyToClipboard(code.textContent);
        copyBtn.textContent = 'Copied!';
        copyBtn.classList.add('copied');
        setTimeout(() => {
          copyBtn.textContent = 'Copy';
          copyBtn.classList.remove('copied');
        }, 2000);
      } catch (err) {
        copyBtn.textContent = 'Failed';
        setTimeout(() => copyBtn.textContent = 'Copy', 2000);
      }
    });

    actions.appendChild(downloadBtn);
    actions.appendChild(copyBtn);
    pre.appendChild(actions);
  }

  async function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
  }

  function initMathRendering(container = elements.markdownBody) {
    if (typeof renderMathInElement !== 'undefined') {
      renderMathInElement(container, {
        delimiters: [
          { left: '$$', right: '$$', display: true },
          { left: '\\[', right: '\\]', display: true },
          { left: '$', right: '$', display: false },
          { left: '\\(', right: '\\)', display: false }
        ],
        throwOnError: false
      });
    }
  }

  async function initMermaid(container = elements.markdownBody) {
    if (typeof mermaid === 'undefined') return;

    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    mermaid.initialize({
      startOnLoad: false,
      theme: isDark ? CONFIG.mermaidTheme.dark : CONFIG.mermaidTheme.light,
      securityLevel: 'loose'
    });

    // Find and validate mermaid blocks
    const mermaidBlocks = container.querySelectorAll('.mermaid, pre code.language-mermaid');
    const canValidate = typeof mermaid.parse === 'function';
    const validBlocks = [];

    for (let i = 0; i < mermaidBlocks.length; i++) {
      const block = mermaidBlocks[i];
      let content, preElement;

      if (block.tagName === 'CODE') {
        preElement = block.parentElement;
        content = block.textContent;
      } else {
        preElement = block;
        content = block.textContent;
      }

      let isValid = true;
      let parseError = '';

      if (canValidate) {
        try {
          const parseResult = mermaid.parse(content.trim(), { suppressErrors: true });
          if (parseResult && typeof parseResult.then === 'function') {
            const result = await parseResult;
            if (result === false || (result && result.valid === false)) {
              isValid = false;
              parseError = result && result.error ? String(result.error) : '语法错误';
            }
          } else if (parseResult === false) {
            isValid = false;
            parseError = '语法错误';
          }
        } catch (err) {
          isValid = false;
          parseError = err.message || String(err);
        }
      }

      if (isValid) {
        validBlocks.push({ block, index: i, content, preElement });
      } else {
        showMermaidFixUI(preElement, content, parseError || '语法错误');
      }
    }

    // Convert code blocks to mermaid format
    validBlocks.forEach(({ block, index, content, preElement }) => {
      if (block.tagName === 'CODE') {
        preElement.outerHTML = `<pre class="mermaid" id="mermaid-${index}">${escapeHtml(content)}</pre>`;
      }
    });

    // Render all mermaid blocks
    if (mermaidBlocks.length > 0) {
      try {
        await mermaid.run();
      } catch (err) {
        console.error('Mermaid render error:', err);
      }
    }
  }

  function showMermaidFixUI(preElement, code, errorMessage) {
    const wrapper = document.createElement('div');
    wrapper.className = 'mermaid-error-wrapper';
    wrapper.innerHTML = `
      <div class="mermaid-error-header">
        <span class="mermaid-error-icon">⚠️</span>
        <span class="mermaid-error-text">Mermaid 语法错误</span>
      </div>
      <div class="mermaid-error-detail">${escapeHtml(errorMessage)}</div>
      <pre class="mermaid-error-code"><code>${escapeHtml(code)}</code></pre>
      <button class="mermaid-fix-btn" data-code="${encodeURIComponent(code.trim())}" data-error="${encodeURIComponent(errorMessage)}">
        🤖 AI 修复
      </button>
    `;

    preElement.parentNode.replaceChild(wrapper, preElement);

    wrapper.querySelector('.mermaid-fix-btn').addEventListener('click', async (e) => {
      const btn = e.target;
      btn.textContent = '修复中...';
      btn.disabled = true;

      try {
        const fixed = await invoke('fix_mermaid', {
          code: decodeURIComponent(btn.dataset.code),
          error: decodeURIComponent(btn.dataset.error)
        });

        if (fixed) {
          renderMermaidFixSuccess(wrapper, code.trim(), fixed);
        }
      } catch (err) {
        btn.textContent = '🤖 AI 修复';
        btn.disabled = false;
        showError('AI 修复失败: ' + err);
      }
    });
  }

  /**
   * Sprint 5: 修复成功后展示双按钮 — 应用到源文件 / 仅本次会话
   * 修复 [[feedback_brainstorm_ux_gap]]：补上状态机的退出路径 + 持久化机制
   */
  function renderMermaidFixSuccess(wrapper, brokenCode, fixedCode) {
    const inner = wrapper.querySelector('.mermaid-error-code code');
    inner.textContent = fixedCode;

    // 替换按钮区为双按钮
    const oldBtn = wrapper.querySelector('.mermaid-fix-btn');
    if (oldBtn) oldBtn.remove();

    const actions = document.createElement('div');
    actions.className = 'mermaid-fix-actions';
    actions.innerHTML = `
      <button class="mermaid-fix-btn mermaid-fix-btn-primary">✓ 应用到源文件</button>
      <button class="mermaid-fix-btn mermaid-fix-btn-secondary">仅本次会话</button>
    `;
    wrapper.appendChild(actions);

    const sourcePath = (state.tabs[state.activeTab] && state.tabs[state.activeTab].path) || '';

    actions.querySelector('.mermaid-fix-btn-primary').addEventListener('click', async (e) => {
      const btn = e.target;
      btn.textContent = '保存中...';
      btn.disabled = true;
      try {
        await applyMermaidFixToSource(sourcePath, brokenCode, fixedCode, wrapper);
      } catch (err) {
        // applyMermaidFixToSource 内部已处理错误并恢复 DOM/按钮
        console.error('applyMermaidFixToSource failed:', err);
      }
    });

    actions.querySelector('.mermaid-fix-btn-secondary').addEventListener('click', () => {
      // 仅本次会话：替换 DOM 但不写源文件
      const newPre = document.createElement('pre');
      newPre.className = 'mermaid';
      newPre.textContent = fixedCode;
      wrapper.parentNode.replaceChild(newPre, wrapper);
      if (typeof mermaid !== 'undefined' && mermaid.run) {
        mermaid.run({ nodes: [newPre] });
      }
      showToast('Mermaid 已修复（仅本次会话）');
    });
  }

  /**
   * 将修复写回源文件，并同步 tab.content。
   * 失败时回滚按钮状态，由 showError 展示原因。
   */
  async function applyMermaidFixToSource(sourcePath, brokenCode, fixedCode, wrapper) {
    // 1. 校验 tab 仍在（防用户切换）
    const tab = state.tabs[state.activeTab];
    if (!tab || tab.path !== sourcePath) {
      showError('文件已被切换，请重新打开');
      return;
    }

    if (!window.MermaidSourceReplace) {
      showError('修复模块未加载');
      return;
    }

    // 2. 在 tab.content 中定位并替换
    const result = window.MermaidSourceReplace.replaceMermaidInSource(
      tab.content, brokenCode, fixedCode
    );

    if (!result.ok) {
      // 找不到：降级为仅本次会话 + 警告
      showError('源文件已变更，无法定位原 Mermaid 块');
      const newPre = document.createElement('pre');
      newPre.className = 'mermaid';
      newPre.textContent = fixedCode;
      wrapper.parentNode.replaceChild(newPre, wrapper);
      if (typeof mermaid !== 'undefined' && mermaid.run) {
        mermaid.run({ nodes: [newPre] });
      }
      return;
    }

    // 3. 写文件
    if (result.warning) showToast(result.warning);

    try {
      state.selfChangePending = true;
      await invoke('write_file', { path: tab.path, content: result.newSource });
    } catch (err) {
      // 写失败：回滚按钮可点状态
      showError('保存失败: ' + err);
      const primary = wrapper.querySelector('.mermaid-fix-btn-primary');
      if (primary) {
        primary.textContent = '✓ 应用到源文件';
        primary.disabled = false;
      }
      return;
    }

    // 4. 同步 tab.content + 替换 DOM
    tab.content = result.newSource;
    if (elements.sourceCode) elements.sourceCode.textContent = result.newSource;

    const newPre = document.createElement('pre');
    newPre.className = 'mermaid';
    newPre.textContent = fixedCode;
    wrapper.parentNode.replaceChild(newPre, wrapper);
    if (typeof mermaid !== 'undefined' && mermaid.run) {
      mermaid.run({ nodes: [newPre] });
    }

    showToast('已修复并保存到源文件');
  }

  function replaceBrokenImage(img) {
    if (img.hasAttribute('data-error-handled')) return;
    img.setAttribute('data-error-handled', 'true');

    const fileName = img.alt || img.src.split('/').pop() || '未知图片';
    const isNetwork = img.src.startsWith('http');
    const placeholder = document.createElement('div');
    placeholder.className = 'image-error-placeholder';
    placeholder.title = img.src;

    placeholder.innerHTML =
      '<div class="image-error-icon">📄</div>' +
      '<div class="image-error-name">' + escapeHtml(fileName) + '</div>' +
      '<div class="image-error-hint">' + (isNetwork ? '图片加载失败' : '图片不存在') + '</div>';

    if (img.parentNode) {
      img.parentNode.replaceChild(placeholder, img);
    }
  }

  function initImageHandling(container = elements.markdownBody) {
    const images = container.querySelectorAll('img');
    images.forEach(img => {
      // Error handling - replace broken image with friendly placeholder
      img.addEventListener('error', function() {
        replaceBrokenImage(this);
      });

      // If image already failed (error fired before listener was attached)
      if (img.complete && img.naturalWidth === 0) {
        replaceBrokenImage(img);
      }

      // Lightbox
      if (!img.hasAttribute('data-lightbox-handled')) {
        img.setAttribute('data-lightbox-handled', 'true');
        img.style.cursor = 'zoom-in';

        img.addEventListener('click', function(e) {
          if (!this.hasAttribute('data-error')) {
            e.preventDefault();
            openLightbox(this);
          }
        });
      }
    });
  }

  // ============================================
  // Resolve Image Paths
  // ============================================
  function resolveImagePaths(baseDir, container = elements.markdownBody) {
    const images = container.querySelectorAll('img');
    const convertFileSrc = window.__TAURI__?.core?.convertFileSrc;

    images.forEach(img => {
      const src = img.getAttribute('src');
      if (src && !src.startsWith('http') && !src.startsWith('data:') && !src.startsWith('file:') && !src.startsWith('asset:')) {
        // Convert relative path to absolute path using segment-based approach
        let absolutePath = src;

        // Normalize paths relative to baseDir
        if (src.startsWith('./')) {
          absolutePath = baseDir + '/' + src.substring(2);
        } else if (src.startsWith('../')) {
          // Split baseDir into segments and navigate up
          let segments = baseDir.split(/[\\/]+/).filter(s => s.length > 0);
          let relPath = src;

          // Count and remove '../' prefixes
          while (relPath.startsWith('../')) {
            if (segments.length > 0) {
              segments.pop();
            }
            relPath = relPath.substring(3);
          }

          absolutePath = segments.join('/') + '/' + relPath;
        } else if (!src.startsWith('/')) {
          // Path without ./ prefix, relative to baseDir
          absolutePath = baseDir + '/' + src;
        }

        // Normalize backslashes
        absolutePath = absolutePath.replace(/\\/g, '/');

        // Use Tauri's convertFileSrc to get a webview-safe URL
        if (convertFileSrc) {
          // Note: convertFileSrc may double-encode non-ASCII characters in some Tauri versions
          // Decode once to get correct URL encoding
          let safeUrl = convertFileSrc(absolutePath);
          // Check for double-encoding (%25 indicates % was encoded again)
          if (safeUrl.includes('%25')) {
            safeUrl = decodeURIComponent(safeUrl);
          }
          img.setAttribute('src', safeUrl);
          console.log('[DEBUG] Resolved image:', src, '->', safeUrl);
        } else {
          console.error('[ERROR] Tauri convertFileSrc not available');
        }
      }
    });
  }

  // ============================================
  // Task List Interaction
  // ============================================
  function initTaskListInteraction(container = elements.markdownBody) {
    const checkboxes = container.querySelectorAll('input[type="checkbox"]');
    checkboxes.forEach((cb, index) => {
      cb.addEventListener('change', async () => {
        const tab = state.tabs[state.activeTab];
        if (!tab) return;
        const lines = tab.content.split('\n');
        let cbIndex = 0;
        let found = false;
        for (let i = 0; i < lines.length; i++) {
          const match = lines[i].match(/^- \[[ x]\] /);
          if (match) {
            if (cbIndex === index) {
              const newState = cb.checked ? 'x' : ' ';
              lines[i] = lines[i].replace(/^- \[[ x]\] /, `- [${newState}] `);
              found = true;
              break;
            }
            cbIndex++;
          }
        }
        if (found) {
          const newContent = lines.join('\n');
          tab.content = newContent;
          elements.sourceCode.textContent = newContent;
          state.selfChangePending = true;
          try {
            await invoke('write_file', { path: tab.path, content: newContent });
          } catch (err) {
            console.error('Failed to save file:', err);
            showError('保存失败: ' + err);
          }
        }
      });
    });
  }

  /**
   * Parse markdown into slide structure groups (v3)。
   *
   * 源码层只做结构切分，分页装箱由 slides iframe 渲染后按真实
   * DOM 高度测量完成（slides-pack-core / slides.js）：
   * - 显式模式：--- = 横页硬边界，-- = 纵页硬边界
   * - 自动模式：H1 分章（封面页），H2 及内容保留在章节单元内
   *
   * Skips YAML frontmatter and code blocks.
   */
  function slidesIsFenceLine(t) {
    return t.startsWith('```') || t.startsWith('~~~');
  }

  function slidesIsExplicitSeparator(lines, i) {
    // `---` 前必须是空行或文档开头（排除 Setext 二级标题）
    if (lines[i].trim() !== '---') return false;
    if (i === 0) return true;
    return lines[i - 1].trim() === '';
  }

  function slidesSkipYaml(lines) {
    if (lines.length > 0 && lines[0].trim() === '---') {
      for (let i = 1; i < lines.length; i++) {
        if (lines[i].trim() === '---') return i + 1;
      }
    }
    return 0;
  }

  function slidesHasExplicitSeparators(lines) {
    let inCode = false;
    const start = slidesSkipYaml(lines);
    for (let i = start; i < lines.length; i++) {
      const t = lines[i].trim();
      if (slidesIsFenceLine(t)) { inCode = !inCode; continue; }
      if (inCode) continue;
      if (slidesIsExplicitSeparator(lines, i)) return true;
    }
    return false;
  }

  function parseExplicitStructure(lines) {
    const groups = [];
    let currentUnit = [];
    let currentUnits = [];
    let inCodeBlock = false;
    let inYaml = false;
    let yamlStarted = false;

    function flushUnit() {
      const text = currentUnit.join('\n').trim();
      if (text) currentUnits.push(currentUnit.join('\n'));
      currentUnit = [];
    }

    function flushGroup() {
      flushUnit();
      if (currentUnits.length > 0) {
        groups.push({ cover: null, units: currentUnits });
      }
      currentUnits = [];
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const t = line.trim();

      if (slidesIsFenceLine(t)) { inCodeBlock = !inCodeBlock; currentUnit.push(line); continue; }
      if (inCodeBlock) { currentUnit.push(line); continue; }

      if (!yamlStarted && t === '---' && currentUnit.length === 0 && currentUnits.length === 0 && groups.length === 0) {
        inYaml = true;
        yamlStarted = true;
        continue;
      }
      if (inYaml && t === '---') { inYaml = false; continue; }
      if (inYaml) continue;

      if (slidesIsExplicitSeparator(lines, i)) { flushGroup(); continue; }
      if (t === '--') { flushUnit(); continue; }
      currentUnit.push(line);
    }
    flushGroup();
    return groups;
  }

  function parseAutoStructure(lines) {
    const groups = [];
    let currentContent = [];
    let inCodeBlock = false;
    const start = slidesSkipYaml(lines);

    function flushGroup(cover) {
      const text = currentContent.join('\n').trim();
      if (text) {
        groups.push({ cover: cover, units: [currentContent.join('\n')] });
      } else if (cover) {
        groups.push({ cover: cover, units: [] });
      }
      currentContent = [];
    }

    let pendingCover = null;
    for (let i = start; i < lines.length; i++) {
      const line = lines[i];
      const t = line.trim();
      if (slidesIsFenceLine(t)) { inCodeBlock = !inCodeBlock; currentContent.push(line); continue; }
      if (inCodeBlock) { currentContent.push(line); continue; }

      if (/^#\s/.test(t)) {
        flushGroup(pendingCover);
        pendingCover = t;
        continue;
      }
      currentContent.push(line);
    }
    flushGroup(pendingCover);
    return groups;
  }

  /**
   * 返回 [{ cover: string|null, units: string[] }]
   */
  function parseMarkdownStructure(content) {
    const lines = content.split('\n');
    if (slidesHasExplicitSeparators(lines)) {
      return parseExplicitStructure(lines);
    }
    return parseAutoStructure(lines);
  }

  async function openSlides() {
    const tab = state.tabs[state.activeTab];
    if (!tab || !tab.content) {
      showToast('请先打开一个 Markdown 文件');
      return;
    }

    if (document.getElementById('slides-overlay')) return;

    // Parse markdown into structure groups（v3：结构层切分，分页由 iframe 测量装箱）
    const groups = parseMarkdownStructure(tab.content);
    if (groups.length === 0) {
      showToast('未能解析出幻灯片内容');
      return;
    }

    // Render cover + units via Rust backend（并行，大文档更快）
    let renderedGroups;
    try {
      renderedGroups = await Promise.all(groups.map(async function(group) {
        const cover = group.cover
          ? await invoke('render_markdown', { content: group.cover })
          : null;
        const units = await Promise.all(group.units.map(function(unit) {
          return invoke('render_markdown', { content: unit });
        }));
        return { cover: cover, units: units };
      }));
    } catch (err) {
      console.error('Failed to render markdown for slides:', err);
      showToast('幻灯片渲染失败');
      return;
    }

    const overlay = document.createElement('div');
    overlay.id = 'slides-overlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:99999;background:#000;';

    const iframe = document.createElement('iframe');
    iframe.src = 'slides.html?v=' + Date.now();
    iframe.style.cssText = 'width:100%;height:100%;border:none;';

    iframe.addEventListener('load', () => {
      try {
        const cw = iframe.contentWindow;
        if (cw) {
          cw.__slides_groups = renderedGroups;
          cw.__slides_baseDir = tab.baseDir || '';
          cw.__slides_filePath = tab.path || '';
          if (typeof cw.__reloadSlides === 'function') {
            cw.__reloadSlides();
          } else {
            setTimeout(() => {
              if (typeof cw.__reloadSlides === 'function') {
                cw.__reloadSlides();
              }
            }, 300);
          }
        }
      } catch (e) {
        console.error('Failed to inject slides content:', e);
      }
    });

    overlay.appendChild(iframe);
    document.body.appendChild(overlay);

    const messageHandler = (event) => {
      if (event.source !== iframe.contentWindow) return;
      if (event.data === 'close-slides') {
        overlay.remove();
        window.removeEventListener('message', messageHandler);
      }
    };
    window.addEventListener('message', messageHandler);

    const closeHandler = (e) => {
      if (e.key === 'Escape') {
        overlay.remove();
        document.removeEventListener('keydown', closeHandler);
        window.removeEventListener('message', messageHandler);
      }
    };
    document.addEventListener('keydown', closeHandler);
  }

  // ============================================
  // GFM Alerts Styling
  // ============================================
  function initGFMAlerts(container = elements.markdownBody) {
    const blockquotes = container.querySelectorAll('blockquote');

    blockquotes.forEach(bq => {
      const firstP = bq.querySelector('p');
      if (!firstP) return;

      const text = firstP.textContent.trim();

      // Check for GFM alert patterns
      const alertMatch = text.match(/^\[\!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i);
      if (alertMatch) {
        const alertType = alertMatch[1].toUpperCase();

        // Add class to blockquote
        bq.classList.add('gfm-alert', `gfm-alert-${alertType.toLowerCase()}`);

        // Remove the [!TYPE] marker from the paragraph
        firstP.textContent = firstP.textContent.replace(alertMatch[0], '').trim();

        // Add icon prefix
        const iconSpan = document.createElement('span');
        iconSpan.className = 'gfm-alert-icon';
        iconSpan.textContent = getAlertIcon(alertType);
        firstP.insertBefore(iconSpan, firstP.firstChild);

        // If firstP is now empty, remove it
        if (!firstP.textContent.trim()) {
          firstP.remove();
        }
      }
    });
  }

  function getAlertIcon(type) {
    const icons = {
      'NOTE': 'ℹ️',
      'TIP': '💡',
      'IMPORTANT': '❗',
      'WARNING': '⚠️',
      'CAUTION': '🔥'
    };
    return icons[type] || 'ℹ️';
  }

  // ============================================
  // Obsidian Syntax Support
  // ============================================

  /**
   * Collect text nodes from a container, skipping code blocks and other protected elements.
   */
  function collectTextNodes(container = elements.markdownBody, excludeSelector = 'code, pre, .mermaid, a, mark, .obsidian-tag') {
    const nodes = [];
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      if (walker.currentNode.parentElement.closest(excludeSelector)) continue;
      nodes.push(walker.currentNode);
    }
    return nodes;
  }

  /**
   * Replace text nodes matching a regex with HTML.
   * @param {RegExp} regex
   * @param {Function} replacer - receives match array, returns HTML string
   */
  function replaceInTextNodes(regex, replacer, container = elements.markdownBody) {
    const nodes = collectTextNodes(container);
    nodes.forEach(node => {
      const text = node.textContent;
      if (!regex.test(text)) return;
      regex.lastIndex = 0;
      const html = text.replace(regex, replacer);
      if (html === text) return;
      const span = document.createElement('span');
      span.innerHTML = html;
      node.parentNode.replaceChild(span, node);
    });
  }

  /**
   * Obsidian Highlight: ==highlighted text==
   */
  function initObsidianHighlight(container = elements.markdownBody) {
    replaceInTextNodes(
      /==([^=\s][^=]*|[^=\s])==/g,
      (m, content) => `<mark class="obsidian-highlight">${escapeHtml(content)}</mark>`,
      container
    );
  }

  /**
   * Obsidian Tags: #tag-name or #tag/subtag
   */
  function initObsidianTags(container = elements.markdownBody) {
    // Match #tag where:
    // - preceded by start of string, whitespace, or non-word char
    // - followed by a letter (not a number, to avoid hex colors)
    // - can contain letters, digits, underscores, hyphens, forward slashes
    replaceInTextNodes(
      /(^|\s|[^\w])#([a-zA-Z][\w\-/]*)/g,
      (m, prefix, tag) => `${prefix}<span class="obsidian-tag" data-tag="${escapeHtml(tag)}">#${escapeHtml(tag)}</span>`,
      container
    );
  }

  /**
   * Obsidian Callouts: extend GFM alerts with more types and collapsible support.
   */
  function initObsidianCallouts(container = elements.markdownBody) {
    const blockquotes = container.querySelectorAll('blockquote');

    blockquotes.forEach(bq => {
      const firstP = bq.querySelector('p');
      if (!firstP) return;

      const text = firstP.textContent.trim();

      // Match Obsidian callout: > [!TYPE] or > [!TYPE]- or > [!TYPE]+
      const calloutMatch = text.match(/^\[!([^\]]+)\]([\-+]?)/i);
      if (!calloutMatch) return;

      const calloutType = calloutMatch[1].toUpperCase();
      const foldIndicator = calloutMatch[2]; // '-' = collapsed, '+' = expanded (default)
      const isCollapsed = foldIndicator === '-';

      // Add classes
      bq.classList.add('obsidian-callout', `obsidian-callout-${calloutType.toLowerCase()}`);
      if (isCollapsed) {
        bq.classList.add('obsidian-callout-collapsed');
      }

      // Remove the [!TYPE] marker
      firstP.textContent = firstP.textContent.replace(calloutMatch[0], '').trim();

      // Add icon and title
      const calloutMeta = getCalloutMeta(calloutType);
      let titleText = firstP.textContent.trim() || calloutMeta.title;
      // Strip inline markdown (e.g. **text**) from callout titles
      titleText = titleText.replace(/\*\*(.+?)\*\*/g, '$1').replace(/\*(.+?)\*/g, '$1');

      // Rebuild the callout header
      const header = document.createElement('div');
      header.className = 'obsidian-callout-title';
      header.innerHTML = `<span class="obsidian-callout-icon">${calloutMeta.icon}</span><span class="obsidian-callout-title-text">${escapeHtml(titleText)}</span>`;

      // If firstP had content beyond the title, preserve it as body
      firstP.remove();

      // Wrap remaining content in a body div
      const bodyDiv = document.createElement('div');
      bodyDiv.className = 'obsidian-callout-content';
      while (bq.firstChild) {
        bodyDiv.appendChild(bq.firstChild);
      }

      bq.appendChild(header);
      bq.appendChild(bodyDiv);

      // Click header to toggle collapse
      header.addEventListener('click', () => {
        bq.classList.toggle('obsidian-callout-collapsed');
      });
    });
  }

  function getCalloutMeta(type) {
    const meta = {
      'NOTE': { icon: 'ℹ️', title: 'Note' },
      'TIP': { icon: '💡', title: 'Tip' },
      'IMPORTANT': { icon: '🔑', title: 'Important' },
      'WARNING': { icon: '⚠️', title: 'Warning' },
      'CAUTION': { icon: '🔥', title: 'Caution' },
      'INFO': { icon: 'ℹ️', title: 'Info' },
      'ABSTRACT': { icon: '📋', title: 'Abstract' },
      'TODO': { icon: '☐', title: 'Todo' },
      'SUCCESS': { icon: '✅', title: 'Success' },
      'QUESTION': { icon: '❓', title: 'Question' },
      'QUIZ': { icon: '📝', title: 'Quiz' },
      'ANSWER': { icon: '💡', title: 'Answer' },
      'FAILURE': { icon: '❌', title: 'Failure' },
      'DANGER': { icon: '⚡', title: 'Danger' },
      'BUG': { icon: '🐛', title: 'Bug' },
      'QUOTE': { icon: '💬', title: 'Quote' },
      'EXAMPLE': { icon: '📚', title: 'Example' }
    };
    return meta[type] || { icon: 'ℹ️', title: type.charAt(0) + type.slice(1).toLowerCase() };
  }

  /**
   * WikiLink: [[File Name]] or [[File Name|Display Text]] or [[File Name#Heading]]
   */
  function initWikiLinks(container = elements.markdownBody) {
    // 使用负向后瞻 (?<!!) 确保不匹配 ![[...]] 图片嵌入模式
    replaceInTextNodes(
      /(?<!!)\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,
      (m, target, display) => {
        const linkText = display ? escapeHtml(display.trim()) : escapeHtml(target.trim());
        const linkTarget = target.trim();
        return `<a class="wiki-link" data-target="${escapeHtml(linkTarget)}">${linkText}</a>`;
      },
      container
    );

    // Add click handlers
    container.querySelectorAll('.wiki-link').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const target = link.dataset.target;
        openWikiLink(target);
      });
    });
  }

  async function openWikiLink(target) {
    const activeTab = state.tabs[state.activeTab];
    const baseDir = activeTab ? activeTab.baseDir : '';

    // Resolve the target path
    let resolvedPath = target;
    if (!target.endsWith('.md') && !target.endsWith('.markdown')) {
      resolvedPath += '.md';
    }

    // If relative path and we have a base directory
    if (!resolvedPath.startsWith('/') && !resolvedPath.match(/^[a-zA-Z]:/) && baseDir) {
      resolvedPath = baseDir + '/' + resolvedPath;
    }

    try {
      const result = await invoke('open_file', { path: resolvedPath });
      if (result && result.content) {
        addTab(result.path, result.content, result.base_dir || '');
      }
    } catch (err) {
      showError('无法打开文件: ' + err);
    }
  }

  /**
   * Obsidian Embed: ![[File Name]]
   */
  async function initObsidianEmbeds(baseDir) {
    console.log('[DEBUG initObsidianEmbeds] Starting with baseDir:', baseDir);

    // Debug: output the raw HTML content BEFORE any processing
    const rawHTML = elements.markdownBody.innerHTML;
    console.log('[DEBUG Raw HTML length]:', rawHTML.length);
    console.log('[DEBUG Raw HTML first 500 chars]:', rawHTML.substring(0, 500));

    // Search for WikiLink pattern in raw HTML
    const wikiLinkPattern = /!\[\[[^\]]+\]\]/g;
    const wikiMatches = rawHTML.match(wikiLinkPattern);
    console.log('[DEBUG WikiLink matches in raw HTML]:', wikiMatches);

    // Also search for any bracket patterns
    const bracketPattern = /\[\[[^\]]+\]\]/g;
    const bracketMatches = rawHTML.match(bracketPattern);
    console.log('[DEBUG Any [[...]] in raw HTML]:', bracketMatches);

    const embedRegex = /!\[\[([^\]]+)\]\]/g;
    const textNodes = collectTextNodes(elements.markdownBody, 'code, pre, .mermaid, a');
    console.log('[DEBUG initObsidianEmbeds] Found textNodes:', textNodes.length);

    // Debug: show first 10 text node contents
    textNodes.slice(0, 10).forEach((node, i) => {
      console.log(`[DEBUG TextNode ${i}]`, node.textContent.substring(0, 100));
    });

    // Debug: check if any node contains WikiLink pattern
    const hasWikiLink = textNodes.some(node => node.textContent.includes('[['));
    console.log('[DEBUG initObsidianEmbeds] Any node contains [[:', hasWikiLink);

    // Debug: check full HTML content for WikiLink pattern
    const fullHTML = elements.markdownBody.innerHTML;
    const wikiLinkInHTML = fullHTML.includes('![[') || fullHTML.includes('[[');
    console.log('[DEBUG initObsidianEmbeds] WikiLink in full HTML:', wikiLinkInHTML);

    const embeds = [];
    textNodes.forEach(node => {
      let match;
      embedRegex.lastIndex = 0;
      while ((match = embedRegex.exec(node.textContent)) !== null) {
        console.log('[DEBUG initObsidianEmbeds] Found match:', match[0], 'in node:', node.textContent.substring(0, 100));
        embeds.push({ node, fullMatch: match[0], target: match[1].trim() });
      }
    });

    console.log('[DEBUG initObsidianEmbeds] Total embeds found:', embeds.length);

    for (const embed of embeds) {
      const { node, fullMatch, target } = embed;

      // Check if this is an image BEFORE any path manipulation
      const isImage = /\.(png|jpg|jpeg|gif|webp|svg|bmp)$/i.test(target);

      // Build resolved path - handle Obsidian vault-relative paths
      let resolvedPath = target;

      // Only append .md for non-image files without extension
      if (!isImage && !resolvedPath.endsWith('.md') && !resolvedPath.endsWith('.markdown')) {
        resolvedPath += '.md';
      }

      // Resolve relative path using baseDir
      // Obsidian WikiLink paths are relative to vault root, not current file
      // Need to detect if target overlaps with baseDir path segments
      if (!resolvedPath.startsWith('/') && !resolvedPath.match(/^[a-zA-Z]:/) && baseDir) {
        const baseParts = baseDir.split(/[\/\\]/);
        const targetParts = target.split(/[\/\\]/);

        // Check if target's first segment matches any part of baseDir
        let overlapIndex = -1;
        for (let i = baseParts.length - 1; i >= 0; i--) {
          if (baseParts[i] === targetParts[0]) {
            // Check if subsequent parts also match
            let matchLen = 0;
            for (let j = 0; j < targetParts.length && i + j < baseParts.length; j++) {
              if (baseParts[i + j] === targetParts[j]) {
                matchLen++;
              } else {
                break;
              }
            }
            if (matchLen > 0) {
              overlapIndex = i;
              break;
            }
          }
        }

        if (overlapIndex >= 0) {
          // Target overlaps with baseDir - target is relative to vault root
          // Vault root = baseDir minus the overlapping segments
          const vaultRoot = baseParts.slice(0, overlapIndex).join('/');
          resolvedPath = vaultRoot + '/' + target;
        } else {
          // No overlap - target is relative to current file directory
          resolvedPath = baseDir + '/' + target;
        }
      }

      try {
        if (isImage) {
          // Handle image embed: ![[image.png]]
          console.log('[DEBUG WikiLink] Processing image:', target);
          console.log('[DEBUG WikiLink] resolvedPath:', resolvedPath);

          const imgWrapper = document.createElement('div');
          imgWrapper.className = 'obsidian-embed obsidian-image-embed';

          const img = document.createElement('img');
          img.alt = target.split('/').pop().split('\\').pop();
          img.className = 'obsidian-embed-image';

          // Use Tauri convertFileSrc for local file access
          const convertFileSrc = window.__TAURI__?.core?.convertFileSrc;
          console.log('[DEBUG WikiLink] convertFileSrc available:', !!convertFileSrc);

          let finalSrc = convertFileSrc ? convertFileSrc(resolvedPath) : resolvedPath;
          // Fix double-encoding issue (%25 indicates % was encoded again)
          if (finalSrc.includes('%25')) {
            finalSrc = decodeURIComponent(finalSrc);
          }
          console.log('[DEBUG WikiLink] img.src:', finalSrc);
          img.src = finalSrc;

          imgWrapper.appendChild(img);

          const text = node.textContent;
          const before = text.substring(0, text.indexOf(fullMatch));
          const after = text.substring(text.indexOf(fullMatch) + fullMatch.length);

          const parent = node.parentNode;
          if (before) parent.insertBefore(document.createTextNode(before), node);
          parent.insertBefore(imgWrapper, node);
          if (after) parent.insertBefore(document.createTextNode(after), node);
          parent.removeChild(node);
        } else {
          // Handle file embed: ![[file.md]]
          const result = await invoke('open_file', { path: resolvedPath });
          if (result && result.content) {
            const html = await invoke('render_markdown', { content: result.content });
            const wrapper = document.createElement('div');
            wrapper.className = 'obsidian-embed';
            wrapper.innerHTML = html;

            const text = node.textContent;
            const before = text.substring(0, text.indexOf(fullMatch));
            const after = text.substring(text.indexOf(fullMatch) + fullMatch.length);

            const parent = node.parentNode;
            if (before) parent.insertBefore(document.createTextNode(before), node);
            parent.insertBefore(wrapper, node);
            if (after) parent.insertBefore(document.createTextNode(after), node);
            parent.removeChild(node);
          }
        }
      } catch (err) {
        console.error('Failed to embed:', target, err);
      }
    }
  }

  // ============================================
  // Lightbox
  // ============================================
  function openLightbox(img) {
    resetLightboxState();
    const lightbox = document.createElement('div');
    lightbox.className = 'image-lightbox';

    const viewport = document.createElement('div');
    viewport.className = 'lightbox-viewport';

    const content = document.createElement('div');
    content.className = 'lightbox-content';

    const lightboxImg = document.createElement('img');
    lightboxImg.src = img.src;
    lightboxImg.alt = img.alt || '';
    content.appendChild(lightboxImg);

    viewport.appendChild(content);
    lightbox.appendChild(viewport);

    const zoomInfo = document.createElement('div');
    zoomInfo.className = 'lightbox-zoom-info';
    zoomInfo.textContent = 'Zoom: 100%';

    const controls = document.createElement('div');
    controls.className = 'lightbox-controls';

    const buttons = [
      { text: '+', action: () => zoomContent(content, zoomInfo, 0.25) },
      { text: '-', action: () => zoomContent(content, zoomInfo, -0.25) },
      { text: 'Reset', action: () => resetLightboxView(content, zoomInfo) },
      { text: 'Close', action: () => closeLightbox(lightbox) }
    ];

    buttons.forEach(btn => {
      const button = document.createElement('button');
      button.className = 'lightbox-btn';
      button.textContent = btn.text;
      button.addEventListener('click', (e) => {
        e.stopPropagation();
        btn.action();
      });
      controls.appendChild(button);
    });

    lightbox.appendChild(zoomInfo);
    lightbox.appendChild(controls);

    lightbox.addEventListener('click', function(e) {
      if (e.target === lightbox) closeLightbox(lightbox);
    });

    bindLightboxEvents(lightbox, content, zoomInfo);

    document.body.appendChild(lightbox);
    document.body.style.overflow = 'hidden';
  }

  let currentZoom = 1;
  let panX = 0;
  let panY = 0;
  let isPanning = false;
  let panStartX = 0;
  let panStartY = 0;
  let isSpacePressed = false;

  function zoomContent(content, info, delta) {
    currentZoom = Math.max(0.05, currentZoom + delta);
    updateTransform(content);
    info.textContent = `Zoom: ${Math.round(currentZoom * 100)}%`;
  }

  function resetLightboxView(content, info) {
    currentZoom = 1;
    panX = 0;
    panY = 0;
    updateTransform(content);
    info.textContent = 'Zoom: 100%';
  }

  function updateTransform(content) {
    content.style.transform = `translate(${panX}px, ${panY}px) scale(${currentZoom})`;
  }

  function resetLightboxState() {
    currentZoom = 1;
    panX = 0;
    panY = 0;
    isPanning = false;
    isSpacePressed = false;
  }

  function bindLightboxEvents(lightbox, content, zoomInfo) {
    const wheelHandler = (e) => {
      e.preventDefault();
      const delta = e.deltaY < 0 ? 0.25 : -0.25;
      zoomContent(content, zoomInfo, delta);
    };
    lightbox.addEventListener('wheel', wheelHandler, { passive: false });

    const keydownHandler = (e) => {
      if (e.code === 'Space' && !e.repeat && !e.target.matches('input, textarea')) {
        isSpacePressed = true;
        lightbox.style.cursor = 'grab';
        e.preventDefault();
      }
    };

    const keyupHandler = (e) => {
      if (e.code === 'Space') {
        isSpacePressed = false;
        if (!isPanning) {
          lightbox.style.cursor = 'zoom-out';
        }
      }
    };

    document.addEventListener('keydown', keydownHandler);
    document.addEventListener('keyup', keyupHandler);

    const mouseDownHandler = (e) => {
      if (isSpacePressed && e.button === 0) {
        isPanning = true;
        panStartX = e.clientX - panX;
        panStartY = e.clientY - panY;
        lightbox.style.cursor = 'grabbing';
        e.preventDefault();
      }
    };

    const mouseMoveHandler = (e) => {
      if (isPanning) {
        panX = e.clientX - panStartX;
        panY = e.clientY - panStartY;
        updateTransform(content);
      }
    };

    const mouseUpHandler = () => {
      if (isPanning) {
        isPanning = false;
        lightbox.style.cursor = isSpacePressed ? 'grab' : 'zoom-out';
      }
    };

    lightbox.addEventListener('mousedown', mouseDownHandler);
    document.addEventListener('mousemove', mouseMoveHandler);
    document.addEventListener('mouseup', mouseUpHandler);

    lightbox._cleanup = () => {
      lightbox.removeEventListener('wheel', wheelHandler);
      document.removeEventListener('keydown', keydownHandler);
      document.removeEventListener('keyup', keyupHandler);
      lightbox.removeEventListener('mousedown', mouseDownHandler);
      document.removeEventListener('mousemove', mouseMoveHandler);
      document.removeEventListener('mouseup', mouseUpHandler);
    };
  }

  function closeLightbox(lightbox) {
    if (lightbox._cleanup) lightbox._cleanup();
    lightbox.style.opacity = '0';
    setTimeout(() => {
      lightbox.remove();
      document.body.style.overflow = '';
    }, 200);
  }

  function openMermaidLightbox(svg) {
    resetLightboxState();
    const lightbox = document.createElement('div');
    lightbox.className = 'image-lightbox';

    const viewport = document.createElement('div');
    viewport.className = 'lightbox-viewport';

    const content = document.createElement('div');
    content.className = 'lightbox-content';

    const clonedSvg = svg.cloneNode(true);
    content.appendChild(clonedSvg);

    viewport.appendChild(content);
    lightbox.appendChild(viewport);

    const zoomInfo = document.createElement('div');
    zoomInfo.className = 'lightbox-zoom-info';
    zoomInfo.textContent = 'Zoom: 100%';

    const controls = document.createElement('div');
    controls.className = 'lightbox-controls';

    const buttons = [
      { text: '+', action: () => zoomContent(content, zoomInfo, 0.25) },
      { text: '-', action: () => zoomContent(content, zoomInfo, -0.25) },
      { text: 'Reset', action: () => resetLightboxView(content, zoomInfo) },
      { text: 'Close', action: () => closeLightbox(lightbox) }
    ];

    buttons.forEach(btn => {
      const button = document.createElement('button');
      button.className = 'lightbox-btn';
      button.textContent = btn.text;
      button.addEventListener('click', (e) => {
        e.stopPropagation();
        btn.action();
      });
      controls.appendChild(button);
    });

    lightbox.appendChild(zoomInfo);
    lightbox.appendChild(controls);

    lightbox.addEventListener('click', function(e) {
      if (e.target === lightbox) closeLightbox(lightbox);
    });

    bindLightboxEvents(lightbox, content, zoomInfo);

    document.body.appendChild(lightbox);
    document.body.style.overflow = 'hidden';
  }

  // ============================================
  // Toast Notification
  // ============================================
  function showToast(message, duration = 3000) {
    let toast = document.getElementById('app-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'app-toast';
      toast.style.cssText = 'position:fixed;top:24px;left:50%;transform:translateX(-50%);background:var(--color-bg-secondary);color:var(--color-text-primary);padding:10px 20px;border-radius:var(--radius-md);border:1px solid var(--color-border);box-shadow:var(--shadow-lg);font-size:var(--font-size-sm);z-index:9999;opacity:0;transition:opacity 300ms;pointer-events:none;white-space:nowrap;';
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.style.opacity = '1';
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => { toast.style.opacity = '0'; }, duration);
  }

  function hideToast() {
    const toast = document.getElementById('app-toast');
    if (toast) {
      clearTimeout(toast._timer);
      toast.style.opacity = '0';
    }
  }

  // ============================================
  // Agent SDK Status Indicator
  // ============================================
  const AGENT_STATUS_LABELS = {
    idle: 'Agent 未检测',
    checking: '检测中…',
    ready: 'Agent 就绪',
    missing: 'Agent 未安装'
  };

  // "不再提示"的持久化标记（localStorage），SDK 检测成功后清除
  const AGENT_MISSING_DISMISS_KEY = 'agent-missing-dismissed';

  function updateAgentStatusChip(status, errorMessage) {
    const chip = elements.agentStatusChip;
    const dot = elements.agentStatusDot;
    const text = elements.agentStatusText;
    if (!chip || !text) return;

    chip.classList.remove('status-checking', 'status-ready', 'status-missing');
    chip.classList.add(`status-${status}`);
    text.textContent = AGENT_STATUS_LABELS[status] || status;

    const clickHint = '（点击重新检测）';
    if (status === 'missing') {
      chip.title = errorMessage ? `${errorMessage} ${clickHint}` : `未检测到 Claude Code Agent SDK ${clickHint}`;
    } else if (status === 'ready') {
      chip.title = `Claude Code Agent SDK 已就绪 ${clickHint}`;
    } else if (status === 'idle') {
      chip.title = `点击检测 Agent SDK ${clickHint}`;
    } else {
      chip.title = '正在检测 Claude Code Agent SDK…';
    }
  }

  function showAgentMissingToast(errorMessage) {
    let toast = document.getElementById('agent-missing-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'agent-missing-toast';
      toast.className = 'agent-missing-toast';
      toast.innerHTML = `
        <div class="agent-missing-toast-icon">!</div>
        <div class="agent-missing-toast-body">
          <div class="agent-missing-toast-title">未检测到 Claude Code Agent</div>
          <div class="agent-missing-toast-hint">AI 学习功能（大纲生成、章节生成、Socratic 复习）需要安装 Agent SDK 才能使用。</div>
          <div class="agent-missing-toast-install">
            <p>或打开终端手动执行：</p>
            <code>npm install -g @anthropic-ai/claude-agent-sdk</code>
            <button class="agent-missing-toast-copy" id="agentMissingCopyBtn">复制</button>
          </div>
          <div class="agent-missing-toast-actions">
            <button class="agent-missing-toast-btn primary" id="agentMissingRetryBtn">自动安装</button>
            <button class="agent-missing-toast-btn" id="agentMissingDismissBtn">不再提示</button>
          </div>
        </div>
        <button class="agent-missing-toast-close" id="agentMissingCloseBtn">×</button>
      `;
      document.body.appendChild(toast);

      // 自动安装：完整检测会尝试 npm 自动安装（可能耗时几分钟）
      toast.querySelector('#agentMissingRetryBtn').addEventListener('click', async () => {
        const btn = toast.querySelector('#agentMissingRetryBtn');
        btn.disabled = true;
        btn.textContent = '安装中，可能需要几分钟…';
        await checkAgentSdk();
        btn.disabled = false;
        btn.textContent = '自动安装';
      });
      // 不再提示：持久化忽略标记，之后可通过工具栏 Agent 芯片随时重新检测
      toast.querySelector('#agentMissingDismissBtn').addEventListener('click', () => {
        localStorage.setItem(AGENT_MISSING_DISMISS_KEY, '1');
        hideAgentMissingToast();
      });
      toast.querySelector('#agentMissingCloseBtn').addEventListener('click', hideAgentMissingToast);
      toast.querySelector('#agentMissingCopyBtn').addEventListener('click', () => {
        navigator.clipboard.writeText('npm install -g @anthropic-ai/claude-agent-sdk').catch(() => {});
      });
    }

    const hint = toast.querySelector('.agent-missing-toast-hint');
    if (hint && errorMessage) {
      hint.textContent = `AI 学习功能需要安装 Agent SDK 才能使用。详情：${errorMessage}`;
    }

    // Force reflow to trigger transition
    void toast.offsetWidth;
    toast.classList.add('visible');
  }

  function hideAgentMissingToast() {
    const toast = document.getElementById('agent-missing-toast');
    if (toast) {
      toast.classList.remove('visible');
    }
  }

  async function checkAgentSdk() {
    try {
      updateAgentStatusChip('checking');
      const result = await invoke('check_agent_sdk');
      console.log('[AgentStatus] check result:', result);

      if (result && result.available) {
        updateAgentStatusChip('ready');
        hideAgentMissingToast();
        // SDK 已就绪：清除"不再提示"标记，将来真正缺失时能再次引导
        localStorage.removeItem(AGENT_MISSING_DISMISS_KEY);
      } else {
        const error = (result && result.error) ? String(result.error) : '未检测到 @anthropic-ai/claude-agent-sdk';
        updateAgentStatusChip('missing', error);
        showAgentMissingToast(error);
      }
    } catch (err) {
      console.error('[AgentStatus] check failed:', err);
      const message = err && err.message ? String(err.message) : String(err);
      updateAgentStatusChip('missing', message);
      showAgentMissingToast(message);
    }
  }

  // 启动引导（issue #2）：轻量探测 SDK 是否存在于已知目录，纯文件系统检查，
  // 不 spawn node、不触发 npm 自动安装，所以可以安全地在启动时运行。
  // 只有"确定缺失"且用户未点过"不再提示"时才显示引导 toast。
  async function probeAgentSdkAtStartup() {
    try {
      const result = await invoke('probe_agent_sdk');
      if (result && result.found) return;
      if (localStorage.getItem(AGENT_MISSING_DISMISS_KEY) === '1') return;
      showAgentMissingToast(null);
    } catch (err) {
      console.warn('[AgentStatus] startup probe failed:', err);
    }
  }

  function initAgentStatusIndicator() {
    const chip = elements.agentStatusChip;
    if (!chip) return;

    chip.addEventListener('click', () => {
      // Click the chip at any state (idle / ready / missing) triggers a
      // re-check, so the user has a clear way to verify after installing.
      checkAgentSdk();
    });

    // Full check stays gated behind entering learning mode (it may auto-install
    // via npm); startup only runs the lightweight filesystem probe.
    updateAgentStatusChip('idle');
    probeAgentSdkAtStartup();
  }

  // ============================================
  // Share Document (ZIP with embedded images)
  // ============================================
  async function shareDocument(tabIndex) {
    const idx = tabIndex !== undefined ? tabIndex : state.activeTab;
    const tab = state.tabs[idx];
    if (!tab || !tab.content) {
      showToast('请先打开一个 Markdown 文件');
      return;
    }

    try {
      showToast('正在打包分享...');
      const result = await invoke('share_document', {
        content: tab.content,
        filePath: tab.path || '',
        baseDir: tab.baseDir || ''
      });
      showToast('分享打包成功: ' + result);
    } catch (err) {
      console.error('Share failed:', err);
      showError('分享打包失败: ' + err);
    }
  }

  // ============================================
  // PDF Export
  // ============================================
  // 统一入口：macOS 走 Rust 原生 NSPrintOperation 系统打印面板（WebKit 打印管线：
  // 自动分页 + 系统页边距，issue #4/#5；window.print 在 WKWebView 静默无效），
  // 其他平台由 Rust 返回 'window-print' 回退系统打印对话框。
  /**
   * 生成自包含 HTML（mac headless_chrome 路径用）。
   * 内联所有 CSS + 将 @font-face / url() 资源转 base64 data URI，
   * 使 Chrome 无需访问外部文件即可正确渲染（含 KaTeX 字体）。
   */
  async function generatePrintHtml() {
    // 1. 收集所有 CSS 规则
    let cssText = '';
    for (const sheet of document.styleSheets) {
      try {
        for (const rule of sheet.cssRules) {
          cssText += rule.cssText + '\n';
        }
      } catch (e) { /* 跨域样式表跳过 */ }
    }

    // 2. 将 url() 资源（字体/图片）内联为 base64 data URI
    const urlPattern = /url\(\s*['"]?([^'")\s]+)['"]?\s*\)/g;
    const cache = {};
    let m;
    while ((m = urlPattern.exec(cssText)) !== null) {
      const url = m[1];
      if (url.startsWith('data:') || url.startsWith('#')) continue;
      if (!(url in cache)) {
        try {
          const resp = await fetch(url);
          if (!resp.ok) throw new Error(resp.status);
          const blob = await resp.blob();
          cache[url] = await new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.readAsDataURL(blob);
          });
        } catch (e) {
          cache[url] = url; // 失败保留原始 URL
        }
      }
    }
    for (const [url, dataUri] of Object.entries(cache)) {
      if (dataUri !== url) {
        cssText = cssText.split(url).join(dataUri);
      }
    }

    // 3. 内联内容区域的图片（相对路径 → base64）
    const contentEl = document.getElementById('contentArea');
    const clone = contentEl.cloneNode(true);
    const imgs = clone.querySelectorAll('img[src]');
    for (const img of imgs) {
      const src = img.getAttribute('src');
      if (src && !src.startsWith('data:') && !src.startsWith('http')) {
        try {
          const resp = await fetch(src);
          if (!resp.ok) continue;
          const blob = await resp.blob();
          img.setAttribute('src', await new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.readAsDataURL(blob);
          }));
        } catch (e) { /* 保留原始 src */ }
      }
    }

    // 4. 组装完整 HTML
    const theme = document.documentElement.getAttribute('data-theme') || 'light';
    return '<!DOCTYPE html>\n<html data-theme="' + theme + '">\n<head>\n'
      + '<meta charset="utf-8">\n'
      + '<style>\n' + cssText + '\n</style>\n'
      + '</head>\n<body class="pdf-exporting">\n'
      + clone.innerHTML
      + '\n</body>\n</html>';
  }

  async function exportToPDF() {
    const tab = state.tabs[state.activeTab];
    const baseName = tab && tab.path
      ? (tab.path.split(/[\\/]/).pop() || 'document').replace(/\.[^.]+$/, '')
      : 'document';

    // issue #5：给 body 加 .pdf-exporting class 隐藏 sidebar/toolbar 并展开内容。
    // macOS createPDF 回退路径额外加 .pdf-exporting-mac（CSS padding 模拟边距）。
    const contentEl = document.getElementById('contentArea');
    const isMac = /Mac|iPhone|iPad/.test(navigator.userAgent);
    document.body.classList.add('pdf-exporting');
    if (isMac) document.body.classList.add('pdf-exporting-mac');

    const cleanup = () => {
      document.body.classList.remove('pdf-exporting');
      document.body.classList.remove('pdf-exporting-mac');
    };
    window.addEventListener('afterprint', cleanup, { once: true });

    try {
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const width = window.innerWidth;
      const height = contentEl.scrollHeight;

      // mac：生成自包含 HTML 供 headless_chrome 打印（分页+边距）；
      // 失败则 html=null，Rust 回退 createPDF。
      let html = null;
      if (isMac) {
        try { html = await generatePrintHtml(); }
        catch (e) { console.warn('[pdf] HTML 生成失败，回退 createPDF:', e); }
      }

      const result = await invoke('export_pdf', {
        suggestedName: baseName + '.pdf',
        contentWidth: width,
        contentHeight: height,
        html,
      });
      if (result === 'window-print') {
        setTimeout(() => window.print(), 100);
      } else if (result === 'cancelled') {
        window.removeEventListener('afterprint', cleanup);
        cleanup();
      } else if (result === 'printed') {
        window.removeEventListener('afterprint', cleanup);
        cleanup();
        showToast('已通过系统打印面板导出 PDF', 4000);
      } else if (result) {
        window.removeEventListener('afterprint', cleanup);
        cleanup();
        showToast('PDF 已导出：' + result, 5000);
      }
    } catch (err) {
      window.removeEventListener('afterprint', cleanup);
      cleanup();
      showError('PDF 导出失败: ' + err);
    }
  }

  // ============================================
  // Word Export
  // ============================================

  function dedentMermaidSource(text) {
    const lines = text.split('\n');
    const indents = lines
      .filter((line) => line.trim().length > 0)
      .map((line) => (line.match(/^[ \t]*/) || [''])[0].length);
    if (!indents.length) return text.trim();
    const minIndent = Math.min(...indents);
    return lines.map((line) => line.slice(minIndent)).join('\n');
  }

  function findMermaidBlocks(markdown) {
    // Match fenced code blocks with language `mermaid` or `mmd`, ignoring case
    // and tolerating trailing info on the opening fence (e.g. ```mermaid align=center).
    // Supports both ``` and ~~~ fences, leading indentation up to 3 spaces, and
    // normalizes CRLF/CR line endings. Content is dedented to match how
    // pulldown-cmark reports fenced code block text.
    const fenceRegex = /^[ \t]{0,3}(?:```|~~~)[ \t]*(?:mermaid|mmd)(?:[ \t]+[^\n]*)?[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]{0,3}(?:```|~~~)[ \t]*$/gim;
    const blocks = [];
    let match;
    while ((match = fenceRegex.exec(markdown)) !== null) {
      const normalized = match[1]
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n');
      blocks.push(dedentMermaidSource(normalized).trim());
    }
    return blocks;
  }

  function parseSvgIntrinsicSize(svg) {
    const widthMatch = svg.match(/<svg[^>]*\swidth="([^"]+)"/i);
    const heightMatch = svg.match(/<svg[^>]*\sheight="([^"]+)"/i);
    const viewBoxMatch = svg.match(/<svg[^>]*\sviewBox="([^"]+)"/i);

    function parsePx(value) {
      if (!value) return 0;
      const num = parseFloat(value);
      if (!Number.isFinite(num) || num <= 0) return 0;
      // Ignore percentage-based sizes; fall back to viewBox for those.
      if (value.trim().endsWith('%')) return 0;
      return num;
    }

    let width = parsePx(widthMatch ? widthMatch[1] : '');
    let height = parsePx(heightMatch ? heightMatch[1] : '');

    if ((!width || !height) && viewBoxMatch) {
      const parts = viewBoxMatch[1].trim().split(/\s+/).map(parseFloat);
      if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
        if (!width) width = parts[2];
        if (!height) height = parts[3];
      }
    }

    return { width, height };
  }

  async function tightenSvgViewBox(svg) {
    // Mermaid's default SVGs carry a lot of empty padding around the diagram.
    // Use a canvas to find the actual rendered pixel bounds, then update the
    // SVG viewBox/width/height to match. Callers should pass the SVG through
    // convertForeignObjectsToText first: class/state diagrams may still carry
    // foreignObject labels, which taint the canvas and skip the crop.
    const intrinsic = parseSvgIntrinsicSize(svg);
    const origW = intrinsic.width || 0;
    const origH = intrinsic.height || 0;
    if (!origW || !origH) return svg;

    const SCALE = 2;
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const img = new Image();

    try {
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = url;
      });

      const canvasW = Math.max(1, Math.round(origW * SCALE));
      const canvasH = Math.max(1, Math.round(origH * SCALE));
      const canvas = document.createElement('canvas');
      canvas.width = canvasW;
      canvas.height = canvasH;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.clearRect(0, 0, canvasW, canvasH);

      let data;
      try {
        ctx.drawImage(img, 0, 0, canvasW, canvasH);
        data = ctx.getImageData(0, 0, canvasW, canvasH).data;
      } catch (e) {
        // SVGs containing <foreignObject> (e.g. class/state diagrams with
        // htmlLabels) taint the canvas in some WebViews. Fall back to the
        // original SVG without cropping.
        console.warn('[tightenSvgViewBox] canvas tainted or unreadable, skipping crop:', e.message);
        return svg;
      }

      let minX = canvasW;
      let minY = canvasH;
      let maxX = -1;
      let maxY = -1;
      for (let y = 0; y < canvasH; y++) {
        const row = y * canvasW;
        for (let x = 0; x < canvasW; x++) {
          if (data[(row + x) * 4 + 3] > 12) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }
      if (maxX < 0) return svg;

      const pad = 3 * SCALE;
      minX = Math.max(0, minX - pad);
      minY = Math.max(0, minY - pad);
      maxX = Math.min(canvasW - 1, maxX + pad);
      maxY = Math.min(canvasH - 1, maxY + pad);

      const vbMatch = svg.match(/<svg[^>]*\sviewBox="([^"]+)"/i);
      let vx = 0;
      let vy = 0;
      let vw = origW;
      let vh = origH;
      if (vbMatch) {
        const p = vbMatch[1].trim().split(/\s+/).map(parseFloat);
        if (p.length === 4) {
          vx = p[0];
          vy = p[1];
          vw = p[2];
          vh = p[3];
        }
      }

      const sx = vw / origW;
      const sy = vh / origH;
      const nx = vx + (minX / SCALE) * sx;
      const ny = vy + (minY / SCALE) * sy;
      const nw = ((maxX - minX + 1) / SCALE) * sx;
      const nh = ((maxY - minY + 1) / SCALE) * sy;

      function setAttr(str, name, val) {
        const re = new RegExp(`(<svg[^>]*)\\s${name}="[^"]*"`, 'i');
        if (re.test(str)) {
          return str.replace(re, `$1 ${name}="${val}"`);
        }
        return str.replace(/<svg/i, `<svg ${name}="${val}"`);
      }

      let out = setAttr(svg, 'viewBox', `${nx.toFixed(2)} ${ny.toFixed(2)} ${nw.toFixed(2)} ${nh.toFixed(2)}`);
      out = setAttr(out, 'width', nw.toFixed(2));
      out = setAttr(out, 'height', nh.toFixed(2));
      return out;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  // Mermaid's class/state renderers put labels in <foreignObject> HTML even
  // with htmlLabels:false (the class renderer reads flowchart.htmlLabels, and
  // the safeClassConfig fallback leaves it at the default `true`). resvg (and
  // the crop canvas) cannot handle foreignObject: text is silently dropped in
  // the exported PNG. Convert each foreignObject into plain SVG
  // <text>/<tspan>. Positions come from real layout measurements of the
  // offscreen-rendered SVG (getBoundingClientRect), so nested transforms,
  // missing x/y attributes and multi-line blocks all land correctly.
  function convertForeignObjectsToText(svg) {
    if (!svg.includes('foreignObject')) return svg;

    const SVG_NS = 'http://www.w3.org/2000/svg';
    const host = document.createElement('div');
    host.style.cssText = 'position:absolute;left:-99999px;top:0;visibility:hidden;';
    host.innerHTML = svg;
    document.body.appendChild(host);

    try {
      const svgEl = host.querySelector('svg');
      if (!svgEl) return svg;

      // Map CSS-pixel measurements back to SVG user units via the viewBox.
      const svgRect = svgEl.getBoundingClientRect();
      if (!svgRect.width || !svgRect.height) return svg;
      let vx = 0, vy = 0, vw = svgRect.width, vh = svgRect.height;
      if (svgEl.viewBox && svgEl.viewBox.baseVal && svgEl.viewBox.baseVal.width) {
        const vb = svgEl.viewBox.baseVal;
        vx = vb.x; vy = vb.y; vw = vb.width; vh = vb.height;
      }
      const sx = vw / svgRect.width;
      const sy = vh / svgRect.height;
      const fontScale = Math.min(sx, sy);

      // Leaf block elements (no block children) each become one text line.
      const BLOCK_SEL = 'div, p, li, tr, h1, h2, h3, h4';
      svgEl.querySelectorAll('foreignObject').forEach((fo) => {
        const blocks = Array.from(fo.querySelectorAll(BLOCK_SEL))
          .filter((b) => !b.querySelector(BLOCK_SEL));
        const sources = blocks.length > 0 ? blocks : [fo];

        const text = document.createElementNS(SVG_NS, 'text');
        let added = 0;
        for (const el of sources) {
          const content = el.textContent.replace(/\s+/g, ' ').trim();
          if (!content) continue;
          // Measure the actual text run, not the block box: blocks often span
          // the full row width while their text is left/right aligned, so
          // anchoring at the block center shifts the text. A Range over the
          // contents gives the rendered glyph bounds.
          const range = document.createRange();
          range.selectNodeContents(el);
          const tr = range.getBoundingClientRect();
          if (!tr.width && !tr.height) continue;
          const cs = window.getComputedStyle(el);
          const fontSize = (parseFloat(cs.fontSize) || 14) * fontScale;
          const cx = vx + (tr.left + tr.width / 2 - svgRect.left) * sx;
          const cy = vy + (tr.top + tr.height / 2 - svgRect.top) * sy;

          const tspan = document.createElementNS(SVG_NS, 'tspan');
          tspan.setAttribute('x', cx.toFixed(2));
          tspan.setAttribute('y', (cy + fontSize * 0.35).toFixed(2));
          tspan.setAttribute('text-anchor', 'middle');
          tspan.setAttribute('font-size', fontSize.toFixed(2));
          tspan.setAttribute('fill', cs.color || '#000');
          if (parseInt(cs.fontWeight, 10) >= 600) tspan.setAttribute('font-weight', 'bold');
          tspan.textContent = content;
          text.appendChild(tspan);
          added++;
        }
        if (added > 0) fo.parentNode.replaceChild(text, fo);
      });

      return new XMLSerializer().serializeToString(svgEl);
    } catch (err) {
      console.warn('[mermaid-export] foreignObject conversion failed, keeping original:', err);
      return svg;
    } finally {
      host.remove();
    }
  }

  async function renderMermaidSourceToPng(source, fallbackConfig) {
    const id = 'mermaid-export-' + Math.random().toString(36).slice(2);
    let result;
    try {
      result = await window.mermaid.render(id, source);
    } catch (err) {
      if (fallbackConfig) {
        console.warn('[mermaid-export] retrying with fallback config for:', source.split('\n')[0]);
        window.mermaid.initialize(fallbackConfig);
        result = await window.mermaid.render(id + '-fb', source);
      } else {
        throw err;
      }
    }
    const rawSvg = typeof result === 'string' ? result : result.svg;

    const rawIntrinsic = parseSvgIntrinsicSize(rawSvg);
    const textSvg = convertForeignObjectsToText(rawSvg);
    const svg = await tightenSvgViewBox(textSvg);
    const tightIntrinsic = parseSvgIntrinsicSize(svg);

    const intrinsic = tightIntrinsic;
    let width = intrinsic.width || 0;
    let height = intrinsic.height || 0;

    if (!width || !height) {
      throw new Error('Cannot determine mermaid diagram size');
    }

    // Compute a Word-friendly display size.
    // The default DOCX page is A4 with 1701-twips (≈3 cm) side margins, leaving
    // about 567 CSS pixels of body width. We cap the image just under that width
    // so it never crosses the margins while using as much of the page as possible
    // (keeps labels readable). Tall diagrams are also capped in display height.
    const MAX_WIDTH_PX = 560;          // fit within A4 body width (~567 px)
    const MIN_WIDTH_PX = 1;            // do not artificially enlarge tiny diagrams
    const MAX_HEIGHT_PX = 640;         // avoid overly tall diagrams
    const MAX_UPSCALE = 1;             // never scale up beyond intrinsic size

    const scaleDown = Math.min(1, MAX_WIDTH_PX / width);
    const scaleUp = Math.max(1, MIN_WIDTH_PX / width);
    const scaleHeight = MAX_HEIGHT_PX / height;
    const scale = Math.min(scaleDown, scaleUp, MAX_UPSCALE, scaleHeight);

    const logicalWidth = Math.max(1, Math.round(width * scale));
    const logicalHeight = Math.max(1, Math.round(height * scale));

    const preview = source.split('\n').slice(0, 2).join(' ').substring(0, 80);
    const debugEntry = {
      preview,
      rawSize: { width: rawIntrinsic.width, height: rawIntrinsic.height },
      tightSize: { width: tightIntrinsic.width, height: tightIntrinsic.height },
      displaySize: { width: logicalWidth, height: logicalHeight },
      rawSvg,
      svg,
    };
    window.__mermaidDebug = window.__mermaidDebug || [];
    window.__mermaidDebug.push(debugEntry);
    console.log('[mermaid-export]', debugEntry);

    return { svg, width: logicalWidth, height: logicalHeight };
  }

  // ============================================
  // Export Progress Bar
  // ============================================
  let _exportProgressEl = null;

  function getExportProgressEl() {
    if (!_exportProgressEl) {
      _exportProgressEl = document.getElementById('export-progress');
      if (!_exportProgressEl) {
        _exportProgressEl = document.createElement('div');
        _exportProgressEl.id = 'export-progress';
        _exportProgressEl.className = 'export-progress-overlay';
        _exportProgressEl.innerHTML =
          '<div class="export-progress-status">' +
            '<span class="export-progress-label">正在准备导出...</span>' +
            '<span class="export-progress-percent">0%</span>' +
          '</div>' +
          '<div class="export-progress-track">' +
            '<div class="export-progress-fill" id="export-progress-fill"></div>' +
          '</div>';
      document.body.appendChild(_exportProgressEl);
      }
    }
    return _exportProgressEl;
  }

  function showExportProgress(label, percent) {
    const el = getExportProgressEl();
    el.classList.add('visible');
    el.querySelector('.export-progress-label').textContent = label;
    const fill = el.querySelector('.export-progress-fill');
    fill.classList.remove('done');
    const pct = Math.min(100, Math.max(0, percent));
    fill.style.width = pct + '%';
    el.querySelector('.export-progress-percent').textContent = pct + '%';
  }

  function hideExportProgress() {
    const el = getExportProgressEl();
    el.classList.remove('visible');
    el.querySelector('.export-progress-fill').style.width = '0%';
  }

  function doneExportProgress() {
    const el = getExportProgressEl();
    const fill = el.querySelector('.export-progress-fill');
    fill.style.width = '100%';
    fill.classList.add('done');
    el.querySelector('.export-progress-label').textContent = '导出完成 ✓';
    el.querySelector('.export-progress-percent').textContent = '100%';
    setTimeout(hideExportProgress, 2000);
  }

  async function exportWord() {
    const tab = state.tabs[state.activeTab];
    if (!tab || !tab.content) {
      showToast('请先打开一个 Markdown 文件');
      return;
    }

    // Check if template toggle is on; if so, ask user to pick a .docx template.
    let templatePath = null;
    if (localStorage.getItem('wordExportUseTemplate') === 'true') {
      const useTemplate = await _showConfirm('已启用 Word 模板样式。\n\n导出前是否先选择模板文件？\n\n• 选择模板：使用模板中的字体/字号/行距/编号样式\n• 取消：本次仍用默认样式导出');
      if (useTemplate) {
        try {
          if (window.__TAURI__ && window.__TAURI__.dialog) {
            const selected = await window.__TAURI__.dialog.open({
              title: '选择 Word 样式模板',
              filters: [{ name: 'Word 模板', extensions: ['docx'] }],
              multiple: false
            });
            if (selected) {
              templatePath = selected;
            }
          } else {
            // Fallback for non-Tauri environment (web preview)
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.docx';
            const file = await new Promise((resolve) => {
              input.onchange = () => resolve(input.files[0]);
              input.click();
            });
            if (file) {
              // For web preview, we can't get a real path; skip template
              console.warn('[export-word] Template selection requires Tauri runtime');
            }
          }
        } catch (err) {
          console.warn('[export-word] Template selection failed:', err);
          // Non-fatal: continue export without template
        }
      }
      // If user cancelled the confirm or the file dialog, templatePath stays null
      // and we export without a template.
    }

    try {
      showExportProgress('正在准备导出...', 0);

      const mermaidBlocks = findMermaidBlocks(tab.content);
      const mermaidImages = {};
      if (mermaidBlocks.length > 0) {
        showExportProgress(`正在渲染 Mermaid 图表 (1/${mermaidBlocks.length})...`, 5);

        // Export with the light theme so text is dark on Word's white background.
        // Restore the editor theme afterwards so the live preview is not affected.
        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
        const savedTheme = isDark ? CONFIG.mermaidTheme.dark : CONFIG.mermaidTheme.light;

        const exportThemeCSS = `
          .node rect, .node circle, .node polygon, .node path { stroke-width: 3px; }
          .label tspan, .label text { font-size: 12px; }
          .nodeLabel { font-size: 12px; }
          .edgeLabel, .edgeLabel tspan, .edgeLabel text { font-size: 11px; }
          .actor, .actor-man { font-size: 22px; }
          .messageText { font-size: 20px; }
          .classTitle { font-size: 15px; }
          .entityLabel { font-size: 15px; }
          .relationshipLabel { font-size: 13px; }
          .pieTitleText { font-size: 18px; }
          .slice { font-size: 15px; }
          .legend text { font-size: 13px; }
        `;
        const compactConfig = {
          startOnLoad: false,
          theme: 'default',
          securityLevel: 'loose',
          htmlLabels: false,
          themeCSS: exportThemeCSS,
          themeVariables: { fontSize: '12px' },
          flowchart: { htmlLabels: false, useMaxWidth: false, padding: 8, nodeSpacing: 30, rankSpacing: 35 },
          sequence: { useMaxWidth: false, diagramMarginX: 10, diagramMarginY: 5, actorMargin: 12, boxMargin: 4, messageMargin: 10 },
          class: { htmlLabels: false, useMaxWidth: false, padding: 8 },
          state: { htmlLabels: false, useMaxWidth: false, padding: 6 },
          er: { htmlLabels: false, useMaxWidth: false, padding: 6 },
          journey: { htmlLabels: false, useMaxWidth: false, padding: 6 },
          gantt: { useMaxWidth: false, padding: 6 },
          pie: { useMaxWidth: false, padding: 2 },
          requirement: { useMaxWidth: false, padding: 6 },
          gitgraph: { useMaxWidth: false, padding: 6 },
          mindmap: { htmlLabels: false, useMaxWidth: false, padding: 6 },
          timeline: { htmlLabels: false, useMaxWidth: false, padding: 6 },
          c4context: { htmlLabels: false, useMaxWidth: false, padding: 6 },
          block: { htmlLabels: false, useMaxWidth: false, padding: 6 }
        };
        const safeClassConfig = {
          startOnLoad: false,
          theme: 'default',
          securityLevel: 'loose',
          htmlLabels: false,
          themeCSS: '',
          class: { htmlLabels: false, useMaxWidth: false, padding: 15 },
          flowchart: { htmlLabels: false, useMaxWidth: false }
        };

        try {
          let mermaidDone = 0;
          const totalMermaid = mermaidBlocks.length;
          await Promise.all(
            mermaidBlocks.map(async (source) => {
              try {
                // Re-initialize before each block so a per-block fallback cannot
                // leak its config into the next diagram.
                if (typeof window.mermaid !== 'undefined' && window.mermaid.initialize) {
                  window.mermaid.initialize(compactConfig);
                }
                const fallback = /^\s*classDiagram\b/m.test(source) ? safeClassConfig : undefined;
                const { svg, width, height } = await renderMermaidSourceToPng(source, fallback);
                mermaidImages[source] = { svg, width, height };
              } catch (err) {
                const preview = source.split('\n').slice(0, 2).join(' ').substring(0, 80);
                console.error('Mermaid render failed for:', preview, err);
                showError('Mermaid 渲染失败，将导出源码: ' + (err.message || err));
              }
              mermaidDone++;
              const pct = 5 + Math.round((mermaidDone / totalMermaid) * 55);
              showExportProgress(`正在渲染 Mermaid 图表 (${mermaidDone}/${totalMermaid})...`, pct);
            })
          );

          const renderedKeys = Object.keys(mermaidImages);
          console.log('[export-word] blocks found:', mermaidBlocks.length, 'rendered:', renderedKeys.length);
          console.log('[export-word] intermediate data available in window.__mermaidDebug');
        } finally {
          if (typeof window.mermaid !== 'undefined' && window.mermaid.initialize) {
            window.mermaid.initialize({
              startOnLoad: false,
              theme: savedTheme,
              securityLevel: 'loose',
              htmlLabels: true,
              themeCSS: '',
              flowchart: { htmlLabels: true, useMaxWidth: true, padding: 8, nodeSpacing: 50, rankSpacing: 50 },
              sequence: { useMaxWidth: true, diagramMarginX: 50, diagramMarginY: 10, actorMargin: 50, boxMargin: 10, messageMargin: 35 },
              class: { htmlLabels: true, useMaxWidth: true, padding: 5 },
              state: { htmlLabels: true, useMaxWidth: true, padding: 5 },
              er: { htmlLabels: true, useMaxWidth: true, padding: 20 },
              journey: { htmlLabels: true, useMaxWidth: true, padding: 8 },
              gantt: { useMaxWidth: true, padding: 8 },
              pie: { useMaxWidth: true, padding: 10 },
              requirement: { useMaxWidth: true, padding: 10 },
              gitgraph: { useMaxWidth: true, padding: 10 },
              mindmap: { useMaxWidth: true, padding: 10 },
              timeline: { useMaxWidth: true, padding: 10 },
              c4context: { useMaxWidth: true, padding: 10 },
              block: { useMaxWidth: true, padding: 10 }
            });
          }
        }
      }

      // Listen for real-time progress from the Rust backend
      let unlistenProgress = null;
      if (window.__TAURI__ && window.__TAURI__.event) {
        unlistenProgress = await window.__TAURI__.event.listen('export-progress', (event) => {
          const { stage, percent, message } = event.payload;
          const label = message || stage;
          if (percent >= 100) {
            doneExportProgress();
          } else {
            showExportProgress(label, percent);
          }
        });
      } else {
        // Fallback: show indeterminate progress
        showExportProgress('正在生成 Word 文档...', 70);
      }

      try {
        const result = await invoke('export_word', {
          markdown: tab.content,
          fileName: tab.name,
          filePath: tab.path || '',
          mermaidImages,
          templatePath: templatePath || null
        });
        doneExportProgress();
      } finally {
        if (unlistenProgress) unlistenProgress();
      }
    } catch (err) {
      console.error('Word export failed:', err);
      hideExportProgress();
      showError('Word 导出失败: ' + err);
    }
  }

  // ============================================
  // Document Search
  // ============================================
  function openSearch() {
    if (!elements.searchBar) return;
    elements.searchBar.style.display = 'flex';
    if (elements.searchInput) {
      elements.searchInput.focus();
      elements.searchInput.select();
    }
  }

  function closeSearch() {
    if (!elements.searchBar) return;
    elements.searchBar.style.display = 'none';
    clearSearchHighlights();
    state.searchQuery = '';
    state.searchMatches = [];
    state.searchCurrentIndex = -1;
    if (elements.searchInput) {
      elements.searchInput.value = '';
    }
    updateSearchCount();
  }

  function clearSearchHighlights() {
    if (!elements.markdownBody) return;
    const marks = elements.markdownBody.querySelectorAll('mark.search-match, mark.search-match-current');
    marks.forEach(mark => {
      const parent = mark.parentNode;
      if (parent) {
        parent.replaceChild(document.createTextNode(mark.textContent), mark);
        parent.normalize();
      }
    });
  }

  function performSearch(query) {
    clearSearchHighlights();
    state.searchQuery = query;
    state.searchMatches = [];
    state.searchCurrentIndex = -1;

    if (!query || !elements.markdownBody) {
      updateSearchCount();
      return;
    }

    const walker = document.createTreeWalker(
      elements.markdownBody,
      NodeFilter.SHOW_TEXT,
      null,
      false
    );

    const textNodes = [];
    let node;
    while ((node = walker.nextNode())) {
      // Skip text nodes inside script/style tags or already inside mark elements
      const parent = node.parentElement;
      if (parent && (parent.tagName === 'SCRIPT' || parent.tagName === 'STYLE' || parent.tagName === 'MARK')) {
        continue;
      }
      textNodes.push(node);
    }

    // Process from end to start to avoid index shifting when splitting nodes
    for (let i = textNodes.length - 1; i >= 0; i--) {
      const textNode = textNodes[i];
      const text = textNode.textContent;
      const lowerText = text.toLowerCase();
      const lowerQuery = query.toLowerCase();

      let idx = lowerText.lastIndexOf(lowerQuery);
      while (idx !== -1) {
        const endIdx = idx + query.length;
        const range = document.createRange();
        range.setStart(textNode, idx);
        range.setEnd(textNode, endIdx);

        const mark = document.createElement('mark');
        mark.className = 'search-match';
        try {
          range.surroundContents(mark);
          state.searchMatches.unshift(mark);
        } catch (err) {
          // surroundContents fails if range crosses element boundaries
          // In that case, skip this match
        }

        idx = lowerText.lastIndexOf(lowerQuery, idx - 1);
      }
    }

    if (state.searchMatches.length > 0) {
      state.searchCurrentIndex = 0;
      highlightCurrentMatch();
      scrollToCurrentMatch();
    }
    updateSearchCount();
  }

  function highlightCurrentMatch() {
    state.searchMatches.forEach((mark, index) => {
      mark.className = index === state.searchCurrentIndex ? 'search-match-current' : 'search-match';
    });
  }

  function scrollToCurrentMatch() {
    const mark = state.searchMatches[state.searchCurrentIndex];
    if (mark && elements.markdownBody) {
      mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  function navigateSearch(direction) {
    if (state.searchMatches.length === 0) return;
    state.searchCurrentIndex += direction;
    if (state.searchCurrentIndex >= state.searchMatches.length) {
      state.searchCurrentIndex = 0;
    } else if (state.searchCurrentIndex < 0) {
      state.searchCurrentIndex = state.searchMatches.length - 1;
    }
    highlightCurrentMatch();
    scrollToCurrentMatch();
    updateSearchCount();
  }

  function updateSearchCount() {
    if (!elements.searchCount) return;
    const total = state.searchMatches.length;
    if (total === 0) {
      elements.searchCount.textContent = state.searchQuery ? '0/0' : '';
    } else {
      elements.searchCount.textContent = (state.searchCurrentIndex + 1) + '/' + total;
    }
  }

  // ============================================
  // Keyboard Shortcuts
  // ============================================
  function setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      // Ctrl+O: Open file
      if (e.ctrlKey && e.key === 'o' && !e.shiftKey) {
        e.preventDefault();
        openFile();
      }

      // Ctrl+Shift+O: Open folder
      if (e.ctrlKey && e.shiftKey && e.key === 'O') {
        e.preventDefault();
        openFolder();
      }

      // Ctrl+E: Toggle source mode
      if (e.ctrlKey && e.key === 'e') {
        e.preventDefault();
        toggleSourceMode();
      }

      // Ctrl+F: Open document search
      if (e.ctrlKey && e.key === 'f') {
        e.preventDefault();
        if (elements.searchBar && elements.searchBar.style.display === 'flex') {
          closeSearch();
        } else {
          openSearch();
        }
      }

      // Escape: Close lightbox, search, or exit source mode
      if (e.key === 'Escape') {
        const lightbox = document.querySelector('.image-lightbox');
        if (lightbox) {
          closeLightbox(lightbox);
        } else if (elements.searchBar && elements.searchBar.style.display === 'flex') {
          closeSearch();
        } else if (state.sourceMode) {
          toggleSourceMode();
        }
      }

      // Ctrl+T: Toggle sidebar
      if (e.ctrlKey && e.key === 't') {
        e.preventDefault();
        toggleSidebar();
      }

      // Ctrl+P: Export to PDF
      if (e.ctrlKey && e.key === 'p') {
        e.preventDefault();
        exportToPDF();
      }

      // Ctrl+Shift+L: Toggle theme
      if (e.ctrlKey && e.shiftKey && e.key === 'L') {
        e.preventDefault();
        toggleTheme();
      }

      // F5: Open slides presentation
      if (e.key === 'F5') {
        e.preventDefault();
        openSlides();
      }

      // F11: Toggle Zen Mode (focus mode)
      if (e.key === 'F11') {
        e.preventDefault();
        toggleZenMode();
      }
    });
  }

  // ============================================
  // Drag and Drop
  // ============================================
  function setupDragDrop() {
    document.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    });

    // Use Tauri native drag-drop event to get file paths
    if (window.__TAURI__) {
      const { listen } = window.__TAURI__.event;
      listen('tauri://drag-drop', (event) => {
        const paths = event.payload.paths;
        if (paths && paths.length > 0) {
          const filePath = paths[0];
          if (filePath.endsWith('.md') || filePath.endsWith('.markdown')) {
            invoke('open_file', { path: filePath }).then(result => {
              if (result && result.content) {
                addTab(result.path, result.content, result.base_dir || '');
              }
            }).catch(err => {
              showError('无法打开文件: ' + err);
            });
          } else {
            showError('请打开 Markdown 文件 (.md 或 .markdown)');
          }
        }
      });
    }
  }

  async function readFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsText(file);
    });
  }

  // ============================================
  // Utility Functions
  // ============================================
  function getFileName(path) {
    const parts = path.split(/[\\/]/);
    return parts[parts.length - 1] || path;
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function showError(message) {
    // Simple error notification
    const errorDiv = document.createElement('div');
    errorDiv.className = 'error-notification';
    errorDiv.textContent = message;
    errorDiv.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      padding: 12px 20px;
      background: var(--color-error);
      color: white;
      border-radius: var(--radius-md);
      z-index: 1000;
      animation: fadeIn 0.3s ease;
    `;

    document.body.appendChild(errorDiv);
    setTimeout(() => errorDiv.remove(), 3000);
  }

  // ============================================
  // Scroll Observer
  // ============================================
  function setupScrollObserver() {
    elements.markdownBody.addEventListener('scroll', () => {
      clearTimeout(state.scrollTimeout);
      state.scrollTimeout = setTimeout(handleScrollSync, CONFIG.scrollSyncDelay);
    });
  }

  // ============================================
  // Theme Management
  // ============================================
  function initTheme() {
    const saved = localStorage.getItem('typora-theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const initial = TM.resolveInitialTheme(saved, prefersDark);
    applyTheme(initial);
  }

  function applyTheme(theme) {
    const root = document.documentElement;
    // Use theme-manager to decide the DOM mutation. Invariant: data-theme is
    // always set (never removed), so :root:not([data-theme]) cannot match the
    // @media (prefers-color-scheme: dark) rule and override the explicit choice.
    const cmd = TM.domCommandForTheme(theme);
    if (cmd.action === 'setAttribute') {
      root.setAttribute(cmd.attr, cmd.value);
    } else if (cmd.action === 'removeAttribute') {
      root.removeAttribute(cmd.attr);
    }
    updateThemeIcon(theme);
    reinitMermaid(theme);
    localStorage.setItem('typora-theme', theme);
  }

  function applyThemeFromConfig(theme) {
    applyTheme(theme || 'light');
  }

  function applyCustomCursor(cursorType) {
    document.body.classList.remove('cursor-pencil', 'cursor-highlighter', 'cursor-pen', 'cursor-cat', 'cursor-microphone', 'cursor-rocket', 'cursor-wand');
    if (cursorType) {
      document.body.classList.add('cursor-' + cursorType);
    }
  }

  function toggleTheme() {
    const currentAttr = document.documentElement.getAttribute('data-theme');
    const newTheme = TM.computeToggledTheme(currentAttr);
    applyTheme(newTheme);
    // Save theme to config
    if (window.__TAURI__) {
      invoke('get_config').then(config => {
        if (config) {
          config.theme = newTheme;
          invoke('set_config', { config }).catch(err => {
            console.error('Failed to save theme:', err);
          });
        }
      }).catch(err => {
        console.error('Failed to get config for theme save:', err);
      });
    }
  }

  function updateThemeIcon(theme) {
    if (elements.themeIconLight && elements.themeIconDark) {
      elements.themeIconLight.style.display = theme === 'dark' ? 'none' : 'block';
      elements.themeIconDark.style.display = theme === 'dark' ? 'block' : 'none';
    }
  }

  function reinitMermaid(theme) {
    if (typeof mermaid !== 'undefined') {
      mermaid.initialize({ theme: theme === 'dark' ? CONFIG.mermaidTheme.dark : CONFIG.mermaidTheme.light });
      mermaid.run();
    }
  }

  function setupThemeDetection() {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
      if (!localStorage.getItem('typora-theme')) {
        applyTheme(e.matches ? 'dark' : 'light');
      }
    });
  }

  // ============================================
  // Event Bindings
  // ============================================
  function bindEvents() {
    elements.openFileBtn.addEventListener('click', openFile);
    if (elements.paperReaderBtn) {
      elements.paperReaderBtn.addEventListener('click', openPaperReader);
    }
    elements.sourceToggle.addEventListener('click', toggleSourceMode);
    elements.sidebarToggle.addEventListener('click', toggleSidebar);
    elements.tabFiles.addEventListener('click', () => switchSidebarTab('files'));
    elements.tabToc.addEventListener('click', () => switchSidebarTab('toc'));
    elements.openFolderBtn.addEventListener('click', openFolder);
    elements.openFolderToolbarBtn.addEventListener('click', openFolder);
    elements.exportPdfBtn.addEventListener('click', exportToPDF);
    if (elements.exportWordBtn) {
      elements.exportWordBtn.addEventListener('click', exportWord);
    }
    if (elements.shareBtn) {
      elements.shareBtn.addEventListener('click', () => shareDocument());
    }
    if (elements.slidesBtn) {
      elements.slidesBtn.addEventListener('click', openSlides);
    }
    if (elements.translateBtn) {
      elements.translateBtn.addEventListener('click', toggleTranslation);
    }
    // Sprint 8a: Socratic dev quick-trigger (gated by localStorage flag, see isDevQuickTriggerEnabled)
    const socraticQuickBtn = document.getElementById('openSocraticBtn');
    if (socraticQuickBtn) {
      socraticQuickBtn.addEventListener('click', () => {
        // Re-check the dev flag on every click (user may have just enabled it in DevTools)
        _updateSocraticButtonState();
        if (!window.SocraticTrigger?.isDevQuickTriggerEnabled?.()) {
          showToast('Socratic 快捷入口已禁用。开发模式：在 DevTools 执行 localStorage.setItem("socratic-dev-trigger","true")', 'info', 5000);
          return;
        }
        openSocraticReview();
      });
    }
    // Re-check flag when window regains focus (user comes back from DevTools)
    window.addEventListener('focus', _updateSocraticButtonState);
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'S' && window.LearningProgress) {
        e.preventDefault();
        if (window.SocraticTrigger?.isDevQuickTriggerEnabled?.()) {
          openSocraticReview();
        }
      }
    });
    elements.themeToggle.addEventListener('click', toggleTheme);

    if (elements.settingsBtn) {
      elements.settingsBtn.addEventListener('click', openSettings);
    }
    if (elements.settingsModalClose) {
      elements.settingsModalClose.addEventListener('click', closeSettings);
    }
    if (elements.settingsCancel) {
      elements.settingsCancel.addEventListener('click', closeSettings);
    }
    if (elements.settingsSave) {
      elements.settingsSave.addEventListener('click', saveSettings);
    }
    if (elements.settingsTest) {
      elements.settingsTest.addEventListener('click', testLLMConfig);
    }
    if (elements.restartOnboardingBtn) {
      elements.restartOnboardingBtn.addEventListener('click', () => {
        if (onboardingManager) {
          onboardingManager.restart();
          closeSettings();
        }
      });
    }
    if (elements.settingsModal) {
      elements.settingsModal.addEventListener('click', (e) => {
        if (e.target === elements.settingsModal) closeSettings();
      });
    }

    // About modal
    if (elements.settingsAboutBtn) {
      elements.settingsAboutBtn.addEventListener('click', openAboutModal);
    }
    if (elements.aboutModalClose) {
      elements.aboutModalClose.addEventListener('click', closeAboutModal);
    }
    if (elements.aboutModalCloseBtn) {
      elements.aboutModalCloseBtn.addEventListener('click', closeAboutModal);
    }
    if (elements.aboutModal) {
      elements.aboutModal.addEventListener('click', (e) => {
        if (e.target === elements.aboutModal) closeAboutModal();
      });
    }

    // Update check button
    if (elements.checkUpdateBtn) {
      elements.checkUpdateBtn.addEventListener('click', () => checkForUpdates(elements.updateStatus));
    }

    if (elements.fileTreeSearch) {
      elements.fileTreeSearch.addEventListener('input', (e) => {
        filterFileTree(e.target.value);
      });
    }

    if (elements.clearRecentFiles) {
      elements.clearRecentFiles.addEventListener('click', clearRecentFiles);
    }

    if (elements.markdownBody) {
      elements.markdownBody.addEventListener('contextmenu', showMarkdownContextMenu);
    }

    // Search bar events
    if (elements.searchInput) {
      elements.searchInput.addEventListener('input', (e) => {
        performSearch(e.target.value);
      });
      elements.searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          navigateSearch(e.shiftKey ? -1 : 1);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          closeSearch();
        }
      });
    }
    if (elements.searchPrev) {
      elements.searchPrev.addEventListener('click', () => navigateSearch(-1));
    }
    if (elements.searchNext) {
      elements.searchNext.addEventListener('click', () => navigateSearch(1));
    }
    if (elements.searchClose) {
      elements.searchClose.addEventListener('click', closeSearch);
    }
  }

  // ============================================
  // Settings / Configuration
  // ============================================
  async function loadConfig() {
    if (!window.__TAURI__) return;
    try {
      const config = await invoke('get_config');
      if (config) {
        if (config.api_key && elements.settingApiKey) {
          elements.settingApiKey.value = config.api_key;
        }
        if (config.ai_provider && elements.settingAiProvider) {
          elements.settingAiProvider.value = config.ai_provider;
        }
        if (config.ai_base_url !== undefined && elements.settingAiBaseUrl) {
          elements.settingAiBaseUrl.value = config.ai_base_url || '';
        }
        if (config.model !== undefined && elements.settingModel) {
          elements.settingModel.value = config.model || '';
        }
        if (config.mineru_api_token !== undefined && elements.settingMineruToken) {
          elements.settingMineruToken.value = config.mineru_api_token || '';
        }
        if (config.mineru_base_url !== undefined && elements.settingMineruBaseUrl) {
          elements.settingMineruBaseUrl.value = config.mineru_base_url || '';
        }
        if (config.mineru_model_version !== undefined && elements.settingMineruModel) {
          elements.settingMineruModel.value = config.mineru_model_version || 'vlm';
        }
        if (config.theme && elements.settingTheme) {
          elements.settingTheme.value = config.theme;
          applyTheme(config.theme);
        }
        if (elements.settingCustomCursor) {
          elements.settingCustomCursor.value = config.custom_cursor || '';
          applyCustomCursor(config.custom_cursor);
        }
      }
    } catch (err) {
      console.error('Failed to load config:', err);
    }
  }

  async function loadUIState() {
    if (!window.__TAURI__) return;
    try {
      const config = await invoke('get_config');
      if (!config) return;

      // Restore sidebar collapsed state
      if (config.sidebar_collapsed !== undefined && config.sidebar_collapsed !== null) {
        state.sidebarCollapsed = config.sidebar_collapsed;
        elements.sidebar.classList.toggle('collapsed', state.sidebarCollapsed);
      }

      // Restore sidebar active tab
      if (config.sidebar_active_tab) {
        switchSidebarTab(config.sidebar_active_tab);
      }

      // Note: do NOT auto-open last file on startup — user prefers clean start
    } catch (err) {
      console.error('Failed to load UI state:', err);
    }
  }

  async function saveUIState() {
    if (!window.__TAURI__) return;
    try {
      const config = await invoke('get_config');
      if (!config) return;

      config.sidebar_collapsed = state.sidebarCollapsed;
      config.sidebar_active_tab = state.sidebarActiveTab;

      // Save last_file for reference, but don't auto-open on startup
      const activeTab = state.tabs[state.activeTab];
      config.last_file = activeTab ? activeTab.path : null;

      await invoke('set_config', { config });
    } catch (err) {
      console.error('Failed to save UI state:', err);
    }
  }

  function openSettings() {
    if (elements.settingsModal) {
      elements.settingsModal.style.display = 'flex';
    }
    // Load word template toggle from localStorage
    if (elements.settingWordTemplate) {
      elements.settingWordTemplate.checked = localStorage.getItem('wordExportUseTemplate') === 'true';
    }
  }

  function closeSettings() {
    if (elements.settingsModal) {
      elements.settingsModal.style.display = 'none';
    }
  }

  // ============================================
  // About Modal
  // ============================================
  async function openAboutModal() {
    if (!elements.aboutModal) return;
    // Load version info
    try {
      const info = await invoke('get_app_info');
      if (elements.aboutVersion) elements.aboutVersion.textContent = info.version;
      if (elements.aboutPlatform) elements.aboutPlatform.textContent = info.platform;
      if (elements.aboutIdentifier) elements.aboutIdentifier.textContent = info.identifier;
    } catch (err) {
      console.error('Failed to load app info:', err);
      if (elements.aboutVersion) elements.aboutVersion.textContent = '--';
    }
    elements.aboutModal.style.display = 'flex';
  }

  function closeAboutModal() {
    if (elements.aboutModal) {
      elements.aboutModal.style.display = 'none';
    }
  }

  // ============================================
  // Update Check
  // ============================================
  let _updateAvailableInfo = null;

  async function checkForUpdates(showStatusEl) {
    const statusEl = showStatusEl || elements.updateStatus;
    if (statusEl) {
      statusEl.textContent = '检查中…';
      statusEl.className = 'about-update-status checking';
    }

    try {
      const result = await window.Updater.check();
      if (result.available) {
        _updateAvailableInfo = result;
        showUpdateBadge(true);
        if (statusEl) {
          statusEl.textContent = `发现新版本 ${result.version}，请更新`;
          statusEl.className = 'about-update-status update-available';
        }
        // Ask user if they want to update now
        if (!showStatusEl) {
          // Auto-detected on startup — show a lightweight notification
          askUpdateConfirmation(result);
        }
      } else {
        showUpdateBadge(false);
        if (statusEl) {
          if (result.error) {
            statusEl.textContent = '更新服务未配置，请设置 GitHub Release';
            statusEl.className = 'about-update-status error';
          } else {
            statusEl.textContent = '已是最新版本 ✓';
            statusEl.className = 'about-update-status up-to-date';
          }
        }
      }
    } catch (err) {
      console.error('[About] Update check error:', err);
      if (statusEl) {
        statusEl.textContent = '检查更新失败';
        statusEl.className = 'about-update-status error';
      }
    }
  }

  function showUpdateBadge(show) {
    if (elements.updateBadge) {
      elements.updateBadge.style.display = show ? 'block' : 'none';
    }
    // Also update settings button tooltip
    if (elements.settingsBtn) {
      elements.settingsBtn.setAttribute('data-tooltip', show ? '设置（有可用更新）' : '设置');
    }
  }

  async function askUpdateConfirmation(update) {
    // Simple confirm dialog
    const confirmed = await new Promise((resolve) => {
      // Use a simple custom confirm or Tauri dialog if available
      if (window.__TAURI__ && window.__TAURI__.core) {
        // Emit a custom event that the update handler can pick up
        window.__updateConfirmResolve = resolve;
        showUpdateNotification(update);
      } else {
        resolve(false);
      }
    });

    if (confirmed) {
      await performUpdate(update);
    }
  }

  function showUpdateNotification(update) {
    // Create a lightweight notification banner
    const existing = document.getElementById('updateNotification');
    if (existing) existing.remove();

    const notif = document.createElement('div');
    notif.id = 'updateNotification';
    notif.className = 'update-notification';
    notif.innerHTML = `
      <div class="update-notif-content">
        <span class="update-notif-icon">📦</span>
        <span class="update-notif-text">发现新版本 <strong>${update.version}</strong></span>
        <div class="update-notif-actions">
          <button class="update-notif-btn update-notif-primary" id="updateNotifInstall">更新</button>
          <button class="update-notif-btn update-notif-skip" id="updateNotifSkip">稍后</button>
        </div>
      </div>
      <button class="update-notif-close" id="updateNotifClose">&times;</button>
    `;
    document.body.appendChild(notif);

    // Animate in
    requestAnimationFrame(() => notif.classList.add('show'));

    // Wire up buttons
    document.getElementById('updateNotifInstall').addEventListener('click', () => {
      notif.classList.remove('show');
      setTimeout(() => notif.remove(), 300);
      if (window.__updateConfirmResolve) window.__updateConfirmResolve(true);
    });
    document.getElementById('updateNotifSkip').addEventListener('click', () => {
      notif.classList.remove('show');
      setTimeout(() => notif.remove(), 300);
      if (window.__updateConfirmResolve) window.__updateConfirmResolve(false);
    });
    document.getElementById('updateNotifClose').addEventListener('click', () => {
      notif.classList.remove('show');
      setTimeout(() => notif.remove(), 300);
      if (window.__updateConfirmResolve) window.__updateConfirmResolve(false);
    });
  }

  async function performUpdate(update) {
    if (!update) return;
    try {
      if (elements.updateStatus) {
        elements.updateStatus.textContent = '正在下载更新…';
        elements.updateStatus.className = 'about-update-status checking';
      }

      await update.downloadAndInstall();

      if (elements.updateStatus) {
        elements.updateStatus.textContent = '更新已下载，正在重启…';
      }

      // Restart to apply update
      await window.Updater.restart();
    } catch (err) {
      console.error('[Update] Download/install failed:', err);
      if (elements.updateStatus) {
        elements.updateStatus.textContent = '更新失败：' + (err.message || String(err));
        elements.updateStatus.className = 'about-update-status error';
      }
    }
  }

  async function testLLMConfig() {
    const apiKey = elements.settingApiKey ? elements.settingApiKey.value.trim() : '';
    const aiProvider = elements.settingAiProvider ? elements.settingAiProvider.value : 'anthropic';
    const aiBaseUrl = elements.settingAiBaseUrl ? elements.settingAiBaseUrl.value.trim() : '';
    const model = elements.settingModel ? elements.settingModel.value.trim() : '';

    if (!apiKey) {
      if (elements.testResult) {
        elements.testResult.textContent = '请先填写 API Key';
        elements.testResult.style.color = 'var(--color-error)';
      }
      return;
    }

    if (elements.testResult) {
      elements.testResult.textContent = '测试中...';
      elements.testResult.style.color = 'var(--color-text-secondary)';
    }

    const config = {
      api_key: apiKey,
      ai_provider: aiProvider,
      ai_base_url: aiBaseUrl || null,
      model: model || null
    };

    try {
      await invoke('test_llm_config', { config });
      if (elements.testResult) {
        elements.testResult.textContent = '连接成功';
        elements.testResult.style.color = 'var(--color-success)';
      }
      showToast('连接测试成功');
    } catch (err) {
      console.error('LLM config test failed:', err);
      if (elements.testResult) {
        elements.testResult.textContent = '连接失败: ' + err;
        elements.testResult.style.color = 'var(--color-error)';
      }
    }
  }

  async function saveSettings() {
    const apiKey = elements.settingApiKey ? elements.settingApiKey.value.trim() : '';
    const aiProvider = elements.settingAiProvider ? elements.settingAiProvider.value : 'anthropic';
    const aiBaseUrl = elements.settingAiBaseUrl ? elements.settingAiBaseUrl.value.trim() : '';
    const model = elements.settingModel ? elements.settingModel.value.trim() : '';
    const mineruToken = elements.settingMineruToken ? elements.settingMineruToken.value.trim() : '';
    const mineruBaseUrl = elements.settingMineruBaseUrl ? elements.settingMineruBaseUrl.value.trim() : '';
    const mineruModel = elements.settingMineruModel ? elements.settingMineruModel.value : 'vlm';
    const theme = elements.settingTheme ? elements.settingTheme.value : '';
    const customCursor = elements.settingCustomCursor ? elements.settingCustomCursor.value : '';

    const config = {
      api_key: apiKey || null,
      ai_provider: aiProvider,
      ai_base_url: aiBaseUrl || null,
      model: model || null,
      mineru_api_token: mineruToken || null,
      mineru_base_url: mineruBaseUrl || null,
      mineru_model_version: mineruModel || null,
      theme: theme || null,
      custom_cursor: customCursor || null
    };

    // Save word template toggle to localStorage
    if (elements.settingWordTemplate) {
      localStorage.setItem('wordExportUseTemplate', elements.settingWordTemplate.checked ? 'true' : 'false');
    }

    try {
      await invoke('set_config', { config });
      if (theme) {
        applyTheme(theme);
      }
      applyCustomCursor(customCursor);
      showToast('设置已保存');
      closeSettings();
    } catch (err) {
      console.error('Failed to save config:', err);
      showError('保存失败: ' + err);
    }
  }

  // ============================================
  // Sprint 8a: Open Socratic review (bypass threshold, for testing + manual entry)
  // ============================================
  async function openSocraticReview() {
    if (!window.SocraticModal) {
      showToast('Socratic 模块未加载', 'error');
      return;
    }
    if (!AppWorkspace.isIn('course')) {
      showToast('请先进入课程模式', 'info');
      return;
    }
    // Prefer the learning module's project root (same source the auto-trigger
    // flow uses); fall back to the active editor tab's directory.
    const activeTab = state.tabs[state.activeTab];
    const projectPath = window.LearningModeIntegration?.getProjectPath?.()
      || activeTab?.baseDir
      || activeTab?.path?.replace(/[^\\/]+$/, '')
      || '';
    if (!projectPath) {
      showToast('请先打开一个学习项目', 'info');
      return;
    }
    try {
      const modal = new window.SocraticModal({ projectPath });
      await modal.open();
    } catch (e) {
      console.error('[Socratic] open failed:', e);
      showToast('打开 Socratic 失败: ' + e.message, 'error');
    }
  }

  // ============================================
  // Initialization
  // ============================================
  function init() {
    registerWorkspaces();
    initTheme();
    bindEvents();
    initTranslation();
    setupKeyboardShortcuts();
    setupDragDrop();
    setupScrollObserver();
    setupThemeDetection();
    setupFileWatcher();
    setupGenerationCloseGuard();
    loadConfig();
    loadRecentFiles();
    loadUIState();
    checkPlatform();
    initAgentStatusIndicator();

    console.log('Typora Next initialized');

    // Auto-check for updates on startup (delay to not block UI)
    setTimeout(() => {
      checkForUpdates(null);
    }, 5000);
  }

  function checkPlatform() {
    // Platform-specific UI adjustments go here.
    // Word export is now available on all platforms via Rust native converter.
  }

  // ============================================
  // Translation
  // ============================================
  function getTranslatableElements() {
    const container = elements.markdownBody;
    if (!container) return [];
    const els = container.querySelectorAll('p, li, h1, h2, h3, h4, h5, h6, blockquote');
    const result = [];
    els.forEach(el => {
      if (el.classList.contains('translation')) return;
      if (el.nextElementSibling && el.nextElementSibling.classList.contains('translation')) return;
      if (el.querySelector('pre, .katex, .mermaid')) return;
      const text = el.textContent.trim();
      if (text) result.push(el);
    });
    return result;
  }

  function showTranslationLoading() {
    if (!elements.markdownBody) return;
    hideTranslationLoading();
    const bar = document.createElement('div');
    bar.id = 'translationLoadingBar';
    bar.className = 'translation-loading-bar';
    bar.innerHTML = '<span class="translation-loading-spinner"></span>正在翻译...';
    elements.markdownBody.insertBefore(bar, elements.markdownBody.firstChild);
  }

  function hideTranslationLoading() {
    const bar = document.getElementById('translationLoadingBar');
    if (bar) bar.remove();
  }

  function insertTranslation(originalEl, translation) {
    const tagName = originalEl.tagName.toLowerCase();
    const translatedEl = document.createElement(tagName);
    translatedEl.className = 'translation';
    translatedEl.textContent = translation;
    originalEl.parentNode.insertBefore(translatedEl, originalEl.nextSibling);
  }

  function clearTranslations() {
    if (translationObserver) {
      translationObserver.disconnect();
      translationObserver = null;
    }
    if (elements.markdownBody) {
      elements.markdownBody.querySelectorAll('.translation').forEach(el => el.remove());
    }
    state.isTranslated = false;
    if (elements.translateBtn) {
      elements.translateBtn.title = '翻译';
      elements.translateBtn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
      </svg>`;
    }
    hideSelectionToolbar();
  }

  async function translateElementBatch(els) {
    if (els.length === 0) return;
    const texts = els.map(el => el.textContent.trim());
    const currentPath = state.tabs[state.activeTab]?.path || '';
    const translations = await invoke('translate_text', {
      texts: texts,
      targetLang: 'zh-CN',
      filePath: currentPath
    });
    for (let i = 0; i < els.length; i++) {
      if (translations[i] && translations[i] !== texts[i]) {
        insertTranslation(els[i], translations[i]);
      }
    }
  }

  function setupLazyTranslation(els) {
    if (translationObserver) {
      translationObserver.disconnect();
    }

    let debounceTimer = null;
    const pendingEls = [];

    translationObserver = new IntersectionObserver((entries) => {
      const newlyVisible = entries
        .filter(e => e.isIntersecting)
        .map(e => e.target);

      if (newlyVisible.length === 0) return;

      pendingEls.push(...newlyVisible);
      newlyVisible.forEach(el => translationObserver.unobserve(el));

      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(async () => {
        const batch = pendingEls.splice(0, pendingEls.length);
        if (batch.length > 0) {
          try {
            await translateElementBatch(batch);
          } catch (err) {
            showError('翻译失败: ' + err);
          }
        }
      }, 300);
    }, {
      rootMargin: '300px 0px',
      threshold: 0
    });

    els.forEach(el => translationObserver.observe(el));
  }

  async function translateFullPage() {
    const allEls = getTranslatableElements();
    if (allEls.length === 0) return;

    showTranslationLoading();
    if (elements.translateBtn) {
      elements.translateBtn.disabled = true;
      elements.translateBtn.title = '翻译中...';
    }

    try {
      const viewportEls = allEls.filter(el => {
        const rect = el.getBoundingClientRect();
        return rect.top < window.innerHeight && rect.bottom > 0;
      });

      if (viewportEls.length > 0) {
        await translateElementBatch(viewportEls);
      }

      hideTranslationLoading();
      state.isTranslated = true;
      if (elements.translateBtn) {
        elements.translateBtn.disabled = false;
        elements.translateBtn.title = '清除译文';
        elements.translateBtn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>`;
      }

      const remainingEls = allEls.filter(el => {
        const sibling = el.nextElementSibling;
        return !sibling || !sibling.classList.contains('translation');
      });
      if (remainingEls.length > 0) {
        setupLazyTranslation(remainingEls);
      }
    } catch (err) {
      showError('翻译失败: ' + err);
      hideTranslationLoading();
      if (elements.translateBtn) {
        elements.translateBtn.disabled = false;
      }
    }
  }

  function toggleTranslation() {
    if (state.isTranslated) {
      clearTranslations();
    } else {
      translateFullPage();
    }
  }

  let translationObserver = null;
  let selectionToolbar = null;
  let lastAnnotationId = null;

  const ANNOTATION_COLORS = [
    { color: '#ffeb3b', label: '黄' },
    { color: '#a5d6a7', label: '绿' },
    { color: '#90caf9', label: '蓝' },
    { color: '#ce93d8', label: '紫' },
    { color: '#ef9a9a', label: '红' },
  ];
  let currentAnnotationStyle = 'highlight';

  function createSelectionToolbar() {
    if (selectionToolbar) return;
    selectionToolbar = document.createElement('div');
    selectionToolbar.className = 'selection-toolbar';
    selectionToolbar.style.display = 'none';
    selectionToolbar.innerHTML = `
      <div class="toolbar-row colors">
        ${ANNOTATION_COLORS.map(c => `<button class="color-btn" data-color="${c.color}" style="background:${c.color}" title="${c.label}"></button>`).join('')}
      </div>
      <div class="toolbar-row actions">
        <button id="styleHighlight" title="底纹" class="active">▐</button>
        <button id="styleUnderline" title="下划线">U̲</button>
        <button id="annotateBtn" title="添加批注">💬</button>
        <button id="deleteAnnotationBtn" title="删除">🗑️</button>
        <button id="translateSelectionBtn" title="翻译">译</button>
        <button id="aiExplainBtn" title="AI 解释" style="display:none">🤖</button>
      </div>
    `;
    document.body.appendChild(selectionToolbar);

    const styleHighlightBtn = selectionToolbar.querySelector('#styleHighlight');
    const styleUnderlineBtn = selectionToolbar.querySelector('#styleUnderline');

    async function setStyle(style) {
      currentAnnotationStyle = style;
      styleHighlightBtn.classList.toggle('active', style === 'highlight');
      styleUnderlineBtn.classList.toggle('active', style === 'underline');

      // If editing existing annotation, update its style
      if (lastAnnotationId) {
        const wrappers = document.querySelectorAll(`[data-annotation-id="${lastAnnotationId}"]`);
        if (wrappers.length > 0) {
          let currentColor = '#ffeb3b';
          const firstEl = wrappers[0];
          if (firstEl.style.backgroundColor) {
            currentColor = firstEl.style.backgroundColor;
          } else if (firstEl.style.borderBottom) {
            const match = firstEl.style.borderBottom.match(/solid\s+(.+)/);
            if (match) currentColor = match[1];
          }

          wrappers.forEach(el => {
            const newTagName = style === 'underline' ? 'span' : 'mark';
            const newClassName = style === 'underline' ? 'annotation-underline' : 'annotation-highlight';
            const newEl = document.createElement(newTagName);
            newEl.className = newClassName;
            newEl.dataset.annotationId = lastAnnotationId;
            if (el.dataset.note) newEl.dataset.note = el.dataset.note;
            if (style === 'underline') {
              newEl.style.borderBottom = '2px solid ' + currentColor;
            } else {
              newEl.style.backgroundColor = currentColor;
            }

            while (el.firstChild) {
              newEl.appendChild(el.firstChild);
            }
            el.parentNode.replaceChild(newEl, el);
          });

          try {
            const currentPath = state.tabs[state.activeTab]?.path || '';
            await invoke('update_annotation', {
              filePath: currentPath,
              id: lastAnnotationId,
              style: style
            });
          } catch (err) {
            showError('更新样式失败: ' + err);
          }
        }
      }
    }

    styleHighlightBtn.addEventListener('click', () => setStyle('highlight'));
    styleUnderlineBtn.addEventListener('click', () => setStyle('underline'));

    selectionToolbar.querySelectorAll('.color-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const color = btn.dataset.color;

        // If editing existing annotation, update its color
        if (lastAnnotationId) {
          const wrappers = document.querySelectorAll(`[data-annotation-id="${lastAnnotationId}"]`);
          if (wrappers.length > 0) {
            const currentStyle = wrappers[0].classList.contains('annotation-underline') ? 'underline' : 'highlight';
            wrappers.forEach(el => {
              if (currentStyle === 'underline') {
                el.style.borderBottom = '2px solid ' + color;
              } else {
                el.style.backgroundColor = color;
              }
            });
            try {
              const currentPath = state.tabs[state.activeTab]?.path || '';
              await invoke('update_annotation', {
                filePath: currentPath,
                id: lastAnnotationId,
                color: color
              });
            } catch (err) {
              showError('更新颜色失败: ' + err);
            }
          }
          return;
        }

        const selection = window.getSelection();
        if (!selection || selection.isCollapsed) return;
        const text = selection.toString().trim();
        if (!text) return;

        const range = selection.getRangeAt(0);
        const id = generateId();
        const el = highlightRange(range, color, id, currentAnnotationStyle);
        if (!el) return;
        lastAnnotationId = id;
        // Clear selection but keep toolbar visible for annotation
        selection.removeAllRanges();

        try {
          const currentPath = state.tabs[state.activeTab]?.path || '';
          await invoke('add_annotation', {
            filePath: currentPath,
            annotation: {
              id: id,
              text: text,
              color: color,
              style: currentAnnotationStyle,
              note: '',
              createdAt: new Date().toISOString()
            }
          });
        } catch (err) {
          showError('保存失败: ' + err);
        }
      });
    });

    selectionToolbar.querySelector('#annotateBtn').addEventListener('click', async () => {
      if (!lastAnnotationId) {
        showToast('请先选择颜色添加高亮或下划线');
        return;
      }

      const note = prompt('批注内容:', '');
      if (note === null) return;

      try {
        const currentPath = state.tabs[state.activeTab]?.path || '';
        await invoke('update_annotation_note', {
          filePath: currentPath,
          id: lastAnnotationId,
          note: note
        });
        // Update DOM tooltip
        const wrappers = document.querySelectorAll(`[data-annotation-id="${lastAnnotationId}"]`);
        wrappers.forEach(el => {
          el.dataset.note = note;
        });
        hideSelectionToolbar();
      } catch (err) {
        showError('保存批注失败: ' + err);
      }
    });

    selectionToolbar.querySelector('#deleteAnnotationBtn').addEventListener('click', async () => {
      if (!lastAnnotationId) return;
      if (!confirm('确定删除此标注？')) return;

      try {
        const currentPath = state.tabs[state.activeTab]?.path || '';
        await invoke('delete_annotation', {
          filePath: currentPath,
          id: lastAnnotationId
        });
        // Remove from DOM: unwrap all annotation elements
        const wrappers = document.querySelectorAll(`[data-annotation-id="${lastAnnotationId}"]`);
        wrappers.forEach(el => {
          if (el.parentNode) {
            const parent = el.parentNode;
            while (el.firstChild) {
              parent.insertBefore(el.firstChild, el);
            }
            parent.removeChild(el);
          }
        });
        hideSelectionToolbar();
      } catch (err) {
        showError('删除失败: ' + err);
      }
    });

    selectionToolbar.querySelector('#translateSelectionBtn').addEventListener('click', async () => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed) return;

      const range = selection.getRangeAt(0);
      const node = range.commonAncestorContainer;
      const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;

      let targetEl = el.closest('p, li, h1, h2, h3, h4, h5, h6, blockquote');
      if (!targetEl) return;
      if (targetEl.querySelector('pre, .katex, .mermaid')) return;
      if (targetEl.closest('.translation')) return;

      hideSelectionToolbar();

      const spinner = document.createElement('span');
      spinner.className = 'translation-spinner';
      targetEl.appendChild(spinner);

      try {
        const text = targetEl.textContent.trim();
        const currentPath = state.tabs[state.activeTab]?.path || '';
        const translations = await invoke('translate_text', {
          texts: [text],
          targetLang: 'zh-CN',
          filePath: currentPath
        });
        if (translations[0] && translations[0] !== text) {
          insertTranslation(targetEl, translations[0]);
        }
      } catch (err) {
        showError('翻译失败: ' + err);
      } finally {
        spinner.remove();
      }
    });

    selectionToolbar.querySelector('#aiExplainBtn').addEventListener('click', () => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed) return;
      const text = selection.toString().trim();
      if (!text || text.length < 2) return;
      hideSelectionToolbar();
      if (window.LearningModeIntegration && window.LearningModeIntegration.createCue) {
        window.LearningModeIntegration.createCue(text);
      }
    });
  }

  function findTextRange(container, searchText) {
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    let node;
    while ((node = walker.nextNode())) {
      textNodes.push(node);
    }

    let concat = '';
    const boundaries = [0];
    for (const n of textNodes) {
      concat += n.textContent;
      boundaries.push(concat.length);
    }

    const idx = concat.indexOf(searchText);
    if (idx === -1) return null;

    const endIdx = idx + searchText.length;
    let startNode = null, startOffset = 0;
    let endNode = null, endOffset = 0;

    for (let i = 0; i < textNodes.length; i++) {
      if (idx >= boundaries[i] && idx < boundaries[i + 1]) {
        startNode = textNodes[i];
        startOffset = idx - boundaries[i];
      }
      if (endIdx > boundaries[i] && endIdx <= boundaries[i + 1]) {
        endNode = textNodes[i];
        endOffset = endIdx - boundaries[i];
      }
      if (startNode && endNode) break;
    }

    if (!startNode || !endNode) return null;
    const range = document.createRange();
    range.setStart(startNode, startOffset);
    range.setEnd(endNode, endOffset);
    return range;
  }

  function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
  }

  function highlightRange(range, color, annotationId, style) {
    const tagName = style === 'underline' ? 'span' : 'mark';
    const className = style === 'underline' ? 'annotation-underline' : 'annotation-highlight';
    const el = document.createElement(tagName);
    el.className = className;
    el.dataset.annotationId = annotationId;
    if (style === 'underline') {
      el.style.borderBottom = '2px solid ' + color;
    } else {
      el.style.backgroundColor = color;
    }

    try {
      range.surroundContents(el);
      return el;
    } catch (e) {
      // Selection spans multiple block elements; wrap each text node individually
      const contents = range.extractContents();
      const walker = document.createTreeWalker(contents, NodeFilter.SHOW_TEXT);
      const nodesToWrap = [];
      let node;
      while ((node = walker.nextNode())) {
        nodesToWrap.push(node);
      }

      let firstWrapper = null;
      for (const textNode of nodesToWrap) {
        const wrapper = document.createElement(tagName);
        wrapper.className = className;
        wrapper.dataset.annotationId = annotationId;
        if (style === 'underline') {
          wrapper.style.borderBottom = '2px solid ' + color;
        } else {
          wrapper.style.backgroundColor = color;
        }
        wrapper.textContent = textNode.textContent;
        if (!firstWrapper) firstWrapper = wrapper;
        textNode.parentNode.replaceChild(wrapper, textNode);
      }

      range.insertNode(contents);
      return firstWrapper;
    }
  }

  async function applyAnnotations() {
    const currentPath = state.tabs[state.activeTab]?.path;
    if (!currentPath) return;

    try {
      const annotations = await invoke('get_annotations', { filePath: currentPath });
      if (!annotations || annotations.length === 0) return;

      const container = elements.markdownBody;
      if (!container) return;

      for (const ann of annotations) {
        const range = findTextRange(container, ann.text);
        if (!range) continue;

        const style = ann.style || 'highlight';
        highlightRange(range, ann.color || '#ffeb3b', ann.id, style);

        // Apply note to all wrappers created for this annotation
        const wrappers = container.querySelectorAll(`[data-annotation-id="${ann.id}"]`);
        wrappers.forEach(el => {
          if (ann.note) el.dataset.note = ann.note;
        });
      }
    } catch (err) {
      // silently fail
    }
  }

  function showSelectionToolbar(rect) {
    if (!selectionToolbar) createSelectionToolbar();
    const aiBtn = selectionToolbar.querySelector('#aiExplainBtn');
    if (aiBtn) {
      aiBtn.style.display = AppWorkspace.isIn('course') ? 'inline-flex' : 'none';
    }
    selectionToolbar.style.display = 'flex';
    selectionToolbar.style.left = (rect.left + rect.width / 2 - 60) + 'px';
    selectionToolbar.style.top = (rect.top - 40) + 'px';
  }

  function hideSelectionToolbar() {
    lastAnnotationId = null;
    if (selectionToolbar) {
      selectionToolbar.style.display = 'none';
    }
  }

  let annotationTooltip = null;

  function ensureAnnotationTooltip() {
    if (annotationTooltip) return;
    annotationTooltip = document.createElement('div');
    annotationTooltip.className = 'annotation-tooltip';
    annotationTooltip.style.cssText = 'position:fixed;z-index:10001;max-width:280px;padding:10px 14px;background:var(--color-bg-secondary);color:var(--color-text-primary);border:1px solid var(--color-border);border-radius:var(--radius-md);box-shadow:var(--shadow-lg);font-size:var(--font-size-sm);line-height:1.5;display:none;pointer-events:none;word-break:break-word;';
    document.body.appendChild(annotationTooltip);

    // Event delegation on markdownBody
    elements.markdownBody.addEventListener('mouseenter', (e) => {
      const el = e.target.closest('.annotation-highlight, .annotation-underline');
      if (!el) return;
      const note = el.dataset.note;
      if (!note) return;
      annotationTooltip.textContent = note;
      annotationTooltip.style.display = 'block';
      const rect = el.getBoundingClientRect();
      annotationTooltip.style.left = rect.left + 'px';
      annotationTooltip.style.top = (rect.bottom + 6) + 'px';
    }, true);

    elements.markdownBody.addEventListener('mouseleave', (e) => {
      const el = e.target.closest('.annotation-highlight, .annotation-underline');
      if (!el) return;
      annotationTooltip.style.display = 'none';
    }, true);

    // Click annotation to show full toolbar
    elements.markdownBody.addEventListener('click', (e) => {
      const el = e.target.closest('.annotation-highlight, .annotation-underline');
      if (!el) return;
      e.stopPropagation();
      lastAnnotationId = el.dataset.annotationId;
      const rect = el.getBoundingClientRect();
      showSelectionToolbar(rect);
    });
  }

  function initTranslation() {
    createSelectionToolbar();
    ensureAnnotationTooltip();

    document.addEventListener('mouseup', (e) => {
      // When clicking on an annotation, click handler shows toolbar; don't hide it here
      if (e.target.closest('.annotation-highlight, .annotation-underline')) {
        return;
      }
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed) {
        setTimeout(() => hideSelectionToolbar(), 150);
        return;
      }
      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        // Detect if selection is inside an existing annotation
        const node = range.commonAncestorContainer;
        const parentEl = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
        const annEl = parentEl?.closest('.annotation-highlight, .annotation-underline');
        if (annEl && annEl.dataset.annotationId) {
          lastAnnotationId = annEl.dataset.annotationId;
        }
        showSelectionToolbar(rect);
      }
    });

    document.addEventListener('mousedown', (e) => {
      if (selectionToolbar && !selectionToolbar.contains(e.target)) {
        // Don't hide when clicking on an annotation element (will show toolbar for editing)
        if (e.target.closest('.annotation-highlight, .annotation-underline')) {
          return;
        }
        setTimeout(() => {
          const selection = window.getSelection();
          if (!selection || selection.isCollapsed) {
            hideSelectionToolbar();
          }
        }, 200);
      }
    });
  }

  // Run when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // ============================================
  // Download Buttons for Non-Text Content
  // ============================================

  function initDownloadButtons(container = elements.markdownBody) {
    addImageDownloadButtons(container);
    addMermaidDownloadButtons(container);
    addTableDownloadButtons(container);
  }

  function addImageDownloadButtons(container = elements.markdownBody) {
    const images = container.querySelectorAll('img');
    images.forEach(img => {
      if (img.closest('a')) return; // Skip images inside links
      if (img.dataset.downloadBtn === 'true') return;
      img.dataset.downloadBtn = 'true';

      const wrapper = document.createElement('span');
      wrapper.className = 'downloadable-wrapper';
      wrapper.style.position = 'relative';
      wrapper.style.display = 'inline-block';

      img.parentNode.insertBefore(wrapper, img);
      wrapper.appendChild(img);

      const btn = createDownloadButton('⬇️', '下载图片');
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        downloadImage(img);
      });
      wrapper.appendChild(btn);
    });
  }

  function addMermaidDownloadButtons(container = elements.markdownBody) {
    const mermaidBlocks = container.querySelectorAll('pre.mermaid');
    mermaidBlocks.forEach(pre => {
      if (pre.dataset.downloadBtn === 'true') return;
      pre.dataset.downloadBtn = 'true';

      // Only add button if Mermaid has been rendered (SVG exists inside)
      const svg = pre.querySelector('svg');
      if (!svg) return; // Skip unrendered blocks

      // Click to open lightbox
      pre.style.cursor = 'zoom-in';
      pre.addEventListener('click', (e) => {
        if (e.target.closest('.download-btn')) return;
        openMermaidLightbox(svg);
      });

      const btn = createDownloadButton('⬇️ SVG', '下载 Mermaid 图表');
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        downloadMermaid(pre);
      });
      // Append as last child of pre (after SVG), absolutely positioned via CSS
      pre.appendChild(btn);
    });
  }

  function addTableDownloadButtons(container = elements.markdownBody) {
    const tables = container.querySelectorAll('table');
    tables.forEach(table => {
      if (table.dataset.downloadBtn === 'true') return;
      table.dataset.downloadBtn = 'true';

      const wrapper = document.createElement('div');
      wrapper.className = 'downloadable-wrapper';
      wrapper.style.position = 'relative';

      table.parentNode.insertBefore(wrapper, table);
      wrapper.appendChild(table);

      const btn = createDownloadButton('⬇️ CSV', '下载表格');
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        downloadTable(table);
      });
      wrapper.appendChild(btn);
    });
  }

  function createDownloadButton(text, title) {
    const btn = document.createElement('button');
    btn.className = 'download-btn';
    btn.textContent = text;
    btn.title = title;
    btn.type = 'button';
    return btn;
  }

  async function downloadImage(img) {
    const src = img.src;
    if (!src) return;
    const filename = src.split('/').pop().split('?')[0] || 'image.png';
    try {
      const response = await fetch(src);
      const blob = await response.blob();
      triggerDownload(blob, filename);
    } catch (err) {
      console.error('Failed to download image:', err);
      alert('下载失败：' + err.message);
    }
  }

  function downloadMermaid(pre) {
    const svg = pre.querySelector('svg');
    if (!svg) {
      alert('图表尚未渲染完成');
      return;
    }
    const serializer = new XMLSerializer();
    const svgString = serializer.serializeToString(svg);
    const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    triggerDownload(blob, 'diagram.svg');
  }

  function downloadTable(table) {
    const rows = table.querySelectorAll('tr');
    let csv = '﻿'; // BOM for Excel
    rows.forEach(row => {
      const cells = row.querySelectorAll('td, th');
      const values = Array.from(cells).map(cell => {
        const text = cell.textContent.replace(/"/g, '""').trim();
        return `"${text}"`;
      });
      csv += values.join(',') + '\n';
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    triggerDownload(blob, 'table.csv');
  }

  async function triggerDownload(blob, filename) {
    try {
      // Use Tauri save dialog to let user choose location
      const savePath = await window.__TAURI__.dialog.save({
        defaultPath: filename,
        filters: [{ name: 'All Files', extensions: ['*'] }]
      });
      if (!savePath) return; // User cancelled

      // Convert blob to base64
      const reader = new FileReader();
      reader.onload = async () => {
        const base64 = reader.result.split(',')[1];
        // Write file through Rust backend
        await invoke('write_file', { path: savePath, content: base64, encoding: 'base64' });
        showToast('已保存: ' + filename);
      };
      reader.readAsDataURL(blob);
    } catch (err) {
      console.error('Download failed:', err);
      showError('下载失败: ' + err);
    }
  }

  function getLanguageExtension(language) {
    const map = {
      javascript: 'js',
      typescript: 'ts',
      python: 'py',
      rust: 'rs',
      java: 'java',
      cpp: 'cpp',
      c: 'c',
      go: 'go',
      ruby: 'rb',
      php: 'php',
      swift: 'swift',
      kotlin: 'kt',
      scala: 'scala',
      r: 'r',
      matlab: 'm',
      shell: 'sh',
      bash: 'sh',
      powershell: 'ps1',
      sql: 'sql',
      html: 'html',
      css: 'css',
      scss: 'scss',
      sass: 'sass',
      less: 'less',
      json: 'json',
      yaml: 'yml',
      xml: 'xml',
      markdown: 'md',
      dockerfile: 'dockerfile',
      makefile: 'makefile',
      vim: 'vim',
      lua: 'lua',
      perl: 'pl',
      haskell: 'hs',
      clojure: 'clj',
      erlang: 'erl',
      elixir: 'ex',
      julia: 'jl',
      dart: 'dart',
      groovy: 'groovy',
      objectivec: 'm',
      protobuf: 'proto',
      graphql: 'graphql',
      regex: 'regex',
      diff: 'diff',
      http: 'http'
    };
    return map[language.toLowerCase()] || language.toLowerCase();
  }

  // Export for testing/debugging
  window.TyporaNext = {
    state,
    AppWorkspace,
    openFile,
    openFolder,
    openPaperReader,
    openPaperFile,
    openPaperPdf,
    openPaperUrl,
    resolveRecentFileRoute,
    loadFolderPath,
    unloadFolder,
    setLearningMode,
    _updateSocraticButtonState,
    checkAgentSdk,
    addTab,
    switchTab,
    closeTab,
    renderMarkdown,
    toggleSourceMode,
    toggleSidebar,
    switchSidebarTab,
    buildTOC,
    filterFileTree,
    invoke,
    _showConfirm,
    enhanceReaderContent,
    initToolbarTooltips,

    /**
     * Refresh the file tree sidebar from the currently opened folder.
     * Used by progress-tracker after chapters are generated so new files appear immediately.
     */
    async refreshFileTree() {
      if (state.currentFolder) {
        try {
          const entries = await invoke('list_directory', { path: state.currentFolder });
          renderFileTree(entries);
        } catch (err) {
          console.warn('[TyporaNext] refreshFileTree failed:', err);
        }
      }
    }
  };

  // ============================================
  // Toolbar tooltips: custom fast-reveal tooltips
  // ============================================
  function initToolbarTooltips(options = {}) {
    const delay = options.delay ?? 150;

    // Avoid duplicate tooltip containers
    let tooltip = document.querySelector('.toolbar-tooltip');
    if (!tooltip) {
      tooltip = document.createElement('div');
      tooltip.className = 'toolbar-tooltip';
      tooltip.setAttribute('role', 'tooltip');
      document.body.appendChild(tooltip);
    }

    let showTimeout = null;
    let activeButton = null;

    function positionTooltip(button) {
      const rect = button.getBoundingClientRect();
      const tooltipRect = tooltip.getBoundingClientRect();
      const top = rect.bottom + 6;
      let left = rect.left + rect.width / 2 - tooltipRect.width / 2;
      if (left < 8) left = 8;
      if (left + tooltipRect.width > window.innerWidth - 8) {
        left = window.innerWidth - tooltipRect.width - 8;
      }
      tooltip.style.top = `${top}px`;
      tooltip.style.left = `${left}px`;
    }

    function showTooltip(button) {
      const text = button.getAttribute('data-tooltip');
      if (!text) return;
      tooltip.textContent = text;
      tooltip.classList.add('visible');
      positionTooltip(button);
      activeButton = button;
    }

    function hideTooltip() {
      tooltip.classList.remove('visible');
      activeButton = null;
    }

    function scheduleShow(button) {
      clearTimeout(showTimeout);
      activeButton = button;
      showTimeout = setTimeout(() => showTooltip(button), delay);
    }

    function cancelShow() {
      clearTimeout(showTimeout);
      showTimeout = null;
      hideTooltip();
    }

    document.querySelectorAll('.btn-icon[data-tooltip], .agent-status-chip[data-tooltip], .sidebar-toggle[data-tooltip], .file-tree-btn[data-tooltip]').forEach(button => {
      button.removeAttribute('title');
      button.addEventListener('mouseenter', () => scheduleShow(button));
      button.addEventListener('mouseleave', cancelShow);
      button.addEventListener('focus', () => scheduleShow(button));
      button.addEventListener('blur', cancelShow);
    });

    window.addEventListener('resize', () => {
      if (activeButton) positionTooltip(activeButton);
    });

    return { tooltip, hideTooltip, cancelShow };
  }

  initToolbarTooltips();

  // ============================================
  // Export dropdown (导出 Word / 导出 PDF / 分享打包)
  // Item buttons keep their original ids, so their click
  // handlers (registered above) work unchanged.
  // ============================================
  if (window.ToolbarDropdown) {
    const exportMenuBtn = document.getElementById('exportMenuBtn');
    const exportMenu = document.getElementById('exportMenu');
    if (exportMenuBtn && exportMenu) {
      ToolbarDropdown.create({ trigger: exportMenuBtn, menu: exportMenu, doc: document });
    }
  }

  // ============================================
  // First-time onboarding guide
  // ============================================
  let onboardingManager = null;
  function initOnboarding() {
    if (!window.OnboardingManager) return;

    async function openDemoFile() {
      if (!window.__TAURI__) return;
      try {
        // First try: bundled resource (release builds)
        const result = await invoke('get_demo_file');
        if (result && result.content) {
          addTab(result.path, result.content, result.base_dir || '');
          return;
        }
      } catch (err) {
        // Fallback: development path
        try {
          const devPath = 'C:/CODE/typora-next/samples/full.md';
          const result = await invoke('open_file', { path: devPath });
          if (result && result.content) {
            addTab(result.path, result.content, result.base_dir || '');
          }
        } catch (err2) {
          console.warn('[Onboarding] Demo file not found (bundled or dev):', err, err2);
        }
      }
    }

    onboardingManager = window.OnboardingManager.create({
      onOpenDemo: openDemoFile
    });
    const { didShow } = onboardingManager.start();
  }

  initOnboarding();

})();