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
 *
 * Sprint 17: UI 外壳抽至 notebook-modal.js（本类 = 引擎：cluster 加载 /
 * tutor 对话 / 会话落盘），公共 API 与 DOM id 不变。
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

  // Sprint 17: UI 外壳依赖（浏览器由 index.html 先加载 notebook-modal.js；
  // Node 测试只 require 本文件，需兜底引入）
  if (!window.NotebookModal && typeof require !== 'undefined') {
    try {
      window.NotebookModal = require('./notebook-modal.js').NotebookModal;
    } catch (_) { /* browser path — script tag provides it */ }
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

      // Render UI（Sprint 17: 外壳在 notebook-modal.js，id 与拆分前一致）
      this._renderDOM();
      this._bindEvents();

      // Auto-trigger first tutor question
      await this._sendTutorTurn();
    }

    /** Build the V2 Notebook modal DOM（Sprint 17: 委托 NotebookModal 外壳） */
    _renderDOM() {
      const chipsHtml = this.concept_titles.length > 0
        ? this.concept_titles.map((t, i) =>
            `<span class="socratic-chip ${i === 0 ? 'socratic-chip-primary' : ''}">#${t}</span>`
          ).join('')
        : '<span class="socratic-chip-fallback">无概念（KG 稀疏 fallback）</span>';

      this._shell = new window.NotebookModal({
        prefix: 'socratic',
        icon: '🏛️',
        title: 'Socratic 复习',
        subtitle: `本场概念: ${this.concept_titles.join(' · ') || '—'}`,
        chipsHtml,
        placeholder: '🧑‍🏫 等待 tutor 第一问...',
        tutorAvatar: '🏛️'
      });
      this._shell.render();
      this._chatEl = this._shell.chatEl;
      this._inputEl = this._shell.inputEl;
      this._card = this._shell._card;
    }

    /** 外壳获取（懒初始化）：open() 正常路径用 render 后的真外壳；
     *  单测直接构造未 render 时，桥接旧字段（_chatEl 等测试注入）建 headless 外壳。 */
    _getShell() {
      if (!this._shell) {
        this._shell = new window.NotebookModal({ prefix: 'socratic', tutorAvatar: '🏛️' });
        this._shell._chatEl = this._chatEl || null;
        this._shell._inputEl = this._inputEl || null;
        this._shell._card = this._card || null;
      }
      return this._shell;
    }

    _bindEvents() {
      this._getShell().bindEvents({
        onSend: () => this._handleSend(),
        onEndClick: () => this._handleEndClick()
      });
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
      const text = this._getShell().takeInput();
      if (!text) return;
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
      this._getShell().appendTutorBubble(content);
    }

    _appendUserBubble(content) {
      this._getShell().appendUserBubble(content);
    }

    _appendLoadingBubble() {
      return this._getShell().appendLoadingBubble();
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
      this._getShell().lockInput();
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
      this._getShell().close();
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

  window.SocraticModal = SocraticModal;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { SocraticModal };
  }
})();
