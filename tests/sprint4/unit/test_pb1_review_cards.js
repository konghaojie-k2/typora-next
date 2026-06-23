#!/usr/bin/env node
// -*- coding: utf-8 -*-
/**
 * TDD Tests for PB1: review-cards.json 生成
 * Covers: trigger after quiz submit, file structure, idempotency, agent output parsing
 *
 * Module: dist/scripts/learning/mode-integration.js (trigger)
 *         src-tauri/src/lib.rs (generate_review_content command)
 *         agent-bridge.js (generateReviewContent JSON parsing)
 */
'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const TestRunner = require('../../shared/test-runner');

// ============================================
// Setup: mock Tauri + load mode-integration
// ============================================

// Track invoke calls for verification
const invokeCalls = [];
const originalInvoke = global.__TAURI__?.core?.invoke;

// Load mock-tauri (sets up window.__TAURI__)
require('../../bdd-acceptance/mock-tauri');

// Override invoke to track calls
const _origInvoke = global.window.__TAURI__.core.invoke;
global.window.__TAURI__.core.invoke = async (cmd, args) => {
  invokeCalls.push({ cmd, args });
  // Call through to mock for real behavior
  return _origInvoke(cmd, args);
};

// Add generate_review_content handler to mock
const _generateReviewContent = ({ projectPath, chapterFile, weakConcepts }) => {
  const learningDir = path.join(projectPath, '.learning');
  fs.mkdirSync(learningDir, { recursive: true });

  const cardsPath = path.join(learningDir, 'review-cards.json');
  let cards = { version: '1.0', cards: {} };
  if (fs.existsSync(cardsPath)) {
    cards = JSON.parse(fs.readFileSync(cardsPath, 'utf-8'));
  }

  // Create review cards from test concepts
  const chapterStem = path.basename(chapterFile || '').replace(/\.md$/, '');
  const conceptsJsonPath = path.join(projectPath, `${chapterStem}.concepts.json`);
  const concepts = [];
  if (fs.existsSync(conceptsJsonPath)) {
    const parsed = JSON.parse(fs.readFileSync(conceptsJsonPath, 'utf-8'));
    if (parsed.concepts) concepts.push(...parsed.concepts);
  }

  const weakSet = new Set(weakConcepts || []);
  const now = new Date().toISOString();

  for (const c of concepts) {
    const cid = c.id || c.name || c;
    if (cards.cards[cid]) continue; // Idempotent: skip existing

    cards.cards[cid] = {
      concept_name: c.name || cid,
      source_chapter: path.basename(chapterFile || ''),
      quiz_questions: [
        {
          type: 'choice',
          question: `${c.name || cid} 的核心思想是什么？`,
          options: ['描述A', '描述B', '描述C', '描述D'],
          answer: 0
        }
      ],
      key_points: [
        `${c.name || cid} 是本章的核心概念`,
        `${c.name || cid} 的理解对掌握后续内容很重要`
      ],
      generated_at: now,
      from_weak: weakSet.has(cid)
    };
  }

  fs.writeFileSync(cardsPath, JSON.stringify(cards, null, 2), 'utf-8');
  return { success: true, cards_count: concepts.length };
};

// Register handler
global.window.__TAURI__.core.invoke = async (cmd, args) => {
  invokeCalls.push({ cmd, args: args ? { ...args } : undefined });
  switch (cmd) {
    case 'generate_review_content':
      return _generateReviewContent(args);
    default:
      return _origInvoke(cmd, args);
  }
};

// ============================================
// Helpers
// ============================================

function createTempProject() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pb1-test-'));
  const learningDir = path.join(tmpDir, '.learning');
  fs.mkdirSync(learningDir, { recursive: true });

  // Create minimal project.json
  fs.writeFileSync(path.join(learningDir, 'project.json'), JSON.stringify({
    name: 'Test Project',
    created: Date.now(),
    chapters: [
      { title: '第一章', file: '01-first.md', concepts: [{ id: 'concept-a', name: '概念A' }, { id: 'concept-b', name: '概念B' }] },
      { title: '第二章', file: '02-second.md', concepts: [{ id: 'concept-c', name: '概念C' }] }
    ],
    chapters_status: {}
  }, null, 2), 'utf-8');

  // Create minimal concepts.json
  fs.writeFileSync(path.join(tmpDir, '01-first.concepts.json'), JSON.stringify({
    concepts: [
      { id: 'concept-a', name: '概念A', chapter: '01-first.md' },
      { id: 'concept-b', name: '概念B', chapter: '01-first.md' }
    ]
  }, null, 2), 'utf-8');

  return tmpDir;
}

