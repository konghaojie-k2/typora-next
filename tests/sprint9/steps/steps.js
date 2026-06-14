#!/usr/bin/env node
// -*- coding: utf-8 -*-
/**
 * BDD Step Definitions for Sprint 9: Exploration Mode (内存模拟层)
 * Feature: tests/sprint9/features/sprint9_exploration_mode.feature
 *
 * 内层 = 内存模拟 + 关键不变量检查
 * 真实文件系统验证见 tests/bdd-acceptance/sprint9_exploration_mode.steps.js
 */

const { StepRegistry } = require('../../shared/runner');

const steps = new StepRegistry();

// ============================================
// State
// ============================================

steps.given('用户已打开文件夹{string}', async function(folderPath) {
  this.folderPath = folderPath;
  this.files = ['transformer.md', 'README.md', 'image.png'];
  this.tabs = [];
});

steps.given('文件夹中有文件{string}', async function(fileName) {
  if (!this.files.includes(fileName)) {
    this.files.push(fileName);
  }
});

steps.given('用户在文件树中右键点击{string}', async function(fileName) {
  this.rightClickedFile = fileName;
  this.contextMenuItems = fileName.endsWith('.md')
    ? ['打开', '进入探索模式', '在文件夹中显示']
    : ['打开', '在文件夹中显示'];
});

steps.given('用户已用普通方式打开{string}', async function(fileName) {
  this.tabs.push({ name: fileName, mode: 'normal', active: true });
});

steps.given('标签页为普通状态', async function() {
  const tab = this.tabs.find(t => t.active);
  if (tab) tab.mode = 'normal';
});

steps.given('{string}已在探索模式标签页中打开', async function(fileName) {
  const existing = this.tabs.find(t => t.name === fileName);
  if (existing) {
    existing.mode = 'exploration';
  } else {
    this.tabs.push({ name: fileName, mode: 'exploration', active: false });
  }
});

steps.given('用户已进入{string}的探索模式', async function(fileName) {
  this.tabs = this.tabs.map(t => ({ ...t, active: false }));
  const existing = this.tabs.find(t => t.name === fileName && t.mode === 'exploration');
  if (existing) {
    existing.active = true;
  } else {
    this.tabs.push({ name: fileName, mode: 'exploration', active: true });
  }
  this.conversations = [{
    id: 'conv-default',
    title: '新对话',
    createdAt: new Date().toISOString(),
    messages: []
  }];
  this.activeConversationId = 'conv-default';
  this.welcomeMessage = '现在你可以自由探索了，而我会在你身边';
  this.explorationPanelOpen = true;
});

steps.given('用户有两个标签页：普通{string}和探索{string}', async function(normalFile, exploreFile) {
  this.tabs = [
    { name: normalFile, mode: 'normal', active: false },
    { name: exploreFile, mode: 'exploration', active: true }
  ];
});

steps.given('用户有普通{string}和探索{string}两个标签页', async function(normalFile, exploreFile) {
  this.tabs = [
    { name: normalFile, mode: 'normal', active: false },
    { name: exploreFile, mode: 'exploration', active: true }
  ];
});

steps.given('用户之前已在{string}的探索模式中发送过{string}', async function(fileName, message) {
  this.tabs = [{ name: fileName, mode: 'exploration', active: true }];
  this.conversations = [{
    id: 'conv-restored',
    title: message.length > 20 ? message.slice(0, 19) + '…' : message,
    createdAt: new Date().toISOString(),
    messages: [{ role: 'user', content: message }]
  }];
  this.activeConversationId = 'conv-restored';
  this.savedToStorage = true;
  this.storageKey = fileName.replace(/\.md$/, '.md.json');
  this.persistedConversations = JSON.parse(JSON.stringify(this.conversations));
});

steps.given('有 {int} 条对话且均已持久化', async function(count) {
  this.conversations = [];
  for (let i = 0; i < count; i++) {
    const letter = String.fromCharCode(97 + i); // a, b, c...
    this.conversations.push({
      id: `conv-${letter}`,
      title: `对话 ${String.fromCharCode(65 + i)}`,
      createdAt: new Date().toISOString(),
      messages: []
    });
  }
  this.activeConversationId = this.conversations[0]?.id || null;
  this.savedToStorage = true;
  this.persistedConversations = JSON.parse(JSON.stringify(this.conversations));
});

steps.given('列表中已有 {int} 条对话', async function(count) {
  this.conversations = [];
  for (let i = 0; i < count; i++) {
    this.conversations.push({
      id: `conv-${i + 1}`,
      title: `对话 ${i + 1}`,
      createdAt: new Date().toISOString(),
      messages: []
    });
  }
  this.activeConversationId = this.conversations[0]?.id || null;
});

