#!/usr/bin/env node
// -*- coding: utf-8 -*-
/**
 * TDD Tests for first-time onboarding guide (v2: welcome + 3 sections)
 */

const TestRunner = require('../../shared/test-runner');

const ONBOARDING_STORAGE_KEY = 'typora-next.hasSeenOnboarding';

const TOOLBAR_STEPS = [
  { target: '#openFileBtn', title: '打开文件', description: '打开单个 Markdown 文件' },
  { target: '#openFolderToolbarBtn', title: '打开文件夹', description: '打开工作区' },
  { target: '#settingsBtn', title: '设置', description: '配置偏好' }
];

const SECTIONS = [
  { label: '工具栏', steps: TOOLBAR_STEPS }
];

function createOnboardingManager(options = {}) {
  const document = options.document || null;
  const storage = options.storage || { _data: {}, getItem(k) { return this._data[k] || null; }, setItem(k, v) { this._data[k] = String(v); }, removeItem(k) { delete this._data[k]; } };
  const onOpenDemo = options.onOpenDemo || null;

  let phase = 'idle';
  let currentSection = 0;
  let currentStep = 0;
  let container = null;
  let card = null;
  let openedMenuTrigger = null;
  const sections = options.sections || SECTIONS;

  function hasSeen() { try { return storage.getItem(ONBOARDING_STORAGE_KEY) === 'true'; } catch (e) { return false; } }
  function markSeen() { try { storage.setItem(ONBOARDING_STORAGE_KEY, 'true'); } catch (e) {} }
  function markUnseen() { try { storage.removeItem(ONBOARDING_STORAGE_KEY); } catch (e) {} }

  function buildUI() {
    if (container) return;
    container = document.createElement('div');
    container.className = 'onboarding-overlay';
    container.style.display = 'none';

    const spotlight = document.createElement('div');
    spotlight.className = 'onboarding-spotlight';
    container.appendChild(spotlight);

    card = document.createElement('div');
    card.className = 'onboarding-card';

    const title = document.createElement('h3');
    title.className = 'onboarding-card-title';
    card.appendChild(title);

    const desc = document.createElement('p');
    desc.className = 'onboarding-card-desc';
    card.appendChild(desc);

    const progress = document.createElement('div');
    progress.className = 'onboarding-card-progress';
    card.appendChild(progress);

    const actions = document.createElement('div');
    actions.className = 'onboarding-card-actions';

    const prevBtn = document.createElement('button');
    prevBtn.className = 'onboarding-btn onboarding-btn-prev';
    prevBtn.textContent = '上一步';
    prevBtn.addEventListener('click', prevStep);
    actions.appendChild(prevBtn);

    const skipBtn = document.createElement('button');
    skipBtn.className = 'onboarding-btn onboarding-btn-skip';
    skipBtn.textContent = '跳过引导';
    skipBtn.addEventListener('click', skip);
    actions.appendChild(skipBtn);

    const nextBtn = document.createElement('button');
    nextBtn.className = 'onboarding-btn onboarding-btn-next';
    nextBtn.textContent = '下一步';
    nextBtn.addEventListener('click', nextStep);
    actions.appendChild(nextBtn);

    card.appendChild(actions);
    container.appendChild(card);
    document.body.appendChild(container);
  }

  function showWelcome() {
    buildUI();
    phase = 'welcome';
    const spotlight = container.querySelector('.onboarding-spotlight');
    spotlight.style.display = 'none';
    card.className = 'onboarding-card onboarding-card-welcome';
    card.style.position = 'fixed';
    card.style.top = '50%';
    card.style.left = '50%';
    card.style.transform = 'translate(-50%, -50%)';

    const title = card.querySelector('.onboarding-card-title');
    const desc = card.querySelector('.onboarding-card-desc');
    const progress = card.querySelector('.onboarding-card-progress');
    const prevBtn = card.querySelector('.onboarding-btn-prev');
    const skipBtn = card.querySelector('.onboarding-btn-skip');
    const nextBtn = card.querySelector('.onboarding-btn-next');
    title.textContent = '欢迎使用 Typora Next！🎉';
    desc.textContent = '是否先了解一下各个功能？';
    progress.textContent = '';
    prevBtn.style.display = 'none';
    skipBtn.textContent = '跳过，直接使用';
    nextBtn.textContent = '是的，开始引导';
    container.style.display = 'flex';
  }

  function hide() { closeStepMenu(); if (container) container.style.display = 'none'; }

  function openStepMenu(step) {
    if (!step.openMenu) return;
    const menu = document.querySelector(step.openMenu);
    const trigger = document.querySelector(step.target);
    if (!menu || !trigger) return;
    menu.classList.add('open');
    trigger.setAttribute('aria-expanded', 'true');
    openedMenuTrigger = { menu, trigger };
  }

  function closeStepMenu() {
    if (!openedMenuTrigger) return;
    openedMenuTrigger.menu.classList.remove('open');
    openedMenuTrigger.trigger.setAttribute('aria-expanded', 'false');
    openedMenuTrigger = null;
  }

  async function startTour() {
    phase = 'touring';
    if (onOpenDemo) { try { await onOpenDemo(); } catch (e) {} }
    showSectionIntro(0);
  }

  function showSectionIntro(sectionIdx) {
    phase = 'touring';
    currentSection = sectionIdx;
    currentStep = -1;
    const spotlight = container.querySelector('.onboarding-spotlight');
    spotlight.style.display = 'block';
    card.classList.remove('onboarding-card-welcome');
    card.style.position = '';
    card.style.top = '';
    card.style.left = '';
    card.style.transform = '';
    const section = sections[sectionIdx];
    const title = card.querySelector('.onboarding-card-title');
    const desc = card.querySelector('.onboarding-card-desc');
    const progress = card.querySelector('.onboarding-card-progress');
    const prevBtn = card.querySelector('.onboarding-btn-prev');
    const nextBtn = card.querySelector('.onboarding-btn-next');
    title.textContent = section.label;
    desc.textContent = `${section.steps.length} 个步骤`;
    progress.textContent = `${section.steps.length} 个步骤`;
    prevBtn.style.display = sectionIdx > 0 ? '' : 'none';
    nextBtn.textContent = '开始';
    closeStepMenu();
    container.style.display = 'flex';
  }

  function updateTourStep() {
    const steps = sections[currentSection].steps;
    const step = steps[currentStep];
    closeStepMenu();
    const title = card.querySelector('.onboarding-card-title');
    const desc = card.querySelector('.onboarding-card-desc');
    const progress = card.querySelector('.onboarding-card-progress');
    const nextBtn = card.querySelector('.onboarding-btn-next');
    title.textContent = step.title;
    desc.textContent = step.description;
    const totalSteps = sections.reduce((s, sec) => s + sec.steps.length, 0);
    const stepIndexBefore = sections.slice(0, currentSection).reduce((s, sec) => s + sec.steps.length, 0);
    progress.textContent = `步骤 ${stepIndexBefore + currentStep + 1} / ${totalSteps}`;
    nextBtn.textContent = (currentSection === sections.length - 1 && currentStep === steps.length - 1) ? '完成' : '下一步';

    const target = document.querySelector(step.target);
    if (target) {
      const spotlight = container.querySelector('.onboarding-spotlight');
      const padding = step.spotlightArea ? 4 : 6;
      const rect = target.getBoundingClientRect();
      spotlight.style.top = `${rect.top - padding}px`;
      spotlight.style.left = `${rect.left - padding}px`;
      spotlight.style.width = `${rect.width + padding * 2}px`;
      spotlight.style.height = `${rect.height + padding * 2}px`;
      spotlight.style.display = 'block';
      openStepMenu(step);
    }
  }

  function nextStep() {
    if (phase === 'welcome') { startTour(); return; }
    if (phase !== 'touring') return;
    const steps = sections[currentSection].steps;
    if (currentStep === -1) { currentStep = 0; updateTourStep(); return; }
    if (currentStep < steps.length - 1) { currentStep++; updateTourStep(); }
    else if (currentSection < sections.length - 1) { showSectionIntro(currentSection + 1); }
    else { finish(); }
  }

  function prevStep() {
    if (phase !== 'touring') return;
    if (currentStep === -1) {
      if (currentSection > 0) { currentSection--; currentStep = sections[currentSection].steps.length - 1; updateTourStep(); }
      return;
    }
    if (currentStep > 0) { currentStep--; updateTourStep(); }
    else if (currentSection > 0) {
      currentSection--;
      currentStep = sections[currentSection].steps.length - 1;
      updateTourStep();
    }
  }

  function skip() { markSeen(); phase = 'done'; hide(); }
  function finish() { markSeen(); phase = 'done'; hide(); }

  function start() {
    if (hasSeen()) return { didShow: false };
    showWelcome();
    return { didShow: true };
  }

  function restart() { markUnseen(); showWelcome(); }

  return {
    start, startTour, restart, nextStep, prevStep, skip, finish, hide,
    hasSeen, markSeen, markUnseen, getState: () => ({ phase, currentSection, currentStep }),
    getCurrentSection: () => currentSection, getCurrentStep: () => currentStep
  };
}

