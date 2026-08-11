#!/usr/bin/env node
// -*- coding: utf-8 -*-
/**
 * BDD Acceptance Steps for 课程完结状态（Sprint 16）
 *
 * 真实文件系统 + 真实前端模块：
 * - CourseSummary 纯函数（require dist/scripts/learning/course-summary）
 *   - isProjectCourseCompleted：读侧派生（course_status 字段 / chapters_status 全完成）
 *   - getReviewEntrySpec：dashboard 复习入口展示决策
 * - 真实 project.json 写盘后读回派生（tmpdir）
 * - src-tauri/src/lib.rs 静态接线检查（persist_quiz_result 调用完结标记）
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { StepRegistry } = require('../shared/runner');

const CourseSummary = require('../../dist/scripts/learning/course-summary');

const steps = new StepRegistry();

const LIB_RS = path.join(__dirname, '../../src-tauri/src/lib.rs');

let _tmpDirs = [];

function tmpdir(prefix) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix || 'cc-'));
  _tmpDirs.push(d);
  return d;
}

function writeProject(ctx, project) {
  ctx.projectPath = tmpdir('cc-proj-');
  const learningDir = path.join(ctx.projectPath, '.learning');
  fs.mkdirSync(learningDir, { recursive: true });
  fs.writeFileSync(
    path.join(learningDir, 'project.json'),
    JSON.stringify(project, null, 2),
    'utf-8'
  );
}

// ============================================
// Given
// ============================================
steps.given('a real project.json on disk with course_status completed', function() {
  writeProject(this, {
    name: 'P',
    course_status: 'completed',
    chapters: [{ file: '01-a.md' }, { file: '02-b.md' }],
    chapters_status: { '01-a.md': 'completed', '02-b.md': 'completed' }
  });
});

steps.given('a real project.json on disk with all chapters completed', function() {
  writeProject(this, {
    name: 'P',
    chapters: [{ file: '01-a.md' }, { file: '02-b.md' }],
    chapters_status: { '01-a.md': 'completed', '02-b.md': 'completed' }
  });
});

steps.given('a real project.json on disk with Chinese status values all completed', function() {
  writeProject(this, {
    name: 'P',
    chapters: [{ file: '01-a.md' }, { file: '02-b.md' }],
    chapters_status: { '01-a.md': '已完成', '02-b.md': '已完成' }
  });
});

steps.given('a real project.json on disk with a chapter still not completed', function() {
  writeProject(this, {
    name: 'P',
    chapters: [{ file: '01-a.md' }, { file: '02-b.md' }],
    chapters_status: { '01-a.md': 'completed', '02-b.md': 'ready' }
  });
});

steps.given('a real project.json on disk with no chapters', function() {
  writeProject(this, { name: 'P', chapters: [], chapters_status: {} });
});

steps.given('a completed course with {int} due review items', function(n) {
  this.courseCompleted = true;
  this.dueCount = n;
});

steps.given('an active course with {int} due review items', function(n) {
  this.courseCompleted = false;
  this.dueCount = n;
});

steps.given('the real lib.rs source', function() {
  this.libRs = fs.readFileSync(LIB_RS, 'utf-8');
});

// ============================================
// When
// ============================================
steps.when('project course completion is derived', function() {
  const raw = fs.readFileSync(
    path.join(this.projectPath, '.learning', 'project.json'), 'utf-8'
  );
  this.derived = CourseSummary.isProjectCourseCompleted(JSON.parse(raw));
});

steps.when('the review entry spec is computed', function() {
  this.spec = CourseSummary.getReviewEntrySpec(this.courseCompleted, this.dueCount);
});

// ============================================
// Then
// ============================================
steps.then('the course should be treated as completed', function() {
  if (this.derived !== true) {
    throw new Error(`Expected derived=true, got ${this.derived}`);
  }
});

steps.then('the course should not be treated as completed', function() {
  if (this.derived !== false) {
    throw new Error(`Expected derived=false, got ${this.derived}`);
  }
});

steps.then('the review entry should be visible without a count badge', function() {
  if (!this.spec || this.spec.visible !== true) {
    throw new Error(`Expected visible=true, got ${JSON.stringify(this.spec)}`);
  }
  if (this.spec.showCount !== false) {
    throw new Error(`Expected showCount=false, got ${JSON.stringify(this.spec)}`);
  }
});

steps.then('the review entry should show the count {int}', function(n) {
  if (!this.spec || this.spec.visible !== true || this.spec.showCount !== true) {
    throw new Error(`Expected visible+showCount, got ${JSON.stringify(this.spec)}`);
  }
  if (this.spec.count !== n) {
    throw new Error(`Expected count=${n}, got ${this.spec.count}`);
  }
});

steps.then('the review entry should be hidden', function() {
  if (!this.spec || this.spec.visible !== false) {
    throw new Error(`Expected visible=false, got ${JSON.stringify(this.spec)}`);
  }
});

steps.then('persist_quiz_result should call the course completion marker', function() {
  if (!this.libRs.includes('mark_course_completed_if_done')) {
    throw new Error('lib.rs does not reference mark_course_completed_if_done');
  }
  const fnIdx = this.libRs.indexOf('async fn persist_quiz_result');
  if (fnIdx < 0) {
    throw new Error('lib.rs missing persist_quiz_result');
  }
  const callIdx = this.libRs.indexOf('mark_course_completed_if_done', fnIdx);
  if (callIdx < 0) {
    throw new Error('persist_quiz_result does not call mark_course_completed_if_done');
  }
});

steps._cleanup = function() {
  for (const d of _tmpDirs) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  }
  _tmpDirs = [];
};

module.exports = steps;
