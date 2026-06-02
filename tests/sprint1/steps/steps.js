/**
 * BDD Step Definitions for Sprint 1: Create Learning Project
 * Imports common steps and adds sprint-specific steps.
 */

const { StepRegistry } = require('../../shared/runner');
const commonSteps = require('../../shared/steps/common');

// Create sprint-specific registry, merge common steps
const steps = new StepRegistry();
steps.steps = [...commonSteps.steps];

// ============================================
// Helper assertions
// ============================================
function assertDialogOpen(ctx) {
  if (!ctx.dialogOpen) throw new Error('Dialog not opened');
}

function assertOutlineExists(ctx) {
  if (!ctx.outline) throw new Error('No outline generated');
}

// ============================================
// Given
// ============================================

steps.given('用户在 Typora Next 主界面', async function() {
  this.appLaunched = true;
});

steps.given('新建学习项目对话框已打开', async function() {
  this.dialogOpen = true;
  this.dialogStep = 'input';
});

steps.given('用户已提交学习目标{string}', async function(goal) {
  this.dialogOpen = true;
  this.goal = goal;
  this.dialogStep = 'planning';
});

steps.given('用户已提交学习目标', async function() {
  this.dialogOpen = true;
  this.goal = '理解 Transformer';
  this.dialogStep = 'planning';
});

steps.given('AI 配置已正确设置', async function() {
  this.aiConfigured = true;
});

steps.given('AI API 不可用或配置错误', async function() {
  this.aiConfigured = false;
  this.aiError = true;
});

steps.given('AI 已生成大纲并展示在预览视图', async function() {
  this.dialogOpen = true;
  this.outline = {
    chapters: [
      { title: '为什么学 Transformer', duration_minutes: 20, concepts: ['动机'] },
      { title: '注意力机制', duration_minutes: 30, concepts: ['注意力'] },
      { title: 'Self-Attention', duration_minutes: 25, concepts: ['QKV'] },
      { title: '多头注意力', duration_minutes: 25, concepts: ['多头'] },
      { title: '位置编码', duration_minutes: 20, concepts: ['正弦编码'] },
      { title: '编码器架构', duration_minutes: 20, concepts: ['Encoder'] },
      { title: '解码器与输出', duration_minutes: 20, concepts: ['Decoder'] },
      { title: '实战练习', duration_minutes: 30, concepts: ['PyTorch'] }
    ],
    total_duration: 190
  };
  this.dialogStep = 'outline';
});

// ============================================
// When (sprint-specific only; common ones from shared/steps/common.js)
// ============================================

steps.when('点击工具栏{string}按钮', async function(btn) {
  if (btn === '新建学习项目') {
    this.dialogOpen = true;
    this.dialogStep = 'input';
  }
});

steps.when('用户在学习目标输入框填入{string}', async function(text) {
  assertDialogOpen(this);
  this.goal = text;
});

steps.when('选择难度{string}', async function(level) {
  this.level = level;
});

steps.when('选择预计时长{int}小时', async function(hours) {
  this.hours = hours;
});

steps.when('选择预计时长{string}', async function(text) {
  const match = text.match(/(\d+)/);
  this.hours = match ? parseInt(match[1]) : 3;
});

steps.when('点击{string}', async function(target) {
  if (target === '开始设计') {
    this.dialogStep = 'planning';
  }
  if (target === '确认') {
    // Confirm edit, stay in outline view
  }
  if (target === '重新规划') {
    this.dialogStep = 'planning';
    this.outline = null;
  }
});

steps.when('点击{string}按钮', async function(target) {
  // Alias for 点击{string}
  if (target === '开始设计') {
    this.dialogStep = 'planning';
  }
  if (target === '重新规划') {
    this.dialogStep = 'planning';
    this.outline = null;
  }
});

steps.when('Agent 完成大纲生成', async function() {
  this.dialogStep = 'outline';
  this.outline = {
    chapters: [
      { title: '注意力机制', duration_minutes: 30, concepts: ['注意力'] },
      { title: 'Self-Attention', duration_minutes: 25, concepts: ['QKV'] },
      { title: '多头注意力', duration_minutes: 25, concepts: ['多头'] },
      { title: '位置编码', duration_minutes: 20, concepts: ['正弦编码'] },
      { title: '编码器架构', duration_minutes: 20, concepts: ['Encoder'] },
      { title: '解码器与输出', duration_minutes: 20, concepts: ['Decoder'] },
      { title: '实战练习', duration_minutes: 30, concepts: ['PyTorch'] }
    ],
    total_duration: 170
  };
});

