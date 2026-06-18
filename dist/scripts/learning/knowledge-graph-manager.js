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
     * Compute stats from graph nodes (each node has node_status baked in)
     * @param {Object} graph - { nodes, edges }
     * @returns {Object} { total, mastered, learning, struggling, notStarted }
     */
    computeStats(graph) {
      const nodes = (graph && graph.nodes) || [];
      const stats = { total: nodes.length, mastered: 0, learning: 0, struggling: 0, notStarted: 0 };
      for (const node of nodes) {
        const status = node.node_status || 'not_started';
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
     * Pass-through: graph nodes already have node_status.
     * Method kept for backward compatibility with callers.
     * @param {Object} graph - { nodes, edges }
     * @returns {Object} graph unchanged
     */
    mergeReviewStatus(graph) {
      return graph;
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

    _buildLookup(_projectChapters) {
      // No-op: status is now on each graph node (node_status).
      // Kept for backward compatibility.
      return { status: {}, count: {} };
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
