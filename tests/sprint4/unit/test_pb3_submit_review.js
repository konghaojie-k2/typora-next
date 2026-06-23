#!/usr/bin/env node
// -*- coding: utf-8 -*-
/**
 * TDD Tests for PB3: submit_review_result 三合一
 * Covers: review-history.json, node_status update, schedule update
 */
'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const TestRunner = require('../../shared/test-runner');

require('../../bdd-acceptance/mock-tauri');

// ============================================
// Helpers
// ============================================

function createTempProject() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pb3-test-'));
  const learningDir = path.join(tmpDir, '.learning');
  fs.mkdirSync(learningDir, { recursive: true });

  // Init review-schedule.json with concept-a
  fs.writeFileSync(path.join(learningDir, 'review-schedule.json'), JSON.stringify({
    version: '1.0',
    items: [{ concept: 'concept-a', source_chapter: '01-first.md', review_count: 0, last_reviewed: '', next_review_at: '2026-06-23 12:00:00', last_rating: 'learning', status: 'upcoming' }]
  }, null, 2), 'utf-8');

  // Init knowledge-graph.json
  fs.writeFileSync(path.join(learningDir, 'knowledge-graph.json'), JSON.stringify({
    version: '1.0', nodes: [{ id: 'concept-a', title: '概念A', node_status: 'learning' }], edges: []
  }, null, 2), 'utf-8');

  return tmpDir;
}

function readJSON(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

// ============================================
// Test: submit_review_result 三合一写入
// ============================================

TestRunner.test('[PB3] 提交 mastered → 三文件正确更新', async () => {
  const tmpDir = createTempProject();
  const learningDir = path.join(tmpDir, '.learning');

  await global.window.__TAURI__.core.invoke('submit_review_result', {
    projectPath: tmpDir, conceptId: 'concept-a', rating: 'mastered', answers: [{ question_id: 'q1', is_correct: true }]
  });

  // 1. review-schedule.json
  const schedule = readJSON(path.join(learningDir, 'review-schedule.json'));
  const item = schedule.items[0];
  TestRunner.assertEquals(item.review_count, 1, 'review_count should increment');
  TestRunner.assertEquals(item.last_rating, 'mastered', 'last_rating updated');
  TestRunner.assert(item.last_reviewed.length > 0, 'last_reviewed set');
  TestRunner.assertEquals(item.status, 'upcoming', 'status → upcoming');

  // 2. review-history.json
  const history = readJSON(path.join(learningDir, 'review-history.json'));
  TestRunner.assert(history, 'review-history.json should exist');
  TestRunner.assertEquals(history.version, '1.0', 'version correct');
  TestRunner.assertEquals(history.entries.length, 1, '1 entry');
  TestRunner.assertEquals(history.entries[0].concept_id, 'concept-a', 'concept_id correct');
  TestRunner.assertEquals(history.entries[0].correct, true, 'correct=true');
  TestRunner.assertEquals(history.entries[0].rating, 'mastered', 'rating mastered');
  TestRunner.assert(Array.isArray(history.entries[0].answers), 'answers should be array');

  // 3. knowledge-graph.json
  const graph = readJSON(path.join(learningDir, 'knowledge-graph.json'));
  const node = graph.nodes.find(n => n.id === 'concept-a');
  TestRunner.assertEquals(node.node_status, 'mastered', 'node_status → mastered');

  // Cleanup
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

TestRunner.test('[PB3] 提交 struggling → node_status 更新为 struggling', async () => {
  const tmpDir = createTempProject();
  const learningDir = path.join(tmpDir, '.learning');

  await global.window.__TAURI__.core.invoke('submit_review_result', {
    projectPath: tmpDir, conceptId: 'concept-a', rating: 'struggling', answers: []
  });

  const history = readJSON(path.join(learningDir, 'review-history.json'));
  TestRunner.assertEquals(history.entries[0].correct, false, 'correct=false');
  TestRunner.assertEquals(history.entries[0].rating, 'struggling', 'rating struggling');

  const graph = readJSON(path.join(learningDir, 'knowledge-graph.json'));
  TestRunner.assertEquals(graph.nodes[0].node_status, 'struggling', 'node_status struggling');

  // Cleanup
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

TestRunner.test('[PB3] 多次复习 → review-history 正确追加', async () => {
  const tmpDir = createTempProject();
  const learningDir = path.join(tmpDir, '.learning');

  await global.window.__TAURI__.core.invoke('submit_review_result', {
    projectPath: tmpDir, conceptId: 'concept-a', rating: 'struggling', answers: []
  });
  await global.window.__TAURI__.core.invoke('submit_review_result', {
    projectPath: tmpDir, conceptId: 'concept-a', rating: 'learning', answers: []
  });
  await global.window.__TAURI__.core.invoke('submit_review_result', {
    projectPath: tmpDir, conceptId: 'concept-a', rating: 'mastered', answers: []
  });

  const history = readJSON(path.join(learningDir, 'review-history.json'));
  TestRunner.assertEquals(history.entries.length, 3, '3 entries');
  TestRunner.assertEquals(history.entries[0].rating, 'struggling', 'first: struggling');
  TestRunner.assertEquals(history.entries[1].rating, 'learning', 'second: learning');
  TestRunner.assertEquals(history.entries[2].rating, 'mastered', 'third: mastered');

  const schedule = readJSON(path.join(learningDir, 'review-schedule.json'));
  TestRunner.assertEquals(schedule.items[0].review_count, 3, 'review_count=3');

  // Cleanup
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

TestRunner.test('[PB3] 不存在 knowledge-graph.json 时不崩溃', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pb3-no-graph-'));
  const learningDir = path.join(tmpDir, '.learning');
  fs.mkdirSync(learningDir, { recursive: true });
  fs.writeFileSync(path.join(learningDir, 'review-schedule.json'), JSON.stringify({
    version: '1.0',
    items: [{ concept: 'concept-a', source_chapter: '01.md', review_count: 0, last_reviewed: '', next_review_at: '2026-06-23 12:00:00', last_rating: 'learning', status: 'upcoming' }]
  }, null, 2), 'utf-8');

  // Should not crash
  const result = await global.window.__TAURI__.core.invoke('submit_review_result', {
    projectPath: tmpDir, conceptId: 'concept-a', rating: 'mastered', answers: []
  });
  TestRunner.assertEquals(result.success, true, 'should succeed');
  TestRunner.assertEquals(result.rating, 'mastered', 'rating correct');

  // review-history should still be written even without graph
  const history = readJSON(path.join(learningDir, 'review-history.json'));
  TestRunner.assert(history, 'review-history written');
  TestRunner.assertEquals(history.entries.length, 1, '1 entry');

  // Cleanup
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ============================================
// Run
// ============================================

TestRunner.run();
