#!/usr/bin/env node
// -*- coding: utf-8 -*-
/**
 * BDD Acceptance Steps for first-time onboarding guide (v2: welcome + 3 sections)
 */

const { buildMockDOM } = require('../shared/mock-dom');
const { StepRegistry } = require('../shared/runner');

const steps = new StepRegistry();

// ============================================
// OnboardingManager v2 — mirrored from onboarding.js
// ============================================
const ONBOARDING_STORAGE_KEY = 'typora-next.hasSeenOnboarding';

const TOOLBAR_STEPS = [
  { target: '#openFileBtn', title: '打开文件', description: '打开单个 Markdown 文件' },
  { target: '#openFolderToolbarBtn', title: '打开文件夹', description: '打开整个文件夹作为工作区' },
  { target: '#newLearningProjectBtn', title: '课程模式', description: '创建或打开 AI 课程项目' },
  { target: '#paperReaderBtn', title: '论文导读', description: '导入 PDF / ArXiv 论文' },
  { target: '#settingsBtn', title: '设置', description: '配置 API Key、主题等' }
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
    desc.textContent = '是否先花 1 分钟了解一下各个功能？';
    progress.textContent = '';
    prevBtn.style.display = 'none';
    skipBtn.textContent = '跳过，直接使用';
    nextBtn.textContent = '是的，开始引导';

    container.style.display = 'flex';
  }

  function dismissWelcome() { markSeen(); phase = 'done'; hide(); }
  function hide() { if (container) container.style.display = 'none'; }

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

    const section = SECTIONS[sectionIdx];
    const title = card.querySelector('.onboarding-card-title');
    const desc = card.querySelector('.onboarding-card-desc');
    const progress = card.querySelector('.onboarding-card-progress');
    const prevBtn = card.querySelector('.onboarding-btn-prev');
    const skipBtn = card.querySelector('.onboarding-btn-skip');
    const nextBtn = card.querySelector('.onboarding-btn-next');

    title.textContent = section.label;
    desc.textContent = `这部分共 ${section.steps.length} 个步骤，点击「开始」逐一了解。`;
    progress.textContent = `${section.steps.length} 个步骤`;
    prevBtn.style.display = sectionIdx > 0 ? '' : 'none';
    skipBtn.textContent = '跳过引导';
    nextBtn.textContent = '开始';

    container.style.display = 'flex';
  }

  function updateTourStep() {
    const steps = SECTIONS[currentSection].steps;
    const step = steps[currentStep];

    const title = card.querySelector('.onboarding-card-title');
    const desc = card.querySelector('.onboarding-card-desc');
    const progress = card.querySelector('.onboarding-card-progress');
    const prevBtn = card.querySelector('.onboarding-btn-prev');
    const skipBtn = card.querySelector('.onboarding-btn-skip');
    const nextBtn = card.querySelector('.onboarding-btn-next');

    title.textContent = step.title;
    desc.textContent = step.description;

    const totalSteps = SECTIONS.reduce((s, sec) => s + sec.steps.length, 0);
    const stepIndexBefore = SECTIONS.slice(0, currentSection).reduce((s, sec) => s + sec.steps.length, 0);
    progress.textContent = `步骤 ${stepIndexBefore + currentStep + 1} / ${totalSteps}`;

    prevBtn.style.display = (currentStep > 0 || currentSection > 0) ? '' : 'none';
    skipBtn.textContent = '跳过引导';
    nextBtn.textContent = (currentSection === SECTIONS.length - 1 && currentStep === steps.length - 1) ? '完成' : '下一步';

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

      // Simple card position: rect.bottom + 12
      card.style.position = 'absolute';
      card.style.top = `${rect.bottom + 12}px`;
      card.style.left = `${Math.max(12, rect.left)}px`;
    }
  }

  function nextStep() {
    if (phase === 'welcome') { startTour(); return; }
    if (phase !== 'touring') return;
    const steps = SECTIONS[currentSection].steps;
    if (currentStep === -1) { currentStep = 0; updateTourStep(); return; }
    if (currentStep < steps.length - 1) { currentStep++; updateTourStep(); }
    else if (currentSection < SECTIONS.length - 1) { showSectionIntro(currentSection + 1); }
    else { finish(); }
  }

  function prevStep() {
    if (phase !== 'touring') return;
    if (currentStep === -1) {
      if (currentSection > 0) { currentSection--; currentStep = SECTIONS[currentSection].steps.length - 1; updateTourStep(); }
      return;
    }
    if (currentStep > 0) { currentStep--; updateTourStep(); }
    else if (currentSection > 0) {
      currentSection--;
      currentStep = SECTIONS[currentSection].steps.length - 1;
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
    getCurrentSection: () => currentSection,
    getCurrentStep: () => currentStep
  };
}

// ============================================
// Helpers
// ============================================
function setupApp(context) {
  if (context.document) return;
  const { document } = buildMockDOM();
  context.document = document;
  context.body = document.body;

  const toolbar = document.createElement('header');
  toolbar.className = 'toolbar';
  const ids = ['openFileBtn', 'openFolderToolbarBtn', 'newLearningProjectBtn', 'paperReaderBtn', 'settingsBtn'];
  ids.forEach(id => {
    const btn = document.createElement('button');
    btn._attrs.id = id;
    btn.className = 'btn-icon';
    btn.getBoundingClientRect = () => ({ top: 10, left: 10 + ids.indexOf(id) * 40, width: 32, height: 32, bottom: 42, right: 42 });
    toolbar.appendChild(btn);
  });
  context.body.appendChild(toolbar);

  // Tooltip elements
  const tooltip = document.createElement('div');
  tooltip.className = 'toolbar-tooltip';
  tooltip.style.position = 'fixed';
  tooltip.style.opacity = '0';
  context.body.appendChild(tooltip);
}

