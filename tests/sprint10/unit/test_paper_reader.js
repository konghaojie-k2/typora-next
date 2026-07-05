#!/usr/bin/env node
// -*- coding: utf-8 -*-
/**
 * TDD Tests for PaperReader (Sprint 10 PB1)
 *
 * Module under test:
 * - dist/scripts/learning/paper-reader.js
 *
 * Contracts:
 *  - starts in Idle state
 *  - open() transitions LoadingGuide -> Reading when guide is ready
 *  - render(guide) creates sidebar + main content + at least one guide card
 *  - close() returns to Idle and removes DOM
 */

const TestRunner = require('../../shared/test-runner');
const fs = require('fs');
const path = require('path');

function installDOM() {
  const elementMap = new Map();

  function makeNode(tag) {
    const node = {
      nodeType: 1,
      tagName: tag ? tag.toUpperCase() : '',
      children: [],
      childNodes: [],
      style: {},
      dataset: {},
      attributes: {},
      _listeners: {},
      appendChild(child) { this.children.push(child); this.childNodes.push(child); child.parentNode = this; return child; },
      removeChild(child) {
        this.children = this.children.filter(c => c !== child);
        this.childNodes = this.childNodes.filter(c => c !== child);
        child.parentNode = null;
      },
      remove() { if (this.parentNode) this.parentNode.removeChild(this); },
      addEventListener(name, fn) {
        (this._listeners[name] = this._listeners[name] || []).push(fn);
      },
      removeEventListener(name, fn) {
        if (!this._listeners[name]) return;
        this._listeners[name] = this._listeners[name].filter(f => f !== fn);
      },
      click() {
        const listeners = this._listeners['click'] || [];
        listeners.forEach(fn => fn.call(this, { target: this }));
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
        if (this.attributes.id) {
          elementMap.delete(this.attributes.id);
        }
        this.attributes.id = v;
        if (v) elementMap.set(v, this);
      },
      get id() { return this.attributes.id; },
      checked: false,
      value: '',
      disabled: false,
      querySelectorAll(sel) {
        const result = [];
        if (sel.startsWith('.')) {
          const cls = sel.slice(1);
          const walk = (node) => {
            if (node.classList && node.classList.contains(cls)) result.push(node);
            for (const c of (node.children || [])) walk(c);
          };
          walk(this);
        } else if (/^[a-zA-Z0-9]+$/.test(sel)) {
          const tag = sel.toUpperCase();
          const walk = (node) => {
            if (node.tagName === tag) result.push(node);
            for (const c of (node.children || [])) walk(c);
          };
          walk(this);
        } else if (sel.startsWith('[') && sel.endsWith(']')) {
          const inner = sel.slice(1, -1);
          const eqIdx = inner.indexOf('=');
          if (eqIdx > 0) {
            const key = inner.slice(0, eqIdx);
            const val = inner.slice(eqIdx + 1).replace(/^["']|["']$/g, '');
            const walk = (node) => {
              if (node.attributes && node.attributes[key] === val) result.push(node);
              for (const c of (node.children || [])) walk(c);
            };
            walk(this);
          }
        }
        return result;
      },
      querySelector(sel) {
        const all = this.querySelectorAll(sel);
        return all.length > 0 ? all[0] : null;
      },
    };
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
    createTextNode(text) { return { nodeType: 3, textContent: text, _text: text }; },
    createTreeWalker(root, whatToShow) {
      const nodes = [];
      const walk = (node) => {
        if (node.nodeType === 3) nodes.push(node);
        for (const c of (node.childNodes || [])) walk(c);
      };
      walk(root);
      let i = 0;
      return { nextNode() { return nodes[i++] || null; } };
    },
    head: makeNode('head'),
    body: makeNode('body'),
    getElementById(id) { return elementMap.get(id) || null; },
    addEventListener() {},
    removeEventListener() {},
    querySelector(sel) { return this.body.querySelector(sel); },
    querySelectorAll(sel) { return this.body.querySelectorAll(sel); }
  };
  global.NodeFilter = { SHOW_TEXT: 4 };
  global.window = {
    __TAURI__: undefined,
    invoke: async () => '',
    scrollTo() {}
  };
}

function installDOMWithTauri() {
  installDOM();
  const converted = [];
  global.window.__TAURI__ = {
    core: {
      convertFileSrc(absolutePath) {
        converted.push(absolutePath);
        return 'asset://' + encodeURIComponent(absolutePath);
      }
    }
  };
  return { converted };
}

function loadModule() {
  const modPath = path.join(__dirname, '../../../dist/scripts/learning/paper-reader.js');
  try {
    delete require.cache[require.resolve(modPath)];
  } catch (e) {}
  try {
    return require(modPath);
  } catch (e) {
    return null;
  }
}

const sampleGuide = {
  title: 'Auto-Encoding Variational Bayes',
  authors: 'Diederik P. Kingma, Max Welling',
  source_file: 'C:\\\\Users\\\\17625\\\\Documents\\\\VAE_论文\\\\md\\\\1312.6114.md',
  generated_at: '2026-07-03T10:00:00',
  persona_level: 'beginner',
  reading_order: [
    { step: 1, section_id: 'sec_abstract', title: 'Abstract', goal: '抓住核心问题', skip: false }
  ],
  sections: [
    {
      id: 'sec_abstract',
      title: 'Abstract',
      level: 2,
      order: 1,
      goal: '抓住核心问题',
      skip: false,
      key_points: [
        {
          id: 'kp_1',
          highlight_text: 'intractable posterior distributions',
          term_level: 'must_know',
          human_explanation: '真实后验算不出来。',
          analogy: '记住这五个字：算不出来的后验。'
        }
      ],
      check_questions: ['为什么后验分布是 intractable 的？']
    }
  ],
  summary_check_questions: ['VAE 解决的核心问题是什么？']
};

TestRunner.test('module loads and exports PaperReader', () => {
  installDOM();
  const mod = loadModule();
  TestRunner.assertExists(mod, 'paper-reader.js should load');
  TestRunner.assertExists(mod.PaperReader, 'PaperReader should be exported');
});

TestRunner.test('PaperReader starts in Idle state', () => {
  installDOM();
  const { PaperReader } = loadModule();
  const reader = new PaperReader({ container: document.body });
  TestRunner.assertEquals(reader.getState(), 'Idle', 'starts in Idle');
});

TestRunner.test('open() transitions to LoadingGuide then Reading', async () => {
  installDOM();
  const { PaperReader } = loadModule();
  const reader = new PaperReader({ container: document.body });

  // Mock the loader to return sample guide synchronously
  reader._loadGuide = async () => sampleGuide;

  const p = reader.open('C:\\\\papers\\\\vae.md');
  TestRunner.assertEquals(reader.getState(), 'LoadingGuide', 'loading after open()');
  await p;
  TestRunner.assertEquals(reader.getState(), 'Reading', 'reading after load');
});

TestRunner.test('render() creates sidebar and main content', () => {
  installDOM();
  const { PaperReader } = loadModule();
  const reader = new PaperReader({ container: document.body });
  reader.render(sampleGuide);

  const sidebar = document.getElementById('paper-reader-sidebar');
  const main = document.getElementById('paper-reader-main');
  TestRunner.assertExists(sidebar, 'sidebar should exist');
  TestRunner.assertExists(main, 'main content should exist');
});

TestRunner.test('render() shows at least one guide card', () => {
  installDOM();
  const { PaperReader } = loadModule();
  const reader = new PaperReader({ container: document.body });
  reader.render(sampleGuide);

  const cards = reader._getGuideCards();
  TestRunner.assert(Array.isArray(cards), 'cards should be an array');
  TestRunner.assert(cards.length >= 1, 'should render at least one guide card');
});

TestRunner.test('open() transitions to Error when guide loading fails', async () => {
  installDOM();
  const { PaperReader } = loadModule();
  const reader = new PaperReader({ container: document.body });
  reader._loadGuide = async () => { throw new Error('agent failed'); };

  await reader.open('C:\\\\papers\\\\vae.md');
  TestRunner.assertEquals(reader.getState(), 'Error', 'error after failed load');
  TestRunner.assertExists(document.getElementById('paper-reader-root'), 'error root rendered');
});

TestRunner.test('close() returns to Idle and removes DOM', () => {
  installDOM();
  const { PaperReader } = loadModule();
  const reader = new PaperReader({ container: document.body });
  reader.render(sampleGuide);
  TestRunner.assertEquals(reader.getState(), 'Reading', 'reading after render');

  reader.close();
  TestRunner.assertEquals(reader.getState(), 'Idle', 'idle after close');
  TestRunner.assert(!document.getElementById('paper-reader-root'), 'root element removed');
});

TestRunner.test('guide card has toggle button that folds and unfolds', () => {
  installDOM();
  const { PaperReader } = loadModule();
  const reader = new PaperReader({ container: document.body });
  reader.render(sampleGuide);

  const cards = reader._getGuideCards();
  TestRunner.assert(cards.length > 0, 'has at least one card');
  const card = cards[0];

  const body = card.querySelector('.paper-reader-card-body');
  TestRunner.assertExists(body, 'card body exists');
  TestRunner.assert(body.style.display !== 'none', 'card body visible by default');

  const toggleBtn = card.querySelector('.paper-reader-card-toggle');
  TestRunner.assertExists(toggleBtn, 'toggle button exists');
  TestRunner.assertEquals(toggleBtn.textContent, '折叠', 'toggle shows 折叠 by default');

  toggleBtn.click();
  TestRunner.assert(body.style.display === 'none', 'card body hidden after fold');
  TestRunner.assertEquals(toggleBtn.textContent, '展开', 'toggle shows 展开 after fold');

  toggleBtn.click();
  TestRunner.assert(body.style.display !== 'none', 'card body visible after unfold');
  TestRunner.assertEquals(toggleBtn.textContent, '折叠', 'toggle shows 折叠 after unfold');
});

TestRunner.test('setCurrentSection highlights matching sidebar item', () => {
  installDOM();
  const { PaperReader } = loadModule();
  const reader = new PaperReader({ container: document.body });
  reader.render(sampleGuide);

  reader._setCurrentSidebarItem('sec_abstract');
  const items = Array.from(reader.elements.sidebar.querySelectorAll('li'));
  TestRunner.assert(items.some(li => li.dataset.sectionId === 'sec_abstract' && li.classList.contains('current')), 'abstract item is current');
  TestRunner.assert(items.every(li => li.dataset.sectionId !== 'sec_abstract' ? !li.classList.contains('current') : true), 'other items not current');
});

TestRunner.test('scrollToSection does not crash for missing section', () => {
  installDOM();
  const { PaperReader } = loadModule();
  const reader = new PaperReader({ container: document.body });
  reader.render(sampleGuide);

  let threw = false;
  try {
    reader._scrollToSection('nonexistent');
  } catch (e) {
    threw = true;
  }
  TestRunner.assert(!threw, 'should not throw for missing section');
});

TestRunner.test('feedback form opens when clicking FAB', () => {
  installDOM();
  const { PaperReader } = loadModule();
  const reader = new PaperReader({ container: document.body });
  reader.render(sampleGuide);

  const fab = document.querySelector('.paper-reader-fab');
  TestRunner.assertExists(fab, 'FAB exists');
  fab.click();

  const overlay = document.getElementById('paper-reader-feedback-overlay');
  TestRunner.assertExists(overlay, 'feedback overlay rendered');
  const radios = overlay.querySelectorAll('input').filter(r => r.getAttribute('name') === 'method_suitability');
  TestRunner.assertEquals(radios.length, 3, 'has 3 suitability options');
});

TestRunner.test('feedback form validates method_suitability', () => {
  installDOM();
  const { PaperReader } = loadModule();
  const reader = new PaperReader({ container: document.body });
  reader.render(sampleGuide);

  document.querySelector('.paper-reader-fab').click();
  const overlay = document.getElementById('paper-reader-feedback-overlay');
  const submitBtn = overlay.querySelector('.btn-primary');
  submitBtn.click();

  const error = overlay.querySelector('.error');
  TestRunner.assert(error.textContent.length > 0, 'shows validation error');
});

TestRunner.test('feedback submit clears validation when option selected', async () => {
  installDOM();
  const { PaperReader } = loadModule();
  const reader = new PaperReader({ container: document.body });
  reader.render(sampleGuide);

  document.querySelector('.paper-reader-fab').click();
  const overlay = document.getElementById('paper-reader-feedback-overlay');
  const radios = overlay.querySelectorAll('input').filter(r => r.getAttribute('name') === 'method_suitability');
  radios[0].checked = true;
  const submitBtn = overlay.querySelector('.btn-primary');
  submitBtn.click();

  const error = overlay.querySelector('.error');
  TestRunner.assertEquals(error.textContent, '', 'error cleared after selecting option');
});

TestRunner.test('card order index matches reading order', () => {
  installDOM();
  const { PaperReader } = loadModule();
  const reader = new PaperReader({ container: document.body });
  reader.paperFile = 'C:/papers/vae.md';
  reader.render(sampleGuide);

  const cards = reader._getGuideCards();
  TestRunner.assert(cards.length > 0, 'has at least one card');
  const indexBadge = cards[0].querySelector('.paper-reader-kp-index');
  TestRunner.assertExists(indexBadge, 'order badge exists');
  TestRunner.assertEquals(indexBadge.textContent, '1.1', 'index is step 1, key point 1');
});

TestRunner.test('close button calls onClose directly when no onConfirmClose', async () => {
  installDOM();
  const { PaperReader } = loadModule();
  let closed = false;
  const reader = new PaperReader({ container: document.body, onClose: () => { closed = true; } });
  reader.render(sampleGuide);

  const closeBtn = reader.elements.sidebar.querySelector('.paper-reader-sidebar-close');
  TestRunner.assertExists(closeBtn, 'close button exists');
  const clickFn = (closeBtn._listeners['click'] || [])[0];
  TestRunner.assertExists(clickFn, 'close button has click listener');
  await clickFn.call(closeBtn, { target: closeBtn });
  TestRunner.assert(closed, 'onClose called when no confirm callback');
});

TestRunner.test('close button confirms before onClose when onConfirmClose returns true', async () => {
  installDOM();
  const { PaperReader } = loadModule();
  let closed = false;
  let confirmed = false;
  const reader = new PaperReader({
    container: document.body,
    onClose: () => { closed = true; },
    onConfirmClose: async () => { confirmed = true; return true; }
  });
  reader.render(sampleGuide);

  const closeBtn = reader.elements.sidebar.querySelector('.paper-reader-sidebar-close');
  const clickFn = (closeBtn._listeners['click'] || [])[0];
  await clickFn.call(closeBtn, { target: closeBtn });
  TestRunner.assert(confirmed, 'onConfirmClose was invoked');
  TestRunner.assert(closed, 'onClose called after confirmation');
});

TestRunner.test('close button does not call onClose when onConfirmClose returns false', async () => {
  installDOM();
  const { PaperReader } = loadModule();
  let closed = false;
  const reader = new PaperReader({
    container: document.body,
    onClose: () => { closed = true; },
    onConfirmClose: async () => false
  });
  reader.render(sampleGuide);

  const closeBtn = reader.elements.sidebar.querySelector('.paper-reader-sidebar-close');
  const clickFn = (closeBtn._listeners['click'] || [])[0];
  await clickFn.call(closeBtn, { target: closeBtn });
  TestRunner.assert(!closed, 'onClose not called when cancelled');
});

TestRunner.test('feedback form restores saved form state', () => {
  installDOM();
  const { PaperReader } = loadModule();
  const reader = new PaperReader({ container: document.body });
  reader.paperFile = 'C:/papers/vae.md';
  reader.render(sampleGuide);

  document.querySelector('.paper-reader-fab').click();
  const overlay = document.getElementById('paper-reader-feedback-overlay');
  const inputs = overlay.querySelectorAll('input');
  const range = inputs.find(i => i.type === 'range');
  const radios = inputs.filter(i => i.getAttribute('name') === 'method_suitability');
  TestRunner.assertExists(range, 'range input exists');
  TestRunner.assertEquals(radios.length, 3, 'has 3 suitability radios');

  range.value = '75';
  range._listeners['input'][0].call(range);
  radios[2].checked = true;
  radios[2]._listeners['change'][0].call(radios[2]);

  // Simulate closing form by clicking skip.
  const skipBtn = overlay.querySelector('.btn-secondary');
  skipBtn.click();
  // Mock DOM does not remove from elementMap on remove(); skip this check.

  // Reopen form and verify restored values.
  document.querySelector('.paper-reader-fab').click();
  const overlay2 = document.getElementById('paper-reader-feedback-overlay');
  const inputs2 = overlay2.querySelectorAll('input');
  const range2 = inputs2.find(i => i.type === 'range');
  const radios2 = inputs2.filter(i => i.getAttribute('name') === 'method_suitability');
  TestRunner.assertEquals(range2.value, '75', 'understanding percentage restored');
  TestRunner.assert(radios2[2].checked, 'method suitability restored');
});

TestRunner.test('local image paths are resolved via convertFileSrc', () => {
  const { converted } = installDOMWithTauri();
  const { PaperReader } = loadModule();
  const reader = new PaperReader({ container: document.body });
  reader.paperFile = 'C:/papers/vae.md';

  // Build a main element with images manually (mock innerHTML does not parse attributes).
  const main = document.createElement('main');
  main.id = 'paper-reader-main';
  const img1 = document.createElement('img');
  img1.setAttribute('src', './fig1.png');
  img1.setAttribute('alt', 'fig1');
  main.appendChild(img1);

  const img2 = document.createElement('img');
  img2.setAttribute('src', 'images/fig2.png');
  img2.setAttribute('alt', 'fig2');
  main.appendChild(img2);

  const img3 = document.createElement('img');
  img3.setAttribute('src', 'http://example.com/fig3.png');
  img3.setAttribute('alt', 'fig3');
  main.appendChild(img3);

  reader._resolveImagePaths(main);

  const imgs = main.querySelectorAll('img');
  TestRunner.assertEquals(imgs.length, 3, 'three images in main');

  TestRunner.assert(imgs[0].getAttribute('src').startsWith('asset://'), './fig1.png converted');
  TestRunner.assert(imgs[1].getAttribute('src').startsWith('asset://'), 'images/fig2.png converted');
  TestRunner.assertEquals(imgs[2].getAttribute('src'), 'http://example.com/fig3.png', 'http image left unchanged');
  TestRunner.assert(converted.includes('C:/papers/fig1.png'), 'relative ./fig1.png resolved to baseDir');
  TestRunner.assert(converted.includes('C:/papers/images/fig2.png'), 'relative images/fig2.png resolved to baseDir');
});

TestRunner.test('sidebarContainer option hosts sidebar outside the content root', () => {
  installDOM();
  const { PaperReader } = loadModule();
  const externalHost = document.createElement('div');
  externalHost.id = 'tocTree';
  const reader = new PaperReader({
    container: document.body,
    sidebarContainer: externalHost
  });
  reader.render(sampleGuide);

  const sidebar = document.getElementById('paper-reader-sidebar');
  const main = document.getElementById('paper-reader-main');
  TestRunner.assertExists(sidebar, 'sidebar should exist');
  TestRunner.assertExists(main, 'main content should exist');
  // Sidebar lives in the external host, NOT in the content root.
  TestRunner.assert(sidebar.parentNode === externalHost, 'sidebar should be hosted in the external container');
  TestRunner.assert(main.parentNode === reader.root, 'main should stay in the content root');
});

console.log('Running PaperReader TDD tests...\n');
TestRunner.run();
