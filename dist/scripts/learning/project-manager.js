/**
 * Learning Project Manager
 * Handles the "New Learning Project" dialog state machine and outline management
 *
 * State Machine:
 *   idle -> input -> planning -> outline -> generating
 *                    ^                    |
 *                    |____________________|
 *                    (on error or re-plan)
 */

(function() {
  'use strict';

  // ============================================
  // State (matches TDD test contract)
  // ============================================
  const dialogState = {
    step: 'idle',           // idle | input | planning | outline | generating
    goal: '',
    level: 'intermediate',
    hours: 3,
    outline: null,
    isLoading: false,
    error: null,
    projectPath: null
  };

  // Valid chapter statuses
  const CHAPTER_STATUS = {
    NOT_GENERATED: 'not_generated',
    GENERATING: 'generating',
    READY: 'ready',
    COMPLETED: 'completed',
    FAILED: 'failed'
  };

  const PLANNING_TIMEOUT_MS = 300000; // 5 minutes
  let countdownTimer = null;

  // ============================================
  // DOM Elements
  // ============================================
  const elements = {
    modal: null,
    title: null,
    body: null,
    footer: null,
    closeBtn: null,
    cancelBtn: null,
    actionBtn: null,
    stepInput: null,
    stepPlanning: null,
    stepOutline: null,
    goalInput: null,
    levelRadios: null,
    hoursSelect: null,
    errorDisplay: null,
    outlineInfo: null,
    outlineList: null,
    countdown: null
  };

  // ============================================
  // Initialization
  // ============================================
  function init() {
    cacheElements();
    bindEvents();
  }

  function cacheElements() {
    elements.modal = document.getElementById('learningProjectModal');
    elements.title = document.getElementById('learningModalTitle');
    elements.body = document.getElementById('learningModalBody');
    elements.footer = document.getElementById('learningModalFooter');
    elements.closeBtn = document.getElementById('learningModalClose');
    elements.cancelBtn = document.getElementById('learningModalCancel');
    elements.actionBtn = document.getElementById('learningModalAction');
    elements.stepInput = document.getElementById('learningStepInput');
    elements.stepPlanning = document.getElementById('learningStepPlanning');
    elements.stepOutline = document.getElementById('learningStepOutline');
    elements.goalInput = document.getElementById('learningGoal');
    elements.levelRadios = document.querySelectorAll('input[name="learningLevel"]');
    elements.hoursSelect = document.getElementById('learningHours');
    elements.errorDisplay = document.getElementById('learningError');
    elements.outlineInfo = document.getElementById('learningOutlineInfo');
    elements.outlineList = document.getElementById('learningOutlineList');
    elements.countdown = document.getElementById('learningCountdown');
    elements.planningLog = document.getElementById('learningPlanningLog');
  }

  function bindEvents() {
    // Toolbar button - smart toggle: restore panel if in learning mode, else open hub
    const toolbarBtn = document.getElementById('newLearningProjectBtn');
    if (toolbarBtn) {
      toolbarBtn.addEventListener('click', async () => {
        // Sprint 10: paper reader mode switch guard
        if (window.isPaperReaderActive && window.isPaperReaderActive()) {
          const ok = await window.confirmPaperReaderSwitch('切换模式将关闭论文，是否继续？');
          if (!ok) return;
          if (window.closePaperReader) window.closePaperReader();
        }

        if (window.AppWorkspace?.isIn('course') ?? document.body.classList.contains('learning-mode')) {
          // Already in learning mode - toggle panel/orb
          const panel = document.getElementById('learningProgressPanel');
          const orb = document.getElementById('learningModeOrb');
          if (panel && orb) {
            if (panel.style.display === 'none' || panel.style.display === '') {
              panel.style.display = 'flex';
              orb.style.display = 'none';
            } else {
              panel.style.display = 'none';
              orb.style.display = 'flex';
            }
          }
        } else if (window.LearningHub) {
          window.LearningHub.open();
        } else {
          openDialog();
        }
      });
    }

    // Modal controls
    elements.closeBtn.addEventListener('click', closeDialog);
    elements.cancelBtn.addEventListener('click', closeDialog);
    elements.actionBtn.addEventListener('click', onActionClick);

    // Overlay click does NOT close dialog (prevent accidental close)
    // Only X button and Cancel button can close the dialog

    // Enter key on goal input triggers action
    elements.goalInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') onActionClick();
    });

    // Clear error on input
    elements.goalInput.addEventListener('input', () => {
      if (dialogState.error) {
        dialogState.error = null;
        showError(null);
      }
    });

    // Listen for session-init status events from Rust (fires during
    // setup_project_with_session so the user sees progress instead of
    // a blank dialog while mkdir + skills copy + agent init run).
    if (window.__TAURI__ && window.__TAURI__.event) {
      window.__TAURI__.event.listen('session-init-status', (event) => {
        const payload = event.payload || {};
        if (payload.step) handleInitStatusEvent(payload.step);
      });
    }
  }

  // ============================================
  // Session Init Status Panel (used during setup_project_with_session)
  // ============================================
  // 4-step progress panel shown in dialog body while Rust runs
  // mkdir + skills copy + agent init + session.json write.
  // Replaces the outline list during the ~3s blocking window.

  const INIT_STEPS = [
    { id: 'creating_project',   name: '创建项目文件夹', desc: '建立项目目录与 project.json' },
    { id: 'copying_skills',     name: '加载技能模板',   desc: '复制 chapter-generation 等 skill 到 .claude/skills/' },
    { id: 'initializing_agent', name: '调用 AI API 初始化', desc: '建立 agent session（首次需连接 API）' },
    { id: 'writing_session',    name: '保存 session_id', desc: '写入 .learning/agent-session.json' }
  ];

  let _initPanelEl = null;

  function buildInitStatusPanel() {
    // Hide outline step (panel will take over the body area)
    if (elements.stepOutline) elements.stepOutline.style.display = 'none';

    // Disable close/cancel/action so user can't interrupt mid-init
    if (elements.closeBtn)  elements.closeBtn.style.display  = 'none';
    if (elements.cancelBtn) elements.cancelBtn.style.display = 'none';
    if (elements.actionBtn) {
      elements.actionBtn.disabled = true;
      elements.actionBtn.style.display = 'none';
    }

    // Update title to generic "initializing" message
    if (elements.title) elements.title.textContent = '正在初始化项目';

    const chapterCount = (dialogState.outline && dialogState.outline.chapters)
      ? dialogState.outline.chapters.length : 0;
    const totalMinutes = (dialogState.outline && dialogState.outline.total_duration) || 0;
    const goalText = dialogState.goal || '未命名';

    // Build panel HTML
    const panel = document.createElement('div');
    panel.className = 'init-status-panel';
    panel.innerHTML = `
      <div class="init-status-list">
        ${INIT_STEPS.map((s, i) => `
          <div class="init-status-row" data-step="${s.id}">
            <div class="init-status-icon">${i + 1}</div>
            <div class="init-status-text">
              <div class="step-name">${escapeHtml(s.name)}</div>
              <div class="step-desc">${escapeHtml(s.desc)}</div>
            </div>
          </div>
        `).join('')}
      </div>
      <div class="init-project-info">
        <div class="info-label">项目：${escapeHtml(goalText)}</div>
        <div class="info-meta">${chapterCount} 章 · 预计 ${totalMinutes} 分钟</div>
      </div>
    `;
    if (elements.body) elements.body.appendChild(panel);
    _initPanelEl = panel;

    // Step 0 is active right away (no event needed for first step)
    setInitStep(0);
  }

  function setInitStep(activeIdx) {
    if (!_initPanelEl) return;
    const rows = _initPanelEl.querySelectorAll('.init-status-row');
    rows.forEach((row, i) => {
      const icon = row.querySelector('.init-status-icon');
      if (i < activeIdx) {
        row.classList.remove('active');
        row.classList.add('done');
        icon.textContent = '✓';
      } else if (i === activeIdx) {
        row.classList.add('active');
        row.classList.remove('done');
        icon.innerHTML = '<div class="init-mini-spinner"></div>';
      } else {
        row.classList.remove('active', 'done');
        icon.textContent = String(i + 1);
      }
    });
  }

  function handleInitStatusEvent(stepId) {
    if (!_initPanelEl) return; // panel not active (e.g. dialog closed), ignore
    if (stepId === 'agent_ready') {
      // agent_ready is emitted AFTER writing session.json, so all steps done
      setInitStep(INIT_STEPS.length);
    } else {
      const idx = INIT_STEPS.findIndex(s => s.id === stepId);
      if (idx >= 0) setInitStep(idx);
    }
  }

  function destroyInitStatusPanel() {
    if (_initPanelEl && _initPanelEl.parentNode) {
      _initPanelEl.parentNode.removeChild(_initPanelEl);
    }
    _initPanelEl = null;
    if (elements.stepOutline) elements.stepOutline.style.display = '';
    if (elements.closeBtn) elements.closeBtn.style.display = '';
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  // ============================================
  // Dialog State Machine
  // ============================================
  function openDialog() {
    resetState();
    transitionTo('input');
    elements.modal.style.display = 'flex';
    setTimeout(() => elements.goalInput.focus(), 100);
  }

  function closeDialog() {
    elements.modal.style.display = 'none';
    // Safety: if a status panel is still around, remove it. The normal
    // success path destroys it in transitionTo('generating'); this covers
    // cases like the user clicking the overlay or modal closing mid-init.
    if (_initPanelEl) destroyInitStatusPanel();
    if (dialogState.step !== 'generating') {
      resetState();
    }
  }

  function resetState() {
    dialogState.step = 'idle';
    dialogState.goal = '';
    dialogState.level = 'intermediate';
    dialogState.hours = 3;
    dialogState.outline = null;
    dialogState.isLoading = false;
    dialogState.error = null;
    dialogState.projectPath = null;

    // Reset form
    elements.goalInput.value = '';
    elements.levelRadios.forEach(r => {
      r.checked = (r.value === 'intermediate');
    });
    elements.hoursSelect.value = '3';
    showError(null);
  }

  async function transitionTo(step) {
    dialogState.step = step;

    // Hide all steps
    elements.stepInput.style.display = 'none';
    elements.stepPlanning.style.display = 'none';
    elements.stepOutline.style.display = 'none';

    switch (step) {
      case 'input':
        elements.stepInput.style.display = 'block';
        elements.title.textContent = '新建学习项目';
        elements.actionBtn.textContent = '开始设计';
        elements.actionBtn.disabled = false;
        elements.actionBtn.style.display = 'inline-block';
        elements.cancelBtn.style.display = 'inline-block';
        break;

      case 'planning':
        elements.stepPlanning.style.display = 'block';
        elements.title.textContent = '设计学习路径';
        elements.actionBtn.style.display = 'none';
        elements.cancelBtn.style.display = 'none';
        break;

      case 'outline':
        elements.stepOutline.style.display = 'block';
        elements.title.textContent = '学习路径预览';
        elements.actionBtn.textContent = '开始生成';
        elements.actionBtn.disabled = false;
        elements.actionBtn.style.display = 'inline-block';
        elements.cancelBtn.style.display = 'inline-block';
        elements.cancelBtn.textContent = '重新规划';
        renderOutline();
        break;

      case 'generating':
        destroyInitStatusPanel(); // clean up status panel before closing
        closeDialog();
        // Hand off to progress tracker
        if (window.LearningProgress) {
          await window.LearningProgress.startGeneration(dialogState.outline, dialogState.projectPath);
        }
        break;
    }
  }

  // ============================================
  // Action Handler
  // ============================================
  async function onActionClick() {
    switch (dialogState.step) {
      case 'input':
        await startPlanning();
        break;
      case 'outline':
        startGeneration();
        break;
    }
  }

  async function startPlanning() {
    // Collect form data
    dialogState.goal = elements.goalInput.value.trim();
    dialogState.level = getSelectedLevel();
    dialogState.hours = parseInt(elements.hoursSelect.value, 10);

    // Validate
    if (!dialogState.goal) {
      showError('请输入学习目标');
      return;
    }
    if (dialogState.goal.length < 3) {
      showError('学习目标至少 3 个字符');
      return;
    }

    transitionTo('planning');
    startCountdown();

    try {
      // Call Rust backend to plan course (synchronous, returns outline directly).
      // Phase A migration: switched from plan_course (Agent SDK + 500ms cold start
      // + event-driven wait) to plan_course_llm (ureq direct call, returns JSON).
      if (window.__TAURI__) {
        const { invoke } = window.__TAURI__.core;
        console.log('[LearningProject] Calling plan_course_llm...', dialogState.goal, dialogState.level, dialogState.hours);
        const outline = await invoke('plan_course_llm', {
          goal: dialogState.goal,
          level: dialogState.level,
          hours: dialogState.hours
        });
        console.log('[LearningProject] plan_course_llm returned:', outline);

        // Validate
        if (!outline || !outline.chapters || !Array.isArray(outline.chapters)) {
          throw new Error('大纲格式错误：缺少 chapters 数组');
        }

        stopCountdown();
        dialogState.outline = outline;
        transitionTo('outline');
      } else {
        // Mock for development without Tauri
        console.log('[LearningProject] No Tauri, using mock');
        await mockPlanCourse();
      }
    } catch (err) {
      console.error('[LearningProject] Error:', err);
      stopCountdown();
      handleError(err.message || '生成大纲失败');
    }
  }

  function getSelectedLevel() {
    for (const radio of elements.levelRadios) {
      if (radio.checked) return radio.value;
    }
    return 'intermediate';
  }

  function waitForOutline() {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        stopCountdown();
        reject(new Error('生成大纲超时，请重试'));
      }, PLANNING_TIMEOUT_MS);

      let unlisten = null;
      let lastLogTime = Date.now();

      // After 5s with no log output, show waiting indicator for providers
      // (like DeepSeek) that don't stream interim messages via Agent SDK.
      const waitingTimer = setInterval(() => {
        const elapsed = Math.floor((Date.now() - lastLogTime) / 1000);
        if (elapsed >= 5 && elapsed % 5 === 0) {
          appendPlanningLog(`⏳ 等待 AI 响应中...（已等待 ${elapsed} 秒）`);
        }
      }, 5000);

      function onAgentEvent(msg) {
        console.log('[LearningProject] onAgentEvent called, type:', msg?.type, 'data:', msg?.data);
        // Reset waiting timer on any log-worthy event
        if (msg.type === 'progress_log' || msg.type === 'status') {
          lastLogTime = Date.now();
        }
        if (msg.type === 'outline') {
          clearTimeout(timeout);
          clearInterval(waitingTimer);
          stopCountdown();
          if (unlisten) unlisten();
          // Handle nested structure: msg.data may be {outline: {...}} or directly {chapters: [...]}
          dialogState.outline = msg.data.outline || msg.data;
          console.log('[LearningProject] Outline stored, chapters:', dialogState.outline?.chapters?.length, 'transitioning to outline view');
          transitionTo('outline');
          console.log('[LearningProject] transitionTo outline done, step:', dialogState.step);
          resolve();
        } else if (msg.type === 'error') {
          clearTimeout(timeout);
          clearInterval(waitingTimer);
          stopCountdown();
          if (unlisten) unlisten();
          reject(new Error(msg.data.message));
        } else if (msg.type === 'progress_log') {
          appendPlanningLog(msg.data?.text || '');
        } else if (msg.type === 'status') {
          // Show status message in planning log so users see feedback even
          // when the AI provider doesn't stream interim assistant messages.
          appendPlanningLog(msg.data?.message || '');
        }
      }

      // Use Tauri event system, not DOM events
      if (window.__TAURI__ && window.__TAURI__.event) {
        console.log('[LearningProject] Registering agent-event listener...');
        window.__TAURI__.event.listen('agent-event', (event) => {
          console.log('[LearningProject] Received agent-event:', event.payload?.type);
          onAgentEvent(event.payload);
        }).then(fn => {
          console.log('[LearningProject] Listener registered, unlisten stored');
          unlisten = fn;
        });
      } else {
        reject(new Error('Tauri 不可用'));
      }
    });
  }

  // ============================================
  // Planning Countdown
  // ============================================
  function startCountdown() {
    stopCountdown();
    const deadline = Date.now() + PLANNING_TIMEOUT_MS;
    updateCountdownDisplay(deadline);
    countdownTimer = setInterval(() => {
      updateCountdownDisplay(deadline);
    }, 1000);
  }

  function stopCountdown() {
    if (countdownTimer) {
      clearInterval(countdownTimer);
      countdownTimer = null;
    }
    if (elements.countdown) {
      elements.countdown.textContent = '';
    }
    clearPlanningLog();
  }

  function clearPlanningLog() {
    if (elements.planningLog) {
      elements.planningLog.innerHTML = '';
    }
  }

  function appendPlanningLog(text) {
    if (!elements.planningLog || !text) return;
    const line = document.createElement('div');
    line.className = 'learning-planning-log-line';
    line.textContent = text;
    elements.planningLog.appendChild(line);
    elements.planningLog.scrollTop = elements.planningLog.scrollHeight;
    // Keep last 100 lines to avoid unbounded growth
    while (elements.planningLog.children.length > 100) {
      elements.planningLog.removeChild(elements.planningLog.firstChild);
    }
  }

  function updateCountdownDisplay(deadline) {
    if (!elements.countdown) return;
    const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    const minutes = Math.floor(remaining / 60);
    const seconds = remaining % 60;
    elements.countdown.textContent = `预计最多还需等待 ${minutes}:${String(seconds).padStart(2, '0')}`;
  }

  // ============================================
  // Mock for development
  // ============================================
  async function mockPlanCourse() {
    await new Promise(r => setTimeout(r, 1500));

    dialogState.outline = {
      chapters: [
        { title: '为什么学这个', duration_minutes: 10, concepts: ['动机', '应用场景'] },
        { title: '注意力机制的本质', duration_minutes: 25, concepts: ['注意力', '查询键值'] },
        { title: '从 RNN 到 Self-Attention', duration_minutes: 30, concepts: ['RNN', 'Self-Attention', '并行计算'] },
        { title: '多头注意力图解', duration_minutes: 25, concepts: ['多头注意力', 'Q/K/V'] },
        { title: '位置编码', duration_minutes: 20, concepts: ['位置编码', '正弦余弦'] },
        { title: '完整架构一览', duration_minutes: 20, concepts: ['Encoder', 'Decoder'] },
        { title: '动手实现', duration_minutes: 30, concepts: ['PyTorch', '代码实现'] },
        { title: '总结与知识卡片', duration_minutes: 10, concepts: ['复习', '知识卡片'] }
      ],
      total_duration: 170
    };

    transitionTo('outline');
  }

  // ============================================
  // Outline Rendering & Editing
  // ============================================
  function renderOutline() {
    const outline = dialogState.outline;
    console.log('[LearningProject] renderOutline called, outline:', outline ? 'exists' : 'null', 'chapters:', outline?.chapters?.length);
    if (!outline || !outline.chapters) return;

    const totalHours = Math.round(outline.total_duration / 60 * 10) / 10;
    elements.outlineInfo.textContent =
      `${outline.chapters.length} 章 · 预计 ${totalHours} 小时 · ${dialogState.goal}`;

    elements.outlineList.innerHTML = '';
    outline.chapters.forEach((chapter, index) => {
      const item = createOutlineItem(chapter, index);
      elements.outlineList.appendChild(item);
    });
  }

  function createOutlineItem(chapter, index) {
    const div = document.createElement('div');
    div.className = 'learning-outline-item';
    div.dataset.index = index;

    const duration = chapter.duration_minutes;
    const concepts = chapter.concepts
      ? chapter.concepts.map(c => typeof c === 'string' ? c : (c.name || c.id || '')).join('、')
      : '';

    div.innerHTML = `
      <div class="learning-outline-number">${index + 1}</div>
      <div class="learning-outline-content">
        <div class="learning-outline-title">${escapeHtml(chapter.title)}</div>
        <div class="learning-outline-meta">${duration} 分钟 · ${escapeHtml(concepts)}</div>
      </div>
      <div class="learning-outline-actions">
        <button class="learning-outline-btn learning-outline-edit" title="编辑">✏️</button>
        <button class="learning-outline-btn learning-outline-delete" title="删除">🗑️</button>
      </div>
    `;

    // Edit handler
    div.querySelector('.learning-outline-edit').addEventListener('click', () => {
      enableInlineEdit(div, chapter, index);
    });

    // Delete handler
    div.querySelector('.learning-outline-delete').addEventListener('click', () => {
      deleteChapter(index);
    });

    return div;
  }

  function enableInlineEdit(itemEl, chapter, index) {
    const titleEl = itemEl.querySelector('.learning-outline-title');
    const currentTitle = chapter.title;

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'learning-inline-edit';
    input.value = currentTitle;

    titleEl.innerHTML = '';
    titleEl.appendChild(input);
    input.focus();
    input.select();

    function saveEdit() {
      const newTitle = input.value.trim();
      if (newTitle && newTitle !== currentTitle) {
        editChapter(index, newTitle);
      } else {
        renderOutline();
      }
    }

    input.addEventListener('blur', saveEdit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        saveEdit();
      } else if (e.key === 'Escape') {
        renderOutline();
      }
    });
  }

  function editChapter(index, newTitle) {
    const outline = dialogState.outline;
    const updatedChapters = [...outline.chapters];
    updatedChapters[index] = { ...updatedChapters[index], title: newTitle };
    dialogState.outline = { ...outline, chapters: updatedChapters };
    renderOutline();
  }

  function deleteChapter(index) {
    const outline = dialogState.outline;
    const chapters = outline.chapters.filter((_, i) => i !== index);
    const total_duration = chapters.reduce((sum, c) => sum + (c.duration_minutes || 0), 0);
    dialogState.outline = { ...outline, chapters, total_duration };
    renderOutline();
  }

  // ============================================
  // Generation Start
  // ============================================
  async function startGeneration() {
    dialogState.step = 'generating';

    try {
      // Create project folder via Rust backend
      if (window.__TAURI__) {
        const { invoke } = window.__TAURI__.core;

        // Ask user for parent save location
        const parentPath = await invoke('open_folder_dialog');

        if (!parentPath) {
          dialogState.step = 'outline';
          return;
        }

        // Create a dedicated subdirectory for this project using the AI-generated slug
        const projectSlug = (dialogState.outline && dialogState.outline.project_slug) || dialogState.goal.trim();
        const savePath = await invoke('create_project_subdir', {
          parentDir: parentPath,
          slug: projectSlug
        });

        if (parentPath) {
          console.log(`[LearningProject] Project subdir: ${parentPath} → ${savePath}`);
        }

        dialogState.projectPath = savePath;

        // Register in learning hub (file-based persistence) — must await
        if (window.LearningHub) {
          await window.LearningHub.registerProject(
            savePath,
            dialogState.goal,
            dialogState.outline.chapters.length,
            0
          );
        }

        // Phase B: atomically create project folder + .learning/project.json
        // AND initialize the agent session. Returns session_id, which is
        // already persisted to .learning/agent-session.json by the Rust side.
        // The Rust side emits `session-init-status` events; we render them
        // as a 4-step status panel in the dialog body so the user sees
        // progress instead of a blank.
        buildInitStatusPanel();
        const sessionId = await invoke('setup_project_with_session', {
          projectPath: savePath,
          outline: dialogState.outline,
          goal: dialogState.goal
        });
        console.log('[LearningProject] Agent session established:', sessionId);

        // Mark which chapters need pre-generation (sliding window: first 2)
        if (window.LearningProgress && window.LearningProgress.setInitialWindow) {
          window.LearningProgress.setInitialWindow(dialogState.outline.chapters.length, 2);
        }

        // Show progress panel and start generation
        transitionTo('generating');
      } else {
        // Mock: use temp path
        dialogState.projectPath = '/tmp/learning-project';
        transitionTo('generating');
      }
    } catch (err) {
      console.error('[LearningProject] startGeneration failed:', err);
      destroyInitStatusPanel(); // ensure no orphan panel after error
      handleError(err.message || '启动生成失败');
    }
  }

  // ============================================
  // Error Handling
  // ============================================
  function showError(message) {
    if (!message) {
      elements.errorDisplay.style.display = 'none';
      elements.errorDisplay.textContent = '';
      return;
    }
    elements.errorDisplay.textContent = message;
    elements.errorDisplay.style.display = 'block';
  }

  function handleError(message) {
    dialogState.error = message;
    dialogState.isLoading = false;
    transitionTo('input');
    showError(message);
  }

  // ============================================
  // Utilities
  // ============================================
  function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // ============================================
  // Public API
  // ============================================
  window.LearningProject = {
    open: openDialog,
    close: closeDialog,
    getState: () => ({ ...dialogState }),
    CHAPTER_STATUS
  };

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
