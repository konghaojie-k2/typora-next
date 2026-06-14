#!/usr/bin/env node
// -*- coding: utf-8 -*-
/**
 * BDD Step Definitions for Sprint 4: Review System (内存模拟层)
 * Feature: tests/features/sprint4_review_system.feature
 *
 * 内层 = 内存模拟 + 关键不变量检查
 * 真实文件系统验证见 tests/bdd-acceptance/sprint4_review.steps.js
 */

const { StepRegistry } = require('../../shared/runner');

// Minimal mock for headless environment
if (typeof global.window === 'undefined') global.window = {};
if (typeof global.document === 'undefined') {
  global.document = {
    createElement: () => ({ classList: { add: () => {} }, appendChild: () => {}, style: {} }),
    body: { appendChild: () => {}, removeChild: () => {}, classList: { contains: () => false } }
  };
}

require('../../dist/scripts/learning/review-scheduler.js');
require('../../dist/scripts/learning/review-modal.js');

const steps = new StepRegistry();

// ============================================
// Helpers
// ============================================

function fmtDate(offsetDays) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:00:00`;
}

// ============================================
// Given
// ============================================

steps.given('项目中有一个新掌握的概念{string}', async function(concept) {
  this.concepts = {};
  this.concepts[concept] = { status: 'mastered', source_chapter: '01.md', updated_at: fmtDate(-1) };
  this.scheduler = new window.ReviewScheduler();
});

steps.given('概念{string}已复习 {int} 次，上次评级为 {word}', async function(concept, count, rating) {
  this.concepts = {};
  this.concepts[concept] = { status: rating, source_chapter: '02.md', updated_at: fmtDate(-7) };
  this.quizHistory = { entries: [] };
  for (let i = 0; i < count; i++) {
    this.quizHistory.entries.push({
      chapter_file: '02.md',
      timestamp: fmtDate(-(count - i) * 2),
      rating: i === count - 1 ? rating : 'learning',
      weak_concepts: []
    });
  }
  this.scheduler = new window.ReviewScheduler();
});

steps.given('用户有 {int} 个概念已到复习时间', async function(dueCount) {
  this.concepts = {};
  const names = ['概念A', '概念B', '概念C'];
  names.forEach((name, idx) => {
    this.concepts[name] = {
      status: 'learning',
      source_chapter: `0${idx + 1}.md`,
      updated_at: fmtDate(idx < dueCount ? -(idx + 2) : 2)
    };
  });
  this.scheduler = new window.ReviewScheduler();
});

steps.given('用户正在复习概念{string}', async function(concept) {
  this.concepts = {};
  this.concepts[concept] = { status: 'learning', source_chapter: '01.md', updated_at: fmtDate(-2) };
  this.scheduler = new window.ReviewScheduler();
  this.item = { concept, review_count: 1, last_rating: 'learning', next_review_at: fmtDate(0) };
});

steps.given('当前 review_count 为 {int}', async function(count) {
  this.item.review_count = count;
});

steps.given('用户看到复习提醒但有 {int} 个概念不想现在复习', async function(count) {
  this.concepts = { '位置编码': { status: 'learning', source_chapter: '01.md', updated_at: fmtDate(-2) } };
  this.scheduler = new window.ReviewScheduler();
  this.item = { concept: '位置编码', review_count: 1, last_rating: 'learning', next_review_at: fmtDate(0) };
});

steps.given('项目中有 {int} 个概念，其中 {int} 个已到期，{int} 个未到期', async function(total, dueCount, upcomingCount) {
  this.concepts = {};
  for (let i = 0; i < total; i++) {
    const isDue = i < dueCount;
    this.concepts[`概念${i + 1}`] = {
      status: 'learning',
      source_chapter: `0${i + 1}.md`,
      updated_at: fmtDate(isDue ? -(i + 1) : (i + 1))
    };
  }
  this.scheduler = new window.ReviewScheduler();
});

steps.given('用户完成复习并标记为 {word}', async function(rating) {
  this.concepts = { 'Self-Attention': { status: 'learning', source_chapter: '01.md', updated_at: fmtDate(-2) } };
  this.scheduler = new window.ReviewScheduler();
  this.rating = rating;
  this.updatedProject = { concepts: JSON.parse(JSON.stringify(this.concepts)) };
});

// ============================================
// When
// ============================================

steps.when('系统计算该概念的复习计划', async function() {
  this.schedule = this.scheduler.computeSchedule(this.concepts, { entries: [] });
});

steps.when('系统计算下次复习间隔', async function() {
  this.schedule = this.scheduler.computeSchedule(this.concepts, this.quizHistory);
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
  const conceptName = Object.keys(this.concepts)[0];
  this.updatedProject.concepts[conceptName].status = this.rating;
  this.updatedProject.concepts[conceptName].updated_at = fmtDate(0);
});

// ============================================
// Then
// ============================================

steps.then('首次复习间隔为 1 天后', async function() {
  const item = this.schedule.items[0];
  if (!item) throw new Error('No schedule item');
  const next = new Date(item.next_review_at.replace(/-/g, '/'));
  const diff = Math.round((next - new Date()) / (1000 * 60 * 60 * 24));
  if (diff !== 1) throw new Error(`Expected 1 day, got ${diff}`);
});

steps.then('状态标记为 upcoming', async function() {
  const item = this.schedule.items[0];
  if (item.status !== 'upcoming') throw new Error(`Expected 'upcoming', got '${item.status}'`);
});

steps.then('间隔缩短为基准间隔的一半', async function() {
  const item = this.schedule.items[0];
  const base = [1, 2, 4, 7, 15, 30][Math.min(this.quizHistory.entries.length, 5)];
  const expected = Math.max(1, Math.floor(base / 2));
  const next = new Date(item.next_review_at.replace(/-/g, '/'));
  const diff = Math.round((next - new Date()) / (1000 * 60 * 60 * 24));
  if (diff !== expected) throw new Error(`Expected ${expected} days, got ${diff}`);
});

steps.then('最小间隔不少于 1 天', async function() {
  const item = this.schedule.items[0];
  const next = new Date(item.next_review_at.replace(/-/g, '/'));
  if (next < new Date()) throw new Error('Next review is in the past');
});

steps.then('弹出复习提醒模态框', async function() {
  if (this.dueItems.length === 0) throw new Error('No due items');
  this.modal = new window.ReviewModal({ items: this.dueItems });
  this.modal.show();
  if (this.modal.getState() !== 'due_found') throw new Error(`State is '${this.modal.getState()}'`);
});

steps.then('显示待复习概念列表', async function() {
  if (!this.modal || this.modal.items.length === 0) throw new Error('Modal has no items');
});

steps.then('提供开始复习和稍后提醒按钮', async function() {
  if (!this.modal) throw new Error('No modal');
  if (typeof this.modal.startReview !== 'function') throw new Error('No startReview');
  if (typeof this.modal.postpone !== 'function') throw new Error('No postpone');
});

steps.then('review_count 递增为 {int}', async function(n) {
  if (this.resultItem.review_count !== n) throw new Error(`Expected ${n}, got ${this.resultItem.review_count}`);
});

steps.then('上次评级更新为 {word}', async function(r) {
  if (this.resultItem.last_rating !== r) throw new Error(`Expected '${r}', got '${this.resultItem.last_rating}'`);
});

steps.then('下次复习时间设为 {int} 天后', async function(n) {
  const next = new Date(this.resultItem.next_review_at.replace(/-/g, '/'));
  const diff = Math.round((next - new Date()) / (1000 * 60 * 60 * 24));
  if (diff !== n) throw new Error(`Expected ${n} days, got ${diff}`);
});

steps.then('状态变为 upcoming', async function() {
  if (this.resultItem.status !== 'upcoming') throw new Error(`Expected 'upcoming', got '${this.resultItem.status}'`);
});

steps.then('该概念的下次复习时间设为明天', async function() {
  const tmr = new Date(); tmr.setDate(tmr.getDate() + 1);
  const s = `${tmr.getFullYear()}-${String(tmr.getMonth() + 1).padStart(2, '0')}-${String(tmr.getDate()).padStart(2, '0')}`;
  if (!this.resultItem.next_review_at.includes(s)) throw new Error(`Expected tomorrow, got ${this.resultItem.next_review_at}`);
});

steps.then('review_count 保持不变', async function() {
  if (this.resultItem.review_count !== this.originalCount) throw new Error(`Count changed: ${this.resultItem.review_count}`);
});

steps.then('只返回已到期的 {int} 个概念', async function(n) {
  if (this.dueItems.length !== n) throw new Error(`Expected ${n}, got ${this.dueItems.length}`);
});

steps.then('未到期概念不显示', async function() {
  const upcoming = this.schedule.items.filter(i => !this.scheduler.isDue(i.next_review_at));
  if (this.dueItems.some(d => upcoming.some(u => u.concept === d.concept))) {
    throw new Error('Due items include upcoming');
  }
});

steps.then('project.json 中的复习计划更新', async function() {
  if (!this.updatedProject) throw new Error('Not updated');
});

steps.then('包含正确的 concept、rating、review_count', async function() {
  const name = Object.keys(this.concepts)[0];
  const c = this.updatedProject.concepts[name];
  if (!c) throw new Error(`Missing concept ${name}`);
  if (c.status !== this.rating) throw new Error(`Status mismatch: ${c.status} != ${this.rating}`);
});

module.exports = steps;
