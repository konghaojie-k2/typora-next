/**
 * Knowledge Graph Dashboard Modal
 * Shows project stats + concept dependency graph + action buttons.
 * Pops up every time user enters a learning project.
 *
 * Sprint 4: 知识图谱仪表盘
 */

(function() {
  'use strict';

  if (typeof window === 'undefined') return;

  // Shared constants (from knowledge-graph-manager.js)
  const CONSTANTS = window.KNOWLEDGE_GRAPH_CONSTANTS || {};
  const STATUS_LABELS = CONSTANTS.STATUS_LABELS || {
    mastered: '已掌握', learning: '学习中', struggling: '困难', not_started: '未开始'
  };
  const STATUS_COLORS = CONSTANTS.STATUS_COLORS || {
    mastered: '#10b981', learning: '#f59e0b', struggling: '#ef4444', not_started: '#6b7280'
  };

  class KnowledgeGraphDashboard {
    constructor(options) {
      this.state = 'hidden';
      this.onEnterReading = (options && options.onEnterReading) || (() => {});
      this.onClose = (options && options.onClose) || (() => {});
      this._overlay = null;
      this._drawer = null;
      this._data = null;
      this._escHandler = null;
    }

    getState() { return this.state; }

    /**
     * Show dashboard modal
     * @param {Object} data - { graph, stats, chapters, projectName }
     */
    show(data) {
      if (this.state === 'visible') {
        this.close();
      }
      this._data = data;
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
      overlay.className = 'kg-dashboard-overlay';

      const modal = document.createElement('div');
      modal.className = 'kg-dashboard-modal';

      // Header
      const header = this._createHeader(data.projectName);
      modal.appendChild(header);

      // Stats row (only if graph exists)
      if (data.stats) {
        const stats = this._createStats(data.stats);
        modal.appendChild(stats);
      }

      // Content area: graph or chapter list
      if (data.graph) {
        const canvas = this._createGraphCanvas(data.graph);
        modal.appendChild(canvas);
      } else if (data.chapters) {
        const list = this._createChapterList(data.chapters);
        modal.appendChild(list);
      }

      // Action buttons
      const actions = this._createActions(data);
      modal.appendChild(actions);

      overlay.appendChild(modal);
      document.body.appendChild(overlay);
      this._overlay = overlay;
    }

    _createHeader(projectName) {
      const header = document.createElement('div');
      header.className = 'kg-dashboard-header';

      const title = document.createElement('h2');
      title.className = 'kg-dashboard-title';
      title.textContent = projectName || '学习项目';
      header.appendChild(title);

      return header;
    }

    _createStats(stats) {
      const row = document.createElement('div');
      row.className = 'kg-stats-row';

      const items = [
        { key: 'total', label: '总概念', value: stats.total, color: '#a3a0fb' },
        { key: 'mastered', label: '已掌握', value: stats.mastered, color: '#047857' },
        { key: 'learning', label: '学习中', value: stats.learning, color: '#b45309' },
        { key: 'struggling', label: '困难', value: stats.struggling, color: '#b91c1c' },
        { key: 'not-started', label: '未开始', value: stats.notStarted, color: '#7c3aed' }
      ];

      for (const item of items) {
        const el = document.createElement('div');
        el.className = 'kg-stat-item';
        el.setAttribute('data-stat', item.key);

        const num = document.createElement('span');
        num.className = 'kg-stat-number';
        num.textContent = String(item.value);
        num.style.color = item.color;
        num.style.textShadow = `0 0 20px ${item.color}33`;

        const label = document.createElement('span');
        label.className = 'kg-stat-label';
        label.textContent = item.label;

        el.appendChild(num);
        el.appendChild(label);
        row.appendChild(el);
      }

      return row;
    }

    _createGraphCanvas(graph) {
      const canvas = document.createElement('div');
      canvas.className = 'kg-graph-canvas';

      if (typeof d3 === 'undefined') {
        canvas.textContent = 'D3 未加载，无法渲染图谱';
        return canvas;
      }

      this._renderD3Graph(canvas, graph);
      return canvas;
    }

    _renderD3Graph(container, graph) {
      const width = container.clientWidth || 700;
      const height = 400;
      const nodes = (graph.nodes || []).map(n => ({ ...n }));
      const edges = (graph.edges || []).map(e => ({ source: e.from, target: e.to }));

      // Build adjacency for hover highlight
      const connected = {};
      for (const node of nodes) connected[node.id] = new Set();
      for (const e of edges) {
        connected[e.source]?.add(e.target);
        connected[e.target]?.add(e.source);
      }

      // Use shared STATUS_COLORS from outer scope
      const STATUS_BG = {
        mastered: '#a7f3d0',
        learning: '#fde68a',
        struggling: '#fecaca',
        not_started: '#a3a0fb'
      };

      // Create SVG with zoom/pan
      const svg = d3.select(container)
        .append('svg')
        .attr('width', '100%')
        .attr('height', height)
        .attr('viewBox', `0 0 ${width} ${height}`);

      // Zoom behavior
      const zoomGroup = svg.append('g');
      svg.call(d3.zoom()
        .scaleExtent([0.3, 3])
        .on('zoom', (e) => zoomGroup.attr('transform', e.transform))
      );

      // Arrow marker for directed edges
      svg.append('defs').append('marker')
        .attr('id', 'kg-arrow')
        .attr('viewBox', '0 -5 10 10')
        .attr('refX', 20)
        .attr('refY', 0)
        .attr('markerWidth', 6)
        .attr('markerHeight', 6)
        .attr('orient', 'auto')
        .append('path')
        .attr('d', 'M0,-4L10,0L0,4')
        .attr('fill', '#94a3b8');

      // Force simulation
      const simulation = d3.forceSimulation(nodes)
        .force('link', d3.forceLink(edges).id(d => d.id).distance(80))
        .force('charge', d3.forceManyBody().strength(-200))
        .force('center', d3.forceCenter(width / 2, height / 2))
        .force('collision', d3.forceCollide().radius(30));

      // Edge lines
      const link = zoomGroup.append('g')
        .selectAll('line')
        .data(edges)
        .join('line')
        .attr('stroke', '#475569')
        .attr('stroke-width', 1.5)
        .attr('marker-end', 'url(#kg-arrow)');

      // Node groups
      const nodeGroup = zoomGroup.append('g')
        .selectAll('g')
        .data(nodes)
        .join('g')
        .attr('cursor', 'pointer')
        .call(d3.drag()
          .on('start', (e, d) => {
            if (!e.active) simulation.alphaTarget(0.3).restart();
            d.fx = d.x; d.fy = d.y;
          })
          .on('drag', (e, d) => { d.fx = e.x; d.fy = e.y; })
          .on('end', (e, d) => {
            if (!e.active) simulation.alphaTarget(0);
            d.fx = null; d.fy = null;
          })
        );

      // Node circles
      nodeGroup.append('circle')
        .attr('r', 8)
        .attr('fill', d => STATUS_BG[d.node_status] || STATUS_BG.not_started)
        .attr('stroke', d => STATUS_COLORS[d.node_status] || STATUS_COLORS.not_started)
        .attr('stroke-width', 2);

      // Node labels (color matches status)
      nodeGroup.append('text')
        .text(d => d.name)
        .attr('dx', 12)
        .attr('dy', 4)
        .attr('font-size', '12px')
        .attr('font-weight', 500)
        .attr('fill', d => STATUS_COLORS[d.node_status] || STATUS_COLORS.not_started)
        .attr('font-family', '-apple-system, BlinkMacSystemFont, sans-serif');

      // Hover highlight
      nodeGroup
        .on('mouseenter', (e, d) => {
          const adj = connected[d.id] || new Set();
          nodeGroup.select('circle')
            .attr('opacity', n => (n.id === d.id || adj.has(n.id)) ? 1 : 0.15)
            .attr('r', n => n.id === d.id ? 10 : 8);
          nodeGroup.select('text')
            .attr('opacity', n => (n.id === d.id || adj.has(n.id)) ? 1 : 0.15)
            .attr('font-weight', n => n.id === d.id ? 700 : 500);
          link.attr('opacity', l => (l.source.id === d.id || l.target.id === d.id) ? 1 : 0.08)
            .attr('stroke-width', l => (l.source.id === d.id || l.target.id === d.id) ? 2 : 1.5);
        })
        .on('mouseleave', () => {
          nodeGroup.select('circle').attr('opacity', 1).attr('r', 8);
          nodeGroup.select('text').attr('opacity', 1).attr('font-weight', 500);
          link.attr('opacity', 1).attr('stroke-width', 1.5);
        });

      // Click → open drawer
      nodeGroup.on('click', (e, d) => {
        this._openDrawer(d);
      });

      // Tick update
      simulation.on('tick', () => {
        link
          .attr('x1', d => d.source.x)
          .attr('y1', d => d.source.y)
          .attr('x2', d => d.target.x)
          .attr('y2', d => d.target.y);
        nodeGroup.attr('transform', d => `translate(${d.x},${d.y})`);
      });
    }

    _createChapterList(chapters) {
      const list = document.createElement('div');
      list.className = 'kg-chapter-list';

      for (const chapter of chapters) {
        const item = document.createElement('div');
        item.className = 'kg-chapter-item';
        item.textContent = chapter.title || chapter.file;

        item.addEventListener('click', () => {
          this.onEnterReading(chapter.file || chapter);
        });

        list.appendChild(item);
      }

      return list;
    }

    _createActions(data) {
      const actions = document.createElement('div');
      actions.className = 'kg-actions';

      // Enter reading button
      const enterBtn = document.createElement('button');
      enterBtn.className = 'kg-action-btn kg-action-primary';
      enterBtn.setAttribute('data-action', 'enter-reading');
      enterBtn.textContent = '进入阅读';
      enterBtn.addEventListener('click', () => {
        this.onEnterReading();
      });
      actions.appendChild(enterBtn);

      // Close button
      const closeBtn = document.createElement('button');
      closeBtn.className = 'kg-action-btn';
      closeBtn.setAttribute('data-action', 'close');
      closeBtn.textContent = '关闭';
      closeBtn.addEventListener('click', () => {
        this.close();
      });
      actions.appendChild(closeBtn);

      return actions;
    }

    // --- Detail drawer ---

    _openDrawer(node) {
      this._closeDrawer();

      const drawer = document.createElement('div');
      drawer.className = 'kg-detail-drawer';

      // Close button
      const closeBtn = document.createElement('button');
      closeBtn.className = 'kg-detail-close';
      closeBtn.textContent = '×';
      closeBtn.addEventListener('click', () => this._closeDrawer());
      drawer.appendChild(closeBtn);

      // Concept name
      const name = document.createElement('h3');
      name.className = 'kg-detail-name';
      name.textContent = node.name;
      drawer.appendChild(name);

      // Status
      const status = document.createElement('div');
      status.className = 'kg-detail-status';
      status.textContent = STATUS_LABELS[node.node_status] || '未开始';
      drawer.appendChild(status);

      // Chapter
      const chapter = document.createElement('div');
      chapter.className = 'kg-detail-chapter';
      chapter.textContent = '章节: ' + (node.chapter || '未知');
      drawer.appendChild(chapter);

      // Append to modal
      const modal = this._overlay && this._overlay.querySelector('.kg-dashboard-modal');
      if (modal) modal.appendChild(drawer);
      this._drawer = drawer;
    }

    _closeDrawer() {
      if (this._drawer) {
        this._drawer.remove();
        this._drawer = null;
      }
    }

    // --- DOM teardown ---

    _removeDOM() {
      this._closeDrawer();
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

  window.KnowledgeGraphDashboard = KnowledgeGraphDashboard;
})();