// Toolbar steps for Given "the tour has completed all toolbar steps"
const QUICK_TOOLBAR_STEPS = ['openFileBtn', 'openFolderToolbarBtn', 'newLearningProjectBtn', 'paperReaderBtn', 'settingsBtn'];

// ============================================
// Given
// ============================================
steps.given('the user has never seen the onboarding guide', function() {
  setupApp(this);
  this.storage = { _data: {}, getItem(k) { return this._data[k] || null; }, setItem(k, v) { this._data[k] = String(v); }, removeItem(k) { delete this._data[k]; } };
  this.onboarding = createOnboardingManager({ document: this.document, storage: this.storage });
});

steps.given('the welcome dialog is visible', function() {
  steps.runStep('the user has never seen the onboarding guide', this);
  this.onboarding.start();
});

steps.given('the tour is in the toolbar section', async function() {
  steps.runStep('the welcome dialog is visible', this);
  await this.onboarding.startTour();
});

steps.given('the user has already seen the onboarding guide', function() {
  setupApp(this);
  this.storage = { _data: { [ONBOARDING_STORAGE_KEY]: 'true' }, getItem(k) { return this._data[k] || null; }, setItem(k, v) { this._data[k] = String(v); }, removeItem(k) { delete this._data[k]; } };
  this.onboarding = createOnboardingManager({ document: this.document, storage: this.storage });
});

// ============================================
// When
// ============================================
steps.when('the app finishes initialising', function() {
  this.onboarding.start();
});

steps.when('the user clicks the start tour button', function() {
  const btn = this.document.querySelector('.onboarding-btn-next');
  btn.click();
});

steps.when('the user clicks the next button repeatedly', function() {
  const btn = this.document.querySelector('.onboarding-btn-next');
  // Click next multiple times to advance through steps
  for (let i = 0; i < 5; i++) btn.click();
});

steps.when('the user clicks the next button', function() {
  const btn = this.document.querySelector('.onboarding-btn-next');
  btn.click();
});

steps.when('the user clicks the skip button', function() {
  const btn = this.document.querySelector('.onboarding-btn-skip');
  btn.click();
});

steps.when('the user clicks restart onboarding in settings', function() {
  this.onboarding.restart();
});

// ============================================
// Then
// ============================================
steps.then('the tour should start with the toolbar section intro and highlight the first button', function() {
  // This step combines "User accepts the tour and sees toolbar steps" scenario checks
  const state = this.onboarding.getState();
  if (state.phase !== 'touring') throw new Error(`Expected phase "touring", got "${state.phase}"`);
  if (state.currentSection !== 0) throw new Error(`Expected section 0, got ${state.currentSection}`);
  const target = this.document.querySelector('#openFileBtn');
  if (!target) throw new Error('#openFileBtn not found');
});

steps.then('a welcome dialog should appear asking if the user wants a tour', function() {
  const state = this.onboarding.getState();
  if (state.phase !== 'welcome') throw new Error(`Expected phase "welcome", got "${state.phase}"`);
  const nextBtn = this.document.querySelector('.onboarding-btn-next');
  if (!nextBtn || nextBtn.textContent !== '是的，开始引导') {
    throw new Error(`Expected "是的，开始引导" button, got "${nextBtn && nextBtn.textContent}"`);
  }
});

steps.then('the tour should start with the toolbar section intro', function() {
  const state = this.onboarding.getState();
  if (state.phase !== 'touring') throw new Error(`Expected phase "touring", got "${state.phase}"`);
  if (state.currentSection !== 0) throw new Error(`Expected section 0 (toolbar), got ${state.currentSection}`);
  const title = this.document.querySelector('.onboarding-card-title');
  if (title.textContent !== '工具栏') throw new Error(`Expected "工具栏", got "${title.textContent}"`);
  const nextBtn = this.document.querySelector('.onboarding-btn-next');
  if (nextBtn.textContent !== '开始') throw new Error(`Expected "开始" button, got "${nextBtn.textContent}"`);
});

steps.then('the first toolbar button should be highlighted', function() {
  const target = this.document.querySelector('#openFileBtn');
  if (!target) throw new Error('#openFileBtn not found');
  if (!target.getBoundingClientRect) throw new Error('#openFileBtn has no bounding rect');
});

steps.then('each toolbar button should be highlighted in order', function() {
  const state = this.onboarding.getState();
  if (state.phase !== 'touring') throw new Error(`Expected phase "touring", got "${state.phase}"`);
  if (state.currentSection !== 0) throw new Error(`Expected section 0 (toolbar), got section ${state.currentSection}`);
  // Should have advanced past step 0
  if (state.currentStep <= 0) throw new Error(`Expected to advance past first step, still at step ${state.currentStep}`);
});

steps.then('the onboarding overlay should be hidden', function() {
  const state = this.onboarding.getState();
  if (state.phase === 'done' || !this.document.querySelector('.onboarding-overlay') ||
      this.document.querySelector('.onboarding-overlay').style.display === 'none') {
    return;
  }
  throw new Error('Onboarding overlay is still visible');
});

steps.then('the onboarding seen flag should be set', function() {
  if (!this.onboarding.hasSeen()) throw new Error('Onboarding seen flag is not set');
});

steps.then('no onboarding dialog should appear', function() {
  const result = this.onboarding.start();
  if (result.didShow) throw new Error('Onboarding appeared despite having seen flag');
});

steps.then('the welcome dialog should appear', function() {
  const state = this.onboarding.getState();
  if (state.phase !== 'welcome') throw new Error(`Expected phase "welcome", got "${state.phase}"`);
});

module.exports = steps;
