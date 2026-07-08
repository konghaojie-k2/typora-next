/**
 * Paper Reader Integration
 *
 * Course-style tab enhancement for paper reader mode. Instead of a global
 * overlay, papers are opened as tabs; this module renders the AI guide,
 * sidebar, cards and feedback UI into the current tab content area.
 */

(function (global) {
  'use strict';

  const PaperReaderIntegration = {
    /**
     * Render the paper-reader welcome screen (no file selected yet).
     */
    showWelcome(container) {
      if (!container) return;
      container.innerHTML = `
        <div class="paper-reader-welcome">
          <div class="paper-reader-welcome-icon">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>
              <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
            </svg>
          </div>
          <h2 class="paper-reader-welcome-title">论文导读</h2>
          <p class="paper-reader-welcome-desc">
            AI 会帮你标出论文重点，按推荐顺序阅读，并用"人话"解释难点。
          </p>
          <div class="paper-reader-welcome-formats">
            <span class="paper-reader-welcome-format-tag">当前支持：本地 Markdown (.md)、PDF、论文 URL</span>
          </div>
          <button class="paper-reader-welcome-btn" id="paper-reader-select-file">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:6px;">
              <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/>
              <polyline points="13 2 13 9 20 9"/>
            </svg>
            选择本地论文文件
          </button>
          <div class="paper-reader-welcome-divider"><span>或</span></div>
          <button class="paper-reader-welcome-btn paper-reader-welcome-btn-secondary" id="paper-reader-select-pdf">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:6px;">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
              <line x1="16" y1="13" x2="8" y2="13"/>
              <line x1="16" y1="17" x2="8" y2="17"/>
              <polyline points="10 9 9 9 8 9"/>
            </svg>
            导入本地 PDF
          </button>
          <div class="paper-reader-url-form">
            <input type="text" id="paper-reader-url-input" class="paper-reader-url-input" placeholder="粘贴论文 URL（支持 arXiv）" />
            <button class="paper-reader-welcome-btn" id="paper-reader-import-url">导入</button>
          </div>
        </div>
      `;

      const btn = container.querySelector('#paper-reader-select-file');
      if (btn && window.TyporaNext && window.TyporaNext.openPaperFile) {
        btn.addEventListener('click', () => window.TyporaNext.openPaperFile());
      }

      const pdfBtn = container.querySelector('#paper-reader-select-pdf');
      if (pdfBtn && window.TyporaNext && window.TyporaNext.openPaperPdf) {
        pdfBtn.addEventListener('click', () => window.TyporaNext.openPaperPdf());
      }

      const urlInput = container.querySelector('#paper-reader-url-input');
      const urlBtn = container.querySelector('#paper-reader-import-url');
      const triggerUrlImport = () => {
        if (window.TyporaNext && window.TyporaNext.openPaperUrl) {
          window.TyporaNext.openPaperUrl();
        }
      };
      if (urlBtn) {
        urlBtn.addEventListener('click', triggerUrlImport);
      }
      if (urlInput) {
        urlInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') triggerUrlImport();
        });
      }
    },

    /**
     * Render the loading animation while generating the guide.
     */
    showLoading(container) {
      if (!container) return;
      container.innerHTML = `
        <div class="paper-reader-loading">
          <div class="paper-reader-loading-steps">
            <div class="paper-reader-loading-step active" data-step="1">
              <div class="paper-reader-loading-step-icon">1</div>
              <div class="paper-reader-loading-step-label">分析论文结构</div>
            </div>
            <div class="paper-reader-loading-line"></div>
            <div class="paper-reader-loading-step" data-step="2">
              <div class="paper-reader-loading-step-icon">2</div>
              <div class="paper-reader-loading-step-label">划重点</div>
            </div>
            <div class="paper-reader-loading-line"></div>
            <div class="paper-reader-loading-step" data-step="3">
              <div class="paper-reader-loading-step-icon">3</div>
              <div class="paper-reader-loading-step-label">生成导读</div>
            </div>
          </div>
          <div class="paper-reader-loading-spinner"></div>
          <p class="paper-reader-loading-text" id="paper-reader-loading-text">正在分析论文结构...</p>
        </div>
      `;

      const loadingMessages = [
        '正在分析论文结构...',
        '正在划重点...',
        '正在生成导读...'
      ];
      let loadingMessageIndex = 0;
      const loadingTextEl = container.querySelector('#paper-reader-loading-text');
      const steps = container.querySelectorAll('.paper-reader-loading-step');
      const loadingInterval = setInterval(() => {
        loadingMessageIndex = (loadingMessageIndex + 1) % loadingMessages.length;
        if (loadingTextEl) loadingTextEl.textContent = loadingMessages[loadingMessageIndex];
        steps.forEach((s, idx) => {
          s.classList.toggle('active', idx <= loadingMessageIndex);
        });
      }, 2000);

      container._paperReaderLoadingInterval = loadingInterval;
    },

    _clearLoadingInterval(container) {
      if (container && container._paperReaderLoadingInterval) {
        clearInterval(container._paperReaderLoadingInterval);
        container._paperReaderLoadingInterval = null;
      }
    },

    /**
     * Load or reuse the AI guide for a paper tab.
     */
    async loadGuideForTab(tab) {
      if (tab.paperGuide) return tab.paperGuide;

      const paperFile = tab.path;
      const guide = await window.TyporaNext.invoke('generate_paper_reader_guide', { paperFile });
      const content = await window.TyporaNext.invoke('read_text_file', { filePath: paperFile });
      const originalHtml = await window.TyporaNext.invoke('render_markdown', { content });

      tab.paperGuide = guide;
      tab.paperOriginalHtml = originalHtml;
      tab.paperContent = content;
      return guide;
    },

    /**
     * Render the paper reader UI into the active tab content area.
     */
    async enhancePaperTab(tab) {
      if (!tab) return;
      const container = document.getElementById('markdownBody');
      if (!container) return;

      // If guide is not loaded yet, show loading and generate it.
      if (!tab.paperGuide) {
        this.showLoading(container);
        try {
          await this.loadGuideForTab(tab);
        } catch (err) {
          this._clearLoadingInterval(container);
          console.error('Failed to generate paper reader guide:', err);
          container.innerHTML = `<div class="paper-reader-error"><p>生成导读失败</p><p>${err}</p><div style="margin-top:16px;"><button id="paper-reader-retry">重试</button> <button id="paper-reader-close">关闭</button></div></div>`;
          container.querySelector('#paper-reader-retry')?.addEventListener('click', () => {
            tab.paperGuide = null;
            this.enhancePaperTab(tab);
          });
          container.querySelector('#paper-reader-close')?.addEventListener('click', () => {
            const idx = window.TyporaNext.state.tabs.findIndex(t => t.path === tab.path);
            if (idx >= 0) window.TyporaNext.closeTab(idx);
          });
          return;
        }
      }

      this._clearLoadingInterval(container);

      // Clean up any previous reader for this tab.
      if (tab.paperReader) {
        tab.paperReader.close();
        tab.paperReader = null;
      }

      // Clear the loading/welcome DOM so the reader isn't hidden behind it.
      container.innerHTML = '';

      // Host the reading-order nav in the left TOC panel so the paper
      // content gets the full content width. Ensure the sidebar is visible
      // and on the TOC tab before rendering into it.
      const tocTree = document.getElementById('tocTree');
      if (window.TyporaNext && window.TyporaNext.switchSidebarTab) {
        window.TyporaNext.switchSidebarTab('toc');
      }
      if (window.TyporaNext && window.TyporaNext.toggleSidebar
          && window.TyporaNext.state && window.TyporaNext.state.sidebarCollapsed) {
        window.TyporaNext.toggleSidebar();
      }

      const reader = new window.PaperReader({
        container,
        sidebarContainer: tocTree,
        onClose: () => {
          const idx = window.TyporaNext.state.tabs.findIndex(t => t.path === tab.path);
          if (idx >= 0) window.TyporaNext.closeTab(idx);
        },
        onConfirmClose: () => {
          const message = '退出论文导读将关闭当前论文标签，阅读进度已保留。是否继续？';
          if (window.TyporaNext && window.TyporaNext._showConfirm) {
            return window.TyporaNext._showConfirm(message);
          }
          return Promise.resolve(window.confirm(message));
        }
      });
      reader.paperFile = tab.path;
      reader.render(tab.paperGuide, tab.paperOriginalHtml);
      tab.paperReader = reader;

      // Restore scroll position if we have one saved on the tab.
      if (typeof tab.scrollTop === 'number' && tab.scrollTop > 0) {
        const main = container.querySelector('#paper-reader-main');
        if (main) main.scrollTop = tab.scrollTop;
      }
    },

    /**
     * Remove paper reader DOM from the active tab without destroying the tab.
     * Used when switching away from a paper tab.
     */
    unmountTab(tab) {
      if (!tab) return;
      if (tab.paperReader) {
        tab.paperReader.close();
        tab.paperReader = null;
      }
      // Remove any stray feedback overlay.
      document.querySelectorAll('#paper-reader-feedback-overlay').forEach(el => el.remove());
    },

    /**
     * Full teardown: close all paper readers and clear welcome/loading DOM.
     * Called when leaving the paper workspace.
     */
    teardown() {
      const container = document.getElementById('markdownBody');
      if (container) {
        this._clearLoadingInterval(container);
      }
      if (window.TyporaNext && window.TyporaNext.state) {
        window.TyporaNext.state.tabs.forEach(tab => {
          if (tab.mode === 'paper' && tab.paperReader) {
            tab.paperReader.close();
            tab.paperReader = null;
          }
        });
      }
      document.querySelectorAll('#paper-reader-feedback-overlay').forEach(el => el.remove());
    }
  };

  global.PaperReaderIntegration = PaperReaderIntegration;
})(typeof window !== 'undefined' ? window : global);
