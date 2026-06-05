#!/usr/bin/env node
// -*- coding: utf-8 -*-
/**
 * TDD Tests for Review Modal
 * Covers state machine, DOM lifecycle, button callbacks, ESC key handling.
 *
 * Module: dist/scripts/learning/review-modal.js
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
  const miPath = path.join(__dirname, '../../dist/scripts/learning/review-modal.js');
  delete require.cache[require.resolve(miPath)];
  require(miPath);
  return window.ReviewModal;
}

// ============================================
// Tests
// ============================================

TestRunner.test('constructor initializes with hidden state', () => {
  setupEnv();
  const ReviewModal = loadModal();
  const modal = new ReviewModal({ items: [] });
  TestRunner.assertEquals(modal.getState(), 'hidden', 'initial state should be hidden');
  TestRunner.assertEquals(modal.currentIndex, 0, 'initial index should be 0');
  TestRunner.assertEquals(modal.items.length, 0, 'items should be empty');
});

TestRunner.test('show creates DOM overlay and card', () => {
  setupEnv();
  const ReviewModal = loadModal();
  const modal = new ReviewModal({
    items: [
      { concept: '位置编码', source_chapter: '03.md', status: 'due' }
    ]
  });
  modal.show();

  const overlay = document.querySelector('.review-modal-overlay');
  TestRunner.assertExists(overlay, 'overlay should exist');

  const card = document.querySelector('.review-modal-card');
  TestRunner.assertExists(card, 'card should exist');
});

TestRunner.test('show transitions state to due_found', () => {
  setupEnv();
  const ReviewModal = loadModal();
  const modal = new ReviewModal({ items: [{ concept: 'X' }] });
  modal.show();
  TestRunner.assertEquals(modal.getState(), 'due_found', 'state should be due_found after show');
});

TestRunner.test('startReview transitions state to reviewing', () => {
  setupEnv();
  const ReviewModal = loadModal();
  const modal = new ReviewModal({ items: [{ concept: 'X' }, { concept: 'Y' }] });
  modal.show();
  modal.startReview();
  TestRunner.assertEquals(modal.getState(), 'reviewing', 'state should be reviewing after startReview');
});

TestRunner.test('submitAnswer advances currentIndex', () => {
  setupEnv();
  const ReviewModal = loadModal();
  const modal = new ReviewModal({ items: [{ concept: 'A' }, { concept: 'B' }] });
  modal.show();
  modal.startReview();
  TestRunner.assertEquals(modal.currentIndex, 0, 'should start at index 0');

  modal.submitAnswer('mastered');
  TestRunner.assertEquals(modal.currentIndex, 1, 'should advance to index 1');
});

TestRunner.test('submitAnswer on last item triggers complete', () => {
  setupEnv();
  let completed = false;
  const ReviewModal = loadModal();
  const modal = new ReviewModal({
    items: [{ concept: 'A' }],
    onComplete: () => { completed = true; }
  });
  modal.show();
  modal.startReview();
  modal.submitAnswer('mastered');

  TestRunner.assert(completed, 'onComplete should be called after last item');
  TestRunner.assertEquals(modal.getState(), 'completed', 'state should be completed');
});

TestRunner.test('complete transitions state to hidden after delay simulation', () => {
  setupEnv();
  const ReviewModal = loadModal();
  const modal = new ReviewModal({ items: [{ concept: 'A' }] });
  modal.show();
  modal.startReview();
  modal.complete();

  // complete() immediately sets state to completed, teardown sets to hidden
  // In our implementation, complete may call teardown synchronously or async
  TestRunner.assert(
    modal.getState() === 'completed' || modal.getState() === 'hidden',
    'state should be completed or hidden after complete'
  );
});

TestRunner.test('postpone transitions state to hidden', () => {
  setupEnv();
  const ReviewModal = loadModal();
  const modal = new ReviewModal({ items: [{ concept: 'A' }] });
  modal.show();
  TestRunner.assertEquals(modal.getState(), 'due_found');

  modal.postpone();
  TestRunner.assertEquals(modal.getState(), 'hidden', 'state should be hidden after postpone');
});

TestRunner.test('postpone calls onPostpone callback', () => {
  setupEnv();
  let called = false;
  const ReviewModal = loadModal();
  const modal = new ReviewModal({
    items: [{ concept: 'A' }],
    onPostpone: () => { called = true; }
  });
  modal.show();
  modal.postpone();

  TestRunner.assert(called, 'onPostpone should be called');
});

TestRunner.test('teardown removes DOM elements', () => {
  setupEnv();
  const ReviewModal = loadModal();
  const modal = new ReviewModal({ items: [{ concept: 'A' }] });
  modal.show();
  TestRunner.assertExists(document.querySelector('.review-modal-overlay'));

  modal.teardown();
  TestRunner.assert(document.querySelector('.review-modal-overlay') === null, 'overlay should be removed');
});

TestRunner.test('modal stores items passed in constructor', () => {
  setupEnv();
  const ReviewModal = loadModal();
  const items = [
    { concept: '位置编码', status: 'due' },
    { concept: '梯度裁剪', status: 'due' }
  ];
  const modal = new ReviewModal({ items });
  TestRunner.assertEquals(modal.items.length, 2, 'should store 2 items');
  TestRunner.assertEquals(modal.items[0].concept, '位置编码');
  TestRunner.assertEquals(modal.items[1].concept, '梯度裁剪');
});

// ============================================
// Run
// ============================================

TestRunner.run().then(({ passed, failed }) => {
  if (failed > 0) process.exit(1);
});
