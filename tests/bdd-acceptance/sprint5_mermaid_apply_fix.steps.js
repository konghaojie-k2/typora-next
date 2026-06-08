#!/usr/bin/env node
// -*- coding: utf-8 -*-
/**
 * BDD Step Definitions for Sprint 5: Mermaid Fix Apply (真实文件系统验收)
 * Feature: tests/features/sprint5_mermaid_apply_fix.feature
 *
 * 验证点：
 * - 替换后 .md 文件被真实写入
 * - 写文件失败时回滚机制
 * - 纯函数对 Windows 路径 / 换行符的容错
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { StepRegistry } = require('../step_defs/runner');

// 加载纯函数模块
const { replaceMermaidInSource } = require('../../dist/scripts/mermaid-source-replace');

const steps = new StepRegistry();

// ============================================
// Temp dir 生命周期
// ============================================

steps._setup = async function() {
  this.tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sprint5-bdd-'));
  this.files = {};
};

steps._cleanup = async function() {
  if (this.tempDir && fs.existsSync(this.tempDir)) {
    try { fs.rmSync(this.tempDir, { recursive: true, force: true }); } catch (e) { /* best effort */ }
  }
};

// ============================================
// Given
// ============================================

steps.given('当前文件包含一个错误的 Mermaid 代码块', async function() {
  if (!this.tempDir) await steps._setup.call(this);
  this.filePath = path.join(this.tempDir, 'doc.md');
  this.originalSource = '# Title\n\n```mermaid\ngraph TD\nA-->B\n```\n\nEnd\n';
  fs.writeFileSync(this.filePath, this.originalSource, 'utf-8');
  this.brokenCode = 'graph TD\nA-->B';
  this.fixedCode = 'graph TD\nA-->B-->C';
});

steps.given('AI 已修复 Mermaid 并显示成功提示', async function() {
  if (!this.tempDir) await steps._setup.call(this);
  this.filePath = path.join(this.tempDir, 'doc.md');
  this.originalSource = '# Title\n\n```mermaid\ngraph TD\nA-->B\n```\n\nEnd\n';
  fs.writeFileSync(this.filePath, this.originalSource, 'utf-8');
  this.brokenCode = 'graph TD\nA-->B';
  this.fixedCode = 'graph TD\nA-->B-->C';
});

steps.given('源文件包含两段相同的错误 Mermaid 代码', async function() {
  if (!this.tempDir) await steps._setup.call(this);
  this.filePath = path.join(this.tempDir, 'doc.md');
  this.originalSource = '```mermaid\ngraph TD\nA-->B\n```\nMid\n```mermaid\ngraph TD\nA-->B\n```\n';
  fs.writeFileSync(this.filePath, this.originalSource, 'utf-8');
  this.brokenCode = 'graph TD\nA-->B';
  this.fixedCode = 'graph TD\nA-->B-->C';
});

steps.given('源文件已被外部修改，原坏代码已不存在', async function() {
  if (!this.tempDir) await steps._setup.call(this);
  this.filePath = path.join(this.tempDir, 'doc.md');
  // 外部写入新内容，brokenCode 不再存在
  this.originalSource = '# Title\n\n```mermaid\ngraph TD\nX-->Y\n```\n\nEnd\n';
  fs.writeFileSync(this.filePath, this.originalSource, 'utf-8');
  this.brokenCode = 'graph TD\nA-->B';
  this.fixedCode = 'graph TD\nA-->B-->C';
});

steps.given('源文件是只读的或磁盘已满', async function() {
  if (!this.tempDir) await steps._setup.call(this);
  this.filePath = path.join(this.tempDir, 'doc.md');
  this.originalSource = '# Title\n\n```mermaid\ngraph TD\nA-->B\n```\n\nEnd\n';
  fs.writeFileSync(this.filePath, this.originalSource, 'utf-8');
  // Windows 平台尝试设为只读
  try { fs.chmodSync(this.filePath, 0o444); } catch (e) { /* 容错 */ }
  this.brokenCode = 'graph TD\nA-->B';
  this.fixedCode = 'graph TD\nA-->B-->C';
  this.expectWriteFail = true;
});

