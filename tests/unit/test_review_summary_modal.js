#!/usr/bin/env node
// -*- coding: utf-8 -*-
/**
 * TDD Tests for Review Summary Modal
 * Covers: post-review completion modal with concept status changes,
 * mini knowledge graph with pulsating animation, navigation to full dashboard.
 *
 * Module: dist/scripts/learning/review-summary-modal.js
 *
 * BDD Scenarios covered:
 * - 复习完成后展示掌握状态变化 (status change display)
 * - 复习完成后展示掌握状态变化 (mini graph with pulse)
 */

const TestRunner = require('./test-runner');
const { buildMockDOM } = require('./mock-dom');

function setupEnv() {
  const { document, body } = buildMockDOM();
  global.document = document;
  global.window = {
    document,
    addEventListener() {},
    removeEventListener() {},
    __TAURI__: { core: { invoke: () => Promise.resolve() } }
  };
}

function loadModal() {
  const path = require('path');
  const modPath = path.join(__dirname, '../../dist/scripts/learning/review-summary-modal.js');
  try {
    const resolved = require.resolve(modPath);
    delete require.cache[resolved];
    require(modPath);
  } catch (e) {
    return null;
  }
  return window.ReviewSummaryModal;
}

// ============================================
// Helper: create mock review result
// ============================================

function makeReviewResult(changes) {
  return {
    changes: changes.map(([concept, from, to, chapter]) => ({
      concept,
      fromStatus: from,
      toStatus: to,
      chapter
    })),
    reviewedCount: changes.length,
    totalCount: changes.length
  };
}

// ============================================
// Test: Module loading
// ============================================

TestRunner.test('ReviewSummaryModal module loads', () => {
  setupEnv();
  const RSM = loadModal();
  if (!RSM) {
    throw new Error('Module not found: dist/scripts/learning/review-summary-modal.js (expected in TDD red phase)');
  }
  TestRunner.assertExists(RSM, 'ReviewSummaryModal should be exported');
});

// ============================================
// Test: State machine
// ============================================

TestRunner.test('initial state is hidden', () => {
  setupEnv();
  const RSM = loadModal();
  if (!RSM) return;

  const modal = new RSM();
  TestRunner.assertEquals(modal.getState(), 'hidden', 'initial state should be hidden');
});

TestRunner.test('show transitions to visible', () => {
  setupEnv();
  const RSM = loadModal();
  if (!RSM) return;

  const result = makeReviewResult([['注意力机制', 'learning', 'mastered', '01.md']]);
  const modal = new RSM();
  modal.show({ reviewResult: result, miniGraph: null });
  TestRunner.assertEquals(modal.getState(), 'visible', 'should be visible after show');
});

TestRunner.test('close transitions back to hidden', () => {
  setupEnv();
  const RSM = loadModal();
  if (!RSM) return;

  const result = makeReviewResult([['A', 'learning', 'mastered', '01.md']]);
  const modal = new RSM();
  modal.show({ reviewResult: result, miniGraph: null });
  modal.close();
  TestRunner.assertEquals(modal.getState(), 'hidden', 'should be hidden after close');
});

// ============================================
// Test: Status change display
// ============================================

TestRunner.test('renders status change cards for each concept', () => {
  setupEnv();
  const RSM = loadModal();
  if (!RSM) return;

  const result = makeReviewResult([
    ['注意力机制', 'learning', 'mastered', '01.md'],
    ['位置编码', 'struggling', 'learning', '02.md']
  ]);
  const modal = new RSM();
  modal.show({ reviewResult: result, miniGraph: null });

  const cards = document.querySelectorAll('.review-change-card');
  TestRunner.assertEquals(cards.length, 2, 'should render 2 change cards');
});

TestRunner.test('status change card shows concept name', () => {
  setupEnv();
  const RSM = loadModal();
  if (!RSM) return;

  const result = makeReviewResult([['注意力机制', 'learning', 'mastered', '01.md']]);
  const modal = new RSM();
  modal.show({ reviewResult: result, miniGraph: null });

  const nameEl = document.querySelector('.review-change-name');
  if (nameEl) {
    TestRunner.assert(nameEl.textContent.includes('注意力机制'), 'card should show concept name');
  }
});

