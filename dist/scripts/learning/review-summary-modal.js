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

      if (!changes || changes.length === 0) {
        container.textContent = '本次复习无状态变化';
        return container;
      }

      // Build concept -> node id mapping (fuzzy match)
      const conceptToId = new Map();
      const idToConcept = new Map();
      for (const change of changes) {
        const concept = change.concept;
        let matchedId = null;
        for (const node of (graph && graph.nodes) || []) {
          if (node.name === concept || node.name.includes(concept) || concept.includes(node.name)) {
            matchedId = node.id;
            break;
          }
        }
        if (!matchedId) {
          matchedId = 'syn-' + concept.replace(/[^一-龥a-zA-Z0-9]/g, '-');
        }
        conceptToId.set(concept, matchedId);
        idToConcept.set(matchedId, concept);
      }

      // Find edges between these concepts
      const edgePairs = [];
      for (const edge of (graph && graph.edges) || []) {
        const fromConcept = idToConcept.get(edge.from);
        const toConcept = idToConcept.get(edge.to);
        if (fromConcept && toConcept && fromConcept !== toConcept) {
          edgePairs.push([fromConcept, toConcept]);
        }
      }

      // Create SVG graph
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('width', '100%');
      svg.setAttribute('height', '200');
      svg.style.display = 'block';
      svg.setAttribute('viewBox', '0 0 456 200');

      const concepts = changes.map(c => c.concept);
      const centerX = 228;
      const centerY = 85;
      const radius = Math.min(456, 200) * 0.35;

      // Position nodes in a circle
      const positions = {};
      concepts.forEach((concept, i) => {
        const angle = (i / concepts.length) * 2 * Math.PI - Math.PI / 2;
        positions[concept] = {
          x: centerX + radius * Math.cos(angle),
          y: centerY + radius * Math.sin(angle)
        };
      });

      // Draw edges first (behind nodes)
      for (const [from, to] of edgePairs) {
        const fromPos = positions[from];
        const toPos = positions[to];
        if (!fromPos || !toPos) continue;
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', fromPos.x);
        line.setAttribute('y1', fromPos.y);
        line.setAttribute('x2', toPos.x);
        line.setAttribute('y2', toPos.y);
        line.setAttribute('stroke', 'rgba(129,140,248,0.3)');
        line.setAttribute('stroke-width', '1.5');
        svg.appendChild(line);
      }

      // Draw nodes
      const updatedConcepts = new Set(changes.map(c => c.concept));
      for (const concept of concepts) {
        const pos = positions[concept];
        const isUpdated = updatedConcepts.has(concept);

        const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');

        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', pos.x);
        circle.setAttribute('cy', pos.y);
        circle.setAttribute('r', isUpdated ? 7 : 5);
        circle.setAttribute('fill', isUpdated ? 'rgba(129,140,248,0.25)' : 'rgba(148,163,184,0.15)');
        circle.setAttribute('stroke', isUpdated ? '#818cf8' : 'rgba(148,163,184,0.4)');
        circle.setAttribute('stroke-width', '2');
        g.appendChild(circle);

        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', pos.x);
        text.setAttribute('y', pos.y + 18);
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('fill', 'var(--color-text-secondary)');
        text.setAttribute('font-size', '9');
        text.textContent = concept.length > 6 ? concept.substring(0, 5) + '..' : concept;
        g.appendChild(text);

        svg.appendChild(g);
      }

      container.appendChild(svg);
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
