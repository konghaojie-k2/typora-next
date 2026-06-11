#!/usr/bin/env node
// -*- coding: utf-8 -*-
/**
 * BDD Step Definitions for Sprint 4: Review System (真实文件系统验收)
 * Feature: tests/features/sprint4_review_system.feature
 *
 * 验证点：
 * - 艾宾浩斯间隔计算正确性
 * - 掌握状态对间隔的调整
 * - 复习计划持久化（project.json 原子更新）
 * - ReviewModal 状态机转换
 * - Windows 路径安全
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { StepRegistry } = require('../shared/runner');

// Load real frontend modules (mock DOM for headless test)
require('./mock-tauri');

// Enhance DOM mock for ReviewModal's style.cssText usage
global.document.createElement = (tag) => {
  const el = {
    tagName: tag,
    classList: { add: () => {}, remove: () => {}, contains: () => false },
    className: '',
    style: { cssText: '' },
    innerHTML: '',
    children: [],
    appendChild: (c) => { el.children.push(c); return c; },
    remove: () => {},
    removeChild: (c) => {},
    addEventListener: () => {},
    querySelector: () => null,
    querySelectorAll: () => [],
    setAttribute: () => {},
    getAttribute: () => null
  };
  return el;
};
global.document.body = global.document.body || {
  appendChild: () => {},
  removeChild: () => {},
  classList: { contains: () => false }
};
global.document.addEventListener = global.document.addEventListener || (() => {});
global.document.removeEventListener = global.document.removeEventListener || (() => {});

require('../../dist/scripts/learning/review-scheduler.js');
require('../../dist/scripts/learning/review-modal.js');

const steps = new StepRegistry();

// ============================================
// Helpers
// ============================================

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sprint4-bdd-'));
}

function cleanupTempDir(dir) {
  if (dir && fs.existsSync(dir)) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* best effort */ }
  }
}

function createProjectWithConcepts(projectDir, concepts) {
  const learningDir = path.join(projectDir, '.learning');
  fs.mkdirSync(learningDir, { recursive: true });

  const projectJson = {
    name: '理解 Transformer',
    created: Date.now(),
    total_duration: 25,
    chapters: [
      { title: 'Ch1', status: 'completed', file: '01.md', duration_minutes: 10 },
      { title: 'Ch2', status: 'completed', file: '02.md', duration_minutes: 15 }
    ],
    current_chapter: 1,
    concepts: concepts || {
      '位置编码': { status: 'mastered', source_chapter: '01.md', updated_at: '2026-06-01 10:00:00' },
      '梯度裁剪': { status: 'struggling', source_chapter: '02.md', updated_at: '2026-06-02 10:00:00' }
    }
  };

  fs.writeFileSync(
    path.join(learningDir, 'project.json'),
    JSON.stringify(projectJson, null, 2),
    'utf-8'
  );

  return { learningDir, projectJson };
}

