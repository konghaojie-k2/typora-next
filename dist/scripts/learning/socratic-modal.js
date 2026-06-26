/**
 * Socratic Review — V2 Notebook Modal
 * Sprint 8
 *
 * Visual: docs/prototypes/sprint8-socratic-mockups.html (V2)
 * - Top: cluster concept chips (no progress)
 * - Middle: vertical notebook cards (Q + A)
 * - Bottom: input + send
 * - No fixed "X/Y" progress (AI decides question order/count dynamically)
 * - 2nd confirm on end (avoid accidental close, Sprint 2 lesson)
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
          getAttribute: () => null,
          focus: () => {},
          click: () => {}
        };
        return el;
      },
      body: { appendChild: () => {}, removeChild: () => {} },
      addEventListener: () => {},
      removeEventListener: () => {}
    };
  }

  class SocraticModal {
    constructor(opts) {
      this.projectPath = opts.projectPath;
      this.cluster = null;
      this.concept_ids = [];
      this.concept_titles = [];
      this.concept_edges = [];
      this.sessionId = null;
      this.turns = [];
      this.notebookCards = [];
      this.opened = false;
      this.llmDone = false;
      this.doneCardShown = false;
      this.confirmDialog = null;
      this.endReason = null;
      this._startedAt = null;
      this._endConfirmShown = false;
      this._sessionSaved = false;
    }

    async open() {
      this._startedAt = new Date().toISOString();
      this.opened = true;

      // Load cluster
      if (!window.__TAURI__) return;
      try {
        this.cluster = await window.__TAURI__.core.invoke('socratic_select_cluster', {
          projectPath: this.projectPath
        });
        this.concept_ids = (this.cluster?.concepts || []).map(c => c.id);
        this.concept_titles = (this.cluster?.concepts || []).map(c => c.title);
        // Map edge (id, id) pairs to (title, title) pairs for the opening prompt
        const idToTitle = {};
        (this.cluster?.concepts || []).forEach(c => { idToTitle[c.id] = c.title; });
        this.concept_edges = (this.cluster?.edges || [])
          .map(e => [idToTitle[e.from], idToTitle[e.to]])
          .filter(pair => pair[0] && pair[1]);
      } catch (e) {
        console.error('[SocraticModal] cluster select failed:', e);
        // Fallback: empty cluster, but still open (sparse KG)
        this.cluster = { concepts: [], edges: [], cluster_hash: 'empty' };
      }

      // Render UI
      this._renderDOM();
      this._bindEvents();

      // Auto-trigger first tutor question
      await this._sendTutorTurn();
    }

    /** Build the V2 Notebook modal DOM */
    _renderDOM() {
      // Remove any existing
      const existing = document.getElementById('socraticModalOverlay');
      if (existing) existing.remove();

      const overlay = document.createElement('div');
      overlay.id = 'socraticModalOverlay';
      overlay.className = 'socratic-modal-overlay';

      const card = document.createElement('div');
      card.id = 'socraticModalCard';
      card.className = 'socratic-modal-card';

      // Header
      const chipsHtml = this.concept_titles.length > 0
        ? this.concept_titles.map((t, i) =>
            `<span class="socratic-chip ${i === 0 ? 'socratic-chip-primary' : ''}">#${t}</span>`
          ).join('')
        : '<span class="socratic-chip-fallback">无概念（KG 稀疏 fallback）</span>';

      card.innerHTML = `
        <div class="socratic-modal-header">
          <div class="socratic-modal-header-top">
            <div class="socratic-modal-header-left">
              <div class="socratic-modal-icon">🏛️</div>
              <div>
                <div class="socratic-modal-title">Socratic 复习</div>
                <div class="socratic-modal-subtitle">本场概念: ${this.concept_titles.join(' · ') || '—'}</div>
              </div>
            </div>
            <button id="socraticEndBtn" class="socratic-modal-end-btn">结束</button>
          </div>
          <div id="socraticConceptChips" class="socratic-concept-chips">
            ${chipsHtml}
          </div>
        </div>
        <div id="socraticChat" class="socratic-chat">
          <div class="socratic-chat-placeholder">
            🧑‍🏫 等待 tutor 第一问...
          </div>
        </div>
        <div class="socratic-input-area">
          <div class="socratic-input-row">
            <textarea id="socraticInput" class="socratic-input" placeholder="输入你的回答... (Shift+Enter 换行, Enter 发送)"></textarea>
            <button id="socraticSendBtn" class="socratic-send-btn">发送</button>
          </div>
          <div class="socratic-input-hint">Enter 发送 · Shift+Enter 换行 · ESC 结束</div>
        </div>
      `;

      overlay.appendChild(card);
      document.body.appendChild(overlay);

      this._overlay = overlay;
      this._card = card;
      this._chatEl = card.querySelector('#socraticChat');
      this._inputEl = card.querySelector('#socraticInput');
    }

    _bindEvents() {
      const self = this;
      const sendBtn = this._card.querySelector('#socraticSendBtn');
      sendBtn.addEventListener('click', () => self._handleSend());

      this._inputEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          self._handleSend();
        }
      });

      this._card.querySelector('#socraticEndBtn').addEventListener('click', () => {
        self._handleEndClick();
      });

      this._escHandler = (e) => {
        if (e.key === 'Escape') self._handleEndClick();
      };
      document.addEventListener('keydown', this._escHandler);
    }

    /** End/close button: if the session is already done & saved, just close;
     *  otherwise ask for confirmation before ending early. */
    _handleEndClick() {
      if (this._sessionSaved) {
        this._close();
        return;
      }
      this._show2ndConfirm();
    }

    async _handleSend() {
      const text = this._inputEl.value.trim();
      if (!text) return;
      this._inputEl.value = '';
      this._appendUserBubble(text);
      this.turns.push({ role: 'user', content: text });
      this.notebookCards.push({ type: 'a', content: text });
      await this._sendTutorTurn(text);
    }

    async _sendTutorTurn(userAnswer = null) {
      // Show loading
      const loadingEl = this._appendLoadingBubble();
      try {
        const resp = await window.__TAURI__.core.invoke('socratic_chat', {
          projectPath: this.projectPath,
          conceptTitles: this.concept_titles,
          conceptEdges: this.concept_edges,
          userAnswer: userAnswer,
          sessionId: this.sessionId
        });
        loadingEl.remove();
        // Capture / refresh the SDK session id so subsequent turns resume it
        if (resp.session_id) this.sessionId = resp.session_id;
        this.turns.push({ role: 'tutor', content: resp.content });
        this.notebookCards.push({ type: 'q', content: resp.content });
        this._appendTutorBubble(resp.content);
        if (resp.done) {
          this.llmDone = true;
          await this._handleLLMDone();
        }
      } catch (e) {
        loadingEl.remove();
        const friendlyError = '暂时无法连接：' + (e?.message || (typeof e === 'string' ? e : '') || '未知错误') + '。请稍后重试。';
        this.turns.push({ role: 'tutor', content: friendlyError });
        this.notebookCards.push({ type: 'error', content: friendlyError });
        this._appendTutorBubble(friendlyError);
      }
    }

    _appendTutorBubble(content) {
      const el = document.createElement('div');
      el.className = 'socratic-bubble-row';
      el.innerHTML = `
        <div class="socratic-avatar-tutor">🏛️</div>
        <div class="socratic-bubble-tutor">${escapeHtml(content)}</div>
      `;
      this._chatEl.appendChild(el);
      this._chatEl.scrollTop = this._chatEl.scrollHeight;
    }

    _appendUserBubble(content) {
      const el = document.createElement('div');
      el.className = 'socratic-bubble-row-user';
      el.innerHTML = `
        <div class="socratic-bubble-user">${escapeHtml(content)}</div>
        <div class="socratic-avatar-user">我</div>
      `;
      this._chatEl.appendChild(el);
      this._chatEl.scrollTop = this._chatEl.scrollHeight;
    }

    _appendLoadingBubble() {
      const el = document.createElement('div');
      el.className = 'socratic-bubble-row';
      el.innerHTML = `
        <div class="socratic-avatar-tutor">🏛️</div>
        <div class="socratic-bubble-loading">思考中...</div>
      `;
      this._chatEl.appendChild(el);
      this._chatEl.scrollTop = this._chatEl.scrollHeight;
      return el;
    }

    _show2ndConfirm() {
      const self = this;
      const confirmText = '确定提前结束？对话仍会保存';
      this.confirmDialog = { text: confirmText };

      // Use native confirm for simplicity
      if (window.confirm(confirmText)) {
        this.confirmEnd();
      } else {
        this.confirmDialog = null;
      }
    }

    async _handleLLMDone() {
      this.showDoneCard();
      this._appendDoneCard();
      // Persist now, but keep the modal open so the user reads at their own pace.
      // No auto-close — the dialogue is over; the user closes when ready.
      await this._persistSession('llm_done');
      this._lockInput();
    }

    /** Disable input after the dialogue ends; relabel end button to "关闭" */
    _lockInput() {
      if (this._inputEl) this._inputEl.disabled = true;
      const sendBtn = this._card && this._card.querySelector('#socraticSendBtn');
      if (sendBtn) sendBtn.disabled = true;
      const endBtn = this._card && this._card.querySelector('#socraticEndBtn');
      if (endBtn) endBtn.textContent = '关闭';
    }

    _appendDoneCard() {
      const el = document.createElement('div');
      el.className = 'socratic-done-card';
      el.innerHTML = `
        <div class="socratic-done-icon">✨</div>
        <div class="socratic-done-title">本次 Socratic 复习完成</div>
        <div class="socratic-done-subtitle">对话已保存到 .learning/socratic-sessions/</div>
      `;
      this._chatEl.insertBefore(el, this._chatEl.firstChild);
    }

    _close() {
      if (this._overlay) this._overlay.remove();
      if (this._escHandler) document.removeEventListener('keydown', this._escHandler);
      this.opened = false;
    }

    /** Append a tutor message (from LLM) */
    addTutorMessage(content) {
      this.turns.push({ role: 'tutor', content });
      this.notebookCards.push({ type: 'q', content });
    }

    /** Append a user message */
    addUserMessage(content) {
      this.turns.push({ role: 'user', content });
      this.notebookCards.push({ type: 'a', content });
    }

    /** Render the "done" card at top of chat */
    showDoneCard() {
      this.doneCardShown = true;
      this.notebookCards.push({ type: 'done', content: '本次 Socratic 复习完成' });
    }

    /** User requested end — show 2nd confirm */
    requestEnd() {
      this.confirmDialog = { text: '确定提前结束？对话仍会保存' };
    }

    /** User confirmed end after 2nd confirm */
    async confirmEnd() {
      this.confirmDialog = null;
      await this.endSession('user_ended');
    }

    /** End the session (saves to disk, then closes) */
    async endSession(reason) {
      // Already persisted (e.g. llm_done) — just close.
      if (this._sessionSaved) {
        this._close();
        return;
      }
      const ok = await this._persistSession(reason);
      // On save failure, _persistSession shows the error and we keep the modal open.
      if (ok) this._close();
    }

    /** Persist the session to disk + update state. Returns true on success.
     *  Does NOT close the modal — callers decide. */
    async _persistSession(reason) {
      // Guard against double-save
      if (this._sessionSaved) return true;
      this._sessionSaved = true;

      this.endReason = reason;
      this.showDoneCard();

      if (!window.__TAURI__) {
        return true;
      }

      const session = {
        version: '1.0',
        started_at: this._startedAt || new Date().toISOString(),
        concept_ids: this.concept_ids,
        concept_titles: this.concept_titles,
        turns: this.turns,
        ended_at: new Date().toISOString(),
        end_reason: reason
      };

      try {
        await window.__TAURI__.core.invoke('socratic_save_session', {
          projectPath: this.projectPath,
          session
        });
      } catch (e) {
        console.error('[SocraticModal] save_session failed:', e);
        // Round 3: Don't close on save failure — let user see the error
        this.saveError = '保存失败：' + (e.message || '磁盘写入错误') + '。对话内容仍保留在内存中，可尝试再次结束。';
        this._appendTutorBubble(this.saveError);
        return false;
      }

      // Update socratic-state (last_socratic_at, recent_hashes)
      if (window.SocraticState) {
        try {
          const state = await window.SocraticState.load(this.projectPath);
          state.markSocraticDone(this.cluster?.cluster_hash);
          await state.save(this.projectPath);
        } catch (e) {
          console.warn('[SocraticModal] state update failed:', e);
        }
      }

      return true;
    }
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = String(text || '');
    return div.innerHTML;
  }

  window.SocraticModal = SocraticModal;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { SocraticModal };
  }
})();
