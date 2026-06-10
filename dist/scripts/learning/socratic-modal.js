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
      this.turns = [];
      this.notebookCards = [];
      this.opened = false;
      this.llmDone = false;
      this.doneCardShown = false;
      this.confirmDialog = null;
      this.endReason = null;
      this._startedAt = null;
      this._endConfirmShown = false;
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
      } catch (e) {
        console.error('[SocraticModal] cluster select failed:', e);
        // Fallback: empty cluster, but still open (sparse KG)
        this.cluster = { concepts: [], edges: [], cluster_hash: 'empty' };
      }
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

    /** End the session (saves to disk) */
    async endSession(reason) {
      this.endReason = reason;
      this.showDoneCard();

      if (!window.__TAURI__) {
        this.opened = false;
        return;
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

      this.opened = false;
    }
  }

  window.SocraticModal = SocraticModal;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { SocraticModal };
  }
})();
