#!/usr/bin/env node
// -*- coding: utf-8 -*-
/**
 * BDD Acceptance Steps for quiz option shuffle (quiz-distractor-quality B 层)
 *
 * Requires the REAL dist/scripts/quiz-shuffle.js module. Scenarios mirror
 * the render-boundary wiring: review-modal shuffles index-type cards,
 * quiz modal shuffles label-type questions, grading compares against the
 * remapped correct.
 */

const { StepRegistry } = require('../shared/runner');
const QuizShuffle = require('../../dist/scripts/quiz-shuffle');

const steps = new StepRegistry();

// 确定性 rng：mulberry32
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function legacyCard() {
  return {
    type: 'choice',
    question: 'q',
    options: ['正确项文本', '干扰一', '干扰二', '干扰三'],
    answer: 0
  };
}

function labelQuestion() {
  return {
    id: 'q1',
    qtype: 'single',
    question: 'q',
    options: [
      { label: 'A', text: '正确项文本' },
      { label: 'B', text: '干扰一' },
      { label: 'C', text: '干扰二' },
      { label: 'D', text: '干扰三' }
    ],
    correct: 'A'
  };
}

// ============================================
// Given
// ============================================
steps.given('a legacy review card whose answer is at position 0', function () {
  this.card = legacyCard();
});

steps.given('a chapter quiz question whose correct label is A', function () {
  this.question = labelQuestion();
});

steps.given('20 legacy review cards whose answers are all at position 0', function () {
  this.cards = Array.from({ length: 20 }, () => legacyCard());
});

// ============================================
// When
// ============================================
steps.when('the review modal shuffles its questions', function () {
  this.shuffledCard = QuizShuffle.shuffleIndexQuestion(this.card, mulberry32(this.seed || 7));
});

steps.when('the quiz modal shuffles its questions', function () {
  this.shuffledQuestion = QuizShuffle.shuffleLabelQuestion(this.question, mulberry32(this.seed || 7));
});

steps.when('the user picks the new correct label', function () {
  this.userAnswer = this.shuffledQuestion.correct;
});

steps.when('the review modal shuffles them with distinct seeds', function () {
  this.shuffledCards = this.cards.map((c, i) =>
    QuizShuffle.shuffleIndexQuestion(c, mulberry32(i + 1))
  );
});

// ============================================
// Then
// ============================================
steps.then('the shuffled answer should point to the original correct text', function () {
  const s = this.shuffledCard;
  if (s.options[s.answer] !== '正确项文本') {
    throw new Error(`answer points to "${s.options[s.answer]}", expected 正确项文本`);
  }
});

steps.then('the new correct label should point to the original correct text', function () {
  const s = this.shuffledQuestion;
  const hit = s.options.find((o) => o.label === s.correct);
  if (!hit || hit.text !== '正确项文本') {
    throw new Error(`correct label ${s.correct} points to "${hit && hit.text}"`);
  }
});

steps.then('the relabeled options should be consecutive A to D', function () {
  const labels = this.shuffledQuestion.options.map((o) => o.label).join('');
  if (labels !== 'ABCD') {
    throw new Error(`labels "${labels}", expected ABCD`);
  }
});

steps.then('the answer should be graded correct', function () {
  // mirror quiz grading: userAnswer === q.correct
  if (this.userAnswer !== this.shuffledQuestion.correct) {
    throw new Error('grading mismatch on shuffled question');
  }
});

steps.then('the correct positions should cover at least 3 distinct slots', function () {
  const slots = new Set(this.shuffledCards.map((c) => c.answer));
  if (slots.size < 3) {
    throw new Error(`only ${slots.size} distinct slots: ${[...slots].join(',')}`);
  }
});

module.exports = steps;
