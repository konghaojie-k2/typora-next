#!/usr/bin/env node
// -*- coding: utf-8 -*-
/**
 * TDD Tests for ExplorationPanel (floating, draggable, closable)
 *
 * Module under test:
 * - dist/scripts/learning/exploration-ui.js
 *
 * Contracts:
 *  - mount() creates a panel element; isOpen() reports false until open()
 *  - open() shows the panel; close() hides it; Esc closes it
 *  - Position and size persist per file via localStorage
 *  - Panel is engine-agnostic: calls agentBridge.chatWithAgent (not SDK directly)
 *  - unmount() tears down DOM and listeners
 */

const TestRunner = require('../../shared/test-runner');
const fs = require('fs');
const path = require('path');

// ============================================
// jsdom shim — minimal DOM for the panel
// ============================================

function installDOM() {
  const elementMap = new Map();

  function makeNode(tag) {
    const node = {
      tagName: tag.toUpperCase(),
      children: [],
      style: {},
      dataset: {},
      attributes: {},
      disabled: false,
      _listeners: {},
      appendChild(child) { this.children.push(child); child.parentNode = this; return child; },
      removeChild(child) {
        this.children = this.children.filter(c => c !== child);
        child.parentNode = null;
        if (child.attributes && child.attributes.id) {
          elementMap.delete(child.attributes.id);
        }
      },
      remove() { if (this.parentNode) this.parentNode.removeChild(this); },
      addEventListener(name, fn) {
        (this._listeners[name] = this._listeners[name] || []).push(fn);
      },
      removeEventListener(name, fn) {
        if (!this._listeners[name]) return;
        this._listeners[name] = this._listeners[name].filter(f => f !== fn);
      },
      getBoundingClientRect() {
        const left = parseFloat(this.style.left || '0');
        const top = parseFloat(this.style.top || '0');
        const width = parseFloat(this.style.width || '0');
        const height = parseFloat(this.style.height || '0');
        return { left, top, width, height, right: left + width, bottom: top + height };
      },
      setAttribute(k, v) { this.attributes[k] = v; },
      getAttribute(k) { return this.attributes[k]; },
      set textContent(v) { this._text = v; },
      get textContent() { return this._text || ''; },
      set innerHTML(v) { this._html = v; },
      get innerHTML() { return this._html || ''; },
      set className(v) {
        this.attributes.class = v;
        const set = this.classList._set;
        set.clear();
        String(v || '').split(/\s+/).filter(Boolean).forEach(c => set.add(c));
      },
      get className() { return this.attributes.class || ''; },
      set id(v) {
        this.attributes.id = v;
        elementMap.set(v, this);
      },
      get id() { return this.attributes.id; },
      focus() {}
    };
    // classList bound to node so `this` is stable
    node.classList = {
      _set: new Set(),
      add(c) {
        this._set.add(c);
        node.attributes.class = Array.from(this._set).join(' ');
      },
      remove(c) {
        this._set.delete(c);
        node.attributes.class = Array.from(this._set).join(' ');
      },
      contains(c) { return this._set.has(c); },
      toggle(c, on) {
        if (on === undefined) {
          if (this._set.has(c)) this._set.delete(c);
          else this._set.add(c);
        } else if (on) this._set.add(c);
        else this._set.delete(c);
        node.attributes.class = Array.from(this._set).join(' ');
      }
    };
    return node;
  }

  global.document = {
    createElement: makeNode,
    body: makeNode('body'),
    getElementById(id) { return elementMap.get(id) || null; },
    addEventListener() {},
    removeEventListener() {},
    querySelector() { return null; },
    querySelectorAll() { return []; }
  };
  global.window = {
    __TAURI__: undefined,
    ExplorationSession: class {
      constructor() {
        this.conversations = [];
        this.activeConversationId = null;
      }
      load() {}
      save() {}
      getConversations() { return this.conversations; }
      getActiveConversation() { return this.conversations[0] || null; }
      setActiveConversation() {}
      createConversation() {
        const id = 'conv-' + Date.now();
        this.conversations.push({ id, title: '新对话', createdAt: new Date().toISOString(), messages: [] });
        this.activeConversationId = id;
        return id;
      }
      addMessage(role, content) {
        const c = this.conversations.find(x => x.id === this.activeConversationId);
        if (c) c.messages.push({ role, content });
      }
      renameConversation() {}
      deleteConversation() {}
    },
    formatRelativeTime: () => '刚刚',
    agentBridge: { chatWithAgent: async () => 'mock' }
  };
  global.localStorage = (() => {
    const store = {};
    return {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; }
    };
  })();
  global.Event = function () {};
  global.KeyboardEvent = function (e) { this.key = e.key; };
  global.window.innerWidth = 1280;
  global.window.innerHeight = 800;
}

