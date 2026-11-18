#!/usr/bin/env node
// -*- coding: utf-8 -*-
/**
 * BDD acceptance steps for per-question quiz explanations (Sprint 33).
 *
 * Real-module layer: requires dist/scripts/learning/quiz-explanations.js
 * Real-filesystem layer: cache file path + write/read round-trip.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { StepRegistry } = require('../shared/runner');
const QuizExplanations = require('../../dist/scripts/learning/quiz-explanations');

const steps = new StepRegistry();

function question(id, correct, wrong, qtype) {
  return {
    id,
    qtype: qtype || 'single',
    question: `题目 ${id}`,
    options: [
      { label: 'A', text: correct },
      { label: 'B', text: wrong }
    ],
    correct: 'A',
    weak_concepts: []
  };
}

function record(id, userAnswer, isCorrect) {
  return {
    question_id: id,
    qtype: 'single',
    user_answer: userAnswer,
    is_correct: isCorrect
  };
}

// ============================================
// Given
// ============================================

steps.given('a graded quiz with two questions and one unanswered record', function () {
  this.questions = [question('q1', '正确答案甲', '干扰项甲'), question('q2', '正确答案乙', '干扰项乙')];
  this.records = [record('q1', 'A', true), record('q2', null, null)];
});

steps.given('a graded quiz with one wrong and one correct answer', function () {
  this.questions = [question('q1', '正确答案甲', '干扰项甲'), question('q2', '正确答案乙', '干扰项乙')];
  this.records = [record('q1', 'B', false), record('q2', 'A', true)];
});

steps.given('explanation items for two questions', function () {
  this.questions = [question('q1', '正确答案甲', '干扰项甲'), question('q2', '正确答案乙', '干扰项乙')];
  this.records = [record('q1', 'A', true), record('q2', 'B', false)];
  this.items = QuizExplanations.buildItems(this.questions, this.records);
});

steps.given('explanation items for one question', function () {
  this.questions = [question('q1', '正确答案甲', '干扰项甲')];
  this.records = [record('q1', 'B', false)];
  this.items = QuizExplanations.buildItems(this.questions, this.records);
});

steps.given('a chapter file named {string}', function (name) {
  this.chapterFile = name;
});

steps.given('the learning result card source', function () {
  this.cardSrc = fs.readFileSync(
    path.join(__dirname, '../../dist/scripts/learning/mode-integration.js'),
    'utf-8'
  );
});

steps.given('the index html source', function () {
  this.indexSrc = fs.readFileSync(path.join(__dirname, '../../dist/index.html'), 'utf-8');
});

// ============================================
// When
// ============================================

steps.when('the explanation items are built', function () {
  this.items = QuizExplanations.buildItems(this.questions, this.records);
});

steps.when('AI explanations arrive for one known id and one unknown id', function () {
  this.merged = QuizExplanations.mergeExplanations(this.items, [
    { question_id: 'q1', explanation: '因为甲成立，乙不成立。' },
    { question_id: 'q404', explanation: '这条不应出现。' }
  ]);
});

steps.when('AI explanations are empty', function () {
  this.merged = QuizExplanations.mergeExplanations(this.items, []);
});

steps.when('the explanation cache file name is resolved', function () {
  this.cacheName = QuizExplanations.cacheFileName(this.chapterFile);
});

steps.when('the cache file should round-trip through a real learning directory', function () {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quiz-explain-'));
  this.tmpRoot = root;
  const dir = path.join(root, '.learning', 'quizzes');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, this.cacheName);
  const payload = { version: '1.0', explanations: [{ question_id: 'q1', explanation: '解析正文' }] };
  fs.writeFileSync(file, JSON.stringify(payload), 'utf-8');
  this.roundTrip = JSON.parse(fs.readFileSync(file, 'utf-8'));
});

// ============================================
// Then
// ============================================

steps.then('the first item should point at the correct option text', function () {
  if (this.items[0].correctText !== '正确答案甲') {
    throw new Error(`expected 正确答案甲, got ${this.items[0].correctText}`);
  }
});

steps.then('the unanswered item should show no answer', function () {
  if (this.items[1].userAnswerText !== '未作答') {
    throw new Error(`expected 未作答, got ${this.items[1].userAnswerText}`);
  }
});

steps.then('the wrong item should be expanded by default', function () {
  if (!QuizExplanations.defaultExpanded(this.items[0])) {
    throw new Error('wrong item should expand by default');
  }
});

steps.then('the correct item should stay collapsed', function () {
  if (QuizExplanations.defaultExpanded(this.items[1])) {
    throw new Error('correct item should stay collapsed');
  }
});

steps.then('only the known item should carry an explanation', function () {
  if (this.merged[0].explanation !== '因为甲成立，乙不成立。') {
    throw new Error(`known item missing explanation, got ${this.merged[0].explanation}`);
  }
  if (this.merged[1].explanation !== null) {
    throw new Error('second item should have no explanation');
  }
});

steps.then('the unknown id should be ignored', function () {
  if (this.merged.length !== this.items.length) {
    throw new Error(`merge changed item count: ${this.merged.length}`);
  }
});

steps.then('the item should still expose its correct option text', function () {
  if (this.merged[0].correctText !== '正确答案甲') {
    throw new Error(`expected 正确答案甲, got ${this.merged[0].correctText}`);
  }
});

steps.then('one explanation should be reported missing', function () {
  if (QuizExplanations.missingExplanationCount(this.merged) !== 1) {
    throw new Error('expected exactly one missing explanation');
  }
});

steps.then('the cache file name should end with explanations.json', function () {
  if (!this.cacheName.endsWith('.explanations.json')) {
    throw new Error(`unexpected cache name: ${this.cacheName}`);
  }
  if (!this.cacheName.includes('03-mechanics')) {
    throw new Error(`cache name lost chapter identity: ${this.cacheName}`);
  }
});

steps.then('the cache file should round-trip through a real learning directory', function () {
  if (!this.roundTrip || this.roundTrip.explanations[0].explanation !== '解析正文') {
    throw new Error('cache payload did not round-trip');
  }
});

steps.then('the result card should contain the explanation button', function () {
  if (!this.cardSrc.includes('quizExplainBtn')) {
    throw new Error('结果卡片缺少 📖 解析 按钮');
  }
  if (!this.cardSrc.includes('quizExplainPanel')) {
    throw new Error('结果卡片缺少解析面板容器');
  }
});

steps.then('the result card should call the explanation command', function () {
  if (!this.cardSrc.includes('generate_quiz_explanations')) {
    throw new Error('结果卡片未调用 generate_quiz_explanations');
  }
});

steps.then('quiz-explanations.js should load before mode-integration.js', function () {
  const explainIdx = this.indexSrc.indexOf('scripts/learning/quiz-explanations.js');
  const integrationIdx = this.indexSrc.indexOf('scripts/learning/mode-integration.js');
  if (explainIdx < 0) {
    throw new Error('index.html 未加载 quiz-explanations.js');
  }
  if (explainIdx > integrationIdx) {
    throw new Error('quiz-explanations.js 必须在 mode-integration.js 之前加载');
  }
});

steps._cleanup = function () {
  // nothing global to clean; temp dirs are left to the OS
};

module.exports = steps;