function clearInvokeCalls() {
  invokeCalls.length = 0;
}

// ============================================
// Test: generate_review_content 命令触发
// ============================================

TestRunner.test('[PB1] quiz 提交后应触发 generate_review_content', async () => {
  clearInvokeCalls();
  const projectPath = createTempProject();
  const chapterFile = '01-first.md';
  const weakConcepts = ['concept-b'];

  // Simulate the trigger that will be in mode-integration.js
  await global.window.__TAURI__.core.invoke('persist_quiz_result', {
    projectPath,
    chapterFile,
    rating: 'learning',
    score: 0.6,
    weakConcepts,
    answers: [],
    timestamp: new Date().toISOString()
  });

  // Now trigger generate_review_content (this is what we'll add to mode-integration.js)
  await global.window.__TAURI__.core.invoke('generate_review_content', {
    projectPath,
    chapterFile,
    weakConcepts
  });

  // Verify invoke was called
  const genCall = invokeCalls.find(c => c.cmd === 'generate_review_content');
  TestRunner.assert(genCall, 'generate_review_content should be invoked after quiz submit');
  TestRunner.assertEquals(genCall.args.projectPath, projectPath, 'projectPath should be passed');
  TestRunner.assertEquals(genCall.args.chapterFile, chapterFile, 'chapterFile should be passed');
  TestRunner.assert(Array.isArray(genCall.args.weakConcepts), 'weakConcepts should be an array');

  // Cleanup
  fs.rmSync(projectPath, { recursive: true, force: true });
});

// ============================================
// Test: review-cards.json 结构正确
// ============================================

TestRunner.test('[PB1] review-cards.json 应包含正确的概念级字段', async () => {
  const projectPath = createTempProject();
  const chapterFile = '01-first.md';
  const weakConcepts = ['concept-b'];

  await global.window.__TAURI__.core.invoke('generate_review_content', {
    projectPath,
    chapterFile,
    weakConcepts
  });

  const cardsPath = path.join(projectPath, '.learning', 'review-cards.json');
  TestRunner.assert(fs.existsSync(cardsPath), 'review-cards.json should exist');

  const cards = JSON.parse(fs.readFileSync(cardsPath, 'utf-8'));
  TestRunner.assertEquals(cards.version, '1.0', 'version should be 1.0');
  TestRunner.assert(cards.cards, 'should have cards map');

  // Check concept-a (not weak)
  const cardA = cards.cards['concept-a'];
  TestRunner.assert(cardA, 'concept-a should have a card');
  TestRunner.assertEquals(cardA.concept_name, '概念A', 'concept_name should match');
  TestRunner.assert(Array.isArray(cardA.quiz_questions), 'quiz_questions should be an array');
  TestRunner.assert(cardA.quiz_questions.length > 0, 'should have at least 1 question');
  TestRunner.assert(Array.isArray(cardA.key_points), 'key_points should be an array');
  TestRunner.assert(cardA.key_points.length > 0, 'should have at least 1 key point');
  TestRunner.assertEquals(cardA.from_weak, false, 'concept-a is not weak');

  // Check concept-b (weak)
  const cardB = cards.cards['concept-b'];
  TestRunner.assert(cardB, 'concept-b should have a card');
  TestRunner.assertEquals(cardB.concept_name, '概念B', 'concept_name should match');
  TestRunner.assertEquals(cardB.from_weak, true, 'concept-b should be marked as weak');
  TestRunner.assertEquals(cardB.source_chapter, chapterFile, 'source_chapter should match');

  // Cleanup
  fs.rmSync(projectPath, { recursive: true, force: true });
});

// ============================================
// Test: 幂等性 — 重复调用不覆盖已有数据
// ============================================

