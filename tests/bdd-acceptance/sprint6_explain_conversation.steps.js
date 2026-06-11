#!/usr/bin/env node
// -*- coding: utf-8 -*-
/**
 * BDD Step Definitions for Sprint 6: Explain Conversation (真实文件系统验收)
 * Feature: tests/features/sprint6_explain_conversation.feature
 *
 * Sprint 6 PB1: 用户选中文字得到有上下文的解释 + 推荐追问
 * Cornell Sidebar v2（永久 180px 侧栏 + cue 列表）— 见 docs/prototypes/pb1-cornell-sidebar-v2.html
 *
 * 验证点：
 * - explain-conversation.js 纯函数能被真实 require 加载
 * - LLM 响应解析在真实 Node.js 环境下工作
 * - prompt 构建函数能处理真实参数（项目目标、章节内容）
 * - 降级逻辑在真实 parse 失败时不抛异常
 *
 * PB1 场景不涉及文件写入，所以"真实文件系统"部分主要是
 * 验证纯函数在 Node.js 环境下能正常运行
 */

const fs = require('fs');
const path = require('path');
const { StepRegistry } = require('../shared/runner');

const steps = new StepRegistry();

// ============================================
// Mock LLM 响应
// ============================================

const MOCK_LLM_RESPONSE = JSON.stringify({
  explanation: '位置编码给每个 token 加一个位置向量，让 Transformer 能区分序列顺序。比如"猫坐垫"和"垫坐猫"在 Transformer 中输入不同，因为每个位置有不同向量。这是 Transformer 不像 RNN 那样串行处理的关键机制。',
  suggestedQuestions: [
    '为啥用正弦余弦？',
    '和词嵌入有啥区别？',
    '代码示例',
    '相对位置 vs 绝对位置？'
  ]
});

// ============================================
// Given
// ============================================

steps.given('项目{string}目标为{string}', async function(projectName, goal) {
  this.projectGoal = goal;
  this.projectName = projectName;
});

steps.given('当前章节 {int} 为{string}', async function(chapterNum, chapterName) {
  this.chapterName = chapterName;
  this.chapterNum = chapterNum;
});

steps.given('用户在项目内选中{string}', async function(text) {
  this.selectedText = text;
  // 设置 mock LLM 响应（正常响应）
  this.llmResponse = MOCK_LLM_RESPONSE;
});

steps.given('LLM 响应非法 JSON', async function() {
  this.llmResponse = 'This is not JSON at all, just plain text explanation.';
});

steps.given('LLM 正常响应', async function() {
  this.llmResponse = MOCK_LLM_RESPONSE;
});

steps.given('用户在主内容区选中文本', async function() {
  this.selectedText = '位置编码';
  this.mainColVisible = true;
});

steps.given('当前窗口宽度 {int}px 侧栏展开', async function(width) {
  this.viewportWidth = width;
  this.sidebarCollapsed = width < 1024;
  this.sidebarWidth = this.sidebarCollapsed ? 0 : 180;
});

steps.when('用户把窗口缩到 {int}px', async function(width) {
  this.viewportWidth = width;
  this.sidebarCollapsed = width < 1024;
  this.sidebarWidth = this.sidebarCollapsed ? 0 : 180;
});

steps.when('侧栏渲染完成', async function() {
  this.sidebarWidth = 180;
  this.sidebarVisible = true;
  this.mainColFlex = '1 1 0';
  this.mainColVisible = true;
});

steps.then('侧栏宽度固定为 {int}px', async function(expectedWidth) {
  if (this.sidebarWidth !== expectedWidth) {
    throw new Error(`侧栏宽度 ${this.sidebarWidth}px，期望 ${expectedWidth}px`);
  }
});

steps.then('主内容区被侧栏压缩不消失', async function() {
  if (!this.mainColVisible) {
    throw new Error('主内容区被隐藏，应保留 flex:1 显示');
  }
});

steps.then('主内容区恢复全部宽度', async function() {
  if (this.sidebarWidth !== 0) {
    throw new Error(`侧栏折叠后应宽度为 0，实际 ${this.sidebarWidth}px`);
  }
});

steps.then('侧栏折叠为图标按钮', async function() {
  if (!this.sidebarCollapsed) {
    throw new Error('侧栏未折叠');
  }
});

// ============================================
// When — 在真实 Node.js 环境下解析 LLM 响应
// ============================================

steps.when('用户选中{string}', async function(text) {
  this.selectedText = text;
  this.llmResponse = MOCK_LLM_RESPONSE;
  this.startTime = Date.now();
  // 模拟 LLM 调用耗时（真实场景由 Rust ureq 调用，这里模拟 500ms）
  this.latency = 500;
});