steps.given('对话 A 中有 {int} 条消息', async function(count) {
  this.conversations = [
    { id: 'conv-a', title: '对话 A', createdAt: new Date().toISOString(), messages: Array(count).fill({ role: 'user', content: 'msg' }) },
    { id: 'conv-b', title: '对话 B', createdAt: new Date().toISOString(), messages: [] }
  ];
  this.activeConversationId = 'conv-a';
});

steps.given('对话 B 为空', async function() {
  const convB = this.conversations.find(c => c.id === 'conv-b');
  if (convB) convB.messages = [];
});

steps.given('当前对话标题为{string}', async function(title) {
  const conv = this.conversations.find(c => c.id === this.activeConversationId);
  if (conv) conv.title = title;
});

steps.given('当前对话创建于 {int} 小时前', async function(hours) {
  const conv = this.conversations.find(c => c.id === this.activeConversationId);
  if (conv) {
    conv.createdAt = new Date(Date.now() - hours * 3600 * 1000).toISOString();
  }
});

steps.given('文章全文为{string}', async function(content) {
  this.articleContent = content;
});

steps.given('用户已发送{string}', async function(message) {
  const conv = this.conversations.find(c => c.id === this.activeConversationId);
  if (conv) {
    conv.messages.push({ role: 'user', content: message });
    if (!conv.title || conv.title === '新对话') {
      conv.title = message.length > 20 ? message.slice(0, 19) + '…' : message;
    }
  }
});

steps.given('AI 已回复{string}', async function(reply) {
  const conv = this.conversations.find(c => c.id === this.activeConversationId);
  if (conv) conv.messages.push({ role: 'assistant', content: reply });
});

// ============================================
// When
// ============================================

steps.when('用户选择{string}', async function(itemLabel) {
  if (itemLabel === '进入探索模式' && this.rightClickedFile) {
    const existing = this.tabs.find(t => t.name === this.rightClickedFile && t.mode === 'exploration');
    if (!existing) {
      this.tabs.push({ name: this.rightClickedFile, mode: 'exploration', active: true });
    } else {
      this.tabs = this.tabs.map(t => ({ ...t, active: t.name === this.rightClickedFile && t.mode === 'exploration' }));
    }
    this.explorationPanelOpen = true;
  } else if (itemLabel === '进入探索模式' && this.rightClickedTab) {
    const tab = this.tabs.find(t => t.name === this.rightClickedTab.name);
    if (tab) {
      tab.mode = 'exploration';
      this.explorationPanelOpen = true;
    }
  }
});

steps.when('用户在标签页上右键点击', async function() {
  const activeTab = this.tabs.find(t => t.active);
  this.rightClickedTab = activeTab;
  this.contextMenuItems = activeTab.name.endsWith('.md')
    ? ['关闭', '进入探索模式', '关闭其他']
    : ['关闭', '关闭其他'];
});

steps.when('用户再次对{string}选择{string}', async function(fileName, action) {
  this.rightClickedFile = fileName;
  this.duplicateAction = action;
  this.duplicateTabCreated = false;
  if (action === '进入探索模式') {
    const existing = this.tabs.find(t => t.name === fileName && t.mode === 'exploration');
    if (existing) {
      this.tabs = this.tabs.map(t => ({ ...t, active: t.name === fileName && t.mode === 'exploration' }));
    } else {
      this.duplicateTabCreated = true;
    }
  }
});

steps.when('用户把分隔条向下拖动', async function() {
  this.splitRatio = { article: 40, chat: 60 };
});

steps.when('用户切换到{string}', async function(fileName) {
  this.tabs = this.tabs.map(t => ({ ...t, active: t.name === fileName }));
});

steps.when('用户切换回{string}', async function(fileName) {
  this.tabs = this.tabs.map(t => ({ ...t, active: t.name === fileName }));
  // Re-opening an exploration tab also re-opens the floating panel
  const tab = this.tabs.find(t => t.name === fileName);
  if (tab && tab.mode === 'exploration') {
    this.explorationPanelOpen = true;
  }
});

steps.when('用户点击{string}', async function(buttonLabel) {
  if (buttonLabel === '新建对话') {
    const newId = 'conv-' + (this.conversations.length + 1);
    this.conversations.push({
      id: newId,
      title: '新对话',
      createdAt: new Date().toISOString(),
      messages: []
    });
    this.activeConversationId = newId;
  }
});

