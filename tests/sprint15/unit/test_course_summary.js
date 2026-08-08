#!/usr/bin/env node
// -*- coding: utf-8 -*-
/**
 * TDD Tests for course-summary.js（学完课程生成 slide 总结的纯函数）
 *
 * 覆盖：isCourseCompleted / getSummaryPath / shouldOfferSummary
 * 纯函数无 DOM 依赖，直接 require 真实模块。
 */

const TestRunner = require('../../shared/test-runner');
const CourseSummary = require('../../../dist/scripts/learning/course-summary');

const { isCourseCompleted, getSummaryPath, shouldOfferSummary, SUMMARY_FILE } = CourseSummary;

// ============================================
// isCourseCompleted
// ============================================
TestRunner.test('全部章节 completed → true', () => {
  const manager = { chapters: [{ status: 'completed' }, { status: 'completed' }] };
  TestRunner.assertEquals(isCourseCompleted(manager), true);
});

TestRunner.test('任一章节未 completed → false', () => {
  const manager = { chapters: [{ status: 'completed' }, { status: 'ready' }] };
  TestRunner.assertEquals(isCourseCompleted(manager), false);
});

TestRunner.test('无章节 / 空 manager → false', () => {
  TestRunner.assertEquals(isCourseCompleted({ chapters: [] }), false);
  TestRunner.assertEquals(isCourseCompleted(null), false);
  TestRunner.assertEquals(isCourseCompleted(undefined), false);
  TestRunner.assertEquals(isCourseCompleted({}), false);
});

TestRunner.test('completed 之外的任意状态（含 generating/failed）→ false', () => {
  const manager = { chapters: [{ status: 'completed' }, { status: 'failed' }] };
  TestRunner.assertEquals(isCourseCompleted(manager), false);
});

// ============================================
// getSummaryPath
// ============================================
TestRunner.test('拼接项目路径 + 固定文件名', () => {
  TestRunner.assertEquals(getSummaryPath('C:/proj'), 'C:/proj/' + SUMMARY_FILE);
  TestRunner.assertEquals(getSummaryPath('C:\\proj\\'), 'C:\\proj/' + SUMMARY_FILE);
});

TestRunner.test('空路径兜底', () => {
  TestRunner.assertEquals(getSummaryPath(''), SUMMARY_FILE);
  TestRunner.assertEquals(getSummaryPath(null), SUMMARY_FILE);
});

// ============================================
// shouldOfferSummary（决策矩阵）
// ============================================
TestRunner.test('学完 + 未提示 + 无文件 → 提示', () => {
  const manager = { chapters: [{ status: 'completed' }, { status: 'completed' }] };
  TestRunner.assertEquals(shouldOfferSummary(manager, false, false), true);
});

TestRunner.test('本会话已提示过 → 不重复', () => {
  const manager = { chapters: [{ status: 'completed' }] };
  TestRunner.assertEquals(shouldOfferSummary(manager, true, false), false);
});

TestRunner.test('总结文件已存在 → 不弹（走按钮/侧边栏回看）', () => {
  const manager = { chapters: [{ status: 'completed' }] };
  TestRunner.assertEquals(shouldOfferSummary(manager, false, true), false);
});

TestRunner.test('课程未学完 → 不弹', () => {
  const manager = { chapters: [{ status: 'completed' }, { status: 'ready' }] };
  TestRunner.assertEquals(shouldOfferSummary(manager, false, false), false);
});

TestRunner.run();
