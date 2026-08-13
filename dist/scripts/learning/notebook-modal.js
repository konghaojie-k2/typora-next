/**
 * Notebook Modal Shell - 笔记本式对话面板外壳（Sprint 17）
 *
 * 从 socratic-modal.js 抽出的 UI 外壳：header（图标/标题/副标题/chips）+
 * 聊天气泡流 + 底部输入区。引擎（苏格拉底复习 / 案例研习）提供文案与
 * 对话逻辑，外壳只管 DOM 与事件接线。
 *
 * prefix 参数化 DOM id：prefix='socratic' 时与拆分前完全一致
 * （socraticModalOverlay / socraticChat / socraticInput / socraticSendBtn / socraticEndBtn）。
 * CSS class 沿用 socratic-*（视觉统一，避免样式重复）。
 */

(function() {
  'use strict';

  if (typeof window === 'undefined') global.window = {};
  if (typeof document === 'undefined') {
    global.document = {
      createElement: (tag) => {
        const el = {
          tagName: tag,
          style: {},
          classList: { add: () => {}, remove: () => {}, contains: () => false, toggle: () => {} },
          children: [],
          innerHTML: '',
          textContent: '',
          value: '',
          appendChild: (c) => { el.children.push(c); return c; },
          remove: () => {},
          addEventListener: () => {},
          querySelector: () => null,
          querySelectorAll: () => [],
          setAttribute: () => {},
          focus: () => {}
        };
        return el;
      },
      body: { appendChild: () => {}, removeChild: () => {} },
      getElementById: () => null,
      addEventListener: () => {},
      removeEventListener: () => {}
    };
  }

  class NotebookModal {
    /**
     * @param {object} opts
     * @param {string} opts.prefix - DOM id 前缀（'socratic' 保持拆分前 id 不变）
     * @param {string} opts.icon - header 图标（emoji）
     * @param {string} opts.title - header 标题
     * @param {string} opts.subtitle - header 副标题（纯文本）
     * @param {string} opts.chipsHtml - 概念 chips 预渲染 HTML
     * @param {string} opts.placeholder - 聊天区占位文案
     * @param {string} opts.inputPlaceholder - 输入框 placeholder
     * @param {string} opts.tutorAvatar - AI 侧头像字符
     * @param {string} [opts.endLabel='结束'] - 结束按钮初始文案
     */
    constructor(opts) {
      this.prefix = opts.prefix || 'notebook';
      this.icon = opts.icon || '💬';
      this.title = opts.title || '';
      this.subtitle = opts.subtitle || '';
      this.chipsHtml = opts.chipsHtml || '';
      this.placeholder = opts.placeholder || '';
      this.inputPlaceholder = opts.inputPlaceholder || '输入你的回答... (Shift+Enter 换行, Enter 发送)';
      this.tutorAvatar = opts.tutorAvatar || '🤖';
      this.endLabel = opts.endLabel || '结束';

      this._overlay = null;
      this._card = null;
      this._chatEl = null;
      this._inputEl = null;
      this._escHandler = null;
    }

    get chatEl() { return this._chatEl; }
    get inputEl() { return this._inputEl; }

    /** 构建 DOM 并挂载到 body */
    render() {
      const p = this.prefix;
      const existing = document.getElementById(`${p}ModalOverlay`);
      if (existing) existing.remove();

      const overlay = document.createElement('div');
      overlay.id = `${p}ModalOverlay`;
      overlay.className = 'socratic-modal-overlay';

      const card = document.createElement('div');
      card.id = `${p}ModalCard`;
      card.className = 'socratic-modal-card';

      card.innerHTML = `
        <div class="socratic-modal-header">
          <div class="socratic-modal-header-top">
            <div class="socratic-modal-header-left">
              <div class="socratic-modal-icon">${this.icon}</div>
              <div>
                <div class="socratic-modal-title">${this.title}</div>
                <div class="socratic-modal-subtitle">${this.subtitle}</div>
              </div>
            </div>
            <button id="${p}EndBtn" class="socratic-modal-end-btn">${this.endLabel}</button>
          </div>
          <div id="${p}ConceptChips" class="socratic-concept-chips">
            ${this.chipsHtml}
          </div>
        </div>
        <div id="${p}Chat" class="socratic-chat">
          <div class="socratic-chat-placeholder">
            ${this.placeholder}
          </div>
        </div>
        <div class="socratic-input-area">
          <div class="socratic-input-row">
            <textarea id="${p}Input" class="socratic-input" placeholder="${this.inputPlaceholder}"></textarea>
            <button id="${p}SendBtn" class="socratic-send-btn">发送</button>
          </div>
          <div class="socratic-input-hint">Enter 发送 · Shift+Enter 换行 · ESC 结束</div>
        </div>
      `;

      overlay.appendChild(card);
      document.body.appendChild(overlay);

      this._overlay = overlay;
      this._card = card;
      this._chatEl = card.querySelector(`#${p}Chat`);
      this._inputEl = card.querySelector(`#${p}Input`);
    }

    /**
     * 事件接线（引擎提供回调）
     * @param {object} hooks
     * @param {Function} hooks.onSend - 用户点击发送/Enter（外壳已清空输入框）
     * @param {Function} hooks.onEndClick - 结束按钮或 ESC
     */
    bindEvents(hooks) {
      const p = this.prefix;
      const sendBtn = this._card.querySelector(`#${p}SendBtn`);
      sendBtn.addEventListener('click', () => hooks.onSend());

      this._inputEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          hooks.onSend();
        }
      });

      this._card.querySelector(`#${p}EndBtn`).addEventListener('click', () => {
        hooks.onEndClick();
      });

      this._escHandler = (e) => {
        if (e.key === 'Escape') hooks.onEndClick();
      };
      document.addEventListener('keydown', this._escHandler);
    }

    /** 读取输入框内容并清空（引擎在 onSend 里调用） */
    takeInput() {
      const text = this._inputEl.value.trim();
      if (text) this._inputEl.value = '';
      return text;
    }

    appendTutorBubble(content) {
      const el = document.createElement('div');
      el.className = 'socratic-bubble-row';
      el.innerHTML = `
        <div class="socratic-avatar-tutor">${this.tutorAvatar}</div>
        <div class="socratic-bubble-tutor socratic-bubble-md">${renderMarkdown(content)}</div>
      `;
      this._chatEl.appendChild(el);
      this._chatEl.scrollTop = this._chatEl.scrollHeight;
    }

    /**
     * 流式气泡（Sprint 17）：先建空气泡，随 delta 累积重渲染。
     * @returns {{el: Element, update: (text: string) => void, finalize: (text: string) => void, remove: () => void}}
     */
    startTutorStream() {
      const el = document.createElement('div');
      el.className = 'socratic-bubble-row';
      el.innerHTML = `
        <div class="socratic-avatar-tutor">${this.tutorAvatar}</div>
        <div class="socratic-bubble-tutor socratic-bubble-md socratic-bubble-streaming"></div>
      `;
      this._chatEl.appendChild(el);
      this._chatEl.scrollTop = this._chatEl.scrollHeight;
      const contentEl = el.querySelector('.socratic-bubble-tutor');
      const scroll = () => { this._chatEl.scrollTop = this._chatEl.scrollHeight; };
      return {
        el,
        update(text) {
          contentEl.innerHTML = renderMarkdown(text);
          scroll();
        },
        finalize(text) {
          contentEl.innerHTML = renderMarkdown(text);
          contentEl.classList.remove('socratic-bubble-streaming');
          scroll();
        },
        remove() { el.remove(); }
      };
    }

    appendUserBubble(content) {
      const el = document.createElement('div');
      el.className = 'socratic-bubble-row-user';
      el.innerHTML = `
        <div class="socratic-bubble-user">${escapeHtml(content)}</div>
        <div class="socratic-avatar-user">我</div>
      `;
      this._chatEl.appendChild(el);
      this._chatEl.scrollTop = this._chatEl.scrollHeight;
    }

    /** @returns {Element} loading 气泡（引擎负责 remove） */
    appendLoadingBubble() {
      const el = document.createElement('div');
      el.className = 'socratic-bubble-row';
      el.innerHTML = `
        <div class="socratic-avatar-tutor">${this.tutorAvatar}</div>
        <div class="socratic-bubble-loading">思考中...</div>
      `;
      this._chatEl.appendChild(el);
      this._chatEl.scrollTop = this._chatEl.scrollHeight;
      return el;
    }

    /** 对话结束后禁用输入；结束按钮改「关闭」 */
    lockInput() {
      if (this._inputEl) this._inputEl.disabled = true;
      const p = this.prefix;
      const sendBtn = this._card && this._card.querySelector(`#${p}SendBtn`);
      if (sendBtn) sendBtn.disabled = true;
      const endBtn = this._card && this._card.querySelector(`#${p}EndBtn`);
      if (endBtn) endBtn.textContent = '关闭';
    }

    close() {
      if (this._overlay) this._overlay.remove();
      if (this._escHandler) document.removeEventListener('keydown', this._escHandler);
    }
  }

  function escapeHtml(text) {
    // 纯字符串实现（无 DOM 依赖，Node 可测）；
    // 引号转义在文本节点上下文无害（&quot; 渲染为 "）
    return String(text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * AI 气泡内容渲染：优先全局 markdownToHtml（markdown-utils.js，
   * 与探索模式聊天同源）；Node 测试等无该模块场景兜底 escapeHtml。
   */
  function renderMarkdown(text) {
    if (typeof window !== 'undefined' && typeof window.markdownToHtml === 'function') {
      return window.markdownToHtml(String(text || ''));
    }
    return escapeHtml(text);
  }

  window.NotebookModal = NotebookModal;
  window.NotebookModal.escapeHtml = escapeHtml; // 引擎侧转义 subtitle/chips 用
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { NotebookModal, escapeHtml };
  }
})();
