/**
 * Review Summary Modal
 * Post-review completion modal: shows concept status changes + mini knowledge graph.
 *
 * Sprint 4: 复习完成摘要
 */

(function() {
  'use strict';

  if (typeof window === 'undefined') return;

  // Shared constants (from knowledge-graph-manager.js)
  const CONSTANTS = window.KNOWLEDGE_GRAPH_CONSTANTS || {};
  const STATUS_LABELS = CONSTANTS.STATUS_LABELS || {
    mastered: '已掌握', learning: '学习中', struggling: '困难', not_started: '未开始'
  };
  const STATUS_RANK = CONSTANTS.STATUS_RANK || { not_started: 0, struggling: 1, learning: 2, mastered: 3 };

  class ReviewSummaryModal {
    constructor(options) {
      this.state = 'hidden';
      this.onViewFullGraph = (options && options.onViewFullGraph) || (() => {});
      this.onClose = (options && options.onClose) || (() => {});
      this._overlay = null;
      this._escHandler = null;
    }

    getState() { return this.state; }

    /**
     * Show review summary modal
     * @param {Object} data - { reviewResult: { changes, reviewedCount, totalCount }, miniGraph }
     */
    show(data) {
      if (this.state === 'visible') return;
      this._createDOM(data);
      this.state = 'visible';
      this._bindESC();
    }

    close() {
      if (this.state === 'hidden') return;
      this._unbindESC();
      this._removeDOM();
      this.state = 'hidden';
      this.onClose();
    }

    // --- DOM construction ---

    _createDOM(data) {
      const overlay = document.createElement('div');
      overlay.className = 'review-summary-overlay';

      const modal = document.createElement('div');
      modal.className = 'review-summary-modal';

      // Header
      const header = document.createElement('div');
      header.className = 'review-summary-header';
      header.textContent = '复习完成';
      modal.appendChild(header);

      const result = data.reviewResult;
      const changes = (result && result.changes) || [];

      if (changes.length === 0) {
        // No changes
        const msg = document.createElement('div');
        msg.className = 'review-no-change';
        msg.textContent = '本次复习无状态变化';
        modal.appendChild(msg);
      } else {
        // Status change cards
        const cardList = document.createElement('div');
        cardList.className = 'review-change-list';

        for (const change of changes) {
          const card = this._createChangeCard(change);
          cardList.appendChild(card);
        }
        modal.appendChild(cardList);
      }

      // Mini knowledge graph
      if (data.miniGraph) {
        const miniGraph = this._createMiniGraph(data.miniGraph, changes);
        modal.appendChild(miniGraph);
      }

      // Action buttons
      const actions = this._createActions();
      modal.appendChild(actions);

      overlay.appendChild(modal);
      document.body.appendChild(overlay);
      this._overlay = overlay;
    }

    _createChangeCard(change) {
      const card = document.createElement('div');
      card.className = 'review-change-card';

      // Determine direction
      const fromRank = STATUS_RANK[change.fromStatus] || 0;
      const toRank = STATUS_RANK[change.toStatus] || 0;
      if (toRank > fromRank) {
        card.classList.add('status-improved');
      } else if (toRank < fromRank) {
        card.classList.add('status-regressed');
      }

      // Concept name
      const name = document.createElement('span');
      name.className = 'review-change-name';
      name.textContent = change.concept;
      card.appendChild(name);

      // Status arrow
      const arrow = document.createElement('span');
      arrow.className = 'review-change-arrow';
      const fromLabel = STATUS_LABELS[change.fromStatus] || change.fromStatus;
      const toLabel = STATUS_LABELS[change.toStatus] || change.toStatus;
      arrow.textContent = fromLabel + ' → ' + toLabel;
      card.appendChild(arrow);

      return card;
    }

    _createMiniGraph(graph, changes) {
      const container = document.createElement('div');
      container.className = 'review-mini-graph';

      // Track which concepts were updated
      const updatedConcepts = new Set(changes.map(c => c.concept));

      // Render nodes
      for (const node of (graph.nodes || [])) {
        const nodeEl = document.createElement('div');
        nodeEl.className = 'kg-mini-node';
        nodeEl.setAttribute('data-concept-id', node.id);

        if (updatedConcepts.has(node.name)) {
          nodeEl.classList.add('pulse');
          nodeEl.classList.add('updated');
        }

        nodeEl.textContent = node.name;
        container.appendChild(nodeEl);
      }

      return container;
    }

    _createActions() {
      const actions = document.createElement('div');
      actions.className = 'review-summary-actions';

      // View full graph button
      const graphBtn = document.createElement('button');
      graphBtn.className = 'review-action-btn review-action-primary';
      graphBtn.setAttribute('data-action', 'view-full-graph');
      graphBtn.textContent = '查看完整知识图谱';
      graphBtn.addEventListener('click', () => {
        this.onViewFullGraph();
      });
      actions.appendChild(graphBtn);

      // Close/done button
      const closeBtn = document.createElement('button');
      closeBtn.className = 'review-action-btn';
      closeBtn.setAttribute('data-action', 'close');
      closeBtn.textContent = '完成';
      closeBtn.addEventListener('click', () => {
        this.close();
      });
      actions.appendChild(closeBtn);

      return actions;
    }

    // --- DOM teardown ---

    _removeDOM() {
      if (this._overlay) {
        this._overlay.remove();
        this._overlay = null;
      }
    }

    // --- ESC key handling ---

    _bindESC() {
      this._escHandler = (e) => {
        if (e.key === 'Escape') this.close();
      };
      document.addEventListener('keydown', this._escHandler);
    }

    _unbindESC() {
      if (this._escHandler) {
        document.removeEventListener('keydown', this._escHandler);
        this._escHandler = null;
      }
    }
  }

  window.ReviewSummaryModal = ReviewSummaryModal;
})();