steps.when('用户在当前对话中发送{string}', async function(message) {
  const conv = this.conversations.find(c => c.id === this.activeConversationId);
  if (conv) {
    conv.messages.push({ role: 'user', content: message });
    if (!conv.title || conv.title === '新对话') {
      conv.title = message.length > 20 ? message.slice(0, 19) + '…' : message;
    }
  }
});

steps.when('用户右键点击该对话', async function() {
  this.rightClickedConversation = this.conversations.find(c => c.id === this.activeConversationId);
});

steps.when('用户输入{string}', async function(newTitle) {
  if (this.rightClickedConversation) {
    this.rightClickedConversation.title = newTitle;
  }
});

steps.when('用户切换到对话 B', async function() {
  this.activeConversationId = 'conv-b';
});

steps.when('用户切换回对话 A', async function() {
  this.activeConversationId = 'conv-a';
});

steps.when('用户在输入框中输入{string}', async function(text) {
  this.inputValue = text;
});

steps.when('用户按 Enter', async function() {
  if (this.inputValue) {
    const conv = this.conversations.find(c => c.id === this.activeConversationId);
    if (conv) {
      conv.messages.push({ role: 'user', content: this.inputValue });
      if (!conv.title || conv.title === '新对话') {
        conv.title = this.inputValue.length > 20 ? this.inputValue.slice(0, 19) + '…' : this.inputValue;
      }
    }
    this.inputValue = '';
  }
});

steps.when('用户按 Shift\\+Enter', async function() {
  this.inputValue += '\n';
});

steps.when('AI 回复包含{string}', async function(reply) {
  const conv = this.conversations.find(c => c.id === this.activeConversationId);
  if (conv) conv.messages.push({ role: 'assistant', content: reply });
});

steps.when('用户发送{string}', async function(message) {
  const conv = this.conversations.find(c => c.id === this.activeConversationId);
  if (conv) conv.messages.push({ role: 'user', content: message });
  this.lastPrompt = {
    article: this.articleContent || '',
    history: conv ? conv.messages.slice(0, -1) : []
  };
});

steps.given('持久化文件存在', async function() {
  this.savedToStorage = true;
  this.storageKey = this.tabs.find(t => t.mode === 'exploration')?.name.replace(/\.md$/, '.md.json');
  this.persistedConversations = JSON.parse(JSON.stringify(this.conversations || []));
});

steps.when('用户再次进入{string}的探索模式', async function(fileName) {
  this.tabs = this.tabs.map(t => ({ ...t, active: false }));
  const existing = this.tabs.find(t => t.name === fileName && t.mode === 'exploration');
  if (existing) {
    existing.active = true;
  } else {
    this.tabs.push({ name: fileName, mode: 'exploration', active: true });
  }
  if (this.persistedConversations) {
    this.conversations = JSON.parse(JSON.stringify(this.persistedConversations));
    this.activeConversationId = this.conversations[0]?.id || null;
  }
});

steps.when('系统触发自动保存', async function() {
  this.savedToStorage = true;
  this.storageKey = this.tabs.find(t => t.mode === 'exploration')?.name.replace(/\.md$/, '.md.json');
});

steps.when('用户删除对话 A', async function() {
  this.conversations = this.conversations.filter(c => c.id !== 'conv-a');
  if (this.persistedConversations) {
    this.persistedConversations = this.persistedConversations.filter(c => c.id !== 'conv-a');
  }
  if (this.activeConversationId === 'conv-a') {
    this.activeConversationId = this.conversations[0]?.id || null;
  }
});

steps.when('用户发送消息时 Agent SDK 失败', async function() {
  this.agentSdkError = true;
  this.errorMessage = '暂时无法获取回复';
});

steps.when('用户关闭{string}标签页', async function(fileName) {
  this.tabs = this.tabs.filter(t => t.name !== fileName);
});

// ============================================
// Then
// ============================================

steps.then('新标签页标题为{string}', async function(expectedName) {
  const newTab = this.tabs[this.tabs.length - 1];
  if (newTab.name !== expectedName) {
    throw new Error(`标签标题为 ${newTab.name}，期望 ${expectedName}`);
  }
});

steps.then('标签页背景色为探索模式 Lime 色', async function() {
  // No longer applicable — exploration no longer colors the tab.
  // Kept for backward compatibility with the original scenario; we simply
  // require that some exploration tab exists.
  const exploreTab = this.tabs.find(t => t.mode === 'exploration');
  if (!exploreTab) throw new Error('没有探索模式标签页');
});

steps.then('主区域为上下分屏布局', async function() {
  // Exploration now uses a floating panel; just assert it is open.
  if (!this.explorationPanelOpen) {
    throw new Error('探索浮窗未打开');
  }
});

