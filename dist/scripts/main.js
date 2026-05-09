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
    tabs: [],           // {path, content, baseDir, name}
    activeTab: -1,      // index of active tab
    sourceMode: false,
    sidebarCollapsed: false,
    sidebarActiveTab: 'files',   // 'files' | 'toc'
    currentFolder: null,
    headings: [],
    refreshPromptVisible: false
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
    settingsModalClose: document.getElementById('settingsModalClose'),
    settingsCancel: document.getElementById('settingsCancel'),
    settingsSave: document.getElementById('settingsSave'),
    settingsTest: document.getElementById('settingsTest'),
    testResult: document.getElementById('testResult')
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
      const result = await invoke('open_file', { path: tab.path });
      if (result && result.content) {
        tab.content = result.content;
        tab.baseDir = result.base_dir || '';
        loadTabContent(state.activeTab);
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
  function addTab(path, content, baseDir) {
    const existingIndex = state.tabs.findIndex(t => t.path === path);
    if (existingIndex >= 0) {
      // Tab already open, switch to it
      switchTab(existingIndex);
      return;
    }

    const tab = {
      path,
      content,
      baseDir,
      name: getFileName(path)
    };

    state.tabs.push(tab);
    state.activeTab = state.tabs.length - 1;
    renderTabs();
    loadTabContent(state.activeTab);
    watchCurrentFile(path);
  }

  function switchTab(index) {
    if (index < 0 || index >= state.tabs.length) return;
    state.activeTab = index;
    renderTabs();
    loadTabContent(index);
    const tab = state.tabs[index];
    if (tab) {
      watchCurrentFile(tab.path);
    }
  }

  function closeTab(index) {
    if (index < 0 || index >= state.tabs.length) return;

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
      loadTabContent(state.activeTab);
      const activeTab = state.tabs[state.activeTab];
      if (activeTab) {
        watchCurrentFile(activeTab.path);
      }
    }

    // Remove refresh prompt if visible
    const prompt = document.getElementById('refresh-prompt');
    if (prompt) {
      prompt.remove();
      state.refreshPromptVisible = false;
    }
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

      tabEl.addEventListener('click', () => switchTab(index));

      elements.tabsList.appendChild(tabEl);
    });
  }

  function loadTabContent(index) {
    if (index < 0 || index >= state.tabs.length) return;
    const tab = state.tabs[index];
    renderMarkdown(tab.content, tab.baseDir);

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

      // Initialize mermaid diagrams
      initMermaid();

      // Initialize image handling
      initImageHandling();

      // Initialize GFM Alerts styling
      initGFMAlerts();

      // Extract and build TOC
      buildTOC();

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
  }

  function switchSidebarTab(tab) {
    state.sidebarActiveTab = tab;
    elements.tabFiles.classList.toggle('active', tab === 'files');
    elements.tabToc.classList.toggle('active', tab === 'toc');
    elements.filesPanel.classList.toggle('active', tab === 'files');
    elements.tocPanel.classList.toggle('active', tab === 'toc');
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
          addCopyButton(pre, code);
          Prism.highlightElement(code);
        }
      });
    }
  }

  function getLanguageFromClass(className) {
    const match = className.match(/language-(\w+)/);
    return match ? match[1].toLowerCase() : null;
  }

  function addCopyButton(pre, code) {
    const actions = document.createElement('div');
    actions.className = 'code-block-actions';

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

  function initImageHandling() {
    const images = elements.markdownBody.querySelectorAll('img');
    images.forEach(img => {
      // Error handling
      img.addEventListener('error', function() {
        this.setAttribute('data-error', 'true');
        this.classList.add('image-error');
      });

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
          const safeUrl = convertFileSrc(absolutePath);
          img.setAttribute('src', safeUrl);
          console.log('[DEBUG] Resolved image:', src, '->', safeUrl);
        } else {
          console.error('[ERROR] Tauri convertFileSrc not available');
        }
      }
    });
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
  // Lightbox
  // ============================================
  function openLightbox(img) {
    const lightbox = document.createElement('div');
    lightbox.className = 'image-lightbox';

    const lightboxImg = document.createElement('img');
    lightboxImg.src = img.src;
    lightboxImg.alt = img.alt || '';

    const zoomInfo = document.createElement('div');
    zoomInfo.className = 'lightbox-zoom-info';
    zoomInfo.textContent = 'Zoom: 100%';

    const controls = document.createElement('div');
    controls.className = 'lightbox-controls';

    // Create control buttons
    const buttons = [
      { text: '+ Zoom In', action: () => zoomImage(lightboxImg, zoomInfo, 0.25) },
      { text: '- Zoom Out', action: () => zoomImage(lightboxImg, zoomInfo, -0.25) },
      { text: 'Reset', action: () => resetZoom(lightboxImg, zoomInfo) },
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

    lightbox.appendChild(lightboxImg);
    lightbox.appendChild(zoomInfo);
    lightbox.appendChild(controls);

    // Close on background click
    lightbox.addEventListener('click', function(e) {
      if (e.target === lightbox) closeLightbox(lightbox);
    });

    document.body.appendChild(lightbox);
    document.body.style.overflow = 'hidden';
  }

  let currentZoom = 1;

  function zoomImage(img, info, delta) {
    currentZoom = Math.max(0.5, Math.min(3, currentZoom + delta));
    img.style.transform = `scale(${currentZoom})`;
    info.textContent = `Zoom: ${Math.round(currentZoom * 100)}%`;
  }

  function resetZoom(img, info) {
    currentZoom = 1;
    img.style.transform = `scale(1)`;
    info.textContent = 'Zoom: 100%';
  }

  function closeLightbox(lightbox) {
    lightbox.style.opacity = '0';
    setTimeout(() => {
      lightbox.remove();
      document.body.style.overflow = '';
    }, 200);
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
    showToast('请在打印对话框中选择「打印为 PDF」并设置保存位置', 5000);
    setTimeout(() => window.print(), 300);
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

      // Escape: Close lightbox or exit source mode
      if (e.key === 'Escape') {
        const lightbox = document.querySelector('.image-lightbox');
        if (lightbox) {
          closeLightbox(lightbox);
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

  function toggleTheme() {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    applyTheme(isDark ? 'light' : 'dark');
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
      }
    } catch (err) {
      console.error('Failed to load config:', err);
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

    const config = {
      api_key: apiKey || null,
      ai_provider: aiProvider,
      ai_base_url: aiBaseUrl || null,
      model: model || null,
      theme: theme || null
    };

    try {
      await invoke('set_config', { config });
      if (theme) {
        applyTheme(theme);
      }
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
    setupKeyboardShortcuts();
    setupDragDrop();
    setupScrollObserver();
    setupThemeDetection();
    setupFileWatcher();
    loadConfig();

    console.log('Typora Next initialized');
  }

  // Run when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
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