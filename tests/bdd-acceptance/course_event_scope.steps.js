#!/usr/bin/env node
// -*- coding: utf-8 -*-
/**
 * BDD Acceptance Steps for course event scoping (agent-event project identity)
 *
 * Behavior layer: requires the REAL dist/scripts/learning/progress-tracker.js
 * (ChapterStatusManager + AgentEventBridge) with a mock __TAURI__ invoke
 * recorder. Static layer: reads the REAL src-tauri sources.
 */

const fs = require('fs');
const path = require('path');
const { StepRegistry } = require('../shared/runner');
const { ChapterStatusManager, AgentEventBridge } =
  require('../../dist/scripts/learning/progress-tracker.js');

const steps = new StepRegistry();

const AI_AGENT_RS = path.join(__dirname, '../../src-tauri/src/ai_agent.rs');
const LIB_RS = path.join(__dirname, '../../src-tauri/src/lib.rs');

const PROJECT_B = 'C:/proj-b';

function openProjectB(ctx, chapter0Status) {
  ctx.invokes = [];
  global.window.__TAURI__ = {
    core: {
      invoke: (cmd, args) => {
        ctx.invokes.push({ cmd, args });
        return Promise.resolve();
      }
    }
  };
  ctx.manager = new ChapterStatusManager([{ title: 'B 第一章' }, { title: 'B 第二章' }]);
  if (chapter0Status) {
    // Restore path bypasses transition validation (same as loadProjectUI)
    ctx.manager.chapters[0].status = chapter0Status;
  }
  ctx.ui = { projectPath: PROJECT_B, updateChapter() {} };
  ctx.bridge = new AgentEventBridge(ctx.manager, ctx.ui, null);
}

function fireChapterComplete(ctx, data) {
  ctx.bridge.handleEvent({ type: 'chapter_complete', data });
}

function persistCalls(ctx) {
  return ctx.invokes.filter(c => c.cmd === 'persist_chapter_file');
}

// ============================================
// Given
// ============================================
steps.given('前台打开了 B 课程且章节 0 已完成', function() {
  openProjectB(this, 'completed');
});

steps.given('前台打开了 B 课程且章节 0 生成中', function() {
  // 真实事件流：progress(generating) 先到，chapter_complete 才能转 ready
  openProjectB(this, 'generating');
});

// ============================================
// When
// ============================================
steps.when('收到 A 课程的 chapter_complete 事件 index 0', function() {
  fireChapterComplete(this, { index: 0, file: '00-a.md', projectPath: 'C:/proj-a' });
});

steps.when('收到 B 课程的 chapter_complete 事件 index 0', function() {
  fireChapterComplete(this, { index: 0, file: '00-b.md', projectPath: PROJECT_B });
});

steps.when('收到以反斜杠路径标识 B 课程的 chapter_complete 事件 index 0', function() {
  fireChapterComplete(this, { index: 0, file: '00-b.md', projectPath: 'C:\\proj-b' });
});

steps.when('收到不带 projectPath 的 chapter_complete 事件 index 0', function() {
  fireChapterComplete(this, { index: 0, file: '00-b.md' });
});

// ============================================
// Then
// ============================================
steps.then('B 课程章节 0 状态保持 completed', function() {
  const s = this.manager.chapters[0].status;
  if (s !== 'completed') {
    throw new Error(`章节 0 状态被改写：期望 completed，实际 ${s}`);
  }
});

steps.then('B 课程没有任何持久化写入', function() {
  if (persistCalls(this).length > 0) {
    throw new Error('其他课程的事件触发了本课程的 persist_chapter_file');
  }
});

steps.then('B 课程章节 0 状态变为 ready', function() {
  const s = this.manager.chapters[0].status;
  if (s !== 'ready') {
    throw new Error(`章节 0 状态：期望 ready，实际 ${s}`);
  }
});

steps.then('向 B 课程持久化该章节文件与状态', function() {
  const calls = persistCalls(this);
  if (calls.length !== 1) {
    throw new Error(`persist_chapter_file 调用次数：期望 1，实际 ${calls.length}`);
  }
  const args = calls[0].args;
  if (args.projectPath !== PROJECT_B || args.chapterIndex !== 0 || args.fileBasename !== '00-b.md') {
    throw new Error('persist 参数不正确: ' + JSON.stringify(args));
  }
});

steps.then('ai_agent.rs 的事件转发循环应调用事件标记函数', function() {
  const src = fs.readFileSync(AI_AGENT_RS, 'utf-8');
  if (!src.includes('tag_event_with_project')) {
    throw new Error('ai_agent.rs 未调用 tag_event_with_project');
  }
});

steps.then('agent_event_scope 模块应被 lib.rs 注册', function() {
  const src = fs.readFileSync(LIB_RS, 'utf-8');
  if (!/mod agent_event_scope/.test(src)) {
    throw new Error('lib.rs 未注册 agent_event_scope 模块');
  }
});

module.exports = steps;
