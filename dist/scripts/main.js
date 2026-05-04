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
    currentFile: null,
    currentContent: '',
    baseDir: '',
    sourceMode: false,
    tocCollapsed: false,
    fileTreeCollapsed: false,
    currentFolder: null,
    headings: []
  };

  // ============================================
  // DOM Elements
  // ============================================
  const elements = {
    tocSidebar: document.getElementById('tocSidebar'),
    tocTree: document.getElementById('tocTree'),
    tocToggle: document.getElementById('tocToggle'),
    fileTreeSidebar: document.getElementById('fileTreeSidebar'),
    fileTree: document.getElementById('fileTree'),
    fileTreeToggle: document.getElementById('fileTreeToggle'),
    openFolderBtn: document.getElementById('openFolderBtn'),
    openFolderToolbarBtn: document.getElementById('openFolderToolbarBtn'),
    contentArea: document.getElementById('contentArea'),
    markdownBody: document.getElementById('markdownBody'),
    sourceView: document.getElementById('sourceView'),
    sourceCode: document.getElementById('sourceCode'),
    filename: document.getElementById('filename'),
    openFileBtn: document.getElementById('openFileBtn'),
    sourceToggle: document.getElementById('sourceToggle')
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
        state.currentFile = result.path;
        state.currentContent = result.content;
        state.baseDir = result.base_dir || '';

        // Update filename display
        elements.filename.textContent = getFileName(result.path);
        elements.filename.title = result.path;

        // Render markdown
        await renderMarkdown(result.content, result.base_dir);

        // Hide welcome message
        const welcome = elements.markdownBody.querySelector('.welcome-message');
        if (welcome) welcome.remove();
      }
    } catch (err) {
      // User cancelled dialog or error occurred
      if (err !== 'No file selected') {
        console.error('Failed to open file:', err);
        showError('无法打开文件: ' + err);
      }
    }
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

  function toggleTOC() {
    state.tocCollapsed = !state.tocCollapsed;
    elements.tocSidebar.classList.toggle('collapsed', state.tocCollapsed);
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
        state.currentFile = result.path;
        state.currentContent = result.content;
        state.baseDir = result.base_dir || '';

        elements.filename.textContent = getFileName(result.path);
        elements.filename.title = result.path;

        await renderMarkdown(result.content, result.base_dir);

        const welcome = elements.markdownBody.querySelector('.welcome-message');
        if (welcome) welcome.remove();

        // Update active state in file tree
        elements.fileTree.querySelectorAll('.file-tree-item').forEach(item => {
          item.classList.toggle('active', item.dataset.path === filePath);
        });
      }
    } catch (err) {
      console.error('Failed to open file from tree:', err);
      showError('无法打开文件: ' + err);
    }
  }

  function toggleFileTree() {
    state.fileTreeCollapsed = !state.fileTreeCollapsed;
    elements.fileTreeSidebar.classList.toggle('collapsed', state.fileTreeCollapsed);
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

  function initMermaid() {
    if (typeof mermaid !== 'undefined') {
      const isDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;

      mermaid.initialize({
        startOnLoad: false,
        theme: isDark ? CONFIG.mermaidTheme.dark : CONFIG.mermaidTheme.light,
        securityLevel: 'loose'
      });

      // Find and render mermaid blocks
      const mermaidBlocks = elements.markdownBody.querySelectorAll('.mermaid, pre code.language-mermaid');
      mermaidBlocks.forEach((block, index) => {
        // Convert code blocks to mermaid format if needed
        if (block.tagName === 'CODE') {
          const pre = block.parentElement;
          const content = block.textContent;
          pre.outerHTML = `<pre class="mermaid" id="mermaid-${index}">${escapeHtml(content)}</pre>`;
        }
      });

      // Run mermaid
      mermaid.run();
    }
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

      // Ctrl+T: Toggle TOC
      if (e.ctrlKey && e.key === 't') {
        e.preventDefault();
        toggleTOC();
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

    document.addEventListener('drop', async (e) => {
      e.preventDefault();

      const files = e.dataTransfer.files;
      if (files.length > 0) {
        const file = files[0];
        if (file.name.endsWith('.md') || file.name.endsWith('.markdown')) {
          // Read file content
          const content = await readFile(file);
          if (content) {
            state.currentFile = file.name;
            state.currentContent = content;

            elements.filename.textContent = file.name;

            // Hide welcome message
            const welcome = elements.markdownBody.querySelector('.welcome-message');
            if (welcome) welcome.remove();

            await renderMarkdown(content);
          }
        } else {
          showError('请打开 Markdown 文件 (.md 或 .markdown)');
        }
      }
    });
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
  // Theme Detection
  // ============================================
  function setupThemeDetection() {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    mediaQuery.addEventListener('change', () => {
      // Re-render mermaid diagrams with new theme
      if (typeof mermaid !== 'undefined') {
        mermaid.initialize({
          theme: mediaQuery.matches ? CONFIG.mermaidTheme.dark : CONFIG.mermaidTheme.light
        });
        mermaid.run();
      }
    });
  }

  // ============================================
  // Event Bindings
  // ============================================
  function bindEvents() {
    elements.openFileBtn.addEventListener('click', openFile);
    elements.sourceToggle.addEventListener('click', toggleSourceMode);
    elements.tocToggle.addEventListener('click', toggleTOC);
    elements.fileTreeToggle.addEventListener('click', toggleFileTree);
    elements.openFolderBtn.addEventListener('click', openFolder);
    elements.openFolderToolbarBtn.addEventListener('click', openFolder);
  }

  // ============================================
  // Initialization
  // ============================================
  function init() {
    bindEvents();
    setupKeyboardShortcuts();
    setupDragDrop();
    setupScrollObserver();
    setupThemeDetection();

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
    renderMarkdown,
    toggleSourceMode,
    toggleTOC,
    toggleFileTree,
    buildTOC,
    invoke
  };

})();