function loadPanelModule() {
  const modPath = path.join(__dirname, '../../../dist/scripts/learning/exploration-ui.js');
  try {
    delete require.cache[require.resolve(modPath)];
    require(modPath);
  } catch (e) {
    return null;
  }
  return require(modPath);
}

// ============================================
// Tests
// ============================================

TestRunner.test('module loads and exports ExplorationPanel', () => {
  installDOM();
  const mod = loadPanelModule();
  TestRunner.assertExists(mod, 'exploration-ui.js should load');
  TestRunner.assertExists(mod.ExplorationPanel, 'ExplorationPanel should be exported');
  TestRunner.assertExists(window.ExplorationUI, 'Back-compat ExplorationUI should also exist');
});

TestRunner.test('panel starts closed after construction; open()/close() toggles state', () => {
  installDOM();
  const { ExplorationPanel } = loadPanelModule();
  const panel = new ExplorationPanel({ filePath: '/x/y.md', fileContent: 'hello' });
  TestRunner.assertEquals(panel.isOpen(), false, 'starts closed');
  panel.open();
  TestRunner.assertEquals(panel.isOpen(), true, 'open() opens');
  panel.close();
  TestRunner.assertEquals(panel.isOpen(), false, 'close() closes');
  panel.unmount();
});

TestRunner.test('Esc key closes the panel', () => {
  installDOM();
  const { ExplorationPanel } = loadPanelModule();
  const panel = new ExplorationPanel({ filePath: '/x/y.md', fileContent: 'hello' });
  panel.open();
  TestRunner.assertEquals(panel.isOpen(), true, 'open');
  // Simulate Esc
  panel._escHandler({ key: 'Escape' });
  TestRunner.assertEquals(panel.isOpen(), false, 'Esc closed');
  panel.unmount();
});

TestRunner.test('panel position and size persist per file in localStorage', () => {
  installDOM();
  const { ExplorationPanel } = loadPanelModule();
  const panel = new ExplorationPanel({ filePath: '/papers/transformer.md', fileContent: '' });
  panel.mount();
  // Simulate position save
  panel.elements.root.style.left = '120px';
  panel.elements.root.style.top = '80px';
  panel.elements.root.style.width = '500px';
  panel.elements.root.style.height = '600px';
  panel._savePosition();
  const raw = localStorage.getItem('exploration-panel-pos:transformer.md');
  TestRunner.assertExists(raw, 'position should be saved');
  const pos = JSON.parse(raw);
  TestRunner.assertEquals(pos.x, 120, 'x saved');
  TestRunner.assertEquals(pos.y, 80, 'y saved');
  TestRunner.assertEquals(pos.w, 500, 'width saved');
  TestRunner.assertEquals(pos.h, 600, 'height saved');
  panel.unmount();
});

TestRunner.test('unmount() removes DOM and stops reacting to Esc', () => {
  installDOM();
  const { ExplorationPanel } = loadPanelModule();
  const panel = new ExplorationPanel({ filePath: '/x.md', fileContent: '' });
  panel.open();
  TestRunner.assertEquals(panel.isOpen(), true, 'open');
  panel.unmount();
  TestRunner.assertEquals(panel.isOpen(), false, 'unmount closes');
  // Re-simulating Esc should not crash
  panel._escHandler({ key: 'Escape' });
});

