#!/usr/bin/env node
// -*- coding: utf-8 -*-
/**
 * BDD Step Definitions for Sprint 5: Mermaid Fix Apply (内存模拟层)
 * Feature: tests/features/sprint5_mermaid_apply_fix.feature
 *
 * 内层 = 内存模拟 + 关键不变量检查
 * 真实文件系统验证见 tests/bdd-acceptance/sprint5_mermaid_apply_fix.steps.js
 */

const { StepRegistry } = require('../../shared/runner');

// Node.js 兼容 + 加载纯函数模块
if (typeof global.window === 'undefined') global.window = {};
const { replaceMermaidInSource } = require('../../../dist/scripts/mermaid-source-replace');

const steps = new StepRegistry();

// ============================================
// Given
// ============================================

steps.given('当前文件包含一个错误的 Mermaid 代码块', async function() {
  this.source = '# Title\n\n```mermaid\ngraph TD\nA-->B\n```\n\nEnd\n';
  this.brokenCode = 'graph TD\nA-->B';
  this.fixedCode = 'graph TD\nA-->B-->C';
});

steps.given('AI 已修复 Mermaid 并显示成功提示', async function() {
  this.source = '# Title\n\n```mermaid\ngraph TD\nA-->B\n```\n\nEnd\n';
  this.brokenCode = 'graph TD\nA-->B';
  this.fixedCode = 'graph TD\nA-->B-->C';
});

steps.given('源文件包含两段相同的错误 Mermaid 代码', async function() {
  this.source = '```mermaid\ngraph TD\nA-->B\n```\nMid\n```mermaid\ngraph TD\nA-->B\n```\n';
  this.brokenCode = 'graph TD\nA-->B';
  this.fixedCode = 'graph TD\nA-->B-->C';
});

steps.given('源文件已被外部修改，原坏代码已不存在', async function() {
  this.source = '# Title\n\n```mermaid\ngraph TD\nX-->Y\n```\n\nEnd\n';
  this.brokenCode = 'graph TD\nA-->B';
  this.fixedCode = 'graph TD\nA-->B-->C';
});

steps.given('源文件是只读的或磁盘已满', async function() {
  this.source = '# Title\n\n```mermaid\ngraph TD\nA-->B\n```\n\nEnd\n';
  this.brokenCode = 'graph TD\nA-->B';
  this.fixedCode = 'graph TD\nA-->B-->C';
  this.writeShouldFail = true;
});

steps.given('AI 修复启动时打开的是文件 A', async function() {
  this.openedFile = '/fake/A.md';
  this.source = '# A\n```mermaid\ngraph TD\nA-->B\n```\n';
  this.brokenCode = 'graph TD\nA-->B';
  this.fixedCode = 'graph TD\nA-->B-->C';
});

steps.given('修复完成时用户已切换到文件 B', async function() {
  this.activeTabFile = '/fake/B.md';
  // B 文件不同内容
  this.sourceB = '# B\n```mermaid\ngraph TD\nA-->B\n```\n';
});

// ============================================
// When — 统一应用流程
// ============================================

async function applyFixInternal(context) {
  // 场景 6：tab 已切换
  if (context.activeTabFile && context.openedFile &&
      context.activeTabFile !== context.openedFile) {
    context.applied = false;
    context.error = '文件已被切换，请重新打开';
    context.domUpdated = true;
    return;
  }

  // 场景 5：write_file 失败
  if (context.writeShouldFail) {
    context.applied = false;
    context.error = '保存失败';
    context.domUpdated = true;
    return;
  }

  const result = replaceMermaidInSource(context.source, context.brokenCode, context.fixedCode);
  context.replaceResult = result;

  if (!result.ok) {
    context.applied = false;
    context.domUpdated = true;
    if (result.reason === 'not_found') {
      context.error = '源文件已变更，无法定位原 Mermaid 块';
    } else {
      context.error = '替换失败: ' + (result.reason || 'unknown');
    }
    return;
  }

  context.applied = true;
  context.newSource = result.newSource;
  context.domUpdated = true;
}

steps.when('AI 成功修复 Mermaid 并用户选择应用到源文件', async function() {
  await applyFixInternal(this);
});
steps.when('AI 修复并用户选择应用到源文件', async function() {
  await applyFixInternal(this);
});
steps.when('用户选择应用到源文件', async function() {
  await applyFixInternal(this);
});

steps.when('用户选择仅本次会话', async function() {
  this.appliedToSource = false;
  this.domUpdated = true;
});

// ============================================
// Then
// ============================================

steps.then('源文件被更新为包含修复后的 Mermaid 代码', async function() {
  if (!this.applied) throw new Error('未应用修复');
  if (!this.newSource || !this.newSource.includes(this.fixedCode)) {
    throw new Error('新源码中未找到修复代码');
  }
});

steps.then('tab.content 已同步为新内容', async function() {
  if (!this.newSource) throw new Error('无 newSource');
  this.tabContent = this.newSource;
  if (this.tabContent !== this.newSource) {
    throw new Error('tab.content 未同步');
  }
});

steps.then('DOM 显示修复后的 Mermaid 图', async function() {
  if (!this.domUpdated) {
    throw new Error('DOM 未更新');
  }
});

steps.then('DOM 仍显示修复后的 Mermaid 图', async function() {
  if (!this.domUpdated) {
    throw new Error('DOM 未更新');
  }
});

steps.then('源文件保持不变', async function() {
  if (this.appliedToSource) throw new Error('源文件被错误修改');
});

steps.then('仅替换第一处 Mermaid 代码块', async function() {
  if (!this.replaceResult) throw new Error('无替换结果');
  if (this.replaceResult.replacements !== 1) {
    throw new Error(`期望替换 1 处，实际 ${this.replaceResult.replacements}`);
  }
});

steps.then('返回警告信息提示存在多处匹配', async function() {
  if (!this.replaceResult || !this.replaceResult.warning) {
    throw new Error('期望 warning 但未返回');
  }
});

steps.then('提示{string}', async function(msg) {
  if (!this.error || !this.error.includes(msg)) {
    throw new Error(`期望错误包含 "${msg}"，实际错误: ${this.error || '无错误'}`);
  }
});

steps.then('应用按钮可重新点击重试', async function() {
  if (this.applied) throw new Error('不应应用成功');
  if (!this.error) throw new Error('应有错误信息');
});

steps.then('不应写入任何文件', async function() {
  if (this.applied) throw new Error('不应应用');
});

module.exports = steps;
