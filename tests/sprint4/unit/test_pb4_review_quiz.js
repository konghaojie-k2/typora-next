#!/usr/bin/env node
// -*- coding: utf-8 -*-
/**
 * TDD Tests for PB4: review-modal 客观题改造
 * Covers: quiz rendering, auto-grading, key_points display, rating derivation
 */
'use strict';

const TestRunner = require('../../shared/test-runner');

// Minimal DOM mock
if (typeof global.window === 'undefined') global.window = {};
if (typeof global.document === 'undefined') {
  global.document = {
    createElement: (tag) => {
      const el = {
        tagName: tag,
        className: '',
        style: { cssText: '' },
        innerHTML: '',
        children: [],
        classList: { add: () => {}, remove: () => {}, contains: () => false },
        appendChild: (c) => { el.children.push(c); return c; },
        remove: () => {},
        removeChild: () => {},
        addEventListener: () => {},
        querySelector: () => null,
        querySelectorAll: () => [],
        setAttribute: () => {},
        getAttribute: () => null,
        dataset: {}
      };
      if (tag === 'button') el.style.pointerEvents = 'auto';
      return el;
    },
    body: {
      appendChild: () => {},
      removeChild: () => {},
      classList: { contains: () => false }
    },
    addEventListener: () => {},
    removeEventListener: () => {}
  };
}

require('../../../dist/scripts/learning/review-modal.js');
const ReviewModal = window.ReviewModal;

function getState(modal) { return modal.state; }

// ============================================
// Test: 有 quiz_questions 时进入客观题模式
// ============================================

TestRunner.test('[PB4] 有 quiz_questions 时进入客观题模式', () => {
  const modal = new ReviewModal({
    items: [{ concept: '测试概念', source_chapter: '01.md', status: 'due' }],
    cards: {
      '测试概念': {
        quiz_questions: [
          { id: 'q1', type: 'choice', question: '测试题?', options: ['A', 'B', 'C', 'D'], answer: 0 }
        ],
        key_points: ['重点1']
      }
    }
  });
  modal.show();
  modal.startReview();

  TestRunner.assertEquals(getState(modal), 'reviewing', 'state should be reviewing');
  TestRunner.assertEquals(modal._currentQuestionIdx, 0, 'should start at question 0');
});

// ============================================
// Test: handleQuizAnswer 正确/错误
// ============================================

TestRunner.test('[PB4] 答对时记录 correct=true', () => {
  const modal = new ReviewModal({
    items: [{ concept: 'C1', source_chapter: '01.md', status: 'due' }],
    cards: {
      'C1': {
        quiz_questions: [
          { id: 'q1', type: 'choice', question: 'Q?', options: ['Right', 'Wrong', 'Nope', 'No'], answer: 0 }
        ],
        key_points: ['KP1']
      }
    }
  });
  modal.show();
  modal.startReview();

  // Simulate clicking the correct answer (index 0)
  const question = modal.cards['C1'].quiz_questions[0];
  modal.handleQuizAnswer(0, question);

  const record = modal._answers[0];
  TestRunner.assert(record, 'should have record');
  TestRunner.assertEquals(record.answers.length, 1, 'should have 1 answer');
  TestRunner.assertEquals(record.answers[0].is_correct, true, 'should be correct');
  TestRunner.assertEquals(record.correct_count, 1, 'correct_count should be 1');
});

TestRunner.test('[PB4] 答错时记录 correct=false', () => {
  const modal = new ReviewModal({
    items: [{ concept: 'C1', status: 'due' }],
    cards: {
      'C1': {
        quiz_questions: [
          { id: 'q1', type: 'choice', question: 'Q?', options: ['Right', 'Wrong', 'Nope', 'No'], answer: 0 }
        ],
        key_points: ['KP1']
      }
    }
  });
  modal.show();
  modal.startReview();

  const question = modal.cards['C1'].quiz_questions[0];
  modal.handleQuizAnswer(1, question); // Wrong answer

  const record = modal._answers[0];
  TestRunner.assertEquals(record.answers[0].is_correct, false, 'should be wrong');
  TestRunner.assertEquals(record.correct_count, 0, 'correct_count should be 0');
});

// ============================================
// Test: 多题后 rating 推导
// ============================================