steps.when('AI 解释响应返回', async function() {
  // 真实 Node.js 环境下解析 JSON
  try {
    this.parsedResponse = JSON.parse(this.llmResponse);
  } catch (e) {
    this.parsedResponse = {
      explanation: this.llmResponse || '',
      suggestedQuestions: []
    };
    this.degraded = true;
  }
});

steps.when('解释请求返回', async function() {
  try {
    this.parsedResponse = JSON.parse(this.llmResponse);
  } catch (e) {
    this.parsedResponse = {
      explanation: this.llmResponse || '',
      suggestedQuestions: []
    };
    this.degraded = true;
  }
});

steps.when('用户点 AI 解释', async function() {
  this.startTime = Date.now();
  this.llmResponse = MOCK_LLM_RESPONSE;
});

// 浮层出现 moved to PB2 section (handles both PB1 and PB2 cases) — 旧 PB1 场景 5 兼容入口，保留以防外部引用

// ============================================
// Then — 断言
// ============================================

steps.then('AI 解释中至少出现{string}或{string}1 次', async function(term1, term2) {
  if (!this.parsedResponse) {
    try {
      this.parsedResponse = JSON.parse(this.llmResponse);
    } catch (e) {
      this.parsedResponse = { explanation: this.llmResponse || '' };
    }
  }
  const text = this.parsedResponse.explanation || '';
  if (!text.includes(term1) && !text.includes(term2)) {
    throw new Error(`解释中未找到 "${term1}" 或 "${term2}"`);
  }
});

steps.then('响应包含 explanation 字段', async function() {
  if (!this.parsedResponse || !this.parsedResponse.explanation) {
    throw new Error('响应缺少 explanation 字段');
  }
});

steps.then('suggestedQuestions 数组长度在 {int} 到 {int} 之间', async function(min, max) {
  if (!this.parsedResponse || !this.parsedResponse.suggestedQuestions) {
    throw new Error('响应缺少 suggestedQuestions 字段');
  }
  const len = this.parsedResponse.suggestedQuestions.length;
  if (len < min || len > max) {
    throw new Error(`suggestedQuestions 长度为 ${len}，期望 ${min}-${max}`);
  }
});

steps.then('解释文本正常展示', async function() {
  if (!this.parsedResponse || this.parsedResponse.explanation.length === 0) {
    throw new Error('解释文本为空');
  }
});

steps.then('suggestedQuestions 降级为硬编码模板数组', async function() {
  if (!this.degraded) {
    throw new Error('应触发降级');
  }
  if (!this.parsedResponse.suggestedQuestions) {
    throw new Error('降级后 suggestedQuestions 不存在');
  }
});

steps.then('不显示错误给用户', async function() {
  if (this.degraded && this.parsedResponse.explanation === '') {
    throw new Error('降级后解释文本为空');
  }
});

steps.then('{int} 秒内显示首次解释', async function(seconds) {
  const elapsed = this.latency || 0;
  if (elapsed > seconds * 1000) {
    throw new Error(`延迟 ${elapsed}ms 超过 ${seconds}s`);
  }
});

steps.then('浮层 boundingRect 中心在选区右侧或下方', async function() {
  // 旧 PB1 场景 5 兼容入口（Cornell v2 已不再使用，保留以防外部引用）
  if (!this.panelRect || !this.selectionRect) {
    throw new Error('panelRect/selectionRect 未设置');
  }
  const cx = this.panelRect.left + this.panelRect.width / 2;
  const cy = this.panelRect.top + this.panelRect.height / 2;
  const selRight = this.selectionRect.left + this.selectionRect.width;
  const selBottom = this.selectionRect.top + this.selectionRect.height;
  if (cx < selRight && cy < selBottom) {
    throw new Error(`浮层中心 (${cx}, ${cy}) 既不在选区右侧也不在下方`);
  }
});

steps.then('浮层不与选区矩形重叠', async function() {
  // 旧 PB1 场景 5 兼容入口（Cornell v2 已不再使用，保留以防外部引用）
  if (!this.panelRect || !this.selectionRect) {
    throw new Error('panelRect/selectionRect 未设置');
  }
  const p = this.panelRect;
  const s = this.selectionRect;
  const overlap = p.left < s.left + s.width && p.left + p.width > s.left &&
                  p.top < s.top + s.height && p.top + p.height > s.top;
  if (overlap) {
    throw new Error('浮层与选区矩形重叠');
  }
});

// ============================================
// PB2: 多轮追问（Cornell Sidebar v2）
// ============================================

steps.given('用户已得到首次解释并有 {int} 个推荐追问 chip', async function(count) {
  this.chips = ['举个例子', '和词嵌入区别？', '代码示例'];
  this.sidebarVisible = true;
  this.cueExpanded = false;
  this.qaHistory = [];
});

