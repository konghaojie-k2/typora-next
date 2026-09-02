#!/usr/bin/env node
// -*- coding: utf-8 -*-
/**
 * BDD Acceptance Steps for 跨课程记忆（Sprint 21）
 *
 * 仿 sprint20 模式：直接读真实源码断言接线存在，缺失即 throw。
 *
 * 行为层（档案聚合 / 截断 / 去重 / backfill / prompt 注入与 None 回归）由：
 * - cargo test --test learner_profile_test --test plan_prompt_test
 * 覆盖。
 */

const fs = require('fs');
const path = require('path');
const { StepRegistry } = require('../shared/runner');

const steps = new StepRegistry();

const SRC = path.join(__dirname, '../../src-tauri/src');
const DIST = path.join(__dirname, '../../dist');

function read(p) {
  if (!fs.existsSync(p)) {
    throw new Error(`source file missing on disk: ${p}`);
  }
  return fs.readFileSync(p, 'utf-8');
}

// ============================================
// Given
// ============================================

steps.given('the real learner_profile source', function () {
  this.learnerProfile = read(path.join(SRC, 'learner_profile.rs'));
});

steps.given('the real lib.rs source', function () {
  this.libRs = read(path.join(SRC, 'lib.rs'));
});

steps.given('the real plan_prompt source', function () {
  this.planPromptRs = read(path.join(SRC, 'plan_prompt.rs'));
});

steps.given('the real ai_agent.rs source', function () {
  this.aiAgentRs = read(path.join(SRC, 'ai_agent.rs'));
});

steps.given('the real index.html and project-manager.js sources', function () {
  this.indexHtml = read(path.join(DIST, 'index.html'));
  this.projectManagerJs = read(path.join(DIST, 'scripts/learning/project-manager.js'));
  this.learningCss = read(path.join(DIST, 'styles/learning.css'));
});

steps.given('the real project-resume.js source', function () {
  this.projectResumeJs = read(path.join(DIST, 'scripts/learning/project-resume.js'));
});

// ============================================
// PB21-1: 数据层
// ============================================

steps.then('it should expose build_completion_profile', function () {
  if (!this.learnerProfile.includes('pub fn build_completion_profile')) {
    throw new Error('learner_profile.rs missing build_completion_profile');
  }
});

steps.then('it should expose record_course_completion', function () {
  if (!this.learnerProfile.includes('pub fn record_course_completion')) {
    throw new Error('learner_profile.rs missing record_course_completion');
  }
});

steps.then('it should expose aggregate_learner_context', function () {
  if (!this.learnerProfile.includes('pub fn aggregate_learner_context')) {
    throw new Error('learner_profile.rs missing aggregate_learner_context');
  }
});

steps.then('it should expose learner_index_path and list_valid_course_names', function () {
  if (!this.learnerProfile.includes('pub fn learner_index_path')) {
    throw new Error('learner_profile.rs missing learner_index_path');
  }
  if (!this.learnerProfile.includes('pub fn list_valid_course_names')) {
    throw new Error('learner_profile.rs missing list_valid_course_names');
  }
});

steps.then('aggregation should truncate to newest five courses', function () {
  if (!this.learnerProfile.includes('MAX_COURSES: usize = 5')) {
    throw new Error('learner_profile.rs missing MAX_COURSES = 5 truncation');
  }
  if (!this.learnerProfile.includes('truncate(MAX_COURSES)')) {
    throw new Error('aggregation should truncate to MAX_COURSES');
  }
});

steps.then('aggregation should dedup concepts with newest status winning', function () {
  if (!this.learnerProfile.includes('seen.insert')) {
    throw new Error('aggregation missing concept dedup (seen set)');
  }
  // 新课在前（completed_at 降序），dedup 自然实现「最新状态赢」
  if (!this.learnerProfile.includes('Reverse')) {
    throw new Error('aggregation should sort newest first for newest-wins dedup');
  }
});

// ============================================
// PB21-2: 结课钩子与命令
// ============================================

steps.then('persist_quiz_result should record completion profile on course completion', function () {
  const hookIdx = this.libRs.indexOf('mark_course_completed_if_done');
  if (hookIdx < 0) {
    throw new Error('lib.rs missing course completion check');
  }
  const seg = this.libRs.slice(hookIdx, hookIdx + 1500);
  if (!seg.includes('record_course_completion')) {
    throw new Error('completion hook should call record_course_completion');
  }
});

steps.then('the hook should be best-effort with non-fatal logging', function () {
  const hookIdx = this.libRs.indexOf('record_course_completion');
  const seg = this.libRs.slice(hookIdx, hookIdx + 800);
  if (!seg.includes('non-fatal') && !seg.includes('log::warn')) {
    throw new Error('completion hook should log warn and stay non-fatal');
  }
});

