#!/usr/bin/env node
// -*- coding: utf-8 -*-
/**
 * TDD Tests for Knowledge Graph Manager
 * Covers: freshness check, graph loading, stats computation, node color mapping,
 * review status merge, edge validation.
 *
 * Module: dist/scripts/learning/knowledge-graph-manager.js
 *
 * BDD Scenarios covered:
 * - 知识图谱按需生成 (freshness check)
 * - 已生成但未学习的仪表盘 (stats + not-started colors)
 * - 用户在仪表盘点击概念节点 (node data with status)
 * - 复习完成后展示掌握状态变化 (status merge from review-schedule)
 */

const TestRunner = require('../../shared/test-runner');

// ============================================
// Mock: Tauri invoke + fs
// ============================================

let lastInvokeCmd = null;
let lastInvokeArgs = null;
let mockFilesystem = {};  // path → { content, mtime }
let mockInvokeResults = {};  // cmd → return value

function setupEnv() {
  mockFilesystem = {};
  lastInvokeCmd = null;
  lastInvokeArgs = null;
  mockInvokeResults = {};

  if (typeof global.window === 'undefined') global.window = {};
  if (typeof global.document === 'undefined') {
    global.document = {
      createElement: () => ({}),
      body: { appendChild: () => {}, removeChild: () => {} }
    };
  }

  global.window.__TAURI__ = {
    core: {
      invoke: (cmd, args) => {
        lastInvokeCmd = cmd;
        lastInvokeArgs = args;
        if (cmd in mockInvokeResults) {
          return Promise.resolve(mockInvokeResults[cmd]);
        }
        return Promise.resolve();
      }
    },
    fs: {
      exists: (path) => Promise.resolve(path in mockFilesystem),
      stat: (path) => {
        if (!(path in mockFilesystem)) return Promise.reject(new Error('ENOENT'));
        return Promise.resolve({ mtime: mockFilesystem[path].mtime });
      },
      readTextFile: (path) => {
        if (!(path in mockFilesystem)) return Promise.reject(new Error('ENOENT'));
        return Promise.resolve(mockFilesystem[path].content);
      }
    }
  };
}

function loadModule() {
  const path = require('path');
  const modPath = path.join(__dirname, '../../../dist/scripts/learning/knowledge-graph-manager.js');
  try {
    const resolved = require.resolve(modPath);
    delete require.cache[resolved];
    require(modPath);
  } catch (e) {
    // Module doesn't exist yet — expected in TDD red phase
    return null;
  }
  return window.KnowledgeGraphManager;
}

// ============================================
// Helper: create mock graph data
// ============================================

function makeGraph(nodes, edges) {
  return JSON.stringify({
    version: '1.0',
    generated_at: '2026-06-06 12:00:00',
    nodes: nodes.map(([id, name, chapter]) => ({ id, name, chapter })),
    edges: edges.map(([from, to]) => ({ from, to }))
  });
}

function makeGraphWithStatus(items) {
  // items: [[id, name, chapter, status], ...]
  // Returns knowledge-graph.json object with nodes carrying node_status
  return {
    version: '1.0',
    generated_at: '2026-06-06 12:00:00',
    nodes: items.map(([id, name, chapter, status]) => ({
      id, name, chapter, node_status: status || 'not_started'
    })),
    edges: []
  };
}

// ============================================
// Test: Module loading
// ============================================

TestRunner.test('KnowledgeGraphManager module loads', () => {
  setupEnv();
  const KGM = loadModule();
  if (!KGM) {
    throw new Error('Module not found: dist/scripts/learning/knowledge-graph-manager.js (expected in TDD red phase)');
  }
  TestRunner.assertExists(KGM, 'KnowledgeGraphManager should be exported on window');
});

// ============================================
// Test: Freshness check
// ============================================