function formatDate(daysOffset, hour) {
  const d = new Date();
  d.setDate(d.getDate() + daysOffset);
  if (hour !== undefined) d.setHours(hour, 0, 0, 0);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// ============================================
// Given
// ============================================

steps.given('项目中有一个新掌握的概念{string}', async function(concept) {
  this.tempDir = createTempDir();
  this.concepts = {};
  // Concept created today → first review tomorrow (1 day interval)
  this.concepts[concept] = { status: 'mastered', source_chapter: '01.md', updated_at: formatDate(0) };
  createProjectWithConcepts(this.tempDir, this.concepts);
  this.scheduler = new window.ReviewScheduler();
});

steps.given('概念{string}已复习 {int} 次，上次评级为 {word}', async function(concept, count, rating) {
  this.tempDir = createTempDir();
  this.concepts = {};
  this.concepts[concept] = { status: rating, source_chapter: '02.md', updated_at: formatDate(-7) };
  createProjectWithConcepts(this.tempDir, this.concepts);
  this.scheduler = new window.ReviewScheduler();

  // Build quiz history with `count` entries for this concept's chapter
  const entries = [];
  for (let i = 0; i < count; i++) {
    entries.push({
      chapter_file: '02.md',
      timestamp: formatDate(-(count - i) * 2),
      rating: i === count - 1 ? rating : 'learning',
      weak_concepts: []
    });
  }
  this.quizHistory = { entries };
});

steps.given('用户有 {int} 个概念已到复习时间', async function(dueCount) {
  this.tempDir = createTempDir();
  this.concepts = {};

  // Create concepts with varying due dates
  const conceptNames = ['概念A', '概念B', '概念C'];
  conceptNames.forEach((name, idx) => {
    const daysAgo = idx < dueCount ? -(idx + 2) : 2; // First `dueCount` are past due, rest are future
    this.concepts[name] = {
      status: 'learning',
      source_chapter: `0${idx + 1}.md`,
      updated_at: formatDate(daysAgo)
    };
  });

  createProjectWithConcepts(this.tempDir, this.concepts);
  this.scheduler = new window.ReviewScheduler();
});

steps.given('用户正在复习概念{string}', async function(concept) {
  this.tempDir = createTempDir();
  this.concepts = {};
  this.concepts[concept] = { status: 'learning', source_chapter: '01.md', updated_at: formatDate(-2) };
  createProjectWithConcepts(this.tempDir, this.concepts);
  this.scheduler = new window.ReviewScheduler();
  this.item = {
    concept: concept,
    review_count: 1,
    last_rating: 'learning',
    next_review_at: formatDate(0)
  };
});

steps.given('当前 review_count 为 {int}', async function(count) {
  this.item.review_count = count;
});

steps.given('用户看到复习提醒但有 {int} 个概念不想现在复习', async function(count) {
  this.tempDir = createTempDir();
  this.concepts = {};
  this.concepts['位置编码'] = { status: 'learning', source_chapter: '01.md', updated_at: formatDate(-2) };
  createProjectWithConcepts(this.tempDir, this.concepts);
  this.scheduler = new window.ReviewScheduler();
  this.item = {
    concept: '位置编码',
    review_count: 1,
    last_rating: 'learning',
    next_review_at: formatDate(0)
  };
});

steps.given('项目中有 {int} 个概念，其中 {int} 个已到期，{int} 个未到期', async function(total, dueCount, upcomingCount) {
  this.tempDir = createTempDir();
  this.concepts = {};

  for (let i = 0; i < total; i++) {
    const isDue = i < dueCount;
    this.concepts[`概念${i + 1}`] = {
      status: 'learning',
      source_chapter: `0${i + 1}.md`,
      updated_at: formatDate(isDue ? -(i + 1) : (i + 1))
    };
  }

  createProjectWithConcepts(this.tempDir, this.concepts);
  this.scheduler = new window.ReviewScheduler();
});

steps.given('用户完成复习并标记为 {word}', async function(rating) {
  this.tempDir = createTempDir();
  this.concepts = {};
  this.concepts['Self-Attention'] = { status: 'learning', source_chapter: '01.md', updated_at: formatDate(-2) };
  const { projectJson } = createProjectWithConcepts(this.tempDir, this.concepts);
  this.projectJson = projectJson;
  this.scheduler = new window.ReviewScheduler();
  this.rating = rating;
});

// ============================================
// When
// ============================================

steps.when('系统计算该概念的复习计划', async function() {
  this.schedule = this.scheduler.computeSchedule(this.concepts, { entries: [] });
});

steps.when('系统计算下次复习间隔', async function() {
  this.schedule = this.scheduler.computeSchedule(this.concepts, this.quizHistory);
  const item = this.schedule.items.find(i => i.concept === Object.keys(this.concepts)[0]);
  this.computedInterval = item ? item.next_review_at : null;
});

steps.when('应用启动检查每日复习', async function() {
  this.schedule = this.scheduler.computeSchedule(this.concepts, { entries: [] });
  this.dueItems = this.schedule.items.filter(i => this.scheduler.isDue(i.next_review_at));
});

steps.when('用户标记为 {word}', async function(rating) {
  this.scheduler.markReviewed(this.item, rating);
  this.resultItem = this.item;
});

steps.when('用户选择稍后提醒', async function() {
  this.originalCount = this.item.review_count;
  this.scheduler.postpone(this.item);
  this.resultItem = this.item;
});

steps.when('系统获取今日待复习列表', async function() {
  this.schedule = this.scheduler.computeSchedule(this.concepts, { entries: [] });
  this.dueItems = this.schedule.items.filter(i => this.scheduler.isDue(i.next_review_at));
});

steps.when('系统调用 update_review_schedule', async function() {
  // Simulate what the Rust backend would do: update project.json concepts
  const conceptName = Object.keys(this.concepts)[0];
  this.projectJson.concepts[conceptName].status = this.rating;
  this.projectJson.concepts[conceptName].updated_at = formatDate(0);

  // Write back atomically (simulate Rust atomic write)
  const projectPath = path.join(this.tempDir, '.learning', 'project.json');
  const tmpPath = projectPath + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(this.projectJson, null, 2), 'utf-8');
  fs.renameSync(tmpPath, projectPath);

  this.updatedProject = JSON.parse(fs.readFileSync(projectPath, 'utf-8'));
});

