/**
 * Typora Next — First-time Onboarding Guide
 *
 * Flow:
 *   1. First launch → show welcome dialog asking if the user wants a tour
 *   2. If yes → load demo file, then guide through 3 sections:
 *      - 工具栏: all toolbar icons
 *      - 左侧侧栏: file tree + TOC tabs
 *      - 折叠 Minimap: sidebar-minimap overview
 *   3. State persisted in localStorage under `typora-next.hasSeenOnboarding`
 *
 * Re-open via Settings → "重新显示引导"
 */
(function() {
  'use strict';

  const ONBOARDING_STORAGE_KEY = 'typora-next.hasSeenOnboarding';

  // ============================================
  // Toolbar icons — one step per visible button
  // ============================================
  const TOOLBAR_STEPS = [
    { target: '#openFileBtn', title: '打开文件', description: '打开单个 Markdown 文件（Ctrl+O）' },
    { target: '#openFolderToolbarBtn', title: '打开文件夹', description: '打开整个文件夹作为工作区（Ctrl+Shift+O）' },
    { target: '#newLearningProjectBtn', title: '课程模式', description: '创建或打开 AI 课程项目' },
    { target: '#paperReaderBtn', title: '论文导读', description: '导入 PDF / ArXiv 论文，生成 AI 导读' },
    { target: '#translateBtn', title: '翻译', description: '调用 AI 翻译当前文档' },
    { target: '#slidesBtn', title: '幻灯片模式', description: '将文档切换为幻灯片演示' },
    { target: '#exportMenuBtn', title: '导出 / 分享', description: '点击展开菜单：导出 Word、导出 PDF（Ctrl+P）、分享打包为 ZIP', openMenu: '#exportMenu' },
    { target: '#settingsBtn', title: '设置', description: '配置 API Key、主题、光标样式等' },
    { target: '#themeToggle', title: '切换主题', description: '在浅色 / 深色主题间切换（Ctrl+Shift+L）' },
    { target: '#agentStatusChip', title: 'Agent 状态', description: '显示 Claude Code Agent 连接状态' }
  ];

  // ============================================
  // Manager
  // ============================================
  function createOnboardingManager(options = {}) {
    const document = options.document || window.document;
    const storage = options.storage || window.localStorage;
    const onOpenDemo = options.onOpenDemo || null; // () => Promise
    const onStepEnter = options.onStepEnter || null; // (section, step) => void

    // State
    let phase = 'idle'; // 'idle' | 'welcome' | 'touring' | 'done'
    let currentSection = 0;   // 0=toolbar, 1=sidebar, 2=minimap
    let currentStep = 0;
    let container = null;
    let card = null;
    let openedMenuTrigger = null; // trigger whose openMenu dropdown is currently shown

    // Build combined steps array
    const sections = [
      { label: '工具栏', steps: TOOLBAR_STEPS }
    ];

    // ============================================
    // Persistence
    // ============================================
    function hasSeen() {
      try { return storage.getItem(ONBOARDING_STORAGE_KEY) === 'true'; }
      catch (e) { return false; }
    }

    function markSeen() {
      try { storage.setItem(ONBOARDING_STORAGE_KEY, 'true'); } catch (e) {}
    }

    function markUnseen() {
      try { storage.removeItem(ONBOARDING_STORAGE_KEY); } catch (e) {}
    }

    // ============================================
    // UI construction
    // ============================================
    function buildUI() {
      if (container) return;

      container = document.createElement('div');
      container.className = 'onboarding-overlay';
      container.setAttribute('role', 'dialog');
      container.setAttribute('aria-modal', 'true');
      container.setAttribute('aria-label', '新手指引');
      container.style.display = 'none';

      // Spotlight (hidden during welcome phase)
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
      prevBtn.type = 'button';
      prevBtn.addEventListener('click', prevStep);
      actions.appendChild(prevBtn);

      const skipBtn = document.createElement('button');
      skipBtn.className = 'onboarding-btn onboarding-btn-skip';
      skipBtn.textContent = '跳过引导';
      skipBtn.type = 'button';
      skipBtn.addEventListener('click', skip);
      actions.appendChild(skipBtn);

      const nextBtn = document.createElement('button');
      nextBtn.className = 'onboarding-btn onboarding-btn-next';
      nextBtn.textContent = '下一步';
      nextBtn.type = 'button';
      nextBtn.addEventListener('click', nextStep);
      actions.appendChild(nextBtn);

      card.appendChild(actions);
      container.appendChild(card);
      document.body.appendChild(container);

      document.addEventListener('keydown', handleKeydown);
    }

    function handleKeydown(e) {
      if (!container || container.style.display === 'none') return;
      if (phase === 'welcome' && e.key === 'Enter') { startTour(); return; }
      if (e.key === 'Escape') { phase === 'welcome' ? dismissWelcome() : skip(); }
      else if (e.key === 'ArrowRight') { nextStep(); }
      else if (e.key === 'ArrowLeft') { prevStep(); }
    }

    function positionSpotlight(target, isArea) {
      const spotlight = container.querySelector('.onboarding-spotlight');
      const rect = target.getBoundingClientRect();
      const padding = isArea ? 4 : 6;
      spotlight.style.top = `${rect.top - padding}px`;
      spotlight.style.left = `${rect.left - padding}px`;
      spotlight.style.width = `${rect.width + padding * 2}px`;
      spotlight.style.height = `${rect.height + padding * 2}px`;
    }

    function positionCard(target) {
      const rect = target.getBoundingClientRect();
      const cardRect = card.getBoundingClientRect();
      const margin = 12;

      let top = rect.bottom + margin;
      let left = rect.left + rect.width / 2 - cardRect.width / 2;

      if (left < margin) left = margin;
      if (left + cardRect.width > window.innerWidth - margin) {
        left = window.innerWidth - cardRect.width - margin;
      }
      if (top + cardRect.height > window.innerHeight - margin) {
        top = rect.top - cardRect.height - margin;
      }

      card.style.top = `${top}px`;
      card.style.left = `${left}px`;
    }

    // ============================================
    // Welcome dialog (no spotlight, centered)
    // ============================================
    function showWelcome() {
      buildUI();
      phase = 'welcome';
      const spotlight = container.querySelector('.onboarding-spotlight');
      spotlight.style.display = 'none';

      card.classList.add('onboarding-card-welcome');
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
      desc.textContent = '这是你的 Markdown 预览编辑器。是否先花 1 分钟了解一下各个功能？';
      progress.textContent = '';
      prevBtn.style.display = 'none';
      skipBtn.textContent = '跳过，直接使用';
      nextBtn.textContent = '是的，开始引导';

      container.style.display = 'flex';

      if (onStepEnter) onStepEnter(sectionIdx, -1);
    }

    function dismissWelcome() {
      markSeen();
      phase = 'done';
      hide();
    }

    // ============================================
    // Tour UI
    // ============================================
    function getCurrentSteps() {
      return sections[currentSection].steps;
    }

    function showSectionIntro(sectionIdx) {
    phase = 'touring';
    currentSection = sectionIdx;
    currentStep = -1; // -1 means "section intro, not yet in a step"

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
    const skipBtn = card.querySelector('.onboarding-btn-skip');
    const nextBtn = card.querySelector('.onboarding-btn-next');

    title.textContent = section.label;
    const stepCount = section.steps.length;
    desc.textContent = `这部分共 ${stepCount} 个步骤，点击「开始」逐一了解。`;
    progress.textContent = `${stepCount} 个步骤`;
    prevBtn.style.display = sectionIdx > 0 ? '' : 'none';
    skipBtn.textContent = '跳过引导';
    nextBtn.textContent = '开始';

    closeStepMenu();
    container.style.display = 'flex';
  }

    // ============================================
    // openMenu support: a step may auto-open a dropdown
    // (e.g. the export menu) so the guide can show its items.
    // The menu is display-only here — the overlay blocks clicks.
    // ============================================
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

    function updateTourStep() {
      const steps = getCurrentSteps();
      const step = steps[currentStep];
      const spotlight = container.querySelector('.onboarding-spotlight');

      // Close the previous step's openMenu dropdown (if any)
      closeStepMenu();

      const title = card.querySelector('.onboarding-card-title');
      const desc = card.querySelector('.onboarding-card-desc');
      const progress = card.querySelector('.onboarding-card-progress');
      const prevBtn = card.querySelector('.onboarding-btn-prev');
      const skipBtn = card.querySelector('.onboarding-btn-skip');
      const nextBtn = card.querySelector('.onboarding-btn-next');

      title.textContent = step.title;
      desc.textContent = step.description;

      const totalSteps = sections.reduce((s, sec) => s + sec.steps.length, 0);
      const stepIndexBefore = sections.slice(0, currentSection).reduce((s, sec) => s + sec.steps.length, 0);
      const globalStepNum = stepIndexBefore + currentStep + 1;
      progress.textContent = `步骤 ${globalStepNum} / ${totalSteps}`;

      prevBtn.style.display = (currentStep > 0 || currentSection > 0) ? '' : 'none';
      skipBtn.textContent = '跳过引导';
      nextBtn.textContent = (currentSection === sections.length - 1 && currentStep === steps.length - 1) ? '完成' : '下一步';

      const target = document.querySelector(step.target);
      if (target) {
        positionSpotlight(target, !!step.spotlightArea);
        requestAnimationFrame(() => positionCard(target));
        spotlight.style.display = 'block';
        openStepMenu(step);
      } else {
        spotlight.style.display = 'none';
        // Center card
        card.style.position = 'fixed';
        card.style.top = '50%';
        card.style.left = '50%';
        card.style.transform = 'translate(-50%, -50%)';
      }

      // Fire step-enter callback (used for interactive demos like sidebar collapse)
      if (onStepEnter) {
        onStepEnter(currentSection, currentStep);
      }
    }

    // ============================================
    // Navigation
    // ============================================
    function nextStep() {
      if (phase === 'welcome') { startTour(); return; }
      if (phase !== 'touring') return;

      const steps = getCurrentSteps();
      if (currentStep < steps.length - 1) {
        currentStep++;
        updateTourStep();
      } else if (currentSection < sections.length - 1) {
        // Move to next section intro
        showSectionIntro(currentSection + 1);
      } else {
        finish();
      }
    }

    function prevStep() {
      if (phase !== 'touring') return;
      if (currentStep > 0) {
        currentStep--;
        updateTourStep();
      } else if (currentSection > 0) {
        // Go to previous section's last step
        currentSection--;
        const prevSteps = getCurrentSteps();
        currentStep = prevSteps.length - 1;
        updateTourStep();
      }
    }

    function skip() {
      markSeen();
      phase = 'done';
      hide();
    }

    function finish() {
      markSeen();
      phase = 'done';
      hide();
    }

    function hide() {
      closeStepMenu();
      if (container) container.style.display = 'none';
    }

    // ============================================
    // Public API
    // ============================================
    function start() {
      if (hasSeen()) return { didShow: false };
      showWelcome();
      return { didShow: true };
    }

    async function startTour() {
      phase = 'touring';
      // Open demo file first if callback provided
      if (onOpenDemo) {
        try {
          await onOpenDemo();
        } catch (e) {
          console.warn('[Onboarding] Failed to open demo file:', e);
        }
      }
      // Wait a frame for render
      await new Promise(r => requestAnimationFrame(r));
      showSectionIntro(0);
    }

    function restart() {
      markUnseen();
      showWelcome();
    }

    function destroy() {
      if (container) { container.remove(); container = null; card = null; }
      document.removeEventListener('keydown', handleKeydown);
    }

    function getState() {
      return { phase, currentSection, currentStep, visible: container && container.style.display !== 'none' };
    }

    return {
      start, startTour, restart, nextStep, prevStep, skip, finish, hide, destroy,
      hasSeen, markSeen, markUnseen, getState,
      getCurrentSection: () => currentSection,
      getCurrentStep: () => currentStep
    };
  }

  window.OnboardingManager = { create: createOnboardingManager };
})();