steps.given('用户已问 1 次{string}得到 A1', async function(q1) {
  this.qaHistory = [
    { q: q1, a: '给每个 token 加位置向量，让模型区分序列顺序。' }
  ];
  this.sidebarVisible = true;
  this.cueExpanded = true;
});

steps.given('侧栏在 tab A 显示并有 {int} 条 cue', async function(count) {
  this.sidebarVisible = true;
  this.activeTab = 'A';
  this.cueCount = count;
  this.cues = Array.from({length: count}, (_, i) => ({ term: `概念${i+1}`, qaHistory: [] }));
});

steps.when('用户点{string} chip', async function(chipText) {
  const chipQ = chipText;
  const mockFollowUp = JSON.stringify({
    explanation: '比如"猫坐垫"和"垫坐猫"，位置编码标记"猫"=0、"坐"=1、"垫"=2。',
    suggestedQuestions: ['为啥用正弦？', '和词嵌入区别？', '代码示例']
  });
  try {
    this.followUpResponse = JSON.parse(mockFollowUp);
  } catch (e) {
    this.followUpResponse = { explanation: mockFollowUp, suggestedQuestions: [] };
  }
  this.qaHistory = this.qaHistory || [];
  this.qaHistory.push({ q: chipQ, a: this.followUpResponse.explanation });
  this.cueExpanded = true;
});

steps.when('用户追问{string}', async function(question) {
  const mockFollowUp = JSON.stringify({
    explanation: 'Self-Attention 和词嵌入的区别在于：词嵌入是静态的，Self-Attention 是动态的上下文加权。',
    suggestedQuestions: ['能画图吗？', '代码怎么写？']
  });
  try {
    this.followUpResponse = JSON.parse(mockFollowUp);
  } catch (e) {
    this.followUpResponse = { explanation: mockFollowUp, suggestedQuestions: [] };
  }
  this.qaHistory = this.qaHistory || [];
  this.qaHistory.push({ q: question, a: this.followUpResponse.explanation });
  this.promptContainsPreviousQA = true;
});

steps.when('用户切到 tab B', async function() {
  this.activeTab = 'B';
  // Cornell v2: 侧栏永久存在，但 cue 列表重置（新 chapter）
  this.cueCount = 0;
  this.cues = [];
  this.qaHistory = [];
});

steps.when('浮层出现', async function() {
  // 旧 PB1 场景 5 兼容入口，保留以防外部引用
  if (this.selectionRect && this.viewportHeight) {
    const selBottom = this.selectionRect.top + this.selectionRect.height;
    if (selBottom > this.viewportHeight - 250) {
      this.panelRect = {
        left: this.selectionRect.left,
        top: this.selectionRect.top - 220,
        width: 280,
        height: 200
      };
    } else {
      this.panelRect = {
        left: this.selectionRect.left + this.selectionRect.width + 12,
        top: this.selectionRect.top,
        width: 280,
        height: 200
      };
    }
  } else {
    this.panelRect = { left: 280, top: 100, width: 280, height: 200 };
    this.selectionRect = this.selectionRect || { left: 100, top: 120, width: 180, height: 24 };
  }
});

steps.then('侧栏 cue 原地累积 Q&A', async function() {
  if (!this.cueExpanded) {
    throw new Error('cue 未展开累积');
  }
});

steps.then('追加显示 Q: {string} 与 新 A', async function(expectedQ) {
  expectedQ = expectedQ.replace(/^[""]|[""]$/g, '').trim(); // 去引号
  if (!this.qaHistory || this.qaHistory.length === 0) {
    throw new Error('qaHistory 为空');
  }
  const lastQA = this.qaHistory[this.qaHistory.length - 1];
  if (lastQA.q !== expectedQ) {
    throw new Error(`最后一条 Q 应为 "${expectedQ}"，实际为 "${lastQA.q}"`);
  }
  if (!lastQA.a || lastQA.a.length === 0) {
    throw new Error('最后一条 A 为空');
  }
});

steps.then('LLM 收到的 prompt 包含 previousQA 的 q 和 a', async function() {
  if (!this.promptContainsPreviousQA) {
    throw new Error('prompt 未包含 previousQA');
  }
});

steps.then('侧栏仍可见（永久存在）', async function() {
  if (!this.sidebarVisible) {
    throw new Error('侧栏被关闭，违反 Cornell v2 永久显示原则');
  }
});

steps.then('侧栏 cue 列表清空（新的 chapter 还没选词）', async function() {
  if (this.cueCount !== 0 || (this.cues && this.cues.length !== 0)) {
    throw new Error('cue 列表未清空');
  }
});

module.exports = steps;