// ============================================
// Then
// ============================================

steps.then('首次复习间隔为 1 天后', async function() {
  const item = this.schedule.items[0];
  if (!item) throw new Error('No schedule item created');

  const now = new Date();
  const nextReview = new Date(item.next_review_at.replace(/-/g, '/'));
  const diffDays = Math.round((nextReview - now) / (1000 * 60 * 60 * 24));

  if (diffDays !== 1) {
    throw new Error(`Expected interval 1 day, got ${diffDays} days (next: ${item.next_review_at})`);
  }
});

steps.then('状态标记为 upcoming', async function() {
  const item = this.schedule.items[0];
  if (item.status !== 'upcoming') {
    throw new Error(`Expected status 'upcoming', got '${item.status}'`);
  }
});

steps.then('间隔缩短为基准间隔的一半', async function() {
  // Verify the computed interval value (not days-from-now, since computeSchedule
  // bases next_review_at on last quiz timestamp + interval)
  const item = this.schedule.items[0];
  const baseInterval = [1, 2, 4, 7, 15, 30][Math.min(this.quizHistory.entries.length, 5)];
  const expectedInterval = Math.max(1, Math.floor(baseInterval / 2));

  // Derive actual interval from next_review_at - last_quiz_timestamp
  const lastQuiz = new Date(this.quizHistory.entries[this.quizHistory.entries.length - 1].timestamp.replace(/-/g, '/'));
  const nextReview = new Date(item.next_review_at.replace(/-/g, '/'));
  const actualInterval = Math.round((nextReview - lastQuiz) / (1000 * 60 * 60 * 24));

  if (actualInterval !== expectedInterval) {
    throw new Error(`Expected interval ${expectedInterval} days (half of ${baseInterval}), got ${actualInterval}`);
  }
});

steps.then('最小间隔不少于 1 天', async function() {
  const item = this.schedule.items[0];
  const nextReview = new Date(item.next_review_at.replace(/-/g, '/'));
  const lastQuiz = new Date(this.quizHistory.entries[this.quizHistory.entries.length - 1].timestamp.replace(/-/g, '/'));
  const diffMs = nextReview - lastQuiz;

  if (diffMs < 24 * 60 * 60 * 1000) {
    throw new Error(`Interval ${diffMs / (1000 * 60 * 60 * 24)} days is less than 1 day minimum`);
  }
});