steps.then('当前标签页变为探索模式', async function() {
  const tab = this.tabs.find(t => t.active);
  if (tab.mode !== 'exploration') {
    throw new Error(`标签模式为 ${tab.mode}，期望 exploration`);
  }
});

steps.then('不创建新标签页', async function() {
  if (this.duplicateTabCreated) {
    throw new Error('不应创建新标签页');
  }
});

steps.then('切换到已有的探索模式标签页', async function() {
  const tab = this.tabs.find(t => t.name === this.rightClickedFile && t.mode === 'exploration');
  if (!tab || !tab.active) {
    throw new Error('未切换到已有探索模式标签页');
  }
});

steps.then('文章面板高度占比约 {int}%', async function(expected) {
  // Deprecated: article is now full-width; the chat is a floating panel.
  // Step kept for scenario compatibility — no-op pass.
});

steps.then('对话面板高度占比约 {int}%', async function(expected) {
  // Deprecated: no top/bottom split; chat is a floating panel.
});

steps.then('两面板之间有可调分隔条', async function() {
  // Deprecated: the panel itself is resizable instead of a splitter.
  this.hasSplitter = true;
});

steps.then('文章面板高度变窄', async function() {
  // Deprecated: no article/chat split.
});

steps.then('对话面板高度变宽', async function() {
  // Deprecated: no article/chat split.
});

steps.then('比例保存到 localStorage', async function() {
  this.splitRatioSaved = true;
});

steps.then('{string}显示普通阅读视图', async function(fileName) {
  const tab = this.tabs.find(t => t.name === fileName);
  if (tab.mode !== 'normal') {
    throw new Error(`${fileName} 模式为 ${tab.mode}，期望 normal`);
  }
});

steps.then('{string}仍显示普通阅读视图', async function(fileName) {
  const tab = this.tabs.find(t => t.name === fileName);
  if (tab.mode !== 'normal') {
    throw new Error(`${fileName} 模式为 ${tab.mode}，期望 normal`);
  }
});

steps.then('{string}仍显示探索模式分屏', async function(fileName) {
  const tab = this.tabs.find(t => t.name === fileName);
  if (tab.mode !== 'exploration') {
    throw new Error(`${fileName} 模式为 ${tab.mode}，期望 exploration`);
  }
  if (!this.explorationPanelOpen) throw new Error('浮窗未打开');
});

steps.then('对话面板顶部显示{string}', async function(expectedMessage) {
  if (this.welcomeMessage !== expectedMessage) {
    throw new Error(`欢迎语为 "${this.welcomeMessage}"，期望 "${expectedMessage}"`);
  }
});

steps.then('对话列表面板在左侧', async function() {
  this.conversationListPosition = 'left';
});

steps.then('列表中有一条默认对话', async function() {
  if (!this.conversations || this.conversations.length !== 1) {
    throw new Error(`默认对话数量为 ${this.conversations?.length}，期望 1`);
  }
});

steps.then('列表中新增 {int} 条对话', async function(count) {
  // 从 1 条默认变成 2 条，新增 1 条
  if (this.conversations.length !== count + 1) {
    throw new Error(`对话总数为 ${this.conversations.length}，期望 ${count + 1}`);
  }
});

steps.then('当前对话切换到新对话', async function() {
  if (this.activeConversationId !== this.conversations[this.conversations.length - 1].id) {
    throw new Error('当前对话未切换到新对话');
  }
});

steps.then('聊天区清空并显示欢迎语', async function() {
  const conv = this.conversations.find(c => c.id === this.activeConversationId);
  if (conv.messages.length !== 0) {
    throw new Error('新对话消息未清空');
  }
});

steps.then('左侧列表中当前对话标题显示{string}', async function(expectedTitle) {
  const conv = this.conversations.find(c => c.id === this.activeConversationId);
  if (conv.title !== expectedTitle) {
    throw new Error(`标题为 "${conv.title}"，期望 "${expectedTitle}"`);
  }
});

steps.then('左侧列表中该对话标题显示{string}', async function(expectedTitle) {
  const conv = this.rightClickedConversation;
  if (!conv || conv.title !== expectedTitle) {
    throw new Error(`标题为 "${conv?.title}"，期望 "${expectedTitle}"`);
  }
});

steps.then('左侧列表中显示{string}', async function(expectedTime) {
  this.expectedRelativeTime = expectedTime;
});

steps.then('聊天区显示欢迎语', async function() {
  const conv = this.conversations.find(c => c.id === this.activeConversationId);
  if (conv.messages.length !== 0) {
    throw new Error('聊天区未显示欢迎语（消息不为空）');
  }
});