TestRunner.test('two panels for different files are independent', () => {
  installDOM();
  const { ExplorationPanel } = loadPanelModule();
  const pA = new ExplorationPanel({ filePath: '/papers/a.md', fileContent: '' });
  const pB = new ExplorationPanel({ filePath: '/papers/b.md', fileContent: '' });
  pA.open();
  pB.open();
  TestRunner.assertEquals(pA.isOpen(), true, 'A open');
  TestRunner.assertEquals(pB.isOpen(), true, 'B open');
  pA.close();
  TestRunner.assertEquals(pA.isOpen(), false, 'A closed');
  TestRunner.assertEquals(pB.isOpen(), true, 'B still open');
  pA.unmount();
  pB.unmount();
});

TestRunner.test('panel calls agentBridge.chatWithAgent (engine-agnostic)', async () => {
  installDOM();
  // Simulate Tauri runtime so the panel takes the engine-agnostic branch
  window.__TAURI__ = { core: { invoke: async () => '' } };
  let captured = null;
  window.agentBridge = {
    chatWithAgent: async (args) => {
      captured = args;
      return 'OK';
    }
  };
  const modPath = path.join(__dirname, '../../../dist/scripts/learning/exploration-ui.js');
  delete require.cache[require.resolve(modPath)];
  const { ExplorationPanel } = require(modPath);
  const panel = new ExplorationPanel({
    filePath: '/papers/transformer.md',
    fileContent: 'Attention is all you need.'
  });
  panel.open();
  panel.session.createConversation();
  panel.session.addMessage('user', '请解释 Attention');
  await panel._requestAIResponse();
  TestRunner.assertExists(captured, 'agentBridge.chatWithAgent was called');
  TestRunner.assertEquals(captured.article, 'Attention is all you need.', 'article passed through');
  TestRunner.assertEquals(captured.message, '请解释 Attention', 'user message passed through');
  TestRunner.assert(Array.isArray(captured.history), 'history is an array');
  panel.unmount();
});

TestRunner.test('rendered panel contains a header, conv list, messages area, and resize handle', () => {
  installDOM();
  const { ExplorationPanel } = loadPanelModule();
  const panel = new ExplorationPanel({ filePath: '/x.md', fileContent: '' });
  panel.open();
  const root = panel.elements.root;
  const classNames = root.children.map(c => c.attributes && c.attributes.class).filter(Boolean);
  TestRunner.assert(classNames.some(c => c.includes('exploration-panel-header')), 'has header');
  TestRunner.assert(classNames.some(c => c.includes('exploration-panel-body')), 'has body wrapper');
  TestRunner.assert(classNames.some(c => c.includes('exploration-panel-resize')), 'has resize handle');
  // sidebar and main are inside the body wrapper
  const body = root.children.find(c =>
    c.attributes && c.attributes.class && c.attributes.class.includes('exploration-panel-body')
  );
  TestRunner.assertExists(body, 'body wrapper found');
  const bodyChildClasses = body.children.map(c => c.attributes && c.attributes.class).filter(Boolean);
  TestRunner.assert(bodyChildClasses.some(c => c.includes('exploration-panel-sidebar')), 'has sidebar inside body');
  TestRunner.assert(bodyChildClasses.some(c => c.includes('exploration-panel-main')), 'has main inside body');
  panel.unmount();
});

TestRunner.test('new conversation button creates a new active conversation', async () => {
  installDOM();
  const { ExplorationPanel } = loadPanelModule();
  const panel = new ExplorationPanel({ filePath: '/x.md', fileContent: '' });
  panel.open();
  const before = panel.session.getConversations().length;
  await panel._createConversation();
  const after = panel.session.getConversations().length;
  TestRunner.assertEquals(after, before + 1, 'conv count increased by 1');
  panel.unmount();
});

// ============================================
// Sprint 9 PB3: Real Agent SDK call + Loading state
// ============================================