function createFakeDocument() {
  const buttons = [];

  function createElement(tag) {
    const el = {
      tagName: tag.toUpperCase(), _attrs: {}, _classes: [], _listeners: {}, _children: [],
      style: {}, _textContent: '',

      get className() { return el._classes.join(' '); },
      set className(v) { el._classes = v.split(/\s+/).filter(Boolean); },
      get textContent() { return el._textContent; },
      set textContent(v) { el._textContent = v; },

      classList: {
        add(c) { if (!el._classes.includes(c)) el._classes.push(c); },
        remove(c) { el._classes = el._classes.filter(x => x !== c); },
        contains(c) { return el._classes.includes(c); }
      },

      setAttribute(k, v) { el._attrs[k] = String(v); },
      getAttribute(k) { return el._attrs[k] ?? null; },
      removeAttribute(k) { delete el._attrs[k]; },

      appendChild(c) { el._children.push(c); c._parent = el; return c; },
      remove() { if (el._parent) el._parent.removeChild(el); },

      addEventListener(ev, fn) { (el._listeners[ev] = el._listeners[ev] || []).push(fn); },
      removeEventListener(ev, fn) { if (el._listeners[ev]) el._listeners[ev] = el._listeners[ev].filter(f => f !== fn); },

      click() { (el._listeners.click || []).forEach(fn => fn({ target: el })); },

      querySelector(sel) {
        if (sel.startsWith('#')) { return buttons.find(b => b._attrs.id === sel.slice(1)) || null; }
        if (sel.startsWith('.')) {
          for (const c of el._children) {
            if (c._classes.includes(sel.slice(1))) return c;
            const nested = c.querySelector(sel);
            if (nested) return nested;
          }
        }
        return null;
      },

      querySelectorAll(sel) {
        const out = [];
        if (sel.startsWith('.')) {
          for (const c of el._children) {
            if (c._classes.includes(sel.slice(1))) out.push(c);
            out.push(...c.querySelectorAll(sel));
          }
        }
        return out;
      },

      getBoundingClientRect() { return { top: 10, left: 10, width: 32, height: 32, bottom: 42, right: 42 }; }
    };
    return el;
  }

  const body = createElement('body');

  function addButton(id) {
    const btn = createElement('button');
    btn._attrs.id = id;
    btn._classes = ['btn-icon'];
    body.appendChild(btn);
    buttons.push(btn);
    return btn;
  }

  function addElement(id, className) {
    const el = createElement('div');
    if (id) el._attrs.id = id;
    if (className) el._classes = className.split(/\s+/);
    body.appendChild(el);
    return el;
  }

  return {
    body, createElement, addButton, addElement, _buttons: buttons,
    querySelector: body.querySelector,
    querySelectorAll: body.querySelectorAll
  };
}