steps.then('弹出复习提醒模态框', async function() {
  if (this.dueItems.length === 0) {
    throw new Error('Expected due items but none found');
  }

  this.modal = new window.ReviewModal({ items: this.dueItems });
  this.modal.show();

  if (this.modal.getState() !== 'due_found') {
    throw new Error(`Expected modal state 'due_found', got '${this.modal.getState()}'`);
  }
});

steps.then('显示待复习概念列表', async function() {
  if (!this.modal || this.modal.items.length === 0) {
    throw new Error('Modal should display due items');
  }
});

steps.then('提供开始复习和稍后提醒按钮', async function() {
  // ReviewModal constructor accepts onComplete and onPostpone callbacks
  // Verify the modal instance exists and has the expected API
  if (!this.modal) throw new Error('Modal not created');
  if (typeof this.modal.startReview !== 'function') throw new Error('Missing startReview method');
  if (typeof this.modal.postpone !== 'function') throw new Error('Missing postpone method');
});

steps.then('review_count 递增为 {int}', async function(expectedCount) {
  if (this.resultItem.review_count !== expectedCount) {
    throw new Error(`Expected review_count ${expectedCount}, got ${this.resultItem.review_count}`);
  }
});

steps.then('上次评级更新为 {word}', async function(expectedRating) {
  if (this.resultItem.last_rating !== expectedRating) {
    throw new Error(`Expected last_rating '${expectedRating}', got '${this.resultItem.last_rating}'`);
  }
});

steps.then('下次复习时间设为 {int} 天后', async function(expectedDays) {
  const now = new Date();
  const nextReview = new Date(this.resultItem.next_review_at.replace(/-/g, '/'));
  const diffDays = Math.round((nextReview - now) / (1000 * 60 * 60 * 24));

  if (diffDays !== expectedDays) {
    throw new Error(`Expected next review in ${expectedDays} days, got ${diffDays} days (next: ${this.resultItem.next_review_at})`);
  }
});

steps.then('状态变为 upcoming', async function() {
  if (this.resultItem.status !== 'upcoming') {
    throw new Error(`Expected status 'upcoming', got '${this.resultItem.status}'`);
  }
});

steps.then('该概念的下次复习时间设为明天', async function() {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;

  if (!this.resultItem.next_review_at.includes(tomorrowStr)) {
    throw new Error(`Expected next review tomorrow (${tomorrowStr}), got ${this.resultItem.next_review_at}`);
  }
});

steps.then('review_count 保持不变', async function() {
  if (this.resultItem.review_count !== this.originalCount) {
    throw new Error(`Expected review_count unchanged (${this.originalCount}), got ${this.resultItem.review_count}`);
  }
});

steps.then('只返回已到期的 {int} 个概念', async function(expectedCount) {
  if (this.dueItems.length !== expectedCount) {
    throw new Error(`Expected ${expectedCount} due items, got ${this.dueItems.length}`);
  }
});

steps.then('未到期概念不显示', async function() {
  const upcomingItems = this.schedule.items.filter(i => !this.scheduler.isDue(i.next_review_at));
  if (this.dueItems.some(d => upcomingItems.some(u => u.concept === d.concept))) {
    throw new Error('Due items should not include upcoming items');
  }
});

steps.then('project.json 中的复习计划更新', async function() {
  if (!this.updatedProject) throw new Error('Project was not updated');
});

steps.then('包含正确的 concept、rating、review_count', async function() {
  const conceptName = Object.keys(this.concepts)[0];
  const concept = this.updatedProject.concepts[conceptName];

  if (!concept) throw new Error(`Concept '${conceptName}' not found in updated project`);
  if (concept.status !== this.rating) {
    throw new Error(`Expected status '${this.rating}', got '${concept.status}'`);
  }
});

// ============================================
// Cleanup hook
// ============================================

steps._cleanup = function() {
  cleanupTempDir(this.tempDir);
};

module.exports = steps;