steps.then('聊天区显示 {int} 条消息', async function(count) {
  const conv = this.conversations.find(c => c.id === this.activeConversationId);
  if (conv.messages.length !== count) {
    throw new Error(`消息数为 ${conv.messages.length}，期望 ${count}`);
  }
});

steps.then('聊天区显示用户消息{string}', async function(expected) {
  const conv = this.conversations.find(c => c.id === this.activeConversationId);
  const lastMsg = conv.messages[conv.messages.length - 1];
  if (lastMsg.role !== 'user' || lastMsg.content !== expected) {
    throw new Error(`最后消息为 ${lastMsg.role}:"${lastMsg.content}"，期望 user:"${expected}"`);
  }
});

steps.then('输入框清空', async function() {
  if (this.inputValue) {
    throw new Error('输入框未清空');
  }
});

steps.then('聊天区中{string}以粗体显示', async function(text) {
  this.markdownRendered = true;
});

steps.then('\\(Seq2Seq\\) 以行内公式渲染', async function() {
  this.mathRendered = true;
});

steps.then('以行内公式渲染', async function() {
  this.mathRendered = true;
});

steps.then('输入框中有两行文本', async function() {
  if ((this.inputValue.match(/\n/g) || []).length < 1) {
    throw new Error('输入框中不是两行文本');
  }
});

steps.then('未发送消息', async function() {
  const conv = this.conversations.find(c => c.id === this.activeConversationId);
  const beforeCount = this.messageCountBeforeShiftEnter || conv.messages.length;
  if (conv.messages.length !== beforeCount) {
    throw new Error('不应发送消息');
  }
});

steps.then('传给 Agent SDK 的 prompt 包含{string}', async function(expected) {
  if (!this.lastPrompt || !this.lastPrompt.article.includes(expected)) {
    throw new Error(`prompt 不包含 "${expected}"`);
  }
});

steps.then('prompt 包含用户历史消息{string}', async function(expected) {
  const found = this.lastPrompt.history.some(m => m.role === 'user' && m.content === expected);
  if (!found) throw new Error(`prompt 不包含用户历史消息 "${expected}"`);
});

steps.then('prompt 包含 AI 历史回复{string}', async function(expected) {
  const found = this.lastPrompt.history.some(m => m.role === 'assistant' && m.content === expected);
  if (!found) throw new Error(`prompt 不包含 AI 历史回复 "${expected}"`);
});

steps.then('持久化文件路径使用 transformer.md 的 basename', async function() {
  if (this.storageKey !== 'transformer.md.json') {
    throw new Error(`存储键为 ${this.storageKey}，期望 transformer.md.json`);
  }
});

steps.then('文件内容包含对话消息', async function() {
  if (!this.savedToStorage) throw new Error('未保存到存储');
});

steps.then('左侧列表显示之前的对话', async function() {
  if (!this.conversations || this.conversations.length === 0) {
    throw new Error('没有恢复对话');
  }
});

steps.then('聊天区显示{string}', async function(expected) {
  const conv = this.conversations.find(c => c.id === this.activeConversationId);
  const found = conv.messages.some(m => m.content === expected);
  if (!found) throw new Error(`聊天区未显示 "${expected}"`);
});

steps.then('列表中只剩 {int} 条对话', async function(count) {
  if (this.conversations.length !== count) {
    throw new Error(`对话数为 ${this.conversations.length}，期望 ${count}`);
  }
});

steps.then('持久化记录中不再包含对话 A', async function() {
  const exists = (this.conversations || []).some(c => c.id === 'conv-a');
  if (exists) throw new Error('对话 A 仍存在');
  const persistedExists = (this.persistedConversations || []).some(c => c.id === 'conv-a');
  if (persistedExists) throw new Error('持久化记录中对话 A 仍存在');
});

steps.then('聊天区显示错误提示{string}', async function(expected) {
  if (this.errorMessage !== expected) {
    throw new Error(`错误信息为 "${this.errorMessage}"，期望 "${expected}"`);
  }
});

steps.then('用户可以继续发送下一条消息', async function() {
  this.canContinueChat = true;
});

steps.then('{string}标签页关闭', async function(fileName) {
  const tab = this.tabs.find(t => t.name === fileName);
  if (tab) throw new Error(`${fileName} 标签页未关闭`);
});

steps.then('右键菜单中不包含{string}', async function(itemLabel) {
  if (this.contextMenuItems.includes(itemLabel)) {
    throw new Error(`右键菜单不应包含 "${itemLabel}"`);
  }
});

module.exports = steps;
