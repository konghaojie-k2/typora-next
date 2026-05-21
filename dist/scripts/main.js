/**
 * Typora Next - Main JavaScript
 * WebView frontend for Tauri backend
 */

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

  // ============================================
  // State Management
  // ============================================
  const state = {
    tabs: [],           // {path, content, baseDir, name, scrollTop}
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
    searchCurrentIndex: -1
  };

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
    markdownBody: document.getElementById('markdownBody'),
    sourceView: document.getElementById('sourceView'),
    sourceCode: document.getElementById('sourceCode'),
    tabsBar: document.getElementById('tabsBar'),
    tabsList: document.getElementById('tabsList'),
    openFileBtn: document.getElementById('openFileBtn'),
    sourceToggle: document.getElementById('sourceToggle'),
    exportPdfBtn: document.getElementById('exportPdfBtn'),
    exportWordBtn: document.getElementById('exportWordBtn'),
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
    settingTheme: document.getElementById('settingTheme'),
    settingCustomCursor: document.getElementById('settingCustomCursor'),
    settingsModalClose: document.getElementById('settingsModalClose'),
    settingsCancel: document.getElementById('settingsCancel'),
    settingsSave: document.getElementById('settingsSave'),
    settingsTest: document.getElementById('settingsTest'),
    testResult: document.getElementById('testResult'),
    recentFilesSection: document.getElementById('recentFilesSection'),
    recentFilesList: document.getElementById('recentFilesList'),
    clearRecentFiles: document.getElementById('clearRecentFiles'),
    searchBar: document.getElementById('searchBar'),
    searchInput: document.getElementById('searchInput'),
    searchCount: document.getElementById('searchCount'),
    searchPrev: document.getElementById('searchPrev'),
    searchNext: document.getElementById('searchNext'),
    searchClose: document.getElementById('searchClose')
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
          }
        }).catch(err => {
          console.error('Failed to open file from args:', err);
        });
      }
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
  async function addTab(path, content, baseDir) {
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
      scrollTop: 0
    };

    state.tabs.push(tab);
    state.activeTab = state.tabs.length - 1;
    renderTabs();
    await loadTabContent(state.activeTab);
    watchCurrentFile(path);
    showToast('已打开: ' + tab.name);

    // Add to recent files
    invoke('add_recent_file', { path }).then(() => {
      loadRecentFiles();
    }).catch(err => {
      console.error('Failed to add recent file:', err);
    });

    saveUIState();
  }

  async function switchTab(index) {
    if (index < 0 || index >= state.tabs.length) return;

    // Close search when switching tabs
    closeSearch();

    // Save scroll position of current tab before switching
    const currentTab = state.tabs[state.activeTab];
    if (currentTab && elements.markdownBody) {
      currentTab.scrollTop = elements.markdownBody.scrollTop;
    }

    state.activeTab = index;
    renderTabs();
    await loadTabContent(index);

    // Restore scroll position of the new tab after render completes
    const tab = state.tabs[index];
    if (tab && elements.markdownBody) {
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
    if (closingTab && elements.markdownBody) {
      closingTab.scrollTop = elements.markdownBody.scrollTop;
    }

    state.tabs.splice(index, 1);

    if (state.tabs.length === 0) {
      state.activeTab = -1;
      renderTabs();
      showWelcome();
      unwatchCurrentFile();
    } else {
      // Adjust active tab
      if (index <= state.activeTab) {
        state.activeTab = Math.max(0, state.activeTab - 1);
      }
      renderTabs();
      await loadTabContent(state.activeTab);
      const activeTab = state.tabs[state.activeTab];
      if (activeTab) {
        if (elements.markdownBody) {
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
    const items = [
      { label: '在文件夹中显示', action: () => {
        if (tab && tab.path) {
          invoke('show_in_folder', { path: tab.path }).catch(err => {
            console.error('打开文件夹失败:', err);
          });
        }
      }},
      { label: '关闭', action: () => closeTab(index) },
      { label: '关闭其他', action: () => closeOtherTabs(index) },
      { label: '关闭全部', action: () => closeAllTabs() }
    ];

    items.forEach((item, i) => {
      if (i > 0) {
        const sep = document.createElement('div');
        sep.className = 'tab-context-menu-separator';
        menu.appendChild(sep);
      }
      const el = document.createElement('div');
      el.className = 'tab-context-menu-item';
      el.textContent = item.label;
      el.addEventListener('click', () => {
        item.action();
        menu.remove();
        activeContextMenu = null;
      });
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

  function renderTabs() {
    elements.tabsList.innerHTML = '';

    state.tabs.forEach((tab, index) => {
      const tabEl = document.createElement('div');
      tabEl.className = 'tab-item' + (index === state.activeTab ? ' active' : '');

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
      console.log('[DEBUG renderMarkdown] about to call applyAnnotations');
      await applyAnnotations();
      console.log('[DEBUG renderMarkdown] applyAnnotations done');

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

  function renderRecentFiles() {
    if (!elements.recentFilesList || !elements.recentFilesSection) return;

    if (state.recentFiles.length === 0) {
      elements.recentFilesSection.style.display = 'none';
      return;
    }

    elements.recentFilesSection.style.display = '';
    elements.recentFilesList.innerHTML = '';

    state.recentFiles.forEach(path => {
      const item = document.createElement('div');
      item.className = 'recent-file-item';
      item.textContent = getFileName(path);
      item.title = path;
      item.addEventListener('click', () => openRecentFile(path));
      elements.recentFilesList.appendChild(item);
    });
  }

  async function openRecentFile(path) {
    try {
      const result = await invoke('open_file', { path });
      if (result && result.content) {
        addTab(result.path, result.content, result.base_dir || '');
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
  function initCodeHighlighting() {
    if (typeof Prism !== 'undefined') {
      // Process all code blocks
      const codeBlocks = elements.markdownBody.querySelectorAll('pre code[class*="language-"]');
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

  function initMathRendering() {
    if (typeof renderMathInElement !== 'undefined') {
      renderMathInElement(elements.markdownBody, {
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

  async function initMermaid() {
    if (typeof mermaid === 'undefined') return;

    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    mermaid.initialize({
      startOnLoad: false,
      theme: isDark ? CONFIG.mermaidTheme.dark : CONFIG.mermaidTheme.light,
      securityLevel: 'loose'
    });

    // Find and validate mermaid blocks
    const mermaidBlocks = elements.markdownBody.querySelectorAll('.mermaid, pre code.language-mermaid');
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
          const newPre = document.createElement('pre');
          newPre.className = 'mermaid';
          newPre.textContent = fixed;
          wrapper.parentNode.replaceChild(newPre, wrapper);
          mermaid.run({ nodes: [newPre] });
          showToast('Mermaid 已修复');
        }
      } catch (err) {
        btn.textContent = '🤖 AI 修复';
        btn.disabled = false;
        showError('AI 修复失败: ' + err);
      }
    });
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

  function initImageHandling() {
    const images = elements.markdownBody.querySelectorAll('img');
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
  function resolveImagePaths(baseDir) {
    const images = elements.markdownBody.querySelectorAll('img');
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
  function initTaskListInteraction() {
    const checkboxes = elements.markdownBody.querySelectorAll('input[type="checkbox"]');
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
   * Parse markdown into slide sections.
   * --- = horizontal slide separator
   * --  = vertical slide separator (within a horizontal section)
   * Skips YAML frontmatter and code blocks.
   */
  function parseMarkdownSections(content) {
    const lines = content.split('\n');
    const sections = [];
    let currentSlideLines = [];
    let currentVerticalSlides = [];
    let inCodeBlock = false;
    let inYaml = false;
    let yamlStarted = false;

    function flushVerticalSlide() {
      if (currentSlideLines.length > 0) {
        currentVerticalSlides.push(currentSlideLines.join('\n'));
        currentSlideLines = [];
      }
    }

    function flushHorizontalSection() {
      flushVerticalSlide();
      if (currentVerticalSlides.length === 1) {
        sections.push({ type: 'horizontal', content: currentVerticalSlides[0] });
      } else if (currentVerticalSlides.length > 1) {
        sections.push({ type: 'vertical', children: currentVerticalSlides.map(function(c) { return { content: c }; }) });
      }
      currentVerticalSlides = [];
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      if (trimmed.startsWith('```')) {
        inCodeBlock = !inCodeBlock;
        currentSlideLines.push(line);
        continue;
      }

      if (inCodeBlock) {
        currentSlideLines.push(line);
        continue;
      }

      // YAML frontmatter: only at the very beginning of the file (no content yet)
      if (!yamlStarted && trimmed === '---' && currentSlideLines.length === 0 && currentVerticalSlides.length === 0) {
        inYaml = true;
        yamlStarted = true;
        continue;
      }
      if (inYaml && trimmed === '---') {
        inYaml = false;
        continue;
      }
      if (inYaml) {
        continue;
      }

      if (trimmed === '---') {
        flushHorizontalSection();
        continue;
      }

      if (trimmed === '--') {
        flushVerticalSlide();
        continue;
      }

      currentSlideLines.push(line);
    }

    flushHorizontalSection();
    return sections;
  }

  async function openSlides() {
    const tab = state.tabs[state.activeTab];
    if (!tab || !tab.content) {
      showToast('请先打开一个 Markdown 文件');
      return;
    }

    if (document.getElementById('slides-overlay')) return;

    // Parse markdown into sections (--- horizontal, -- vertical)
    const sections = parseMarkdownSections(tab.content);
    if (sections.length === 0) {
      showToast('未能解析出幻灯片内容');
      return;
    }

    // Render each section individually via Rust backend
    const renderedSections = [];
    try {
      for (let i = 0; i < sections.length; i++) {
        const section = sections[i];
        if (section.type === 'horizontal') {
          const html = await invoke('render_markdown', { content: section.content });
          renderedSections.push({ type: 'horizontal', html: html });
        } else if (section.type === 'vertical') {
          const children = [];
          for (let j = 0; j < section.children.length; j++) {
            const html = await invoke('render_markdown', { content: section.children[j].content });
            children.push(html);
          }
          renderedSections.push({ type: 'vertical', children: children });
        }
      }
    } catch (err) {
      console.error('Failed to render markdown for slides:', err);
      showToast('幻灯片渲染失败');
      return;
    }

    const overlay = document.createElement('div');
    overlay.id = 'slides-overlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:99999;background:#000;';

    const iframe = document.createElement('iframe');
    iframe.src = 'slides.html';
    iframe.style.cssText = 'width:100%;height:100%;border:none;';

    iframe.addEventListener('load', () => {
      try {
        const cw = iframe.contentWindow;
        if (cw) {
          cw.__slides_sections = renderedSections;
          cw.__slides_baseDir = tab.baseDir || '';
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
  function initGFMAlerts() {
    const blockquotes = elements.markdownBody.querySelectorAll('blockquote');

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
   * Collect text nodes from markdownBody, skipping code blocks and other protected elements.
   */
  function collectTextNodes(excludeSelector = 'code, pre, .mermaid, a, mark, .obsidian-tag') {
    const nodes = [];
    const walker = document.createTreeWalker(elements.markdownBody, NodeFilter.SHOW_TEXT);
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
  function replaceInTextNodes(regex, replacer) {
    const nodes = collectTextNodes();
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
  function initObsidianHighlight() {
    replaceInTextNodes(
      /==([^=\s][^=]*|[^=\s])==/g,
      (m, content) => `<mark class="obsidian-highlight">${escapeHtml(content)}</mark>`
    );
  }

  /**
   * Obsidian Tags: #tag-name or #tag/subtag
   */
  function initObsidianTags() {
    // Match #tag where:
    // - preceded by start of string, whitespace, or non-word char
    // - followed by a letter (not a number, to avoid hex colors)
    // - can contain letters, digits, underscores, hyphens, forward slashes
    replaceInTextNodes(
      /(^|\s|[^\w])#([a-zA-Z][\w\-/]*)/g,
      (m, prefix, tag) => `${prefix}<span class="obsidian-tag" data-tag="${escapeHtml(tag)}">#${escapeHtml(tag)}</span>`
    );
  }

  /**
   * Obsidian Callouts: extend GFM alerts with more types and collapsible support.
   */
  function initObsidianCallouts() {
    const blockquotes = elements.markdownBody.querySelectorAll('blockquote');

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
      const titleText = firstP.textContent.trim() || calloutMeta.title;

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
  function initWikiLinks() {
    // 使用负向后瞻 (?<!!) 确保不匹配 ![[...]] 图片嵌入模式
    replaceInTextNodes(
      /(?<!!)\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,
      (m, target, display) => {
        const linkText = display ? escapeHtml(display.trim()) : escapeHtml(target.trim());
        const linkTarget = target.trim();
        return `<a class="wiki-link" data-target="${escapeHtml(linkTarget)}">${linkText}</a>`;
      }
    );

    // Add click handlers
    elements.markdownBody.querySelectorAll('.wiki-link').forEach(link => {
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
    const textNodes = collectTextNodes('code, pre, .mermaid, a');
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
      toast.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:var(--color-bg-secondary);color:var(--color-text-primary);padding:10px 20px;border-radius:var(--radius-md);border:1px solid var(--color-border);box-shadow:var(--shadow-lg);font-size:var(--font-size-sm);z-index:9999;opacity:0;transition:opacity 300ms;pointer-events:none;white-space:nowrap;';
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.style.opacity = '1';
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => { toast.style.opacity = '0'; }, duration);
  }

  // ============================================
  // PDF Export
  // ============================================
  function exportToPDF() {
    setTimeout(() => window.print(), 100);
  }

  // ============================================
  // Word Export
  // ============================================
  async function exportWord() {
    const tab = state.tabs[state.activeTab];
    if (!tab || !tab.content) {
      showToast('请先打开一个 Markdown 文件');
      return;
    }

    try {
      showToast('正在生成 Word 文档...');
      const result = await invoke('export_word', {
        markdown: tab.content,
        fileName: tab.name
      });
      showToast('Word 导出成功: ' + result);
    } catch (err) {
      console.error('Word export failed:', err);
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
    if (saved === 'dark' || saved === 'light') {
      applyTheme(saved);
    } else {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      applyTheme(prefersDark ? 'dark' : 'light');
    }
  }

  function applyTheme(theme) {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.setAttribute('data-theme', 'dark');
    } else {
      root.removeAttribute('data-theme');
    }
    updateThemeIcon(theme);
    reinitMermaid(theme);
    localStorage.setItem('typora-theme', theme);
  }

  function applyThemeFromConfig(theme) {
    applyTheme(theme || 'light');
  }

  function applyCustomCursor(cursorType) {
    document.body.classList.remove('cursor-pencil', 'cursor-highlighter', 'cursor-pen', 'cursor-cat');
    if (cursorType) {
      document.body.classList.add('cursor-' + cursorType);
    }
  }

  function toggleTheme() {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const newTheme = isDark ? 'light' : 'dark';
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
    if (elements.slidesBtn) {
      elements.slidesBtn.addEventListener('click', openSlides);
    }
    if (elements.translateBtn) {
      elements.translateBtn.addEventListener('click', toggleTranslation);
    }
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
    if (elements.settingsModal) {
      elements.settingsModal.addEventListener('click', (e) => {
        if (e.target === elements.settingsModal) closeSettings();
      });
    }

    if (elements.fileTreeSearch) {
      elements.fileTreeSearch.addEventListener('input', (e) => {
        filterFileTree(e.target.value);
      });
    }

    if (elements.clearRecentFiles) {
      elements.clearRecentFiles.addEventListener('click', clearRecentFiles);
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
  }

  function closeSettings() {
    if (elements.settingsModal) {
      elements.settingsModal.style.display = 'none';
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
    const theme = elements.settingTheme ? elements.settingTheme.value : '';
    const customCursor = elements.settingCustomCursor ? elements.settingCustomCursor.value : '';

    const config = {
      api_key: apiKey || null,
      ai_provider: aiProvider,
      ai_base_url: aiBaseUrl || null,
      model: model || null,
      theme: theme || null,
      custom_cursor: customCursor || null
    };

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
  // Initialization
  // ============================================
  function init() {
    initTheme();
    bindEvents();
    initTranslation();
    setupKeyboardShortcuts();
    setupDragDrop();
    setupScrollObserver();
    setupThemeDetection();
    setupFileWatcher();
    loadConfig();
    loadRecentFiles();
    loadUIState();
    checkPlatform();

    console.log('Typora Next initialized');
  }

  function checkPlatform() {
    if (typeof __TAURI__ !== 'undefined') {
      __TAURI__.core.invoke('get_platform')
        .then(platform => {
          if (platform === 'macos' && elements.exportWordBtn) {
            elements.exportWordBtn.style.display = 'none';
          }
        })
        .catch(err => console.warn('Failed to get platform:', err));
    }
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

  function initDownloadButtons() {
    addImageDownloadButtons();
    addMermaidDownloadButtons();
    addTableDownloadButtons();
  }

  function addImageDownloadButtons() {
    const images = elements.markdownBody.querySelectorAll('img');
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

  function addMermaidDownloadButtons() {
    const mermaidBlocks = elements.markdownBody.querySelectorAll('pre.mermaid');
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

  function addTableDownloadButtons() {
    const tables = elements.markdownBody.querySelectorAll('table');
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
    openFile,
    openFolder,
    addTab,
    switchTab,
    closeTab,
    renderMarkdown,
    toggleSourceMode,
    toggleSidebar,
    switchSidebarTab,
    buildTOC,
    filterFileTree,
    invoke
  };

})();