TestRunner.test('needsRebuild: returns true when Rust says rebuild needed', async () => {
  setupEnv();
  mockInvokeResults['check_graph_freshness'] = true;
  const KGM = loadModule();
  if (!KGM) return;

  const mgr = new KGM('/project');
  const result = await mgr.needsRebuild();
  TestRunner.assertEquals(result, true, 'should need rebuild');
  TestRunner.assertEquals(lastInvokeCmd, 'check_graph_freshness', 'should call Rust command');
  TestRunner.assertEquals(lastInvokeArgs.projectPath, '/project', 'should pass projectPath');
});

TestRunner.test('needsRebuild: returns false when graph is fresh', async () => {
  setupEnv();
  mockInvokeResults['check_graph_freshness'] = false;
  const KGM = loadModule();
  if (!KGM) return;

  const mgr = new KGM('/project');
  const result = await mgr.needsRebuild();
  TestRunner.assertEquals(result, false, 'should not need rebuild');
});

// ============================================
// Test: buildGraph (calls Rust command)
// ============================================

TestRunner.test('buildGraph: invokes build_knowledge_graph with project_path', async () => {
  setupEnv();
  const KGM = loadModule();
  if (!KGM) return;

  const mgr = new KGM('/project');
  await mgr.buildGraph();

  TestRunner.assertEquals(lastInvokeCmd, 'build_knowledge_graph', 'should invoke Rust command');
  TestRunner.assertEquals(lastInvokeArgs.projectPath, '/project', 'should pass projectPath');
});

// ============================================
// Test: loadGraph
// ============================================

TestRunner.test('loadGraph: parses graph.json and returns nodes + edges', async () => {
  setupEnv();
  const graphData = makeGraph(
    [['attn', '注意力机制', '01'], ['pos-enc', '位置编码', '02']],
    [['attn', 'pos-enc']]
  );
  mockFilesystem['/project/.learning/knowledge-graph.json'] = {
    content: graphData,
    mtime: new Date()
  };

  const KGM = loadModule();
  if (!KGM) return;

  const mgr = new KGM('/project');
  const graph = await mgr.loadGraph();

  TestRunner.assertEquals(graph.nodes.length, 2, 'should have 2 nodes');
  TestRunner.assertEquals(graph.edges.length, 1, 'should have 1 edge');
  TestRunner.assertEquals(graph.nodes[0].id, 'attn', 'first node id');
  TestRunner.assertEquals(graph.edges[0].from, 'attn', 'edge from');
  TestRunner.assertEquals(graph.edges[0].to, 'pos-enc', 'edge to');
});

TestRunner.test('loadGraph: returns null when graph.json does not exist', async () => {
  setupEnv();
  const KGM = loadModule();
  if (!KGM) return;

  const mgr = new KGM('/project');
  const graph = await mgr.loadGraph();
  TestRunner.assertEquals(graph, null, 'should return null when no graph');
});

// ============================================
// Test: computeStats
// ============================================

TestRunner.test('computeStats: counts concepts by status from node.node_status', () => {
  setupEnv();
  const KGM = loadModule();
  if (!KGM) return;

  const graph = makeGraphWithStatus([
    ['a', 'A', '01', 'mastered'],
    ['b', 'B', '01', 'learning'],
    ['c', 'C', '02', 'struggling'],
    ['d', 'D', '02', 'not_started']
  ]);

  const mgr = new KGM('/project');
  const stats = mgr.computeStats(graph);

  TestRunner.assertEquals(stats.total, 4, 'total concepts');
  TestRunner.assertEquals(stats.mastered, 1, 'mastered count');
  TestRunner.assertEquals(stats.learning, 1, 'learning count');
  TestRunner.assertEquals(stats.struggling, 1, 'struggling count');
  TestRunner.assertEquals(stats.notStarted, 1, 'not_started count');
});