TestRunner.test('_showLoading disables textarea and send button', () => {
  installDOM();
  const { ExplorationPanel } = loadPanelModule();
  const panel = new ExplorationPanel({ filePath: '/x.md', fileContent: '' });
  panel.open();
  TestRunner.assertExists(panel.elements.textarea, 'textarea exists');
  TestRunner.assertExists(panel.elements.sendBtn, 'sendBtn exists');
  TestRunner.assertEquals(panel.elements.textarea.disabled, false, 'textarea enabled before loading');
  TestRunner.assertEquals(panel.elements.sendBtn.disabled, false, 'sendBtn enabled before loading');
  panel._showLoading();
  TestRunner.assertEquals(panel.elements.textarea.disabled, true, 'textarea disabled during loading');
  TestRunner.assertEquals(panel.elements.sendBtn.disabled, true, 'sendBtn disabled during loading');
  panel._hideLoading();
  TestRunner.assertEquals(panel.elements.textarea.disabled, false, 'textarea re-enabled after loading');
  TestRunner.assertEquals(panel.elements.sendBtn.disabled, false, 'sendBtn re-enabled after loading');
  panel.unmount();
});

TestRunner.test('_showLoading adds loading DOM element with correct id', () => {
  installDOM();
  const { ExplorationPanel } = loadPanelModule();
  const panel = new ExplorationPanel({ filePath: '/test.md', fileContent: '' });
  panel.open();
  const area = panel.elements.messages;
  const beforeCount = area.children.length;
  panel._showLoading();
  TestRunner.assertEquals(area.children.length, beforeCount + 1, 'loading element added');
  const loadingEl = area.children[area.children.length - 1];
  TestRunner.assert(loadingEl.className.includes('loading'), 'has loading class');
  panel._hideLoading();
  TestRunner.assertEquals(area.children.length, beforeCount, 'loading element removed');
  panel.unmount();
});

TestRunner.test('web preview shows guidance message instead of placeholder', async () => {
  installDOM();
  window.__TAURI__ = undefined;
  window.agentBridge = { chatWithAgent: async () => 'mock' };
  const { ExplorationPanel } = loadPanelModule();
  const panel = new ExplorationPanel({ filePath: '/test.md', fileContent: 'content' });
  panel.open();
  panel.session.createConversation();
  panel.session.addMessage('user', 'hello');
  await panel._requestAIResponse();
  const conv = panel.session.getActiveConversation();
  const lastMsg = conv.messages[conv.messages.length - 1];
  TestRunner.assertEquals(lastMsg.role, 'assistant', 'response is from assistant');
  TestRunner.assert(lastMsg.content.includes('桌面应用'), 'guidance mentions desktop app');
  TestRunner.assert(!lastMsg.content.includes('占位符'), 'no placeholder text');
  panel.unmount();
});

TestRunner.test('Tauri mode calls agentBridge.chatWithAgent with article + history + message', async () => {
  installDOM();
  window.__TAURI__ = { core: { invoke: async () => '' } };
  let captured = null;
  window.agentBridge = {
    chatWithAgent: async (args) => {
      captured = args;
      return 'real response';
    }
  };
  const { ExplorationPanel } = loadPanelModule();
  const panel = new ExplorationPanel({
    filePath: '/papers/test.md',
    fileContent: 'Test article content.'
  });
  panel.open();
  panel.session.createConversation();
  panel.session.addMessage('user', 'Explain this');
  await panel._requestAIResponse();
  TestRunner.assertExists(captured, 'chatWithAgent was called');
  TestRunner.assertEquals(captured.article, 'Test article content.', 'article passed');
  TestRunner.assertEquals(captured.message, 'Explain this', 'message passed');
  panel.unmount();
});

TestRunner.test('SDK failure shows formatted error message', async () => {
  installDOM();
  window.__TAURI__ = { core: { invoke: async () => '' } };
  window.agentBridge = {
    chatWithAgent: async () => { throw new Error('API quota exceeded'); }
  };
  const { ExplorationPanel } = loadPanelModule();
  const panel = new ExplorationPanel({ filePath: '/test.md', fileContent: '' });
  panel.open();
  panel.session.createConversation();
  panel.session.addMessage('user', 'hello');
  await panel._requestAIResponse();
  const conv = panel.session.getActiveConversation();
  const lastMsg = conv.messages[conv.messages.length - 1];
  TestRunner.assertEquals(lastMsg.role, 'assistant', 'error message from assistant');
  TestRunner.assert(lastMsg.content.includes('回复生成失败'), 'shows failure title');
  TestRunner.assert(lastMsg.content.includes('API quota exceeded'), 'includes error detail');
  panel.unmount();
});

console.log('Running ExplorationPanel TDD tests...\n');
TestRunner.run();