function createFakeStorage(initial = {}) {
  return { _data: { ...initial }, getItem(k) { return this._data[k] || null; }, setItem(k, v) { this._data[k] = String(v); }, removeItem(k) { delete this._data[k]; } };
}

// ============================================
// Tests
// ============================================
TestRunner.test('First launch shows welcome dialog, not directly the tour', () => {
  const doc = createFakeDocument();
  doc.addButton('openFileBtn');
  const storage = createFakeStorage();
  const om = createOnboardingManager({ document: doc, storage });

  const result = om.start();
  TestRunner.assertEquals(result.didShow, true, 'should show welcome');
  const state = om.getState();
  TestRunner.assertEquals(state.phase, 'welcome', 'should be in welcome phase');
  const title = doc.querySelector('.onboarding-card-title');
  TestRunner.assertEquals(title.textContent, '欢迎使用 Typora Next！🎉', 'welcome title mismatch');
});

TestRunner.test('Welcome dialog has start and skip buttons', () => {
  const doc = createFakeDocument();
  doc.addButton('openFileBtn');
  const om = createOnboardingManager({ document: doc, storage: createFakeStorage() });
  om.start();

  const skipBtn = doc.querySelector('.onboarding-btn-skip');
  const nextBtn = doc.querySelector('.onboarding-btn-next');
  TestRunner.assertEquals(skipBtn.textContent, '跳过，直接使用', 'skip button text');
  TestRunner.assertEquals(nextBtn.textContent, '是的，开始引导', 'start button text');
});