TestRunner.test('[PB4] 全部答对 → rating=mastered', () => {
  const modal = new ReviewModal({
    items: [{ concept: 'C1', status: 'due' }],
    cards: {
      'C1': {
        quiz_questions: [
          { id: 'q1', type: 'choice', question: 'Q1?', options: ['R', 'W', 'W', 'W'], answer: 0 },
          { id: 'q2', type: 'choice', question: 'Q2?', options: ['R', 'W', 'W', 'W'], answer: 0 },
          { id: 'q3', type: 'choice', question: 'Q3?', options: ['R', 'W', 'W', 'W'], answer: 0 }
        ],
        key_points: ['KP1']
      }
    }
  });
  modal.show();
  modal.startReview();

  // Answer all 3 correctly
  for (const q of modal.cards['C1'].quiz_questions) {
    modal.handleQuizAnswer(0, q);
    // Simulate moving to next question - manually advance
    modal._currentQuestionIdx++;
    if (modal._currentQuestionIdx >= modal.cards['C1'].quiz_questions.length) {
      modal._finalizeConceptRating();
    }
  }

  const record = modal._answers[0];
  TestRunner.assertEquals(record.correct_count, 3, 'all correct');
  TestRunner.assertEquals(record.total_count, 3, 'total 3');
  TestRunner.assertEquals(record.rating, 'mastered', '3/3 → mastered');
});

TestRunner.test('[PB4] 答对 1/3 → rating=struggling', () => {
  const modal = new ReviewModal({
    items: [{ concept: 'C1', status: 'due' }],
    cards: {
      'C1': {
        quiz_questions: [
          { id: 'q1', type: 'choice', question: 'Q1?', options: ['W', 'R', 'W', 'W'], answer: 1 },
          { id: 'q2', type: 'choice', question: 'Q2?', options: ['W', 'W', 'R', 'W'], answer: 2 },
          { id: 'q3', type: 'choice', question: 'Q3?', options: ['R', 'W', 'W', 'W'], answer: 0 }
        ],
        key_points: ['KP1']
      }
    }
  });
  modal.show();
  modal.startReview();

  const questions = modal.cards['C1'].quiz_questions;
  // Answer: q1 wrong, q2 wrong, q3 correct
  modal.handleQuizAnswer(0, questions[0]); // wrong
  modal._currentQuestionIdx = 1;
  modal.handleQuizAnswer(0, questions[1]); // wrong
  modal._currentQuestionIdx = 2;
  modal.handleQuizAnswer(0, questions[2]); // correct
  modal._finalizeConceptRating();

  TestRunner.assertEquals(modal._answers[0].correct_count, 1, '1/3 correct');
  TestRunner.assertEquals(modal._answers[0].rating, 'struggling', '1/3 → struggling');
});

// ============================================
// Test: 无 quiz_questions 时降级为自评
// ============================================

TestRunner.test('[PB4] 无 quiz_questions 时降级为自评模式', () => {
  const modal = new ReviewModal({
    items: [{ concept: 'C1', status: 'due' }],
    cards: {} // no review cards
  });
  modal.show();
  modal.startReview();

  // Should still work via submitSelfRating
  modal.submitSelfRating('mastered');
  TestRunner.assertEquals(modal.currentIndex, 1, 'should advance via self-rating');

  // Check that record has rating
  const record = modal._answers[0];
  TestRunner.assertEquals(record.rating, 'mastered', 'self-rating recorded');
});

// ============================================
// Test: nextQuestion 推进
// ============================================

TestRunner.test('[PB4] nextQuestion 在同一概念内推进问题索引', () => {
  const modal = new ReviewModal({
    items: [{ concept: 'C1', status: 'due' }],
    cards: {
      'C1': {
        quiz_questions: [
          { id: 'q1', type: 'choice', question: 'Q1?', options: ['A', 'B', 'C', 'D'], answer: 0 },
          { id: 'q2', type: 'choice', question: 'Q2?', options: ['A', 'B', 'C', 'D'], answer: 1 }
        ],
        key_points: ['KP1']
      }
    }
  });
  modal.show();
  modal.startReview();

  TestRunner.assertEquals(modal._currentQuestionIdx, 0, 'start at q0');

  // Wire up _answers for first question
  modal._answers[0] = { concept: 'C1', answers: [{ question_id: 'q1', is_correct: true }], correct_count: 1, total_count: 2 };
  modal.nextQuestion();

  TestRunner.assertEquals(modal._currentQuestionIdx, 1, 'now at q1');
});

// ============================================
// Run
// ============================================

TestRunner.run();