steps.then('backfill_completion_profile command should be registered', function () {
  if (!this.libRs.includes('async fn backfill_completion_profile')) {
    throw new Error('lib.rs missing backfill_completion_profile command');
  }
  // invoke_handler 注册（函数定义之外还有一处引用）
  const matches = this.libRs.split('backfill_completion_profile').length - 1;
  if (matches < 3) {
    throw new Error('backfill_completion_profile should be defined AND registered (expect ≥3 occurrences)');
  }
});

steps.then('list_learner_courses command should be registered', function () {
  if (!this.libRs.includes('async fn list_learner_courses')) {
    throw new Error('lib.rs missing list_learner_courses command');
  }
  const matches = this.libRs.split('list_learner_courses').length - 1;
  if (matches < 2) {
    throw new Error('list_learner_courses should be defined AND registered (expect ≥2 occurrences)');
  }
});

// ============================================
// PB21-3: plan 注入
// ============================================

steps.then('build_plan_prompt should accept learner_context parameter', function () {
  if (!this.planPromptRs.includes('learner_context: Option<&str>')) {
    throw new Error('build_plan_prompt missing learner_context parameter');
  }
});

steps.then('the prompt should contain 学习者历史 section and 衔接规则', function () {
  if (!this.planPromptRs.includes('学习者历史')) {
    throw new Error('plan_prompt missing 学习者历史 section');
  }
  if (!this.planPromptRs.includes('衔接规则')) {
    throw new Error('plan_prompt missing 衔接规则');
  }
  if (!this.planPromptRs.includes('不得作为独立章节')) {
    throw new Error('衔接规则 should forbid re-teaching mastered concepts');
  }
});

steps.then('None context should leave the prompt without the learner section', function () {
  if (!this.planPromptRs.includes('unwrap_or_default()')) {
    throw new Error('None learner_context should degrade to empty section');
  }
});

steps.then('plan flow should aggregate learner context before building the prompt', function () {
  const aggIdx = this.aiAgentRs.indexOf('aggregate_learner_context');
  const buildIdx = this.aiAgentRs.indexOf('build_plan_prompt(&goal');
  if (aggIdx < 0) {
    throw new Error('ai_agent.rs missing aggregate_learner_context call');
  }
  if (buildIdx < 0 || aggIdx > buildIdx) {
    throw new Error('aggregation must happen before build_plan_prompt');
  }
});

// ============================================
// PB21-4: 前端 UX
// ============================================

steps.then('the create dialog should contain the learnerContextHint element', function () {
  if (!this.indexHtml.includes('id="learnerContextHint"')) {
    throw new Error('index.html missing learnerContextHint element');
  }
  if (!this.learningCss.includes('.learner-context-hint')) {
    throw new Error('learning.css missing .learner-context-hint style');
  }
});

steps.then('project-manager should load learner courses on dialog open', function () {
  if (!this.projectManagerJs.includes('loadLearnerContextHint')) {
    throw new Error('project-manager.js missing loadLearnerContextHint');
  }
  if (!this.projectManagerJs.includes('list_learner_courses')) {
    throw new Error('project-manager.js should invoke list_learner_courses');
  }
  // openDialog 必须调用
  const openIdx = this.projectManagerJs.indexOf('function openDialog');
  const seg = this.projectManagerJs.slice(openIdx, openIdx + 400);
  if (!seg.includes('loadLearnerContextHint')) {
    throw new Error('openDialog should call loadLearnerContextHint');
  }
});

steps.then('the hint should be hidden when there are no completed courses', function () {
  if (!this.indexHtml.includes('id="learnerContextHint" style="display: none;"')) {
    throw new Error('learnerContextHint should default to hidden');
  }
  if (!this.projectManagerJs.includes("style.display = 'none'")) {
    throw new Error('loadLearnerContextHint should hide hint when list is empty');
  }
});

steps.then('completed course load should invoke backfill_completion_profile', function () {
  if (!this.projectResumeJs.includes('backfill_completion_profile')) {
    throw new Error('project-resume.js missing backfill_completion_profile invoke');
  }
  // 只在课程完结时调用
  const idx = this.projectResumeJs.indexOf('backfill_completion_profile');
  const seg = this.projectResumeJs.slice(Math.max(0, idx - 400), idx);
  if (!seg.includes('courseCompleted')) {
    throw new Error('backfill should be gated on courseCompleted');
  }
});

steps.then('the backfill call should be best-effort', function () {
  const idx = this.projectResumeJs.indexOf('backfill_completion_profile');
  const seg = this.projectResumeJs.slice(idx, idx + 400);
  if (!seg.includes('.catch(')) {
    throw new Error('backfill invoke should catch errors (best-effort)');
  }
});

module.exports = steps;