TestRunner.test('Clicking start tour enters toolbar section intro', async () => {
  const doc = createFakeDocument();
  doc.addButton('openFileBtn');
  doc.addButton('openFolderToolbarBtn');
  doc.addButton('settingsBtn');
  const om = createOnboardingManager({ document: doc, storage: createFakeStorage() });
  om.start();

  const nextBtn = doc.querySelector('.onboarding-btn-next');
  nextBtn.click(); // This triggers startTour which is async

  // Wait for microtasks
  await new Promise(r => setTimeout(r, 0));

  const state = om.getState();
  TestRunner.assertEquals(state.phase, 'touring', 'should be in touring phase');
  TestRunner.assertEquals(state.currentSection, 0, 'should be in toolbar section');
  const title = doc.querySelector('.onboarding-card-title');
  TestRunner.assertEquals(title.textContent, '工具栏', 'section title mismatch');
});

TestRunner.test('Clicking start in section intro advances to first button step', async () => {
  const doc = createFakeDocument();
  doc.addButton('openFileBtn');
  doc.addButton('openFolderToolbarBtn');
  doc.addButton('settingsBtn');
  const om = createOnboardingManager({ document: doc, storage: createFakeStorage() });
  om.start();
  const nextBtn = doc.querySelector('.onboarding-btn-next');
  nextBtn.click(); // welcome → startTour
  await new Promise(r => setTimeout(r, 0));

  // Now at section intro with "开始" button
  TestRunner.assertEquals(nextBtn.textContent, '开始', 'should show start button');
  nextBtn.click(); // section intro → first step
  TestRunner.assertEquals(om.getCurrentStep(), 0, 'should be at step 0');
  const title = doc.querySelector('.onboarding-card-title');
  TestRunner.assertEquals(title.textContent, '打开文件', 'first step title mismatch');
});

TestRunner.test('Navigating through all toolbar steps and finishing', async () => {
  const doc = createFakeDocument();
  doc.addButton('openFileBtn');
  doc.addButton('openFolderToolbarBtn');
  doc.addButton('settingsBtn');
  const om = createOnboardingManager({ document: doc, storage: createFakeStorage() });
  om.start();
  const nextBtn = doc.querySelector('.onboarding-btn-next');
  nextBtn.click(); // welcome
  await new Promise(r => setTimeout(r, 0));

  nextBtn.click(); // section intro → step 0 (openFileBtn)
  nextBtn.click(); // step 1 (openFolderToolbarBtn)
  nextBtn.click(); // step 2 (settingsBtn) — last toolbar step
  TestRunner.assertEquals(om.getCurrentStep(), 2, 'should be at last toolbar step');
  nextBtn.click(); // should finish (no more sections)
  TestRunner.assertEquals(om.hasSeen(), true, 'should mark seen after finishing');
});

TestRunner.test('Previous button goes back across sections', async () => {
  const doc = createFakeDocument();
  doc.addButton('openFileBtn');
  doc.addButton('openFolderToolbarBtn');
  doc.addButton('settingsBtn');
  doc.addElement('sidebar', 'sidebar');
  const om = createOnboardingManager({ document: doc, storage: createFakeStorage() });
  om.start();
  const nextBtn = doc.querySelector('.onboarding-btn-next');
  const prevBtn = doc.querySelector('.onboarding-btn-prev');
  nextBtn.click(); // welcome
  await new Promise(r => setTimeout(r, 0));
  nextBtn.click(); // section intro → step 0
  nextBtn.click(); // step 1
  prevBtn.click(); // back to step 0
  TestRunner.assertEquals(om.getCurrentStep(), 0, 'should be back at step 0');
});

TestRunner.test('Skip from welcome marks seen and hides', () => {
  const doc = createFakeDocument();
  doc.addButton('openFileBtn');
  const storage = createFakeStorage();
  const om = createOnboardingManager({ document: doc, storage });
  om.start();

  doc.querySelector('.onboarding-btn-skip').click();
  TestRunner.assertEquals(om.getState().phase, 'done', 'should be done');
  TestRunner.assertEquals(om.hasSeen(), true, 'should mark seen');
});

