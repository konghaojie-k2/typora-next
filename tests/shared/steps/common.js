/**
 * Common Step Definitions shared across sprints
 * Only put steps that are genuinely used by multiple sprints here.
 */

const { StepRegistry } = require('../runner');
const steps = new StepRegistry();

// ============================================
// Common When: 用户点击按钮
// ============================================

steps.when('用户点击{string}按钮', async function(label) {
  // Sprint 1: 开始生成
  if (label === '开始生成' || label === '开始设计') {
    if (this.outline) {
      this.generationStarted = true;
      this.dialogOpen = false;
    }
    if (this.dialogStep) {
      this.dialogStep = 'planning';
    }
  }

  // Sprint 2: 中止生成
  if (label === '中止生成') {
    this.agentRunning = false;
    this.abortTriggered = true;
  }

  // Sprint 2: 继续生成
  if (label === '继续生成') {
    this.agentRunning = true;
    this.abortTriggered = false;
    this.generationTriggered = true;
  }

  // Sprint 1: 重新规划
  if (label === '重新规划') {
    this.dialogStep = 'planning';
    this.outline = null;
  }

  // Learning Hub: 新建学习项目
  if (label === '新建学习项目') {
    this.hubOpen = false;
    this.createDialogOpen = true;
  }

  // Learning Hub: 删除
  if (label === '删除') {
    this.deleteRequested = true;
  }
});

module.exports = steps;