TestRunner.test('computeStats: all not started when no node_status on nodes', () => {
  setupEnv();
  const KGM = loadModule();
  if (!KGM) return;

  const graph = {
    nodes: [
      { id: 'a', name: 'A', chapter: '01' },  // no node_status
      { id: 'b', name: 'B', chapter: '01' }   // no node_status
    ],
    edges: []
  };

  const mgr = new KGM('/project');
  const stats = mgr.computeStats(graph);

  TestRunner.assertEquals(stats.total, 2, 'total');
  TestRunner.assertEquals(stats.notStarted, 2, 'all not started (no node_status)');
});

// ============================================
// Test: getNodeColor
// ============================================

TestRunner.test('getNodeColor: returns correct color for each status', () => {
  setupEnv();
  const KGM = loadModule();
  if (!KGM) return;

  const mgr = new KGM('/project');
  TestRunner.assertEquals(mgr.getNodeColor('mastered'), '#047857', 'mastered → emerald');
  TestRunner.assertEquals(mgr.getNodeColor('learning'), '#b45309', 'learning → amber');
  TestRunner.assertEquals(mgr.getNodeColor('struggling'), '#b91c1c', 'struggling → red');
  TestRunner.assertEquals(mgr.getNodeColor('not_started'), '#7c3aed', 'not_started → purple');
  TestRunner.assertEquals(mgr.getNodeColor(null), '#7c3aed', 'null → purple');
  TestRunner.assertEquals(mgr.getNodeColor(undefined), '#7c3aed', 'undefined → purple');
});

// ============================================
// Test: mergeReviewStatus
// ============================================

TestRunner.test('mergeReviewStatus: returns graph unchanged (status already on nodes)', () => {
  setupEnv();
  const KGM = loadModule();
  if (!KGM) return;

  const graph = makeGraphWithStatus([
    ['attn', '注意力机制', '01', 'mastered'],
    ['pos-enc', '位置编码', '02', 'learning']
  ]);

  const mgr = new KGM('/project');
  const merged = mgr.mergeReviewStatus(graph);

  // Pass-through: nodes already have node_status from the graph file
  TestRunner.assertEquals(merged.nodes[0].node_status, 'mastered', 'first node mastered (preserved)');
  TestRunner.assertEquals(merged.nodes[1].node_status, 'learning', 'second node learning (preserved)');
});

// ============================================
// Test: Edge validation
// ============================================

TestRunner.test('validateEdges: edges reference existing nodes', () => {
  setupEnv();
  const KGM = loadModule();
  if (!KGM) return;

  const graph = {
    nodes: [
      { id: 'a', name: 'A', chapter: '01' },
      { id: 'b', name: 'B', chapter: '02' }
    ],
    edges: [
      { from: 'a', to: 'b' },
      { from: 'a', to: 'nonexistent' }  // invalid
    ]
  };

  const mgr = new KGM('/project');
  const valid = mgr.validateEdges(graph);

  TestRunner.assertEquals(valid.length, 1, 'should filter out invalid edges');
  TestRunner.assertEquals(valid[0].from, 'a', 'valid edge from');
  TestRunner.assertEquals(valid[0].to, 'b', 'valid edge to');
});

// ============================================
// Test: getChapterList
// ============================================

TestRunner.test('getChapterList: extracts unique chapters from graph', () => {
  setupEnv();
  const KGM = loadModule();
  if (!KGM) return;

  const graph = {
    nodes: [
      { id: 'a', name: 'A', chapter: '01' },
      { id: 'b', name: 'B', chapter: '01' },
      { id: 'c', name: 'C', chapter: '02' }
    ],
    edges: []
  };

  const mgr = new KGM('/project');
  const chapters = mgr.getChapterList(graph);

  TestRunner.assertEquals(chapters.length, 2, '2 unique chapters');
  TestRunner.assert(chapters.includes('01'), 'has chapter 01');
  TestRunner.assert(chapters.includes('02'), 'has chapter 02');
});

// ============================================
// Run
// ============================================

TestRunner.run().then(({ passed, failed }) => {
  if (failed > 0) process.exit(1);
});