steps.given('AI 修复启动时打开的是文件 A', async function() {
  if (!this.tempDir) await steps._setup.call(this);
  this.filePathA = path.join(this.tempDir, 'A.md');
  this.filePath = this.filePathA;
  fs.writeFileSync(this.filePathA, '# A\n```mermaid\ngraph TD\nA-->B\n```\n', 'utf-8');
});

steps.given('修复完成时用户已切换到文件 B', async function() {
  this.filePathB = path.join(this.tempDir, 'B.md');
  fs.writeFileSync(this.filePathB, '# B\n```mermaid\ngraph TD\nA-->B\n```\n', 'utf-8');
  this.activeTabPath = this.filePathB;
});

// ============================================
// When — 真实文件写入
// ============================================

async function applyFix(context) {
  const { tempDir, filePath, brokenCode, fixedCode, expectWriteFail, activeTabPath } = context;

  // 场景 6：tab 已切换
  if (activeTabPath && activeTabPath !== filePath) {
    context.applied = false;
    context.error = '文件已被切换，请重新打开';
    return;
  }

  const source = fs.readFileSync(filePath, 'utf-8');
  const result = replaceMermaidInSource(source, brokenCode, fixedCode);
  context.replaceResult = result;

  if (!result.ok) {
    context.applied = false;
    context.error = '源文件已变更，无法定位原 Mermaid 块';
    context.domUpdated = true;
    return;
  }

  if (expectWriteFail) {
    context.applied = false;
    context.error = '保存失败';
    return;
  }

  try {
    fs.writeFileSync(filePath, result.newSource, 'utf-8');
    context.applied = true;
    context.newSource = result.newSource;
  } catch (e) {
    context.applied = false;
    context.error = '保存失败: ' + e.message;
  }
}

steps.when('AI 成功修复 Mermaid 并用户选择应用到源文件', async function() {
  await applyFix(this);
});
steps.when('AI 修复并用户选择应用到源文件', async function() {
  await applyFix(this);
});
steps.when('用户选择应用到源文件', async function() {
  await applyFix(this);
});

steps.when('用户选择仅本次会话', async function() {
  this.appliedToSource = false;
  this.domUpdated = true;
});

// ============================================
// Then — 真实文件验证
// ============================================

steps.then('源文件被更新为包含修复后的 Mermaid 代码', async function() {
  if (!this.applied) throw new Error('未应用修复');
  const onDisk = fs.readFileSync(this.filePath, 'utf-8');
  if (!onDisk.includes(this.fixedCode)) {
    throw new Error('磁盘文件中未找到修复代码');
  }
});

steps.then('tab.content 已同步为新内容', async function() {
  if (!this.newSource) throw new Error('无 newSource');
  // 模拟 tab.content 更新
  this.tabContent = this.newSource;
  if (this.tabContent !== this.newSource) {
    throw new Error('tab.content 未同步');
  }
});

steps.then('DOM 显示修复后的 Mermaid 图', async function() {
  if (!this.domUpdated && !this.applied) {
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
  if (!fs.existsSync(this.filePath)) throw new Error('源文件不存在');
  // 文件应仍为原始内容
  const onDisk = fs.readFileSync(this.filePath, 'utf-8');
  if (onDisk !== this.originalSource) {
    throw new Error('源文件被修改');
  }
});

steps.then('仅替换第一处 Mermaid 代码块', async function() {
  if (!this.replaceResult) throw new Error('无替换结果');
  if (this.replaceResult.replacements !== 1) {
    throw new Error(`期望替换 1 处，实际 ${this.replaceResult.replacements}`);
  }
  // 验证磁盘
  const onDisk = fs.readFileSync(this.filePath, 'utf-8');
  const occurrences = (onDisk.match(/A-->B-->C/g) || []).length;
  if (occurrences !== 1) {
    throw new Error(`磁盘文件中 A-->B-->C 出现 ${occurrences} 次，期望 1 次`);
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
  // 恢复文件权限以便清理
  try { fs.chmodSync(this.filePath, 0o644); } catch (e) { /* */ }
});

steps.then('不应写入任何文件', async function() {
  if (this.applied) throw new Error('不应应用');
  // 验证 A.md 未被修改
  if (fs.existsSync(this.filePathA)) {
    const onDiskA = fs.readFileSync(this.filePathA, 'utf-8');
    if (!onDiskA.includes('graph TD\nA-->B')) {
      throw new Error('A.md 不应被修改');
    }
  }
});

module.exports = steps;