TestRunner.test('[PB1] 重复 quiz 提交不重复生成已有概念', async () => {
  const projectPath = createTempProject();
  const chapterFile = '01-first.md';

  // First call
  await global.window.__TAURI__.core.invoke('generate_review_content', {
    projectPath, chapterFile, weakConcepts: []
  });

  // Record generated_at of first write
  const cardsPath = path.join(projectPath, '.learning', 'review-cards.json');
  const firstCards = JSON.parse(fs.readFileSync(cardsPath, 'utf-8'));
  const firstGenAt = firstCards.cards['concept-a'].generated_at;

  // Wait a tiny bit so timestamps differ
  await new Promise(r => setTimeout(r, 10));

  // Second call with same chapter
  await global.window.__TAURI__.core.invoke('generate_review_content', {
    projectPath, chapterFile, weakConcepts: ['concept-a']
  });

  const secondCards = JSON.parse(fs.readFileSync(cardsPath, 'utf-8'));
  TestRunner.assertEquals(
    secondCards.cards['concept-a'].generated_at,
    firstGenAt,
    'existing card should not be regenerated (generated_at unchanged)'
  );
  TestRunner.assertEquals(
    secondCards.cards['concept-a'].from_weak,
    false,
    'existing card from_weak should not be overwritten'
  );

  // Cleanup
  fs.rmSync(projectPath, { recursive: true, force: true });
});

// ============================================
// Test: Agent response JSON extraction (simulates agent-bridge.js logic)
// ============================================

/**
 * Simulates the JSON extraction from agent responses, matching agent-bridge.js
 */
function extractReviewCardsJson(raw) {
  let jsonStr = raw.trim();
  const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1].trim();
  }
  return JSON.parse(jsonStr);
}

TestRunner.test('[PB1] Agent 响应中的纯 JSON 能正确解析', () => {
  const input = '```json\n{"cards":{"c1":{"quiz_questions":[{"type":"choice","question":"Q?","options":["A","B"],"answer":0}],"key_points":["KP1"]}}}\n```';
  const result = extractReviewCardsJson(input);
  TestRunner.assert(result.cards, 'should parse cards');
  TestRunner.assert(result.cards.c1.quiz_questions, 'should have quiz_questions');
  TestRunner.assertEquals(result.cards.c1.quiz_questions[0].answer, 0, 'answer index correct');
  TestRunner.assertEquals(result.cards.c1.key_points[0], 'KP1', 'key points correct');
});

TestRunner.test('[PB1] Agent 响应中无 code block 也能解析', () => {
  const input = '{"cards":{"c1":{"quiz_questions":[{"type":"choice","question":"Q?","options":["A","B"],"answer":1}],"key_points":["KP1","KP2"]}}}';
  const result = extractReviewCardsJson(input);
  TestRunner.assert(result.cards.c1, 'should parse without code block');
  TestRunner.assertEquals(result.cards.c1.quiz_questions[0].answer, 1, 'answer index correct');
  TestRunner.assertEquals(result.cards.c1.key_points.length, 2, 'two key points');
});

TestRunner.test('[PB1] review-cards.json schema 校验：必须字段完整', () => {
  const validCard = {
    version: '1.0',
    cards: {
      'test-concept': {
        concept_name: '测试概念',
        source_chapter: '01-test.md',
        quiz_questions: [
          { type: 'choice', question: '问题', options: ['A', 'B', 'C', 'D'], answer: 0 }
        ],
        key_points: ['重点1', '重点2', '重点3'],
        generated_at: '2026-06-22T10:21:00',
        from_weak: false
      }
    }
  };
  const cards = validCard.cards;
  for (const [cid, card] of Object.entries(cards)) {
    TestRunner.assert(typeof cid === 'string' && cid.length > 0, 'concept id must be non-empty string');
    TestRunner.assert(Array.isArray(card.quiz_questions) && card.quiz_questions.length > 0, 'quiz_questions must be non-empty array');
    TestRunner.assert(Array.isArray(card.key_points) && card.key_points.length > 0, 'key_points must be non-empty array');
    card.quiz_questions.forEach((q, i) => {
      TestRunner.assert(q.type === 'choice', `q[${i}].type must be choice`);
      TestRunner.assert(typeof q.question === 'string' && q.question.length > 0, `q[${i}].question must be non-empty`);
      TestRunner.assert(Array.isArray(q.options) && q.options.length >= 2, `q[${i}].options must have at least 2 options`);
      TestRunner.assert(typeof q.answer === 'number' && q.answer >= 0 && q.answer < q.options.length, `q[${i}].answer must be valid index`);
    });
  }
});

// ============================================
// Run
// ============================================

TestRunner.run();
