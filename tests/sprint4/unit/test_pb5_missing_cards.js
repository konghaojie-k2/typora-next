#!/usr/bin/env node
// -*- coding: utf-8 -*-
/**
 * TDD Tests for PB5: check_missing_review_cards 容错机制
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

function createTempProject(completedWithCards) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pb5-test-'));
  const learningDir = path.join(tmpDir, '.learning');
  fs.mkdirSync(learningDir, { recursive: true });

  const project = {
    name: 'Test',
    created: Date.now(),
    chapters: [
      { title: '一章', file: '01-first.md', concepts: [{ id: 'concept-a', name: '概念A' }, { id: 'concept-b', name: '概念B' }] },
      { title: '二章', file: '02-second.md', concepts: [{ id: 'concept-c', name: '概念C' }] },
      { title: '三章', file: '03-third.md', concepts: [{ id: 'concept-d', name: '概念D' }] }
    ],
    chapters_status: {
      '01-first.md': 'completed',
      '02-second.md': 'completed',
      '03-third.md': 'not_started'
    }
  };
  fs.writeFileSync(path.join(learningDir, 'project.json'), JSON.stringify(project, null, 2), 'utf-8');

  // Optionally create review-cards.json with some cards
  if (completedWithCards) {
    const cards = { version: '1.0', cards: {} };
    for (const id of completedWithCards) {
      cards.cards[id] = { concept_name: id, quiz_questions: [], key_points: [], generated_at: new Date().toISOString(), from_weak: false };
    }
    fs.writeFileSync(path.join(learningDir, 'review-cards.json'), JSON.stringify(cards, null, 2), 'utf-8');
  }

  return tmpDir;
}

// ============================================
// Test: 发现缺失的 review-cards
// ============================================

TestRunner.test('[PB5] 检测到缺失的 review-cards', async () => {
  const tmpDir = createTempProject();
  const result = await global.window.__TAURI__.core.invoke('check_missing_review_cards', { projectPath: tmpDir });

  // concept-a 和 concept-b 来自第一章(completed)，concept-c 来自第二章(completed)
  // concept-d 来自第三章(not_started，应跳过)
  // 全部应该都缺失因为没创建 review-cards.json
  TestRunner.assert(Array.isArray(result), 'should return array');
  TestRunner.assertEquals(result.length, 2, '2 completed chapters missing cards');

  const ch1 = result.find(r => r.chapter_file === '01-first.md');
  const ch2 = result.find(r => r.chapter_file === '02-second.md');
  TestRunner.assert(ch1, '01-first should be in result');
  TestRunner.assert(ch2, '02-second should be in result');
  TestRunner.assertEquals(ch1.missing_concepts.length, 2, 'concept-a and concept-b missing');
  TestRunner.assertEquals(ch2.missing_concepts.length, 1, 'concept-c missing');

  // Verify chapter 03 (not_started) is NOT included
  const ch3 = result.find(r => r.chapter_file === '03-third.md');
  TestRunner.assert(!ch3, '03-third should not be included (not_started)');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

TestRunner.test('[PB5] 已有 review-cards 时不报告缺失', async () => {
  const tmpDir = createTempProject(['concept-a', 'concept-b', 'concept-c']);
  const result = await global.window.__TAURI__.core.invoke('check_missing_review_cards', { projectPath: tmpDir });

  TestRunner.assertEquals(result.length, 0, 'no missing cards when all exist');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

TestRunner.test('[PB5] 部分缺失时只报告确实的概念', async () => {
  const tmpDir = createTempProject(['concept-a']); // only concept-a has a card
  const result = await global.window.__TAURI__.core.invoke('check_missing_review_cards', { projectPath: tmpDir });

  const ch1 = result.find(r => r.chapter_file === '01-first.md');
  TestRunner.assert(ch1, '01-first should be in result');
  TestRunner.assertEquals(ch1.missing_concepts.length, 1, 'concept-b should be missing');
  TestRunner.assertEquals(ch1.missing_concepts[0], 'concept-b', 'concept-b missing');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

TestRunner.test('[PB5] 无 project.json 时返回空数组', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pb5-empty-'));
  const result = await global.window.__TAURI__.core.invoke('check_missing_review_cards', { projectPath: tmpDir });

  TestRunner.assert(Array.isArray(result), 'should return array');
  TestRunner.assertEquals(result.length, 0, 'empty for no project');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ============================================
// Run
// ============================================

TestRunner.run();