TestRunner.test('Start does nothing if already seen', () => {
  const doc = createFakeDocument();
  doc.addButton('openFileBtn');
  const storage = createFakeStorage({ [ONBOARDING_STORAGE_KEY]: 'true' });
  const om = createOnboardingManager({ document: doc, storage });
  const result = om.start();
  TestRunner.assertEquals(result.didShow, false, 'should not show');
});

TestRunner.test('Restart shows welcome again', () => {
  const doc = createFakeDocument();
  doc.addButton('openFileBtn');
  const storage = createFakeStorage({ [ONBOARDING_STORAGE_KEY]: 'true' });
  const om = createOnboardingManager({ document: doc, storage });
  TestRunner.assertEquals(om.start().didShow, false, 'already seen');
  om.restart();
  TestRunner.assertEquals(om.getState().phase, 'welcome', 'should show welcome after restart');
});

TestRunner.test('Finish on last step marks seen', async () => {
  const doc = createFakeDocument();
  doc.addButton('openFileBtn');
  doc.addButton('openFolderToolbarBtn');
  doc.addButton('settingsBtn');
  const om = createOnboardingManager({ document: doc, storage: createFakeStorage() });
  om.start();
  const nextBtn = doc.querySelector('.onboarding-btn-next');
  nextBtn.click(); // welcome
  await new Promise(r => setTimeout(r, 0));
  nextBtn.click(); // section intro → step 0
  nextBtn.click(); // step 0 → step 1
  nextBtn.click(); // step 1 → step 2 (last)
  TestRunner.assertEquals(nextBtn.textContent, '完成', 'should show "完成" on last step');
  nextBtn.click(); // finish
  TestRunner.assertEquals(om.hasSeen(), true, 'should mark seen after finish');
});

// ============================================
// openMenu: auto-open a dropdown on step enter
// ============================================
function buildExportMenuSections() {
  return [{ label: '工具栏', steps: [
    { target: '#exportMenuBtn', title: '导出 / 分享', description: '菜单', openMenu: '#exportMenu' },
    { target: '#settingsBtn', title: '设置', description: '配置偏好' }
  ]}];
}

TestRunner.test('Step with openMenu opens the dropdown on enter', async () => {
  const doc = createFakeDocument();
  const trigger = doc.addButton('exportMenuBtn');
  const menu = doc.addButton('exportMenu');
  doc.addButton('settingsBtn');
  const om = createOnboardingManager({
    document: doc, storage: createFakeStorage(), sections: buildExportMenuSections()
  });
  om.start();
  await om.startTour();
  om.nextStep(); // section intro → step 0 (openMenu)

  TestRunner.assertEquals(menu.classList.contains('open'), true, 'menu should be open on step enter');
  TestRunner.assertEquals(trigger.getAttribute('aria-expanded'), 'true', 'aria-expanded should be true');
});

TestRunner.test('Advancing past the openMenu step closes the dropdown', async () => {
  const doc = createFakeDocument();
  const trigger = doc.addButton('exportMenuBtn');
  const menu = doc.addButton('exportMenu');
  doc.addButton('settingsBtn');
  const om = createOnboardingManager({
    document: doc, storage: createFakeStorage(), sections: buildExportMenuSections()
  });
  om.start();
  await om.startTour();
  om.nextStep(); // step 0 (openMenu)
  om.nextStep(); // step 1 (no openMenu)

  TestRunner.assertEquals(menu.classList.contains('open'), false, 'menu should close on next step');
  TestRunner.assertEquals(trigger.getAttribute('aria-expanded'), 'false', 'aria-expanded should reset');
});

TestRunner.test('Skip while the dropdown is open closes it', async () => {
  const doc = createFakeDocument();
  const trigger = doc.addButton('exportMenuBtn');
  const menu = doc.addButton('exportMenu');
  doc.addButton('settingsBtn');
  const om = createOnboardingManager({
    document: doc, storage: createFakeStorage(), sections: buildExportMenuSections()
  });
  om.start();
  await om.startTour();
  om.nextStep(); // step 0 (openMenu)
  TestRunner.assertEquals(menu.classList.contains('open'), true, 'menu open before skip');
  om.skip();

  TestRunner.assertEquals(menu.classList.contains('open'), false, 'skip should close the menu');
  TestRunner.assertEquals(trigger.getAttribute('aria-expanded'), 'false', 'aria-expanded should reset after skip');
});

TestRunner.run();
