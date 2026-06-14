/**
 * Exploration Panel — floating, draggable, closable AI chat overlay
 *
 * Triggered per Markdown file (not per Tab). Position and size persist
 * per file via localStorage. Conversation state is owned by ExplorationSession
 * and persisted to disk via the Rust side.
 *
 * The chat engine is invoked through the pure-function interface
 * `agentBridge.chatWithAgent({ article, history, message })`, so swapping
 * the underlying LLM engine does not require touching this UI.
 */

(function() {
  'use strict';

  if (typeof window === 'undefined') {
    global.window = {};
  }

  const WELCOME_MESSAGE = '现在你可以自由探索了，而我会在你身边';
  const STORAGE_KEY_POSITION_PREFIX = 'exploration-panel-pos:';
  const STORAGE_KEY_OPEN_PREFIX = 'exploration-panel-open:';

  // ============================================
  // Storage adapters
  // ============================================

  function createLocalStorageAdapter() {
    const prefix = 'exploration-session:';
    return {
      read(key) {
        try { return localStorage.getItem(prefix + key); } catch (e) { return null; }
      },
      write(key, data) {
        try { localStorage.setItem(prefix + key, data); } catch (e) {}
      },
      remove(key) {
        try { localStorage.removeItem(prefix + key); } catch (e) {}
      }
    };
  }

  function createTauriStorageAdapter() {
    const invoke = window.__TAURI__?.core?.invoke;
    return {
      async read(key) {
        try { return await invoke('read_exploration_session', { fileName: key }); }
        catch (e) { console.warn('[ExplorationUI] Tauri read failed:', e); return null; }
      },
      async write(key, data) {
        try { await invoke('write_exploration_session', { fileName: key, content: data }); }
        catch (e) { console.warn('[ExplorationUI] Tauri write failed:', e); }
      },
      async remove(key) {
        try { await invoke('delete_exploration_session', { fileName: key }); }
        catch (e) { console.warn('[ExplorationUI] Tauri delete failed:', e); }
      }
    };
  }

  function createStorageAdapter() {
    if (window.__TAURI__) return createTauriStorageAdapter();
    return createLocalStorageAdapter();
  }

  function getBasename(filePath) {
    if (!filePath) return 'untitled';
    const normalized = String(filePath).replace(/\\/g, '/');
    return normalized.split('/').pop() || 'untitled';
  }

  function escapeHtml(s) {
    const div = document.createElement('div');
    div.textContent = s == null ? '' : String(s);
    return div.innerHTML;
  }

  // ============================================
  // ExplorationPanel
  // ============================================

  class ExplorationPanel {
    constructor(options) {
      this.filePath = options.filePath || '';
      this.fileContent = options.fileContent || '';
      this.fileName = getBasename(this.filePath);

      this.session = new window.ExplorationSession({
        filePath: this.filePath,
        storage: createStorageAdapter()
      });
      // Async load — store promise so methods can await before session access
      this._sessionReady = this.session.load();

      this.elements = {};
      this.isDragging = false;
      this.isResizing = false;
      this.dragOffset = { x: 0, y: 0 };
      this._escHandler = (e) => {
        if (e.key === 'Escape' && this.isOpen()) this.close();
      };
    }

    isOpen() {
      return !!(this.elements.root && this.elements.root.style.display !== 'none');
    }

    /**
     * Ensure the async session load has completed before accessing session data.
     * Safe to call multiple times — resolves immediately after the first call.
     */
    async _ensureSession() {
      if (this._sessionReady) await this._sessionReady;
    }

    mount() {
      if (this.elements.root) return;
      const root = document.createElement('div');
      root.className = 'exploration-panel';
      root.style.display = 'none';
      root.dataset.file = this.fileName;

      const header = document.createElement('div');
      header.className = 'exploration-panel-header';
      const titleSpan = document.createElement('span');
      titleSpan.className = 'exploration-panel-title';
      titleSpan.textContent = '探索 · ' + this.fileName;
      header.appendChild(titleSpan);
      const closeBtn = document.createElement('button');
      closeBtn.className = 'exploration-panel-close';
      closeBtn.textContent = '×';
      closeBtn.title = '关闭 (Esc)';
      closeBtn.addEventListener('click', () => this.close());
      header.appendChild(closeBtn);

      const sidebar = document.createElement('div');
      sidebar.className = 'exploration-panel-sidebar';
      const newConvBtn = document.createElement('button');
      newConvBtn.className = 'exploration-panel-new-conv';
      newConvBtn.textContent = '+ 新建对话';
      newConvBtn.addEventListener('click', () => this._createConversation());
      sidebar.appendChild(newConvBtn);
      const convList = document.createElement('div');
      convList.className = 'exploration-panel-conv-list';
      sidebar.appendChild(convList);

      const main = document.createElement('div');
      main.className = 'exploration-panel-main';

      const messages = document.createElement('div');
      messages.className = 'exploration-panel-messages';
      main.appendChild(messages);

      const inputArea = document.createElement('div');
      inputArea.className = 'exploration-panel-input-area';
      const textarea = document.createElement('textarea');
      textarea.className = 'exploration-panel-input';
      textarea.placeholder = '输入问题，Enter 发送，Shift+Enter 换行';
      textarea.addEventListener('keydown', (e) => this._onInputKeydown(e));
      const sendBtn = document.createElement('button');
      sendBtn.className = 'exploration-panel-send';
      sendBtn.textContent = '发送';
      sendBtn.addEventListener('click', () => this._sendMessage());
      inputArea.appendChild(textarea);
      inputArea.appendChild(sendBtn);
      main.appendChild(inputArea);

      // Body wrapper — sidebar + main sit side by side in a flex row
      const body = document.createElement('div');
      body.className = 'exploration-panel-body';
      body.appendChild(sidebar);
      body.appendChild(main);

      const resizeHandle = document.createElement('div');
      resizeHandle.className = 'exploration-panel-resize';
      resizeHandle.title = '拖拽调整大小';

      root.appendChild(header);
      root.appendChild(body);
      root.appendChild(resizeHandle);

      document.body.appendChild(root);

      this.elements = { root, header, convList, messages, textarea, sendBtn, resizeHandle };

      this._restorePosition();
      this._bindDrag(header);
      this._bindResize(resizeHandle);
      document.addEventListener('keydown', this._escHandler);

      this._renderConversationList();
      this._renderMessages();
    }

    unmount() {
      // Final save before teardown — ensures the latest messages survive tab close
      if (this.session && typeof this.session.save === 'function') {
        try { Promise.resolve(this.session.save()).catch(function (e) { /* ignore */ }); } catch (e) {}
      }
      document.removeEventListener('keydown', this._escHandler);
      if (this.elements.root) {
        this.elements.root.remove();
        this.elements.root = null;
      }
      this.elements = {};
    }

    async open() {
      this.mount();
      this.elements.root.style.display = 'flex';
      this._renderConversationList();
      this._renderMessages();
      this._saveOpenState(true);
      this.elements.textarea.focus();
      // Async re-render once session data is loaded from storage
      await this._ensureSession();
      this._renderConversationList();
      this._renderMessages();
    }

    close() {
      if (!this.elements.root) return;
      this.elements.root.style.display = 'none';
      this._saveOpenState(false);
    }

    toggle() {
      this.isOpen() ? this.close() : this.open();
    }

    // Position / size persistence

    _positionKey() { return STORAGE_KEY_POSITION_PREFIX + this.fileName; }
    _openKey() { return STORAGE_KEY_OPEN_PREFIX + this.fileName; }

    _restorePosition() {
      let pos = null;
      try {
        const raw = localStorage.getItem(this._positionKey());
        if (raw) pos = JSON.parse(raw);
      } catch (e) {}
      const root = this.elements.root;
      if (pos && pos.w && pos.h) {
        root.style.left = pos.x + 'px';
        root.style.top = pos.y + 'px';
        root.style.width = pos.w + 'px';
        root.style.height = pos.h + 'px';
      } else {
        const margin = 24;
        const w = 420, h = 520;
        root.style.width = w + 'px';
        root.style.height = h + 'px';
        root.style.left = (window.innerWidth - w - margin) + 'px';
        root.style.top = (window.innerHeight - h - margin) + 'px';
      }
    }

    _savePosition() {
      const r = this.elements.root.getBoundingClientRect();
      try {
        localStorage.setItem(this._positionKey(), JSON.stringify({
          x: r.left, y: r.top, w: r.width, h: r.height
        }));
      } catch (e) {}
    }

    _saveOpenState(open) {
      try { localStorage.setItem(this._openKey(), open ? '1' : '0'); } catch (e) {}
    }

    wasOpenBefore() {
      try { return localStorage.getItem(this._openKey()) === '1'; } catch (e) { return false; }
    }

    // Drag & resize

    _bindDrag(handle) {
      const onMove = (e) => {
        if (!this.isDragging) return;
        const cx = e.clientX || (e.touches && e.touches[0]?.clientX) || 0;
        const cy = e.clientY || (e.touches && e.touches[0]?.clientY) || 0;
        const root = this.elements.root;
        const w = root.offsetWidth, h = root.offsetHeight;
        const nx = Math.max(0, Math.min(window.innerWidth - w, cx - this.dragOffset.x));
        const ny = Math.max(0, Math.min(window.innerHeight - 40, cy - this.dragOffset.y));
        root.style.left = nx + 'px';
        root.style.top = ny + 'px';
      };
      const onEnd = () => {
        if (!this.isDragging) return;
        this.isDragging = false;
        this._savePosition();
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onEnd);
        document.removeEventListener('touchmove', onMove);
        document.removeEventListener('touchend', onEnd);
      };
      handle.addEventListener('mousedown', (e) => {
        if (e.target.closest('button')) return;
        const r = this.elements.root.getBoundingClientRect();
        this.dragOffset = { x: e.clientX - r.left, y: e.clientY - r.top };
        this.isDragging = true;
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onEnd);
      });
      handle.addEventListener('touchstart', (e) => {
        const t = e.touches[0];
        const r = this.elements.root.getBoundingClientRect();
        this.dragOffset = { x: t.clientX - r.left, y: t.clientY - r.top };
        this.isDragging = true;
        document.addEventListener('touchmove', onMove);
        document.addEventListener('touchend', onEnd);
      });
    }

    _bindResize(handle) {
      const onMove = (e) => {
        if (!this.isResizing) return;
        const r = this.elements.root.getBoundingClientRect();
        const cx = e.clientX || (e.touches && e.touches[0]?.clientX) || 0;
        const cy = e.clientY || (e.touches && e.touches[0]?.clientY) || 0;
        const nw = Math.max(280, Math.min(window.innerWidth - r.left, cx - r.left));
        const nh = Math.max(320, Math.min(window.innerHeight - r.top, cy - r.top));
        this.elements.root.style.width = nw + 'px';
        this.elements.root.style.height = nh + 'px';
      };
      const onEnd = () => {
        if (!this.isResizing) return;
        this.isResizing = false;
        this._savePosition();
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onEnd);
        document.removeEventListener('touchmove', onMove);
        document.removeEventListener('touchend', onEnd);
      };
      handle.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        this.isResizing = true;
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onEnd);
      });
    }

    // Conversation rendering

    _renderConversationList() {
      const list = this.elements.convList;
      if (!list) { console.warn('[ExplorationUI] convList element missing'); return; }
      list.innerHTML = '';
      const conversations = this.session.getConversations();
      conversations.forEach(conv => {
        const item = document.createElement('div');
        item.className = 'exploration-panel-conv-item';
        if (conv.id === this.session.activeConversationId) item.classList.add('active');
        const title = document.createElement('div');
        title.className = 'exploration-panel-conv-title';
        title.textContent = conv.title || '新对话';
        title.title = '右键重命名或删除';
        const time = document.createElement('div');
        time.className = 'exploration-panel-conv-time';
        time.textContent = window.formatRelativeTime(conv.createdAt);
        item.appendChild(title);
        item.appendChild(time);
        item.addEventListener('click', () => {
          this.session.setActiveConversation(conv.id);
          this._renderConversationList();
          this._renderMessages();
        });
        item.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          this._showConvContextMenu(e, conv);
        });
        list.appendChild(item);
      });
    }

    _showConvContextMenu(event, conv) {
      const existing = document.querySelector('.exploration-conv-context-menu');
      if (existing) existing.remove();

      const menu = document.createElement('div');
      menu.className = 'exploration-conv-context-menu';
      menu.style.left = event.clientX + 'px';
      menu.style.top = event.clientY + 'px';

      const renameItem = document.createElement('div');
      renameItem.className = 'exploration-conv-context-menu-item';
      renameItem.textContent = '重命名';
      renameItem.addEventListener('click', async () => {
        const newTitle = window.prompt('新标题:', conv.title);
        if (newTitle !== null) {
          this.session.renameConversation(conv.id, newTitle);
          await this._ensureSession();
          await this.session.save();
          this._renderConversationList();
        }
        menu.remove();
      });

      const deleteItem = document.createElement('div');
      deleteItem.className = 'exploration-conv-context-menu-item';
      deleteItem.textContent = '删除';
      deleteItem.addEventListener('click', async () => {
        if (window.confirm('确定删除这条对话吗？')) {
          this.session.deleteConversation(conv.id);
          await this._ensureSession();
          await this.session.save();
          this._renderConversationList();
          this._renderMessages();
        }
        menu.remove();
      });

      menu.appendChild(renameItem);
      menu.appendChild(deleteItem);
      document.body.appendChild(menu);

      const closeMenu = (e) => {
        if (!menu.contains(e.target)) {
          menu.remove();
          document.removeEventListener('click', closeMenu);
          document.removeEventListener('contextmenu', closeMenu);
        }
      };
      setTimeout(() => {
        document.addEventListener('click', closeMenu);
        document.addEventListener('contextmenu', closeMenu);
      }, 0);
    }

    _renderMessages() {
      const area = this.elements.messages;
      if (!area) { console.warn('[ExplorationUI] messages element missing'); return; }
      area.innerHTML = '';
      const conv = this.session.getActiveConversation();
      if (!conv) return;
      if (conv.messages.length === 0) {
        const welcome = document.createElement('div');
        welcome.className = 'exploration-panel-welcome';
        welcome.textContent = WELCOME_MESSAGE;
        area.appendChild(welcome);
        return;
      }
      conv.messages.forEach(msg => {
        const row = document.createElement('div');
        row.className = 'exploration-panel-msg-row ' + msg.role;
        const bubble = document.createElement('div');
        bubble.className = 'exploration-panel-msg-bubble';
        if (msg.role === 'assistant') {
          // Use full Rust-rendered HTML if available, otherwise fallback
          bubble.innerHTML = msg._renderedHtml || this._renderMarkdownSync(msg.content);
        } else {
          const text = document.createElement('div');
          text.className = 'exploration-panel-msg-text';
          text.textContent = msg.content;
          bubble.appendChild(text);
        }
        row.appendChild(bubble);
        area.appendChild(row);
      });
      area.scrollTop = area.scrollHeight;
    }

    _renderMarkdownSync(content) {
      return window.markdownToHtml ? window.markdownToHtml(content) : escapeHtml(content);
    }

    async _createConversation() {
      await this._ensureSession();
      this.session.createConversation();
      await this.session.save();
      this._renderConversationList();
      this._renderMessages();
      this.elements.textarea.focus();
    }

    _onInputKeydown(e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this._sendMessage();
      }
    }

    async _sendMessage() {
      const text = this.elements.textarea.value.trim();
      if (!text) return;

      await this._ensureSession();
      this.session.addMessage('user', text);
      await this.session.save();
      this.elements.textarea.value = '';
      this._renderConversationList();
      this._renderMessages();

      await this._requestAIResponse();
    }

    async _requestAIResponse() {
      const conv = this.session.getActiveConversation();
      if (!conv) return;

      // Disable input and show loading indicator
      this._showLoading();

      const history = conv.messages.map(msg => ({ role: msg.role, content: msg.content }));
      const lastMessage = conv.messages[conv.messages.length - 1];
      const userMessage = lastMessage && lastMessage.role === 'user' ? lastMessage.content : '';

      try {
        if (!window.__TAURI__) {
          // Web preview — SDK not available in browser context
          // Simulate a brief delay so the loading indicator is visible
          await new Promise(resolve => setTimeout(resolve, 600));
          this.session.addMessage('assistant',
            '> 💡 **AI 深度探索需要桌面应用**\n\n' +
            '当前为 Web 预览模式，无法加载 Claude Agent SDK。\n\n' +
            '请使用 Tauri 桌面应用（`app.exe`）运行，以启用基于 Agent SDK 的深度探索对话。'
          );
        } else {
          // Real Agent SDK call via engine-agnostic bridge.
          // The bridge (agent-bridge.js) loads @anthropic-ai/claude-agent-sdk
          // and returns the AI response. Swap bridge implementations to
          // change backends without touching this UI.
          const response = await window.agentBridge.chatWithAgent({
            article: this.fileContent,
            history,
            message: userMessage
          });
          this.session.addMessage('assistant', response);
        }
      } catch (e) {
        console.error('[ExplorationUI] AI response failed:', e);
        this.session.addMessage('assistant',
          '**⚠️ 回复生成失败**\n\n' +
          '> ' + (e.message || String(e)) + '\n\n' +
          '请检查 Agent SDK 配置后重试，或重新发送消息。'
        );
      } finally {
        this._hideLoading();
      }

      // Render new assistant message through full Rust pulldown-cmark pipeline
      await this._ensureSession();
      await this._renderLastAssistantMessage();
      await this.session.save();
      this._renderMessages();
    }

    /**
     * Render the last assistant message through the Rust pulldown-cmark pipeline,
     * then cache the HTML so _renderMessages can use it directly.
     * Falls back to client-side markdownToHtml() in web preview mode.
     */
    async _renderLastAssistantMessage() {
      const conv = this.session.getActiveConversation();
      if (!conv || conv.messages.length === 0) return;
      var lastMsg = conv.messages[conv.messages.length - 1];
      if (lastMsg.role !== 'assistant' || !lastMsg.content) return;

      try {
        if (window.__TAURI__) {
          var invoke = window.__TAURI__.core.invoke;
          lastMsg._renderedHtml = await invoke('render_markdown', { content: lastMsg.content });
        } else {
          // Web preview: use the client-side lightweight renderer
          lastMsg._renderedHtml = window.markdownToHtml
            ? window.markdownToHtml(lastMsg.content)
            : lastMsg.content;
        }
      } catch (e) {
        console.warn('[ExplorationUI] full render failed, using fallback:', e);
        lastMsg._renderedHtml = window.markdownToHtml
          ? window.markdownToHtml(lastMsg.content)
          : lastMsg.content;
      }
    }

    /**
     * Show a "AI 思考中..." loading indicator and disable inputs.
     * Removed by _hideLoading() before _renderMessages() clears the DOM.
     */
    _showLoading() {
      // Disable interactive elements
      if (this.elements.textarea) this.elements.textarea.disabled = true;
      if (this.elements.sendBtn) this.elements.sendBtn.disabled = true;

      const area = this.elements.messages;
      if (!area) return;

      const loadingId = 'exploration-loading-' + (this.fileName || 'unknown');
      if (document.getElementById(loadingId)) return;

      const row = document.createElement('div');
      row.className = 'exploration-panel-msg-row assistant loading';
      row.id = loadingId;

      const bubble = document.createElement('div');
      bubble.className = 'exploration-panel-msg-bubble';

      const typing = document.createElement('span');
      typing.className = 'exploration-panel-typing';
      // Three animated dots via CSS pseudo-elements
      typing.textContent = 'AI 思考中';
      bubble.appendChild(typing);

      row.appendChild(bubble);
      area.appendChild(row);
      area.scrollTop = area.scrollHeight;
    }

    /**
     * Remove the loading indicator and re-enable inputs.
     */
    _hideLoading() {
      if (this.elements.textarea) this.elements.textarea.disabled = false;
      if (this.elements.sendBtn) this.elements.sendBtn.disabled = false;

      const el = document.getElementById('exploration-loading-' + (this.fileName || 'unknown'));
      if (el) el.remove();
    }
  }

  // ============================================
  // Exports
  // ============================================

  // Backward-compatible export: keep the old class name `ExplorationUI`
  window.ExplorationUI = ExplorationPanel;
  window.ExplorationPanel = ExplorationPanel;
  window.ExplorationWelcomeMessage = WELCOME_MESSAGE;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ExplorationPanel, ExplorationUI: ExplorationPanel, WELCOME_MESSAGE };
  }
})();
