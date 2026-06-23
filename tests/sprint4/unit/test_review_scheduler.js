#!/usr/bin/env node
// -*- coding: utf-8 -*-
/**
 * TDD Tests for Review Scheduler
 * Covers Ebbinghaus interval computation, due detection, schedule generation,
 * mark reviewed, and postpone logic.
 *
 * Module: dist/scripts/learning/review-scheduler.js
 */

const TestRunner = require('../../shared/test-runner');

// Minimal mock for Tauri invoke
if (typeof global.window === 'undefined') global.window = {};
if (typeof global.document === 'undefined') {
  global.document = {
    createElement: () => ({}),
    body: { appendChild: () => {}, removeChild: () => {} }
  };
}

require('../../../dist/scripts/learning/review-scheduler.js');
const { ReviewScheduler, EBINGHAUS_INTERVALS } = window;

// ============================================
// Helpers
// ============================================

function dateStr(daysOffset, hour = 12) {
  const d = new Date();
  d.setDate(d.getDate() + daysOffset);
  d.setHours(hour, 0, 0, 0);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(hour).padStart(2, '0')}:00:00`;
}

// ============================================
// Test: computeNextInterval
// ============================================

TestRunner.test('computeNextInterval: base Ebbinghaus intervals', () => {
  const s = new ReviewScheduler();
  TestRunner.assertEquals(s.computeNextInterval(0, 'mastered'), 1,  'count=0 → 1 day');
  TestRunner.assertEquals(s.computeNextInterval(1, 'mastered'), 2,  'count=1 → 2 days');
  TestRunner.assertEquals(s.computeNextInterval(2, 'mastered'), 4,  'count=2 → 4 days');
  TestRunner.assertEquals(s.computeNextInterval(3, 'mastered'), 7,  'count=3 → 7 days');
  TestRunner.assertEquals(s.computeNextInterval(4, 'mastered'), 15, 'count=4 → 15 days');
  TestRunner.assertEquals(s.computeNextInterval(5, 'mastered'), 30, 'count=5 → 30 days');
  TestRunner.assertEquals(s.computeNextInterval(6, 'mastered'), 30, 'count=6+ capped at 30');
  TestRunner.assertEquals(s.computeNextInterval(99, 'mastered'), 30, 'count=99 capped at 30');
});

TestRunner.test('computeNextInterval: struggling rating shortens interval', () => {
  const s = new ReviewScheduler();
  // struggling: interval / 2, min 1
  TestRunner.assertEquals(s.computeNextInterval(0, 'struggling'), 1,  '1/2=0.5 → floor → 1, min 1');
  TestRunner.assertEquals(s.computeNextInterval(1, 'struggling'), 1,  '2/2=1');
  TestRunner.assertEquals(s.computeNextInterval(2, 'struggling'), 2,  '4/2=2');
  TestRunner.assertEquals(s.computeNextInterval(3, 'struggling'), 3,  '7/2=3.5 → floor 3');
  TestRunner.assertEquals(s.computeNextInterval(4, 'struggling'), 7,  '15/2=7.5 → floor 7');
  TestRunner.assertEquals(s.computeNextInterval(5, 'struggling'), 15, '30/2=15');
});

TestRunner.test('computeNextInterval: learning rating reduces interval', () => {
  const s = new ReviewScheduler();
  // learning: interval * 0.75, floor, min 1
  TestRunner.assertEquals(s.computeNextInterval(0, 'learning'), 1,  '1*0.75=0.75 → floor 0 → min 1');
  TestRunner.assertEquals(s.computeNextInterval(1, 'learning'), 1,  '2*0.75=1.5 → floor 1');
  TestRunner.assertEquals(s.computeNextInterval(2, 'learning'), 3,  '4*0.75=3');
  TestRunner.assertEquals(s.computeNextInterval(3, 'learning'), 5,  '7*0.75=5.25 → floor 5');
  TestRunner.assertEquals(s.computeNextInterval(4, 'learning'), 11, '15*0.75=11.25 → floor 11');
  TestRunner.assertEquals(s.computeNextInterval(5, 'learning'), 22, '30*0.75=22.5 → floor 22');
});

TestRunner.test('computeNextInterval: unknown rating falls back to mastered', () => {
  const s = new ReviewScheduler();
  TestRunner.assertEquals(s.computeNextInterval(2, 'unknown'), 4, 'unknown rating uses base interval');
});

// ============================================
// Test: isDue
// ============================================

TestRunner.test('isDue: past date is due', () => {
  const s = new ReviewScheduler();
  const yesterday = dateStr(-1);
  TestRunner.assert(s.isDue(yesterday), 'yesterday should be due');
});

TestRunner.test('isDue: future date is not due', () => {
  const s = new ReviewScheduler();
  const tomorrow = dateStr(1);
  TestRunner.assert(!s.isDue(tomorrow), 'tomorrow should not be due');
});

TestRunner.test('isDue: exact same hour is due', () => {
  const s = new ReviewScheduler();
  const now = dateStr(0, new Date().getHours());
  TestRunner.assert(s.isDue(now), 'same hour should be due');
});

// ============================================
// Test: computeSchedule
// ============================================

TestRunner.test('computeSchedule: creates items for all concepts', () => {
  const s = new ReviewScheduler();
  const concepts = {
    '位置编码': { status: 'learning', source_chapter: '03.md', updated_at: dateStr(-3) },
    '梯度裁剪': { status: 'struggling', source_chapter: '05.md', updated_at: dateStr(-7) }
  };
  const quizHistory = { entries: [] };
  const schedule = s.computeSchedule(concepts, quizHistory);

  TestRunner.assertEquals(schedule.items.length, 2, 'should create 2 items');
  TestRunner.assertExists(schedule.items.find(i => i.concept === '位置编码'), 'should have 位置编码');
  TestRunner.assertExists(schedule.items.find(i => i.concept === '梯度裁剪'), 'should have 梯度裁剪');
});

TestRunner.test('computeSchedule: sets correct initial next_review_at', () => {
  const s = new ReviewScheduler();
  const concepts = {
    '注意力机制': { status: 'mastered', source_chapter: '01.md', updated_at: dateStr(-1) }
  };
  const schedule = s.computeSchedule(concepts, { entries: [] });
  const item = schedule.items[0];

  TestRunner.assertEquals(item.review_count, 0, 'initial review_count is 0');
  TestRunner.assert(
    item.status === 'due' || item.status === 'upcoming',
    'initial status should be due or upcoming (depends on current time)'
  );
  TestRunner.assert(item.next_review_at.includes(dateStr(0).slice(0, 10)) || item.next_review_at < dateStr(1), 'next_review_at should be today or earlier');
});

TestRunner.test('computeSchedule: respects existing quiz history', () => {
  const s = new ReviewScheduler();
  const concepts = {
    'Self-Attention': { status: 'mastered', source_chapter: '02.md', updated_at: dateStr(-5) }
  };
  const quizHistory = {
    entries: [
      { chapter_file: '02.md', timestamp: dateStr(-5), rating: 'mastered', weak_concepts: [] },
      { chapter_file: '02.md', timestamp: dateStr(-3), rating: 'mastered', weak_concepts: [] }
    ]
  };
  const schedule = s.computeSchedule(concepts, quizHistory);
  const item = schedule.items[0];

  TestRunner.assertEquals(item.review_count, 2, 'should count 2 quiz attempts');
  TestRunner.assertEquals(item.last_rating, 'mastered', 'last rating from most recent quiz');
});

TestRunner.test('computeSchedule: filters out completed items from quiz history', () => {
  const s = new ReviewScheduler();
  const concepts = {
    '新概念': { status: 'mastered', source_chapter: '10.md', updated_at: dateStr(-1) }
  };
  const quizHistory = {
    entries: [
      { chapter_file: '01.md', timestamp: dateStr(-5), rating: 'mastered', weak_concepts: [] }
    ]
  };
  const schedule = s.computeSchedule(concepts, quizHistory);

  TestRunner.assertEquals(schedule.items.length, 1, 'should still create item for new concept');
  TestRunner.assertEquals(schedule.items[0].review_count, 0, 'old chapter quiz does not count for new concept');
});

// ============================================
// Test: markReviewed
// ============================================

TestRunner.test('markReviewed: increments review_count and computes next date', () => {
  const s = new ReviewScheduler();
  const item = {
    concept: '位置编码',
    review_count: 1,
    last_rating: 'learning',
    next_review_at: dateStr(0)
  };
  s.markReviewed(item, 'mastered');

  TestRunner.assertEquals(item.review_count, 2, 'review_count incremented');
  TestRunner.assertEquals(item.last_rating, 'mastered', 'rating updated');
  TestRunner.assertEquals(item.status, 'upcoming', 'status becomes upcoming');
  // next_review_at should be 2 days from now (count=2, mastered → 4 days)
  TestRunner.assert(item.next_review_at > dateStr(3), 'next review should be ~4 days away');
});

TestRunner.test('markReviewed: struggling keeps short interval', () => {
  const s = new ReviewScheduler();
  const item = { concept: 'X', review_count: 3, last_rating: 'struggling', next_review_at: dateStr(0) };
  s.markReviewed(item, 'struggling');

  // count=4, struggling → 15/2 = 7 days
  TestRunner.assert(item.next_review_at > dateStr(6), 'struggling interval should be ~7 days');
  TestRunner.assert(item.next_review_at < dateStr(8), 'struggling interval should be ~7 days');
});

// ============================================
// Test: postpone
// ============================================

TestRunner.test('postpone: moves next_review_at to tomorrow', () => {
  const s = new ReviewScheduler();
  const item = { concept: 'X', review_count: 0, next_review_at: dateStr(0) };
  s.postpone(item);

  const tomorrow = dateStr(1);
  TestRunner.assert(item.next_review_at.includes(tomorrow.slice(0, 10)), 'should be postponed to tomorrow');
  TestRunner.assertEquals(item.status, 'upcoming', 'status becomes upcoming after postpone');
});

TestRunner.test('postpone: preserves review_count', () => {
  const s = new ReviewScheduler();
  const item = { concept: 'X', review_count: 3, next_review_at: dateStr(0) };
  s.postpone(item);

  TestRunner.assertEquals(item.review_count, 3, 'review_count should not change on postpone');
});

// ============================================
// Test: format consistency
// ============================================

TestRunner.test('date format matches project convention', () => {
  const s = new ReviewScheduler();
  const item = { concept: 'X', review_count: 0, last_rating: 'mastered', next_review_at: dateStr(0) };
  s.markReviewed(item, 'mastered');

  const pattern = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
  TestRunner.assert(pattern.test(item.next_review_at), `date format should be YYYY-MM-DD HH:mm:ss, got: ${item.next_review_at}`);
});

// ============================================
// Run
// ============================================

TestRunner.run().then(({ passed, failed }) => {
  if (failed > 0) process.exit(1);
});
