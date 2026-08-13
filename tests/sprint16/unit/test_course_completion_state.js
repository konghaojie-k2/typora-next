#!/usr/bin/env node
// -*- coding: utf-8 -*-
/**
 * TDD Tests for 课程完结状态（Sprint 16）
 *
 * 覆盖 course-summary.js 新增纯函数：
 * - isProjectCourseCompleted(project)：读侧派生（course_status 字段 / chapters_status 全完成）
 * - getReviewEntrySpec(courseCompleted, dueCount)：dashboard 复习入口展示决策
 */

const TestRunner = require('../../shared/test-runner');
const CourseSummary = require('../../../dist/scripts/learning/course-summary');

const { isProjectCourseCompleted, getReviewEntrySpec } = CourseSummary;

// ============================================
// isProjectCourseCompleted
// ============================================
TestRunner.test('course_status=completed → true（无论章节状态）', () => {
  const project = {
    course_status: 'completed',
    chapters: [{ file: '01-a.md' }],
    chapters_status: {}
  };
  TestRunner.assertEquals(isProjectCourseCompleted(project), true);
});

TestRunner.test('全部章节 completed（英文）→ true', () => {
  const project = {
    chapters: [{ file: '01-a.md' }, { file: '02-b.md' }],
    chapters_status: { '01-a.md': 'completed', '02-b.md': 'completed' }
  };
  TestRunner.assertEquals(isProjectCourseCompleted(project), true);
});

TestRunner.test('全部章节 已完成（中文存量）→ true', () => {
  const project = {
    chapters: [{ file: '01-a.md' }, { file: '02-b.md' }],
    chapters_status: { '01-a.md': '已完成', '02-b.md': '已完成' }
  };
  TestRunner.assertEquals(isProjectCourseCompleted(project), true);
});

TestRunner.test('任一章节未完成 → false', () => {
  const project = {
    chapters: [{ file: '01-a.md' }, { file: '02-b.md' }],
    chapters_status: { '01-a.md': 'completed', '02-b.md': 'ready' }
  };
  TestRunner.assertEquals(isProjectCourseCompleted(project), false);
});

TestRunner.test('章节不在 chapters_status 中 → false', () => {
  const project = {
    chapters: [{ file: '01-a.md' }, { file: '02-b.md' }],
    chapters_status: { '01-a.md': 'completed' }
  };
  TestRunner.assertEquals(isProjectCourseCompleted(project), false);
});

TestRunner.test('空章节 / 空 project / null → false', () => {
  TestRunner.assertEquals(isProjectCourseCompleted({ chapters: [], chapters_status: {} }), false);
  TestRunner.assertEquals(isProjectCourseCompleted({}), false);
  TestRunner.assertEquals(isProjectCourseCompleted(null), false);
  TestRunner.assertEquals(isProjectCourseCompleted(undefined), false);
});

// ============================================
// getReviewEntrySpec
// ============================================
TestRunner.test('完结课程 + 有到期 → 常驻、无计数徽标', () => {
  const spec = getReviewEntrySpec(true, 3);
  TestRunner.assertEquals(spec.visible, true);
  TestRunner.assertEquals(spec.showCount, false);
});

TestRunner.test('完结课程 + 无到期 → 仍常驻（入口保留）', () => {
  const spec = getReviewEntrySpec(true, 0);
  TestRunner.assertEquals(spec.visible, true);
  TestRunner.assertEquals(spec.showCount, false);
});

TestRunner.test('完结课程 → 非提醒态 urgent=false（实机反馈：橙红渐变本身也是催促）', () => {
  TestRunner.assertEquals(getReviewEntrySpec(true, 3).urgent, false);
  TestRunner.assertEquals(getReviewEntrySpec(true, 0).urgent, false);
});

TestRunner.test('未完结 + 有到期 → 显示且带计数（回归）', () => {
  const spec = getReviewEntrySpec(false, 3);
  TestRunner.assertEquals(spec.visible, true);
  TestRunner.assertEquals(spec.showCount, true);
  TestRunner.assertEquals(spec.count, 3);
  TestRunner.assertEquals(spec.urgent, true);
});

TestRunner.test('未完结 + 无到期 → 隐藏（回归）', () => {
  const spec = getReviewEntrySpec(false, 0);
  TestRunner.assertEquals(spec.visible, false);
});

TestRunner.test('异常入参兜底（负数/非整数 due）', () => {
  TestRunner.assertEquals(getReviewEntrySpec(false, -1).visible, false);
  TestRunner.assertEquals(getReviewEntrySpec(false, undefined).visible, false);
  TestRunner.assertEquals(getReviewEntrySpec(true, -2).visible, true);
});

TestRunner.run();
