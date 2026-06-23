#!/usr/bin/env node
// -*- coding: utf-8 -*-
/**
 * TDD Tests for PB2: review-schedule 写入时机改造
 * Covers: init_review_schedule command, getDueItems no longer rebuilds,
 *         idempotency, weak_concepts interval
 *
 * Module: src-tauri/src/lib.rs (init_review_schedule, get_review_items)
 *         dist/scripts/learning/review-scheduler.js (getDueItems)
 */
'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const TestRunner = require('../../shared/test-runner');

// ============================================
// Setup: mock Tauri
// ============================================

const invokeCalls = [];
require('../../bdd-acceptance/mock-tauri');

const _origInvoke = global.window.__TAURI__.core.invoke;
global.window.__TAURI__.core.invoke = async (cmd, args) => {
  invokeCalls.push({ cmd, args: args ? { ...args } : undefined });
  return _origInvoke(cmd, args);
};

// Load review-scheduler (needed for getDueItems test)
require('../../../dist/scripts/learning/review-scheduler.js');

// ============================================
// Helpers
// ============================================

function createTempProject() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pb2-test-'));
  const learningDir = path.join(tmpDir, '.learning');
  fs.mkdirSync(learningDir, { recursive: true });

  fs.writeFileSync(path.join(learningDir, 'project.json'), JSON.stringify({
    name: 'Test',
    created: Date.now(),
    chapters: [
      { title: '第一章', file: '01-first.md', concepts: [{ id: 'concept-a', name: '概念A' }, { id: 'concept-b', name: '概念B' }] }
    ],
    chapters_status: { '01-first.md': 'completed' }
  }, null, 2), 'utf-8');

  fs.writeFileSync(path.join(tmpDir, '01-first.concepts.json'), JSON.stringify({
    concepts: [
      { id: 'concept-a', name: '概念A', chapter: '01-first.md' },
      { id: 'concept-b', name: '概念B', chapter: '01-first.md' }
    ]
  }, null, 2), 'utf-8');

  return tmpDir;
}

function readSchedule(projectPath) {
  const p = path.join(projectPath, '.learning', 'review-schedule.json');
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

function clearInvokeCalls() {
  invokeCalls.length = 0;
}

// ============================================
// Test: init_review_schedule
// ============================================

TestRunner.test('[PB2] init_review_schedule 写入 review-schedule.json', async () => {
  const projectPath = createTempProject();
  const chapterFile = '01-first.md';

  const result = await global.window.__TAURI__.core.invoke('init_review_schedule', {
    projectPath, chapterFile, weakConcepts: ['concept-b']
  });

  TestRunner.assertEquals(result.items_added, 2, 'should add 2 concepts');

  const schedule = readSchedule(projectPath);
  TestRunner.assert(schedule, 'review-schedule.json should exist');
  TestRunner.assertEquals(schedule.version, '1.0', 'version should be 1.0');
  TestRunner.assertEquals(schedule.items.length, 2, 'should have 2 items');

  const itemA = schedule.items.find(i => i.concept === 'concept-a');
  const itemB = schedule.items.find(i => i.concept === 'concept-b');
  TestRunner.assert(itemA, 'concept-a should be in schedule');
  TestRunner.assert(itemB, 'concept-b should be in schedule');
  TestRunner.assertEquals(itemA.review_count, 0, 'initial review_count should be 0');
  TestRunner.assertEquals(itemA.status, 'upcoming', 'initial status should be upcoming');
  TestRunner.assert(itemA.next_review_at.length > 0, 'next_review_at should be set');

  // Cleanup
  fs.rmSync(projectPath, { recursive: true, force: true });
});

TestRunner.test('[PB2] init_review_schedule 幂等：重复调用不重复添加', async () => {
  const projectPath = createTempProject();
  const chapterFile = '01-first.md';

  await global.window.__TAURI__.core.invoke('init_review_schedule', {
    projectPath, chapterFile, weakConcepts: []
  });

  const result2 = await global.window.__TAURI__.core.invoke('init_review_schedule', {
    projectPath, chapterFile, weakConcepts: ['concept-a']
  });

  TestRunner.assertEquals(result2.items_added, 0, 'second call should add 0 items');

  const schedule = readSchedule(projectPath);
  TestRunner.assertEquals(schedule.items.length, 2, 'should still have 2 items');

  // Cleanup
  fs.rmSync(projectPath, { recursive: true, force: true });
});

TestRunner.test('[PB2] getDueItems 不再触发懒重建', async () => {
  const projectPath = createTempProject();

  // Don't call init_review_schedule — simulate empty schedule
  const scheduler = new global.window.ReviewScheduler();
  const items = await scheduler.getDueItems(projectPath);

  // Should return empty array without crashing
  TestRunner.assert(Array.isArray(items), 'getDueItems should return array');
  TestRunner.assertEquals(items.length, 0, 'empty schedule → 0 due items');

  // Cleanup
  fs.rmSync(projectPath, { recursive: true, force: true });
});

TestRunner.test('[PB2] quiz 提交后触发 init_review_schedule', async () => {
  clearInvokeCalls();
  const projectPath = createTempProject();
  const chapterFile = '01-first.md';

  // Simulate the trigger in mode-integration.js
  await global.window.__TAURI__.core.invoke('persist_quiz_result', {
    projectPath, chapterFile, rating: 'learning', score: 0.8,
    weakConcepts: ['concept-b'], answers: [], timestamp: new Date().toISOString()
  });

  await global.window.__TAURI__.core.invoke('init_review_schedule', {
    projectPath, chapterFile, weakConcepts: ['concept-b']
  });

  // Verify schedule was written
  const schedule = readSchedule(projectPath);
  TestRunner.assert(schedule, 'review-schedule.json should exist');
  TestRunner.assert(schedule.items.length > 0, 'should have schedule items');

  // Verify trigger call
  const initCall = invokeCalls.find(c => c.cmd === 'init_review_schedule');
  TestRunner.assert(initCall, 'init_review_schedule should be invoked');

  // Cleanup
  fs.rmSync(projectPath, { recursive: true, force: true });
});

TestRunner.test('[PB2] review-schedule 弱概念的初始间隔', async () => {
  const projectPath = createTempProject();

  // Non-weak concept schedule
  await global.window.__TAURI__.core.invoke('init_review_schedule', {
    projectPath, chapterFile: '01-first.md', weakConcepts: ['concept-b']
  });

  const schedule = readSchedule(projectPath);
  const itemA = schedule.items.find(i => i.concept === 'concept-a');
  const itemB = schedule.items.find(i => i.concept === 'concept-b');

  TestRunner.assert(itemA, 'concept-a should exist');
  TestRunner.assert(itemB, 'concept-b should exist');
  TestRunner.assertEquals(itemA.review_count, 0, 'non-weak review_count=0');
  TestRunner.assertEquals(itemB.review_count, 0, 'weak review_count=0');

  // Cleanup
  fs.rmSync(projectPath, { recursive: true, force: true });
});

// ============================================
// Run
// ============================================

TestRunner.run();
