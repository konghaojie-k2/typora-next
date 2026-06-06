/**
 * Knowledge Graph Manager
 * Data layer for knowledge graph: freshness check, loading, stats, status merge.
 *
 * Sprint 4: 知识图谱模块
 */

(function() {
  'use strict';

  if (typeof window === 'undefined') return;

  // Shared constants for knowledge graph modules
  const STATUS_COLORS = {
    mastered: '#047857',
    learning: '#b45309',
    struggling: '#b91c1c',
    not_started: '#7c3aed'
  };

  const STATUS_LABELS = {
    mastered: '已掌握',
    learning: '学习中',
    struggling: '困难',
    not_started: '未开始'
  };

  const STATUS_RANK = { not_started: 0, struggling: 1, learning: 2, mastered: 3 };

  class KnowledgeGraphManager {
    constructor(projectPath) {
      this.projectPath = projectPath;
      this._graphPath = projectPath + '/.learning/knowledge-graph.json';
    }

    /**
     * Check if knowledge-graph.json needs rebuild
     * Uses Rust command for reliable filesystem scanning
     * @returns {Promise<boolean>}
     */
    async needsRebuild() {
      const invoke = this._invoke();
      if (!invoke) return true;

      try {
        return await invoke('check_graph_freshness', { projectPath: this.projectPath });
      } catch (e) {
        return true; // any error → rebuild
      }
    }

    /**
     * Call Rust to build knowledge-graph.json
     * @returns {Promise<void>}
     */
    async buildGraph() {
      const invoke = this._invoke();
      if (!invoke) return;
      await invoke('build_knowledge_graph', { projectPath: this.projectPath });
    }

    /**
     * Load and parse knowledge-graph.json
     * @returns {Promise<Object|null>} graph with { version, generated_at, nodes, edges }
     */
    async loadGraph() {
      const fs = this._fs();
      if (!fs) return null;

      try {
        const exists = await fs.exists(this._graphPath);
        if (!exists) return null;
        const data = await fs.readTextFile(this._graphPath);
        return JSON.parse(data);
      } catch (e) {
        return null;
      }
    }

    /**
     * Compute stats from graph + review schedule
     * @param {Object} graph - { nodes, edges }
     * @param {Object|null} reviewSchedule - { items: [{ concept, status }] }
     * @returns {Object} { total, mastered, learning, struggling, notStarted }
     */
    computeStats(graph, reviewSchedule) {
      const nodes = (graph && graph.nodes) || [];
      const lookup = this._buildLookup(reviewSchedule);

      const stats = { total: nodes.length, mastered: 0, learning: 0, struggling: 0, notStarted: 0 };
      for (const node of nodes) {
        const status = lookup.status[node.name] || 'not_started';
        if (status === 'mastered') stats.mastered++;
        else if (status === 'learning') stats.learning++;
        else if (status === 'struggling') stats.struggling++;
        else stats.notStarted++;
      }
      return stats;
    }

    /**
     * Get CSS color for a review status
     * @param {string|null} status
     * @returns {string} hex color
     */
    getNodeColor(status) {
      return STATUS_COLORS[status] || STATUS_COLORS.not_started;
    }

    /**
     * Merge review status into graph nodes
     * @param {Object} graph - { nodes, edges }
     * @param {Object} reviewSchedule - { items: [{ concept, status, review_count }] }
     * @returns {Object} graph with status/reviewCount on each node
     */
    mergeReviewStatus(graph, reviewSchedule) {
      const lookup = this._buildLookup(reviewSchedule);

      const nodes = graph.nodes.map(node => ({
        ...node,
        status: lookup.status[node.name] || 'not_started',
        reviewCount: lookup.count[node.name] || 0
      }));

      return { ...graph, nodes };
    }

    /**
     * Filter edges to only those referencing existing nodes
     * @param {Object} graph - { nodes, edges }
     * @returns {Array} valid edges
     */
    validateEdges(graph) {
      const nodeIds = new Set(graph.nodes.map(n => n.id));
      return (graph.edges || []).filter(e => nodeIds.has(e.from) && nodeIds.has(e.to));
    }

    /**
     * Extract unique chapter list from graph
     * @param {Object} graph - { nodes }
     * @returns {string[]} unique chapter identifiers
     */
    getChapterList(graph) {
      const chapters = new Set();
      for (const node of (graph.nodes || [])) {
        chapters.add(node.chapter);
      }
      return [...chapters];
    }

    // --- Internal helpers ---

    _buildLookup(reviewSchedule) {
      const items = (reviewSchedule && reviewSchedule.items) || [];
      const status = {};
      const count = {};
      for (const item of items) {
        // Use last_rating as the mastery status (not schedule status like 'upcoming'/'due')
        const masteryStatus = (item.last_rating === 'mastered' || item.last_rating === 'learning' || item.last_rating === 'struggling')
          ? item.last_rating
          : (item.status === 'mastered' || item.status === 'learning' || item.status === 'struggling')
            ? item.status
            : 'not_started';
        status[item.concept] = masteryStatus;
        count[item.concept] = item.review_count || 0;
      }
      return { status, count };
    }

    _fs() {
      return window.__TAURI__ && window.__TAURI__.fs;
    }

    _invoke() {
      return window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke;
    }
  }

  window.KnowledgeGraphManager = KnowledgeGraphManager;
  window.KNOWLEDGE_GRAPH_CONSTANTS = { STATUS_COLORS, STATUS_LABELS, STATUS_RANK };
})();