TestRunner.test('status change card shows from → to status', () => {
  setupEnv();
  const RSM = loadModal();
  if (!RSM) return;

  const result = makeReviewResult([['位置编码', 'struggling', 'learning', '02.md']]);
  const modal = new RSM();
  modal.show({ reviewResult: result, miniGraph: null });

  const arrowEl = document.querySelector('.review-change-arrow');
  if (arrowEl) {
    TestRunner.assert(arrowEl.textContent.includes('困难'),
      'card should show from status');
    TestRunner.assert(arrowEl.textContent.includes('学习中'),
      'card should show to status');
  }
});

TestRunner.test('improvement (upgraded) cards have positive styling', () => {
  setupEnv();
  const RSM = loadModal();
  if (!RSM) return;

  const result = makeReviewResult([['A', 'learning', 'mastered', '01.md']]);
  const modal = new RSM();
  modal.show({ reviewResult: result, miniGraph: null });

  const card = document.querySelector('.review-change-card');
  if (card) {
    TestRunner.assert(
      card.classList.contains('status-improved') || card.classList.contains('positive'),
      'improvement card should have positive styling'
    );
  }
});

TestRunner.test('regression (downgraded) cards have warning styling', () => {
  setupEnv();
  const RSM = loadModal();
  if (!RSM) return;

  const result = makeReviewResult([['A', 'mastered', 'struggling', '01.md']]);
  const modal = new RSM();
  modal.show({ reviewResult: result, miniGraph: null });

  const card = document.querySelector('.review-change-card');
  if (card) {
    TestRunner.assert(
      card.classList.contains('status-regressed') || card.classList.contains('warning'),
      'regression card should have warning styling'
    );
  }
});

// ============================================
// Test: Navigation button
// ============================================

TestRunner.test('has button to view full knowledge graph', () => {
  setupEnv();
  const RSM = loadModal();
  if (!RSM) return;

  const result = makeReviewResult([['A', 'learning', 'mastered', '01.md']]);
  const modal = new RSM();
  modal.show({ reviewResult: result, miniGraph: null });

  const btn = document.querySelector('[data-action="view-full-graph"]');
  TestRunner.assertExists(btn, 'view full graph button should exist');
});

TestRunner.test('view full graph button calls callback', () => {
  setupEnv();
  const RSM = loadModal();
  if (!RSM) return;

  let called = false;
  const result = makeReviewResult([['A', 'learning', 'mastered', '01.md']]);
  const modal = new RSM({
    onViewFullGraph: () => { called = true; }
  });
  modal.show({ reviewResult: result, miniGraph: null });

  const btn = document.querySelector('[data-action="view-full-graph"]');
  if (btn) btn.click();
  TestRunner.assert(called, 'onViewFullGraph callback should fire');
});

TestRunner.test('has close/done button', () => {
  setupEnv();
  const RSM = loadModal();
  if (!RSM) return;

  const result = makeReviewResult([['A', 'learning', 'mastered', '01.md']]);
  const modal = new RSM();
  modal.show({ reviewResult: result, miniGraph: null });

  const btn = document.querySelector('[data-action="close"]') ||
              document.querySelector('[data-action="done"]');
  TestRunner.assertExists(btn, 'close/done button should exist');
});

// ============================================
// Test: Empty review result
// ============================================

TestRunner.test('empty changes shows no-change message', () => {
  setupEnv();
  const RSM = loadModal();
  if (!RSM) return;

  const result = { changes: [], reviewedCount: 0, totalCount: 0 };
  const modal = new RSM();
  modal.show({ reviewResult: result, miniGraph: null });

  const msg = document.querySelector('.review-no-change') ||
              document.querySelector('.review-empty');
  TestRunner.assertExists(msg, 'should show no-change message for empty result');
});

// ============================================
// Test: ESC key
// ============================================

TestRunner.test('ESC key closes modal', () => {
  setupEnv();
  const RSM = loadModal();
  if (!RSM) return;

  const result = makeReviewResult([['A', 'learning', 'mastered', '01.md']]);
  const modal = new RSM();
  modal.show({ reviewResult: result, miniGraph: null });

  document._dispatchDocEvent('keydown', { key: 'Escape' });
  TestRunner.assertEquals(modal.getState(), 'hidden', 'ESC should close modal');
});

// ============================================
// Run
// ============================================

TestRunner.run().then(({ passed, failed }) => {
  if (failed > 0) process.exit(1);
});