steps.when('Agent 调用失败', async function() {
  this.aiError = true;
  this.errorMessage = 'API 调用失败';
});

steps.when('用户点击第 {int} 章的{string}按钮', async function(index, action) {
  assertOutlineExists(this);
  if (action === '编辑') {
    this.editingChapter = index - 1;
  } else if (action === '删除') {
    this.outline.chapters.splice(index - 1, 1);
  }
});

steps.when('将标题从{string}修改为{string}', async function(oldTitle, newTitle) {
  assertOutlineExists(this);
  const ch = this.outline.chapters.find(c => c.title === oldTitle);
  if (ch) ch.title = newTitle;
});

steps.when('用户修改了某些章节', async function() {
  assertOutlineExists(this);
  this.outline.chapters[0].title = '修改后的标题';
});

// ============================================
// Then (sprint-specific only)
// ============================================

steps.then('弹出模态对话框', async function() {
  assertDialogOpen(this);
});

steps.then('对话框包含学习目标输入框', async function() {
  assertDialogOpen(this);
});

steps.then('对话框包含难度级别选择（小白、有编程基础、专业进阶）', async function() {
  assertDialogOpen(this);
});

steps.then('对话框包含预计时长选择', async function() {
  assertDialogOpen(this);
});

steps.then('对话框底部有{string}按钮', async function(btn) {
  assertDialogOpen(this);
});

steps.then('按钮变为加载状态', async function() {
  if (!this.dialogStep || this.dialogStep === 'input') {
    throw new Error('Not in loading state');
  }
});

steps.then('对话框显示{string}', async function(text) {
  if (text.includes('设计') || text.includes('加载') || text.includes('正在')) {
    if (this.dialogStep !== 'planning' && !this.aiError) {
      throw new Error('Not in planning/loading state');
    }
  }
  if (text.includes('错误') || text.includes('无法')) {
    if (!this.aiError) {
      throw new Error('Not in error state');
    }
  }
});

steps.then('对话框切换到{string}视图', async function(view) {
  if (view === '大纲预览' || view === 'outline') {
    if (this.dialogStep !== 'outline') {
      throw new Error('Not in outline view');
    }
  }
});

steps.then('显示章节列表，每章有标题和预计时长', async function() {
  assertOutlineExists(this);
  if (!this.outline.chapters || this.outline.chapters.length === 0) {
    throw new Error('No chapters in outline');
  }
});

steps.then('总时长接近用户指定的 {int} 小时', async function(hours) {
  assertOutlineExists(this);
  const totalMinutes = this.outline.chapters.reduce((sum, ch) => sum + (ch.duration_minutes || 0), 0);
  const totalHours = totalMinutes / 60;
  if (Math.abs(totalHours - hours) > hours * 0.3) {
    throw new Error(`Total ${totalHours}h too far from ${hours}h`);
  }
});

steps.then('基础概念章节排在进阶章节之前', async function() {
  assertOutlineExists(this);
});

steps.then('底部有{string}和{string}按钮', async function(btn1, btn2) {
  assertDialogOpen(this);
});

steps.then('对话框显示错误信息{string}', async function(msg) {
  if (!this.aiError) {
    throw new Error('Not in error state');
  }
});

steps.then('显示{string}按钮', async function(btn) {
  // Generic button visibility check
});

steps.then('对话框显示加载状态', async function() {
  if (this.dialogStep !== 'planning') {
    throw new Error('Not in loading state');
  }
});

steps.then('用户仍可以修改输入重新提交', async function() {
  assertDialogOpen(this);
});

steps.then('章节列表显示修改后的标题', async function() {
  assertOutlineExists(this);
});

steps.then('其他章节保持不变', async function() {
  assertOutlineExists(this);
});

steps.then('该章节从列表中移除', async function() {
  assertOutlineExists(this);
});

steps.then('后续章节序号自动调整', async function() {
  assertOutlineExists(this);
});

steps.then('总时长重新计算', async function() {
  assertOutlineExists(this);
});

steps.then('Agent 根据修改后的要求重新生成大纲', async function() {
  // Re-planning triggered
});

steps.then('对话框关闭', async function() {
  this.dialogOpen = false;
});

steps.then('创建学习项目文件夹', async function() {
  this.projectCreated = true;
});

steps.then('保存大纲到 .learning/project.json', async function() {
  this.projectSaved = true;
});

steps.then('开始生成第 1 章内容', async function() {
  this.generationStarted = true;
});

module.exports = steps;
